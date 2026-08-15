'use strict';

/**
 * A turn as a graph of named steps with declared dependencies, rather than as a
 * sequence of awaits.
 *
 * WHY. The request path is already concurrent in places — `Promise.all` around
 * the context reads, `settleByDeadline` around the search fan-out — and each of
 * those was added by hand, at a different time, with its own idea of what a
 * deadline means. Three consequences, all of which have cost something here:
 *
 *   THE ORDER IS INVISIBLE. Whether vision starts before the context reads is a
 *   fact about where two lines sit relative to each other, and it has been got
 *   wrong: the comment above `visionP` exists because vision USED to wait for
 *   three Supabase queries that it does not depend on.
 *
 *   BUDGETS RE-EXPAND. CLAUDE.md's rule 8 records three bugs of one shape, two
 *   of them exactly this: a ceiling computed at the top and then handed whole
 *   to a step that runs after part of it has been spent. A step here is given
 *   the time that is LEFT, computed at the moment it starts, and cannot be
 *   handed more.
 *
 *   CANCELLATION IS PER-CALL. Every layer threads its own signal and each new
 *   one is a chance to forget. Here the signal is the graph's, one per run.
 *
 * WHAT IT IS NOT. Not a scheduler, not a workflow engine, and it does not
 * retry — retries belong to the thing being retried, which knows what a retry
 * of it costs. It resolves dependencies, starts what it can, enforces
 * deadlines, and reports what happened. About a hundred lines, which is the
 * point: a dependency graph you cannot read in one sitting is worse than the
 * awaits it replaced.
 *
 * OPTIONAL STEPS ARE THE COMMON CASE. Most of what a turn does is worth doing
 * and not worth failing for — a fact lookup, an embedding, a summary. An
 * optional step that throws or times out resolves to its fallback and the graph
 * carries on. A required one fails the run.
 */

class DeadlineExceeded extends Error {
  constructor(step, budgetMs) {
    super(`Step "${step}" exceeded its ${budgetMs}ms budget`);
    this.name = 'DeadlineExceeded';
    this.code = 'STEP_DEADLINE';
    this.step = step;
  }
}

/* A step is raced against BOTH its budget and the abort, and the budget being
 * absent does not remove the race. Returning the bare promise when no ceiling
 * was declared — which this did — meant a closed tab could not stop a step that
 * never resolves, because the read loops inside these steps do not test the
 * signal themselves. That is the same defect the streaming path had (see the
 * fifth-pass handoff): the listener existed one layer up and nothing downstream
 * was actually listening. */
const withTimeout = (promise, ms, step, signal) => {
  const bounded = Number.isFinite(ms);
  if (!bounded && !signal) return promise;
  return new Promise((resolve, reject) => {
    const timer = bounded
      ? setTimeout(() => reject(new DeadlineExceeded(step, ms)), Math.max(0, ms))
      : null;
    const onAbort = () => { clearTimeout(timer); reject(signal.reason || new Error('Aborted')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(error); },
    );
  });
};

/**
 * @typedef {object} Step
 * @property {string} name
 * @property {string[]} [needs]      names that must have settled first
 * @property {(ctx: object) => Promise<any>} run   receives `{ results, signal, remainingMs, deadlineAt }`
 * @property {number} [budgetMs]     this step's own ceiling
 * @property {boolean} [optional]    true means a failure is a fallback, not a stop
 * @property {any} [fallback]        the value an optional step resolves to on failure
 * @property {(ctx: object) => boolean} [when]     skip the step when this returns false
 */

/**
 * @param {Step[]} steps
 * @param {{signal?: AbortSignal, deadlineAt?: number, now?: () => number,
 *          onStep?: (row: object) => void}} [opts]
 * @returns {Promise<{results: object, steps: object[], ok: boolean, error: Error|null}>}
 */
