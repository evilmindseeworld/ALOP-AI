#!/usr/bin/env node
/**
 * RUN THE EVALUATION DATASET AGAINST A RUNNING SERVER, AND GATE ON THE RESULT.
 *
 * Ledger items 34 and 35. `lib/evaluation.js` holds every judgement and
 * `lib/release-gates.js` every threshold; this file only talks HTTP, keeps time
 * and writes the report, because it is the part that cannot be unit-tested
 * without spending money on real model calls.
 *
 *   BASE=https://alop-ai.onrender.com EVAL_TOKEN=<clerk session jwt> \
 *     node scripts/run-evals.mjs --dataset core-v1 --report ../eval-report.json
 *
 * FLAGS
 *   --dataset <name>      evals/<name>.json                 (default core-v1)
 *   --base <url>          server under test                 (default $BASE or localhost:3001)
 *   --report <path>       write the JSON report here
 *   --tag <tag>           run only cases carrying this tag  (repeatable)
 *   --limit <n>           run at most n cases
 *   --gates <path>        JSON of { gateName: threshold | {…} | false }
 *   --allow-inconclusive  do not fail the run on an unmeasured gate
 *   --validate-only       check the dataset and exit, spending nothing
 *
 * IT COSTS REAL MONEY AND REAL QUOTA. Twenty-two cases is up to twenty-two
 * council turns, four of them research turns with the full roster, against an
 * account-wide OpenRouter limit that the handoff measured at 20 requests a
 * minute. So: cases run ONE AT A TIME with a pause between them, never
 * concurrently. A parallel runner would be faster and would spend the whole run
 * bouncing off 429s, which also destroys the latency numbers it is trying to
 * measure.
 *
 * AND SEQUENTIAL IS NOT ENOUGH ON ITS OWN — the paragraph above was right about
 * the mechanism and wrong to pin it on parallelism. One case is ~10 requests,
 * so a 4s pause asked for ~60 a minute and the run throttled itself just as
 * thoroughly, then reported the queueing as the product's latency. Measured and
 * corrected 2026-08-18; see the note on `pauseMs`.
 *
 * WHAT IT CANNOT SEE, said out loud rather than defaulted to zero: the HTTP
 * surface exposes no price and no `textSource`, so `costCentsPerTurn` and
 * `cachePrecision` come back null and their gates read `inconclusive`. That is
 * why `--allow-inconclusive` is a flag someone has to type. See the ponytail
 * note in `lib/evaluation.js` for the two additive changes that would fix it.
 *
 * The exit code is the product: 0 when every gate passed, 1 otherwise.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { loadDataset, gradeCase, summarise } = require("../lib/evaluation");
const { mergeGates, evaluateGates, formatGates } = require("../lib/release-gates");

/* ---- arguments ------------------------------------------------------- */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};
const bool = (name) => argv.includes(`--${name}`);
const many = (name) => argv.reduce((out, a, i) => (a === `--${name}` ? [...out, argv[i + 1]] : out), []);

const datasetName = flag("dataset", "core-v1");
const base = (flag("base", process.env.BASE || "http://localhost:3001") || "").replace(/\/$/, "");
const token = process.env.EVAL_TOKEN || "";
const tags = many("tag");
const limit = Number(flag("limit", "0")) || 0;
/**
 * 30 SECONDS, AND THE OLD 4 WAS MEASURING THIS SCRIPT RATHER THAN THE PRODUCT.
 *
 * MEASURED 2026-08-18, fourth evaluation run against production: seven cases
 * failed on latency alone and nothing else. "What is the capital of Australia?"
 * took 56,048ms; "how many km in a mile" 48,059ms; pi to five places 37,153ms.
 * Then the same class of question was sent to the same build ONE AT A TIME with
 * nothing else in flight — "What is the capital city of Portugal?" answered in
 * 8,393ms, and three such probes averaged 9.7s with first byte at ~1.8s.
 *
 * A trivial question is not six times slower inside a run than outside one. The
 * run was queueing behind itself: ONE CASE IS ABOUT TEN OPENROUTER REQUESTS —
 * two for the router, seven council seats, one synthesis — against an
 * account-wide limit the handoff measured at 20 requests a minute. At a 4s
 * pause the run asks for roughly 60 a minute, so from the third case onward
 * every turn is waiting on a bucket the previous turns emptied, and the report
 * writes that wait down as product latency.
 *
 * Ten requests a case against twenty a minute is one case per thirty seconds.
 * That makes a 22-case run about eleven minutes instead of ninety seconds, and
 * the eleven minutes are the honest ones.
 *
 * IF THE ROSTER OR THE ROUTER CHANGES ITS REQUEST COUNT, THIS NUMBER IS WRONG.
 * It is a pace derived from a request budget, not a constant — recompute it as
 * (requests per case ÷ requests per minute) rather than nudging it.
 *
 * `--pause 0` is still honoured for a local server that talks to nothing.
 */
