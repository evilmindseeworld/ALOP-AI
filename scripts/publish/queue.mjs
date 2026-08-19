/**
 * THE PLANNER. Decides what Buffer would publish, when, and whether it is
 * allowed to — and by default decides it WITHOUT TOUCHING BUFFER AT ALL.
 *
 *   node scripts/publish/queue.mjs --dry-run            plan and print, zero writes
 *   node scripts/publish/queue.mjs --backfill           import the Metricool batch
 *   node scripts/publish/queue.mjs --channels           show what Buffer has connected
 *   node scripts/publish/queue.mjs --commit             actually create the posts
 *
 * `--dry-run` is the default and `--commit` is the only path that can create a
 * post. That order is deliberate: the expensive mistake here is not a failed
 * run, it is a duplicate publication to a real audience, and the only way to
 * see one coming is to print the plan first.
 *
 * SLOT TIMES ARE MEASURED, NOT CHOSEN. See SCHEDULE below.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLedger, supabaseStore, captionHash, PLATFORMS } from './ledger.mjs';
import { createBufferClient, metadataFor, resolveChannels } from './buffer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ASIA/DUBAI IS UTC+4 ALL YEAR. The UAE has not observed daylight saving, so
 * the offset is a constant rather than a lookup, and stating it explicitly is
 * what makes the conversion testable without a timezone database.
 *
 * Written as an offset ON THE TIMESTAMP rather than by subtracting four hours,
 * because `new Date("...+04:00")` is parsed by the platform and arithmetic on
 * local-time strings is where this class of bug lives.
 *
 * @param {string} date `YYYY-MM-DD` in Dubai
 * @param {string} time `HH:MM` in Dubai
 * @returns {string} the same instant as an ISO-8601 UTC string
 */
export function dubaiToUtc(date, time) {
  const iso = `${date}T${time.length === 5 ? `${time}:00` : time}.000+04:00`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new Error(`not a Dubai date/time: ${date} ${time}`);
  return at.toISOString();
}

/**
 * THE CADENCE, AND WHERE EACH NUMBER CAME FROM.
 *
 * Metricool's best-time data for brand 6744652, read 2026-08-19 over the
 * preceding week, peak hour per network in Asia/Dubai:
 *
 *   instagram  hour 10  (6506 Wed, 6734 Fri — hour 10 wins every weekday)
 *   tiktok     hour 10  (1432 Wed, 1471 Thu; hour 18 is the runner-up at 1386)
 *   youtube    hour 16  (12033 Wed, 11979 Thu — clearly ahead of hour 10)
 *
 * Instagram and TikTok therefore want the SAME hour, which is why TikTok sits
 * at :20 rather than :00 — the offset is not a hedge about the data, it keeps
 * two publications from landing on one audience in the same minute. This
 * reproduces the cadence the existing Metricool batch already uses, which is
 * itself these same best times.
 *
 * Metricool stays the source of this data. Re-read it with
 * getBestTimeToPostByNetwork and edit here when it moves.
 */
export const SCHEDULE = Object.freeze({
  instagram: { time: '10:00', bestHour: 10 },
  tiktok: { time: '10:20', bestHour: 10 },
  youtube: { time: '16:00', bestHour: 16 },
});

/** Buffer Free: three channels, ten queued posts per channel, slots recycle. */
export const BUFFER_QUEUE_LIMIT = 10;

/** The accounts a publish is allowed to reach. Anything else is refused. */
/**
 * The accounts a publish is allowed to reach, as Buffer reported them on
 * 2026-08-19. Matched against name, displayName AND serviceId - see
 * resolveChannels.
 *
 * INSTAGRAM and YOUTUBE are verified against Metricool's record of the same
 * accounts. YouTube is the reason serviceId matters: Buffer calls the channel
 * "vash" while Metricool knows it as UCjSfNPTI9Obg3wWNnzvDV9g, and only the id
 * ties those two records to one channel.
 *
 * TIKTOK IS DELIBERATELY UNRESOLVED. Buffer reports `alop_ai`, open id
 * `_000G6u31g687P--Il2sfCsyv5hJAGMubkxU`; Metricool publishes to the handle
 * `userma0e40g4sp`, which is the one in the live video URL. A renamed handle
 * would explain it and so would a second account, and nothing in either API
 * distinguishes those two stories - TikTok's open id is per-application, so it
 * cannot be compared with anything Metricool holds. Until the owner says which,
 * the list keeps only the identifier that was verified, `--channels` exits 1,
 * and no TikTok post can be created. Add `alop_ai` here to unblock it.
 */
