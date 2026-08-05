/**
 * ALOP-AI ULTIMATE PRECISION BACKEND
 * 
 * Features: AI memory detection, persistent Supabase memory, 5 search sources,
 * search cache, response cache, language detection, self-selecting council,
 * streaming fallback, image support, 12 anti-hallucination rules, feedback learning,
 * bulletproof overlay.
 */

// dotenv must load before Sentry.init so SENTRY_DSN is readable, and Sentry must
// init before the app modules it instruments are required.
require('dotenv').config();

const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

const IS_PROD = process.env.NODE_ENV === 'production';
if (!process.env.SENTRY_DSN) {
  console.warn('[BOOT] SENTRY_DSN not set — error reporting disabled.');
}
Sentry.init({
  // A DSN is write-only, but hardcoding one lets anyone burn the project's event quota.
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV || 'development',
  integrations: [Sentry.httpIntegration(), Sentry.expressIntegration(), nodeProfilingIntegration()],
  // Full sampling is fine locally; in production it is pure cost for no extra signal.
  tracesSampleRate: IS_PROD ? 0.1 : 1.0,
  profilesSampleRate: IS_PROD ? 0.1 : 1.0,
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const timeout = require('connect-timeout');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { ClerkExpressRequireAuth, clerkClient } = require('@clerk/clerk-sdk-node');
const Stripe = require('stripe');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ===== ENV =====
// Core config: the server cannot answer a single request without these.
// CLERK_PUBLISHABLE_KEY is deliberately absent — it is a frontend value and is
// never read here, so requiring it only blocked startup for no reason.
const requiredEnv = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CLERK_SECRET_KEY','FRONTEND_URL','OLLAMA_HOST','OLLAMA_API_KEY'];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length > 0) { console.error(`Missing required env: ${missingEnv.join(', ')}`); process.exit(1); }

// clerk-sdk-node reads this at import time and throws on every authenticated request
// without it. Not fatal here on purpose: refusing to boot would turn a misconfigured
// deploy into a full outage, and this warning names the cause in the very first log line.
if (!process.env.CLERK_PUBLISHABLE_KEY) {
  console.warn('[BOOT] CLERK_PUBLISHABLE_KEY not set — every authenticated route will fail with 500.');
}

// Billing is optional. Without it the app runs normally and only the Stripe
// routes refuse, instead of the whole process refusing to boot.
const STRIPE_ENABLED = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
if (!STRIPE_ENABLED) console.warn('[BOOT] Stripe not configured — billing routes disabled.');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || null;
const JINA_API_KEY = process.env.JINA_API_KEY || null;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || null;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || null;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY || null;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || null;

const stripe = STRIPE_ENABLED ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;
const requireStripe = (req, res, next) => STRIPE_ENABLED ? next() : res.status(503).json({ error: 'Billing is not configured on this server.' });
const OLLAMA_HOST = process.env.OLLAMA_HOST;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// ===== MODELS =====
// One seat per model family. The previous roster ran three Kimi variants,
// three MiniMax variants, two GLM and two Nemotron — thirteen calls that
// largely restated each other. A council is only worth its cost if the members
// can actually disagree, so near-siblings were dropped rather than kept.
//
// Temperature is per-seat and deliberately spread. Every model previously ran
// at 0.0, which made them converge on the same answer and left the synthesis
// step with nothing to reconcile. The determinism that matters — extracting
// facts from search results — is unaffected; those paths still run at 0.0.
const COUNCIL = [
  { model: 'glm-5.2',          temperature: 0.2, free: false },
  { model: 'kimi-k2.7-code',   temperature: 0.3, free: true  },
  { model: 'qwen3.5',          temperature: 0.5, free: true  },
  { model: 'gemma4',           temperature: 0.7, free: true  },
  { model: 'deepseek-v4-pro',  temperature: 0.4, free: false },
  { model: 'nemotron-3-ultra', temperature: 0.5, free: false },
  { model: 'minimax-m3',       temperature: 0.8, free: false },
];

const FREE_COUNCIL = COUNCIL.filter((m) => m.free);
// The single model used for streaming: synthesis, greetings, fallback and
// search extraction all speak with one voice, so it stays deterministic.
const PRIMARY_MODEL = 'glm-5.2';
const FAST_MODEL = 'gemma4';

// ===== AI HELPERS =====
const callModel = async (modelName, messages, temperature = 0.0, timeoutMs = 30000, maxTokens = 1000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OLLAMA_HOST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` }, body: JSON.stringify({ model: modelName, messages, stream: false, options: { temperature, num_predict: maxTokens } }), signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) { const text = await res.text(); throw new Error(`Model ${modelName}: ${res.status} ${text.slice(0,200)}`); }
    const data = await res.json();
    return data.message?.content || data.response || '';
  } catch (err) { clearTimeout(timer); if (err.name === 'AbortError') return ''; throw err; }
};

const streamModel = async (res, modelName, messages, temperature = 0.0) => {
  const response = await fetch(OLLAMA_HOST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` }, body: JSON.stringify({ model: modelName, messages, stream: true, options: { temperature } }) });
  if (!response.ok || !response.body) throw new Error('Stream failed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) { const t = line.trim(); if (!t) continue; try { const p = JSON.parse(t); const d = p.message?.content || p.response || ''; if (d) res.write(`data: ${JSON.stringify({ type: 'chunk', text: d })}\n\n`); if (p.done) res.write('data: [DONE]\n\n'); } catch {} }
  }
};

