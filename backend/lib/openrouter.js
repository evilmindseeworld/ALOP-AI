'use strict';

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

const completionText = (message) => {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.content === 'string' && message.content.trim()) return message.content;
  if (typeof message.reasoning === 'string' && message.reasoning.trim()) return message.reasoning;
  if (Array.isArray(message.reasoning_details)) {
    return message.reasoning_details.map((part) => part && typeof part.text === 'string' ? part.text : '').filter(Boolean).join('');
  }
  return '';
};

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

async function callModel(host, apiKey, modelName, messages, temperature, timeoutMs, maxTokens, parentSignal) {
  if (parentSignal?.aborted) return '';
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  const body = JSON.stringify({ model: modelName, messages, temperature, max_tokens: maxTokens, stream: false, reasoning: { exclude: true } });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const remainingMs = deadline - Date.now();
    if (parentSignal?.aborted || remainingMs <= 0) return '';
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
        const payload = await response.json();
        return completionText(payload?.choices?.[0]?.message);
      }
      const errorBody = await response.text().catch(() => '');
      if (response.status === 429) {
        const rateLimit = classify429(response, errorBody);
        if (rateLimit.kind === 'daily') {
          throw new OpenRouterRateLimitError('daily', rateLimit.message, { resetAt: rateLimit.resetAt });
        }
        if (rateLimit.kind === 'per-minute') {
          const waitMs = rateLimit.resetAt == null
            ? Infinity
            : Math.max(0, rateLimit.resetAt - Date.now() + RATE_LIMIT_RESET_SAFETY_MS);
          if (attempt >= RETRY_DELAYS_MS.length || waitMs >= deadline - Date.now()) {
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
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
        throw new Error(`OpenRouter ${response.status}: ${errorBody.slice(0, 500)}`);
      }
    } catch (error) {
      if (controller.signal.aborted || parentSignal?.aborted || Date.now() >= deadline) return '';
      if (!retryable) throw error;
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
    const delay = Math.min(retryDelayMs ?? RETRY_DELAYS_MS[attempt], deadline - Date.now());
    if (delay > 0 && !(await abortableDelay(delay, parentSignal))) return '';
  }
  return '';
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
  { deadlineAt = null, timeoutMs = 30_000, maxRetries = 1 } = {},
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
    reasoning: { exclude: true },
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
        if (controller.signal.aborted && (parentSignal?.aborted || Date.now() >= deadline)) throw error;
        throw error;
      }

      if (response.ok) {
        handedOff = true;
        return response;
      }

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
  if (!value || value.startsWith(':') || !value.startsWith('data:')) return { skip: true, done: false, text: '' };
  const data = value.slice(5).trim();
  if (data === '[DONE]') return { skip: false, done: true, text: '' };
  let payload;
  try { payload = JSON.parse(data); } catch { return { skip: true, done: false, text: '' }; }
  const choice = payload?.choices?.[0];
  const delta = choice?.delta;
  const text = typeof delta?.content === 'string' && delta.content
    ? delta.content
    : typeof delta?.reasoning === 'string' ? delta.reasoning : '';
  return { skip: false, done: choice?.finish_reason != null, text };
}

module.exports = {
  callModel,
  fetchOpenRouterStream,
  getOpenRouterKeyStatus,
  OpenRouterRateLimitError,
  parseOpenRouterSseLine,
};