export const EXPECTED_ACCOUNTS = Object.freeze({
  instagram: ['alop_ai_', '17841472991142024'],
  tiktok: ['userma0e40g4sp'],
  youtube: ['ALOP-AI', 'vash', 'UCjSfNPTI9Obg3wWNnzvDV9g'],
});
export function mediaUrlFor(reel, { supabaseUrl = process.env.SUPABASE_URL, bucket = 'reels' } = {}) {
  if (!supabaseUrl) throw new Error('SUPABASE_URL is not set, so the public media URL cannot be built.');
  return `${String(supabaseUrl).replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${reel.media}`;
}

/**
 * `YYYY-MM-DD` for the Nth day after a start date, as a CALENDAR date.
 *
 * Anchored at noon UTC rather than at Dubai midnight, and that is the whole
 * point: `2026-08-25T00:00+04:00` is 2026-08-24T20:00Z, so slicing the ISO
 * string of a Dubai midnight hands back YESTERDAY. Caught by the slot test,
 * which is why it asserts the dates and not only the times. The day label here
 * is a calendar fact; the instant is dubaiToUtc's job, further down.
 */
function addDays(date, days) {
  const at = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) throw new Error(`not a date: ${date}`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * BUILD THE PLAN. Pure — no network, no clock beyond what is passed in — so the
 * dry-run and the commit path decide identically and the tests can check the
 * decision rather than the printing.
 *
 * @param {{reels: object[], owners: Map<string, object>, startDate: string,
 *          supabaseUrl?: string, bucket?: string, platforms?: string[]}} input
 * @returns {object[]} one decision per reel/platform pair
 */
export function plan({ reels, owners, startDate, supabaseUrl, bucket = 'reels', platforms = PLATFORMS }) {
  const decisions = [];
  reels.forEach((reel, index) => {
    const date = addDays(startDate, index);
    for (const platform of platforms) {
      const slot = SCHEDULE[platform];
      const caption = reel.captions?.[platform];
      const owner = owners.get(`${reel.id} ${platform}`) || null;
      const mediaUrl = mediaUrlFor(reel, { supabaseUrl, bucket });
      const decision = {
        reelId: reel.id,
        platform,
        dubai: `${date} ${slot.time}`,
        utc: dubaiToUtc(date, slot.time),
        mediaUrl,
        captionSource: `reels.json → ${reel.id}.captions.${platform}`,
        captionHash: caption ? captionHash(caption) : null,
        caption,
        thumbnailOffset: platform === 'youtube' ? null : (reel.thumbnailOffset ?? null),
        scheduler: 'buffer',
        owned: Boolean(owner),
        ownedBy: owner ? owner.scheduler : null,
        ownerStatus: owner ? owner.status : null,
        ownerPostId: owner ? owner.scheduler_post_id : null,
        action: 'create',
        reason: null,
      };
      if (owner) {
        decision.action = 'skip';
        decision.scheduler = owner.scheduler;
        decision.reason = `already owned by ${owner.scheduler} (${owner.status}, post ${owner.scheduler_post_id ?? 'none'})`;
      } else if (!caption) {
        decision.action = 'skip';
        decision.reason = `no ${platform} caption in reels.json`;
      }
      decisions.push(decision);
    }
  });
  return decisions;
}

/** Fixed-width table. The dry-run's only product. */
export function formatPlan(decisions) {
  const lines = [];
  const pad = (s, n) => String(s ?? '').padEnd(n);
  lines.push([pad('REEL', 12), pad('PLATFORM', 10), pad('SCHEDULER', 10), pad('DUBAI', 17), pad('UTC', 21), pad('ACTION', 7), 'OWNERSHIP'].join(' '));
  lines.push('-'.repeat(120));
  for (const d of decisions) {
    lines.push([
      pad(d.reelId, 12),
      pad(d.platform, 10),
      pad(d.scheduler, 10),
      pad(d.dubai, 17),
      pad(d.utc, 21),
      pad(d.action === 'skip' ? 'SKIP' : 'CREATE', 7),
      d.reason || 'free — buffer may claim it',
    ].join(' '));
    lines.push(`${' '.repeat(12)} media   ${d.mediaUrl}`);
    lines.push(`${' '.repeat(12)} caption ${d.captionSource}  sha256:${(d.captionHash || 'none').slice(0, 16)}`);
  }
  const created = decisions.filter((d) => d.action === 'create').length;
  const skipped = decisions.length - created;
  lines.push('-'.repeat(120));
  lines.push(`${decisions.length} pairs — ${created} would be created, ${skipped} refused.`);
  return lines.join('\n');
}

/* ---- CLI ------------------------------------------------------------- */

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(`--${f}`);
  const value = (f, fallback = null) => {
    const at = argv.indexOf(`--${f}`);
    return at === -1 ? fallback : argv[at + 1];
  };

  const store = () => supabaseStore({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const readJson = async (name) => JSON.parse(await readFile(join(HERE, name), 'utf8'));

  if (has('backfill')) {
    const { rows } = await readJson('metricool-backfill.json');
    const ledger = createLedger(store());
    const result = await ledger.backfill(rows);
    console.log(`backfill: ${result.inserted} inserted, ${result.skipped} already present (${rows.length} in file).`);
    process.exit(0);
  }

  if (has('channels')) {
    /* The key is read inside createBufferClient, from the environment, and is
     * never echoed — this branch prints channel names and ids only. */
    const buffer = createBufferClient();
    const orgId = await buffer.organizationId();
    const channels = await buffer.channels(orgId);
    const { channels: resolved, problems } = resolveChannels(channels, EXPECTED_ACCOUNTS);
    console.log(`organization ${orgId}`);
    for (const c of channels) console.log(`  ${c.service.padEnd(10)} ${String(c.name).padEnd(24)} ${c.id}${c.isQueuePaused ? '  (queue paused)' : ''}`);
    console.log(`resolved: ${JSON.stringify(resolved)}`);
    if (problems.length) {
      console.error(`REFUSING to publish:\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }
    process.exit(0);
  }

  const startDate = value('start', new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10));
  const { reels, bucket } = await readJson('reels.json');
  const ledger = createLedger(store());
  const pairs = reels.flatMap((r) => PLATFORMS.map((p) => ({ reelId: r.id, platform: p })));
  const owners = await ledger.ownersOf(pairs);
  const decisions = plan({ reels, owners, startDate, supabaseUrl: process.env.SUPABASE_URL, bucket });

  console.log(formatPlan(decisions));

  if (!has('commit')) {
    console.log('\nDRY RUN — no Buffer createPost calls were made. Re-run with --commit to publish.');
    process.exit(0);
  }

  /* ---- commit ------------------------------------------------------- */

  const buffer = createBufferClient();
  const orgId = await buffer.organizationId();
  const { channels: channelIds, problems } = resolveChannels(await buffer.channels(orgId), EXPECTED_ACCOUNTS);
  if (problems.length) {
    console.error(`REFUSING to publish:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  for (const d of decisions.filter((x) => x.action === 'create')) {
    const reel = reels.find((r) => r.id === d.reelId);
    let claim;
    try {
      /* CLAIM BEFORE CREATE. If the process dies here the pair is held by a
       * `claimed` row with no post id, which is visible and releasable — the
       * opposite order would leave a real Buffer post nothing knows about. */
      claim = await ledger.claim({
        reelId: d.reelId, platform: d.platform, scheduler: 'buffer',
        scheduledAt: d.utc, mediaUrl: d.mediaUrl, caption: d.caption,
      });
    } catch (err) {
      console.log(`skip ${d.reelId}/${d.platform}: ${err.message}`);
      continue;
    }
    try {
      const post = await buffer.createPost({
        channelId: channelIds[d.platform],
        text: d.caption,
        dueAt: d.utc,
        videoUrl: d.mediaUrl,
        thumbnailOffset: d.thumbnailOffset,
        metadata: metadataFor(d.platform, reel),
      });
      await ledger.markScheduled(claim.id, post.id);
      console.log(`created ${d.reelId}/${d.platform} → buffer post ${post.id} at ${d.utc}`);
    } catch (err) {
      /* The create failed, so the claim must not keep holding the pair. */
      await ledger.markFailed(claim.id);
      console.error(`FAILED ${d.reelId}/${d.platform}: ${err.message}`);
    }
  }
}
