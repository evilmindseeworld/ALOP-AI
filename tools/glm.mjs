#!/usr/bin/env node
/**
 * Talk to GLM 5.2 through Ollama, so a second model can read this repo's diffs.
 *
 * WHY A WRAPPER AND NOT `ollama run`. `ollama run glm-5.2:cloud "..."` works,
 * but it renders a spinner and cursor-control escapes into stdout, so piping a
 * diff in and a review out gives back text with `[?25l` sprayed through it.
 * This posts to the OpenAI-compatible endpoint the local daemon already
 * exposes and prints the message content and nothing else.
 *
 * NOTHING RUNS REMOTELY BY ITSELF. The daemon at 127.0.0.1:11434 routes
 * `:cloud` models to ollama.com under the account `ollama signin` established;
 * there is no API key in this repo and none is needed. If the daemon is not
 * running, this says so rather than hanging.
 *
 *   node tools/glm.mjs "question"
 *   git diff | node tools/glm.mjs "review this diff, list only real defects"
 *   node tools/glm.mjs --check          # round-trip self-test
 *   node tools/glm.mjs --reasoning ...  # also print the model's scratchpad
 *
 * GLM IS A REVIEWER, NOT AN AUTHOR. Its output is untrusted input: it has not
 * run the tests, it cannot see production, and it will confidently name
 * indexes that already exist (migration 009 is the worked example). Verify
 * every claim against the code or the database before acting on it.
 */
import { readFileSync } from "node:fs";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const MODEL = process.env.GLM_MODEL || "glm-5.2:cloud";
const TIMEOUT_MS = Number(process.env.GLM_TIMEOUT_MS || 600_000);

const argv = process.argv.slice(2);
const wantReasoning = argv.includes("--reasoning");
const isCheck = argv.includes("--check");
const prompt = argv.filter((a) => !a.startsWith("--")).join(" ");

/**
 * stdin if it is piped, empty string otherwise.
 *
 * readFileSync(0) rather than the async stream. Consuming process.stdin as an
 * async iterable on Windows leaves a handle mid-close at exit and trips
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in libuv, which
 * returns 127 from a run that printed the right answer. Reading the fd
 * directly never opens the stream.
 */
function readStdin() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function ask(content) {
  const res = await fetch(`${HOST}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content }], stream: false }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => {
    // ECONNREFUSED here means the daemon is down, which is the one failure a
    // caller can actually fix, so say that instead of a stack trace.
    throw new Error(
      `cannot reach Ollama at ${HOST} (${err.message}). Start the daemon with \`ollama serve\`, ` +
      `or check \`ollama signin\` if this is a :cloud model.`
    );
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const body = await res.json();
  const msg = body.choices?.[0]?.message;
  if (!msg) throw new Error(`no message in response: ${JSON.stringify(body).slice(0, 400)}`);
  return msg;
}

if (isCheck) {
  // The smallest thing that fails if the bridge breaks: a round trip whose
  // answer is checkable without a model judging it.
  const msg = await ask("What is 6 multiplied by 7? Reply with the number alone.");
  const ok = /\b42\b/.test(msg.content || "");
  console.log(ok ? `ok: ${MODEL} via ${HOST}` : `FAILED: expected 42, got ${JSON.stringify(msg.content)}`);
  // exitCode, NOT process.exit(). On Windows, exiting while the stdin handle
  // is still closing trips a libuv assertion and returns 127 after a run that
  // actually succeeded. Setting the code lets the loop drain first.
  process.exitCode = ok ? 0 : 1;
} else {
const piped = readStdin();
if (!prompt && !piped) {
  console.error("usage: node tools/glm.mjs \"prompt\"   (or pipe stdin, e.g. `git diff | node tools/glm.mjs \"review\"`)");
  process.exit(2);
}

const msg = await ask(piped ? `${prompt}\n\n---\n\n${piped}` : prompt);
if (wantReasoning && msg.reasoning) console.error(`--- reasoning ---\n${msg.reasoning}\n--- answer ---`);
console.log((msg.content || "").trim());

}
