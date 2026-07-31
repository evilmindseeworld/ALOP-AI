/**
 * Fullscreen camera capture.
 *
 * The canvas is hidden and exists only as a drawing surface for
 * `captureVideoFrame` — it is never shown to the user.
 */
export default function CameraOverlay({ videoRef, canvasRef, onCapture, onCancel }) {
  return (
    <div className="camera-overlay" role="dialog" aria-modal="true" aria-label="Camera">
      <video ref={videoRef} autoPlay className="camera-video" />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div className="camera-controls">
        <button onClick={onCapture} className="camera-btn primary">
          Capture
        </button>
        <button onClick={onCancel} className="camera-btn secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
