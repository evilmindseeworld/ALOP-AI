import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OverlayAssistant from "../overlay/OverlayAssistant";

/**
 * The overlay had no tests at all, and it is the piece most worth not shipping
 * blind: 144 lines over getDisplayMedia, SpeechRecognition and speechSynthesis
 * — the app's only screen-capture surface — none of which exist in jsdom.
 *
 * They are faked PER TEST rather than in setup.js, deliberately and following
 * the convention already recorded in FRONTEND.md §7: the lifecycle around them
 * is the part worth asserting, and a global fake makes "did this get cleaned
 * up?" unanswerable because every test shares one object.
 *
 * What is actually being guarded here:
 *
 *   1. A capture stream must be STOPPED. A screen-share left running after the
 *      component unmounts is a recording light that stays on, which is the
 *      worst bug this file could have.
 *   2. A failed answer must not look like a successful one.
 *   3. The Escape and alop-focus wiring, which is how the desktop overlay is
 *      driven and cannot be exercised by clicking.
 */

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => "test-token" }),
}));

// react-draggable reaches for DOM APIs jsdom does not implement and adds
// nothing to what is being tested here.
vi.mock("react-draggable", () => ({
  default: ({ children }) => children,
}));

/** A fake display-media track that records whether it was stopped. */
const makeStream = () => {
  const track = { kind: "video", stop: vi.fn(), onended: null };
  return { stream: { getTracks: () => [track], getVideoTracks: () => [track] }, track };
};

/**
 * speechSynthesis is installed ONCE and never torn down, unlike getDisplayMedia
 * which is set per test.
 *
 * The reason is a real trap. Vitest runs afterEach hooks LIFO, and
 * @testing-library/react registers its auto-cleanup afterEach when it is
 * imported — before the ones in this file. So a teardown here runs BEFORE the
 * unmount it is meant to clean up after, and the component's own cleanup path
 * (which calls speechSynthesis.cancel) then runs against a property this file
 * had already removed. Every test failed on the previous test's unmount.
 *
 * jsdom has no speechSynthesis at all, so leaving the fake installed is both
 * simpler and closer to reality than restoring `undefined`.
 */
const speech = { cancel: vi.fn(), speak: vi.fn() };
Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speech });
window.SpeechSynthesisUtterance = function (text) {
  this.text = text;
};

let originalMediaDevices;

beforeEach(() => {
  originalMediaDevices = navigator.mediaDevices;
  speech.cancel.mockClear();
  speech.speak.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setDisplayMedia = (impl) =>
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia: impl },
  });

const answerWith = (body, ok = true, status = 200) =>
  fetch.mockResolvedValue({ ok, status, json: async () => body });

