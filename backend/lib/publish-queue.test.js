'use strict';

/**
 * THE PLANNER: slot arithmetic, ownership decisions, and the promise that a
 * dry-run cannot publish.
 *
 * The timezone tests are the ones worth reading twice. Asia/Dubai is UTC+4 with
 * no daylight saving, so every one of these is a fixed, checkable fact rather
 * than a platform lookup — 10:00 Dubai is 06:00Z in August and in January, and
 * a conversion that drifts by an hour would put a post out at the wrong end of
 * the audience's day without failing anything.
 */

const test = require('node:test');
const assert = require('node:assert');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');

const PUBLISH_DIR = join(__dirname, '..', '..', 'scripts', 'publish');
const load = () => import(pathToFileURL(join(PUBLISH_DIR, 'queue.mjs')).href);

const reels = () => JSON.parse(readFileSync(join(PUBLISH_DIR, 'reels.json'), 'utf8')).reels;
const backfillRows = () => JSON.parse(readFileSync(join(PUBLISH_DIR, 'metricool-backfill.json'), 'utf8')).rows;

const ownersFrom = (rows) => new Map(rows.map((r) => [`${r.reelId} ${r.platform}`, {
  reel_id: r.reelId, platform: r.platform, scheduler: r.scheduler,
  status: r.status, scheduler_post_id: r.schedulerPostId,
}]));

const SUPABASE = 'https://project.supabase.co';

test('Dubai 10:00 is 06:00 UTC, and the offset does not move with the season', async () => {
  const { dubaiToUtc } = await load();
  assert.equal(dubaiToUtc('2026-08-25', '10:00'), '2026-08-25T06:00:00.000Z');
  assert.equal(dubaiToUtc('2027-01-15', '10:00'), '2027-01-15T06:00:00.000Z');
});

test('the three cadence slots convert to the times the existing batch already uses', async () => {
  const { dubaiToUtc, SCHEDULE } = await load();
  assert.equal(dubaiToUtc('2026-08-25', SCHEDULE.instagram.time), '2026-08-25T06:00:00.000Z');
  assert.equal(dubaiToUtc('2026-08-25', SCHEDULE.tiktok.time), '2026-08-25T06:20:00.000Z');
  assert.equal(dubaiToUtc('2026-08-25', SCHEDULE.youtube.time), '2026-08-25T12:00:00.000Z');
});

test('a Dubai time after 20:00 rolls into the NEXT UTC day', async () => {
  const { dubaiToUtc } = await load();
  assert.equal(dubaiToUtc('2026-08-25', '02:00'), '2026-08-24T22:00:00.000Z');
  assert.equal(dubaiToUtc('2026-08-25', '23:30'), '2026-08-25T19:30:00.000Z');
});

test('a malformed slot is refused rather than silently becoming Invalid Date', async () => {
  const { dubaiToUtc } = await load();
  assert.throws(() => dubaiToUtc('not-a-date', '10:00'), /not a Dubai date\/time/);
});

test('the media URL is the public Supabase object, built from the environment', async () => {
  const { mediaUrlFor } = await load();
  const url = mediaUrlFor({ media: 'debounce.mp4' }, { supabaseUrl: SUPABASE, bucket: 'reels' });
  assert.equal(url, `${SUPABASE}/storage/v1/object/public/reels/debounce.mp4`);
  assert.equal(url.includes('token='), false, 'a signed URL expires before a queued post publishes');
});

test('every one of the twelve Metricool publications is refused to Buffer', async () => {
  const { plan } = await load();
  const decisions = plan({
    reels: reels(), owners: ownersFrom(backfillRows()), startDate: '2026-08-25', supabaseUrl: SUPABASE,
  });

  assert.equal(decisions.length, 12);
  assert.equal(decisions.filter((d) => d.action === 'skip').length, 12, 'all twelve are already owned');
  assert.equal(decisions.filter((d) => d.action === 'create').length, 0);
  for (const d of decisions) {
    assert.equal(d.ownedBy, 'metricool');
    assert.match(d.reason, /already owned by metricool/);
    assert.equal(d.scheduler, 'metricool', 'the plan must attribute the pair to its real owner');
  }
});