const callGeminiVision = async (modelName, prompt, base64Image, mimeType = 'image/png', maxTokens = 2048) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  if (Buffer.byteLength(base64Image, 'base64') / (1024*1024) > 8) throw new Error('Image too large');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }], generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens } }) });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini: ${res.status} ${t.slice(0,300)}`); }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

// ===== COUNCIL =====
// `members` is a list of { model, temperature } seats — each speaks at its own
// temperature so the council produces genuinely different takes to synthesise.
const runCouncilWithWhip = async (members, messages, whipMs, quorum, tokenLimit) => {
  const results = [];
  let settledCount = 0, validCount = 0, resolved = false;
  return new Promise((resolve) => {
    const whipTimer = setTimeout(() => { if (!resolved) { resolved = true; resolve(results); } }, whipMs);
    const checkDone = () => { if (resolved) return; if (validCount >= quorum) { resolved = true; clearTimeout(whipTimer); resolve(results); return; } if (settledCount >= members.length) { resolved = true; clearTimeout(whipTimer); resolve(results); } };
    members.forEach(({ model, temperature }) => { callModel(model, messages, temperature, whipMs, tokenLimit).then((content) => { settledCount++; const trimmed = (content || '').trim(); const isSkip = /^skip[.!]?$/i.test(trimmed); if (isSkip) { console.log(`[COUNCIL] ${model} SKIP`); } else if (trimmed.length > 3) { validCount++; results.push({ model, content }); } checkDone(); }).catch((e) => { console.error(`[COUNCIL] ${model} failed: ${e.message}`); settledCount++; checkDone(); }); });
  });
};

// ===== ROUTER =====
// Anchored, and matching the whole message. The previous pattern was an
// unanchored alternation, so any short message merely *containing* one of these
// fragments was routed to the greeting path — "which one?" matches "hi",
// "you sure?" matches "yo", "summary?" matches "sup".
const GREETING_RE = /^(hi|hello|hey|yo|sup|howdy|gm|good (morning|afternoon|evening))\b[\s!.,?]*$/i;

const classifyRequest = (text, userPlan) => {
  const members = userPlan === 'pro' ? COUNCIL : FREE_COUNCIL;
  if (GREETING_RE.test(text.trim())) return { members: [], quorum: 0, whipMs: 5000, tokenLimit: 200, category: 'greeting' };
  return { members, quorum: Math.min(3, members.length), whipMs: 30000, tokenLimit: 2000, category: 'council' };
};

// ===== MEMORY DETECTION =====
const isMemoryOrReferenceQuestion = async (text) => {
  const response = await callModel(FAST_MODEL, [{ role: 'system', content: 'Is this question asking about a previous conversation or referencing something discussed earlier? Reply ONLY "YES" or "NO".' }, { role: 'user', content: text.slice(0, 500) }], 0.0, 3000, 10);
  return response.trim().toUpperCase().startsWith('YES');
};

// ===== SEARCH DECISION =====
// The region reaches the QUERY, not just the answer. A prompt hint makes the
// model *phrase* prices differently; it cannot make a search API return a
// local retailer it was never asked for. "OLED monitor price" returns US shops
// to everyone — "OLED monitor price UAE" does not, and that is the difference
// between a converted number and an actual place to buy the thing.
//
// Only where it helps: a query about tax law or a person is not improved by a
// country appended to it, so the model is told to use it when the answer is
// local and to leave it alone otherwise.
const getSearchQuery = async (text, convSummary, region) => {
  const userContent = convSummary ? `Context: ${convSummary}\n\nQuestion: ${text}` : text;
  const locale = region
    ? ` The user appears to be in ${region.place}. If — and only if — the answer depends on where they are (prices, availability, retailers, local services, regulations), include that country in the query. Otherwise ignore it.`
    : '';
  const response = await callModel(FAST_MODEL, [{ role: 'system', content: `Analyze the prompt. If it needs real-time web search (products, facts, reviews, specs, prices), reply ONLY with the optimal search query. If not, reply ONLY "NO". Memory/reference questions do NOT need search.${locale}` }, { role: 'user', content: userContent }], 0.0, 4000, 50);
  const trimmed = response.trim();
  if (trimmed.toUpperCase() === 'NO' || !trimmed) return null;
  return trimmed;
};

// ===== CLASSIFIERS =====
const wantsDetailedAnswer = (text) => ['explain in detail','detailed','in depth','comprehensive','thorough','step by step','deep dive','elaborate','full explanation','essay','write a'].some(t => text.toLowerCase().includes(t));
const needsWikiCheck = (text) => /what is|who is|history|explain|definition|meaning of|tell me about|biography|born|origin/i.test(text);
const detectLanguage = (text) => {
  if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
  if (/[\u4e00-\u9fff]/.test(text)) return 'Chinese';
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u0400-\u04FF]/.test(text)) return 'Russian';
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text)) return 'French';
  if (/[äöüß]/i.test(text)) return 'German';
  if (/[ñ¿áéíóú]/i.test(text)) return 'Spanish';
  return 'English';
};

// ===== CACHES =====
const searchCache = new Map();
const getCachedSearch = (q) => { const c = searchCache.get(q); if (c && (Date.now()-c.timestamp) < 300000) return c.data; if (c) searchCache.delete(q); return null; };
const setCachedSearch = (q, d) => { if (searchCache.size >= 50) { const k = searchCache.keys().next().value; searchCache.delete(k); } searchCache.set(q, { data: d, timestamp: Date.now() }); };

// ===== SEARCH FUNCTIONS =====
const searchBrave = async (query) => {
  if (!BRAVE_API_KEY) return [];
  try { const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query.slice(0,200))}&count=10`, { method: 'GET', headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY }, signal: AbortSignal.timeout(8000) }); if (!res.ok) return []; const data = await res.json(); return (data.web?.results || []).map(r => ({ title: r.title?.slice(0,200)||'', url: r.url, description: r.description?.slice(0,500)||'' })); } catch { return []; }
};
const searchTavily = async (query) => {
  if (!TAVILY_API_KEY) return { answer: '', results: [], images: [] };
  try { const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query.slice(0,400), search_depth: 'advanced', include_answer: true, include_raw_content: false, include_images: true, include_image_descriptions: true, max_results: 5 }), signal: AbortSignal.timeout(7000) }); if (!res.ok) return { answer: '', results: [], images: [] }; const data = await res.json(); return { answer: data.answer||'', results: (data.results||[]).map(r => ({ title: r.title?.slice(0,200)||'', url: r.url, content: (r.content||'').slice(0,3000) })), images: (data.images||[]).map(img => typeof img === 'string' ? img : (img.url||img)) }; } catch { return { answer: '', results: [], images: [] }; }
};
const searchGoogleWeb = async (query) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  try { const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0,200))}&num=10`, { signal: AbortSignal.timeout(8000) }); if (!res.ok) return []; const data = await res.json(); return (data.items||[]).map(r => ({ title: r.title?.slice(0,200)||'', url: r.link, description: (r.snippet||'').slice(0,500) })); } catch { return []; }
};
const searchGoogleImages = async (query) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  try { const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0,200))}&searchType=image&num=5`, { signal: AbortSignal.timeout(8000) }); if (!res.ok) return []; const data = await res.json(); return (data.items||[]).map(r => ({ url: r.link, title: r.title?.slice(0,200)||'' })); } catch { return []; }
};
const readPageContent = async (url) => {
  // extractPageSignal, not slice(0, 3000). A retail page's markdown spends its
  // first few thousand characters on nav, breadcrumbs and marketing, so a flat
  // truncation cut the price off — which produced a real answer saying three
  // UAE retailers "did not display a price" when all three did. See
  // lib/page-extract.js.
  try { const headers = { 'Accept': 'text/markdown' }; if (JINA_API_KEY) headers['Authorization'] = `Bearer ${JINA_API_KEY}`; const res = await fetch(`https://r.jina.ai/${url}`, { method: 'GET', headers, signal: AbortSignal.timeout(6000) }); if (!res.ok) return ''; return extractPageSignal(await res.text()); } catch { return ''; }
};
const searchWikipedia = async (query) => {
  try { const sr = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query.slice(0,100))}&format=json&origin=*`, { signal: AbortSignal.timeout(6000) }); if (!sr.ok) return ''; const sd = await sr.json(); const titles = (sd.query?.search||[]).slice(0,2).map(s => s.title); if (titles.length === 0) return ''; const er = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`, { signal: AbortSignal.timeout(6000) }); if (!er.ok) return ''; const ed = await er.json(); return Object.values(ed.query?.pages||{}).map(p => p.extract||'').filter(e => e.length > 100).join('\n\n').slice(0, 5000); } catch { return ''; }
};

/**
 * Open the SSE stream, at most once.
 *
 * Idempotent because the agent loop opens the stream BEFORE the answer exists
 * — it has tool progress to report and hiding that behind a spinner for up to
 * 25s would be worse than what the router path does today. Every later branch
 * (fallback, synthesis) then reaches its own open call with headers already
 * sent, and setHeader after send throws ERR_HTTP_HEADERS_SENT.
 */
const openStream = (res) => {
  if (res.headersSent) return;
  // Stamped once, on the first open. Every route that streams calls this, so
  // it is the one place that reliably marks "the user stopped waiting".
  if (!res.locals) res.locals = {};
  res.locals.firstByteAt = Date.now();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Nginx and Render's proxy both buffer by default, which holds every event
  // until the response completes — precisely defeating the point of streaming
  // progress. Without this the trail arrives all at once, at the end.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
};

/** One SSE frame. Never throws: a dead socket must not become a 500. */
const sendEvent = (res, payload) => {
  if (res.writableEnded) return;
  try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* client went away */ }
};

// ===== COUNCIL TOOL CALLING =====
// docs/superpowers/specs/2026-07-31-council-tool-calling-design.md
const { buildRegistry } = require('./lib/tool-registry');
const { runAgentLoop } = require('./lib/agent-loop');
const { assertSafeUrl } = require('./lib/url-guard');
const { checkLinks } = require('./lib/link-check');
const { extractPageSignal } = require('./lib/page-extract');
const { detectRegion, regionHint } = require('./lib/region');
const { firstWithResults, toolMessages, summariseProbe } = require('./lib/council-tools');
const { parseToolRequests } = require('./lib/tool-protocol');
const { prepareUpload, UploadRejected, MAX_FILES_PER_CHAT } = require('./lib/file-intake');

/**
 * A file store bound to ONE (user, chat).
 *
 * The binding is the security property: read_file's signature has nowhere to
 * name a different user or chat, so a model cannot ask for someone else's file
 * — not because the code checks, but because there is no parameter for it.
 *
 * Both queries filter on user_id AND chat_id. The service-role key bypasses
 * RLS, so these predicates are the control that actually runs.
 */
// Validating the shape keeps a malformed value from reaching Postgres and
// coming back as a 500 that reads like a server fault. requireOwnership does
// this for its own :id; these are the params it does not cover.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (name = 'id') => (req, res, next) =>
  UUID_RE.test(req.params[name] || '') ? next() : res.status(400).json({ error: 'Invalid ID' });

const fileStoreFor = (userId, chatId) => ({
  list: async () => {
    const { data } = await supabase.from('chat_files').select('id,name,kind,bytes').eq('user_id', userId).eq('chat_id', chatId).order('created_at', { ascending: true }).limit(MAX_FILES_PER_CHAT);
    return data || [];
  },
  get: async (id) => {
    const { data } = await supabase.from('chat_files').select('id,name,kind,bytes,content,truncated').eq('id', id).eq('user_id', userId).eq('chat_id', chatId).maybeSingle();
    return data || null;
  },
});

// Off unless explicitly enabled. The router path is untouched, so a bad turn is
// one env var away from reverted without a deploy.
/**
 * COUNCIL_TOOLS has three settings, not two:
 *
 *   unset / 0   off. The router path, untouched.
 *   shadow      run ONE probe round with the real tool prompt, log what came
 *               back, throw it away, and answer from the plain council. The
 *               user sees no difference at all.
 *   1           live.
 *
 * `shadow` exists because the loop is fully tested against fakes and fakes
 * cannot answer the only question that decides whether this is safe to turn
 * on: do these models, on this gateway, actually emit a parseable ```tool_call
 * block? If they do not, the live loop silently degrades into the router path
 * at three rounds of cost, and nothing in the logs would say so.
 *
 * The probe runs CONCURRENTLY with the real council, so it adds no latency —
 * only tokens. Turn it on for a day, read the [PROBE] lines, then decide.
 */
const TOOLS_MODE = (process.env.COUNCIL_TOOLS || '').toLowerCase();
const TOOLS_ENABLED = TOOLS_MODE === '1' || TOOLS_MODE === 'true';
const TOOLS_SHADOW = TOOLS_MODE === 'shadow';

// Cached because members in the same turn ask overlapping questions across
// ROUNDS as well as within one — dedupe only unions a single round.
/**
 * Fetch just enough of a page to tell whether it is still a page.
 *
 * GET rather than HEAD: a soft 404 answers HEAD with a cheerful 200, and the
 * evidence that it is not a real page is in the <title>. The body is capped at
 * 16KB and the reader is cancelled once <head> is through — enough for the
 * title on every real site, and it never pulls a whole product page.
 */
const fetchPageHead = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      // Some CDNs serve a bot-check page to an unfamiliar agent, which would
      // read as a soft 404. Ask like a browser.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ALOP-AI link check)', 'Accept': 'text/html,*/*' },
    });
    let html = '';
    const type = res.headers.get('content-type') || '';
    if (type.includes('html') && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (html.length < 16384) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      reader.cancel().catch(() => {});
    }
    return { status: res.status, finalUrl: res.url || url, html };
  } finally {
    clearTimeout(timer);
  }
};