const pauseMs = Number(flag("pause", "30000"));

/* ---- dataset --------------------------------------------------------- */

const raw = JSON.parse(await readFile(join(HERE, "..", "evals", `${datasetName}.json`), "utf8"));
const { name, cases, problems } = loadDataset(raw);
if (problems.length) {
  console.error(`Dataset ${datasetName} is not runnable:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
let selected = tags.length ? cases.filter((c) => (c.tags || []).some((t) => tags.includes(t))) : cases;
if (limit) selected = selected.slice(0, limit);
console.log(`Dataset ${name}: ${cases.length} cases, ${selected.length} selected.`);

if (bool("validate-only")) {
  console.log("Dataset is valid. Nothing was spent.");
  process.exit(0);
}
/* ---- authentication -------------------------------------------------- */

/**
 * A STATIC `EVAL_TOKEN` CANNOT SURVIVE THIS RUN, and the failure is silent.
 *
 * Clerk session JWTs expire in about sixty seconds. This run is 22 cases, one
 * at a time, with a pause between them and four full research turns among
 * them — minutes, not seconds. So a pasted token is valid for the first case
 * or two and expired for the rest.
 *
 * What that looked like before this existed: every later case came back
 * `http_401`, `gradeCase` recorded `noError: false` because an error frame
 * fails a case that did not ask for one, and the report said the council got
 * eighteen of twenty-two answers WRONG. The release gates would then read a
 * factuality catastrophe off an expired token. An auth failure is not a wrong
 * answer, and grading it as one is worse than crashing.
 *
 * TWO CHANGES, and the second is the one that makes the run possible at all:
 *   1. A 401/403 aborts the run (see `runCase`). It is never graded.
 *   2. `EVAL_CLERK_SECRET_KEY` mints a FRESH token before every case, so the
 *      length of the run stops mattering. The static token is kept as the
 *      fallback for a short `--limit 1` smoke run.
 *
 * AND THE RUN SIGNS IN THE WAY A BROWSER DOES, WHICH IS NOT AN AESTHETIC
 * CHOICE. Two earlier attempts are wrong for reasons the server states out
 * loud, and both were tried against production before this shape was found:
 *
 *   - `sessions.createSession` (Backend API) is refused on a production
 *     instance: 400 `request_invalid_for_environment`. Development only.
 *   - `sessions.getToken` on a BORROWED session mints a token with NO `azp`
 *     claim, and `server.js` mounts `clerkMiddleware` with `authorizedParties`
 *     set from the CORS origin list. Clerk then answers, in the
 *     `x-clerk-auth-message` header of the 401: `Invalid JWT Authorized party
 *     claim (azp) undefined. Expected "https://alop-ai.com,…"`. Every
 *     Backend-API-minted token fails that check, on every case, forever. The
 *     `azp` is written by the FRONTEND API from the `Origin` of the request
 *     that asks for the token, so it cannot be added from the back.
 *
 * So: create a sign-in token for the user (Backend API), redeem it at the
 * Frontend API with `Origin` set to a real front-end origin — which is what
 * puts `azp` in every token minted from the session afterwards — and mint per
 * case from there. The session is OURS, not the user's browser session, so it
 * is revoked on the way out.
 *
 * `EVAL_ORIGIN` overrides the origin, `EVAL_CLERK_FAPI` the Frontend API host;
 * both are read from the instance's primary domain by default and neither is
 * normally needed. The origin has to be one the server names in
 * `ALLOWED_ORIGINS`/`FRONTEND_URL`, or the 401 above comes back with the
 * expected list in it.
 *
 * The secret key must belong to the same Clerk instance as the server under
 * test: a token minted on the development instance is signed by a different
 * key than production verifies with, and produces the same 401 with
 * `reason=token-invalid-signature` instead.
 */
let tokenFor = async () => token;
let releaseSession = async () => {};

if (process.env.EVAL_CLERK_SECRET_KEY) {
  const SECRET = process.env.EVAL_CLERK_SECRET_KEY;
  const CLERK_JS = "_clerk_js_version=5.0.0";

  /* Every Clerk call routed through one reporter. A wrong or wrong-instance
   * secret key answers 401 here, and the useful form of that is one line
   * naming the status, not a stack trace over a configuration fact. */
  const bapi = async (what, path, init = {}) => {
    const res = await fetch(`https://api.clerk.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `FAILED: Clerk refused ${what} (HTTP ${res.status}). Check that EVAL_CLERK_SECRET_KEY belongs to the same instance as BASE.`,
      );
      if (body) console.error(`  Clerk said: ${body.slice(0, 300)}`);
      process.exit(1);
    }
    return res.json();
  };

  /* The instance names its own Frontend API and its own primary domain, so
   * neither has to be configured or guessed from the secret key. */
  const domains = await bapi("the domain list", "/domains");
  const primary = domains.data.find((d) => !d.is_satellite) || domains.data[0];
  if (!primary) {
    console.error("FAILED: the Clerk instance has no domain, so there is no Frontend API to sign in against.");
    process.exit(1);
  }
  const fapi = (process.env.EVAL_CLERK_FAPI || primary.frontend_api_url).replace(/\/$/, "");
  const origin = (process.env.EVAL_ORIGIN || `https://${primary.name}`).replace(/\/$/, "");

  let userId = process.env.EVAL_USER_ID || "";
  if (!userId) {
    const users = await bapi("the user list", "/users?limit=1");
    if (!users.length) {
      console.error("EVAL_CLERK_SECRET_KEY is set but the instance has no users. Set EVAL_USER_ID.");
      process.exit(1);
    }
    userId = users[0].id;
    console.log(`No EVAL_USER_ID given; using the first user on the instance (${userId}).`);
  }

  const ticket = await bapi("a sign-in token", "/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 600 }),
  });

  /* Redeeming the ticket at the Frontend API is what makes this a real client
   * session. `Origin` is the load-bearing header: it becomes `azp`. */
  const signIn = await fetch(`${fapi}/v1/client/sign_ins?${CLERK_JS}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    body: new URLSearchParams({ strategy: "ticket", ticket: ticket.token }),
  });
  const signInBody = await signIn.json().catch(() => ({}));
  if (!signIn.ok || signInBody?.response?.status !== "complete") {
    console.error(`FAILED: the Frontend API at ${fapi} would not complete the sign-in (HTTP ${signIn.status}).`);
    console.error(`  It answered: ${JSON.stringify(signInBody).slice(0, 300)}`);
    process.exit(1);
  }

  /* The `__client` cookie IS the client credential; without it the token
   * endpoint below does not know which client is asking. */
  const setCookie = signIn.headers.getSetCookie?.() || [signIn.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookie.map((c) => String(c).split(";")[0]).join("; ");
  const sessionId = signInBody?.client?.sessions?.[0]?.id || signInBody?.response?.created_session_id || "";
  if (!sessionId || !cookie) {
    console.error("FAILED: the sign-in completed without returning a session id and a client cookie.");
    process.exit(1);
  }

  /* Ours, so revoked on the way out, including on a crash — a run that dies
   * must not leave a usable session behind it. The user's own browser session
   * is never touched: this one was created for the run. */
  releaseSession = async () => {
    try {
      await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}` },
      });
    } catch { /* best effort */ }
  };
  process.on("exit", () => { releaseSession(); });
  console.log(`Signed in as ${userId} from ${origin} (${sessionId.slice(0, 12)}…); the session is revoked on exit.`);

  /* Minted per case rather than once: that is the whole point. The Frontend
   * API returns a new JWT from the live session every time it is asked. */
  tokenFor = async () => {
    const res = await fetch(`${fapi}/v1/client/sessions/${sessionId}/tokens?${CLERK_JS}`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
    });
    if (!res.ok) throw new Error(`Clerk would not mint a token for the run (HTTP ${res.status}).`);
    const { jwt } = await res.json();
    if (!jwt) throw new Error("Clerk returned no JWT for the run session.");
    return jwt;
  };

  /* A 401 from the server under test has causes a status code cannot separate:
   * a token this server cannot verify, one minted for another origin, an
   * account it has suspended. `iss` and `azp` are the two facts that split the
   * first two, and reading them costs one mint. Claims only — the JWT itself
   * is never printed. */
  if (process.env.EVAL_DEBUG) {
    const [, payload = ""] = (await tokenFor()).split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    console.log(`Token issuer: ${claims.iss} (azp: ${claims.azp || "none"}, sub: ${claims.sub}).`);
  }
} else if (!token) {
  console.error(
    'No credential. Either:\n' +
    '  EVAL_CLERK_SECRET_KEY=sk_… [EVAL_USER_ID=user_…]   mints a fresh token per case (use this for a full run)\n' +
    '  EVAL_TOKEN=<clerk session jwt>                      one pasted token, expires in ~60s (only for --limit 1)\n' +
    'The council route is behind requireAuth and there is no bypass to add.',
  );
  process.exit(1);
} else {
  console.warn(
    'WARNING: EVAL_TOKEN is a static token and Clerk session JWTs expire in ~60s.\n' +
    '         A full run will abort on expiry. Use EVAL_CLERK_SECRET_KEY for a full run.',
  );
}

