/**
 * Reading an answer out loud.
 *
 * The other half of voice. Dictation has been in the composer for a while, so
 * a user who does not want to type is served; a user who does not want to READ
 * a 900-word council answer had nothing.
 *
 * TWO ENGINES, ONE OF WHICH MAY NOT EXIST.
 *
 * `/api/speech` proxies Fish Audio, which sounds like a person. It needs a key
 * that lives on the server and it costs money per character, so it is optional
 * by construction: the route answers 501 when FISH_AUDIO_API_KEY is unset, and
 * this falls through to the browser's own `speechSynthesis`, which is free,
 * offline, instant, and sounds like 2011. The button works today either way,
 * and adding the key upgrades the voice without touching a line of interface.
 *
 * The fallback is not a courtesy. Fish Audio has to synthesise the whole clip
 * before a byte comes back, so a long answer is several seconds of silence
 * where the local voice would already be talking, and any network failure at
 * all would otherwise mean a button that does nothing.
 */

/** One voice at a time, across every message in the transcript. */
let current = null;

/** Cache of what the server can do, so the fallback is decided once. */
let remoteAvailable = null;

/**
 * Fish Audio bills per character and the browser voice does not read a wall of
 * text well either. Long answers are truncated at a sentence boundary rather
 * than mid-word, which is what a reader would do out loud anyway.
 */
const MAX_CHARS = 3000;

/** Markdown read aloud is unbearable: "hash hash Setup, star star fast star star". */
export function speakable(markdown) {
  if (typeof markdown !== "string") return "";
  const text = markdown
    .replace(/```[\s\S]*?```/g, " Code block. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Link text is worth reading; the URL is not.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return lastStop > MAX_CHARS * 0.5 ? cut.slice(0, lastStop + 1) : cut;
}

/**
 * Silence whatever is speaking.
 *
 * The interrupted speaker's `onEnd` is fired, and that is the part worth
 * stating: without it, pressing Listen on a second answer leaves the FIRST
 * button reading "Stop" for an utterance that stopped, and only a click on a
 * dead control puts it right. The caller asked to be told when the voice
 * stopped; being cut off is one of the ways it stops.
 */
export function stopSpeaking() {
  const previous = current;
  current = null;
  if (previous?.stop) previous.stop();
  if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  if (previous?.finish) previous.finish();
}

export const isSpeechSupported = () =>
  typeof window !== "undefined" && Boolean(window.speechSynthesis || window.Audio);

function speakLocally(text, onEnd) {
  if (!window.speechSynthesis) {
    onEnd();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  // Slightly quick: the default is slower than anyone reads, and an answer
  // that takes four minutes to hear is one nobody waits for.
  utterance.rate = 1.1;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  current = { stop: () => window.speechSynthesis.cancel(), finish: onEnd };
  window.speechSynthesis.speak(utterance);
}

/**
 * Speak some markdown.
 *
 * @param {string} markdown
 * @param {object} opts
 * @param {(path: string, init?: object) => Promise<Response>} [opts.apiCall]
 *   the app's authenticated fetch. Without it, only the local voice is tried.
 * @param {() => void} [opts.onEnd] called once, whichever engine spoke
 * @returns {Promise<void>} resolves when playback has STARTED, not finished
 */
export async function speak(markdown, { apiCall, onEnd = () => {} } = {}) {
  stopSpeaking();
  const text = speakable(markdown);
  if (!text) {
    onEnd();
    return;
  }

  // Called at most once. Both engines can report an end, and a failed remote
  // attempt hands over to the local one, so without this a caller's "stopped
  // speaking" state could fire while the fallback is still talking.
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    onEnd();
  };

  if (apiCall && remoteAvailable !== false) {
    try {
      const res = await apiCall("/api/speech", { method: "POST", body: JSON.stringify({ text }) });
      if (res.status === 501 || res.status === 404) {
        // No key configured. Stop asking for the rest of the session.
        remoteAvailable = false;
      } else if (res.ok) {
        remoteAvailable = true;
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        // Revoking on end and on error both matter: the blob is the whole clip
        // in memory and a transcript can be read a lot.
        const release = () => {
          URL.revokeObjectURL(url);
          finish();
        };
        audio.onended = release;
        audio.onerror = release;
        current = {
          stop: () => {
            audio.pause();
            URL.revokeObjectURL(url);
          },
          finish,
        };
        await audio.play();
        return;
      }
    } catch {
      // Network, auth, decode — all the same answer: use the voice that
      // cannot fail.
    }
  }

  speakLocally(text, finish);
}

export default speak;
