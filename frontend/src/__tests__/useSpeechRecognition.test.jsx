import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

/**
 * SpeechRecognition does not exist in jsdom in any form, so the whole API is
 * faked here. That is not a compromise — the logic worth testing is the
 * lifecycle around it: the ten-second cap, resetting state on end, and
 * stopping when the component unmounts.
 */
let instances = [];

class FakeRecognition {
  constructor() {
    this.started = false;
    this.stopped = false;
    instances.push(this);
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.stopped = true;
    this.onend?.();
  }
}

beforeEach(() => {
  instances = [];
  vi.useFakeTimers();
  window.SpeechRecognition = FakeRecognition;
});

afterEach(() => {
  vi.useRealTimers();
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
});

describe("useSpeechRecognition", () => {
  it("reports the unsupported browser instead of throwing", () => {
    delete window.SpeechRecognition;
    const onUnsupported = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onUnsupported }));

    act(() => result.current.start());

    expect(onUnsupported).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
  });

  it("accepts the webkit-prefixed constructor", () => {
    delete window.SpeechRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
    const { result } = renderHook(() => useSpeechRecognition({}));

    act(() => result.current.start());

    expect(result.current.isListening).toBe(true);
  });

  it("toggles listening on and off", () => {
    const { result } = renderHook(() => useSpeechRecognition({}));

    act(() => result.current.toggle());
    expect(result.current.isListening).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.isListening).toBe(false);
  });

  it("stops itself after ten seconds", () => {
    // Without the cap, a session that never fires onend — which happens when
    // the tab loses focus mid-listen — leaves the mic indicator lit forever
    // with no way for the user to clear it.
    const { result } = renderHook(() => useSpeechRecognition({}));

    act(() => result.current.start());
    expect(result.current.isListening).toBe(true);

    act(() => vi.advanceTimersByTime(10_000));

    expect(instances[0].stopped).toBe(true);
    expect(result.current.isListening).toBe(false);
  });

  it("hands the joined transcript to the caller", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }));

    act(() => result.current.start());
    act(() =>
      instances[0].onresult({
        resultIndex: 0,
        results: [[{ transcript: "hello" }], [{ transcript: " world" }]],
      })
    );

    expect(onTranscript).toHaveBeenCalledWith("hello world ");
  });

  it("ignores an empty transcript", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }));

    act(() => result.current.start());
    act(() => instances[0].onresult({ resultIndex: 0, results: [[{ transcript: "   " }]] }));

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("clears listening state when recognition errors", () => {
    const { result } = renderHook(() => useSpeechRecognition({}));

    act(() => result.current.start());
    act(() => instances[0].onerror({ error: "no-speech" }));

    expect(result.current.isListening).toBe(false);
  });

  it("stops a live session on unmount", () => {
    // Otherwise the browser's microphone indicator stays lit after the UI is
    // gone, which reads to the user as the app still recording.
    const { result, unmount } = renderHook(() => useSpeechRecognition({}));

    act(() => result.current.start());
    unmount();

    expect(instances[0].stopped).toBe(true);
  });
});