const checkSearchLinks = (urls) => checkLinks(urls, { fetchPage: fetchPageHead, assertSafeUrl });

const toolSearch = async (query) => {
  const cached = getCachedSearch(`tool:${query}`);
  if (cached) return cached;
  const results = await firstWithResults([searchBrave, searchTavily, searchGoogleWeb], query);
  if (results.length) setCachedSearch(`tool:${query}`, results);
  return results;
};

// ===== COMPREHENSIVE SEARCH =====
const comprehensiveSearch = async (query, needsWiki) => {
  const cached = getCachedSearch(query); if (cached) return cached;
  const [tavilyResult, braveResults, googleResults, googleImages, wikiContent] = await Promise.all([searchTavily(query), searchBrave(query), searchGoogleWeb(query), searchGoogleImages(query), needsWiki ? searchWikipedia(query) : Promise.resolve('')]);
  const td = Array.isArray(tavilyResult) ? { answer:'',results:[],images:[] } : tavilyResult;
  const sources = [], allImages = []; let ctx = '';
  if (td.answer) ctx += `TAVILY ANSWER: ${td.answer}\n\n---\n\n`;
  if (td.results?.length > 0) { ctx += `TAVILY RESULTS:\n${td.results.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join('\n\n---\n\n')}\n\n---\n\n`; td.results.forEach(r => sources.push({title:r.title,url:r.url})); }
  if (td.images?.length > 0) allImages.push(...td.images.filter(u => u && u.startsWith('http')));
  if (braveResults.length > 0) { ctx += `BRAVE:\n${braveResults.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.description}`).join('\n\n---\n\n')}\n\n---\n\n`; braveResults.forEach(r => { if (!sources.find(s => s.url === r.url)) sources.push({title:r.title,url:r.url}); }); }
  if (googleResults.length > 0) { ctx += `GOOGLE:\n${googleResults.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.description}`).join('\n\n---\n\n')}\n\n---\n\n`; googleResults.forEach(r => { if (!sources.find(s => s.url === r.url)) sources.push({title:r.title,url:r.url}); }); }
  if (googleImages.length > 0) allImages.push(...googleImages.map(img => img.url).filter(u => u && u.startsWith('http')));
  if (wikiContent) ctx += `WIKIPEDIA:\n${wikiContent}\n\n---\n\n`;
  if (sources.length > 0) { const pc = await readPageContent(sources[0].url); if (pc.length > 200) ctx += `FULL PAGE (${sources[0].url}):\n${pc}\n\n---\n\n`; }
  if (allImages.length > 0) { const unique = [...new Set(allImages)].slice(0,5); ctx += `IMAGES:\n${unique.map((u,i) => `IMAGE ${i+1}: ${u}`).join('\n')}\n\n---\n\n`; }
  const found = sources.length > 0 || !!wikiContent || !!td.answer;
  const result = { context: ctx.trim(), sources, found, images: allImages };
  setCachedSearch(query, result); return result;
};

// ===== MEMORY =====
// Scoped to one chat. This used to live on the users table, so a single summary
// was shared by every conversation a user had and context leaked between
// unrelated chats. Requires migrations/001_per_chat_memory.sql; if that has not
// been run the select fails, the catch logs it, and the app simply runs without
// memory rather than erroring.
const updateChatSummary = async (chatId, userMsg, assistantMsg) => {
  if (!chatId) return;
  try {
    const { data: existing, error: selErr } = await supabase.from('chats').select('conversation_summary').eq('id', chatId).single();
    // PGRST116 just means no row. Anything else (typically the column not existing
    // because 001_per_chat_memory.sql has not been run) means the write cannot land,
    // so bail before spending a model call on a summary with nowhere to go.
    if (selErr && selErr.code !== 'PGRST116') { console.error('[MEMORY] Unavailable, skipping:', selErr.message); return; }
    const prev = existing?.conversation_summary || '';
    const u = userMsg.slice(0, 800); const a = assistantMsg.slice(0, 800);
    const newSummary = prev
      ? await callModel(FAST_MODEL, [{ role: 'system', content: 'Compress previous summary and new exchange into 2-3 sentences. Reply ONLY with the summary.' }, { role: 'user', content: `Previous:\n${prev}\n\nNew:\nUser: ${u}\nAssistant: ${a}` }], 0.0, 4000, 200)
      : await callModel(FAST_MODEL, [{ role: 'system', content: 'Summarize in 1-2 sentences. Reply ONLY with the summary.' }, { role: 'user', content: `User: ${u}\nAssistant: ${a}` }], 0.0, 4000, 150);
    if (newSummary.trim()) {
      // supabase-js resolves rather than throws on failure, so an unchecked update
      // logged "Saved." even when nothing was written.
      const { error: updErr } = await supabase.from('chats').update({ conversation_summary: newSummary.trim().slice(0, 2000) }).eq('id', chatId);
      if (updErr) console.error('[MEMORY] Save failed:', updErr.message);
      else console.log('[MEMORY] Saved.');
    }
  } catch (e) { console.error('[MEMORY] Failed:', e.message); }
};

const readChatSummary = async (chatId, userId) => {
  if (!chatId) return '';
  try {
    const { data } = await supabase.from('chats').select('conversation_summary').eq('id', chatId).eq('user_id', userId).single();
    return data?.conversation_summary || '';
  } catch { return ''; }
};

// Feedback lives in its own table and is read back as explicit guidance. It was
// previously appended onto conversation_summary, where coaching notes and
// conversation facts fought over the same 2000 characters and corrupted both.
const getFeedbackGuidance = async (userId) => {
  try {
    const { data } = await supabase.from('feedback_notes').select('kind,note').eq('user_id', userId).order('created_at', { ascending: false }).limit(6);
    if (!data || data.length === 0) return '';
    const good = data.filter(n => n.kind === 'up').map(n => `- ${n.note}`);
    const avoid = data.filter(n => n.kind === 'down').map(n => `- ${n.note}`);
    let out = '';
    if (good.length) out += `This user has responded well to:\n${good.join('\n')}\n`;
    if (avoid.length) out += `This user has reacted badly to:\n${avoid.join('\n')}`;
    return out.trim();
  } catch { return ''; }
};

