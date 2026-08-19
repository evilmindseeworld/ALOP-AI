'use strict';

/**
 * THE BUFFER ADAPTER: what it sends, what it refuses, and what it must never
 * say out loud.
 *
 * The credential tests are the load-bearing ones. A Buffer personal key reaches
 * every channel its owner has, so it is both a publishing credential and an
 * account-wide one, and the two ways it leaks are an error message that quotes
 * the response body and an error message that quotes the request. Both are
 * driven here with a server that deliberately echoes the key back.
 *
 * The migration/constant test at the bottom exists because the fake store in
 * publish-ledger.test.js enforces ACTIVE_STATUSES rather than the index: if the
 * SQL and the constant ever disagree, every one of those tests would be green
 * for a rule production does not have.
 */

const test = require('node:test');
const assert = require('node:assert');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');

const PUBLISH_DIR = join(__dirname, '..', '..', 'scripts', 'publish');
const load = () => import(pathToFileURL(join(PUBLISH_DIR, 'buffer.mjs')).href);

const KEY = 'test-key-do-not-log-6c3f';

/** A fetch stand-in that records what it was sent and answers from a script. */
function fakeFetch(responder) {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return responder(seen.length, seen[seen.length - 1]);
  };
  impl.seen = seen;
  return impl;
}

const ok = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify({ data }) });

test('the key is read from the environment and never taken as a plain argument default', async () => {
  const { createBufferClient } = await load();
  const saved = process.env.BUFFER_API_KEY;
  delete process.env.BUFFER_API_KEY;
  try {
    assert.throws(() => createBufferClient({ fetchImpl: async () => {} }), /BUFFER_API_KEY is not set/);
  } finally {
    if (saved === undefined) delete process.env.BUFFER_API_KEY; else process.env.BUFFER_API_KEY = saved;
  }
});

test('the key travels in the Authorization header and nowhere else', async () => {
  const { createBufferClient } = await load();
  const fetchImpl = fakeFetch(() => ok({ account: { organizations: [{ id: 'org-1' }] } }));
  const client = createBufferClient({ fetchImpl, apiKey: KEY });

  await client.organizationId();

  const call = fetchImpl.seen[0];
  assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(String(call.url).includes(KEY), false, 'never in the URL — URLs end up in logs and proxies');
  assert.equal(call.init.body.includes(KEY), false, 'never in the GraphQL body');
});

test('an HTTP error that echoes the key back does not put the key in the thrown message', async () => {
  const { createBufferClient } = await load();
  const fetchImpl = fakeFetch(() => ({
    ok: false,
    status: 401,
    text: async () => `{"error":"invalid token Bearer ${KEY}"}`,
  }));
  const client = createBufferClient({ fetchImpl, apiKey: KEY });

  await assert.rejects(() => client.organizationId(), (err) => {
    assert.equal(err.message.includes(KEY), false, 'the credential must not survive into an error');
    assert.match(err.message, /\[redacted\]/);
    assert.match(err.message, /HTTP 401/);
    return true;
  });
});

test('a GraphQL error that quotes the key is redacted too', async () => {
  const { createBufferClient } = await load();
  const fetchImpl = fakeFetch(() => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ errors: [{ message: `key ${KEY} is not authorized for this organization` }] }),
  }));
  const client = createBufferClient({ fetchImpl, apiKey: KEY });

  await assert.rejects(() => client.channels('org-1'), (err) => {
    assert.equal(err.message.includes(KEY), false);
    assert.match(err.message, /\[redacted\]/);
    return true;
  });
});

test('scrub removes every occurrence, not just the first', async () => {
  const { scrub } = await load();
  assert.equal(scrub(`a ${KEY} b ${KEY} c`, KEY), 'a [redacted] b [redacted] c');
  assert.equal(scrub('nothing to hide', KEY), 'nothing to hide');
  assert.equal(scrub(`${KEY}`, ''), `${KEY}`, 'an empty secret is a no-op, not a wildcard');
});

test('createPost sends customScheduled, the due time, the public video URL and the thumbnail offset', async () => {
  const { createBufferClient } = await load();
  const fetchImpl = fakeFetch(() => ok({ createPost: { post: { id: 'post-1', text: 'hi', dueAt: '2026-08-25T06:00:00.000Z' } } }));
  const client = createBufferClient({ fetchImpl, apiKey: KEY });

  const post = await client.createPost({
    channelId: 'chan-ig',
    text: 'hi',
    dueAt: '2026-08-25T06:00:00.000Z',
    videoUrl: 'https://project.supabase.co/storage/v1/object/public/reels/debounce.mp4',
    thumbnailOffset: 1500,
    metadata: { instagram: { type: 'reel', shouldShareToFeed: true } },
  });

  const input = fetchImpl.seen[0].body.variables.input;
  assert.equal(post.id, 'post-1');
  assert.equal(input.mode, 'customScheduled');
  assert.equal(input.schedulingType, 'automatic');
  assert.equal(input.dueAt, '2026-08-25T06:00:00.000Z');
  assert.deepEqual(input.assets, [{
    video: {
      url: 'https://project.supabase.co/storage/v1/object/public/reels/debounce.mp4',
      metadata: { thumbnailOffset: 1500 },
    },
  }]);
});

