import { useState, useRef, useCallback, useEffect } from "react";
import { captureVideoFrame } from "../lib/image";

/**
 * Camera capture.
 *
 * The stream is held in a ref rather than state because stopping it is
 * cleanup, not rendering — and because a stream left running keeps the
 * browser's camera indicator lit long after the overlay closes.
 */
export function useCamera({ onCapture, onError }) {
  const [isOpen, setIsOpen] = useState(false);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsOpen(false);
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setIsOpen(true);
      // The <video> does not exist until the overlay renders, so the stream is
      // attached on the next tick rather than immediately.
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch {
      onError?.("Camera denied");
    }
  }, [onError]);

  const capture = useCallback(() => {
    const frame = captureVideoFrame(videoRef.current, canvasRef.current);
    if (!frame) {
      // videoWidth is still 0, so the stream has not delivered a frame yet.
      // Capturing anyway produces a blank image indistinguishable from a
      // broken camera.
      onError?.("Camera isn't ready yet.");
      return;
    }
    onCapture(frame);
    stop();
  }, [onCapture, onError, stop]);

  useEffect(() => stop, [stop]);

  return { isOpen, videoRef, canvasRef, start, stop, capture };
}

export default useCamera;