// ===== MIDDLEWARE =====
// The allowlist is host-parsed, not substring-matched — see lib/origin-guard.js
// for the two ways the previous `origin.includes('.vercel.app')` was wrong.
// Preview deployments need ALLOWED_ORIGIN_SUFFIXES set; an unset variable
// deliberately grants nothing.
const { isOriginAllowed, originPolicyFromEnv } = require('./lib/origin-guard');
const originPolicy = originPolicyFromEnv();
if (!originPolicy.exact.length && !originPolicy.allowAll) console.warn('[BOOT] FRONTEND_URL not set — every cross-origin browser request will be refused.');
app.use(cors({ origin: (origin, cb) => isOriginAllowed(origin, originPolicy) ? cb(null, true) : cb(new Error(`CORS: ${origin}`)), credentials: true, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Requested-With'], maxAge: 86400 }));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'", process.env.FRONTEND_URL, 'https://*.clerk.com', 'https://*.stripe.com'], scriptSrc: ["'self'", "'unsafe-inline'", 'https://*.clerk.com'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://image.pollinations.ai'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], frameAncestors: ["'none'"], formAction: ["'self'", 'https://*.stripe.com'], upgradeInsecureRequests: [] } }, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }, referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, xContentTypeOptions: true, xFrameOptions: 'DENY', xPermittedCrossDomainPolicies: 'none' }));
// clientFingerprint used to be computed here and used as the rate-limit key.
// It hashed the User-Agent, so it was not an identity — it was a bucket the
// caller could change at will. Nothing derives from a client-chosen header now.
app.use((req, res, next) => { req.requestId = crypto.randomUUID(); next(); });

app.post('/api/stripe/webhook', requireStripe, express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']; if (!sig) return res.status(400).send('Missing sig');
  let event; try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { Sentry.captureException(err); return res.status(400).send(`Webhook: ${err.message}`); }

  // Stripe retries on any non-2xx and can deliver the same event more than
  // once even on success — at-least-once, by design. Every handler below was
  // replay-safe by luck rather than by construction (they all set a field to a
  // fixed value), and "the current handlers happen to be idempotent" is not a
  // property that survives someone adding a credit grant. Claim the event id
  // first; a duplicate insert means we have already processed it.
  //
  // Failing OPEN on an insert error is deliberate: if the ledger is unreachable
  // the worse outcome is re-applying a plan change, not silently dropping a
  // paid subscription.
  try {
    const { error: dupe } = await supabase.from('stripe_events').insert({ id: event.id, type: event.type });
    if (dupe && dupe.code === '23505') return res.json({ received: true, duplicate: true });
    if (dupe) console.error('[stripe] event ledger unavailable, processing anyway:', dupe.message);
  } catch (e) { console.error('[stripe] event ledger threw, processing anyway:', e.message); }

  try { if (event.type === 'checkout.session.completed') { const s = event.data.object; const email = s.customer_email || s.customer_details?.email; if (email) await supabase.from('users').update({ plan:'pro', stripe_customer_id: s.customer, stripe_subscription_id: s.subscription }).eq('email', email.toLowerCase()); } if (event.type === 'invoice.paid') await supabase.from('users').update({ plan:'pro' }).eq('stripe_customer_id', event.data.object.customer); if (['customer.subscription.deleted','customer.subscription.updated'].includes(event.type)) { const sub = event.data.object; await supabase.from('users').update({ plan: sub.status === 'active' ? 'pro' : 'free' }).eq('stripe_subscription_id', sub.id); } res.json({ received: true }); } catch (err) { Sentry.captureException(err); res.status(500).send('Webhook failed'); }
});

app.use(compression());
app.use(timeout('300s'));
app.use((req, res, next) => { if (req.timedout) return res.status(503).json({ error: 'Timeout' }); next(); });

// The key must not contain anything the caller chooses. It used to hash the
// User-Agent in, which handed every caller unlimited buckets — see
// lib/rate-limit-key.js. `ipKeyGenerator` is express-rate-limit's own, and is
// IPv6-aware: it collapses an address to its /56 so one client cannot walk its
// own prefix.
const { rateLimitKey } = require('./lib/rate-limit-key');
/**
 * The counter's home.
 *
 * Memory by default, which is correct on ONE instance and measurably wrong on
 * two: the default store is per-process, so "120 per minute" becomes 240 the
 * moment the service scales. Scaling on Render is a dropdown — no deploy, no
 * review, nothing that would flag it.
 *
 * Postgres is therefore built, tested and dormant. It costs a database round
 * trip per request, which one instance should not pay, so it is opt-in via
 * RATE_LIMIT_STORE=postgres. BEFORE SCALING TO MORE THAN ONE INSTANCE, set it
 * — migrations/004 creates the table and the atomic increment.
 */
const USE_PG_RATE_LIMIT = process.env.RATE_LIMIT_STORE === 'postgres';
const { PostgresStore } = require('./lib/pg-rate-limit-store');

const createLimiter = (windowMs, max, msg) => rateLimit({
  windowMs, max, message: { error: msg }, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => rateLimitKey(req, res, rateLimit.ipKeyGenerator),
  handler: (req, res) => { res.status(429).json({ error: msg }); },
  // A store instance per limiter, because each carries its own window.
  // The arrow defers dereferencing `supabase`, which is declared BELOW this
  // point — the limiters are registered before the client exists. It is only
  // called at request time, by which point the const is initialised. Passing
  // `supabase.rpc` directly here would throw at boot.
  ...(USE_PG_RATE_LIMIT ? { store: new PostgresStore({ rpc: (fn, args) => supabase.rpc(fn, args) }) } : {}),
});

// Every route is under a limit. The blanket /api/ limiter is the floor, and a
// route with its own limiter is subject to BOTH — the narrower one binds first.
// A route with no entry here is not unlimited, it inherits the floor; the
// entries below exist where the floor is too generous for what the call costs.
app.use('/api/', createLimiter(60000, 120, 'Too many requests.'));
app.use('/api/council', createLimiter(60000, 30, 'Too many council requests.'));
app.use('/api/quick', createLimiter(60000, 60, 'Too many quick requests.'));
app.use('/api/vision', createLimiter(60000, 10, 'Too many vision requests.'));
app.use('/api/overlay', createLimiter(60000, 30, 'Too many overlay requests.'));
app.use('/api/feedback', createLimiter(60000, 30, 'Too many feedback requests.'));
app.use('/api/image', createLimiter(60000, 10, 'Too many image requests.'));
app.use('/api/create-checkout-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/create-portal-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/admin/', createLimiter(60000, 60, 'Too many admin requests.'));
// Previously covered only by the /api/ floor. Chat writes hit the database on
// every call and the plan/price reads hit Clerk and Stripe, so 120/min each is
// more headroom than any real client uses.
app.use('/api/chats', createLimiter(60000, 60, 'Too many chat requests.'));
app.use('/api/user/', createLimiter(60000, 60, 'Too many requests.'));
app.use('/api/billing/', createLimiter(60000, 30, 'Too many billing requests.'));
// /health is outside /api/ and so had no limit at all. It is cheap, but an
// unlimited endpoint is still an unlimited endpoint.
app.use('/health', createLimiter(60000, 120, 'Too many requests.'));

// The 50 MB ceiling exists for image data URLs, and applied to EVERY route —
// so any endpoint could be made to buffer 50 MB per request. It now applies
// only where an image can legitimately arrive; everything else gets 1 MB.
// (The Stripe webhook is mounted above this with express.raw and is unaffected.)
const IMAGE_ROUTES = ['/api/council', '/api/vision', '/api/overlay', '/api/image'];
const bigJson = express.json({ limit: '50mb' });
const smallJson = express.json({ limit: '1mb' });
app.use((req, res, next) => (IMAGE_ROUTES.some((p) => req.path.startsWith(p)) ? bigJson : smallJson)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ===== SANITIZATION =====
const MAX_PROMPT = 100000, MAX_HISTORY = 20, ALLOWED_ROLES = ['user','assistant','system'];
const { buildChatUpdate, sanitizeString } = require('./lib/chat-update');
const { parseDataUrl } = require('./lib/data-url');
const truncatePrompt = (text, maxChars = 90000) => { if (text.length <= maxChars) return text; const h = Math.floor(maxChars/2); return text.slice(0,h) + '\n\n[...truncated...]\n\n' + text.slice(-h); };
const validatePrompt = (p) => { if (!p || typeof p !== 'string') return { valid: false, error: 'Prompt required' }; const t = p.trim(); if (!t) return { valid: false, error: 'Prompt empty' }; if (t.length > MAX_PROMPT) return { valid: false, error: `Exceeds ${MAX_PROMPT}` }; return { valid: true, value: t }; };
const validateHistory = (h) => { if (!h) return []; if (!Array.isArray(h)) return { valid: false, error: 'History must be array' }; if (h.length > MAX_HISTORY) return { valid: false, error: `Exceeds ${MAX_HISTORY}` }; return { valid: true, value: h.filter(m => m && typeof m === 'object').map(m => ({ role: ALLOWED_ROLES.includes(m.role) ? m.role : 'user', content: typeof m.content === 'string' ? m.content.slice(0, MAX_PROMPT) : '' })).slice(0, MAX_HISTORY) }; };

// ===== SUPABASE & CLERK =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
// clerk-sdk-node@5 ignores its own `onError` option: it calls next() with a bare Error
// that carries no status, so every rejected request used to surface as a 500 and the
// client could not tell an expired session from a server fault. Map the status here.
const clerkRequireAuth = ClerkExpressRequireAuth();
const requireAuth = (req, res, next) =>
  clerkRequireAuth(req, res, (err) => {
    if (!err) return next();
    // A missing/!invalid key is our misconfiguration, not the caller's problem — keep it a 500.
    if (/publishable key|secret key/i.test(err.message || '')) return next(err);
    return next(Object.assign(new Error('Authentication required'), { status: 401 }));
  });

/**
 * The user row, off the critical path wherever possible.
 *
 * This used to await THREE network round trips on every single request, in
 * series, before any work began: Clerk's getUser, a Supabase select, and a
 * Supabase update writing back a name and avatar that had almost never
 * changed. For an existing user — which is every request after their first —
 * two of those bought nothing the answer depended on.
 *
 * Now: look the row up first. If it exists, return it and refresh the profile
 * from Clerk in the BACKGROUND. Clerk is only awaited when the row is missing,
 * because an insert genuinely needs the email.
 *
 * `cached` lets a caller pass a row a middleware already fetched, removing the
 * select as well. checkSuspended runs on every council request and was
 * selecting the same row two lines earlier.
 *
 * The trade is that a name or avatar changed in Clerk shows up one request
 * late. That is the correct thing to be slightly stale about.
 */
const refreshProfile = async (userId) => {
  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
    const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
    await supabase.from('users').update({ email, name, avatar_url: clerkUser?.imageUrl || null }).eq('clerk_id', userId);
  } catch (e) {
    console.error('[USER] background profile refresh failed:', e.message);
  }
};

const ensureUser = async (userId, { cached } = {}) => {
  if (!userId) throw new Error('Missing userId');

  if (cached && cached.id) { refreshProfile(userId); return cached; }

  const { data: existing, error: selErr } = await supabase.from('users').select('*').eq('clerk_id', userId).single();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;
  if (existing) { refreshProfile(userId); return existing; }

  // First sight of this user. Clerk has to be awaited here — the insert needs
  // an email, and there is no row to fall back on.
  let clerkUser; try { clerkUser = await clerkClient.users.getUser(userId); } catch (e) { throw new Error(`Clerk failed: ${e.message}`); }
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
  const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
  const { data: created, error: insErr } = await supabase.from('users').insert({ clerk_id: userId, email, name, avatar_url: clerkUser?.imageUrl || null, plan: 'free' }).select().single();
  if (insErr) throw insErr; if (!created) throw new Error('Insert returned no data'); return created;
};

// Selects the WHOLE row and stashes it, because ensureUser was fetching the
// same row again two lines later. One select instead of two, on every
// authenticated request that carries this middleware.
const checkSuspended = async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); const { data: user, error } = await supabase.from('users').select('*').eq('clerk_id', req.auth.userId).single(); if (error && error.code !== 'PGRST116') throw error; if (user && user.suspended) return res.status(403).json({ error: 'Account suspended' }); req.userRow = user || null; req.userPlan = user?.plan || 'free'; next(); } catch (err) { Sentry.captureException(err); return res.status(500).json({ error: 'Verify failed' }); } };
const requireOwnership = (table, col = 'user_id') => async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); const user = await ensureUser(req.auth.userId); const id = req.params.id; if (!id || typeof id !== 'string') return res.status(400).json({ error: 'ID required' }); if (!/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ error: 'Invalid ID' }); const { data: resource, error } = await supabase.from(table).select(col).eq('id', id).single(); if (error || !resource) return res.status(404).json({ error: 'Not found' }); if (resource[col] !== user.id) return res.status(403).json({ error: 'No permission' }); req.resource = resource; next(); } catch (err) { Sentry.captureException(err); return res.status(500).json({ error: 'Ownership check failed' }); } };
// Selects `id` as well as `is_admin` so downstream handlers can record WHICH
// admin acted, and can compare against a :id param — both are Supabase user
// ids. req.auth.userId is a Clerk id and is not comparable to either.
const requireAdmin = async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); const { data: user, error } = await supabase.from('users').select('id,is_admin,suspended').eq('clerk_id', req.auth.userId).single(); if (error) throw error; if (!user || !user.is_admin) return res.status(403).json({ error: 'Admin only' }); if (user.suspended) return res.status(403).json({ error: 'Account suspended' }); req.adminUserId = user.id; next(); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: 'Admin check failed' }); } };
// ip_address was hardcoded to null, so the audit trail could say what happened
// and to whom but never from where — which is the column you want first when
// you are reading it at all.
const auditLog = async (userId, action, metadata = {}, ip = null) => { try { await supabase.from('audit_logs').insert({ user_id: userId, action, metadata, ip_address: ip || null, created_at: new Date().toISOString() }); } catch (e) { console.error('Audit failed:', e.message); } };

