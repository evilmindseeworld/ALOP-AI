'use strict';

/**
 * THE COMMIT PATH, DRIVEN AS THE OPERATOR DRIVES IT, WITH THE LEDGER FAILING
 * AFTER BUFFER HAS ALREADY SAID YES.
 *
 * This is the one sequence that can produce the failure the whole publishing
 * design exists to prevent — a duplicate post in front of a real audience:
 *
 *   1. `createPost` succeeds and Buffer holds a real, scheduled post.
 *   2. The PATCH that would record it (`markScheduled`) fails.
 *   3. If the catch releases the claim, the (reel, platform) pair is free.
 *   4. The next run sees no owner, claims it, and posts the same video twice.
 *
 * Step 3 is a decision in the code, not an accident, which is why it is tested
 * here rather than reasoned about: `markFailed` must run when `createPost`
 * failed and NEVER when it succeeded. A row left `claimed` is the safe residue
 * — it is in ACTIVE_STATUSES, so it keeps holding the pair, and it is visible
 * to a human who can attach the post id afterwards.
 *
 * Run as a child process against two stubs because the promise under test is
 * about the PROGRAM. The stub PostgREST keeps its rows between the two runs, so
 * the second run reads exactly what the first one left behind — the ownership
 * hand-off is the thing being proved, and a per-run fixture would fake it.
 *
 * BUFFER_ENDPOINT_FOR_TESTS is the only injection this needs. Unset, the client
 * talks to https://api.buffer.com and nothing here changes production.
 */

const test = require('node:test');
const assert = require('node:assert');
const { tmpdir } = require('node:os');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { join } = require('node:path');
const { readFileSync, writeFileSync, mkdtempSync } = require('node:fs');

const PUBLISH_DIR = join(__dirname, '..', '..', 'scripts', 'publish');
const QUEUE = join(PUBLISH_DIR, 'queue.mjs');

/** The one pair left free; every other pair is owned by Metricool, so the plan
 * has exactly one CREATE and a second createPost call is unambiguous. */
const FREE = { reelId: 'ensureuser', platform: 'tiktok' };
const BUFFER_POST_ID = 'buffer-post-7c31';
const API_KEY = 'buffer-key-sentinel-4b19';

const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => resolve(raw ? JSON.parse(raw) : null));
});

/**
 * PostgREST stand-in with a memory. `patchFails` is what simulates the blip
 * between two HTTPS calls to different hosts — the PATCH is rejected, the row
 * it would have changed is not.
 */
function stubSupabase({ patchFails = true } = {}) {
  const rows = JSON.parse(readFileSync(join(PUBLISH_DIR, 'metricool-backfill.json'), 'utf8')).rows
    .filter((r) => !(r.reelId === FREE.reelId && r.platform === FREE.platform))
    .map((r) => ({
      id: `row-${r.schedulerPostId}`,
      reel_id: r.reelId,
      platform: r.platform,
      scheduler: r.scheduler,
      scheduler_post_id: r.schedulerPostId,
      scheduled_at: r.scheduledAt,
      status: r.status,
      media_url: r.mediaUrl,
      caption_hash: 'x'.repeat(64),
    }));
  const patches = [];
  let inserted = 0;

  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET') return send(200, rows);
    if (req.method === 'POST') {
      const row = { ...(await readBody(req)), id: `claim-${++inserted}` };
      /* The partial unique index, in miniature: an active row for the pair
       * refuses the insert with the 23505 `claim` turns into a refusal. */
      const held = rows.find((r) => r.reel_id === row.reel_id && r.platform === row.platform
        && ['claimed', 'scheduled', 'published'].includes(r.status));
      if (held) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "publishing_ledger_active_owner"' });
      rows.push(row);
      return send(201, [row]);
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      patches.push(body);
      if (patchFails) return send(503, { message: 'upstream connect error' });
      const id = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('id').replace('eq.', ''));
      const row = rows.find((r) => r.id === id);
      Object.assign(row, body);
      return send(200, [row]);
    }
    return send(405, {});
  });
  return { server, rows, patches };
}

/** Buffer stand-in. Answers the organization and channel queries with the ids
 * `EXPECTED_ACCOUNTS` pins, then accepts exactly one post. */
function stubBuffer({ refusePost = false } = {}) {
  const posts = [];
  const server = http.createServer(async (req, res) => {
    const { query } = await readBody(req);
    const reply = (data) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    };
    if (query.includes('GetOrganizations')) return reply({ account: { organizations: [{ id: 'org-1' }] } });
    if (query.includes('GetChannels')) {
      return reply({
        channels: [
          { id: '6a858384ccaf649a67d5a2cc', name: 'alop_ai_', displayName: 'alop_ai_', service: 'instagram', serviceId: '17841472991142024' },
          { id: '6a8583a1ccaf649a67d5a36e', name: 'alop_ai', displayName: 'alop_ai', service: 'tiktok', serviceId: 'open-id' },
          { id: '6a858361ccaf649a67d5a228', name: 'vash', displayName: 'vash', service: 'youtube', serviceId: 'UCjSfNPTI9Obg3wWNnzvDV9g' },
        ],
      });
    }
    if (refusePost) return reply({ createPost: { message: 'this channel cannot accept a video right now' } });
    posts.push(1);
    return reply({ createPost: { post: { id: BUFFER_POST_ID, text: 'x', dueAt: 'x' } } });
  });
  return { server, posts };
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const run = (args, env) => new Promise((resolve) => {
  execFile(process.execPath, [QUEUE, ...args], { env, timeout: 30_000 }, (error, stdout, stderr) => {
    resolve({ code: error?.code ?? 0, stdout, stderr });
  });
});

