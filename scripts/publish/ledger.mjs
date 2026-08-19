/**
 * THE PUBLISHING LEDGER: who owns the right to publish a reel to a platform.
 *
 * Two schedulers write to the same three accounts. Metricool holds the batch
 * already in its planner; Buffer is being added for capacity. Nothing about
 * either API prevents both of them posting the same video to the same channel,
 * so the prevention lives here — and specifically in `publishing_ledger`'s
 * partial unique index, not in the checks below.
 *
 * THAT DISTINCTION IS THE DESIGN. `isOwned` exists to give the planner a
 * readable answer, not to make the write safe: between its SELECT and the
 * INSERT that follows, the other scheduler can land. `claim` therefore does not
 * trust it — it INSERTs and lets 23505 come back, which is a refusal a caller
 * cannot forget to handle. Read the check as a courtesy and the constraint as
 * the guard.
 *
 * The database handle is injected rather than imported so the tests can run the
 * whole state machine — claim, schedule, fail, re-claim — without a network,
 * against a fake that enforces the same predicate the index does. The index
 * itself is verified against real Postgres; a fake cannot prove a constraint.
 */

import { createHash } from 'node:crypto';

/** Statuses that hold the pair. `published` still owns it: releasing on publish
 * would let the other scheduler post the same reel tomorrow, which is the
 * duplicate this table exists to stop. */
export const ACTIVE_STATUSES = Object.freeze(['claimed', 'scheduled', 'published']);
export const PLATFORMS = Object.freeze(['instagram', 'tiktok', 'youtube']);
export const SCHEDULERS = Object.freeze(['metricool', 'buffer']);

/** Postgres unique_violation. Supabase surfaces it as `code` on the error. */
const UNIQUE_VIOLATION = '23505';

export class LedgerConflict extends Error {
  constructor(reelId, platform, owner) {
    super(`${reelId}/${platform} is already owned by ${owner?.scheduler || 'another scheduler'} (status ${owner?.status || 'unknown'})`);
    this.name = 'LedgerConflict';
    this.reelId = reelId;
    this.platform = platform;
    this.owner = owner || null;
  }
}

/**
 * The caption identity. Hashed rather than stored so the ledger never becomes a
 * second copy of the copy — and so a reworded caption for a reel/platform pair
 * is visible as a different value rather than as an equal one.
 *
 * Normalised on whitespace only. Trailing newlines differ between a JSON file
 * and a planner paste for reasons that have nothing to do with the text.
 *
 * @param {string} caption
 * @returns {string} sha256 hex
 */