// ===== HEALTH =====
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== COUNCIL =====
app.post('/api/council', requireAuth, checkSuspended, async (req, res) => {
  // Wall-clock to the point where the first byte of an answer starts streaming.
  // Everything before that is the user watching nothing happen, and until now
  // it was invisible: the only latency anyone could see was the total, which
  // mixes it with however long the model took to write. `council.tools` records
  // it so the admin console can report it without a log dashboard.
  const t0 = Date.now();
  try {
    const user = await ensureUser(req.auth.userId, { cached: req.userRow });
    const { message, history = [], chatId, image } = req.body;
    const pv = validatePrompt(message);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    const hv = validateHistory(history);
    if (!hv.valid && hv.error) return res.status(400).json({ error: hv.error });

    const userPlan = user.plan || 'free';
    const isDetailed = wantsDetailedAnswer(pv.value);
    const lang = detectLanguage(pv.value);
    const selection = classifyRequest(pv.value, userPlan);
    const truncatedPrompt = truncatePrompt(pv.value);
    const histArr = Array.isArray(hv) ? hv : (hv.value || []);

    const [convSummary, feedbackGuidance] = await Promise.all([readChatSummary(chatId, user.id), getFeedbackGuidance(user.id)]);

    // VISION. The council speaks to a text model, so an attached image is
    // described first and the description travels as context — the same shape
    // /api/overlay uses.
    //
    // Every failure below is returned to the caller rather than swallowed. The
    // overlay skips vision silently on error, which means it answers as though
    // no image were attached; that is a worse lie than showing an error, because
    // the user cannot tell the difference between "didn't look" and "looked and
    // saw nothing".
    let imageContext = '';
    if (image) {
      const parsed = parseDataUrl(image);
      if (!parsed) return res.status(400).json({ error: 'Attached image must be a base64-encoded PNG, JPEG, WebP or GIF under 8 MB.' });
      if (!GOOGLE_API_KEY) return res.status(503).json({ error: 'Image analysis is not configured on this server.' });
      try {
        const visionModel = userPlan === 'pro' ? 'gemini-2.5-pro-preview-05-06' : 'gemini-2.5-flash-preview-05-06';
        imageContext = await callGeminiVision(visionModel, 'Describe this image thoroughly. Include any text, code, UI elements, data and errors visible in it.', parsed.base64, parsed.mime, 1024);
      } catch (e) {
        console.error('[COUNCIL] Vision failed:', e.message);
        return res.status(502).json({ error: "Couldn't analyse the attached image. Try again, or send the message without it." });
      }
      if (!imageContext.trim()) return res.status(502).json({ error: "Couldn't read anything from the attached image." });
      console.log(`[COUNCIL] Vision: ${parsed.mime}, ${Math.round(parsed.bytes / 1024)}KB`);
    }

    // Injected into every prompt path below, so memory and learned preferences
    // stay in lockstep instead of each call site assembling its own context.
    // Where the user probably is, from what the browser already volunteers —
    // no IP lookup, no third-party service, nothing stored. It is the last
    // system message so it is the weakest thing in the stack: an inferred
    // location must never outrank what the user actually asked for.
    const region = detectRegion({
      cdnCountry: req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'],
      timezone: sanitizeString(req.body.timezone, 64),
      acceptLanguage: req.headers['accept-language'],
    });

    const contextMsgs = [
      ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convSummary}` }] : []),
      ...(feedbackGuidance ? [{ role: 'system', content: `USER PREFERENCES, learned from their past ratings. Honour these unless they conflict with accuracy:\n${feedbackGuidance}` }] : []),
      ...(imageContext ? [{ role: 'system', content: `THE USER ATTACHED AN IMAGE. This is what it shows — treat it as something you can see, and answer with reference to it:\n${imageContext}` }] : []),
      ...(region ? [{ role: 'system', content: regionHint(region) }] : []),
    ];

    console.log(`[COUNCIL] ${user.email} | ${userPlan} | ${selection.category} | Mem: ${convSummary ? 'Y' : 'N'} | Lang: ${lang} | Region: ${region ? `${region.country} via ${region.source}` : 'unknown'}`);

    /* THE SHADOW PROBE RUNS HERE, ABOVE THE ROUTER — and that placement is the
     * whole point of it.
     *
     * It was originally inside step 4 alongside the live loop, which is where
     * the live loop belongs and is exactly the wrong place for a probe. Steps
     * 0 through 3 all `return`, so step 4 is reached only when the router
     * decided the question needed no memory lookup, no greeting, NO SEARCH and
     * no Wikipedia. For any substantive question the search branch returns
     * first, so the probe never ran — [COUNCIL] appeared in the logs on every
     * request and [PROBE] appeared on almost none.
     *
     * That is also the more useful measurement. The question worth answering is
     * "would these models emit a tool call for the things people actually
     * ask?", and the things people actually ask are precisely the ones the
     * router sends to search. Sampling only the leftovers would have measured
     * the wrong population and looked like a clean result.
     *
     * Fire-and-forget: nothing awaits it, it cannot delay the answer or fail
     * the turn, and Node finishes the promise after the response has been sent.
     * Greetings and image turns are skipped — a greeting has nothing to
     * research, and an image turn is not a path the live loop ever takes. */
    if (TOOLS_SHADOW && !imageContext && selection.category !== 'greeting' && selection.members.length) {
      const probeSys = `You are an elite AI expert in the ALOP-AI Council. If you answer, be direct. Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
      const probeMsgs = [{ role: 'system', content: probeSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: truncatedPrompt }];
      const probeRegistry = buildRegistry({ search: toolSearch, readUrl: readPageContent, assertSafeUrl, checkLinks: checkSearchLinks });

      Promise.all(
        selection.members.map(async ({ model }) => {
          try {
            const raw = await callModel(model, toolMessages(probeMsgs, probeRegistry, { round: 1, isFinalRound: false }), 0.0, selection.whipMs, selection.tokenLimit);
            return { member: model, ...parseToolRequests(raw) };
          } catch (err) {
            return { member: model, calls: [], text: '', error: err.message };
          }
        }),
      ).then((replies) => {
        const s = summariseProbe(replies);
        console.log(`[PROBE] ${s.verdict} | category=${selection.category} members=${s.members} failed=${s.failed} emitted=${s.emitted} unparsed=${s.unparsed} tools=${JSON.stringify(s.byTool)}`);
        if (s.sample) console.log(`[PROBE] unparsed sample: ${s.sample.replace(/\s+/g, ' ').slice(0, 300)}`);
      }).catch((err) => console.error('[PROBE] failed:', err.message));
    }

    // 0. MEMORY BYPASS
    // Skipped when an image is attached: this branch and the greeting one below
    // build their own message arrays and never read contextMsgs, so routing here
    // would drop the image description on the floor. An attached image also means
    // the user wants that image looked at, not a recap.
    /* THE TWO ROUTER CALLS RUN TOGETHER, not one after the other.
     *
     * Both are FAST_MODEL round trips to the gateway and both take only inputs
     * that exist before either runs. In series they were the first two things
     * on the critical path of every message, and nothing could start until both
     * had returned.
     *
     * The trade, stated plainly: a memory question now also pays for a search
     * decision it will not use. That is one call to a fast model with a
     * 50-token ceiling, on a minority of turns, against a full round trip saved
     * on the majority. Worth it — but it IS a real cost, not a free win.
     *
     * Not awaited here. Each branch awaits the one it needs, so a memory
     * question never blocks on the search decision finishing. */
    const memoryP = imageContext ? Promise.resolve(false) : isMemoryOrReferenceQuestion(pv.value).catch(() => false);
    const searchQueryP = imageContext ? Promise.resolve(null) : getSearchQuery(pv.value, convSummary, region).catch(() => null);

    if (await memoryP) {
      console.log('[COUNCIL] Memory question.');
      const memSys = `You are ALOP-AI. The user is asking about a previous conversation. The history below IS your memory. Do NOT say you can't remember. Reference what was discussed. Be concise.${convSummary ? `\n\nSummary: ${convSummary}` : ''}`;
      const memMsgs = [{ role: 'system', content: memSys }, ...histArr.slice(-10), { role: 'user', content: pv.value }];
      openStream(res);
      await streamModel(res, PRIMARY_MODEL, memMsgs, 0.0);
      if (!res.writableEnded) res.end();
      updateChatSummary(chatId,pv.value, 'Answered memory question.').catch(() => {});
      await auditLog(user.id, 'council', { category: 'memory' }, req.ip);
      return;
    }

    // 1. GREETING (see the note above on why an image skips this)
    if (!imageContext && selection.category === 'greeting') {
      console.log('[COUNCIL] Greeting.');
      const greetMsgs = [{ role: 'system', content: `You are ALOP-AI. Greet briefly.${convSummary ? ` Context: ${convSummary}` : ''}` }, { role: 'user', content: pv.value }];
      openStream(res);
      await streamModel(res, PRIMARY_MODEL, greetMsgs, 0.0);
      if (!res.writableEnded) res.end();
      await auditLog(user.id, 'council', { category: 'greeting' }, req.ip);
      return;
    }

    // 2. SEARCH
    // Started above, alongside the memory check. By the time control reaches
    // here it has usually already resolved, so this await is free.
    const searchQuery = await searchQueryP;
    const shouldCheckWiki = needsWikiCheck(pv.value);

    if (searchQuery) {
      const { context, sources, found, images } = await comprehensiveSearch(searchQuery, shouldCheckWiki);
      if (!found) {
        openStream(res);
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: "I searched but couldn't find results. Could you rephrase?" })}\n\n`);
        res.write('data: [DONE]\n\n');
        if (!res.writableEnded) res.end();
        await auditLog(user.id, 'council', { category: 'no_results' }, req.ip);
        return;
      }
      console.log(`[COUNCIL] ${sources.length} sources, ${context.length} chars.`);
      const extSys = `You are a precision data extraction engine. Use ONLY the provided data.\n\nRULES:\n1. Only state facts from the data.\n2. No training data.\n3. No inferring/guessing.\n4. No comparing unless both products are in data.\n5. If not in data, say "I couldn't find this in the search results."\n6. Include URLs as Markdown: [Title](URL)\n7. No inventing specs/prices.\n8. Note contradictions between sources.\n9. Format in Markdown. Match answer length to question. Be concise for simple questions.\n10. List sources at bottom under "## Sources".\n11. Embed images if provided: ![Description](url)\n12. CONVERSATION CONTEXT and history are EXEMPT from rules 1-5.${lang !== 'English' ? `\n13. Respond in ${lang}.` : ''}`;
      const extMsgs = [{ role: 'system', content: extSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: `${truncatedPrompt}\n\n=== SEARCH DATA ===\n${context}` }];
      openStream(res);
      await streamModel(res, PRIMARY_MODEL, extMsgs, 0.0);
      if (!res.writableEnded) res.end();
      const lastA = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
      updateChatSummary(chatId,pv.value, lastA || 'Search response.').catch(() => {});
      await auditLog(user.id, 'council', { category: 'search', sources: sources.length }, req.ip);
      return;
    }

    // 3. WIKIPEDIA
    if (shouldCheckWiki) {
      const wiki = await searchWikipedia(pv.value);
      if (wiki) {
        const wikiSys = `You are a data extraction engine. Use ONLY the Wikipedia content. No training data. If not found, say "I couldn't find this on Wikipedia." Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
        const wikiMsgs = [{ role: 'system', content: wikiSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: `${truncatedPrompt}\n=== WIKIPEDIA ===\n${wiki}` }];
        openStream(res);
        await streamModel(res, PRIMARY_MODEL, wikiMsgs, 0.0);
        if (!res.writableEnded) res.end();
        updateChatSummary(chatId,pv.value, 'Wikipedia response.').catch(() => {});
        await auditLog(user.id, 'council', { category: 'wiki' }, req.ip);
        return;
      }
    }

    // 4. COUNCIL
    const councilSys = `You are an elite AI expert in the ALOP-AI Council. If outside your expertise, reply ONLY "SKIP". If you answer, be direct. Match response length to question complexity. Use Markdown. If context/history provided, use for continuity. ${isDetailed ? 'Be thorough.' : 'Be concise.'}${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
    const councilMsgs = [{ role: 'system', content: councilSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: truncatedPrompt }];

    // The agent loop, when enabled, replaces the single-shot council with
    // propose → dedupe → broadcast. It only ever runs HERE, after the router
    // decided no search was needed — which is exactly the gap it exists for: a
    // member that disagrees with that decision can now act on it, where before
    // the tools were present and the initiative was not.
    //
    // COUNCIL_TOOLS is off by default and the router path below is untouched,
    // so this ships dark and a bad turn is one env var from being reverted
    // without a deploy.
    let validResponses, toolResearch = '', toolTruncated = null;
    if (TOOLS_ENABLED && !imageContext) {
      // read_file is offered only when this conversation actually has files.
      // A tool that can only ever answer "no files" is a tool the council
      // wastes a round discovering is useless.
      const files = chatId ? fileStoreFor(user.id, chatId) : null;
      const attached = files ? await files.list() : [];
      const registry = buildRegistry({
        search: toolSearch,
        readUrl: readPageContent,
        assertSafeUrl,
        checkLinks: checkSearchLinks,
        ...(attached.length ? { files } : {}),
      });
      // Opened BEFORE the loop so tool progress can be reported as it happens.
      // The loop can run for 25s, and a spinner for 25s is worse than the
      // router path it replaced. From here on every failure is an SSE frame,
      // never a 500 — see the catch at the end of this route.
      openStream(res);
      const loop = await runAgentLoop({
        members: selection.members.map((m) => m.model),
        registry,
        onEvent: (e) => {
          console.log(`[TOOLS] r${e.round} ${e.type} ${e.name}${e.ok === false ? ' FAILED' : ''} — ${e.summary}`);
          sendEvent(res, e);
        },
        askMember: (model, ctx) =>
          callModel(model, toolMessages(councilMsgs, registry, { ...ctx, attachedFiles: attached }), 0.0, selection.whipMs, selection.tokenLimit),
      });
      toolResearch = loop.research;
      toolTruncated = loop.truncated;
      console.log(`[TOOLS] ${loop.rounds} round(s), ${loop.uniqueCallsUsed} unique call(s), ${Object.keys(loop.answers).length} answer(s)${loop.truncated ? ` — ${loop.truncated}` : ''}`);
      validResponses = Object.entries(loop.answers)
        .filter(([, content]) => content && !/^skip[.!]?$/i.test(content.trim()) && content.trim().length > 3)
        .map(([model, content]) => ({ model, content }));
      // A loop that produced nothing usable falls through to the plain council
      // rather than to the fallback: losing seven experts because the tool
      // round misfired is a worse answer than not having used tools at all.
      const fellBack = validResponses.length === 0;
      if (fellBack) {
        console.log('[TOOLS] no usable answers, falling back to the plain council.');
        validResponses = await runCouncilWithWhip(selection.members, councilMsgs, selection.whipMs, selection.quorum, selection.tokenLimit);
      }

      // Recorded, not just logged. The numbers that say whether this feature is
      // working — how many members asked for a tool, and how many UNIQUE calls
      // that collapsed to — only existed in stdout, which means they are
      // readable on a laptop with the Render dashboard open and nowhere else.
      // In audit_logs they survive log rotation, they aggregate, and the admin
      // console can answer "is the dedupe earning its place" from a phone.
      await auditLog(user.id, 'council.tools', {
        msToFirstByte: (res.locals?.firstByteAt || Date.now()) - t0,
        rounds: loop.rounds,
        uniqueCalls: loop.uniqueCallsUsed,
        members: selection.members.length,
        answered: Object.keys(loop.answers).length,
        usable: validResponses.length,
        fellBack,
        truncated: loop.truncated || null,
        // Which tools, so a tool that is never chosen is visible as such.
        tools: loop.toolResults.reduce((acc, { call }) => ({ ...acc, [call.name]: (acc[call.name] || 0) + 1 }), {}),
      }, req.ip);
    } else {
      validResponses = await runCouncilWithWhip(selection.members, councilMsgs, selection.whipMs, selection.quorum, selection.tokenLimit);
    }

    // 5. FALLBACK
    if (validResponses.length === 0) {
      console.log('[COUNCIL] Fallback.');
      const fbSys = `You are a helpful AI assistant. Answer directly. Match length to question. If you don't know, say "I don't have enough information." Don't guess. Use context if provided. Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
      const fbMsgs = [{ role: 'system', content: fbSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: truncatedPrompt }];
      openStream(res);
      await streamModel(res, PRIMARY_MODEL, fbMsgs, 0.0);
      if (!res.writableEnded) res.end();
      updateChatSummary(chatId,pv.value, 'Fallback response.').catch(() => {});
      await auditLog(user.id, 'council', { category: 'fallback' }, req.ip);
      return;
    }

    // 6. SYNTHESIS
    const synthSys = `You are the Chief Synthesiser for a panel of independent experts who answered the same question separately. Reconcile them — do not average them.

1. Where they agree, state it once, plainly.
2. Where they disagree on a FACT, say so and give the competing claims. Do not silently pick one.
3. Where they disagree on JUDGEMENT or approach, give the strongest version of each and say what would decide between them.
4. Prefer the more specific, better-supported answer — but never invent a justification for preferring it.
5. Introduce no fact that appears in none of the responses.
6. Never mention the panel, the experts, how many there were, or that synthesis happened. Write as a single voice.
7. Match length to the question's complexity. Do not pad.
8. Use Markdown.
9. End on the answer. No "Would you like help with anything else?", no "Let me know if...", no closing offer of further assistance. The user knows they can ask again.
10. If you are inferring rather than reporting — a price you did not see, a spec you are reasoning to, a substitute product — say so IN THE SAME SENTENCE. "Likely higher" without "I did not find a listed price" reads as a fact.${lang !== 'English' ? `\n11. Respond in ${lang}.` : ''}`;
    // Research and truncation reach the synthesiser, because the design's rule
    // is that a cut-short answer must be able to hedge rather than assert. A
    // truncated answer presented as a complete one is worse than a slow one.
    const researchBlock = toolResearch ? `\n\n=== RESEARCH GATHERED THIS TURN ===\n${toolResearch}` : '';
    const truncationBlock = toolTruncated
      ? `\n\n=== NOTE ===\nResearch was cut short: ${toolTruncated} Where the experts' claims rest on something that was not verified, say so plainly rather than asserting it.`
      : '';
    const synthMsgs = [{ role: 'system', content: synthSys }, { role: 'user', content: `Question: ${truncatedPrompt}\n\nResponses:\n${validResponses.map((r,i) => `[Expert ${i+1}]: ${r.content}`).join('\n\n')}${researchBlock}${truncationBlock}` }];
    openStream(res);
    await streamModel(res, PRIMARY_MODEL, synthMsgs, 0.0);
    if (!res.writableEnded) res.end();
    const lastA = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
    updateChatSummary(chatId,pv.value, lastA || validResponses[0]?.content?.slice(0,800) || 'Council response.').catch(() => {});
    await auditLog(user.id, 'council', { category: 'council', models: validResponses.length }, req.ip);
  } catch (err) {
    console.error('Council error:', err.message);
    Sentry.captureException(err);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    // The stream was already open, so a 500 is no longer available. Ending it
    // silently — which is what this used to do — leaves the client's reader to
    // hit `done` with no [DONE] and no error, and the frontend then SAVES the
    // empty accumulator as the answer. A failed turn became a blank assistant
    // message with no indication anything went wrong.
    //
    // The error text is the same one a pre-stream failure would have put in a
    // 500 body, so the client sees a failure either way.
    sendEvent(res, { type: 'error', text: err.message });
    if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
  }
});