describe("OverlayAssistant", () => {
  it("renders a prompt bar ready to type in", () => {
    render(<OverlayAssistant />);
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeInTheDocument();
  });

  it("sends the question and shows the answer", async () => {
    answerWith({ answer: "The XG27AQWMG." });
    const user = userEvent.setup();
    render(<OverlayAssistant />);

    await user.type(screen.getByPlaceholderText(/Ask anything/i), "which monitor?{Enter}");

    expect(await screen.findByText("The XG27AQWMG.")).toBeInTheDocument();
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body).prompt).toBe("which monitor?");
    expect(init.headers.Authorization).toBe("Bearer test-token");
  });

  it("clears the input after a successful answer, so the next question starts clean", async () => {
    answerWith({ answer: "Done." });
    const user = userEvent.setup();
    render(<OverlayAssistant />);
    const input = screen.getByPlaceholderText(/Ask anything/i);

    await user.type(input, "hello{Enter}");
    await screen.findByText("Done.");
    expect(input).toHaveValue("");
  });

  it("SHOWS A FAILURE AS A FAILURE", async () => {
    // The overlay speaks its answers aloud. An error rendered as an answer
    // would be read out as though it were one.
    answerWith({}, false, 500);
    const user = userEvent.setup();
    render(<OverlayAssistant />);

    await user.type(screen.getByPlaceholderText(/Ask anything/i), "hi{Enter}");

    expect(await screen.findByText(/Error/i)).toBeInTheDocument();
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("says plainly that the session expired on a 401", async () => {
    answerWith({}, false, 401);
    const user = userEvent.setup();
    render(<OverlayAssistant />);

    await user.type(screen.getByPlaceholderText(/Ask anything/i), "hi{Enter}");

    expect(await screen.findByText(/sign in again/i)).toBeInTheDocument();
  });

  it("does not send an empty question", async () => {
    const user = userEvent.setup();
    render(<OverlayAssistant />);
    await user.type(screen.getByPlaceholderText(/Ask anything/i), "   {Enter}");
    expect(fetch).not.toHaveBeenCalled();
  });

  // ===== screen capture =====

  it("starts a screen share and reports it as live", async () => {
    const { stream } = makeStream();
    setDisplayMedia(vi.fn().mockResolvedValue(stream));
    const user = userEvent.setup();
    render(<OverlayAssistant />);

    await user.click(screen.getByTitle("Start live screen"));

    expect(await screen.findByTitle("Stop live screen")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Live screen active/i)).toBeInTheDocument();
  });

  it("STOPS EVERY TRACK WHEN THE STREAM IS TURNED OFF", async () => {
    // A screen share left running is a recording indicator that stays lit
    // after the user thinks they stopped sharing. This is the assertion that
    // most justifies the file existing.
    const { stream, track } = makeStream();
    setDisplayMedia(vi.fn().mockResolvedValue(stream));
    const user = userEvent.setup();
    render(<OverlayAssistant />);

    await user.click(screen.getByTitle("Start live screen"));
    await user.click(await screen.findByTitle("Stop live screen"));

    expect(track.stop).toHaveBeenCalled();
    expect(await screen.findByTitle("Start live screen")).toBeInTheDocument();
  });

  it("STOPS THE STREAM ON UNMOUNT", async () => {
    // The overlay window is hidden rather than navigated away from, so unmount
    // is the only cleanup hook there is.
    const { stream, track } = makeStream();
    setDisplayMedia(vi.fn().mockResolvedValue(stream));
    const user = userEvent.setup();
    const { unmount } = render(<OverlayAssistant />);

    await user.click(screen.getByTitle("Start live screen"));
    await screen.findByTitle("Stop live screen");
    unmount();

    expect(track.stop).toHaveBeenCalled();
  });

  it("a user who cancels the share picker leaves the overlay usable", async () => {
    // getDisplayMedia rejects with NotAllowedError when the picker is
    // dismissed, which is a normal thing to do and not an error state.
    setDisplayMedia(vi.fn().mockRejectedValue(new Error("NotAllowedError")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<OverlayAssistant />);

    await user.click(screen.getByTitle("Start live screen"));

    expect(await screen.findByTitle("Start live screen")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ask anything/i)).not.toBeDisabled();
  });

  it("stops speaking when asked", async () => {
    answerWith({ answer: "Spoken." });
    const user = userEvent.setup();
    render(<OverlayAssistant />);

    await user.type(screen.getByPlaceholderText(/Ask anything/i), "hi{Enter}");
    await screen.findByText("Spoken.");
    expect(window.speechSynthesis.speak).toHaveBeenCalled();

    await user.click(screen.getByText("■"));
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  // ===== the desktop wiring, which cannot be reached by clicking =====

  it("refocuses the input on alop-focus, which is how F9 drives it", async () => {
    // The Tauri shell shows the overlay window and dispatches this event. If
    // the listener goes, pressing F9 shows a bar you then have to click.
    render(<OverlayAssistant />);
    const input = screen.getByPlaceholderText(/Ask anything/i);
    input.blur();

    window.dispatchEvent(new CustomEvent("alop-focus"));

    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("Escape asks the shell to hide the window", async () => {
    window.alopHideOverlay = vi.fn();
    render(<OverlayAssistant />);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(window.alopHideOverlay).toHaveBeenCalled();
    delete window.alopHideOverlay;
  });

  it("removes its listeners on unmount", async () => {
    // Two overlay mounts leaving four listeners is how a hidden window starts
    // stealing focus from the main one.
    const { unmount } = render(<OverlayAssistant />);
    unmount();
    window.alopHideOverlay = vi.fn();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(window.alopHideOverlay).not.toHaveBeenCalled();
    delete window.alopHideOverlay;
  });
});
