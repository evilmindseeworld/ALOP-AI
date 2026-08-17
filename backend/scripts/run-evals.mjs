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
const pauseMs = Number(flag("pause", "4000"));

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
if (!token) {
  console.error("EVAL_TOKEN is unset. It must be a Clerk session JWT for a real account — the council route is behind requireAuth, and there is no bypass to add.");
  process.exit(1);
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
        Authorization: `Bearer ${token}`,
        "X-Operation-Id": operationId,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ message: testCase.question, history: [] }),
    });

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
process.exit(verdict.passed ? 0 : 1);