// ===== OVERLAY (bulletproof — never returns 500) =====
app.post('/api/overlay', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId, { cached: req.userRow });
    const { prompt, image, history = [] } = req.body;
    const pv = validatePrompt(prompt);
    if (!pv.valid) return res.status(400).json({ error: pv.error });

    // Vision: only if API key set AND image provided AND not too large
    let ctx = '';
    if (image && typeof image === 'string' && image.startsWith('data:image/') && GOOGLE_API_KEY) {
      try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        if (Buffer.byteLength(base64Data, 'base64') / (1024*1024) < 8) {
          const vm = user.plan === 'pro' ? 'gemini-2.5-pro-preview-05-06' : 'gemini-2.5-flash-preview-05-06';
          ctx = await callGeminiVision(vm, 'Describe screen concisely. Include code, text, UI, errors.', base64Data, 'image/png', 1024);
        }
      } catch (e) { console.error('[OVERLAY] Vision skipped:', e.message); }
    }

    // Single model, fast and reliable
    const histArr = Array.isArray(history) ? history.slice(-4) : [];
    const overlayMsgs = [
      { role: 'system', content: 'You are ALOP-AI Overlay. Give concise answers. For coding, provide working code. If screen description provided, use it.' },
      ...histArr,
      { role: 'user', content: ctx ? `Screen: ${ctx}\n\nQuestion: ${pv.value}` : `Question: ${pv.value}` }
    ];

    let answer = '';
    try { answer = await callModel(PRIMARY_MODEL, overlayMsgs, 0.0, 15000, 800); }
    catch (e1) {
      console.error('[OVERLAY] glm-5.2 failed:', e1.message);
      try { answer = await callModel(FAST_MODEL, overlayMsgs, 0.0, 10000, 800); }
      catch (e2) { console.error('[OVERLAY] gemma4 failed:', e2.message); answer = "I couldn't process that. Please try again."; }
    }

        console.log('[OVERLAY] Answered. Vision:', !!ctx);
    res.json({ answer: answer || "No response." });
  } catch (err) {
    console.error('Overlay error:', err.message);
    Sentry.captureException(err);
    res.json({ answer: "Something went wrong. Please try again." });
  }
});