test('no thumbnail offset means no metadata on the asset at all', async () => {
  const { createBufferClient } = await load();
  const fetchImpl = fakeFetch(() => ok({ createPost: { post: { id: 'post-2' } } }));
  const client = createBufferClient({ fetchImpl, apiKey: KEY });

  await client.createPost({ channelId: 'c', text: 't', dueAt: 'd', videoUrl: 'u', thumbnailOffset: null });
  assert.deepEqual(fetchImpl.seen[0].body.variables.input.assets, [{ video: { url: 'u' } }]);
});

test('a MutationError is a failure, not a post', async () => {
  const { createBufferClient } = await load();
  const fetchImpl = fakeFetch(() => ok({ createPost: { message: 'video is too short for a reel' } }));
  const client = createBufferClient({ fetchImpl, apiKey: KEY });
  await assert.rejects(
    () => client.createPost({ channelId: 'c', text: 't', dueAt: 'd', videoUrl: 'u' }),
    /video is too short for a reel/,
  );
});

test('the channel query declares organizationId as the OrganizationId scalar, not ID', async () => {
  const { createBufferClient } = await load();
  const fetchImpl = fakeFetch(() => ok({ channels: [{ id: 'chan-ig', name: 'alop_ai_', service: 'instagram' }] }));
  const client = createBufferClient({ fetchImpl, apiKey: KEY });

  await client.channels('org-1');

  /* Declaring it `ID!` fails validation against the live schema with two errors
   * that read like a wrong argument NAME — which is how the first version of
   * this function went looking for a second spelling that does not exist. */
  assert.match(fetchImpl.seen[0].body.query, /\$organizationId: OrganizationId!/);
  assert.match(fetchImpl.seen[0].body.query, /channels\(input: \{ organizationId: \$organizationId \}\)/);
  assert.equal(fetchImpl.seen.length, 1, 'one query — there is no second spelling to fall back to');
  for (const field of ['serviceId', 'isDisconnected', 'isLocked', 'isQueuePaused']) {
    assert.ok(fetchImpl.seen[0].body.query.includes(field), `${field} decides whether a channel can actually publish`);
  }
});

test('per-platform metadata carries exactly what each API requires on create', async () => {
  const { metadataFor } = await load();
  const reel = { id: 'debounce', youtube: { title: 'debounce runs it once #Shorts', categoryId: '28' } };

  assert.deepEqual(metadataFor('instagram', reel), { instagram: { type: 'reel', shouldShareToFeed: true } });
  assert.deepEqual(metadataFor('tiktok', reel), { tiktok: { isAiGenerated: false } });
  assert.deepEqual(metadataFor('youtube', reel), {
    youtube: { title: 'debounce runs it once #Shorts', categoryId: '28', privacy: 'public', madeForKids: false },
  });
});

test('a YouTube post with no title or category is refused here, not by Buffer', async () => {
  const { metadataFor } = await load();
  assert.throws(() => metadataFor('youtube', { id: 'x', youtube: { categoryId: '28' } }), /youtube\.title/);
  assert.throws(() => metadataFor('youtube', { id: 'x', youtube: { title: 't' } }), /youtube\.categoryId/);
});

