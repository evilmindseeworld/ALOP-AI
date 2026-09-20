import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertAllowedOpenRouterModel } = require('../backend/lib/openrouter-policy.js');

const API_ROOT = 'https://openrouter.ai/api/v1';
const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error('OPENROUTER_API_KEY is required');
  process.exitCode = 1;
} else {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const modelsResponse = await fetch(`${API_ROOT}/models`, { headers });
  if (!modelsResponse.ok) throw new Error(`Model list failed: HTTP ${modelsResponse.status}`);
  const models = (await modelsResponse.json()).data.map((model) => model.id).filter((id) => id.endsWith(':free')).sort();
  console.log('id | content-at-10-tokens present? | first-byte ms | total ms | reasoning-only?');
  console.log('--- | --- | ---: | ---: | ---');

  const pause = (ms, signal) => new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  const fetchTransiently = async (url, options) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url, options);
      if (response.status !== 429 && response.status < 500) return response;
      if (attempt === 2) return response;
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
      await pause(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : [10000, 30000][attempt],
        options.signal,
      );
    }
  };

  for (const model of models) {
    const run = async (maxTokens) => {
      const started = performance.now();
      const signal = AbortSignal.timeout(20000);
      let response;
      try {
        assertAllowedOpenRouterModel(model, { source: 'tools-or-probe' });
        response = await fetchTransiently(`${API_ROOT}/chat/completions`, {
          method: 'POST', headers, signal,
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly: probe successful' }], max_tokens: maxTokens, temperature: 0, stream: true }),
        });
      } catch (error) {
        return { error: signal.aborted ? 'timeout' : error.name };
      }
      if (!response.ok) return { error: `HTTP ${response.status}` };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let firstByteMs = null;
      let content = '';
      let reasoning = '';
      let pending = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstByteMs === null) firstByteMs = Math.round(performance.now() - started);
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const delta = JSON.parse(raw)?.choices?.[0]?.delta;
              if (typeof delta?.content === 'string') content += delta.content;
              if (typeof delta?.reasoning === 'string') reasoning += delta.reasoning;
            } catch { /* ignore malformed provider events */ }
          }
        }
      } catch (error) {
        return { error: signal.aborted ? 'timeout' : error.name };
      }
      return { content, reasoning, firstByteMs: firstByteMs ?? Math.round(performance.now() - started), totalMs: Math.round(performance.now() - started) };
    };

    const short = await run(10);
    await pause(4000);
    const long = await run(200);
    if (short.error || long.error) {
      console.log(`${model} | ${short.error || 'n/a'} | ${long.firstByteMs ?? 'n/a'} | ${long.totalMs ?? 'n/a'} | ${long.error || 'n/a'}`);
    } else {
      const reasoningOnly = !long.content.trim() && Boolean(long.reasoning.trim());
      console.log(`${model} | ${short.content.trim() ? 'yes' : 'no'} | ${long.firstByteMs} | ${long.totalMs} | ${reasoningOnly ? 'yes' : 'no'}`);
    }
    await pause(4000);
  }
}