// ===== ADMIN CONSOLE =====
//
// A diagnostics console, not a shell. There is no subprocess anywhere in it —
// see lib/admin-commands.js for why that is the design rather than a
// limitation. It takes a command ID from a closed set and never a command.
//
// Four independent conditions, all required, enforced in lib/terminal-access.js:
// a Clerk session, is_admin, membership of TERMINAL_ADMINS, and a
// TERMINAL_SECRET header. Unset variables DISABLE it rather than relaxing to
// is_admin.
const { buildCommands } = require('./lib/admin-commands');
const { checkTerminalAccess, terminalConfig } = require('./lib/terminal-access');
const adminConsole = buildCommands({ supabase });

// Its own limiter, far tighter than the admin floor. The secret is the only
// guessable credential in the chain, and 10 attempts a minute makes guessing
// it arithmetically hopeless while leaving normal use unhindered.
const terminalLimiter = createLimiter(60000, 10, 'Too many console requests.');

/**
 * Every attempt — allowed or refused — is audited BEFORE the reply.
 *
 * The response is one generic 403 whatever failed. The specific reason goes to
 * the audit log only: telling a rejected caller which of the four conditions
 * they missed hands them a map of the lock, and the difference between "not an
 * admin" and "bad secret" tells an attacker exactly how far they have got.
 */
const requireTerminal = async (req, res, next) => {
  const clerkUserId = req.auth && req.auth.userId;
  let isAdmin = false;
  let userRow = null;
  try {
    const { data } = await supabase.from('users').select('id,is_admin').eq('clerk_id', clerkUserId || '').single();
    userRow = data;
    isAdmin = Boolean(data && data.is_admin);
  } catch { /* absent user is simply not an admin */ }

  const verdict = checkTerminalAccess({ clerkUserId, isAdmin, secret: req.get('x-terminal-secret') }, process.env);
  await auditLog(userRow ? userRow.id : null, verdict.allowed ? 'terminal.access' : 'terminal.denied', {
    reason: verdict.reason,
    clerkUserId: clerkUserId || null,
    command: sanitizeString(req.body && req.body.command, 40) || null,
    userAgent: sanitizeString(req.get('user-agent'), 120) || null,
  }, req.ip);

  if (!verdict.allowed) return res.status(403).json({ error: 'Not available.' });
  req.terminalUserId = userRow ? userRow.id : null;
  next();
};

app.get('/api/admin/console', requireAuth, terminalLimiter, requireTerminal, (req, res) => {
  res.json({ commands: adminConsole.list() });
});

app.post('/api/admin/console', requireAuth, terminalLimiter, requireTerminal, async (req, res) => {
  const id = sanitizeString(req.body && req.body.command, 40);
  const out = await adminConsole.run(id);
  await auditLog(req.terminalUserId, 'terminal.run', { command: id, ok: out.ok }, req.ip);
  res.status(out.ok ? 200 : 400).json(out);
});

