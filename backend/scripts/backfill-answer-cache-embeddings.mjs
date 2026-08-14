#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import answerCache from '../lib/answer-cache.js';
import embeddings from '../lib/answer-embeddings.js';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const numberArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && Number.isFinite(Number(args[i + 1])) ? Number(args[i + 1]) : fallback;
};
const delayMs = Math.max(250, numberArg('--delay-ms', 500));
const batchSize = Math.min(100, Math.max(1, numberArg('--batch-size', 10)));
const limit = Math.max(1, numberArg('--limit', Number.MAX_SAFE_INTEGER));
const maxErrors = Math.max(1, numberArg('--max-errors', 3));
const resumeAt = args[args.indexOf('--resume-after') + 1] || '';
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment: ${missing.join(', ')}`);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = { scanned: 0, backfilled: 0, failed: 0, raced: 0 };
let cursor = resumeAt;

async function embed(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(embeddings.requestBody(answerCache.normalise(text))),
      });
      if (res.ok) return embeddings.parseEmbedding(await res.json());
      if (![408, 429, 500, 502, 503, 504].includes(res.status)) return null;
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * (2 ** attempt));
    } catch {
      await sleep(500 * (2 ** attempt));
    }
  }
  return null;
}

while (summary.scanned < limit && summary.failed < maxErrors) {
  let query = db.from('answer_cache').select('key,question_text').is('embedding', null)
    .not('question_text', 'is', null)
    .order('key', { ascending: true }).limit(Math.min(batchSize, limit - summary.scanned));
  if (cursor) query = query.gt('key', cursor);
  const { data, error } = await query;
  if (error) throw new Error(`Read failed: ${error.message}`);
  if (!data?.length) break;
  for (const row of data) {
    cursor = row.key;
    summary.scanned++;
    if (!String(row.question_text || '').trim()) { summary.failed++; continue; }
    if (!apply) continue;
    const vector = await embed(row.question_text);
    if (!vector) { summary.failed++; console.log(`[BACKFILL] progress scanned=${summary.scanned} backfilled=${summary.backfilled} failed=${summary.failed} cursor=${cursor}`); continue; }
    const { data: updated, error: updateError } = await db.from('answer_cache')
      .update({ embedding: embeddings.vectorLiteral(vector) }).eq('key', row.key)
      .is('embedding', null).select('key');
    if (updateError) { summary.failed++; } else if (!updated?.length) { summary.raced++; } else { summary.backfilled++; }
    console.log(`[BACKFILL] progress scanned=${summary.scanned} backfilled=${summary.backfilled} failed=${summary.failed} raced=${summary.raced} cursor=${cursor}`);
    await sleep(delayMs);
  }
}

console.log(`[BACKFILL] complete mode=${apply ? 'apply' : 'dry-run'} scanned=${summary.scanned} backfilled=${summary.backfilled} failed=${summary.failed} raced=${summary.raced} cursor=${cursor || 'none'}`);
if (summary.failed) process.exitCode = 1;
