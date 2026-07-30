import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_IMAGE_EDGE, captureVideoFrame } from "../lib/image";

/**
 * `fileToDataUrl` needs FileReader plus a real Image decode, neither of which
 * jsdom performs — it parses no image bytes, so `img.onload` never fires and
 * width/height stay 0. Testing it here would be testing a stub.
 *
 * `captureVideoFrame` is the half that carries the logic worth asserting, and
 * it only needs a canvas surface, which is cheap to fake.
 */
const fakeCanvas = () => {
  const ctx = { drawImage: vi.fn() };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: vi.fn(() => "data:image/jpeg;base64,AAAA"),
    ctx,
  };
};

describe("captureVideoFrame", () => {
  let canvas;

  beforeEach(() => {
    canvas = fakeCanvas();
  });

  it("returns null when the camera has not produced a frame yet", () => {
    // videoWidth is 0 until the stream actually delivers something. Capturing
    // then yields a blank image, which the user cannot distinguish from a
    // broken camera.
    expect(captureVideoFrame({ videoWidth: 0, videoHeight: 0 }, canvas)).toBeNull();
    expect(captureVideoFrame(null, canvas)).toBeNull();
  });

  it("keeps the native size when the frame is already small enough", () => {
    captureVideoFrame({ videoWidth: 1280, videoHeight: 720 }, canvas);
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
  });

  it("downscales the long edge to the vision ceiling", () => {
    captureVideoFrame({ videoWidth: 4000, videoHeight: 3000 }, canvas);
    expect(canvas.width).toBe(MAX_IMAGE_EDGE);
    expect(Math.max(canvas.width, canvas.height)).toBe(MAX_IMAGE_EDGE);
  });

  it("preserves aspect ratio when downscaling", () => {
    captureVideoFrame({ videoWidth: 4000, videoHeight: 2000 }, canvas);
    expect(canvas.width / canvas.height).toBeCloseTo(2, 2);
  });

  it("scales on the LONG edge, not the width", () => {
    // A portrait capture from a phone is taller than it is wide; scaling on
    // width would leave the height over the ceiling and the payload oversized.
    captureVideoFrame({ videoWidth: 2000, videoHeight: 4000 }, canvas);
    expect(canvas.height).toBe(MAX_IMAGE_EDGE);
    expect(canvas.width).toBeLessThan(MAX_IMAGE_EDGE);
  });

  it("returns the encoded frame rather than discarding it", () => {
    // The original code drew the frame, passed it to canvas.toBlob, and threw
    // the result away — the entire capture UI did nothing at all.
    const out = captureVideoFrame({ videoWidth: 640, videoHeight: 480 }, canvas);
    expect(canvas.ctx.drawImage).toHaveBeenCalled();
    expect(out).toBe("data:image/jpeg;base64,AAAA");
  });

  it("encodes as JPEG, since a camera frame gains nothing from PNG", () => {
    captureVideoFrame({ videoWidth: 640, videoHeight: 480 }, canvas);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.85);
  });
});
