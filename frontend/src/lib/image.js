/**
 * Turning a picked file into something the vision endpoint will accept.
 *
 * The backend rejects anything over 8MB, and a phone photo clears that
 * easily. Downscaling here means the ceiling is never reached, rather than
 * reached and reported — the user does not have to learn what 8MB means.
 *
 * 1568px is about where vision models stop gaining detail, so anything larger
 * costs bytes and buys nothing.
 */
export const MAX_IMAGE_EDGE = 1568;

/** Below this, re-encoding costs more than it saves. */
const RECODE_THRESHOLD_BYTES = 4_000_000;

export const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));

    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a readable image."));

      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));

        // Small enough already — keep the original bytes and format, so a PNG
        // screenshot is not needlessly re-encoded into a lossy JPEG.
        if (scale === 1 && reader.result.length < RECODE_THRESHOLD_BYTES) {
          resolve(reader.result);
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });

/**
 * Grab the current video frame as a data URL, downscaled the same way.
 *
 * This used to end in `canvas.toBlob((b) => { stopCamera(); })` — the frame was
 * drawn, handed to a callback, and thrown away. The entire capture UI did
 * nothing.
 */
export const captureVideoFrame = (video, canvas) => {
  if (!video?.videoWidth) return null;

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
};