test('a reel nobody owns is planned for Buffer at its measured slot', async () => {
  const { plan } = await load();
  const fresh = [{
    id: 'newreel', media: 'newreel.mp4', thumbnailOffset: 1500,
    captions: { instagram: 'a', tiktok: 'b', youtube: 'c' },
    youtube: { title: 't', categoryId: '28' },
  }];
  const decisions = plan({ reels: fresh, owners: new Map(), startDate: '2026-08-25', supabaseUrl: SUPABASE });

  assert.equal(decisions.length, 3);
  assert.ok(decisions.every((d) => d.action === 'create' && d.scheduler === 'buffer'));
  assert.deepEqual(decisions.map((d) => d.utc), [
    '2026-08-25T06:00:00.000Z', '2026-08-25T06:20:00.000Z', '2026-08-25T12:00:00.000Z',
  ]);
});

test('one owned platform does not block the other two', async () => {
  const { plan } = await load();
  const fresh = [{ id: 'newreel', media: 'newreel.mp4', captions: { instagram: 'a', tiktok: 'b', youtube: 'c' }, youtube: { title: 't', categoryId: '28' } }];
  const owners = ownersFrom([{ reelId: 'newreel', platform: 'instagram', scheduler: 'metricool', status: 'scheduled', schedulerPostId: '1' }]);
  const decisions = plan({ reels: fresh, owners, startDate: '2026-08-25', supabaseUrl: SUPABASE });

  assert.equal(decisions.find((d) => d.platform === 'instagram').action, 'skip');
  assert.equal(decisions.find((d) => d.platform === 'tiktok').action, 'create');
  assert.equal(decisions.find((d) => d.platform === 'youtube').action, 'create');
});

test('YouTube carries no thumbnail offset, because Buffer has no thumbnail control there', async () => {
  const { plan } = await load();
  const fresh = [{ id: 'newreel', media: 'newreel.mp4', thumbnailOffset: 1500, captions: { instagram: 'a', tiktok: 'b', youtube: 'c' }, youtube: { title: 't', categoryId: '28' } }];
  const decisions = plan({ reels: fresh, owners: new Map(), startDate: '2026-08-25', supabaseUrl: SUPABASE });
  assert.equal(decisions.find((d) => d.platform === 'youtube').thumbnailOffset, null);
  assert.equal(decisions.find((d) => d.platform === 'instagram').thumbnailOffset, 1500);
  assert.equal(decisions.find((d) => d.platform === 'tiktok').thumbnailOffset, 1500);
});

test('a missing caption is a skip, not a post with no words', async () => {
  const { plan } = await load();
  const fresh = [{ id: 'newreel', media: 'newreel.mp4', captions: { instagram: 'a' }, youtube: { title: 't', categoryId: '28' } }];
  const decisions = plan({ reels: fresh, owners: new Map(), startDate: '2026-08-25', supabaseUrl: SUPABASE });
  assert.equal(decisions.find((d) => d.platform === 'tiktok').action, 'skip');
  assert.match(decisions.find((d) => d.platform === 'tiktok').reason, /no tiktok caption/);
});

test('the printed plan carries every field the operator has to check', async () => {
  const { plan, formatPlan } = await load();
  const out = formatPlan(plan({ reels: reels(), owners: ownersFrom(backfillRows()), startDate: '2026-08-25', supabaseUrl: SUPABASE }));

  for (const needle of ['REEL', 'PLATFORM', 'SCHEDULER', 'DUBAI', 'UTC', 'indexscan', 'instagram', 'metricool', 'sha256:']) {
    assert.ok(out.includes(needle), `the dry-run must print ${needle}`);
  }
  assert.ok(out.includes(`${SUPABASE}/storage/v1/object/public/reels/indexscan.mp4`), 'the media URL is part of the decision');
  assert.match(out, /12 pairs — 0 would be created, 12 refused\./);
});

test('planning is pure — it opens no socket', async () => {
  const { plan } = await load();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('the planner must not reach the network'); };
  try {
    plan({ reels: reels(), owners: ownersFrom(backfillRows()), startDate: '2026-08-25', supabaseUrl: SUPABASE });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test('the backfill file and the reel catalogue describe the same four reels', () => {
  const catalogue = reels().map((r) => r.id).sort();
  const owned = [...new Set(backfillRows().map((r) => r.reelId))].sort();
  assert.deepEqual(owned, catalogue);
  assert.equal(backfillRows().length, 12, 'four reels times three platforms');
});
