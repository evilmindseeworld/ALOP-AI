/**
 * RELEASE GATES — ledger item 35.
 *
 * A gate is a metric, a comparator, a threshold and a minimum sample. It
 * answers one question with one word, and the run refuses on any gate that does
 * not say `pass`.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: an unmeasured gate is not a passing
 * gate. Every threshold system built in a hurry treats a missing number as
 * zero, and zero passes every "must be below" gate in this list — so a runner
 * that could not observe cost would report the cheapest release in history. A
 * gate whose metric is `null`, or whose sample is smaller than `minSample`, is
 * `inconclusive`, and `passed` is false while any gate is inconclusive.
 * `--allow-inconclusive` exists for the local case (running four cases while
 * writing a new one), and it is a flag someone has to type, which is the point.
 *
 * WHY THE THRESHOLDS ARE WHAT THEY ARE. The latency numbers are the ones the
 * product's own routing already assumes: `lib/agent-loop.js` bounds a research
 * turn at 75s of wall clock, so a p95 above that is not slow, it is a turn that
 * was cut off. The 2.4s/23.9s median spread between the fast and slow seats
 * (handoff, 2026-08-14 fifth pass) is why p95 rather than mean is gated — the
 * mean of a 20-case dataset hides one 24-second fallback completely.
 *
 * Thresholds are DATA, in `evals/gates.json` when someone wants to move them,
 * so moving one is a diff and not an edit to a source file nobody reviews.
 */

/**
 * `direction: 'max'` means the value must be at or below the threshold;
 * `'min'` means at or above. `sample` names the metric that counts as the
 * denominator — a pass rate over two cases is not evidence about a release.
 */
const DEFAULT_GATES = [
  {
    name: 'acceptance',
    metric: 'acceptanceRate',
    direction: 'min',
    threshold: 0.9,
    sample: 'evaluatedCases',
    minSample: 10,
    why: 'nine in ten cases must pass, or the dataset is describing a broken build',
  },
  {
    name: 'coverage',
    metric: 'coverageRate',
    direction: 'min',
    threshold: 0.95,
    sample: 'cases',
    minSample: 10,
    why: 'a provider outage cannot be mistaken for a quality result over an unmeasured prefix',
  },
  {
    name: 'factuality',
    metric: 'factualityPassRate',
    direction: 'min',
    threshold: 0.95,
    sample: 'cases',
    minSample: 5,
    why: 'a factuality case has a checkable answer; getting one wrong is not a style difference',
  },
  {
    name: 'citations',
    metric: 'citationRate',
    direction: 'min',
    threshold: 1,
    sample: 'cases',
    minSample: 3,
    why: 'a searched answer with no URL is unverifiable by the person reading it',
  },
  {
    name: 'latency-p95',
    metric: 'latencyP95Ms',
    direction: 'max',
    threshold: 75_000,
    sample: 'evaluatedCases',
    minSample: 10,
    why: 'the agent loop cuts a turn at 75s of wall clock, so a p95 above it is a truncated answer',
  },
  {
    name: 'cost-per-turn',
    metric: 'costCentsPerTurn',
    direction: 'max',
    threshold: 5,
    sample: 'cases',
    minSample: 10,
    why: 'five cents a turn is the ceiling the daily spend reservation is sized against',
  },
  {
    name: 'tools',
    metric: 'toolSuccessRate',
    direction: 'min',
    threshold: 0.9,
    sample: 'cases',
    minSample: 3,
    why: 'a tool that fails one call in five turns the research path into a slower guess',
  },
  {
    name: 'cache-precision',
    metric: 'cachePrecision',
    direction: 'min',
    threshold: 1,
    sample: 'cases',
    minSample: 3,
    why: 'a cache hit that answers the wrong question is worse than a miss, and free to ship',
  },
];

/** Thresholds may be overridden by name; anything not named keeps its default,
 *  and an override for a gate that does not exist is an error rather than a
 *  silently ignored line in a config file. */
function mergeGates(overrides = {}, gates = DEFAULT_GATES) {
  const unknown = Object.keys(overrides).filter((name) => !gates.some((g) => g.name === name));
  if (unknown.length) throw new TypeError(`unknown gate(s): ${unknown.join(', ')}`);
  return gates.map((gate) => {
    const patch = overrides[gate.name];
    if (patch === undefined) return gate;
    if (patch === false) return { ...gate, disabled: true };
    if (typeof patch === 'number') return { ...gate, threshold: patch };
    return { ...gate, ...patch };
  });
}

/**
 * Judge one set of metrics.
 *
 * Returns `{ passed, results }`. `results` carries every gate including the
 * disabled and inconclusive ones, because a report that lists only the gates
 * that ran reads as though the rest passed.
 */
function evaluateGates(metrics = {}, { gates = DEFAULT_GATES, allowInconclusive = false } = {}) {
  const results = gates.map((gate) => {
    const value = metrics[gate.metric];
    const sample = gate.sample ? metrics[gate.sample] : null;
    const base = { name: gate.name, metric: gate.metric, direction: gate.direction, threshold: gate.threshold, value, sample, why: gate.why };

    if (gate.disabled) return { ...base, status: 'disabled', detail: 'disabled by override' };
    if (!Number.isFinite(value)) return { ...base, status: 'inconclusive', detail: `${gate.metric} was not measured` };

    const ok = gate.direction === 'min' ? value >= gate.threshold : value <= gate.threshold;

    /* A MEASURED BREACH IS A FAILURE AT ANY SAMPLE SIZE, and the sample check
     * sits BELOW this line for that reason. minSample protects against
     * declaring a PASS on thin evidence; it says nothing about a violation you
     * can already see. Observed on 2026-08-17: three cases run against a local
     * server with a bad token failed every one of them, and because the sample
     * was under ten the acceptance gate read `inconclusive` and
     * `--allow-inconclusive` printed GATES PASSED. Two cases passing 0% is not
     * "not enough data to say" — it is the answer. */
    if (!ok) return { ...base, status: 'fail', detail: `${value} ${gate.direction === 'min' ? '>=' : '<='} ${gate.threshold} is false${gate.minSample && !(sample >= gate.minSample) ? ` (sample ${sample ?? 0}, below the ${gate.minSample} needed to PASS — a breach still fails)` : ''}` };

    if (gate.minSample && !(Number.isFinite(sample) && sample >= gate.minSample)) {
      return { ...base, status: 'inconclusive', detail: `sample ${sample ?? 0} < ${gate.minSample}` };
    }
    return { ...base, status: 'pass', detail: `${value} ${gate.direction === 'min' ? '>=' : '<='} ${gate.threshold} is true` };
  });

  const failed = results.filter((r) => r.status === 'fail');
  const inconclusive = results.filter((r) => r.status === 'inconclusive');
  return {
    passed: failed.length === 0 && (allowInconclusive || inconclusive.length === 0),
    failed: failed.map((r) => r.name),
    inconclusive: inconclusive.map((r) => r.name),
    results,
  };
}

/** One line per gate, for a CI log where nobody will open the JSON report. */
function formatGates(verdict) {
  const mark = { pass: 'PASS', fail: 'FAIL', inconclusive: '????', disabled: 'skip' };
  return verdict.results
    .map((r) => `${mark[r.status]}  ${r.name.padEnd(16)} ${String(r.value ?? 'unmeasured').padEnd(10)} ${r.detail}`)
    .join('\n');
}

module.exports = { DEFAULT_GATES, mergeGates, evaluateGates, formatGates };