// ===== FILES =====
//
// Upload lives behind requireOwnership on the CHAT, so a file can only ever be
// attached to a conversation the caller already owns. That check is what makes
// fileStoreFor's (user, chat) binding meaningful — without it a caller could
// seed a file into someone else's chat for their council to read.
app.post('/api/chats/:id/files', requireAuth, checkSuspended, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { count } = await supabase.from('chat_files').select('id', { count: 'exact', head: true }).eq('chat_id', req.params.id).eq('user_id', user.id);
    if ((count || 0) >= MAX_FILES_PER_CHAT) {
      return res.status(409).json({ error: `This conversation already has ${MAX_FILES_PER_CHAT} files.` });
    }

    // Throws UploadRejected for anything not on the allowlist, anything that
    // is not actually text whatever it claims, and anything oversized.
    const prepared = prepareUpload({ name: req.body.name, mime: req.body.mime, base64: req.body.base64 });

    const { data, error } = await supabase.from('chat_files')
      .insert({ user_id: user.id, chat_id: req.params.id, ...prepared })
      .select('id,name,kind,bytes,truncated')
      .single();
    if (error) throw error;

    await auditLog(user.id, 'file.upload', { chatId: req.params.id, name: prepared.name, kind: prepared.kind, bytes: prepared.bytes }, req.ip);
    res.json(data);
  } catch (err) {
    // A rejected upload is the caller's input, not a server fault, and the
    // message is written to be shown to them verbatim.
    if (err instanceof UploadRejected) return res.status(400).json({ error: err.message });
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:id/files', requireAuth, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    res.json(await fileStoreFor(user.id, req.params.id).list());
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.delete('/api/chats/:id/files/:fileId', requireAuth, requireOwnership('chats'), uuidParam('fileId'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { error } = await supabase.from('chat_files').delete().eq('id', req.params.fileId).eq('user_id', user.id).eq('chat_id', req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== FEEDBACK =====
app.post('/api/feedback', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { feedback, question, answer } = req.body;
    if (!feedback || !['up','down'].includes(feedback)) return res.status(400).json({ error: 'Invalid feedback' });
    await auditLog(user.id, 'feedback', { feedback, question: question?.slice(0,500), answer: answer?.slice(0,500) }, req.ip);
    // One row per rating in its own table. These notes used to be appended onto
    // users.conversation_summary, so every thumbs-up ate into the same 2000
    // characters the conversation memory needed and eventually destroyed both.
    try {
      const note = await callModel(FAST_MODEL, [
        { role: 'system', content: feedback === 'down' ? 'User disliked this answer. Create a 1-sentence note about what to avoid. Reply ONLY with the note.' : 'User liked this answer. Create a 1-sentence note about what worked. Reply ONLY with the note.' },
        { role: 'user', content: `Q: ${question?.slice(0,300)}\nA: ${answer?.slice(0,300)}` }
      ], 0.0, 3000, 100);
      if (note.trim()) {
        const { error: noteErr } = await supabase.from('feedback_notes').insert({ user_id: user.id, kind: feedback, note: note.trim().slice(0, 300) });
        if (noteErr) console.error(`[LEARN] Save failed (has 001_per_chat_memory.sql been run?):`, noteErr.message);
        else console.log(`[LEARN] ${feedback} feedback saved.`);
      }
    } catch (e) { console.error('[LEARN] Failed:', e.message); }
    res.json({ ok: true });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== CHATS =====
app.get('/api/chats', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); const { data, error } = await supabase.from('chats').select('id,user_id,title,messages,pinned,favorite,created_at,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.post('/api/chats', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); const title = sanitizeString(req.body.title, 120) || 'New Chat'; const { data, error } = await supabase.from('chats').insert({ user_id: user.id, title, messages: [] }).select().single(); if (error) throw error; res.json(data); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.put('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => { try { const user = await ensureUser(req.auth.userId); const { payload, error: buildErr } = buildChatUpdate(req.body); if (buildErr) return res.status(400).json({ error: buildErr }); if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'No updatable fields' }); const { error } = await supabase.from('chats').update(payload).eq('id', req.params.id).eq('user_id', user.id); if (error) throw error; res.json({ ok: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.delete('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => { try { const user = await ensureUser(req.auth.userId); const { error } = await supabase.from('chats').delete().eq('id', req.params.id).eq('user_id', user.id); if (error) throw error; res.json({ deleted: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

// ===== ADMIN =====
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => { try { const { data, error } = await supabase.from('users').select('id,clerk_id,email,name,avatar_url,plan,is_admin,suspended,created_at,stripe_subscription_id'); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
// Admin routes take a Supabase users.id in :id. Validating the shape keeps a
// malformed value from reaching Postgres and coming back as a 500 that reads
// like a server fault. requireOwnership already does this for user routes; the
// admin routes did not.
// (uuidParam is defined above, next to the other route guards.)

app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, uuidParam(), async (req, res) => { try { const { data: t } = await supabase.from('users').select('is_admin,email').eq('id', req.params.id).single(); if (!t) return res.status(404).json({ error: 'Not found' }); if (t.is_admin) return res.status(403).json({ error: 'Cannot suspend admin' }); const { error } = await supabase.from('users').update({ suspended: true }).eq('id', req.params.id); if (error) throw error; await auditLog(req.adminUserId, 'admin.suspend', { target: req.params.id, targetEmail: t.email }, req.ip); res.json({ suspended: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

app.post('/api/admin/users/:id/unsuspend', requireAuth, requireAdmin, uuidParam(), async (req, res) => { try { const { error } = await supabase.from('users').update({ suspended: false }).eq('id', req.params.id); if (error) throw error; await auditLog(req.adminUserId, 'admin.unsuspend', { target: req.params.id }, req.ip); res.json({ unsuspended: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, uuidParam(), async (req, res) => { try {
  // The old self-delete guard compared req.auth.userId (a Clerk id, "user_2ab…")
  // against req.params.id (a Supabase uuid). Those are different id spaces and
  // can never be equal, so the check never fired once. It was masked by the
  // is_admin check below — an admin deleting themselves was refused as "an
  // admin", which is the right outcome reached by the wrong route. Compare the
  // ids that are actually comparable.
  if (req.adminUserId === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const { data: t } = await supabase.from('users').select('is_admin,email').eq('id', req.params.id).single();
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.is_admin) return res.status(403).json({ error: 'Cannot delete admin' });
  const { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) throw error;
  // Written after the delete succeeds and before the reply, so a 200 always has
  // a matching audit row. audit_logs.user_id is ON DELETE SET NULL, so deleting
  // a user cannot take the record of their deletion with them.
  await auditLog(req.adminUserId, 'admin.delete_user', { target: req.params.id, targetEmail: t.email }, req.ip);
  res.json({ deleted: true });
} catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/admin/chats/:userId', requireAuth, requireAdmin, async (req, res) => { try { const { data, error } = await supabase.from('chats').select('*').eq('user_id', req.params.userId).order('updated_at', { ascending: false }); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/admin/usage/:userId', requireAuth, requireAdmin, async (req, res) => { try { const { data, error } = await supabase.from('usage').select('*').eq('user_id', req.params.userId).order('date', { ascending: false }).limit(30); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

// ===== STRIPE =====

// Prices are read from Stripe rather than hardcoded in the frontend, so what
// the paywall advertises can never drift from what the customer is actually
// charged. Cached because prices change rarely and this sits on the page-load
// path for every free user.
let priceCache = null;
const PRICE_CACHE_MS = 60 * 60 * 1000;

app.get('/api/billing/prices', requireStripe, requireAuth, async (req, res) => {
  try {
    if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_MS) return res.json(priceCache.data);

    const ids = { monthly: process.env.STRIPE_PRICE_MONTHLY, yearly: process.env.STRIPE_PRICE_YEARLY };
    const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
    // 503 rather than 500: the server is healthy, this deployment simply cannot
    // sell anything. The client hides the upgrade path instead of rendering a
    // paywall that would fail at checkout.
    if (missing.length) return res.status(503).json({ error: `Pricing is not configured (missing: ${missing.join(', ')}).` });

    const [monthly, yearly] = await Promise.all([
      stripe.prices.retrieve(ids.monthly),
      stripe.prices.retrieve(ids.yearly),
    ]);
    const shape = (p) => ({ amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval || null });
    const data = { monthly: shape(monthly), yearly: shape(yearly) };

    priceCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    // A rejected price ID is a configuration problem, not a server fault, so it
    // gets the same 503 treatment and the same graceful hiding on the client.
    console.error('[BILLING] Price lookup failed:', err.message);
    Sentry.captureException(err);
    res.status(503).json({ error: 'Pricing is temporarily unavailable.' });
  }
});

app.post('/api/create-checkout-session', requireStripe, requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); const cu = await clerkClient.users.getUser(req.auth.userId); const email = cu?.emailAddresses?.[0]?.emailAddress; const priceId = req.body.plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY; if (!priceId) throw new Error('Price ID not configured'); const session = await stripe.checkout.sessions.create({ customer_email: user.stripe_customer_id ? undefined : email, customer: user.stripe_customer_id || undefined, line_items: [{ price: priceId, quantity: 1 }], mode: 'subscription', success_url: `${process.env.FRONTEND_URL}/?payment=success`, cancel_url: `${process.env.FRONTEND_URL}/?payment=cancelled`, metadata: { userId: req.auth.userId } }); res.json({ url: session.url }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.post('/api/create-portal-session', requireStripe, requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); if (!user.stripe_customer_id) return res.status(400).json({ error: 'No subscription' }); const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${process.env.FRONTEND_URL}/` }); res.json({ url: session.url }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/user/plan', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); res.json({ plan: user.plan || 'free', subscription_id: user.stripe_subscription_id }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

// ===== ERRORS =====
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
Sentry.setupExpressErrorHandler(app);
app.use((err, req, res, next) => {
  const isCors = Boolean(err.message && err.message.includes('CORS'));
  const status = isCors ? 403 : (err.status || err.statusCode || 500);
  // 4xx is expected traffic (expired tokens, bad input) — paging on it buries real faults.
  if (status >= 500) Sentry.captureException(err);
  // Only mask 5xx: a 4xx reason is the client's own and is safe to return.
  const masked = status >= 500 && process.env.NODE_ENV === 'production';
  res.status(status).json({ error: masked ? 'Internal server error' : err.message });
});

// ===== START =====
const server = app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  ALOP-AI PRECISION BACKEND                  ║`);
  console.log(`║  Port: ${PORT} | Council: ${COUNCIL.length} pro / ${FREE_COUNCIL.length} free      ║`);
  console.log(`║  T=${TAVILY_API_KEY?'ON':'OFF'} B=${BRAVE_API_KEY?'ON':'OFF'} G=${GOOGLE_SEARCH_API_KEY&&GOOGLE_CSE_ID?'ON':'OFF'} J=${JINA_API_KEY?'ON':'OFF'} Wiki=ON  ║`);
  console.log(`║  Memory: Supabase | Quick + Feedback        ║`);
  console.log(`╚════════════════════════════════════════════╝`);
  // Printed unconditionally, including when it is off. A feature flag that is
  // silent when disabled is indistinguishable from one that is enabled and
  // broken — which is exactly the half hour this cost: COUNCIL_TOOLS=shadow was
  // set correctly, the probe was in unreachable code, and nothing on either
  // side of the boot said so.
  console.log(`[BOOT] COUNCIL_TOOLS=${process.env.COUNCIL_TOOLS || '(unset)'} -> tools ${TOOLS_ENABLED ? 'LIVE' : TOOLS_SHADOW ? 'SHADOW (probe only, answers unchanged)' : 'OFF'}`);
  // Same reasoning as the line above: a store that is silently per-process is
  // indistinguishable from a shared one until the limits are already wrong.
  console.log(`[BOOT] RATE_LIMIT_STORE=${process.env.RATE_LIMIT_STORE || '(unset)'} -> ${USE_PG_RATE_LIMIT ? 'postgres, shared across instances' : 'in-memory, PER PROCESS — set RATE_LIMIT_STORE=postgres before scaling past one instance'}`);
  // Third flag, same rule. The console being disabled is the SAFE state, so it
  // says so plainly rather than staying quiet and looking like it works.
  const tc = terminalConfig();
  console.log(`[BOOT] admin console -> ${tc.enabled ? `ENABLED for ${tc.admins.length} allowlisted admin(s)` : `disabled (${tc.reason})`}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
