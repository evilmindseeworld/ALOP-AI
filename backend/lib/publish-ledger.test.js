'use strict';

/**
 * THE DUPLICATE GUARD, EXERCISED AS A STATE MACHINE.
 *
 * The real guard is `publishing_ledger_active_owner`, a partial unique index —
 * a fake cannot prove a Postgres constraint and these tests do not claim to.
 * What they prove is everything the module does AROUND it: that `claim`
 * surfaces 23505 as a refusal with the winner named, that a failed create stops
 * holding the pair, that the pair is (reel, platform) and not one or the other,
 * and that the caption hash survives the round trip.
 *
 * The fake enforces the same predicate the index does, so a change to
 * ACTIVE_STATUSES that the migration did not get shows up here as a green test
 * for the wrong rule — which is why 030's WHERE clause and ACTIVE_STATUSES are
 * asserted against each other in publish-migration.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');

const MODULE = pathToFileURL(join(__dirname, '..', '..', 'scripts', 'publish', 'ledger.mjs')).href;
const load = () => import(MODULE);

/** In-memory stand-in for `publishing_ledger`, enforcing the partial unique index. */
function fakeStore(ACTIVE) {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    async activeFor(pairs) {
      const wanted = new Set(pairs.map((p) => `${p.reelId} ${p.platform}`));
      return rows.filter((r) => ACTIVE.includes(r.status) && wanted.has(`${r.reel_id} ${r.platform}`));
    },
    async insert(row) {
      const clash = rows.find((r) => r.reel_id === row.reel_id && r.platform === row.platform && ACTIVE.includes(r.status));
      if (clash) {
        const err = new Error('duplicate key value violates unique constraint "publishing_ledger_active_owner"');
        err.code = '23505';
        throw err;
      }
      const saved = { id: `row-${nextId++}`, created_at: 'now', updated_at: 'now', ...row };
      rows.push(saved);
      return saved;
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`no such row: ${id}`);
      Object.assign(row, patch, { updated_at: 'later' });
      return row;
    },
    async all() { return rows.slice(); },
  };
}

const base = {
  scheduledAt: '2026-08-25T06:00:00.000Z',
  mediaUrl: 'https://example.test/storage/v1/object/public/reels/debounce.mp4',
  caption: 'twelve scroll events, one handler call',
};

test('a second claim on the same reel and platform is refused', async () => {
  const { createLedger, ACTIVE_STATUSES, LedgerConflict } = await load();
  const ledger = createLedger(fakeStore(ACTIVE_STATUSES));

  await ledger.claim({ reelId: 'debounce', platform: 'instagram', scheduler: 'buffer', ...base });
  await assert.rejects(
    () => ledger.claim({ reelId: 'debounce', platform: 'instagram', scheduler: 'buffer', ...base }),
    (err) => err instanceof LedgerConflict && err.reelId === 'debounce' && err.platform === 'instagram',
  );
});

test('a reel Metricool owns cannot be claimed by Buffer, and the refusal names Metricool', async () => {
  const { createLedger, ACTIVE_STATUSES, LedgerConflict } = await load();
  const ledger = createLedger(fakeStore(ACTIVE_STATUSES));

  await ledger.backfill([{
    reelId: 'indexscan', platform: 'tiktok', scheduler: 'metricool', schedulerPostId: '363754471',
    scheduledAt: '2026-08-19T06:20:00.000Z', status: 'published',
    mediaUrl: 'https://static.metricool.com/planner/x.mp4', caption: 'twenty four rows read',
  }]);

  await assert.rejects(
    () => ledger.claim({ reelId: 'indexscan', platform: 'tiktok', scheduler: 'buffer', ...base }),
    (err) => {
      assert.ok(err instanceof LedgerConflict);
      assert.equal(err.owner.scheduler, 'metricool', 'the refusal must say WHO owns it');
      assert.equal(err.owner.status, 'published');
      assert.match(err.message, /metricool/);
      return true;
    },
  );
});

test('a published pair still owns the slot — publishing is not a release', async () => {
  const { createLedger, ACTIVE_STATUSES } = await load();
  const store = fakeStore(ACTIVE_STATUSES);
  const ledger = createLedger(store);

  const claim = await ledger.claim({ reelId: 'debounce', platform: 'tiktok', scheduler: 'buffer', ...base });
  await ledger.markPublished(claim.id, 'buffer-1');

  await assert.rejects(() => ledger.claim({ reelId: 'debounce', platform: 'tiktok', scheduler: 'metricool', ...base }));
});

