'use strict';

const { normaliseCompletion, emptyReply, normaliseUsage } = require('./model-reply');

const RETRY_DELAYS_MS = [400, 1200];
const RATE_LIMIT_RESET_SAFETY_MS = 50;

class OpenRouterRateLimitError extends Error {
  constructor(kind, message, { resetAt = null, status = 429 } = {}) {
    super(message);
    this.name = 'OpenRouterRateLimitError';
    this.code = kind === 'daily' ? 'OPENROUTER_DAILY_LIMIT' : 'OPENROUTER_RATE_LIMIT';
    this.kind = kind;
    this.resetAt = resetAt;
    this.status = status;
  }
}

/* THE COLLAPSE TO A STRING IS NOW OPT-OUT RATHER THAN UNCONDITIONAL.
 *
 * `completionText` used to be the only thing between the provider payload and
 * the caller, and it returned a string — which silently deleted
 * `message.tool_calls`, `message.refusal` and the distinction between an answer
 * and internal reasoning. See lib/model-reply.js for what that cost.
 *
 * The string is still the DEFAULT so that the twelve existing call sites are
 * unchanged; `{ structured: true }` asks for the whole reply instead. */
const completionText = (payload) => normaliseCompletion(payload).content;

const endpointFor = (host) => {
  const base = String(host || '').replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
};

const keyEndpointFor = (host) => {
  const completionEndpoint = endpointFor(host);
  return `${completionEndpoint.replace(/\/chat\/completions$/, '')}/key`;
};

const parseErrorBody = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

