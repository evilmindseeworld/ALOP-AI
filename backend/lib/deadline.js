/**
 * Take what has arrived by a deadline; do not wait for stragglers.
 *
 * THE PROBLEM THIS SOLVES. comprehensiveSearch fans out to Tavily, Brave,
 * Google web, Google images and Wikipedia with a single Promise.all, so it is
 * exactly as slow as the SLOWEST of the five. Their timeouts are 7-8 seconds.
 * If Brave answers in 300ms with everything the question needed, and Google is
 * having a bad day, the user waits eight seconds to be shown Brave's results.
 *
 * The council already solved this for models — runCouncilWithWhip resolves the
 * moment a quorum has answered and lets the rest arrive whenever. This is the
 * same idea for the search fan-out, and the naming follows it deliberately.
 *
 * TWO PROPERTIES THAT MATTER MORE THAN THE SPEED:
 *
 *   It never rejects. A provider that throws contributes its fallback, exactly
 *   as a provider that timed out does. Search degrading to four sources is not
 *   an error worth failing a turn over.
 *
 *   Stragglers are ignored, NOT cancelled, and their rejections are swallowed.
 *   A promise that settles after the deadline with nobody listening is an
 *   unhandled rejection, which in Node is a process-level event and in
 *   production is a crash on the wrong config.
 */

/**
 * @param {Array<{promise: Promise, fallback: *}>} entries
 * @param {object} opts
 * @param {number} opts.deadlineMs   hard stop; whatever has landed is returned
 * @param {(results: Array) => boolean} [opts.enough]
 *        Called as results land. Returning true resolves immediately — the
 *        equivalent of the council's quorum. Receives the current array, with
 *        fallbacks still in place for anything outstanding.
 * @returns {Promise<{results: Array, waited: number, pending: number}>}
 */
function settleByDeadline(entries, { deadlineMs = 3000, enough } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const started = Date.now();

  return new Promise((resolve) => {
    if (!list.length) return resolve({ results: [], waited: 0, pending: 0 });

    const results = list.map((e) => e.fallback);
    let settled = 0;
    let done = false;

    /* `enough` is the caller's code, and the call below it lives inside a
     * `then` whose promise nobody holds. A predicate that throws therefore
     * produces the unhandled rejection this whole file exists to avoid, through
     * the one path the fallbacks above do not cover. A predicate that cannot
     * answer has not said "enough" — the deadline still applies. */
    const enoughNow = () => {
      if (typeof enough !== "function") return false;
      try {
        return enough(results);
      } catch {
        return false;
      }
    };

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ results, waited: Date.now() - started, pending: list.length - settled });
    };

    const timer = setTimeout(finish, deadlineMs);
    // A deadline that keeps the process alive after the work is done is a
    // hang, not a timeout.
    timer.unref?.();

    list.forEach((entry, i) => {
      Promise.resolve(entry.promise).then(
        (value) => {
          settled++;
          // A late arrival must not mutate an array the caller already has.
          if (done) return;
          results[i] = value;
          if (settled === list.length) return finish();
          if (enoughNow()) return finish();
        },
        () => {
          // Rejection is indistinguishable from a timeout here: the fallback
          // stays, and the turn continues with one fewer source. Swallowed
          // deliberately — see the note at the top.
          settled++;
          if (done) return;
          if (settled === list.length) finish();
        },
      );
    });

    /* ASKED ONCE MORE HERE, WITH NOTHING SETTLED, because `enough` is not
     * always a question about what arrived in THIS call. The agent loop's
     * quorum counts the answers it already had from earlier rounds — so a round
     * whose quorum was met before it started would otherwise sit out its entire
     * deadline waiting for a reply to trigger the check, and the case where
     * nothing settles at all is exactly the case that must not wait.
     *
     * AFTER the handlers are attached, not before: returning early from the
     * executor would leave every entry's promise unobserved, and a rejection
     * with nobody listening is the process-level event the note at the top of
     * this file exists to avoid. Nothing can have settled between the two
     * statements — `then` never runs synchronously — so `results` here is still
     * every fallback, which is what the caller's predicate expects. */
    if (enoughNow()) finish();
  });
}

module.exports = { settleByDeadline };