/* A catalogue pinned to the four reels Metricool owns.
 *
 * These tests run queue.mjs as a child process, so they read the real
 * scripts/publish/reels.json - which grows every time a batch is added. The
 * assertions here are about ownership ("twelve pairs, all refused"), not about
 * how much work is queued, so the child is pointed at a fixture holding exactly
 * the owned reels. Built from the real file so the captions stay real. */
function metricoolCatalogueFile() {
  const doc = JSON.parse(readFileSync(join(PUBLISH_DIR, 'reels.json'), 'utf8'));
  const owned = new Set(JSON.parse(readFileSync(join(PUBLISH_DIR, 'metricool-backfill.json'), 'utf8')).rows.map((r) => r.reelId));
  const file = join(mkdtempSync(join(tmpdir(), 'publish-catalogue-')), 'reels.json');
  writeFileSync(file, JSON.stringify({ ...doc, reels: doc.reels.filter((r) => owned.has(r.id)) }));
  return file;
}

test('a ledger PATCH that fails after Buffer created the post cannot free the pair', async (t) => {
  const supabase = stubSupabase();
  const buffer = stubBuffer();
  const [dbPort, bufPort] = [await listen(supabase.server), await listen(buffer.server)];
  t.after(() => { supabase.server.close(); buffer.server.close(); });

  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${dbPort}`,
    SUPABASE_SERVICE_ROLE_KEY: 'stub-key',
    PUBLISH_REELS_FILE_FOR_TESTS: metricoolCatalogueFile(),
    BUFFER_API_KEY: API_KEY,
    BUFFER_ENDPOINT_FOR_TESTS: `http://127.0.0.1:${bufPort}`,
  };

  /* ---- run one: Buffer says yes, the ledger cannot write it down --------- */

  const first = await run(['--commit', '--start', '2026-08-25'], env);

  assert.equal(first.stdout.match(/ CREATE /g)?.length, 1, 'exactly one pair is free to create');
  assert.equal(buffer.posts.length, 1, 'the one free pair is posted once');

  const claimed = supabase.rows.filter((r) => r.scheduler === 'buffer');
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, 'claimed', 'the row must stay in an ACTIVE status, or the pair is released');
  assert.equal(claimed[0].reel_id, FREE.reelId);
  assert.equal(claimed[0].platform, FREE.platform);

  assert.deepEqual(
    supabase.patches.filter((p) => p.status === 'failed'),
    [],
    'markFailed must not run once a real Buffer post exists — that is the release that duplicates',
  );
  assert.equal(supabase.patches.length, 1, 'the only PATCH attempted is the markScheduled that failed');

  /* The operator has to be able to reconcile by hand, so the post id has to be
   * in the output — and the key has to not be, on the same line. */
  assert.match(first.stderr, new RegExp(BUFFER_POST_ID));
  assert.equal(first.stderr.includes(API_KEY), false, 'the key may not reach the warning');
  assert.equal(first.stdout.includes(API_KEY), false, 'the key may not reach stdout');

  /* ---- run two: the pair must still be owned ----------------------------- */

  const second = await run(['--commit', '--start', '2026-08-25'], env);

  assert.equal(second.stdout.includes(' CREATE '), false, 'the claimed row still owns the pair');
  assert.equal(second.stdout.match(/ SKIP /g)?.length, 12, 'all twelve pairs are owned after run one');
  assert.equal(buffer.posts.length, 1, 'THE POINT: no second post for a pair Buffer already holds');
});

test('a createPost that fails DOES release the claim, which is the other half of the rule', async (t) => {
  const supabase = stubSupabase({ patchFails: false });
  const buffer = stubBuffer({ refusePost: true });
  const [dbPort, bufPort] = [await listen(supabase.server), await listen(buffer.server)];
  t.after(() => { supabase.server.close(); buffer.server.close(); });

  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${dbPort}`,
    SUPABASE_SERVICE_ROLE_KEY: 'stub-key',
    PUBLISH_REELS_FILE_FOR_TESTS: metricoolCatalogueFile(),
    BUFFER_API_KEY: API_KEY,
    BUFFER_ENDPOINT_FOR_TESTS: `http://127.0.0.1:${bufPort}`,
  };

  const { stderr } = await run(['--commit', '--start', '2026-08-25'], env);

  assert.equal(buffer.posts.length, 0, 'Buffer refused, so no post exists');
  assert.deepEqual(supabase.patches.map((p) => p.status), ['failed'], 'with no post to orphan, the claim must be released');
  assert.equal(supabase.rows.find((r) => r.scheduler === 'buffer').status, 'failed');
  assert.match(stderr, /FAILED ensureuser\/tiktok/);
  assert.equal(stderr.includes(API_KEY), false);
});
