/**
 * Fish Audio text to speech.
 *
 * The client speaks answers with the browser's own `speechSynthesis` and only
 * calls this when it is available, so everything here is an upgrade rather than
 * a dependency. Unconfigured, the route answers 501 and the client stops asking
 * for the rest of the session.
 *
 * WHY THE KEY CANNOT GO IN THE BUNDLE, since the browser could call Fish Audio
 * directly and save a hop: a Fish Audio key bills per character with no origin
 * restriction, so shipping it to the client publishes a metered credential to
 * anyone who opens devtools. The hop buys the key staying on the server, and
 * the request being subject to the same auth, suspension and rate limits as
 * everything else the user can spend money on.
 *
 * Defaults to `s2.1-pro-free`, which is the same model at no cost. Set
 * FISH_AUDIO_MODEL to `s2.1-pro` to pay for the latency guarantee.
 */

const TTS_URL = "https://api.fish.audio/v1/tts";

/** Matches the client's own ceiling in lib/speak.js. Enforced here too, because the client is not the boundary. */
const MAX_CHARS = 3000;

/** Configured or not. Everything else in this module assumes it is. */
const isConfigured = (env = process.env) => Boolean(env.FISH_AUDIO_API_KEY);

/**
 * Bound the text a caller may bill.
 *
 * Returns null for anything unusable, so the route has one check rather than
 * three. The truncation is not silent to the developer but is invisible to the
 * user, which is correct: the client already truncated at a sentence, and a
 * request that gets here longer than the ceiling is not a normal client.
 */
function boundText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, MAX_CHARS);
}

/**
 * Synthesise speech.
 *
 * @param {string} text        already bounded by boundText
 * @param {object} [deps]
 * @param {object} [deps.env]
 * @param {Function} [deps.fetchImpl]
 * @returns {Promise<{ok: true, body: ArrayBuffer, contentType: string} | {ok: false, status: number, error: string}>}
 */
async function synthesize(text, { env = process.env, fetchImpl = fetch } = {}) {
  if (!isConfigured(env)) return { ok: false, status: 501, error: "Speech is not configured." };

  const res = await fetchImpl(TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.FISH_AUDIO_API_KEY}`,
      "Content-Type": "application/json",
      // A header, not a body field. Fish Audio selects the model here and
      // defaults to the paid one, so leaving it off would quietly bill.
      model: env.FISH_AUDIO_MODEL || "s2.1-pro-free",
    },
    body: JSON.stringify({
      text,
      format: "mp3",
      // A named voice, if one has been chosen in the Fish Audio dashboard.
      // Without it the default voice is used, which is fine and is one less
      // thing to configure before the feature works.
      ...(env.FISH_AUDIO_VOICE_ID ? { reference_id: env.FISH_AUDIO_VOICE_ID } : {}),
    }),
  });

  if (!res.ok) {
    // 402 is the one worth distinguishing: it means the account is out of
    // credit rather than that anything is broken, and it should not page
    // anyone. Everything else collapses to a bad gateway, because the client's
    // response to all of them is the same — use the local voice.
    const status = res.status === 402 ? 402 : 502;
    return { ok: false, status, error: res.status === 402 ? "Speech credit exhausted." : "Speech provider failed." };
  }

  return {
    ok: true,
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") || "audio/mpeg",
  };
}

module.exports = { synthesize, boundText, isConfigured, MAX_CHARS, TTS_URL };
