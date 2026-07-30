import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCamera } from "../hooks/useCamera";

const fakeTrack = () => ({ stop: vi.fn() });

const fakeStream = () => {
  const tracks = [fakeTrack(), fakeTrack()];
  return { getTracks: () => tracks, tracks };
};

beforeEach(() => {
  vi.useFakeTimers();
  navigator.mediaDevices = { getUserMedia: vi.fn(async () => fakeStream()) };
});

afterEach(() => {
  vi.useRealTimers();
  delete navigator.mediaDevices;
});

describe("useCamera", () => {
  it("reports a denied permission instead of throwing", async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useCamera({ onCapture: vi.fn(), onError }));

    await act(async () => {
      await result.current.start();
    });

    expect(onError).toHaveBeenCalledWith("Camera denied");
    expect(result.current.isOpen).toBe(false);
  });

  it("opens and attaches the stream to the video element", async () => {
    const { result } = renderHook(() => useCamera({ onCapture: vi.fn(), onError: vi.fn() }));
    const video = {};
    result.current.videoRef.current = video;

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.isOpen).toBe(true);

    // The <video> does not exist until the overlay renders, so attaching is
    // deferred a tick.
    act(() => vi.advanceTimersByTime(100));
    expect(video.srcObject).toBeTruthy();
  });

  it("stops every track when closed, so the camera indicator goes out", async () => {
    const stream = fakeStream();
    navigator.mediaDevices.getUserMedia = vi.fn(async () => stream);
    const { result } = renderHook(() => useCamera({ onCapture: vi.fn(), onError: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });
    act(() => result.current.stop());

    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
  });

  it("refuses to capture before the stream has produced a frame", async () => {
    // videoWidth is 0 until the stream delivers something; capturing then
    // yields a blank image the user cannot tell from a broken camera.
    const onCapture = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useCamera({ onCapture, onError }));

    result.current.videoRef.current = { videoWidth: 0, videoHeight: 0 };
    result.current.canvasRef.current = { getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => "x" };

    act(() => result.current.capture());

    expect(onCapture).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Camera isn't ready yet.");
  });

  it("hands back a frame and closes on a successful capture", async () => {
    const onCapture = vi.fn();
    const stream = fakeStream();
    navigator.mediaDevices.getUserMedia = vi.fn(async () => stream);
    const { result } = renderHook(() => useCamera({ onCapture, onError: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });

    result.current.videoRef.current = { videoWidth: 640, videoHeight: 480 };
    result.current.canvasRef.current = {
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => "data:image/jpeg;base64,AAAA",
    };

    act(() => result.current.capture());

    expect(onCapture).toHaveBeenCalledWith("data:image/jpeg;base64,AAAA");
    expect(result.current.isOpen).toBe(false);
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();
  });

  it("releases the camera on unmount", async () => {
    const stream = fakeStream();
    navigator.mediaDevices.getUserMedia = vi.fn(async () => stream);
    const { result, unmount } = renderHook(() => useCamera({ onCapture: vi.fn(), onError: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });
    unmount();

    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();
  });
});