test('a failed create releases the pair, so a retry can claim it', async () => {
  const { createLedger, ACTIVE_STATUSES } = await load();
  const store = fakeStore(ACTIVE_STATUSES);
  const ledger = createLedger(store);

  const claim = await ledger.claim({ reelId: 'nplusone', platform: 'youtube', scheduler: 'buffer', ...base });
  await ledger.markFailed(claim.id);
  assert.equal(store.rows[0].status, 'failed');

  const retry = await ledger.claim({ reelId: 'nplusone', platform: 'youtube', scheduler: 'buffer', ...base });
  assert.equal(retry.status, 'claimed');
  assert.notEqual(retry.id, claim.id, 'the retry is a new row, and the failure stays visible');
});

test('a cancelled publication releases the pair too', async () => {
  const { createLedger, ACTIVE_STATUSES } = await load();
  const ledger = createLedger(fakeStore(ACTIVE_STATUSES));
  const claim = await ledger.claim({ reelId: 'nplusone', platform: 'instagram', scheduler: 'metricool', ...base });
  await ledger.markCancelled(claim.id);
  const retry = await ledger.claim({ reelId: 'nplusone', platform: 'instagram', scheduler: 'buffer', ...base });
  assert.equal(retry.scheduler, 'buffer');
});

test('one reel can be published to every platform', async () => {
  const { createLedger, ACTIVE_STATUSES, PLATFORMS } = await load();
  const ledger = createLedger(fakeStore(ACTIVE_STATUSES));
  for (const platform of PLATFORMS) {
    const row = await ledger.claim({ reelId: 'debounce', platform, scheduler: 'buffer', ...base });
    assert.equal(row.platform, platform);
  }
});

test('different reels can share a platform', async () => {
  const { createLedger, ACTIVE_STATUSES } = await load();
  const ledger = createLedger(fakeStore(ACTIVE_STATUSES));
  for (const reelId of ['debounce', 'nplusone', 'ensureuser']) {
    const row = await ledger.claim({ reelId, platform: 'instagram', scheduler: 'buffer', ...base });
    assert.equal(row.reel_id, reelId);
  }
});

test('the caption hash is stored, is sha256 of the text, and is not the text', async () => {
  const { createLedger, ACTIVE_STATUSES, captionHash } = await load();
  const store = fakeStore(ACTIVE_STATUSES);
  const ledger = createLedger(store);

  const caption = 'twelve scroll events, one handler call';
  const row = await ledger.claim({ reelId: 'debounce', platform: 'youtube', scheduler: 'buffer', ...base, caption });

  assert.equal(row.caption_hash, captionHash(caption));
  assert.match(row.caption_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes(caption), false, 'the ledger stores the hash, never the copy');
  assert.notEqual(captionHash(caption), captionHash(`${caption} #hashtag`), 'a reworded caption must hash differently');
  assert.equal(captionHash(`  ${caption}\r\n`), captionHash(caption), 'whitespace and line endings are not a rewording');
});

test('the backfill is idempotent — re-running it skips rather than fails', async () => {
  const { createLedger, ACTIVE_STATUSES } = await load();
  const ledger = createLedger(fakeStore(ACTIVE_STATUSES));
  const rows = [
    { reelId: 'indexscan', platform: 'instagram', scheduler: 'metricool', schedulerPostId: '363756422', scheduledAt: '2026-08-18T22:05:00.000Z', status: 'published', mediaUrl: 'https://static.metricool.com/a.mp4', caption: 'a' },
    { reelId: 'indexscan', platform: 'tiktok', scheduler: 'metricool', schedulerPostId: '363754471', scheduledAt: '2026-08-19T06:20:00.000Z', status: 'published', mediaUrl: 'https://static.metricool.com/b.mp4', caption: 'b' },
  ];
  const first = await ledger.backfill(rows);
  assert.deepEqual([first.inserted, first.skipped], [2, 0]);
  const second = await ledger.backfill(rows);
  assert.deepEqual([second.inserted, second.skipped], [0, 2], 'a prerequisite you cannot re-run goes stale');
});

test('an unknown platform or scheduler is refused before it reaches the database', async () => {
  const { createLedger, ACTIVE_STATUSES } = await load();
  const ledger = createLedger(fakeStore(ACTIVE_STATUSES));
  await assert.rejects(() => ledger.claim({ reelId: 'x', platform: 'threads', scheduler: 'buffer', ...base }), /unknown platform/);
  await assert.rejects(() => ledger.claim({ reelId: 'x', platform: 'tiktok', scheduler: 'hootsuite', ...base }), /unknown scheduler/);
});

test('a database error that is not a uniqueness violation is not reported as a conflict', async () => {
  const { createLedger, ACTIVE_STATUSES, LedgerConflict } = await load();
  const store = fakeStore(ACTIVE_STATUSES);
  store.insert = async () => { const e = new Error('connection refused'); e.code = '08006'; throw e; };
  const ledger = createLedger(store);
  await assert.rejects(
    () => ledger.claim({ reelId: 'debounce', platform: 'tiktok', scheduler: 'buffer', ...base }),
    (err) => !(err instanceof LedgerConflict) && /connection refused/.test(err.message),
  );
});
