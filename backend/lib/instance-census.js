/**
 * How many copies of this service are running, asked of the database rather
 * than assumed.
 *
 * `pg-rate-limit-store.js` exists because the default express-rate-limit store
 * is per-process: on two instances "120 per minute" is 240, silently. It is
 * built, tested, and OFF, behind `RATE_LIMIT_STORE=postgres`, because one
 * instance should not pay a database round trip per request to share a counter
 * with nobody.
 *
 * That leaves the whole design resting on a note in a comment — "set it before
 * scaling past one instance" — and scaling on Render is a dropdown. No deploy,
 * no review, nothing that reads the note. The limits would simply be wrong, and
 * nothing in the system would say so.
 *
 * THIS IS THE PART THAT SAYS SO. Each instance writes one row a minute into the
 * `rate_limits` table that already exists, keyed by its own id and expiring
 * shortly after. Counting the unexpired ones is the instance count, measured.
 * If it is greater than one while the shared store is off, every limit in the
 * service is currently multiplied by that number and the log and /health both
 * say it in those words.
 *
 * IT WARNS RATHER THAN REFUSING TO BOOT, and that is deliberate. A rolling
 * deploy runs the old instance and the new one at the same time by design, so a
 * process that exited on "I can see a second instance" would fail every deploy
 * of a correctly configured single-instance service. The unsafe state here is
 * also not immediately dangerous — it is limits that are too generous, not data
 * at risk — and taking the service down to prevent it would be the larger
 * outage. Same trade the store itself makes when it fails open.
 *
 * NO MIGRATION. `rate_limits` is `(key primary key, count, expires_at)` from
 * 004, which is exactly the shape a heartbeat needs, and the census key carries
 * its own prefix so it can never collide with a limiter's counter — the same
 * prefix rule the store uses to keep limiters apart.
 */

const CENSUS_PREFIX = 'instance-census|';

/** One beat a minute. The row is cheap; the question is only asked at boot and
 *  on the hour-long sweep, so this is about the row being FRESH when asked. */
const HEARTBEAT_MS = 60_000;

/** Two and a half beats. A single missed heartbeat — a slow query, a GC pause —
 *  must not read as an instance that has gone away, because undercounting is
 *  the failure that loses the warning. */
const CENSUS_TTL_MS = 150_000;

/**
 * Render sets `RENDER_INSTANCE_ID` per running instance, which is the id worth
 * having. Everything else is a fallback so this works locally and in a
 * container that sets neither: `pid` is unique within a host, which is enough
 * for the only question being asked (is there more than one of me).
 */
function instanceId(env = process.env) {
  return env.RENDER_INSTANCE_ID || env.HOSTNAME || `pid-${process.pid}`;
}

/**
 * Announce this instance. Upsert rather than the limiter's atomic increment:
 * the increment deliberately does NOT extend an unexpired window — that is what
 * makes it a rate limiter — so a heartbeat through it would let a live
 * instance's row expire underneath it and undercount.
 *
 * @param {object} deps
 * @param {{from: (table: string) => any}} deps.db  the Supabase client
 * @param {string} [deps.id]
 * @param {() => number} [deps.now]
 */
async function heartbeat({ db, id = instanceId(), now = Date.now }) {
  const { error } = await db.from('rate_limits').upsert({
    key: `${CENSUS_PREFIX}${id}`,
    count: 1,
    expires_at: new Date(now() + CENSUS_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
}

/**
 * How many instances have beaten recently.
 *
 * Returns null rather than a number when the read fails. A census that cannot
 * be taken must not be reported as "one instance, all fine" — that is the
 * reassuring answer, and it is the one this exists to avoid giving falsely.
 */
async function countLiveInstances({ db, now = Date.now }) {
  const { data, error } = await db
    .from('rate_limits')
    .select('key')
    .like('key', `${CENSUS_PREFIX}%`)
    .gt('expires_at', new Date(now()).toISOString());
  if (error || !Array.isArray(data)) return null;
  return new Set(data.map((row) => row.key)).size;
}

/**
 * The whole thing: beat, count, and say something when the count and the
 * configuration disagree.
 *
 * @param {object} deps
 * @param {{from: Function}} deps.db
 * @param {boolean} deps.sharedStore     whether RATE_LIMIT_STORE=postgres
 * @param {(line: string) => void} [deps.log]
 * @param {(line: string) => void} [deps.warn]
 * @param {(state: {instances: number|null, unsafe: boolean}) => void} [deps.onCensus]
 * @returns {{stop: () => void, tick: () => Promise<void>}}
 *          `tick` is exposed so a test does not have to wait a minute, and so
 *          the first census happens at boot rather than a minute into it.
 */
function startInstanceCensus({
  db,
  sharedStore,
  log = console.log,
  warn = console.error,
  onCensus = () => {},
  id = instanceId(),
  now = Date.now,
  intervalMs = HEARTBEAT_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  /* `undefined`, not `null`. Null is a real reported state — "the census could
   * not be taken" — and starting there meant the FIRST failed census matched
   * the last-reported value and said nothing at all, which is the one moment
   * this most needs to speak. */
  let lastReported;

  const tick = async () => {
    try {
      await heartbeat({ db, id, now });
      const instances = await countLiveInstances({ db, now });
      const unsafe = !sharedStore && typeof instances === 'number' && instances > 1;
      onCensus({ instances, unsafe });

      /* Reported on change, not every minute. A line that repeats sixty times
       * an hour is one nobody reads, and this has to be readable at the moment
       * someone scales the service. */
      if (instances !== lastReported) {
        lastReported = instances;
        if (instances === null) {
          warn('[census] instance count unavailable — the rate_limits table did not answer. If RATE_LIMIT_STORE is unset, nothing is checking whether the limits are being multiplied.');
        } else if (unsafe) {
          warn(`[census] ${instances} INSTANCES ARE RUNNING AND RATE_LIMIT_STORE IS NOT postgres. Every rate limit in this service is currently ${instances}x its configured value, because the default store counts per process. Set RATE_LIMIT_STORE=postgres. (A rolling deploy shows 2 for a minute or two; sustained is the real thing.)`);
        } else {
          log(`[census] ${instances} instance(s) running, limits ${sharedStore ? 'shared through postgres' : 'per-process and correct at this count'}`);
        }
      }
    } catch (err) {
      warn(`[census] heartbeat failed: ${err.message}`);
      if (lastReported !== null) { lastReported = null; onCensus({ instances: null, unsafe: false }); }
    }
  };

  const timer = setIntervalFn(tick, intervalMs);
  // Never hold the process open for a heartbeat.
  if (typeof timer?.unref === 'function') timer.unref();

  return { tick, stop: () => clearIntervalFn(timer) };
}

module.exports = {
  startInstanceCensus,
  heartbeat,
  countLiveInstances,
  instanceId,
  CENSUS_PREFIX,
  CENSUS_TTL_MS,
  HEARTBEAT_MS,
};
