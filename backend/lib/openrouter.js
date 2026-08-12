'use strict';

const RETRY_DELAYS_MS = [400, 1200];

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
      retryable = response.status === 429 || response.status >= 500;
      const errorBody = await response.text().catch(() => '');
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
    const delay = Math.min(RETRY_DELAYS_MS[attempt], deadline - Date.now());
    if (!(await abortableDelay(delay, parentSignal))) return '';
  }
  return '';
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

module.exports = { callModel, parseOpenRouterSseLine };
