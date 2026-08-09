import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { speakable, speak, stopSpeaking, isSpeechSupported } from "../lib/speak";

/* Reading an answer out loud.
 *
 * Two things here are worth a test and the rest is plumbing. The first is that
 * markdown is not read as markdown: "hash hash Setup, star star fast star star"
 * is what a naive implementation produces and it is unlistenable. The second is
 * that the button CANNOT be a button that does nothing — the paid voice is
 * optional and every way it can be absent has to reach the free one.
 */

describe("what actually gets read aloud", () => {
  it("does not read the markdown as words", () => {
    const said = speakable("## Setup\n\nUse **fast** mode and `npm run dev`.\n\n- one\n- two");
    expect(said).not.toMatch(/[#*`]/);
    expect(said).toContain("Setup");
    expect(said).toContain("fast");
    expect(said).toContain("npm run dev");
  });

  it("reads a link's text and not its URL", () => {
    // "See https colon slash slash rtings dot com slash monitor" is the failure.
    const said = speakable("See [the review](https://rtings.com/monitors/x?utm=1).");
    expect(said).toBe("See the review.");
  });

  it("summarises a code block rather than spelling it", () => {
    const said = speakable("Try this:\n\n```js\nconst x = () => ({a: 1});\n```\n\nDone.");
    expect(said).not.toContain("=>");
    expect(said).toContain("Code block");
    expect(said).toContain("Done.");
  });

  it("truncates a long answer at a sentence, not mid-word", () => {
    const long = "This is a sentence. ".repeat(400);
    const said = speakable(long);
    expect(said.length).toBeLessThanOrEqual(3000);
    expect(said.endsWith(".")).toBe(true);
  });

  it("survives what is not a string", () => {
    expect(speakable(undefined)).toBe("");
    expect(speakable(null)).toBe("");
    expect(speakable(42)).toBe("");
  });
});

describe("choosing a voice", () => {
  let spoken;
  let cancelled;

  beforeEach(() => {
    spoken = [];
    cancelled = 0;
    global.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    window.speechSynthesis = {
      speak: (u) => spoken.push(u),
      cancel: () => {
        cancelled++;
      },
    };
  });

  afterEach(() => {
    delete window.speechSynthesis;
    delete global.SpeechSynthesisUtterance;
  });

  /* ONE TEST, NOT TWO, and deliberately.
   *
   * "the server has no key" and "it stops asking" are the same run: the module
   * remembers a 501 for the life of the page, so a second test asserting the
   * first call would see zero calls and fail on nothing but ordering. Splitting
   * them produced exactly that. */
  it("falls back to the browser voice when the server has no key, and stops asking", async () => {
    // 501 is what /api/speech answers with FISH_AUDIO_API_KEY unset. Falling
    // through is the difference between an optional upgrade and a broken button
    // on every deployment that has not paid for one.
    const apiCall = vi.fn(async () => ({ status: 501, ok: false }));
    await speak("Hello there.", { apiCall });
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("Hello there.");

    await speak("Second answer.", { apiCall });
    expect(apiCall, "a route that cannot work should not be called once a message").toHaveBeenCalledTimes(1);
    expect(spoken).toHaveLength(2);
  });

  it("uses the browser voice when the request throws", async () => {
    const apiCall = vi.fn(async () => {
      throw new Error("network down");
    });
    await speak("Still speaks.", { apiCall });
    expect(spoken).toHaveLength(1);
  });

  it("speaks with no apiCall at all", async () => {
    await speak("Local only.");
    expect(spoken).toHaveLength(1);
  });

  it("says nothing for an empty answer, and still reports it ended", async () => {
    const onEnd = vi.fn();
    await speak("   ", { onEnd });
    expect(spoken).toHaveLength(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("tells the interrupted caller it stopped", async () => {
    // Otherwise the first answer's button reads "Stop" for an utterance that
    // is no longer playing, and only a click on a dead control fixes it.
    const first = vi.fn();
    await speak("First answer.", { onEnd: first });
    expect(first).not.toHaveBeenCalled();

    await speak("Second answer.", { onEnd: () => {} });
    expect(first).toHaveBeenCalledTimes(1);
    expect(cancelled).toBeGreaterThan(0);
  });

  it("reports onEnd exactly once when stopped after finishing", async () => {
    const onEnd = vi.fn();
    await speak("Done.", { onEnd });
    spoken[0].onend();
    stopSpeaking();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("knows whether a voice exists at all", () => {
    expect(isSpeechSupported()).toBe(true);
  });
});