export function captionHash(caption) {
  const text = String(caption ?? '').replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Supabase-backed store, over PostgREST and plain `fetch`.
 *
 * NO supabase-js, deliberately. These scripts live outside `backend/`, so
 * importing the SDK means resolving a dependency from a directory that has no
 * package.json of its own - and the SDK would be doing nothing here that three
 * fetches do not already do. The cost of the choice is that the 23505 has to be
 * dug out of the response body by hand, which is the `code` line below.
 *
 * @param {{url: string, key: string, fetchImpl?: Function, table?: string}} options
 */
export function supabaseStore({ url, key, fetchImpl = globalThis.fetch, table = 'publishing_ledger' }) {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for the publishing ledger.');
  const base = `${String(url).replace(/\/$/, '')}/rest/v1/${table}`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  const request = async (what, target, init = {}) => {
    const res = await fetchImpl(target, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const raw = await res.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* PostgREST answers JSON or nothing */ }
    if (!res.ok) {
      const err = new Error(`ledger ${what} failed (HTTP ${res.status}): ${body?.message || raw.slice(0, 200)}`);
      /* The uniqueness violation has to survive as a CODE, not as a string:
       * `claim` turns it into a refusal and anything else into a crash. */
      err.code = body?.code || String(res.status);
      throw err;
    }
    return body;
  };

  const list = (v) => `(${v.map((s) => `"${String(s).replace(/"/g, '')}"`).join(',')})`;

  return {
    async activeFor(pairs) {
      if (!pairs.length) return [];
      const reels = [...new Set(pairs.map((p) => p.reelId))];
      const query = `${base}?select=*&reel_id=in.${list(reels)}&status=in.${list(ACTIVE_STATUSES)}`;
      const rows = (await request('read', query)) || [];
      const wanted = new Set(pairs.map((p) => `${p.reelId} ${p.platform}`));
      return rows.filter((r) => wanted.has(`${r.reel_id} ${r.platform}`));
    },
    async insert(row) {
      const rows = await request('insert', base, { method: 'POST', body: JSON.stringify(row) });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async update(id, patch) {
      const rows = await request('update', `${base}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async all() {
      return (await request('read', `${base}?select=*&order=scheduled_at.asc`)) || [];
    },
  };
}

export function createLedger(store) {
  const owners = async (pairs) => {
    const rows = await store.activeFor(pairs);
    const byPair = new Map();
    for (const row of rows) byPair.set(`${row.reel_id} ${row.platform}`, row);
    return byPair;
  };

  return {
    /**
     * Is this pair spoken for, and by whom? For the planner's report. NOT a
     * lock — see the header.
     */
    async ownerOf(reelId, platform) {
      const map = await owners([{ reelId, platform }]);
      return map.get(`${reelId} ${platform}`) || null;
    },

    async ownersOf(pairs) {
      return owners(pairs);
    },

    /**
     * Reserve the pair. The INSERT is the lock.
     *
     * @throws {LedgerConflict} when another active row already holds the pair
     */
    async claim({ reelId, platform, scheduler, scheduledAt, mediaUrl, caption, schedulerPostId = null }) {
      if (!PLATFORMS.includes(platform)) throw new Error(`unknown platform: ${platform}`);
      if (!SCHEDULERS.includes(scheduler)) throw new Error(`unknown scheduler: ${scheduler}`);
      const row = {
        reel_id: reelId,
        platform,
        scheduler,
        scheduler_post_id: schedulerPostId,
        scheduled_at: new Date(scheduledAt).toISOString(),
        status: 'claimed',
        media_url: mediaUrl,
        caption_hash: captionHash(caption),
      };
      try {
        return await store.insert(row);
      } catch (err) {
        if (err?.code !== UNIQUE_VIOLATION) throw err;
        /* Read back WHO won, because "someone else got it" and "Metricool has
         * had it since Tuesday" call for different responses from the operator
         * looking at the dry-run output. */
        const owner = await this.ownerOf(reelId, platform);
        throw new LedgerConflict(reelId, platform, owner);
      }
    },

    /** The scheduler accepted it and gave us an id. */
    async markScheduled(id, schedulerPostId) {
      return store.update(id, { status: 'scheduled', scheduler_post_id: schedulerPostId ?? null });
    },

    async markPublished(id, schedulerPostId = undefined) {
      const patch = { status: 'published' };
      if (schedulerPostId !== undefined) patch.scheduler_post_id = schedulerPostId;
      return store.update(id, patch);
    },

    /**
     * The API refused. `failed` is outside the active set, so the pair is free
     * again — a create that never happened must not hold the slot for ever.
     */
    async markFailed(id) {
      return store.update(id, { status: 'failed' });
    },

    async markCancelled(id) {
      return store.update(id, { status: 'cancelled' });
    },

    /**
     * Import publications that already exist in a scheduler's planner.
     *
     * Idempotent by the same constraint everything else leans on: re-running it
     * hits 23505 on every row that is already there and reports it as `skipped`
     * rather than failing the run. That matters because the backfill is a
     * prerequisite for Buffer being allowed to write anything, and a
     * prerequisite you are afraid to re-run is one that silently goes stale.
     */
    async backfill(rows) {
      const result = { inserted: 0, skipped: 0, rows: [] };
      for (const row of rows) {
        try {
          const saved = await store.insert({
            reel_id: row.reelId,
            platform: row.platform,
            scheduler: row.scheduler,
            scheduler_post_id: row.schedulerPostId ?? null,
            scheduled_at: new Date(row.scheduledAt).toISOString(),
            status: row.status,
            media_url: row.mediaUrl,
            caption_hash: captionHash(row.caption),
          });
          result.inserted += 1;
          result.rows.push(saved);
        } catch (err) {
          if (err?.code !== UNIQUE_VIOLATION) throw err;
          result.skipped += 1;
        }
      }
      return result;
    },
  };
}