async function runDag(steps, { signal, deadlineAt = null, now = Date.now, onStep } = {}) {
  const byName = new Map();
  for (const step of steps) {
    if (!step || typeof step.name !== 'string' || typeof step.run !== 'function') {
      throw new TypeError('every step needs a name and a run function');
    }
    if (byName.has(step.name)) throw new TypeError(`duplicate step: ${step.name}`);
    byName.set(step.name, step);
  }
  for (const step of steps) {
    for (const need of step.needs || []) {
      if (!byName.has(need)) throw new TypeError(`step "${step.name}" needs unknown step "${need}"`);
    }
  }
  /* A cycle would otherwise present as a run that resolves nothing and hangs
   * until the turn's own deadline — a bug that looks exactly like a slow
   * provider. Detected up front, where the message can name the steps. */
  detectCycles(byName);

  const results = Object.create(null);
  const rows = [];
  const settled = new Map();
  let fatal = null;

  /** ms left in the WHOLE run, which is what a step's own budget is clamped to. */
  const remainingMs = () => (Number.isFinite(deadlineAt) ? Math.max(0, deadlineAt - now()) : Infinity);

  const start = (step) => {
    const startedAt = now();
    const ctx = {
      results,
      signal,
      get remainingMs() { return remainingMs(); },
      deadlineAt,
    };

    if (step.when && !step.when(ctx)) {
      const row = { name: step.name, ms: 0, outcome: 'skipped' };
      rows.push(row);
      onStep?.(row);
      results[step.name] = step.fallback ?? null;
      return Promise.resolve();
    }

    /* THE CLAMP IS THE WHOLE POINT OF PASSING A DEADLINE DOWN. A step declaring
     * a 5s budget inside a run with 800ms left gets 800ms. The previous shape —
     * a budget computed at the gate and handed whole to a helper that runs
     * later — is one of the three bugs CLAUDE.md rule 8 records. */
    const budget = Math.min(
      Number.isFinite(step.budgetMs) ? step.budgetMs : Infinity,
      remainingMs(),
    );

    const promise = (async () => {
      if (signal?.aborted) throw signal.reason || new Error('Aborted');
      if (budget <= 0) throw new DeadlineExceeded(step.name, 0);
      return step.run(ctx);
    })();

    return withTimeout(promise, budget, step.name, signal).then(
      (value) => {
        results[step.name] = value;
        const row = { name: step.name, ms: now() - startedAt, outcome: 'ok' };
        rows.push(row);
        onStep?.(row);
      },
      (error) => {
        const outcome = error instanceof DeadlineExceeded ? 'deadline'
          : signal?.aborted ? 'aborted' : 'failed';
        const row = { name: step.name, ms: now() - startedAt, outcome, error: error.message };
        rows.push(row);
        onStep?.(row);
        if (step.optional) {
          results[step.name] = step.fallback ?? null;
          return;
        }
        /* The FIRST fatal error wins. A later one is usually the abort this one
         * caused, and reporting that instead loses the cause. */
        if (!fatal) fatal = error;
      },
    );
  };

  /* Wave scheduling: everything whose dependencies have settled starts at once.
   * Not a work-stealing scheduler — with a dozen steps the difference is
   * unmeasurable and the readability is not. */
  while (settled.size < byName.size && !fatal) {
    const ready = [...byName.values()].filter(
      (step) => !settled.has(step.name) && (step.needs || []).every((n) => settled.has(n)),
    );
    if (!ready.length) break;
    const running = ready.map((step) => {
      settled.set(step.name, true);
      return start(step);
    });
    await Promise.all(running);
  }

  return { results, steps: rows, ok: !fatal, error: fatal };
}

function detectCycles(byName) {
  const state = new Map();
  const visit = (name, trail) => {
    const mark = state.get(name);
    if (mark === 'done') return;
    if (mark === 'open') throw new TypeError(`dependency cycle: ${[...trail, name].join(' -> ')}`);
    state.set(name, 'open');
    for (const need of byName.get(name).needs || []) visit(need, [...trail, name]);
    state.set(name, 'done');
  };
  for (const name of byName.keys()) visit(name, []);
}

module.exports = { runDag, DeadlineExceeded };
