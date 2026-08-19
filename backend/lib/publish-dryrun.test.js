'use strict';

/**
 * THE DRY RUN, DRIVEN AS THE OPERATOR DRIVES IT.
 *
 * The other publish tests exercise functions; this one runs `queue.mjs` as a
 * real child process against a stub PostgREST, because the promise being tested
 * is about the PROGRAM — "this cannot publish" — and a promise about the
 * program is not testable one function at a time.
 *
 * BUFFER_API_KEY IS DELIBERATELY REMOVED FROM THE CHILD'S ENVIRONMENT, and that
 * is the mechanism, not a detail: `createBufferClient` throws without it, so a
 * run that constructed a Buffer client at all would exit non-zero. A clean exit
 * is therefore evidence that no Buffer client was built, which is a stronger
 * claim than "createPost was not called" — it rules out the channel and
 * organization queries too.
 *
 * The stub also counts what it was asked for, so a dry-run that quietly wrote
 * to the ledger would show up as a POST.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');

const PUBLISH_DIR = join(__dirname, '..', '..', 'scripts', 'publish');
const QUEUE = join(PUBLISH_DIR, 'queue.mjs');

/** PostgREST stand-in: answers the ownership read from the backfill file. */
function stubSupabase() {
  const seen = [];
  const rows = JSON.parse(readFileSync(join(PUBLISH_DIR, 'metricool-backfill.json'), 'utf8')).rows.map((r) => ({
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

  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.method === 'GET' ? rows : []));
  });
  return { server, seen };
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const run = (args, env) => new Promise((resolve) => {
  execFile(process.execPath, [QUEUE, ...args], { env, timeout: 30_000 }, (error, stdout, stderr) => {
    resolve({ code: error?.code ?? 0, stdout, stderr, error });
  });
});

test('the dry run refuses all twelve Metricool pairs and creates nothing', async (t) => {
  const { server, seen } = stubSupabase();
  const port = await listen(server);
  t.after(() => server.close());

  const env = { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'stub-key' };
  /* The whole point — see the header. */
  delete env.BUFFER_API_KEY;

  const { code, stdout, stderr } = await run(['--dry-run', '--start', '2026-08-25'], env);

  assert.equal(code, 0, `the dry run must succeed without a Buffer key. stderr: ${stderr}`);
  assert.match(stdout, /12 pairs — 0 would be created, 12 refused\./);
  assert.match(stdout, /DRY RUN — no Buffer createPost calls were made\./);

  const skips = stdout.split('\n').filter((l) => l.includes(' SKIP '));
  assert.equal(skips.length, 12);
  assert.equal(stdout.includes(' CREATE '), false, 'nothing may be planned for creation while Metricool owns it');

  /* Reads only. A dry run that wrote would show a POST or a PATCH here. */
  assert.ok(seen.length >= 1, 'the plan must actually consult the ledger');
  assert.deepEqual([...new Set(seen.map((r) => r.method))], ['GET']);
});

test('--dry-run --commit is refused rather than resolved in favour of committing', async (t) => {
  const { server, seen } = stubSupabase();
  const port = await listen(server);
  t.after(() => server.close());

  /* Dry run is the default, so the flag is only ever a statement of intent.
   * Letting --commit win over it publishes in the one invocation that asked
   * hardest not to; the key is present here so a commit path WOULD run. */
  const env = { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'stub-key', BUFFER_API_KEY: 'stub-buffer-key' };

  const { code, stderr } = await run(['--dry-run', '--commit', '--start', '2026-08-25'], env);

  assert.equal(code, 2, 'the contradiction must be a hard stop, not a silent choice');
  assert.match(stderr, /mutually exclusive/);
  assert.deepEqual(seen, [], 'a refused invocation must not even read the ledger');
});

test('the dry run prints the ownership evidence, not just a verdict', async (t) => {
  const { server } = stubSupabase();
  const port = await listen(server);
  t.after(() => server.close());

  const env = { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'stub-key' };
  delete env.BUFFER_API_KEY;

  const { stdout } = await run(['--dry-run', '--start', '2026-08-25'], env);

  assert.match(stdout, /indexscan\s+instagram\s+metricool/);
  assert.match(stdout, /already owned by metricool \(published, post 363756422\)/);
  assert.match(stdout, /already owned by metricool \(scheduled, post 363754710\)/);
  assert.match(stdout, /storage\/v1\/object\/public\/reels\/debounce\.mp4/);
  assert.match(stdout, /sha256:[0-9a-f]{16}/);
});

test('a Buffer key in the environment is never echoed by the dry run', async (t) => {
  const { server } = stubSupabase();
  const port = await listen(server);
  t.after(() => server.close());

  const sentinel = 'buffer-key-sentinel-9f22';
  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'stub-key',
    BUFFER_API_KEY: sentinel,
  };

  const { code, stdout, stderr } = await run(['--dry-run', '--start', '2026-08-25'], env);

  assert.equal(code, 0);
  assert.equal(stdout.includes(sentinel), false, 'the key must never reach stdout');
  assert.equal(stderr.includes(sentinel), false, 'nor stderr');
  assert.equal(stdout.includes('stub-key'), false, 'nor may the service role key');
});