/* ---- one turn -------------------------------------------------------- */

/**
 * Read the SSE body and rebuild the turn. Frames are kept in order and whole:
 * the graders read `tool_start` names and the error code, and a runner that
 * only accumulated text could not answer "did it search".
 *
 * Latency is measured to the END of the stream, not to the first byte. First
 * byte is the better product metric and the audit row already carries it; this
 * number is gated against the agent loop's 75s wall clock, which is a whole-turn
 * budget.
 */
async function runCase(testCase) {
  const operationId = `eval-${datasetName}-${testCase.id}`;
  const started = Date.now();
  const frames = [];
  let answer = "";
  let error = null;

  try {
    const res = await fetch(`${base}/api/council`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await tokenFor()}`,
        "X-Operation-Id": operationId,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ message: testCase.question, history: [] }),
    });

    /* AN AUTH FAILURE IS NOT A WRONG ANSWER, and grading it as one is the
     * worst outcome available: `gradeCase` fails any case that produced an
     * error frame it did not ask for, so an expired token turns into a report
     * saying the council answered everything incorrectly, and the release
     * gates read a factuality catastrophe off a credential problem. Abort
     * instead — a crash is a diagnosis and a graded 401 is a lie. */
    if (res.status === 401 || res.status === 403) {
      await releaseSession();
      /* The server says WHICH refusal this is — an unverifiable token and a
       * suspended account are both 401 and have different fixes. Printing the
       * body is the difference between a diagnosis and a guess. */
      const why = await res.text().catch(() => '');
      console.error(
        `\nFAILED: ${res.status} on case ${testCase.id}. The credential is not accepted by ${base}.\n` +
        (why ? `  Server said: ${why.slice(0, 300)}\n` : '') +
        '  A static EVAL_TOKEN expires in about 60s — use EVAL_CLERK_SECRET_KEY to mint one per case.\n' +
        '  If you ARE minting: the secret key belongs to a different Clerk instance than the server\n' +
        '  under test, so its tokens are signed by a key that server does not verify with.\n' +
        '  Nothing is graded from this run; the report would have called an auth failure a wrong answer.',
      );
      process.exit(1);
    }

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* not an envelope */ }
      return {
        id: testCase.id,
        answer: "",
        frames,
        latencyMs: Date.now() - started,
        costCents: null,
        textSource: null,
        error: { code: parsed.code || `http_${res.status}`, text: parsed.error || body.slice(0, 200) },
      };
    }

    // Frames are `data: {json}\n\n`, so buffer until a blank line rather than
    // per chunk — a JSON frame split across two TCP reads is the normal case,
    // not the rare one.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 2);
        if (!raw.startsWith("data:")) continue;
        const payload = raw.slice(5).trim();
        if (payload === "[DONE]") continue;
        let frame;
        try { frame = JSON.parse(payload); } catch { continue; }
        frames.push(frame);
        if (frame.type === "chunk") answer += frame.text || "";
        if (frame.type === "error") error = { code: frame.code || "unknown", text: frame.text || "" };
      }
    }
  } catch (err) {
    error = { code: "transport", text: err.message };
  }

  return {
    id: testCase.id,
    answer,
    frames,
    latencyMs: Date.now() - started,
    costCents: null,   // unobservable over HTTP today; see the header
    textSource: null,  // ditto
    error,
  };
}

/* ---- the run --------------------------------------------------------- */

const observations = [];
for (const [index, testCase] of selected.entries()) {
  const obs = await runCase(testCase);
  observations.push(obs);
  const grade = gradeCase(testCase, obs);
  const mark = grade.passed ? "pass" : grade.inconclusive ? "????" : "FAIL";
  console.log(`${String(index + 1).padStart(2)}/${selected.length} ${mark} ${testCase.id.padEnd(26)} ${obs.latencyMs}ms ${grade.failures.join("; ")}`);
  if (index < selected.length - 1 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
}

const grades = selected.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
const metrics = summarise(grades, observations);

let overrides = {};
const gatesPath = flag("gates");
if (gatesPath) overrides = JSON.parse(await readFile(resolve(gatesPath), "utf8"));
const verdict = evaluateGates(metrics, {
  gates: mergeGates(overrides),
  allowInconclusive: bool("allow-inconclusive"),
});

console.log(`\n${formatGates(verdict)}`);
console.log(`\n${metrics.passed}/${metrics.cases} cases passed, ${metrics.inconclusive} inconclusive.`);
if (metrics.failures.length) {
  console.log("Failures:");
  for (const f of metrics.failures) console.log(`  ${f.id}: ${f.failures.join("; ")}`);
}

const reportPath = flag("report");
if (reportPath) {
  // The report carries the dataset name and the base URL because a metric
  // without the thing it measured is not evidence about anything.
  await writeFile(resolve(reportPath), JSON.stringify({
    dataset: name, base, ranAt: new Date().toISOString(),
    metrics, verdict, grades,
    observations: observations.map((o) => ({ ...o, frames: o.frames.length, answer: o.answer.slice(0, 2000) })),
  }, null, 2));
  console.log(`Report written to ${resolve(reportPath)}`);
}

console.log(verdict.passed ? "\nGATES PASSED" : `\nGATES REFUSED: ${[...verdict.failed, ...verdict.inconclusive].join(", ")}`);

/* `process.exitCode`, NOT `process.exit()`. Measured on Windows: exiting here
 * while undici still holds the keep-alive sockets from the last turn aborts the
 * process — `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c`
 * — and the shell then reads 127. Nonzero, so a refusal still looked like a
 * refusal; a PASSING run aborting the same way would have read as a failed
 * release for no reason. Setting the code lets the loop drain and exit on its
 * own, which is also what makes the report's last line trustworthy. */
process.exitCode = verdict.passed ? 0 : 1;