test('publishing is refused unless the connected accounts are ALOP-AI, unambiguously', async () => {
  const { resolveChannels } = await load();
  const expected = { instagram: ['17841472991142024'], tiktok: ['c2'], youtube: ['UCjSfNPTI9Obg3wWNnzvDV9g'] };

  /* The live shape, and the reason serviceId matters: Buffer calls the ALOP-AI
   * YouTube channel "vash". Only the channel id identifies it. */
  const live = [
    { id: 'c1', name: 'alop_ai_', displayName: 'alop_ai_', service: 'instagram', serviceId: '17841472991142024' },
    { id: 'c2', name: 'userma0e40g4sp', displayName: 'userma0e40g4sp', service: 'tiktok', serviceId: '_000G6u' },
    { id: 'c3', name: 'vash', displayName: 'vash', service: 'youtube', serviceId: 'UCjSfNPTI9Obg3wWNnzvDV9g' },
  ];
  const good = resolveChannels(live, expected);
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.channels, { instagram: 'c1', tiktok: 'c2', youtube: 'c3' });

  const wrongAccount = resolveChannels(
    [{ id: 'c1', name: 'someone_else', service: 'instagram', serviceId: '999' }],
    { instagram: ['alop_ai_'] },
  );
  assert.deepEqual(wrongAccount.channels, {});
  assert.match(wrongAccount.problems.join(' '), /not one of alop_ai_/);
  assert.match(wrongAccount.problems.join(' '), /999/, 'the refusal must show what IS connected, ids included');

  /* A handle is not identity even when it is OUR handle: the shipped
   * EXPECTED_ACCOUNTS lists handles beside ids, and a match on one of those
   * would accept a stranger's channel renamed to it. */
  const handleOnly = resolveChannels(live.slice(0, 1), { instagram: ['alop_ai_'] });
  assert.deepEqual(handleOnly.channels, {}, 'a display-name match is not proof of identity');

  const missing = resolveChannels(live.slice(0, 1), expected);
  assert.match(missing.problems.join(' '), /no tiktok channel is connected/);

  const ambiguous = resolveChannels([
    { id: 'c1', name: 'alop_ai_', service: 'instagram', serviceId: 'x' },
    { id: 'c9', name: 'ALOP_AI_', service: 'instagram', serviceId: 'y' },
  ], { instagram: ['c1', 'c9'] });
  assert.match(ambiguous.problems.join(' '), /refusing to guess/);
  assert.deepEqual(ambiguous.channels, {});
});

test('a renamed account still resolves, because the channel id is what is pinned', async () => {
  const { resolveChannels } = await load();
  /* The real event, 2026-08-19: every account was renamed to the company name.
   * Metricool's records hold the OLD handles, Buffer's the new ones, and the
   * list that trusted handles refused two correct channels. */
  const expected = {
    tiktok: ['6a8583a1ccaf649a67d5a36e', 'userma0e40g4sp'],
    youtube: ['6a858361ccaf649a67d5a228', 'UCjSfNPTI9Obg3wWNnzvDV9g'],
  };
  const afterRename = [
    { id: '6a8583a1ccaf649a67d5a36e', name: 'alop_ai', displayName: 'alop_ai', service: 'tiktok', serviceId: 'open-id-changes-per-app' },
    { id: '6a858361ccaf649a67d5a228', name: 'vash', displayName: 'vash', service: 'youtube', serviceId: 'UCjSfNPTI9Obg3wWNnzvDV9g' },
  ];

  const out = resolveChannels(afterRename, expected);
  assert.deepEqual(out.problems, [], 'a rename must not lock us out of our own channels');
  assert.deepEqual(out.channels, { tiktok: '6a8583a1ccaf649a67d5a36e', youtube: '6a858361ccaf649a67d5a228' });

  /* And the pin still refuses a stranger: same service, neither id nor handle. */
  const stranger = resolveChannels(
    [{ id: 'someone-elses-channel', name: 'alop_ai', displayName: 'alop_ai', service: 'tiktok', serviceId: 'x' }],
    { tiktok: ['6a8583a1ccaf649a67d5a36e'] },
  );
  assert.deepEqual(stranger.channels, {}, 'matching a display name is not proof of identity');
  assert.match(stranger.problems.join(' '), /not one of/);
});

test('a channel that cannot publish is refused even when it is the right account', async () => {
  const { resolveChannels } = await load();
  const expected = { instagram: ['c1'] };

  for (const [flag, why] of [['isDisconnected', /disconnected/], ['isLocked', /locked/], ['isQueuePaused', /paused queue/]]) {
    const out = resolveChannels([{ id: 'c1', name: 'alop_ai_', service: 'instagram', [flag]: true }], expected);
    assert.deepEqual(out.channels, {}, `${flag} must not resolve to a publishable channel`);
    assert.match(out.problems.join(' '), why);
  }
});

test('the migration and the module agree on which statuses hold a slot', async () => {
  const { ACTIVE_STATUSES } = await import(pathToFileURL(join(PUBLISH_DIR, 'ledger.mjs')).href);
  const sql = readFileSync(join(__dirname, '..', 'migrations', '030_publishing_ledger.sql'), 'utf8');

  const where = sql.match(/WHERE status IN \(([^)]+)\)/);
  assert.ok(where, '030 must carry a partial unique index');
  const inSql = where[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
  assert.deepEqual(inSql, [...ACTIVE_STATUSES].sort(), 'the fake store in the ledger tests enforces the constant; if it drifts from the SQL those tests are green for the wrong rule');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS publishing_ledger_active_owner\s+ON publishing_ledger \(reel_id, platform\)/);
});
