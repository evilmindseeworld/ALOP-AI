/**
 * Turning the network's cadence into a readable one.
 *
 * WHAT WAS ACTUALLY WRONG, measured against the real gateway rather than
 * guessed at. Asked for a 300-word answer, `glm-5.2` returned 1679 characters
 * in 57 frames — 29.5 characters per frame — with the first frame at 9.8s and
 * the last at 11.5s. So the stream is real and the plumbing is correct: SSE
 * headers, X-Accel-Buffering, `stream: true` upstream, per-read React state.
 * Everything downstream of the model works.
 *
 * The problem is that only 15% of the wait is spent streaming, and when text
 * does arrive it arrives in 29-character jumps. Painting each frame the instant
 * it lands reproduces the network's rhythm exactly, and the network's rhythm is
 * lumpy. Reported as "the messages just pop in".
 *
 * So this decouples the two. Frames accumulate into a target; the view advances
 * toward that target on a timer at a rate derived from how far behind it is.
 * A 29-character jump becomes four or five smaller steps, which reads as
 * writing rather than as pasting.
 *
 * IT IS NOT A FIXED TYPING SPEED, and that distinction is the whole design. A
 * constant characters-per-second looks right until the model outruns it, and
 * then the text lags further behind on every frame and finishes seconds after
 * the answer actually did — a fake typewriter that makes the product SLOWER.
 * The rate here is proportional to the backlog, so it is self-correcting: the
 * further behind it falls the faster it catches up, and it can never diverge.
 *
 * Nothing here delays completion. `finish()` reveals everything at once, and
 * the caller saves the full text regardless of what has been revealed.
 */

/**
 * How much of the backlog to consume per tick.
 *
 * At ~60fps a factor of 0.18 clears a backlog to under a character in about 25
 * frames, so the view is never more than ~400ms behind the stream — under a
 * second, which is the point at which a reader starts to feel lag rather than
 * flow. Higher is jumpier, lower is laggier; this was tuned against the 29.5
 * characters-per-frame the real gateway produces.
 */
const CATCH_UP = 0.18;

/** Always move at least this much, or a small backlog would crawl forever. */
const MIN_STEP = 2;

/**
 * One step of the reveal.
 *
 * Pure, so the pacing can be tested without a browser, a timer, or React.
 *
 * @param {number} visible   characters currently shown
 * @param {number} target    characters available to show
 * @param {number} [factor]
 * @returns {number} the new visible count, never above target, never below visible
 */
export function nextVisible(visible, target, factor = CATCH_UP) {
  if (!(target > visible)) return target < 0 ? 0 : Math.min(visible, target);
  const backlog = target - visible;
  const step = Math.max(MIN_STEP, Math.ceil(backlog * factor));
  return Math.min(target, visible + step);
}

/**
 * A reveal that walks a growing string.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.instant]  reveal everything immediately
 *
 *   NOT wired to prefers-reduced-motion, and that was a real bug: doing so
 *   disabled progressive text on exactly the machines that have the setting
 *   on, including the one that reported the problem. Reduced motion is about
 *   MOVEMENT — translation, scale, parallax — because that is what provokes
 *   vestibular symptoms. Text becoming readable in the order it was written is
 *   content delivery. The option is kept for callers that genuinely want the
 *   whole string at once, such as replaying a saved message.
 * @param {number} [opts.factor]
 */
export function createReveal({ instant = false, factor = CATCH_UP } = {}) {
  let target = "";
  let visible = 0;

  return {
    /** The full text received so far. Safe to call with the same value twice. */
    push(text) {
      target = typeof text === "string" ? text : "";
      if (instant) visible = target.length;
      // A shorter target means the message was replaced, not appended to —
      // a retry, or a stop-then-resend. Snapping back avoids showing text from
      // the previous answer.
      if (visible > target.length) visible = target.length;
    },

    /** Advance one tick and return what should be on screen. */
    tick() {
      if (!instant) visible = nextVisible(visible, target.length, factor);
      return target.slice(0, visible);
    },

    /** Everything, now. Called when the stream ends or is aborted. */
    finish() {
      visible = target.length;
      return target;
    },

    /** Has the view caught up with everything received? */
    get settled() {
      return visible >= target.length;
    },
  };
}

export default createReveal;
