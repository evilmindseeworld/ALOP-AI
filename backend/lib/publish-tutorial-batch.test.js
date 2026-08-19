'use strict';

/**
 * TUTORIAL BATCH 01, STAGED IN THE CATALOGUE AND NOT SCHEDULED.
 *
 * Ten reels were added to `scripts/publish/reels.json` as the NEXT batch. They
 * are rendered, normalised and captioned in the `alop-reel` repo and their
 * media is in the public `reels` bucket, but no scheduler has been told about
 * them — that happens later, and only through `queue.mjs --commit`.
 *
 * What this file protects is the staging itself, because staging is the step
 * that is easy to get half-right: nine entries instead of ten, a platform
 * caption that never made it out of the notes, an id that collides with a reel
 * some scheduler already owns. Every one of those is silent until the batch
 * publishes to a real audience.
 *
 * THE ORDER IS PART OF THE DATA. `plan()` gives reel N the Nth day after the
 * start date, so the array order in reels.json IS the posting order — the notes
 * in `reel-notes/TUTORIAL-BATCH-01.md` argue for this particular sequence, and
 * a reordering that looked like a harmless diff would quietly rewrite it.
 */

const test = require('node:test');
const assert = require('node:assert');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');

const PUBLISH_DIR = join(__dirname, '..', '..', 'scripts', 'publish');
const catalogue = () => JSON.parse(readFileSync(join(PUBLISH_DIR, 'reels.json'), 'utf8'));
const backfillRows = () => JSON.parse(readFileSync(join(PUBLISH_DIR, 'metricool-backfill.json'), 'utf8')).rows;

/** The posting order from TUTORIAL-BATCH-01.md, which is also the array order. */
const TUTORIAL = [
  'mcpconnect', 'schemafirst', 'denyenv', 'doublepost', 'redfirst',
  'twojudges', 'agentsmd', 'quotaburn', 'subagent', 'replacenotpatch',
];

/** The reels that existed before this batch: four Metricool, ten Buffer. */
const PRIOR = [
  'indexscan', 'debounce', 'nplusone', 'ensureuser',
  'racecondition', 'cachestampede', 'waterfall', 'rerenders', 'unbounded',
  'retrystorm', 'idempotency', 'poolleak', 'circuitbreaker', 'offsetpage',
];

test('the tutorial batch is exactly ten reels, in the posting order the notes argue for', () => {
  const ids = catalogue().reels.map((r) => r.id);
  const staged = ids.filter((id) => TUTORIAL.includes(id));
  assert.strictEqual(staged.length, 10, `expected ten tutorial reels, found ${staged.length}`);
  assert.deepStrictEqual(staged, TUTORIAL);
});

test('every tutorial reel carries all three platform captions and a YouTube title', () => {
  const byId = new Map(catalogue().reels.map((r) => [r.id, r]));
  for (const id of TUTORIAL) {
    const reel = byId.get(id);
    assert.ok(reel, `${id} is not in the catalogue`);
    for (const platform of ['instagram', 'tiktok', 'youtube']) {
      const caption = reel.captions?.[platform];
      assert.ok(caption && caption.trim().length > 0, `${id} has no ${platform} caption`);
    }
    /* Buffer REQUIRES both on create, so a missing one is a failed create at
     * publish time rather than an error now. */
    assert.ok(reel.youtube?.title?.trim(), `${id} has no YouTube title`);
    assert.ok(reel.youtube?.categoryId, `${id} has no YouTube categoryId`);
    /* YouTube rejects a title over 100 characters. */
    assert.ok(reel.youtube.title.length <= 100, `${id} YouTube title is ${reel.youtube.title.length} chars`);
  }
});

test('no reel id appears twice in the catalogue', () => {
  const ids = catalogue().reels.map((r) => r.id);
  const seen = new Set();
  const dupes = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepStrictEqual(dupes, [], `duplicate reel ids: ${dupes.join(', ')}`);
});

test('no media key appears twice — two reels pointing at one object is a duplicate publication', () => {
  const media = catalogue().reels.map((r) => r.media);
  const seen = new Set();
  const dupes = media.filter((m) => (seen.has(m) ? true : (seen.add(m), false)));
  assert.deepStrictEqual(dupes, []);
});

test('the tutorial ids collide with neither the Metricool rows nor the reels already in the catalogue', () => {
  const metricool = new Set(backfillRows().map((r) => r.reelId));
  for (const id of TUTORIAL) {
    assert.ok(!metricool.has(id), `${id} is already owned by Metricool`);
    assert.ok(!PRIOR.includes(id), `${id} collides with an earlier reel`);
  }
  /* And the other direction: the earlier reels are all still there. Staging a
   * batch must not drop the batch before it. */
  const ids = new Set(catalogue().reels.map((r) => r.id));
  for (const id of PRIOR) assert.ok(ids.has(id), `${id} disappeared from the catalogue`);
});

test('media stays a bucket key — the catalogue is public and carries no deployment host', () => {
  for (const reel of catalogue().reels) {
    assert.match(reel.media, /^[a-z0-9-]+\.mp4$/, `${reel.id} media is not a plain bucket key`);
    assert.ok(!/https?:\/\//.test(reel.media));
  }
});

test('loading the catalogue publishes nothing — it is data, and reading it reaches no scheduler', async () => {
  /* The strong version of this claim is the dry-run test next door, which runs
   * queue.mjs as a process with no Buffer key and watches it exit clean. This
   * is the narrow one: reading reels.json is a parse, it executes nothing, and
   * nothing in it names a scheduler endpoint. */
  const raw = readFileSync(join(PUBLISH_DIR, 'reels.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.strictEqual(typeof parsed, 'object');
  assert.ok(Array.isArray(parsed.reels));
  /* The comment at the top of the catalogue promises this: the repository is
   * public, so the project host stays in SUPABASE_URL and never in here. */
  assert.ok(!/supabase\.co|api\.bufferapp\.com/i.test(raw), 'the catalogue carries a deployment host');

  /* No `scheduledAt`, no post id, no status: a catalogue entry is not a claim.
   * Ownership lives in the ledger table, and that is the only thing that can
   * stop or authorise a publication. */
  for (const reel of parsed.reels) {
    for (const field of ['scheduledAt', 'scheduled_at', 'status', 'schedulerPostId', 'publishAt']) {
      assert.ok(!(field in reel), `${reel.id} carries ${field}, which belongs to the ledger`);
    }
  }
});