const rateLimitResetAt = (response, payload) => {
  const raw = response.headers?.get?.('x-ratelimit-reset')
    || payload?.error?.metadata?.headers?.['X-RateLimit-Reset']
    || payload?.error?.metadata?.headers?.['x-ratelimit-reset'];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const classify429 = (response, errorBody) => {
  const payload = parseErrorBody(errorBody);
  const error = payload?.error || {};
  const source = String(error.metadata?.limit_source || '').toLowerCase();
  const message = String(error.message || errorBody || 'OpenRouter rate limit exceeded');
  const providerCode = error.metadata?.provider_code;
  const resetAt = rateLimitResetAt(response, payload);
  if (source === 'openrouter_free_tier_daily' || /free-models-per-day/i.test(message)) {
    return { kind: 'daily', message, resetAt };
  }
  if (!providerCode && (source.includes('free-models-per-min')
    || source === 'openrouter_free_tier_per_minute'
    || /free-models-per-min/i.test(message))) {
    return { kind: 'per-minute', message, resetAt };
  }
  return { kind: 'provider', message, resetAt };
};

const responseHeader = (response, payload, name) => {
  const bodyHeaders = payload?.error?.metadata?.headers || payload?.metadata?.headers || {};
  return response.headers?.get?.(name)
    || bodyHeaders[name]
    || bodyHeaders[name.toLowerCase()]
    || Object.entries(bodyHeaders).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
    || null;
};

const retryAfterMs = (response, payload) => {
  const raw = responseHeader(response, payload, 'retry-after');
  if (raw == null || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(String(raw));
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
};

const jitteredRetryDelay = (attempt) => {
  const base = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  return Math.max(0, Math.round(base * (0.5 + Math.random())));
};

const streamHttpError = (response, errorBody, payload, rateLimit) => {
  const detail = String(errorBody || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const error = new Error(`Stream HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}${detail ? `: ${detail}` : ''}`);
  error.status = response.status;
  error.limitSource = payload?.error?.metadata?.limit_source
    || payload?.error?.limit_source
    || payload?.limit_source
    || responseHeader(response, payload, 'X-RateLimit-Limit-Source')
    || responseHeader(response, payload, 'X-RateLimit-Source')
    || null;
  error.resetAt = rateLimit?.resetAt ?? rateLimitResetAt(response, payload);
  error.retryAfterMs = retryAfterMs(response, payload);
  return error;
};

const abortableDelay = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted || ms <= 0) return resolve(false);
  const onAbort = () => { clearTimeout(timer); resolve(false); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(true); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

/**
 * @param {object} [options]
 * @param {boolean} [options.structured]  return the whole reply (see
 *        lib/model-reply.js) instead of just its text. Native `tool_calls`,
 *        `refusal`, `finish_reason` and token usage survive only on this path.
 * @param {Array} [options.tools]  OpenAI-style tool schemas. Sending these is
 *        what makes native `tool_calls` possible at all — a model that is not
 *        offered any tools will never emit one, however capable it is.
 * @param {string} [options.toolChoice]  'auto' | 'none' | 'required'. 'none' is
 *        how the loop's final round is ENFORCED rather than merely requested.
 * @param {object} [options.reasoning]  overrides the default `{exclude: true}`,
 *        e.g. `{effort: 'high', exclude: true}` for the native tool seat: think
 *        hard, but do not return the thinking as the answer.
 * @param {number} [options.maxRetries]  how many EXTRA POSTs a retryable
 *        failure may make. Defaults to the full backoff ladder, which is what
 *        every caller had before this existed. `0` means one request and no
 *        more — see the council's use of it in lib/council-run.js, and the
 *        matching option on `fetchOpenRouterStream`, which has always had one.
 */
async function callModel(host, apiKey, modelName, messages, temperature, timeoutMs, maxTokens, parentSignal, options = {}) {
  const structured = Boolean(options && options.structured);
  /* Every early exit below used to be the bare string ''. In structured mode it
   * has to be an object or each caller grows a type check it will forget. */
  const blank = (reason) => (structured ? emptyReply(reason) : '');
  if (parentSignal?.aborted) return blank('aborted');
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  const tools = Array.isArray(options?.tools) && options.tools.length ? options.tools : null;
  const body = JSON.stringify({
    model: modelName,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
    reasoning: options?.reasoning && typeof options.reasoning === 'object' ? options.reasoning : { exclude: true },
    /* Omitted entirely rather than sent empty. `tools: []` is a different
     * request from no tools at all on some providers, and every seat except the
     * native one must keep the byte-identical body it has always had. */
    ...(tools ? { tools } : {}),
    ...(tools && options.toolChoice ? { tool_choice: options.toolChoice } : {}),
  });

  /* The ladder is the default and stays the default: every caller that does not
   * ask for something else keeps the two retries it has always had. Clamped to
   * the ladder because a caller cannot invent delays that do not exist. */
  const retryLimit = Number.isFinite(Number(options?.maxRetries))
    ? Math.max(0, Math.min(RETRY_DELAYS_MS.length, Math.floor(Number(options.maxRetries))))
    : RETRY_DELAYS_MS.length;

  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    const remainingMs = deadline - Date.now();
    if (parentSignal?.aborted) return blank('aborted');
    if (remainingMs <= 0) return blank('deadline');
    /* ONE PHYSICAL REQUEST TO THE GATEWAY, REPORTED AS ONE.
     *
     * The retries in this loop are real POSTs against an account-wide daily
     * request cap, and nothing outside this function could see them: the caller
     * gets one reply and counts one seat, so a seat that was retried twice was
     * billed as one request by the ceiling built to bound exactly that. The
     * hook is optional and every failure in it is swallowed — telemetry must
     * never fail a model call. */
    const attemptStartedAt = Date.now();
    let attemptReported = false;
    const reportAttempt = (outcome, status = null) => {
      if (attemptReported) return;
      attemptReported = true;
      try {
        options?.onAttempt?.({
          provider: 'openrouter', model: modelName, attempt: attempt + 1,
          outcome, status, ms: Date.now() - attemptStartedAt, streamed: false,
        });
      } catch { /* a recorder must never break the call it is recording */ }
    };
    const controller = new AbortController();
    const onParentAbort = () => controller.abort(parentSignal.reason);
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => controller.abort('timeout'), remainingMs);
    let retryable = false;
    let retryDelayMs;
    try {
      const response = await fetch(endpointFor(host), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (response.ok) {
        let payload;
        try {
          payload = await response.json();
        } catch (parseError) {
          /* THE GATEWAY ANSWERED; ONLY THE BODY WAS GARBAGE. Letting this throw
           * to the outer catch reported it as `network_error` with a null
           * status, which counted the attempt under `byStatus.none` — the
           * bucket that means "no reply at all". Same control flow as before
           * (the parse error still propagates and is still not retried); only
           * the label and the status it is filed under change. */
          reportAttempt('bad_body', response.status);
          throw parseError;
        }
        reportAttempt('ok', response.status);
        return structured ? normaliseCompletion(payload) : completionText(payload);
      }
      const errorBody = await response.text().catch(() => '');
      reportAttempt('http_error', response.status);
      if (response.status === 429) {
        const rateLimit = classify429(response, errorBody);
        if (rateLimit.kind === 'daily') {
          throw new OpenRouterRateLimitError('daily', rateLimit.message, { resetAt: rateLimit.resetAt });
        }
        if (rateLimit.kind === 'per-minute') {
          const waitMs = rateLimit.resetAt == null
            ? Infinity
            : Math.max(0, rateLimit.resetAt - Date.now() + RATE_LIMIT_RESET_SAFETY_MS);
          if (attempt >= retryLimit || waitMs >= deadline - Date.now()) {
            throw new OpenRouterRateLimitError('per-minute', rateLimit.message, { resetAt: rateLimit.resetAt });
          }
          retryable = true;
          retryDelayMs = waitMs;
        } else {
          retryable = true;
        }
      } else {
        retryable = response.status >= 500;
      }
      if (!retryable || attempt >= retryLimit) {
        throw new Error(`OpenRouter ${response.status}: ${errorBody.slice(0, 500)}`);
      }
    } catch (error) {
      if (controller.signal.aborted || parentSignal?.aborted || Date.now() >= deadline) {
        /* Reported only when the socket was actually opened — an abort BEFORE
         * the fetch (checked at the top of the loop) never reached the gateway
         * and must not be charged as an attempt. Here the request was already
         * in flight, so the provider saw it whether or not we read the reply. */
        reportAttempt(parentSignal?.aborted ? 'aborted' : 'timeout', null);
        return blank(parentSignal?.aborted ? 'aborted' : 'timeout');
      }
      reportAttempt('network_error', null);
      /* HOW MANY PHYSICAL REQUESTS THIS FAILURE COST, carried on the error.
       *
       * Every throw in the block above lands here, so this is the one place
       * that knows the attempt count at the moment the call gives up. The
       * pacer's breaker counts one failure per `run()`, which is one CALL and
       * not one request — so a model failing on its third attempt looked
       * exactly like a model failing on its first, and the breaker needed
       * `failureThreshold` calls (five) to open. At three POSTs each that is
       * fifteen requests against the account's daily cap before a dead model
       * is refused. The count is what makes the two agree. */
      if (error && typeof error === 'object') error.providerAttempts = attempt + 1;
      if (!retryable) throw error;
      if (attempt >= retryLimit) throw error;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
    const delay = Math.min(retryDelayMs ?? RETRY_DELAYS_MS[attempt], deadline - Date.now());
    if (delay > 0 && !(await abortableDelay(delay, parentSignal))) return blank('aborted');
  }
  return blank('deadline');
}

/**
 * Open a streaming completion, retrying only failures that happened before a
 * response body was handed to the caller. The caller owns the reader and may
 * already have written bytes by the time it sees a later stream error; this
 * helper therefore never retries after returning a response.
 *
 * Provider 429s are transient and get one same-model retry. Account daily and
 * per-minute limits are not treated as provider health: the former cannot be
 * helped by another request, and the latter is handled by the turn-level
 * reset policy. A Retry-After header wins over the local jittered backoff.
 */
async function fetchOpenRouterStream(
  host,
  apiKey,
  modelName,
  messages,
  temperature = 0.0,
  parentSignal,
  maxTokens = null,
  { deadlineAt = null, timeoutMs = 30_000, maxRetries = 1, includeUsage = false, reasoning, onAttempt } = {},
) {
  if (parentSignal?.aborted) throw parentSignal.reason || new DOMException('Aborted', 'AbortError');
  const suppliedDeadline = deadlineAt == null ? null : Number(deadlineAt);
  const fallbackTimeout = Number(timeoutMs);
  const deadline = Number.isFinite(suppliedDeadline)
    ? suppliedDeadline
    : Date.now() + Math.max(0, Number.isFinite(fallbackTimeout) ? fallbackTimeout : 30_000);
  const retryLimit = Math.max(0, Math.floor(Number(maxRetries) || 0));
  const body = JSON.stringify({
    model: modelName,
    messages,
    temperature,
    stream: true,
    reasoning: reasoning && typeof reasoning === 'object' ? reasoning : { exclude: true },
    /* WITHOUT THIS OPENROUTER SENDS NO USAGE FRAME ON A STREAM, so the
     * synthesis — the single longest generation of a turn — is the one call
     * whose token count nothing can see. `callModel` gets `usage` in its JSON
     * body for free; a stream has to ask.
     *
     * OFF BY DEFAULT, and that is not timidity. It is an OpenRouter extension
     * rather than an OpenAI field (OpenAI spells it
     * `stream_options.include_usage`), and it goes in the body of the request
     * that writes every answer this product produces. There is no OpenRouter
     * key on the development machine, so the claim "the gateway accepts this"
     * could not be MEASURED here — and an unverified body field on that path
     * fails as a product-wide outage rather than as missing telemetry.
     *
     * To turn it on: probe the live gateway once (one request), confirm HTTP
     * 200 and a frame carrying `usage`, then set `STREAM_USAGE_ACCOUNTING=1`.
     * The parser and the telemetry sink are already wired and tested; the flag
     * is the only thing between them and real numbers. */
    ...(includeUsage ? { usage: { include: true } } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  });

  for (let attempt = 0; ; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (parentSignal?.aborted) throw parentSignal.reason || new DOMException('Aborted', 'AbortError');
    if (remainingMs <= 0) {
      const error = new Error('OpenRouter stream deadline exceeded');
      error.code = 'OPENROUTER_DEADLINE';
      throw error;
    }

    const controller = new AbortController();
    const onParentAbort = () => controller.abort(parentSignal.reason);
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => controller.abort('timeout'), remainingMs);
    /* THE RETURNED BODY OUTLIVES THIS FUNCTION, AND SO MUST THE ABORT LINK.
     *
     * The caller reads the stream in its own loop and cancels a turn by
     * aborting the signal it passed in — nothing in that loop tests the signal
     * itself, so the fetch is the only thing that can stop it. Dropping the
     * parent listener on the way out would leave a handed-off response with no
     * route from the turn's abort to its own reader: a user who closes the tab
     * would keep paying for tokens nobody will read, which is the exact
     * behaviour the abort work exists to prevent, and it would be invisible.
     *
     * The TIMEOUT is cleared either way. It bounds opening the stream, not
     * reading it; leaving it armed would abort a healthy long answer mid-word. */
    let handedOff = false;
    /* Same accounting as the non-streaming loop: one POST to the gateway is one
     * physical request against the account's daily cap, retry or not. A stream
     * that 429s and is retried was two requests and used to be counted as one. */
    const attemptStartedAt = Date.now();
    let attemptReported = false;
    const reportAttempt = (outcome, status = null) => {
      if (attemptReported) return;
      attemptReported = true;
      try {
        onAttempt?.({
          provider: 'openrouter', model: modelName, attempt: attempt + 1,
          outcome, status, ms: Date.now() - attemptStartedAt, streamed: true,
        });
      } catch { /* a recorder must never break the call it is recording */ }
    };
    try {
      let response;
      try {
        response = await fetch(endpointFor(host), {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        reportAttempt(parentSignal?.aborted ? 'aborted' : 'network_error', null);
        if (controller.signal.aborted && (parentSignal?.aborted || Date.now() >= deadline)) throw error;
        throw error;
      }

      if (response.ok) {
        handedOff = true;
        reportAttempt('ok', response.status);
        return response;
      }

      reportAttempt('http_error', response.status);
      const errorBody = await response.text().catch(() => '');
      const payload = parseErrorBody(errorBody);
      const rateLimit = response.status === 429 ? classify429(response, errorBody) : null;
      const error = streamHttpError(response, errorBody, payload, rateLimit);
      if (response.status !== 429
        || rateLimit.kind !== 'provider'
        || attempt >= retryLimit) throw error;

      const delay = error.retryAfterMs ?? jitteredRetryDelay(attempt);
      if (delay >= deadline - Date.now()) throw error;
      if (delay > 0 && !(await abortableDelay(delay, parentSignal))) {
        throw parentSignal?.reason || new DOMException('Aborted', 'AbortError');
      }
    } finally {
      clearTimeout(timer);
      if (!handedOff) parentSignal?.removeEventListener('abort', onParentAbort);
    }
  }
}

async function getOpenRouterKeyStatus(host, apiKey, signal) {
  const response = await fetch(keyEndpointFor(host), {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`OpenRouter key status ${response.status}`);
  const data = payload?.data || payload || {};
  return {
    isFreeTier: Boolean(data.is_free_tier),
    usage: data.usage ?? null,
    limitRemaining: data.limit_remaining ?? null,
  };
}

function parseOpenRouterSseLine(line) {
  const value = typeof line === 'string' ? line.trim() : '';
  if (!value || value.startsWith(':') || !value.startsWith('data:')) return { skip: true, done: false, text: '', reasoning: '' };
  const data = value.slice(5).trim();
  if (data === '[DONE]') return { skip: false, done: true, text: '', reasoning: '' };
  let payload;
  try { payload = JSON.parse(data); } catch { return { skip: true, done: false, text: '', reasoning: '' }; }
  const choice = payload?.choices?.[0];
  const delta = choice?.delta;
  /* CONTENT AND REASONING ARE TWO FIELDS, AND THIS USED TO RETURN ONE.
   *
   * The old expression was `content || reasoning`, so a model streaming its
   * chain-of-thought had that thinking written to the socket as `type: 'chunk'`
   * — rendered as the answer, revealed by the same cadence, saved into the chat
   * and written to the shared answer cache. lib/model-reply.js had already made
   * this distinction on the NON-streaming path (`textSource`); the streaming
   * path, which writes every answer a user actually reads, had not.
   *
   * The rescue is kept, but it moves to the consumer: streamOnce holds the
   * reasoning and only promotes it to an answer if the stream ends having
   * emitted no content at all. That is the same rule normaliseCompletion
   * applies, and it can only fire once, at the end, rather than interleaving
   * thinking with the answer it was thinking about. */
  const text = typeof delta?.content === 'string' ? delta.content : '';
  const reasoning = typeof delta?.reasoning === 'string' && delta.reasoning
    ? delta.reasoning
    : Array.isArray(delta?.reasoning_details)
      ? delta.reasoning_details.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('')
      : '';
  /* USAGE ARRIVES ON ITS OWN FRAME, AFTER the frame that carries
   * finish_reason. Returning it here is what lets the streaming path account
   * for tokens at all: `callModel` gets `usage` in its single JSON body, the
   * streamed synthesis had no equivalent and was billed as an unknown. A frame
   * that carries only usage has no text and no finish_reason, so it must not be
   * reported as `done` — the terminator is still `[DONE]`. */
  return {
    skip: false,
    done: choice?.finish_reason != null,
    text,
    reasoning,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    usage: normaliseUsage(payload?.usage),
  };
}

module.exports = {
  callModel,
  fetchOpenRouterStream,
  getOpenRouterKeyStatus,
  OpenRouterRateLimitError,
  parseOpenRouterSseLine,
};
