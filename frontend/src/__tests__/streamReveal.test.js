import { describe, it, expect } from "vitest";
import { nextVisible, createReveal } from "../lib/streamReveal";

/* The pacing, tested without a browser or a timer.
 *
 * The property that matters is not "it looks like typing" — that is a taste
 * judgement. It is that the reveal CANNOT FALL PERMANENTLY BEHIND. A fixed
 * characters-per-second reveal looks correct in a demo and then diverges the
 * moment the model outruns it, finishing seconds after the answer did and
 * making the product measurably slower while looking prettier. Every test here
 * is really about that.
 */
describe("stream reveal pacing", () => {
  it("advances toward the target and never past it", () => {
    expect(nextVisible(0, 100)).toBeGreaterThan(0);
    expect(nextVisible(0, 100)).toBeLessThan(100);
    expect(nextVisible(99, 100)).toBe(100);
    expect(nextVisible(100, 100)).toBe(100);
  });

  it("never goes backwards on a target that is still growing", () => {
    let v = 0;
    for (let i = 0; i < 50; i++) {
      const next = nextVisible(v, 500);
      expect(next).toBeGreaterThanOrEqual(v);
      v = next;
    }
  });

  it("catches up faster the further behind it is", () => {
    // Proportional, not constant. This is the property that stops it diverging.
    const smallStep = nextVisible(0, 20) - 0;
    const bigStep = nextVisible(0, 5000) - 0;
    expect(bigStep).toBeGreaterThan(smallStep);
  });

  it("converges on a target that stops growing", () => {
    let v = 0;
    let ticks = 0;
    while (v < 1679 && ticks < 500) {
      v = nextVisible(v, 1679);
      ticks++;
    }
    expect(v).toBe(1679);
    // 1679 characters is the real measured length of a 300-word answer from the
    // gateway. At ~60fps this must land well under a second after the last
    // frame, or the smoothing is costing the user time.
    expect(ticks, `took ${ticks} ticks — roughly ${Math.round(ticks * 16.7)}ms behind`).toBeLessThan(60);
  });

  it("keeps up with a stream that is still arriving", () => {
    // The real shape: 57 frames of ~29 characters. Reveal one tick per frame
    // and check the view is close behind by the end, not minutes behind.
    const reveal = createReveal();
    let text = "";
    for (let f = 0; f < 57; f++) {
      text += "x".repeat(29);
      reveal.push(text);
      reveal.tick();
    }
    const shown = reveal.tick().length;
    expect(shown).toBeGreaterThan(text.length * 0.5);
  });
});

describe("stream reveal behaviour", () => {
  it("shows everything immediately when motion is not wanted", () => {
    // prefers-reduced-motion: animated text is precisely the thing being
    // objected to, so there is nothing to soften.
    const reveal = createReveal({ instant: true });
    reveal.push("the whole answer");
    expect(reveal.tick()).toBe("the whole answer");
    expect(reveal.settled).toBe(true);
  });

  it("finish() reveals everything at once", () => {
    const reveal = createReveal();
    reveal.push("a".repeat(400));
    reveal.tick();
    expect(reveal.finish()).toHaveLength(400);
    expect(reveal.settled).toBe(true);
  });

  it("snaps back when the message is replaced rather than appended to", () => {
    // A retry or a stop-then-resend gives a SHORTER target. Without this the
    // view would keep showing the tail of the previous answer.
    const reveal = createReveal();
    reveal.push("a".repeat(500));
    reveal.finish();
    reveal.push("short");
    expect(reveal.tick()).toBe("short");
  });

  it("survives empty and malformed pushes", () => {
    const reveal = createReveal();
    reveal.push("");
    expect(reveal.tick()).toBe("");
    reveal.push(undefined);
    expect(reveal.tick()).toBe("");
    expect(reveal.settled).toBe(true);
  });
});

/* Does it actually look smoother? Simulated against the REAL measured shape.
 *
 * The gateway delivered 1679 characters as 57 frames of ~29, over 1740ms. The
 * old behaviour painted once per network read, so the number of visible steps
 * was the number of reads. This asserts the reveal turns that into many more,
 * smaller steps — which is the entire user-visible claim.
 */
describe("smoothness against the measured gateway shape", () => {
  const FRAMES = 57;
  const CHARS_PER_FRAME = 29;
  const STREAM_MS = 1740;

  it("paints far more steps than the network provides, in smaller increments", () => {
    const reveal = createReveal();
    const paints = [];
    let painted = "";
    let text = "";

    // 16ms painter ticks across the same 1740ms window, with frames arriving
    // at their measured cadence.
    const ticks = Math.round(STREAM_MS / 16);
    const frameEvery = ticks / FRAMES;
    for (let t = 0; t < ticks; t++) {
      if (Math.floor(t / frameEvery) > Math.floor((t - 1) / frameEvery)) {
        text += "x".repeat(CHARS_PER_FRAME);
        reveal.push(text);
      }
      const shown = reveal.tick();
      if (shown !== painted) {
        paints.push(shown.length - painted.length);
        painted = shown;
      }
    }

    expect(paints.length, "should paint many more times than the 57 network frames").toBeGreaterThan(FRAMES);
    const biggestJump = Math.max(...paints);
    expect(
      biggestJump,
      `largest single jump was ${biggestJump} characters — the raw stream jumps ${CHARS_PER_FRAME}`
    ).toBeLessThan(CHARS_PER_FRAME);
  });

  it("does not finish meaningfully later than the stream did", () => {
    // The failure mode of every fake typewriter: prettier, and slower.
    const reveal = createReveal();
    reveal.push("x".repeat(FRAMES * CHARS_PER_FRAME));
    let ticks = 0;
    while (!reveal.settled && ticks < 1000) {
      reveal.tick();
      ticks++;
    }
    const msBehind = ticks * 16;
    expect(msBehind, `${msBehind}ms behind the stream`).toBeLessThan(700);
  });
});
