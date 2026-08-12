/**
 * ALOP-AI ULTIMATE PRECISION BACKEND
 * 
 * Features: AI memory detection, persistent Supabase memory, 5 search sources,
 * search cache, response cache, language detection, self-selecting council,
 * streaming fallback, image support, 12 anti-hallucination rules, feedback learning,
 * bulletproof overlay.
 */

// dotenv must load before Sentry.init so SENTRY_DSN is readable, and Sentry must
// init before the app modules it instruments are required.
require('dotenv').config();

const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

const IS_PROD = process.env.NODE_ENV === 'production';
if (!process.env.SENTRY_DSN) {
  console.warn('[BOOT] SENTRY_DSN not set — error reporting disabled.');
}
Sentry.init({
  // A DSN is write-only, but hardcoding one lets anyone burn the project's event quota.
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV || 'development',
  integrations: [Sentry.httpIntegration(), Sentry.expressIntegration(), nodeProfilingIntegration()],
  // Full sampling is fine locally; in production it is pure cost for no extra signal.
  tracesSampleRate: IS_PROD ? 0.1 : 1.0,
  profilesSampleRate: IS_PROD ? 0.1 : 1.0,
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const timeout = require('connect-timeout');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { clerkMiddleware, getAuth, clerkClient } = require('@clerk/express');
const Stripe = require('stripe');
const { timeoutSignal, childAbortController } = require('./lib/abort');
const { createTurnTelemetry } = require('./lib/turn-telemetry');
const { priceTurn, reservationCents, LIMITS } = require('./lib/spend');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ===== ENV =====
// Core config: the server cannot answer a single request without these.
// CLERK_PUBLISHABLE_KEY is deliberately absent — it is a frontend value and is
// never read here, so requiring it only blocked startup for no reason.
const requiredEnv = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CLERK_SECRET_KEY','FRONTEND_URL','OLLAMA_HOST','OLLAMA_API_KEY'];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length > 0) { console.error(`Missing required env: ${missingEnv.join(', ')}`); process.exit(1); }

// @clerk/express refuses to build its middleware without this. Not fatal here on
// purpose: refusing to boot would turn a misconfigured deploy into a full outage, and
// this warning names the cause in the very first log line. Authenticated routes answer
// 500 while it is missing; unauthenticated ones, /health included, keep working.
if (!process.env.CLERK_PUBLISHABLE_KEY) {
  console.warn('[BOOT] CLERK_PUBLISHABLE_KEY not set — every authenticated route will fail with 500.');
}

// Billing is optional. Without it the app runs normally and only the Stripe
// routes refuse, instead of the whole process refusing to boot.
const STRIPE_ENABLED = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
if (!STRIPE_ENABLED) console.warn('[BOOT] Stripe not configured — billing routes disabled.');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || null;
const JINA_API_KEY = process.env.JINA_API_KEY || null;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || null;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || null;
/* Overridable because Perplexity renames its models more often than this file
 * changes, and a deployment should not need a code change to follow. `sonar` is
 * the cheap tier and is the right default for search context; `sonar-pro`
 * researches harder and costs more per call. */
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || 'sonar';
/** Sonar's name for the four windows lib/recency.js already decides between. */
const PERPLEXITY_RECENCY = { day: 'day', week: 'week', month: 'month', year: 'year' };
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || null;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY || null;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || null;

const stripe = STRIPE_ENABLED ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;
const requireStripe = (req, res, next) => STRIPE_ENABLED ? next() : res.status(503).json({ error: 'Billing is not configured on this server.' });
const OLLAMA_HOST = process.env.OLLAMA_HOST;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// ===== MODELS =====
// One seat per model family. The previous roster ran three Kimi variants,
// three MiniMax variants, two GLM and two Nemotron — thirteen calls that
// largely restated each other. A council is only worth its cost if the members
// can actually disagree, so near-siblings were dropped rather than kept.
//
// Temperature is per-seat and deliberately spread. Every model previously ran
// at 0.0, which made them converge on the same answer and left the synthesis
// step with nothing to reconcile. The determinism that matters — extracting
// facts from search results — is unaffected; those paths still run at 0.0.
const COUNCIL = [
  { model: 'glm-5.2',          temperature: 0.2, free: false },
  { model: 'kimi-k2.7-code',   temperature: 0.3, free: true  },
  { model: 'qwen3.5',          temperature: 0.5, free: true  },
  { model: 'gemma4',           temperature: 0.7, free: true  },
  { model: 'deepseek-v4-pro',  temperature: 0.4, free: false },
  { model: 'nemotron-3-ultra', temperature: 0.5, free: false },
  { model: 'minimax-m3',       temperature: 0.8, free: false },
];

const FREE_COUNCIL = COUNCIL.filter((m) => m.free);
// The single model used for streaming: synthesis, greetings, fallback and
// search extraction all speak with one voice, so it stays deterministic.
const PRIMARY_MODEL = 'glm-5.2';
const FAST_MODEL = 'gemma4';

// ===== AI HELPERS =====
const callModel = async (modelName, messages, temperature = 0.0, timeoutMs = 30000, maxTokens = 1000, parentSignal) => {
  const timed = timeoutSignal(parentSignal, timeoutMs);
  try {
    const res = await fetch(OLLAMA_HOST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` }, body: JSON.stringify({ model: modelName, messages, stream: false, options: { temperature, num_predict: maxTokens } }), signal: timed.signal });
    if (!res.ok) { const text = await res.text(); throw new Error(`Model ${modelName}: ${res.status} ${text.slice(0,200)}`); }
    const data = await res.json();
    return data.message?.content || data.response || '';
  } catch (err) { if (timed.signal.aborted || err.name === 'AbortError') return ''; throw err; }
  finally { timed.dispose(); }
};

const streamModel = async (res, modelName, messages, temperature = 0.0, signal) => {
  const response = await fetch(OLLAMA_HOST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` }, body: JSON.stringify({ model: modelName, messages, stream: true, options: { temperature } }), ...(signal ? { signal } : {}) });
  if (!response.ok || !response.body) throw new Error('Stream failed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) { const t = line.trim(); if (!t) continue; try { const p = JSON.parse(t); const d = p.message?.content || p.response || ''; if (d) { /* The moment the ANSWER starts, which stopped being the same moment
           * the response opens once progress events were added. msToFirstByte
           * is the number every latency change is judged by; leaving it stamped
           * at openStream would have made this feature look like a 15-second
           * improvement while the user waited exactly as long. */
          if (res.locals && !res.locals.firstChunkAt) res.locals.firstChunkAt = Date.now();
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: d })}\n\n`); } if (p.done) { completed = true; res.write('data: [DONE]\n\n'); } } catch {} }
  }
  if (!completed) throw new Error('Stream ended before provider completion');
};

const callGeminiVision = async (modelName, prompt, base64Image, mimeType = 'image/png', maxTokens = 2048, parentSignal) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  if (Buffer.byteLength(base64Image, 'base64') / (1024*1024) > 8) throw new Error('Image too large');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const timed = timeoutSignal(parentSignal, 30000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }], generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens } }), signal: timed.signal });
    if (!res.ok) { const t = await res.text(); throw new Error(`Gemini: ${res.status} ${t.slice(0,300)}`); }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } finally {
    timed.dispose();
  }
};

// ===== COUNCIL =====
// The runner lives in lib/council-run.js so it can be tested: server.js calls
// process.exit(1) at import time on a missing env var, so nothing defined here
// is reachable from a test file. It is the most intricate concurrency in the
// product and it had no coverage at all until it moved.
const { runCouncil, isUsableAnswer } = require('./lib/council-run');

/**
 * `members` is a list of { model, temperature } seats. Each speaks at its own
 * temperature, which is what makes the council produce genuinely different
 * takes to synthesise rather than one answer seven times.
 */
const runCouncilWithWhip = (members, messages, whipMs, quorum, tokenLimit, onSeat, options = {}) =>
  runCouncil(members, messages, whipMs, quorum, tokenLimit, { callModel, onSeat, ...options });

// ===== ROUTER =====
// Moved to lib/router.js, where it can be called with a sentence and checked.
// These five decisions shape a system prompt each, and a wrong one is invisible
// in every log: the council still runs, still streams, and answers a German
// question in French. See the header of that file for what each one gets wrong
// when it is wrong.
const {
  detectLanguage,
  wantsDetailedAnswer,
  needsWikiCheck,
  classifyRequest,
} = require('./lib/router');

// ===== MEMORY DETECTION =====
const isMemoryOrReferenceQuestion = async (text, signal) => {
  const response = await callModel(FAST_MODEL, [{ role: 'system', content: 'Is this question asking about a previous conversation or referencing something discussed earlier? Reply ONLY "YES" or "NO".' }, { role: 'user', content: text.slice(0, 500) }], 0.0, 3000, 10, signal);
  return response.trim().toUpperCase().startsWith('YES');
};

// ===== SEARCH DECISION =====
// The region reaches the QUERY, not just the answer. A prompt hint makes the
// model *phrase* prices differently; it cannot make a search API return a
// local retailer it was never asked for. "OLED monitor price" returns US shops
// to everyone — "OLED monitor price UAE" does not, and that is the difference
// between a converted number and an actual place to buy the thing.
//
// Only where it helps: a query about tax law or a person is not improved by a
// country appended to it, so the model is told to use it when the answer is
// local and to leave it alone otherwise.
const getSearchQuery = async (text, convSummary, region, signal) => {
  const userContent = convSummary ? `Context: ${convSummary}\n\nQuestion: ${text}` : text;
  const locale = region
    ? ` The user appears to be in ${region.place}. If — and only if — the answer depends on where they are (prices, availability, retailers, local services, regulations), include that country in the query. Otherwise ignore it.`
    : '';
  /* THE DATE IS IN THIS PROMPT BECAUSE THE DECISION DEPENDS ON IT.
   *
   * This model was deciding whether a question needs live information while
   * believing the present day was somewhere in its training data. Both halves
   * of that go wrong. It under-triggers — "what's the latest version" feels
   * answerable from memory when your memory feels current — and when it does
   * search it writes an undated query, so a well-linked article from two years
   * ago outranks the current one and nothing downstream can tell.
   *
   * The old trigger list was "products, facts, reviews, specs, prices", which
   * omits every category that goes stale fastest: releases, versions, who holds
   * a post, whether a thing still exists. And "Memory/reference questions do
   * NOT need search" was read far too broadly by the model — "what is X" about
   * a fast-moving library is a reference question whose answer changed last
   * month. That clause now names the ONE case it was written for: a question
   * about this conversation.
   *
   * The default is inverted too. It was "search only if clearly needed"; it is
   * now "search unless the answer cannot change", because the two mistakes are
   * not symmetrical. An unnecessary search costs about a second and some quota.
   * A skipped one produces a confidently wrong answer the user has no way to
   * detect. */
  const sys = `${todayLine()}

Decide what to search the web for before answering the user's question.

SEARCH when the answer could have changed since your training, or when you would otherwise be recalling rather than knowing. That includes: anything current or "latest"; prices, availability and stock; software versions, releases and whether a project is still maintained; people's current roles; news and events; laws, rules and policies; company facts like ownership, funding or pricing tiers; specs, reviews and comparisons of real products; anything with a year in it.

DO NOT search when the answer cannot change: mathematics, definitions, established science and history, how a well-known algorithm or protocol works, code the user pasted, creative writing, opinions, or a question about THIS conversation.

If in doubt, search. A needless search costs a second; a skipped one makes you assert something stale as fact.

Reply with the search queries, ONE PER LINE, at most 2. Write them as a person would type into a search engine — keywords, not a sentence, no quotes, no numbering. Use a second query only when the question genuinely has two parts that one query cannot cover; otherwise reply with exactly one line. Include the current year in a query only when recency is the point.

If no search is needed, reply with exactly: NO${locale}`;
  // 120 tokens rather than 50: two queries plus a stray word of preamble did
  // not fit in 50, and the ceiling truncated the SECOND query mid-word, which
  // parses as a valid short query and searches for half a phrase.
  const response = await callModel(FAST_MODEL, [{ role: 'system', content: sys }, { role: 'user', content: userContent }], 0.0, 4000, 120, signal);
  return parseSearchPlan(response);
};

// ===== SEARCH FUNCTIONS =====
/* EVERY PROVIDER IS NOW ASKED FOR A DATE, AND TOLD WHEN "OLD" STARTS.
 *
 * Neither used to happen, and the two omissions compound. Search ranking
 * REWARDS age — an article with three years of backlinks outranks yesterday's
 * — so an unqualified query reliably returns the well-established stale page
 * over the current one. Then the snippets arrived carrying no dates at all, so
 * even a model that suspected the answer was old had nothing to check it
 * against. The result was confidently outdated answers with real citations,
 * which is the hardest kind to notice.
 *
 * `fresh` is the neutral window from lib/recency and is NULL for any question
 * that is not about the present, because the reverse mistake is just as real:
 * restricting "how does TCP slow start work" to the last year throws away the
 * canonical sources and returns blog posts. See freshnessWindow for why the
 * default window is a year rather than a month.
 */
const searchBrave = async (query, fresh = null, parentSignal) => {
  if (!BRAVE_API_KEY) return [];
  // Brave returns `page_age` as ISO and `age` as prose ("3 days ago"). The ISO
  // one is preferred and the prose one is not parsed — a label that has to be
  // guessed at is the thing normalizeDate exists to refuse.
  const freshness = fresh ? `&freshness=${BRAVE_FRESHNESS[fresh.label] || 'py'}` : '';
  const timed = timeoutSignal(parentSignal, 8000);
  try { const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query.slice(0,200))}&count=10${freshness}`, { method: 'GET', headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY }, signal: timed.signal }); if (!res.ok) return []; const data = await res.json(); return (data.web?.results || []).map(r => ({ title: r.title?.slice(0,200)||'', url: r.url, description: r.description?.slice(0,500)||'', date: normalizeDate(r.page_age) })); } catch { return []; } finally { timed.dispose(); }
};
const searchTavily = async (query, fresh = null, parentSignal) => {
  if (!TAVILY_API_KEY) return { answer: '', results: [], images: [] };
  // `days` only applies to topic:news on Tavily, so both are set together or
  // neither is. Sending `days` alone is silently ignored, which would look like
  // the freshness window was applied when it was not.
  const recency = fresh ? { topic: 'news', days: fresh.days } : {};
  const timed = timeoutSignal(parentSignal, 7000);
  try { const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query.slice(0,400), search_depth: 'advanced', include_answer: true, include_raw_content: false, include_images: true, include_image_descriptions: true, max_results: 5, ...recency }), signal: timed.signal }); if (!res.ok) return { answer: '', results: [], images: [] }; const data = await res.json(); return { answer: data.answer||'', results: (data.results||[]).map(r => ({ title: r.title?.slice(0,200)||'', url: r.url, content: (r.content||'').slice(0,3000), date: normalizeDate(r.published_date) })), images: (data.images||[]).map(img => typeof img === 'string' ? img : (img.url||img)) }; } catch { return { answer: '', results: [], images: [] }; } finally { timed.dispose(); }
};
/**
 * Perplexity Sonar. A sixth provider, and the only one that reasons.
 *
 * The other five return links and snippets; Sonar returns a written answer with
 * the sources it used. That is worth having for the questions this app is
 * weakest at — market research, "what happened this week", anything where the
 * answer is spread across several pages rather than sitting on one. Tavily's
 * synthesised `answer` is the closest existing thing and is a sentence or two;
 * this is a paragraph with citations.
 *
 * NOT A COUNCIL SEAT. It contributes search CONTEXT that the council then
 * answers from, exactly like Brave and Tavily. Making it a seat would put a
 * model with its own web access inside a roster whose whole argument is that
 * seven differently-tempered readings of the SAME context disagree usefully.
 *
 * Its output is a third party's text and reaches the prompt through the same
 * UNTRUSTED_PREAMBLE as every other source — it is a model reading web pages,
 * so anything a page told it, it will repeat.
 *
 * Absent key means absent provider, the same as Brave and Tavily: it returns
 * empty, settleByDeadline takes the fallback, and nothing else changes. This
 * costs a deployment without PERPLEXITY_API_KEY exactly nothing.
 */
const searchPerplexity = async (query, fresh = null, parentSignal) => {
  if (!PERPLEXITY_API_KEY) return { answer: '', results: [] };
  // Sonar takes the same four windows the other providers do, under its own
  // name. Sent only when a window was actually chosen — an unasked-for filter
  // is how a slow-topic question loses its canonical sources.
  const recency = fresh && PERPLEXITY_RECENCY[fresh.label] ? { search_recency_filter: PERPLEXITY_RECENCY[fresh.label] } : {};
  const timed = timeoutSignal(parentSignal, 7000);
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PERPLEXITY_API_KEY}` },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          { role: 'system', content: 'Answer with current, sourced facts. Be specific: names, numbers, dates. No preamble.' },
          { role: 'user', content: query.slice(0, 400) },
        ],
        max_tokens: 700,
        temperature: 0.1,
        ...recency,
      }),
      // Tighter than its own patience. The fan-out's deadline is 3500ms and
      // this provider is additive — a Sonar that needs longer than the whip
      // simply does not contribute to this turn.
      signal: timed.signal,
    });
    if (!res.ok) return { answer: '', results: [] };
    // Two citation shapes have shipped, and reading only one loses every source
    // silently — see lib/perplexity.js, which is where that is handled and
    // tested.
    return readSonar(await res.json(), normalizeDate);
  } catch { return { answer: '', results: [] }; } finally { timed.dispose(); }
};
const searchGoogleWeb = async (query, fresh = null, parentSignal) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  /* dateRestrict, but NOT sort=date.
   *
   * `sort=date` orders strictly by recency and throws relevance away entirely,
   * which on a slow topic returns whatever SEO page was published most recently
   * rather than the answer. The restriction bounds the age; ranking still
   * decides what is best within it.
   *
   * Google CSE has no dependable published date in its response — pagemap
   * carries one only when the site happened to emit the right metadata — so
   * these results stay undated rather than being labelled from a guess. */
  const restrict = fresh ? `&dateRestrict=${GOOGLE_DATE_RESTRICT[fresh.label] || 'y1'}` : '';
  const timed = timeoutSignal(parentSignal, 8000);
  try { const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0,200))}&num=10${restrict}`, { signal: timed.signal }); if (!res.ok) return []; const data = await res.json(); return (data.items||[]).map(r => ({ title: r.title?.slice(0,200)||'', url: r.link, description: (r.snippet||'').slice(0,500), date: '' })); } catch { return []; } finally { timed.dispose(); }
};
const searchGoogleImages = async (query, parentSignal) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  const timed = timeoutSignal(parentSignal, 8000);
  try { const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0,200))}&searchType=image&num=5`, { signal: timed.signal }); if (!res.ok) return []; const data = await res.json(); return (data.items||[]).map(r => ({ url: r.link, title: r.title?.slice(0,200)||'' })); } catch { return []; } finally { timed.dispose(); }
};
const readPageContent = async (url, { wantsPrice = false, signal } = {}) => {
  // extractPageSignal, not slice(0, 3000). A retail page's markdown spends its
  // first few thousand characters on nav, breadcrumbs and marketing, so a flat
  // truncation cut the price off — which produced a real answer saying three
  // UAE retailers "did not display a price" when all three did. See
  // lib/page-extract.js.
  const timed = timeoutSignal(signal, 6000);
  try { const headers = { 'Accept': 'text/markdown' }; if (JINA_API_KEY) headers['Authorization'] = `Bearer ${JINA_API_KEY}`; const res = await fetch(`https://r.jina.ai/${url}`, { method: 'GET', headers, signal: timed.signal }); if (!res.ok) return firecrawlPage(url, signal); const signalText = extractPageSignal(await res.text());
    /* JINA CANNOT SEE A PRICE THAT JAVASCRIPT PAINTS IN.
     *
     * It fetches the document and converts it; a page that ships an empty
     * product shell and fills it from an XHR — which is every large retailer,
     * Carrefour and Amazon included — converts to navigation and nothing else.
     * That is the ROOT of the "five monitors, no prices" answer: ranking the
     * URLs better only picks a page whose price is still invisible.
     *
     * Firecrawl runs a real browser, so it sees the rendered page. It is second
     * and not first because it is slower and metered where Jina is neither, and
     * the large majority of pages are server-rendered and need none of it. The
     * fallback fires on the two signals that mean "this read failed": nothing
     * came back, or what came back has no price and no stock line on a page
     * that was fetched precisely to find one. */
    if (!hasReadableSignal(signalText, wantsPrice)) { const rendered = await firecrawlPage(url, signal); if (rendered) return rendered; }
    return signalText; } catch { return firecrawlPage(url, signal); } finally { timed.dispose(); }
};

/**
 * Firecrawl: a real browser, used only when the cheap reader came back blind.
 *
 * CACHED, because it is metered and slow — the two properties that make an
 * uncached call a mistake. Rendering the same product page twice in fifteen
 * minutes spends the free-tier allowance to learn a price that has not changed.
 * The cache is the existing two-tier one, so an L2 hit also serves the OTHER
 * instance rather than just this process.
 */
const firecrawlPage = async (url, signal) => {
  if (!FIRECRAWL_API_KEY) return '';
  const key = `firecrawl:${url}`;
  const hit = await getCachedSearch(key, signal);
  // '' is a legitimate cached value — a page that rendered to nothing renders
  // to nothing again — so the check is for null, not for falsiness.
  if (hit !== null && hit !== undefined) return hit;
  const out = await firecrawlFetch(url, signal);
  // Only a real render is worth storing. Caching a timeout would turn one bad
  // minute into fifteen minutes of the same empty answer.
  if (out) setCachedSearch(key, out);
  return out;
};

const firecrawlFetch = async (url, parentSignal) => {
  const timed = timeoutSignal(parentSignal, 12000);
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: false, timeout: 15000 }),
      signal: timed.signal,
    });
    if (!res.ok) return '';
    const data = await res.json();
    const md = data && data.data && typeof data.data.markdown === 'string' ? data.data.markdown : '';
    return md ? extractPageSignal(md) : '';
  } catch { return ''; } finally { timed.dispose(); }
};
const searchWikipedia = async (query, parentSignal) => {
  const timed = timeoutSignal(parentSignal, 6000);
  try { const sr = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query.slice(0,100))}&format=json&origin=*`, { signal: timed.signal }); if (!sr.ok) return ''; const sd = await sr.json(); const titles = (sd.query?.search||[]).slice(0,2).map(s => s.title); if (titles.length === 0) return ''; const er = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`, { signal: timed.signal }); if (!er.ok) return ''; const ed = await er.json(); return Object.values(ed.query?.pages||{}).map(p => p.extract||'').filter(e => e.length > 100).join('\n\n').slice(0, 5000); } catch { return ''; } finally { timed.dispose(); }
};

/**
 * Open the SSE stream, at most once.
 *
 * Idempotent because the agent loop opens the stream BEFORE the answer exists
 * — it has tool progress to report and hiding that behind a spinner for up to
 * 25s would be worse than what the router path does today. Every later branch
 * (fallback, synthesis) then reaches its own open call with headers already
 * sent, and setHeader after send throws ERR_HTTP_HEADERS_SENT.
 */
const openStream = (res) => {
  if (res.headersSent) return;
  // Stamped once, on the first open. Every route that streams calls this, so
  // it is the one place that reliably marks "the user stopped waiting".
  if (!res.locals) res.locals = {};
  res.locals.firstByteAt = Date.now();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Nginx and Render's proxy both buffer by default, which holds every event
  // until the response completes — precisely defeating the point of streaming
  // progress. Without this the trail arrives all at once, at the end.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
};

/** One SSE frame. Never throws: a dead socket must not become a 500. */
const sendEvent = (res, payload) => {
  if (res.writableEnded) return;
  try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* client went away */ }
};

/**
 * What the system is doing right now, in the user's words.
 *
 * The council path used to send NOTHING between the request and the finished
 * synthesis. Seats are polled with `stream: false`, so the first answer token
 * cannot exist until every seat has settled — which is most of the wait, and
 * all of it was silent. A skeleton says "wait"; this says what for.
 *
 * EVERY STAGE HERE IS A REAL EVENT. The text is written from what actually
 * happened — the query that was really searched, the number of seats that have
 * really answered — and not from a rotating list of plausible-sounding
 * activities. A progress indicator that invents its own progress is a spinner
 * that lies, and the first time the "searching" line appears on a turn that ran
 * no search, nothing else this product says about its own work is believable.
 */
const sendStage = (res, key, text) => sendEvent(res, { type: 'stage', key, text });

// ===== COUNCIL TOOL CALLING =====
// docs/superpowers/specs/2026-07-31-council-tool-calling-design.md
const { buildRegistry } = require('./lib/tool-registry');
const { runAgentLoop } = require('./lib/agent-loop');
const { assertSafeUrl } = require('./lib/url-guard');
const { checkLinks } = require('./lib/link-check');
const { extractPageSignal, rankReadTargets, hasReadableSignal } = require('./lib/page-extract');
const { searchShopping, formatShopping, isShoppingQuery } = require('./lib/shopping');
const { searchSerpApi, ENGINE_NAMES, engineMenu } = require('./lib/serpapi');
const SERPER_API_KEY = process.env.SERPER_API_KEY || '';
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || '';
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
/* How many search results get a full page read. Three, because one was not
 * enough to find a price and the reads are concurrent under a shared deadline,
 * so the wall clock is the slowest read either way. Each read is a Jina call,
 * which is the reason this is a number and not "all of them". */
const PAGE_READ_LIMIT = Number(process.env.PAGE_READ_LIMIT) || 3;
const { settleByDeadline } = require('./lib/deadline');
const { todayLine, freshnessWindow, normalizeDate, dateLabel, BRAVE_FRESHNESS, GOOGLE_DATE_RESTRICT } = require('./lib/recency');
const { parseSearchPlan } = require('./lib/search-plan');
const { readSonar } = require('./lib/perplexity');
const { createSearchCache, comprehensiveSearchKey } = require('./lib/search-cache');
const { createTtlCache } = require('./lib/ttl-cache');
const { boundedPage, pageInfo } = require('./lib/pagination');
const { noStoreApi } = require('./lib/http-cache');
const { detectRegion, regionHint } = require('./lib/region');
const { firstWithResults, toolMessages, summariseProbe, UNTRUSTED_PREAMBLE } = require('./lib/council-tools');
const { parseToolRequests } = require('./lib/tool-protocol');
const { prepareUpload, UploadRejected, MAX_FILES_PER_CHAT } = require('./lib/file-intake');

/**
 * A file store bound to ONE (user, chat).
 *
 * The binding is the security property: read_file's signature has nowhere to
 * name a different user or chat, so a model cannot ask for someone else's file
 * — not because the code checks, but because there is no parameter for it.
 *
 * Both queries filter on user_id AND chat_id. The service-role key bypasses
 * RLS, so these predicates are the control that actually runs.
 */
// Validating the shape keeps a malformed value from reaching Postgres and
// coming back as a 500 that reads like a server fault. requireOwnership does
// this for its own :id; these are the params it does not cover.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (name = 'id') => (req, res, next) =>
  UUID_RE.test(req.params[name] || '') ? next() : res.status(400).json({ error: 'Invalid ID' });

const fileStoreFor = (userId, chatId) => ({
  list: async ({ signal } = {}) => {
    const query = supabase.from('chat_files').select('id,name,kind,bytes').eq('user_id', userId).eq('chat_id', chatId).order('created_at', { ascending: true }).limit(MAX_FILES_PER_CHAT);
    const { data } = await withQuerySignal(query, signal);
    return data || [];
  },
  get: async (id, { signal } = {}) => {
    const query = supabase.from('chat_files').select('id,name,kind,bytes,content,truncated').eq('id', id).eq('user_id', userId).eq('chat_id', chatId).maybeSingle();
    const { data } = await withQuerySignal(query, signal);
    return data || null;
  },
});

// Off unless explicitly enabled. The router path is untouched, so a bad turn is
// one env var away from reverted without a deploy.
/**
 * COUNCIL_TOOLS has three settings, not two:
 *
 *   unset / 0   off. The router path, untouched.
 *   shadow      run ONE probe round with the real tool prompt, log what came
 *               back, throw it away, and answer from the plain council. The
 *               user sees no difference at all.
 *   1           live.
 *
 * `shadow` exists because the loop is fully tested against fakes and fakes
 * cannot answer the only question that decides whether this is safe to turn
 * on: do these models, on this gateway, actually emit a parseable ```tool_call
 * block? If they do not, the live loop silently degrades into the router path
 * at three rounds of cost, and nothing in the logs would say so.
 *
 * The probe runs CONCURRENTLY with the real council, so it adds no latency —
 * only tokens. Turn it on for a day, read the [PROBE] lines, then decide.
 */
const TOOLS_MODE = (process.env.COUNCIL_TOOLS || '').toLowerCase();
const TOOLS_ENABLED = TOOLS_MODE === '1' || TOOLS_MODE === 'true';
const TOOLS_SHADOW = TOOLS_MODE === 'shadow';

// Cached because members in the same turn ask overlapping questions across
// ROUNDS as well as within one — dedupe only unions a single round.
/**
 * Fetch just enough of a page to tell whether it is still a page.
 *
 * GET rather than HEAD: a soft 404 answers HEAD with a cheerful 200, and the
 * evidence that it is not a real page is in the <title>. The body is capped at
 * 16KB and the reader is cancelled once <head> is through — enough for the
 * title on every real site, and it never pulls a whole product page.
 */
/* REDIRECTS ARE FOLLOWED BY HAND, BECAUSE `redirect: 'follow'` OUTRAN THE GUARD.
 *
 * Sol's attack review, 2026-08-12. `checkSearchLinks` runs `assertSafeUrl` on
 * the URL a model produced and then called this with `redirect: 'follow'`, so
 * the guard vetted the first hop and undici followed the rest unsupervised. An
 * attacker publishes a page on a perfectly public host, gets it into a search
 * result, and answers the link check with
 *
 *     302 Location: http://169.254.169.254/latest/meta-data/
 *
 * The check said yes to the public host; the fetch went to cloud metadata. Every
 * address `url-guard.js` refuses was reachable in one hop through a host it
 * allows, which makes the guard's whole address list advisory.
 *
 * `manual` plus a re-check on every hop is the fix, and the loop below is the
 * shape it has to have: validate, request, read `Location`, validate again.
 * Resolved against the previous URL because a `Location` may be relative.
 *
 * FOUR HOPS. Enough for the http→https→www→canonical chain that real sites
 * actually serve, and short enough that a redirect loop cannot hold a request
 * open. A blocked hop throws rather than returning a verdict — `checkLinks`
 * already turns a throw from here into UNREACHABLE, which is the honest answer:
 * we could not safely see it.
 *
 * STILL OPEN, AND NOT FIXED HERE: the second half of Sol's finding. Each hop is
 * validated by NAME and then fetched by NAME, so a name that resolves public
 * for the check and private for the connection still wins. `assertSafeUrl`
 * already returns `{ address, family }` for exactly this and every caller
 * discards it. Closing it means connecting to the vetted address while
 * preserving Host and SNI — a custom dispatcher, not a flag — and it is
 * recorded in handoff.md rather than half-done here. */
const REDIRECT_HOPS = 4;

const fetchPageHead = async (url, { signal } = {}) => {
  const timed = timeoutSignal(signal, 5000);
  try {
    let current = url;
    let res;
    for (let hop = 0; ; hop++) {
      // The FIRST hop is re-validated too. checkLinks vets the URL before
      // calling, but this function is exported to other callers and a guard
      // that depends on being called correctly is not a guard.
      await assertSafeUrl(current, { signal: timed.signal });
      res = await fetchOneHop(current, timed.signal);
      const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
      if (!location) break;
      if (hop >= REDIRECT_HOPS) throw new Error(`too many redirects from ${url}`);
      // Cancel the body of the hop we are leaving; nothing reads it, and an
      // unread stream holds the socket until it times out.
      res.body?.cancel().catch(() => {});
      current = new URL(location, current).toString();
    }
    return await readPageHead(res, current);
  } finally {
    timed.dispose();
  }
};

const fetchOneHop = (url, signal) =>
  fetch(url, {
    redirect: 'manual',
    signal,
    // Some CDNs serve a bot-check page to an unfamiliar agent, which would
    // read as a soft 404. Ask like a browser.
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ALOP-AI link check)', 'Accept': 'text/html,*/*' },
  });

/* The body read, unchanged from when it lived inline: 16KB or the end of
 * <head>, whichever comes first. `res.url` is empty on a manual-redirect
 * response, so the caller's last validated URL is the final URL. */
const readPageHead = async (res, finalUrl) => {
  let html = '';
  const type = res.headers.get('content-type') || '';
  if (type.includes('html') && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (html.length < 16384) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
  }
  return { status: res.status, finalUrl: res.url || finalUrl, html };
};

const checkSearchLinks = (urls, { signal } = {}) => checkLinks(urls, { fetchPage: fetchPageHead, assertSafeUrl, signal });

const toolSearch = async (query, { signal } = {}) => {
  const cached = await getCachedSearch(`tool:${query}`, signal);
  if (cached) return cached;
  // The comprehensive path passes (query, freshness, signal); this path has
  // no freshness window, so keep the abort signal in the provider's third slot
  // rather than accidentally treating it as the freshness object.
  const results = await firstWithResults([
    (q, providerSignal) => searchBrave(q, null, providerSignal),
    (q, providerSignal) => searchTavily(q, null, providerSignal),
    (q, providerSignal) => searchGoogleWeb(q, null, providerSignal),
  ], query, signal);
  if (results.length && !signal?.aborted) setCachedSearch(`tool:${query}`, results);
  return results;
};

// ===== COMPREHENSIVE SEARCH =====
const comprehensiveSearch = async (query, needsWiki, fresh = null, region = null, parentSignal) => {
  /* The freshness window is part of the cache KEY, not just the request.
   *
   * Two questions can produce the same search query text and want different
   * windows — "iPhone 17 price" asked plainly, and "iPhone 17 price today".
   * Keying on the text alone would serve the year-wide result set to the
   * question that asked for today, which is the exact staleness this change
   * exists to remove, reintroduced by the cache. */
  /* THE COUNTRY IS PART OF THE KEY.
   *
   * Shopping results are region-scoped — the same query run for AE and US
   * returns different merchants in different currencies. Without the country
   * here, whoever asked first decides what everyone else is told a thing costs,
   * and the failure is invisible because the answer looks fine. */
  const gl = region && region.country ? String(region.country).toLowerCase() : '';
  const cacheKey = `${comprehensiveSearchKey(query, needsWiki)}:${fresh ? fresh.label : 'any'}:${gl || 'nogeo'}`;
  const cached = await getCachedSearch(cacheKey, parentSignal); if (cached) return cached;

  /* THE SEARCH WHIP, and it is the same idea runCouncilWithWhip already uses
   * for models: take what has arrived, do not wait for stragglers.
   *
   * This was one Promise.all over five providers, which made it exactly as slow
   * as the slowest of them — and their own timeouts are 7-8 seconds. Brave
   * answering in 300ms with everything the question needed still cost the user
   * eight seconds if Google was having a bad day.
   *
   * `enough` resolves the moment there are eight web results in hand. Eight is
   * past the six the council is ever shown, so waiting longer buys nothing that
   * reaches the answer.
   *
   * 3.5s is the hard stop. Anything still outstanding is dropped and its
   * provider simply does not contribute to this turn. */
  let tavilyP;

  /* Declared here, above the speculative read, because that read consults it.
   * It resolves in a later microtask so the old ordering happened to work, but
   * a hoisted-const dependency that only works by scheduling luck is a trap. */
  const wantsShopping = !!SERPER_API_KEY && isShoppingQuery(query);

  /* THE FULL-PAGE READ STARTS NOW, not after the fan-out finishes.
   *
   * That read is the last serial leg on the most common path in the app: the
   * fan-out takes up to 3.5s, and only then does a 2.5s page fetch begin, so
   * six seconds could pass before the answering model saw a single token. The
   * two do not depend on each other — the read only needs a URL, and Tavily has
   * one the moment it answers.
   *
   * Speculative, and deliberately only on Tavily. It is first in the precedence
   * order below, so its top result IS the page that gets read in the large
   * majority of turns. When it is not — Tavily timed out, or another provider's
   * result sorted first — `warm` simply does not match and the read happens
   * cold exactly as before. No behaviour changes; the page is either already in
   * flight or it is not.
   *
   * Not awaited anywhere. Awaiting `tavilyP` here would reintroduce the very
   * stall the whip exists to prevent: a Tavily that the 3.5s deadline gave up
   * on would still hold this line until its own 7s timeout. The callback sets a
   * variable and the code below reads it synchronously, so a Tavily that never
   * arrives costs nothing.
   *
   * readPageContent swallows its own failures and resolves to '', so an
   * abandoned warm read cannot become an unhandled rejection. */
  let warm = null;
  let warmSearchFinished = false;
  const startWarmRead = (url) => {
    if (warmSearchFinished || parentSignal?.aborted) return null;
    const warmChild = childAbortController(parentSignal);
    const content = readPageContent(url, { wantsPrice: wantsShopping, signal: warmChild.signal });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      warmChild.dispose();
    };
    const entry = {
      url,
      content,
      cancel: () => {
        if (!warmChild.signal.aborted) warmChild.controller.abort("search-page-deadline");
        release();
      },
    };
    // A warm read can finish before the fan-out reaches its page-read phase.
    // Release the parent listener then; otherwise a successful speculative read
    // keeps a child controller attached to the request until the response closes.
    void content.then(release, release);
    warm = entry;
    return entry;
  };

  const startTavily = (fanoutSignal) => {
    tavilyP = searchTavily(query, fresh, fanoutSignal);
    tavilyP.then((t) => {
    const url = t?.results?.[0]?.url;
    if (url) startWarmRead(url);
  }).catch(() => {});
    return tavilyP;
  };

  const { results: [tavilyResult, braveResults, googleResults, googleImages, wikiContent, pplxResult, shopResult], waited, pending } =
    await settleByDeadline(
      [
        { promise: startTavily, fallback: { answer: '', results: [], images: [] } },
        { promise: (fanoutSignal) => searchBrave(query, fresh, fanoutSignal), fallback: [] },
        { promise: (fanoutSignal) => searchGoogleWeb(query, fresh, fanoutSignal), fallback: [] },
        { promise: (fanoutSignal) => searchGoogleImages(query, fanoutSignal), fallback: [] },
        { promise: (fanoutSignal) => needsWiki ? searchWikipedia(query, fanoutSignal) : Promise.resolve(''), fallback: '' },
        // Last, and additive. It is appended to the array rather than inserted
        // so the destructuring above and `enough` below both keep their
        // positions — a provider added in the middle silently reassigns every
        // result after it.
        { promise: (fanoutSignal) => searchPerplexity(query, fresh, fanoutSignal), fallback: { answer: '', results: [] } },
        /* Shopping, and only when the question is about buying something.
         * Serper bills per query, and "who won the election" does not need a
         * price check. isShoppingQuery is the gate; see lib/shopping.js. */
        {
          promise: (fanoutSignal) => SERPER_API_KEY && isShoppingQuery(query)
            ? searchShopping(query, { apiKey: SERPER_API_KEY, region: gl, signal: fanoutSignal })
            : Promise.resolve({ results: [] }),
          fallback: { results: [] },
        },
      ],
      {
        deadlineMs: 3500,
        signal: parentSignal,
        // TWO conditions, and the second is the one that took a measurement to
        // find. Volume alone let Brave's ten results resolve the whole fan-out
        // at 400ms and throw away Tavily's synthesised ANSWER, which landed at
        // 600ms and is the single most useful thing any provider returns.
        // Saving 200ms by discarding the best source is not a speed win.
        //
        // Requiring two providers is also what makes the results diverse, which
        // is the reason for having five of them at all.
        enough: (results) => {
          const [tav, brave, google] = results;
          const counts = [tav && tav.results ? tav.results.length : 0, brave?.length || 0, google?.length || 0];
          const reporting = counts.filter((n) => n > 0).length;
          /* Volume from the web providers must NOT cut off a shopping lookup
           * that is still running. On a price question the eight links are the
           * part that already failed the user — the listing carrying an actual
           * number is the whole reason the query was asked. Waiting for it is
           * bounded by the same 3.5s deadline as everything else. */
          if (wantsShopping && !(results[6] && results[6].results && results[6].results.length)) return false;
          return reporting >= 2 && counts.reduce((a, b) => a + b, 0) >= 8;
        },
      },
    );
  if (pending > 0) console.log(`[SEARCH] answered in ${waited}ms with ${pending} provider(s) still outstanding`);
  const td = Array.isArray(tavilyResult) ? { answer:'',results:[],images:[] } : tavilyResult;
  const sources = [], allImages = []; let ctx = '';
  /* EVERY SOURCE CARRIES ITS DATE INTO THE PROMPT.
   *
   * The snippets used to arrive as Title/URL/Content with nothing to say when
   * any of it was written, so "the latest version is X" from a 2024 page and
   * the same sentence from last week were indistinguishable to the model, and
   * it had no way to prefer one — or to tell the user which it used. Undated
   * sources say "unknown" in words rather than being left blank; see dateLabel
   * for why silence is the worse of the two. */
  if (td.answer) ctx += `TAVILY ANSWER: ${td.answer}\n\n---\n\n`;
  if (td.results?.length > 0) { ctx += `TAVILY RESULTS:\n${td.results.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\n${dateLabel(r.date)}\nContent: ${r.content}`).join('\n\n---\n\n')}\n\n---\n\n`; td.results.forEach(r => sources.push({title:r.title,url:r.url,date:r.date||''})); }
  if (td.images?.length > 0) allImages.push(...td.images.filter(u => u && u.startsWith('http')));
  if (braveResults.length > 0) { ctx += `BRAVE:\n${braveResults.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\n${dateLabel(r.date)}\nContent: ${r.description}`).join('\n\n---\n\n')}\n\n---\n\n`; braveResults.forEach(r => { if (!sources.find(s => s.url === r.url)) sources.push({title:r.title,url:r.url,date:r.date||''}); }); }
  if (googleResults.length > 0) { ctx += `GOOGLE:\n${googleResults.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\n${dateLabel(r.date)}\nContent: ${r.description}`).join('\n\n---\n\n')}\n\n---\n\n`; googleResults.forEach(r => { if (!sources.find(s => s.url === r.url)) sources.push({title:r.title,url:r.url,date:r.date||''}); }); }
  if (googleImages.length > 0) allImages.push(...googleImages.map(img => img.url).filter(u => u && u.startsWith('http')));
  if (wikiContent) ctx += `WIKIPEDIA:\n${wikiContent}\n\n---\n\n`;
  /* Perplexity last in the context, and that is on purpose: it is the one
   * source that is itself a model's writing rather than a page, so the council
   * should meet the primary sources first and read this as a summary of them.
   * Its citations join `sources` so the answer can be traced, deduplicated
   * against what the other providers already returned. */
  const pplx = pplxResult && !Array.isArray(pplxResult) ? pplxResult : { answer: '', results: [] };
  if (pplx.answer) {
    ctx += `PERPLEXITY (a search model's own written answer, with its citations below):\n${pplx.answer}\n\n---\n\n`;
    if (pplx.results.length) {
      ctx += `PERPLEXITY SOURCES:\n${pplx.results.map((r, i) => `SOURCE ${i + 1}:\nTitle: ${r.title || '(untitled)'}\nURL: ${r.url}\n${dateLabel(r.date)}`).join('\n\n')}\n\n---\n\n`;
      pplx.results.forEach((r) => { if (r.url && !sources.find((s) => s.url === r.url)) sources.push({ title: r.title || r.url, url: r.url, date: r.date || '' }); });
    }
  }
  // The deep read, on a leash. It used to be an unbounded await after the
  // fan-out had already finished — so a slow page added its own six seconds on
  // top of the search, in series, for a nice-to-have.
  //
  // It is no longer serial in the common case: the read is started speculatively
  // on Tavily's top result as soon as Tavily answers, so by the time control
  // reaches here it has usually been in flight for the whole fan-out and the
  // remaining wait is what is left of the 2.5s rather than all of it. `warm`
  // only counts when it is the SAME page this block was going to read anyway —
  // otherwise the read happens cold, exactly as it did before.
  /* SHOPPING GOES IN BEFORE THE PAGE READS, and that ordering is the point.
   *
   * Its listings are merchant PRODUCT pages — precisely the URLs the reader
   * wants and the ones a web search buries under category pages. Pushing them
   * into `sources` here puts them in front of rankReadTargets below, so the
   * deep read lands on a page that states a price in its markup instead of one
   * that paints it in with JavaScript. Placed after the other providers so it
   * never displaces their results as the cited leaders, only joins them. */
  const shop = shopResult && Array.isArray(shopResult.results) ? shopResult.results : [];
  if (shop.length) {
    ctx += `${formatShopping(shop, { asOf: new Date().toISOString().slice(0, 10) })}\n\n---\n\n`;
    shop.forEach((r) => { if (r.url && !sources.find((s) => s.url === r.url)) sources.push({ title: r.title || r.source || r.url, url: r.url, date: '' }); });
  }
  //
  // THREE pages, not one, and not necessarily the top one. `sources[0]` on a
  // shopping question is a category listing whose prices are painted in by
  // JavaScript, so the read returned nav and the answer said no price was
  // shown. rankReadTargets prefers product-shaped URLs and falls back to
  // provider order when nothing scores — see lib/page-extract.js. The reads run
  // concurrently under ONE deadline, so three cost the wall clock of the
  // slowest, not the sum.
  if (sources.length > 0) {
    const targets = rankReadTargets(sources, { limit: PAGE_READ_LIMIT });
    const warmMatches = warm && targets.includes(warm.url);
    if (warm && !warmMatches) {
      warm.cancel();
      warm = null;
    }
    const reads = targets.map((url) => ({
      url,
      promise: warm && warm.url === url
        ? warm.content
        : (readSignal) => readPageContent(url, { wantsPrice: wantsShopping, signal: readSignal }),
      cancel: warm && warm.url === url ? warm.cancel : undefined,
    }));
    const { results } = await settleByDeadline(
      reads.map((r) => ({ promise: r.promise, fallback: '', cancel: r.cancel })),
      { deadlineMs: 2500, signal: parentSignal },
    );
    results.forEach((pc, i) => {
      if (typeof pc === 'string' && pc.length > 200) ctx += `FULL PAGE (${reads[i].url}):\n${pc}\n\n---\n\n`;
    });
  } else if (warm) {
    warm.cancel();
    warm = null;
  }
  if (allImages.length > 0) { const unique = [...new Set(allImages)].slice(0,5); ctx += `IMAGES:\n${unique.map((u,i) => `IMAGE ${i+1}: ${u}`).join('\n')}\n\n---\n\n`; }
  const found = sources.length > 0 || !!wikiContent || !!td.answer || !!pplx.answer;
  // Prepended once, here, rather than at each of the six `ctx +=` sites above:
  // every one of them is a third party's text, and this is the single point
  // they all pass through on the way out.
  const context = ctx.trim() ? `${UNTRUSTED_PREAMBLE}\n\n${ctx.trim()}` : '';
  const result = { context, sources, found, images: allImages };
  warmSearchFinished = true;
  if (!parentSignal?.aborted) setCachedSearch(cacheKey, result); return result;
};

// ===== MEMORY =====
// Scoped to one chat. This used to live on the users table, so a single summary
// was shared by every conversation a user had and context leaked between
// unrelated chats. Requires migrations/001_per_chat_memory.sql; if that has not
// been run the select fails, the catch logs it, and the app simply runs without
// memory rather than erroring.
const updateChatSummary = async (chatId, userId, userMsg, assistantMsg) => {
  if (!chatId || !userId) return;
  try {
    // BOTH queries are scoped by user_id, and that is the whole point of this
    // function's signature having changed.
    //
    // `chatId` arrives in the request body. Neither of these queries filtered on
    // the owner, while readChatSummary immediately below always has — so a
    // caller could pass ANY chat's id and this would read that conversation's
    // summary, feed it to the summarising model as `Previous:`, and write the
    // result back over it. The service-role key bypasses RLS, so migration 002
    // was never going to catch this: the row-level policies are not consulted
    // for this client at all.
    //
    // The write was the serious half. It let one account overwrite another
    // account's conversation memory with text of its choosing, which then
    // shapes every later answer in that chat — the victim's assistant quietly
    // conditioned on a stranger's input, with nothing visible to either of them.
    const { data: existing, error: selErr } = await supabase.from('chats').select('conversation_summary').eq('id', chatId).eq('user_id', userId).single();
    // PGRST116 means no row: either the chat does not exist or it is not this
    // caller's. Both are "there is nowhere to write", so bail before spending a
    // model call. Anything else (typically the column not existing because
    // 001_per_chat_memory.sql has not been run) is the same conclusion.
    if (selErr) {
      if (selErr.code !== 'PGRST116') console.error('[MEMORY] Unavailable, skipping:', selErr.message);
      return;
    }
    const prev = existing?.conversation_summary || '';
    const u = userMsg.slice(0, 800); const a = assistantMsg.slice(0, 800);
    const newSummary = prev
      ? await callModel(FAST_MODEL, [{ role: 'system', content: 'Compress previous summary and new exchange into 2-3 sentences. Reply ONLY with the summary.' }, { role: 'user', content: `Previous:\n${prev}\n\nNew:\nUser: ${u}\nAssistant: ${a}` }], 0.0, 4000, 200)
      : await callModel(FAST_MODEL, [{ role: 'system', content: 'Summarize in 1-2 sentences. Reply ONLY with the summary.' }, { role: 'user', content: `User: ${u}\nAssistant: ${a}` }], 0.0, 4000, 150);
    if (newSummary.trim()) {
      // supabase-js resolves rather than throws on failure, so an unchecked update
      // logged "Saved." even when nothing was written.
      const { error: updErr } = await supabase.from('chats').update({ conversation_summary: newSummary.trim().slice(0, 2000) }).eq('id', chatId).eq('user_id', userId);
      if (updErr) console.error('[MEMORY] Save failed:', updErr.message);
      else console.log('[MEMORY] Saved.');
    }
  } catch (e) { console.error('[MEMORY] Failed:', e.message); }
};

const withQuerySignal = (query, signal) => signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query;

const readChatSummary = async (chatId, userId, signal) => {
  if (!chatId) return '';
  try {
    const query = supabase.from('chats').select('conversation_summary').eq('id', chatId).eq('user_id', userId);
    const { data } = await withQuerySignal(query, signal).single();
    return data?.conversation_summary || '';
  } catch { return ''; }
};

// Feedback lives in its own table and is read back as explicit guidance. It was
// previously appended onto conversation_summary, where coaching notes and
// conversation facts fought over the same 2000 characters and corrupted both.
const getFeedbackGuidance = async (userId, signal) => {
  try {
    const query = supabase.from('feedback_notes').select('kind,note').eq('user_id', userId).order('created_at', { ascending: false }).limit(6);
    const { data } = await withQuerySignal(query, signal);
    if (!data || data.length === 0) return '';
    const good = data.filter(n => n.kind === 'up').map(n => `- ${n.note}`);
    const avoid = data.filter(n => n.kind === 'down').map(n => `- ${n.note}`);
    let out = '';
    if (good.length) out += `This user has responded well to:\n${good.join('\n')}\n`;
    if (avoid.length) out += `This user has reacted badly to:\n${avoid.join('\n')}`;
    return out.trim();
  } catch { return ''; }
};

/* CROSS-CHAT MEMORY. `conversation_summary` above remembers one conversation
 * on purpose; these are the few statements that should outlive it.
 *
 * EXTRACTED FROM THE USER'S MESSAGE ONLY. Not from the answer, and the reason
 * is not tidiness — see the header of lib/user-facts.js. An answer routinely
 * carries text this server fetched from the open web, and a fact drawn from
 * that would be replayed at system position in every conversation this user
 * ever has again. That is a prompt injection with a storage layer.
 *
 * Runs after the user has been answered, like updateChatSummary, so its cost
 * is never on the path the user waits on.
 */
const { FACTS_PROMPT, parseFacts, newFacts, factsBlock, factKey } = require('./lib/user-facts');
const { EMBED_MODEL, embedRequestBody, parseEmbedding, toVectorLiteral } = require('./lib/embeddings');
/* Enough to condition an answer, small enough that it cannot crowd out the
 * conversation itself. See docs/MEMORY-AND-CACHE-PLAN.md Phase 2 — this is no
 * longer "newest first"; it is what this turn is ABOUT first, then newest. */
const FACTS_INJECT_LIMIT = 20;
/* The dedupe read. A user with more facts than this gets duplicates rather than
 * a slow write, which is the right way round. */
const FACTS_DEDUPE_LIMIT = 200;
/* The read path is the one the user waits on, and the embedding call is a
 * network round trip in the middle of it. Past this, the turn goes out with
 * recency-ranked memory rather than late relevance-ranked memory — the same
 * trade `settleByDeadline` exists for on the search fan-out. Nothing on the
 * WRITE path has a deadline; it runs after the user has been answered. */
const EMBED_DEADLINE_MS = 600;

/**
 * One string to one vector, or null.
 *
 * Never throws and never rethrows. Every caller's fallback is "this fact has no
 * vector" or "this turn ranks by recency", both of which are working states.
 * See lib/embeddings.js for why a *malformed* vector has to read as null too.
 */
const embedText = async (text, parentSignal) => {
  if (!GOOGLE_API_KEY || !text) return null;
  const timed = timeoutSignal(parentSignal, 10000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GOOGLE_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(embedRequestBody(text)),
      signal: timed.signal,
    });
    if (!res.ok) { console.error(`[EMBED] ${res.status} ${(await res.text()).slice(0, 200)}`); return null; }
    return parseEmbedding(await res.json());
  } catch (e) { if (!timed.signal.aborted) console.error('[EMBED] Failed:', e.message); return null; }
  finally { timed.dispose(); }
};

/** This user's facts, nearest first, by cosine distance. [] on any failure. */
const readUserFactsByMeaning = async (userId, limit, queryText, parentSignal) => {
  const { results: [vec] } = await settleByDeadline(
    [{ promise: (signal) => embedText(queryText, signal), fallback: null }],
    { deadlineMs: EMBED_DEADLINE_MS, signal: parentSignal },
  );
  const literal = toVectorLiteral(vec);
  if (!literal) return [];
  try {
    // p_user_id is the server's own resolved user. The service-role connection
    // bypasses RLS, so this argument IS the tenant boundary — 013 says the same
    // thing at the SQL layer and tenant-scope.test.js holds it here.
    let query = supabase.rpc('match_user_facts', {
      p_user_id: userId,
      p_query: literal,
      p_limit: limit,
    });
    const { data, error } = await withQuerySignal(query, parentSignal);
    if (error) { console.error('[FACTS] Semantic recall unavailable:', error.message); return []; }
    return (data || []).map((r) => r.fact).filter(Boolean);
  } catch (e) { console.error('[FACTS] Semantic recall failed:', e.message); return []; }
};

/**
 * @param {string} userId
 * @param {number} limit
 * @param {string|null} queryText the current user turn. Given one, facts are
 *   ranked by what this turn is about; without one, by recency.
 *
 * BOTH READS RUN, and the reason is a hole that only appears in the mixed case.
 * A row written while GOOGLE_API_KEY was unset, or while the endpoint was
 * refusing, has a null embedding and is invisible to `match_user_facts`
 * forever. Returning semantic results alone would silently drop those facts for
 * every user who has any — not degrade them, drop them. So the nearest facts go
 * first and the newest fill whatever slots are left, deduplicated on the same
 * key the write path dedupes on.
 */
const readUserFacts = async (userId, limit = FACTS_INJECT_LIMIT, queryText = null, parentSignal) => {
  if (!userId) return [];

  const [semantic, recent] = await Promise.all([
    queryText ? readUserFactsByMeaning(userId, limit, queryText, parentSignal) : Promise.resolve([]),
    (async () => {
      try {
        let query = supabase
          .from('user_facts')
          .select('fact')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit);
        const { data, error } = await withQuerySignal(query, parentSignal);
        // The table predates migrations/, so a missing column or table is a
        // live possibility. Memory being unavailable must cost the user nothing
        // but the memory.
        if (error) { console.error('[FACTS] Unavailable, skipping:', error.message); return []; }
        return (data || []).map((r) => r.fact).filter(Boolean);
      } catch (e) { console.error('[FACTS] Read failed:', e.message); return []; }
    })(),
  ]);

  const seen = new Set();
  const out = [];
  for (const fact of [...semantic, ...recent]) {
    const k = factKey(fact);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(fact);
    if (out.length >= limit) break;
  }
  return out;
};

const updateUserFacts = async (userId, userMsg) => {
  if (!userId || !userMsg) return;
  try {
    const raw = await callModel(
      FAST_MODEL,
      [{ role: 'system', content: FACTS_PROMPT }, { role: 'user', content: String(userMsg).slice(0, 1200) }],
      0.0, 4000, 200,
    );
    const candidates = parseFacts(raw);
    if (!candidates.length) return;

    const existing = await readUserFacts(userId, FACTS_DEDUPE_LIMIT);
    const fresh = newFacts(candidates, existing);
    if (!fresh.length) return;

    // Embed on write, so the read path never pays for a backfill. At most
    // MAX_FACTS_PER_TURN of these, off the response path, and a null is a fact
    // stored without semantic recall rather than a fact not stored.
    const vectors = await Promise.all(fresh.map((fact) => embedText(fact)));

    // user_id comes from the server's own resolved user, never from the body.
    const { error } = await supabase
      .from('user_facts')
      .insert(fresh.map((fact, i) => ({
        user_id: userId,
        fact,
        category: 'profile',
        embedding: toVectorLiteral(vectors[i]),
      })));
    // supabase-js resolves rather than throws, so an unchecked insert would log
    // a save that never happened — the same trap updateChatSummary documents.
    if (error) console.error('[FACTS] Save failed:', error.message);
    else console.log(`[FACTS] Stored ${fresh.length}.`);
  } catch (e) { console.error('[FACTS] Failed:', e.message); }
};

/* One funnel for everything learned from a settled turn, so a new memory does
 * not have to be threaded through six terminal paths and miss one. */
const rememberTurn = (chatId, userId, userMsg, assistantMsg) => {
  updateChatSummary(chatId, userId, userMsg, assistantMsg).catch(() => {});
  updateUserFacts(userId, userMsg).catch(() => {});
};

// ===== MIDDLEWARE =====
// The allowlist is host-parsed, not substring-matched — see lib/origin-guard.js
// for the two ways the previous `origin.includes('.vercel.app')` was wrong.
// Preview deployments need ALLOWED_ORIGIN_SUFFIXES set; an unset variable
// deliberately grants nothing.
const { isOriginAllowed, originPolicyFromEnv } = require('./lib/origin-guard');
const originPolicy = originPolicyFromEnv();
if (!originPolicy.exact.length && !originPolicy.allowAll) console.warn('[BOOT] FRONTEND_URL not set — every cross-origin browser request will be refused.');
app.use(cors({ origin: (origin, cb) => isOriginAllowed(origin, originPolicy) ? cb(null, true) : cb(new Error(`CORS: ${origin}`)), credentials: true, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Requested-With'], maxAge: 86400 }));
// The options moved to lib/security-headers.js so a test can mount them and
// read the headers off a real response. Two of them were wrong here, and
// `xFrameOptions: 'DENY'` was wrong SILENTLY — helmet ignored the string and
// served its SAMEORIGIN default while this line read as DENY. See that file.
const { helmetOptions } = require('./lib/security-headers');
app.use(helmet(helmetOptions));
// clientFingerprint used to be computed here and used as the rate-limit key.
// It hashed the User-Agent, so it was not an identity — it was a bucket the
// caller could change at will. Nothing derives from a client-chosen header now.
app.use((req, res, next) => { req.requestId = crypto.randomUUID(); next(); });

// There is no public cacheable API response today. Authenticated GETs carry
// user data, and a response without an explicit Cache-Control policy can be
// retained by a shared intermediary under heuristic rules. Mount this before
// the webhook and every other API handler so a new route inherits the safety
// policy automatically; a handler that forgets a header cannot turn a proxy
// into a cross-account read cache.
app.use('/api', noStoreApi);

app.post('/api/stripe/webhook', requireStripe, express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']; if (!sig) return res.status(400).send('Missing sig');
  let event; try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { Sentry.captureException(err); return res.status(400).send(`Webhook: ${err.message}`); }

  // Stripe retries on any non-2xx and can deliver the same event more than
  // once even on success — at-least-once, by design. Every handler below was
  // replay-safe by luck rather than by construction (they all set a field to a
  // fixed value), and "the current handlers happen to be idempotent" is not a
  // property that survives someone adding a credit grant. Claim the event id
  // first; a duplicate insert means we have already processed it.
  //
  // Failing OPEN on an insert error is deliberate: if the ledger is unreachable
  // the worse outcome is re-applying a plan change, not silently dropping a
  // paid subscription.
  try {
    const { error: dupe } = await supabase.from('stripe_events').insert({ id: event.id, type: event.type });
    if (dupe && dupe.code === '23505') return res.json({ received: true, duplicate: true });
    if (dupe) console.error('[stripe] event ledger unavailable, processing anyway:', dupe.message);
  } catch (e) { console.error('[stripe] event ledger threw, processing anyway:', e.message); }

  try { if (event.type === 'checkout.session.completed') { const s = event.data.object; const email = s.customer_email || s.customer_details?.email; if (email) await supabase.from('users').update({ plan:'pro', stripe_customer_id: s.customer, stripe_subscription_id: s.subscription }).eq('email', email.toLowerCase()); } if (event.type === 'invoice.paid') await supabase.from('users').update({ plan:'pro' }).eq('stripe_customer_id', event.data.object.customer); if (['customer.subscription.deleted','customer.subscription.updated'].includes(event.type)) { const sub = event.data.object; await supabase.from('users').update({ plan: sub.status === 'active' ? 'pro' : 'free' }).eq('stripe_subscription_id', sub.id); } invalidateUserRows(); res.json({ received: true }); } catch (err) { Sentry.captureException(err); res.status(500).send('Webhook failed'); }
});

app.use(compression());
app.use(timeout('300s'));
app.use((req, res, next) => { if (req.timedout) return res.status(503).json({ error: 'Timeout' }); next(); });

// The key must not contain anything the caller chooses. It used to hash the
// User-Agent in, which handed every caller unlimited buckets — see
// lib/rate-limit-key.js. `ipKeyGenerator` is express-rate-limit's own, and is
// IPv6-aware: it collapses an address to its /56 so one client cannot walk its
// own prefix.
const { rateLimitKey } = require('./lib/rate-limit-key');
/**
 * The counter's home.
 *
 * Memory by default, which is correct on ONE instance and measurably wrong on
 * two: the default store is per-process, so "120 per minute" becomes 240 the
 * moment the service scales. Scaling on Render is a dropdown — no deploy, no
 * review, nothing that would flag it.
 *
 * Postgres is therefore built, tested and dormant. It costs a database round
 * trip per request, which one instance should not pay, so it is opt-in via
 * RATE_LIMIT_STORE=postgres. BEFORE SCALING TO MORE THAN ONE INSTANCE, set it
 * — migrations/004 creates the table and the atomic increment.
 */
const USE_PG_RATE_LIMIT = process.env.RATE_LIMIT_STORE === 'postgres';
const { PostgresStore } = require('./lib/pg-rate-limit-store');

const createLimiter = (windowMs, max, msg) => rateLimit({
  windowMs, max, message: { error: msg }, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => rateLimitKey(req, res, rateLimit.ipKeyGenerator),
  handler: (req, res) => { res.status(429).json({ error: msg }); },
  // A store instance per limiter, because each carries its own window.
  // The arrow defers dereferencing `supabase`, which is declared BELOW this
  // point — the limiters are registered before the client exists. It is only
  // called at request time, by which point the const is initialised. Passing
  // `supabase.rpc` directly here would throw at boot.
  ...(USE_PG_RATE_LIMIT ? { store: new PostgresStore({ rpc: (fn, args) => supabase.rpc(fn, args) }) } : {}),
});

/* CLERK IS MOUNTED HERE, ABOVE THE LIMITERS, AND THE ORDER IS THE POINT.
 *
 * `rateLimitKey` prefers `u:<userId>` and falls back to the IP, and its own
 * comment says the quiet part: "Only routes that run their auth middleware
 * before the limiter will have it." NONE DID. clerkMiddleware was mounted
 * ~100 lines below this, so `req.auth` was always absent at limiter time and
 * every limit in this file was an IP limit wearing a user limit's clothes.
 *
 * Sol found it by reading the mount order rather than the function, 2026-08-12.
 * The consequence is economic and it is the one that matters on this product: a
 * council turn is seven paid model calls plus search plus a possible fallback
 * whip, so one valid account rotating source addresses collected a fresh
 * 30-per-minute allowance per address, and the owner collected the bill.
 *
 * Moving the mount up is the whole fix — nothing else changes, because
 * `rateLimitKey` was already written for this and has been waiting for it.
 * `u:<userId>` survives an IP change and cannot be forged, because Clerk
 * verified it.
 *
 * SAFE ABOVE THE LIMITERS, checked rather than assumed:
 *   - The Stripe webhook is mounted EARLIER still and stays outside both. It
 *     needs its raw body and a signature check, not a session.
 *   - clerkMiddleware only reads and verifies a token. It does not reject
 *     anonymous requests — `requireAuth` does that, further down, per route —
 *     so an unauthenticated caller still reaches the limiter and is still
 *     limited by IP. The floor did not move; a ceiling was added above it.
 *   - It remains conditional on CLERK_PUBLISHABLE_KEY for the reason given at
 *     its old site: unguarded, one missing variable turns into a 500 on every
 *     route including /health, and a misconfigured deploy then looks dead.
 *
 * WHAT THIS DOES NOT DO: there is still no per-user SPEND ceiling, only a
 * request rate. A user within 30/minute can still run the bill up, just not by
 * multiplying themselves across addresses. That is a product decision about
 * budgets and it is in handoff.md, not smuggled in here. */
if (process.env.CLERK_PUBLISHABLE_KEY) {
  app.use(clerkMiddleware(
    originPolicy.exact.length ? { authorizedParties: originPolicy.exact } : {},
  ));
}
console.log(
  originPolicy.exact.length
    ? `[BOOT] Clerk authorizedParties enforced: ${originPolicy.exact.join(', ')}`
    : '[BOOT] Clerk authorizedParties NOT enforced — FRONTEND_URL/ALLOWED_ORIGINS are empty, so a token minted for another origin would be accepted.',
);

// Every route is under a limit. The blanket /api/ limiter is the floor, and a
// route with its own limiter is subject to BOTH — the narrower one binds first.
// A route with no entry here is not unlimited, it inherits the floor; the
// entries below exist where the floor is too generous for what the call costs.
app.use('/api/', createLimiter(60000, 120, 'Too many requests.'));
app.use('/api/council', createLimiter(60000, 30, 'Too many council requests.'));
app.use('/api/overlay', createLimiter(60000, 30, 'Too many overlay requests.'));
app.use('/api/feedback', createLimiter(60000, 30, 'Too many feedback requests.'));
// One model call each. Generous, because the client fires exactly one per new
// conversation and a user who hits 30 in a minute is not typing them.
app.use('/api/chat-title', createLimiter(60000, 30, 'Too many title requests.'));
// Tighter than the rest, because this is the only route where a single request
// bills a third party per character. Nobody listens to twenty answers a minute.
app.use('/api/speech', createLimiter(60000, 20, 'Too many speech requests.'));
app.use('/api/create-checkout-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/create-portal-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/admin/', createLimiter(60000, 60, 'Too many admin requests.'));
// Previously covered only by the /api/ floor. Chat writes hit the database on
// every call and the plan/price reads hit Clerk and Stripe, so 120/min each is
// more headroom than any real client uses.
app.use('/api/chats', createLimiter(60000, 60, 'Too many chat requests.'));
app.use('/api/user/', createLimiter(60000, 60, 'Too many requests.'));
app.use('/api/billing/', createLimiter(60000, 30, 'Too many billing requests.'));
// /health is outside /api/ and so had no limit at all. It is cheap, but an
// unlimited endpoint is still an unlimited endpoint.
app.use('/health', createLimiter(60000, 120, 'Too many requests.'));

// The 50 MB ceiling exists for image data URLs, and applied to EVERY route —
// so any endpoint could be made to buffer 50 MB per request. It now applies
// only where an image can legitimately arrive; everything else gets 1 MB.
// (The Stripe webhook is mounted above this with express.raw and is unaffected.)
//
// `/api/vision` and `/api/image` were on this list and have no handler. Body
// parsing runs before routing, so a POST to either buffered 50 MB and then
// 404'd — the ceiling was granted to a door that was not there. Their rate
// limiters, and `/api/quick`'s, are gone with them. Nothing in the frontend
// called any of the three.
const IMAGE_ROUTES = ['/api/council', '/api/overlay'];
const bigJson = express.json({ limit: '50mb' });
const smallJson = express.json({ limit: '1mb' });
app.use((req, res, next) => (IMAGE_ROUTES.some((p) => req.path.startsWith(p)) ? bigJson : smallJson)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ===== SANITIZATION =====
const MAX_PROMPT = 100000;
const { buildChatUpdate, mergeMessages, sanitizeString } = require('./lib/chat-update');
const { parseDataUrl } = require('./lib/data-url');
// History is INPUT, not state. Both routes that take it now go through one
// function — /api/overlay previously spread client objects straight into the
// message array, so a caller could supply `role: "system"` and override the
// server's own prompt. See lib/history.js for the three things that fixed.
const { sanitizeHistory } = require('./lib/history');
const { TITLE_PROMPT, sanitizeTitle } = require('./lib/chat-title');
const { synthesize, boundText } = require('./lib/tts');
const truncatePrompt = (text, maxChars = 90000) => { if (text.length <= maxChars) return text; const h = Math.floor(maxChars/2); return text.slice(0,h) + '\n\n[...truncated...]\n\n' + text.slice(-h); };
const validatePrompt = (p) => { if (!p || typeof p !== 'string') return { valid: false, error: 'Prompt required' }; const t = p.trim(); if (!t) return { valid: false, error: 'Prompt empty' }; if (t.length > MAX_PROMPT) return { valid: false, error: `Exceeds ${MAX_PROMPT}` }; return { valid: true, value: t }; };

// ===== SUPABASE & CLERK =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// ===== CACHES =====
/* Was a 50-entry Map in this process. Render redeploys on every push and a
 * redeploy is a new process, so it was almost always empty — the person who
 * arrived after a deploy paid the full fan-out for a question answered ten
 * minutes earlier. The Map is still the first tier; Postgres is the tier that
 * survives. See lib/search-cache.js for why it can never throw. */
const searchCache = createSearchCache({
  supabase,
  ttlMs: Number(process.env.SEARCH_CACHE_TTL_MS) || 15 * 60 * 1000,
});
const getCachedSearch = (q, signal) => searchCache.get(q, { signal });
const setCachedSearch = (q, d) => searchCache.set(q, d);
// Rejected requests must carry a 401, not a 500, or the client cannot tell an expired
// session from a server fault. clerk-sdk-node@5 made that our problem by ignoring its
// own `onError` option and calling next() with a bare, status-less Error. @clerk/express
// does not have that bug, but the requireAuth below still sets the status explicitly
// rather than inheriting whatever the library decides — the distinction is ours to keep.
/* `authorizedParties` — the check Clerk's verifier does NOT do by default.
 *
 * A Clerk session token carries an `azp` claim naming the origin it was minted
 * for. Without this option the signature and expiry are verified and `azp` is
 * ignored, so a token this instance issued to a page on some other origin is
 * accepted here. Clerk documents setting it as the defence against that.
 *
 * The list is `originPolicy.exact` rather than a new variable, because it is
 * the same question CORS already answers: which origins is this API's frontend
 * served from. Two lists would drift, and the drift would look like a login
 * bug rather than a config mismatch.
 *
 * CONSEQUENCE, and it is not subtle: origins covered only by a SUFFIX rule
 * (`ALLOWED_ORIGIN_SUFFIXES`, i.e. Vercel preview deploys) pass CORS and now
 * FAIL auth, because `azp` is an exact string and a suffix cannot be enumerated
 * into one. A preview deploy that must sign in has to be named in
 * `ALLOWED_ORIGINS`.
 *
 * An EMPTY list disables the check rather than refusing everything. That is
 * deliberate: it is exactly the state a fresh deployment is in before
 * FRONTEND_URL is set, and locking every user out of a working app to enforce
 * a hardening measure is the wrong trade. The boot log says which state it is
 * in, out loud, rather than leaving it to be discovered. */
/* Mounted CONDITIONALLY, and that condition is the whole point.
 *
 * @clerk/express's clerkMiddleware throws "Publishable key is missing" when
 * CLERK_PUBLISHABLE_KEY is unset. Mounted globally and unguarded, that turns one
 * missing environment variable into a 500 on EVERY route — `/health` included,
 * which needs no authentication and is what a platform polls to decide whether the
 * service is alive. A misconfigured deploy would then look like a dead one.
 *
 * clerk-sdk-node failed narrower: only authenticated routes broke. Keeping that
 * blast radius is deliberate, so the middleware goes on only when it can work, and
 * requireAuth below answers for the misconfiguration instead. */
/* THE MOUNT AND ITS BOOT LOG MOVED UP, above the rate limiters — see the long
 * note there. They have to run before the limiters or `rateLimitKey` can never
 * see a user and every limit is an IP limit. The conditional and its reasoning
 * travelled with it unchanged. */

/**
 * `req.auth` is written here and nowhere else.
 *
 * @clerk/express v2 REMOVED direct property access to `req.auth` — reading
 * `req.auth.userId` off the request is undefined behaviour there, and `getAuth(req)`
 * is the only supported accessor. Roughly forty call sites in this file read
 * `req.auth.userId`, so this middleware assigns the resolved object back onto the
 * request once, and every one of those sites keeps working unchanged. Do not
 * "clean this up" by deleting the assignment without also rewriting all of them.
 *
 * A thrown getAuth is our misconfiguration (missing or invalid secret key), not the
 * caller's problem, so it stays a 500 — same split the previous implementation made.
 */
const requireAuth = (req, res, next) => {
  // Without the publishable key clerkMiddleware was never mounted, so getAuth would
  // report "signed out" for a perfectly valid token. Answering 401 there would be a
  // lie that sends the user to re-authenticate forever. This is our fault: say 500.
  if (!process.env.CLERK_PUBLISHABLE_KEY) {
    return next(Object.assign(
      new Error('Clerk is not configured: CLERK_PUBLISHABLE_KEY is unset'),
      { status: 500 },
    ));
  }
  let auth;
  try {
    auth = getAuth(req);
  } catch (err) {
    return next(err);
  }
  if (!auth || !auth.userId) {
    return next(Object.assign(new Error('Authentication required'), { status: 401 }));
  }
  req.auth = auth;
  return next();
};

/**
 * The user row, off the critical path wherever possible.
 *
 * This used to await THREE network round trips on every single request, in
 * series, before any work began: Clerk's getUser, a Supabase select, and a
 * Supabase update writing back a name and avatar that had almost never
 * changed. For an existing user — which is every request after their first —
 * two of those bought nothing the answer depended on.
 *
 * Now: look the row up first. If it exists, return it and refresh the profile
 * from Clerk in the BACKGROUND. Clerk is only awaited when the row is missing,
 * because an insert genuinely needs the email.
 *
 * `cached` lets a caller pass a row a middleware already fetched, removing the
 * select as well. checkSuspended runs on every council request and was
 * selecting the same row two lines earlier.
 *
 * The trade is that a name or avatar changed in Clerk shows up one request
 * late. That is the correct thing to be slightly stale about.
 */
/* Two caches, and the reason they are two rather than one.
 *
 * `userRowCache` removes a Supabase select from the front of every
 * authenticated request. It is short — a suspension or a plan change must not
 * outlive a few seconds of staleness — and every write to the `users` table
 * clears it explicitly, so the TTL is a backstop rather than the mechanism.
 *
 * `profileRefreshedAt` is a throttle, not a cache: it holds no value, only the
 * fact that we refreshed recently. refreshProfile was calling Clerk's API and
 * writing a row on EVERY request, in the background, to store a name and
 * avatar that change roughly never. Fire-and-forget made it invisible in the
 * response time; it was still a round trip to Clerk per request, against
 * Clerk's rate limit, and a write per request against Postgres.
 *
 * Ten minutes is chosen against what it delays: a display name edited in
 * Clerk. Nothing about auth, plan or suspension travels this path.
 */
const USER_ROW_TTL_MS = Number(process.env.USER_ROW_TTL_MS) || 15 * 1000;
const PROFILE_REFRESH_MS = Number(process.env.PROFILE_REFRESH_MS) || 10 * 60 * 1000;
const userRowCache = createTtlCache({ ttlMs: USER_ROW_TTL_MS });
const profileRefreshedAt = createTtlCache({ ttlMs: PROFILE_REFRESH_MS });

/* Every write to `users` routes through here.
 *
 * The cache is keyed by clerk_id, and the writes are not: the admin routes
 * address a user by their Supabase `id` and the Stripe webhook addresses them
 * by email, customer or subscription. None of those know a clerk_id without a
 * lookup, and doing that lookup to save a few Map entries would trade a
 * network round trip for nothing. Clearing the whole cache is correct and
 * costs one already-cheap select per active user on their next request. These
 * writes are rare — an admin action or a billing event — and the two that are
 * not rare (refreshProfile, and the insert of a brand-new user) do name a
 * clerk_id and invalidate only that key. */
const invalidateUserRows = () => userRowCache.clear();

const refreshProfile = async (userId) => {
  if (profileRefreshedAt.get(userId) !== undefined) return;
  profileRefreshedAt.set(userId, true);
  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
    const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
    await supabase.from('users').update({ email, name, avatar_url: clerkUser?.imageUrl || null }).eq('clerk_id', userId);
    userRowCache.delete(userId);
  } catch (e) {
    // The throttle is NOT cleared here on purpose. Retrying on the next request
    // means a Clerk outage turns into one call per request per user, which is
    // the load pattern this throttle exists to prevent — and the thing that
    // failed to refresh is a display name.
    console.error('[USER] background profile refresh failed:', e.message);
  }
};

const ensureUser = async (userId, { cached } = {}) => {
  if (!userId) throw new Error('Missing userId');

  if (cached && cached.id) { refreshProfile(userId); return cached; }

  const { data: existing, error: selErr } = await supabase.from('users').select('*').eq('clerk_id', userId).single();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;
  if (existing) { refreshProfile(userId); return existing; }

  // First sight of this user. Clerk has to be awaited here — the insert needs
  // an email, and there is no row to fall back on.
  let clerkUser; try { clerkUser = await clerkClient.users.getUser(userId); } catch (e) { throw new Error(`Clerk failed: ${e.message}`); }
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
  const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
  const { data: created, error: insErr } = await supabase.from('users').insert({ clerk_id: userId, email, name, avatar_url: clerkUser?.imageUrl || null, plan: 'free' }).select().single();
  if (insErr) throw insErr; if (!created) throw new Error('Insert returned no data'); return created;
};

/* Selects the WHOLE row and stashes it, because ensureUser was fetching the
 * same row again two lines later. One select instead of two, on every
 * authenticated request that carries this middleware.
 *
 * That select is now cached for USER_ROW_TTL_MS, which takes a Supabase round
 * trip off the front of every authenticated request — it ran before any work
 * started, so it was pure latency the user watched.
 *
 * A MISS is not cached. `null` here means no row for this clerk_id, which
 * happens on a user's very first request and is resolved by ensureUser
 * inserting one; caching the absence would make the request after that one
 * still see no row. Only a real row goes in.
 *
 * Suspension does not wait for the TTL: the suspend route clears the cache.
 *
 * The generation is read BEFORE the select and the write goes through
 * setIfCurrent, so a suspend that commits while this select is in flight
 * cannot be undone by this request caching the row it fetched a moment before.
 * Clearing an empty cache does nothing to a read that has not landed yet;
 * without this the clear would be silently reverted for a full TTL. */
const checkSuspended = async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); let user = userRowCache.get(req.auth.userId); if (user === undefined) { const generation = userRowCache.generation; const { data, error } = await supabase.from('users').select('*').eq('clerk_id', req.auth.userId).single(); if (error && error.code !== 'PGRST116') throw error; user = data || null; if (user) userRowCache.setIfCurrent(req.auth.userId, user, generation); } if (user && user.suspended) return res.status(403).json({ error: 'Account suspended' }); req.userRow = user || null; req.userPlan = user?.plan || 'free'; next(); } catch (err) { Sentry.captureException(err); return res.status(500).json({ error: 'Verify failed' }); } };
const requireOwnership = (table, col = 'user_id') => async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); const user = await ensureUser(req.auth.userId); const id = req.params.id; if (!id || typeof id !== 'string') return res.status(400).json({ error: 'ID required' }); if (!/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ error: 'Invalid ID' }); const { data: resource, error } = await supabase.from(table).select(col).eq('id', id).single(); if (error || !resource) return res.status(404).json({ error: 'Not found' }); if (resource[col] !== user.id) return res.status(403).json({ error: 'No permission' }); req.resource = resource; next(); } catch (err) { Sentry.captureException(err); return res.status(500).json({ error: 'Ownership check failed' }); } };
// Selects `id` as well as `is_admin` so downstream handlers can record WHICH
// admin acted, and can compare against a :id param — both are Supabase user
// ids. req.auth.userId is a Clerk id and is not comparable to either.
const requireAdmin = async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); const { data: user, error } = await supabase.from('users').select('id,is_admin,suspended').eq('clerk_id', req.auth.userId).single(); if (error) throw error; if (!user || !user.is_admin) return res.status(403).json({ error: 'Admin only' }); if (user.suspended) return res.status(403).json({ error: 'Account suspended' }); req.adminUserId = user.id; next(); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: 'Admin check failed' }); } };
// ip_address was hardcoded to null, so the audit trail could say what happened
// and to whom but never from where — which is the column you want first when
// you are reading it at all.
/* Audit rows are swept on a counter rather than a schedule.
 *
 * The free tier has no scheduler, and audit_logs.ip_address is personal data
 * that the privacy policy says is kept for 90 days. A retention period the
 * database does not actually honour is a false published statement, so the
 * deletion has to happen somewhere — and the cheapest correct place is here,
 * amortised across writes.
 *
 * Not awaited, and failures are swallowed: housekeeping must never be able to
 * fail a user's request. Falling behind costs disk and nothing else, because
 * nothing reads a row's age to make a decision. */
let auditWritesSinceSweep = 0;
const AUDIT_SWEEP_EVERY = 200;
const AUDIT_RETAIN_DAYS = Number(process.env.AUDIT_RETAIN_DAYS) || 90;

const auditLog = async (userId, action, metadata = {}, ip = null) => {
  try {
    await supabase.from('audit_logs').insert({ user_id: userId, action, metadata, ip_address: ip || null, created_at: new Date().toISOString() });
  } catch (e) {
    console.error('Audit failed:', e.message);
  }
  if (++auditWritesSinceSweep >= AUDIT_SWEEP_EVERY) {
    auditWritesSinceSweep = 0;
    Promise.resolve()
      .then(() => supabase.rpc('sweep_audit_logs', { retain_days: AUDIT_RETAIN_DAYS }))
      .then((r) => { if (r?.data) console.log(`[RETENTION] swept ${r.data} audit rows older than ${AUDIT_RETAIN_DAYS}d`); })
      .catch(() => {});
  }
};

/* THE TWO CALLS INTO THE SPEND LEDGER, kept here rather than in lib/spend.js
 * so that file stays a pure cost model with no database in it — it is the part
 * worth unit-testing exhaustively, and a module that reaches for Supabase is
 * not that.
 *
 * BOTH FAIL OPEN. A Supabase blip must not stop the product working, and the
 * exposure is a window of unmetered spend that requires an attacker to notice
 * an outage they cannot cause. Same trade `pg-rate-limit-store.js` makes and
 * argues at length; the difference — that this one leaks money rather than
 * request quota — is real and is flagged for review rather than assumed away.
 *
 * The failure is logged every time. A ceiling that has silently stopped
 * applying is worse than no ceiling, because the graphs stay reassuring. */
const reserveSpend = async (userId, cents) => {
  try {
    const { data, error } = await supabase.rpc('reserve_user_spend', {
      p_user_id: userId,
      p_cents: cents,
      p_day_limit: LIMITS.dayCents,
      p_month_limit: LIMITS.monthCents,
    });
    if (error) throw new Error(error.message || String(error));
    // Postgres RETURNS TABLE arrives as an array of one row.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('reserve_user_spend returned no row');
    return { allowed: row.allowed !== false, dayCents: row.day_cents, monthCents: row.month_cents };
  } catch (e) {
    console.error(`[SPEND] Reservation failed, ADMITTING UNMETERED: ${e.message}`);
    return { allowed: true, dayCents: null, monthCents: null, unmetered: true };
  }
};

const settleSpend = (userId, reserved, actual) => {
  supabase
    .rpc('settle_user_spend', { p_user_id: userId, p_reserved: reserved, p_actual: actual })
    .then(({ error }) => { if (error) console.error(`[SPEND] Settlement failed: ${error.message}`); })
    .catch((e) => console.error(`[SPEND] Settlement failed: ${e.message}`));
};

// ===== HEALTH =====
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== COUNCIL =====
app.post('/api/council', requireAuth, checkSuspended, async (req, res) => {
  // Wall-clock to the point where the first byte of an answer starts streaming.
  // Everything before that is the user watching nothing happen, and until now
  // it was invisible: the only latency anyone could see was the total, which
  // mixes it with however long the model took to write. The existing council
  // audit row now carries the phase breakdown so the admin console can report
  // it without a second logging system or a log dashboard.
  const t0 = Date.now();
  const telemetry = createTurnTelemetry({ startedAt: t0 });
  const turnController = new AbortController();
  const turnSignal = turnController.signal;
  let auditUserId = null;
  /* What this turn reserved against the user's ceiling, so the `finally` can
   * refund the difference. 0 means nothing was reserved — the turn was refused,
   * or it failed before admission — and the settlement is skipped rather than
   * settling a reservation that does not exist. */
  let spendReserved = 0;
  /* ONE FLAG FOR EVERY WRITE, not one per writer.
   *
   * This used to be `telemetryWritten` and it guarded only `auditTelemetry`.
   * The memory, greeting, no_results, search and wiki branches called
   * `auditLog` directly, so the flag stayed false on the exact paths that had
   * already written a row — which did not matter while nothing else wrote, and
   * matters now that the `finally` below writes one for abandoned turns. A
   * client vanishing between a branch's `await auditLog` and its `return` would
   * have produced two rows for one turn. Everything that can write the turn's
   * row now routes through `auditBranch` or `auditTelemetry` and sets this. */
  let turnAudited = false;
  const auditBranch = async (metadata) => {
    if (!auditUserId || turnAudited) return;
    turnAudited = true;
    await auditLog(auditUserId, 'council', metadata, req.ip);
  };
  const auditTelemetry = async (action, category, extra = {}) => {
    if (!auditUserId || turnAudited) return;
    turnAudited = true;
    await auditLog(auditUserId, action, telemetry.snapshot({
      category,
      msToFirstByte: (res.locals?.firstChunkAt || Date.now()) - t0,
      msToFirstProgress: (res.locals?.firstByteAt || Date.now()) - t0,
      extra,
      aborted: turnSignal.aborted,
    }), req.ip);
  };
  const abortOnDisconnect = () => {
    if (!res.writableEnded && !res.writableFinished && !turnSignal.aborted) {
      turnController.abort(new DOMException('Client disconnected', 'AbortError'));
    }
  };
  const cleanupDisconnect = () => {
    req.off('aborted', abortOnDisconnect);
    res.off('close', abortOnDisconnect);
    res.off('finish', cleanupDisconnect);
  };
  req.once('aborted', abortOnDisconnect);
  res.once('close', abortOnDisconnect);
  res.once('finish', cleanupDisconnect);
  try {
    const user = await ensureUser(req.auth.userId, { cached: req.userRow });
    auditUserId = user.id;
    const { message, history = [], chatId, image } = req.body;
    const pv = validatePrompt(message);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    // Trimmed rather than rejected. The old code returned 400 on a 21st message
    // while silently clipping a 100,000-character one, which is two different
    // answers to the same question; and the council slices to the last ten
    // anyway, so the rejection was refusing input it was about to discard.

    const userPlan = user.plan || 'free';
    const isDetailed = wantsDetailedAnswer(pv.value);
    const lang = detectLanguage(pv.value);
    // The plan decides the roster HERE, once, rather than inside the router —
    // which is what lets the router be called with a sentence and checked.
    const selection = classifyRequest(pv.value, userPlan === 'pro' ? COUNCIL : FREE_COUNCIL, isDetailed);

    /* THE SPEND CEILING, RESERVED BEFORE THE FIRST PAID CALL.
     *
     * $5/day and $20/month per user, the owner's figures, 2026-08-12. It closes
     * the half of Sol's finding 2 that the rate-limiter fix could not: limits
     * now key on the authenticated user rather than the IP, but a request RATE
     * is not a spend ceiling, and one account inside 30 turns/minute can still
     * run the bill up.
     *
     * RESERVED, NOT CHARGED, and the order is the whole design. Admission has
     * to commit to a number before anyone knows what the turn will do, so it
     * reserves the pessimistic worst case — full roster, synthesis, a fallback
     * council, the whole tool budget — and the difference is refunded in the
     * `finally` once the telemetry says what actually happened. Charging only
     * afterwards would make this a report rather than a ceiling; the money
     * would already be gone.
     *
     * The reservation is ATOMIC in Postgres — increment first, test the limits
     * against the result, undo inside the same transaction if refused. A
     * SELECT-then-UPDATE from here would leave a window where two concurrent
     * turns both read an under-limit balance and both proceed, and concurrency
     * is exactly how someone would attack a ceiling. See 014_user_spend.sql.
     *
     * FAILS OPEN, inheriting the argument in pg-rate-limit-store.js: a database
     * blip must not take the product down, and the exposure is a window of
     * spend that requires an attacker to notice an outage they cannot cause.
     * It is logged loudly because a ceiling that has quietly stopped applying
     * must not also be quiet about it. Flagged for Sol's review, since the
     * calculus is not identical to a rate limiter's — this one leaks money.
     *
     * 402, not 429: the request is not too frequent, it is refused. A retry in
     * a minute does not help and the client should not be told it might. */
    /* Rounds passed explicitly, because every round re-asks every seat and the
     * reservation has to cover all of them — see the note in lib/spend.js. The
     * literals mirror `agent-loop.js`'s DEFAULTS; if those change, this must. */
    const reserved = reservationCents(selection.members.length, 12, 4);
    const budget = await reserveSpend(user.id, reserved);
    if (!budget.allowed) {
      telemetry.markCeiling('spend');
      await auditBranch({ category: 'spend_ceiling', dayCents: budget.dayCents, monthCents: budget.monthCents });
      return res.status(402).json({
        error: 'Daily or monthly usage limit reached. It resets at midnight UTC.',
        dayCents: budget.dayCents,
        monthCents: budget.monthCents,
      });
    }
    spendReserved = reserved;
    const truncatedPrompt = truncatePrompt(pv.value);
    const histArr = sanitizeHistory(history);

    // VISION. The council speaks to a text model, so an attached image is
    // described first and the description travels as context — the same shape
    // /api/overlay uses.
    //
    // Every failure below is returned to the caller rather than swallowed. The
    // overlay skips vision silently on error, which means it answers as though
    // no image were attached; that is a worse lie than showing an error, because
    // the user cannot tell the difference between "didn't look" and "looked and
    // saw nothing".
    let imageContext = '';
    let parsedImage = null;
    let visionP = Promise.resolve(null);
    if (image) {
      parsedImage = parseDataUrl(image);
      if (!parsedImage) return res.status(400).json({ error: 'Attached image must be a base64-encoded PNG, JPEG, WebP or GIF under 8 MB.' });
      if (!GOOGLE_API_KEY) return res.status(503).json({ error: 'Image analysis is not configured on this server.' });
      /* START VISION BEFORE THE CONTEXT READS. Summary, feedback and facts do
       * not depend on the image, so waiting for all three Supabase queries
       * before calling Gemini added their full round-trip to every image turn.
       * The result is still awaited before prompt assembly; only the idle time
       * is removed. */
      const visionModel = userPlan === 'pro' ? 'gemini-2.5-pro-preview-05-06' : 'gemini-2.5-flash-preview-05-06';
      visionP = telemetry.measureContext('vision', () => callGeminiVision(visionModel, 'Describe this image thoroughly. Include any text, code, UI elements, data and errors visible in it.', parsedImage.base64, parsedImage.mime, 1024, turnSignal))
        .then((text) => ({ text }))
        .catch((error) => ({ error }));
    }

    const contextReads = Promise.all([
      telemetry.measureContext('summary', () => readChatSummary(chatId, user.id, turnSignal)),
      telemetry.measureContext('feedback', () => getFeedbackGuidance(user.id, turnSignal)),
      telemetry.measureContext('facts', () => readUserFacts(user.id, FACTS_INJECT_LIMIT, pv.value, turnSignal)),
    ]);
    const [contextResult, visionResult] = await Promise.all([
      contextReads,
      visionP,
    ]);
    if (turnSignal.aborted) return;
    const [convSummary, feedbackGuidance, userFacts] = contextResult;

    if (parsedImage) {
      if (visionResult?.error) {
        console.error('[COUNCIL] Vision failed:', visionResult.error.message);
        return res.status(502).json({ error: "Couldn't analyse the attached image. Try again, or send the message without it." });
      }
      imageContext = visionResult?.text || '';
      if (!imageContext.trim()) return res.status(502).json({ error: "Couldn't read anything from the attached image." });
      console.log(`[COUNCIL] Vision: ${parsedImage.mime}, ${Math.round(parsedImage.bytes / 1024)}KB`);
    }

    // Injected into every prompt path below, so memory and learned preferences
    // stay in lockstep instead of each call site assembling its own context.
    // Where the user probably is, from what the browser already volunteers —
    // no IP lookup, no third-party service, nothing stored. It is the last
    // system message so it is the weakest thing in the stack: an inferred
    // location must never outrank what the user actually asked for.
    const region = detectRegion({
      cdnCountry: req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'],
      timezone: sanitizeString(req.body.timezone, 64),
      acceptLanguage: req.headers['accept-language'],
    });

    // convSummary and feedbackGuidance stay at system position deliberately.
    // Both derive from this user's own turns, scoped to their own user_id, so
    // the only thing either can inject into is the session of the person who
    // wrote it — and that person already owns the user turn. Self-injection
    // buys an attacker nothing. Do not "fix" these by demoting them: the
    // summary IS context and the preferences ARE instructions.
    //
    // imageContext is different and does not belong up there. It is a vision
    // model's transcription of an uploaded image, so its text was written by
    // whoever made the image — which is not necessarily the user. Text inside a
    // screenshot someone was sent reaches us verbatim. The instruction stays at
    // system position; the transcription moves down and is labelled.
    //
    // userFacts belongs at system position for the same reason convSummary
    // does, and only because of how it is built: every fact was extracted from
    // this user's own message under their own user_id. Nothing the web said
    // reaches this list. lib/user-facts.js is where that rule is enforced and
    // explained; if it is ever relaxed, this line has to move down and get a
    // preamble.
    const contextMsgs = [
      ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convSummary}` }] : []),
      ...(userFacts.length ? [{ role: 'system', content: factsBlock(userFacts) }] : []),
      ...(feedbackGuidance ? [{ role: 'system', content: `USER PREFERENCES, learned from their past ratings. Honour these unless they conflict with accuracy:\n${feedbackGuidance}` }] : []),
      ...(imageContext ? [
        { role: 'system', content: 'THE USER ATTACHED AN IMAGE. A description of it follows in a user turn — treat it as something you can see, and answer with reference to it.' },
        { role: 'user', content: `=== IMAGE DESCRIPTION ===\n${UNTRUSTED_PREAMBLE}\n\n${imageContext}` },
      ] : []),
      ...(region ? [{ role: 'system', content: regionHint(region) }] : []),
    ];

    console.log(`[COUNCIL] ${user.email} | ${userPlan} | ${selection.category} | Mem: ${convSummary ? 'Y' : 'N'} | Facts: ${userFacts.length} | Lang: ${lang} | Region: ${region ? `${region.country} via ${region.source}` : 'unknown'}`);

    /* THE SHADOW PROBE RUNS HERE, ABOVE THE ROUTER — and that placement is the
     * whole point of it.
     *
     * It was originally inside step 4 alongside the live loop, which is where
     * the live loop belongs and is exactly the wrong place for a probe. Steps
     * 0 through 3 all `return`, so step 4 is reached only when the router
     * decided the question needed no memory lookup, no greeting, NO SEARCH and
     * no Wikipedia. For any substantive question the search branch returns
     * first, so the probe never ran — [COUNCIL] appeared in the logs on every
     * request and [PROBE] appeared on almost none.
     *
     * That is also the more useful measurement. The question worth answering is
     * "would these models emit a tool call for the things people actually
     * ask?", and the things people actually ask are precisely the ones the
     * router sends to search. Sampling only the leftovers would have measured
     * the wrong population and looked like a clean result.
     *
     * Fire-and-forget: nothing awaits it, it cannot delay the answer or fail
     * the turn, and Node finishes the promise after the response has been sent.
     * Greetings and image turns are skipped — a greeting has nothing to
     * research, and an image turn is not a path the live loop ever takes. */
    if (TOOLS_SHADOW && !imageContext && selection.category !== 'greeting' && selection.members.length) {
      const probeSys = `You are an elite AI expert in the ALOP-AI Council. If you answer, be direct. Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
      const probeMsgs = [{ role: 'system', content: probeSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: truncatedPrompt }];
      const probeRegistry = buildRegistry({ search: toolSearch, readUrl: readPageContent, assertSafeUrl, checkLinks: checkSearchLinks });

      Promise.all(
        selection.members.map(async ({ model }) => {
          try {
            const raw = await callModel(model, toolMessages(probeMsgs, probeRegistry, { round: 1, isFinalRound: false }), 0.0, selection.whipMs, selection.tokenLimit, turnSignal);
            return { member: model, ...parseToolRequests(raw) };
          } catch (err) {
            return { member: model, calls: [], text: '', error: err.message };
          }
        }),
      ).then((replies) => {
        const s = summariseProbe(replies);
        console.log(`[PROBE] ${s.verdict} | category=${selection.category} members=${s.members} failed=${s.failed} emitted=${s.emitted} unparsed=${s.unparsed} tools=${JSON.stringify(s.byTool)}`);
        if (s.sample) console.log(`[PROBE] unparsed sample: ${s.sample.replace(/\s+/g, ' ').slice(0, 300)}`);
      }).catch((err) => console.error('[PROBE] failed:', err.message));
    }

    // 0. MEMORY BYPASS
    // Skipped when an image is attached: this branch and the greeting one below
    // build their own message arrays and never read contextMsgs, so routing here
    // would drop the image description on the floor. An attached image also means
    // the user wants that image looked at, not a recap.
    /* THE TWO ROUTER CALLS RUN TOGETHER, not one after the other.
     *
     * Both are FAST_MODEL round trips to the gateway and both take only inputs
     * that exist before either runs. In series they were the first two things
     * on the critical path of every message, and nothing could start until both
     * had returned.
     *
     * The trade, stated plainly: a memory question now also pays for a search
     * decision it will not use. That is one call to a fast model with a
     * 50-token ceiling, on a minority of turns, against a full round trip saved
     * on the majority. Worth it — but it IS a real cost, not a free win.
     *
     * Not awaited here. Each branch awaits the one it needs, so a memory
     * question never blocks on the search decision finishing. */
    // A greeting is decided by a regex in classifyRequest before either of
    // these runs, and then answered by a branch that reads neither. Paying two
    // model round trips to route "hi" was pure latency on the cheapest possible
    // turn — and greetings are disproportionately a user's FIRST message, which
    // is the one that forms their impression of how fast this is.
    const skipRouter = Boolean(imageContext) || selection.category === 'greeting';
    const memoryP = skipRouter ? Promise.resolve(false) : telemetry.measureRouter('memory', () => isMemoryOrReferenceQuestion(pv.value, turnSignal)).catch(() => false);
    const searchQueryP = skipRouter ? Promise.resolve(null) : telemetry.measureRouter('search', () => getSearchQuery(pv.value, convSummary, region, turnSignal)).catch(() => null);

    if (await memoryP) {
      console.log('[COUNCIL] Memory question.');
      const memSys = `You are ALOP-AI. The user is asking about a previous conversation. The history below IS your memory. Do NOT say you can't remember. Reference what was discussed. Be concise.${convSummary ? `\n\nSummary: ${convSummary}` : ''}`;
      const memMsgs = [{ role: 'system', content: memSys }, ...histArr.slice(-10), { role: 'user', content: pv.value }];
      openStream(res);
      await streamModel(res, PRIMARY_MODEL, memMsgs, 0.0, turnSignal);
      if (!res.writableEnded) res.end();
      rememberTurn(chatId, user.id, pv.value, 'Answered memory question.');
      await auditBranch({ category: 'memory' });
      return;
    }
    if (turnSignal.aborted) return;

    // 1. GREETING (see the note above on why an image skips this)
    if (!imageContext && selection.category === 'greeting') {
      console.log('[COUNCIL] Greeting.');
      const greetMsgs = [{ role: 'system', content: `You are ALOP-AI. Greet briefly.${convSummary ? ` Context: ${convSummary}` : ''}` }, { role: 'user', content: pv.value }];
      openStream(res);
      await streamModel(res, PRIMARY_MODEL, greetMsgs, 0.0, turnSignal);
      if (!res.writableEnded) res.end();
      await auditBranch({ category: 'greeting' });
      return;
    }

    // 2. SEARCH
    // Started above, alongside the memory check. By the time control reaches
    // here it has usually already resolved, so this await is free.
    const searchQueries = await searchQueryP;
    const shouldCheckWiki = needsWikiCheck(pv.value);
    /* Derived from the USER'S words, not from the query the model wrote.
     *
     * The model is asked to include the year "only when recency is the point",
     * so the query text is an unreliable signal for the freshness window — a
     * question that plainly says "right now" can produce a query with nothing
     * time-ish in it at all. The question is the thing that knows whether the
     * present matters. See lib/recency. */
    const fresh = freshnessWindow(pv.value);

    if (turnSignal.aborted) return;
    if (searchQueries) {
      /* THE SCREEN STOPS BEING BLANK HERE, not when the answer starts.
       *
       * The search path is the most common one and it showed nothing until the
       * whole fan-out had finished and the model had begun writing — seconds of
       * a spinner that says only "something is happening". The user cannot tell
       * a slow search from a hung request, and the second guess is the one that
       * makes them reload.
       *
       * These are the SAME tool_start / tool_result events the council's
       * activity trail already emits, so the frontend renders them with no new
       * code: one row that says what is being searched for, then resolves.
       * Reusing that contract rather than inventing a second progress channel
       * is also why this is four lines. */
      openStream(res);
      sendEvent(res, { type: 'tool_start', round: 1, name: 'web_search', summary: `Searching: ${searchQueries.join(' · ').slice(0, 80)}` });

      /* CONCURRENT, so two queries cost the wall clock of one.
       *
       * Each comprehensiveSearch is its own five-provider fan-out under its own
       * 3.5s deadline. Run in series that is seven seconds; run together it is
       * still three and a half, because the deadlines overlap rather than
       * queue. The extra cost is provider quota and prompt tokens, not the
       * user's time — which is the only reason researching two angles is
       * affordable at all. Capped at two by parseSearchPlan; see that file for
       * why not five.
       *
       * Wikipedia is asked for on the FIRST query only. It is an encyclopedia
       * lookup on the subject, and the subject does not change between the two
       * halves of one question — asking twice pays a second round trip for the
       * same article. */
      const perQuery = await Promise.all(
        searchQueries.map((q, i) => comprehensiveSearch(q, shouldCheckWiki && i === 0, fresh, region, turnSignal)),
      );
      if (turnSignal.aborted) return;

      /* Merged on URL, because two queries about one subject overlap heavily
       * and the same page arriving twice is not corroboration — it reads to the
       * model as two independent sources agreeing, which is exactly the wrong
       * signal to send about a single page. */
      const found = perQuery.some((r) => r.found);
      const sources = [];
      for (const r of perQuery) for (const s of r.sources) if (!sources.find((x) => x.url === s.url)) sources.push(s);
      const images = [...new Set(perQuery.flatMap((r) => r.images))];
      const context = perQuery
        .map((r, i) => (r.context ? `=== SEARCH ${i + 1}: ${searchQueries[i]} ===\n${r.context}` : ''))
        .filter(Boolean)
        .join('\n\n');

      sendEvent(res, {
        type: 'tool_result', round: 1, name: 'web_search', ok: found,
        summary: found ? `${sources.length} source${sources.length === 1 ? '' : 's'}` : 'No results',
      });
      if (!found) {
        openStream(res);
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: "I searched but couldn't find results. Could you rephrase?" })}\n\n`);
        res.write('data: [DONE]\n\n');
        if (!res.writableEnded) res.end();
        await auditBranch({ category: 'no_results' });
        return;
      }
      console.log(`[COUNCIL] ${searchQueries.length} quer${searchQueries.length === 1 ? 'y' : 'ies'}, ${sources.length} sources, ${context.length} chars${fresh ? `, freshness=${fresh.label}` : ''}.`);
      /* Rules 13 to 15 are the recency half, and they are separate rules rather
       * than a clause bolted onto rule 1 because each fails on its own.
       *
       * Every source now arrives with a `Published:` line — see comprehensiveSearch
       * — and without an instruction the model treats that line as decoration.
       * It has to be told to PREFER the recent one when two disagree, because
       * its default is to prefer whichever is more detailed, and stale pages are
       * often the more detailed ones.
       *
       * Rule 15 is the one that reaches the user. A dated claim stated bare
       * ("the price is X") is indistinguishable from a current one; the same
       * claim with "as of" attached lets them judge for themselves, which is
       * the whole point of having searched. */
      const extSys = `${todayLine()}\n\nYou are a precision data extraction engine. Use ONLY the provided data.\n\nRULES:\n1. Only state facts from the data.\n2. No training data.\n3. No inferring/guessing.\n4. No comparing unless both products are in data.\n5. If not in data, say "I couldn't find this in the search results."\n6. Include URLs as Markdown: [Title](URL)\n7. No inventing specs/prices.\n8. Note contradictions between sources.\n9. Format in Markdown. Match answer length to question. Be concise for simple questions.\n10. List sources at bottom under "## Sources".\n11. Embed images if provided: ![Description](url)\n12. CONVERSATION CONTEXT and history are EXEMPT from rules 1-5.\n13. Each source carries a Published date. When sources disagree, prefer the most recent one and say that the older one is out of date — do not average them or pick the more detailed one.\n14. If every source on a time-dependent point is more than a year old, say so rather than presenting it as current.\n15. Attach the date to any fact that changes over time: "as of [date]". A price, version or ranking stated bare reads as current even when it is not.${lang !== 'English' ? `\n16. Respond in ${lang}.` : ''}`;
      const extMsgs = [{ role: 'system', content: extSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: `${truncatedPrompt}\n\n=== SEARCH DATA ===\n${context}` }];
      openStream(res);
      await streamModel(res, PRIMARY_MODEL, extMsgs, 0.0, turnSignal);
      if (!res.writableEnded) res.end();
      const lastA = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
      rememberTurn(chatId, user.id, pv.value, lastA || 'Search response.');
      await auditBranch({ category: 'search', sources: sources.length });
      return;
    }

    // 3. WIKIPEDIA
    if (shouldCheckWiki) {
      const wiki = await searchWikipedia(pv.value, turnSignal);
      if (wiki) {
        const wikiSys = `${todayLine()}

You are a data extraction engine. Use ONLY the Wikipedia content. No training data. If not found, say "I couldn't find this on Wikipedia." Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
        // Its own fetch, not searchWeb's, so it needs its own label. Wikipedia is
        // world-editable: this is the one source where an attacker does not even
        // need a site of their own.
        const wikiMsgs = [{ role: 'system', content: wikiSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: `${truncatedPrompt}\n=== WIKIPEDIA ===\n${UNTRUSTED_PREAMBLE}\n\n${wiki}` }];
        openStream(res);
        await streamModel(res, PRIMARY_MODEL, wikiMsgs, 0.0, turnSignal);
        if (!res.writableEnded) res.end();
        rememberTurn(chatId, user.id, pv.value, 'Wikipedia response.');
        await auditBranch({ category: 'wiki' });
        return;
      }
    }

    // 4. COUNCIL
    /* The date reaches the COUNCIL too, not only the search path.
     *
     * This branch runs when the router decided no search was needed, which is
     * precisely the branch answering from recall — the one place a stale fact
     * has nothing to contradict it. Leaving the date out here would have fixed
     * staleness only where sources already existed to fix it. */
    const councilSys = `${todayLine()}

You are an elite AI expert in the ALOP-AI Council. If outside your expertise, reply ONLY "SKIP". If you answer, be direct. Match response length to question complexity. Use Markdown. If context/history provided, use for continuity. ${isDetailed ? 'Be thorough.' : 'Be concise.'}${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
    const councilMsgs = [{ role: 'system', content: councilSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: truncatedPrompt }];

    // The agent loop, when enabled, replaces the single-shot council with
    // propose → dedupe → broadcast. It only ever runs HERE, after the router
    // decided no search was needed — which is exactly the gap it exists for: a
    // member that disagrees with that decision can now act on it, where before
    // the tools were present and the initiative was not.
    //
    // COUNCIL_TOOLS is off by default and the router path below is untouched,
    // so this ships dark and a bad turn is one env var from being reverted
    // without a deploy.
    let validResponses, toolResearch = '', toolTruncated = null;
    let telemetryExtra = {};
    let toolPlainFallback = { used: false, durationMs: null };
    let councilRelease = null;
    const reportCouncilTiming = (phase) => (row) => telemetry.recordSeat({ ...row, phase });
    const reportCouncilFinish = (event) => {
      councilRelease = event;
      if (event?.reason === 'whip') telemetry.markCeiling('council_whip');
    };

    /* OPENED HERE, not at synthesis. Everything above this line can still fail
     * with a status code; from here the work is long, so the wait is narrated
     * instead of silent. The tools branch already opened early for exactly this
     * reason and the plain council — which is most turns — did not.
     *
     * `sendSeatProgress` reports the room filling up. runCouncil has always
     * known when each seat starts and settles and has always accepted an
     * `onSeat`; nothing in production ever passed one, so the information
     * existed and went nowhere. The SSE event remains counts only, never model
     * names: which models sit on the council is not the user's business and is
     * one string away from being in a screenshot. The audit row records the
     * model label privately because that is what identifies a p90 straggler. */
    openStream(res);
    const seatCount = selection.members.length;
    let seatsAnswered = 0;
    const sendSeatProgress = ({ state }) => {
      if (state === 'thinking') return;
      seatsAnswered++;
      sendStage(res, 'council', `${seatsAnswered} of ${seatCount} answered`);
    };
    sendStage(res, 'council', seatCount === 1 ? 'Asking one seat' : `Asking ${seatCount} seats`);

    if (TOOLS_ENABLED && !imageContext) {
      // read_file is offered only when this conversation actually has files.
      // A tool that can only ever answer "no files" is a tool the council
      // wastes a round discovering is useless.
      const files = chatId ? fileStoreFor(user.id, chatId) : null;
      const attached = files ? await files.list({ signal: turnSignal }) : [];
      if (turnSignal.aborted) return;
      const registry = buildRegistry({
        search: toolSearch,
        readUrl: readPageContent,
        assertSafeUrl,
        checkLinks: checkSearchLinks,
        /* The specialised engines, offered only when SerpApi has a key. Each
         * call is billed, which is why the agent loop's 8-call ceiling matters
         * more for this tool than for the free providers. `region` gives the
         * engine a country so a UAE user is not quoted a US price. */
        ...(SERPAPI_API_KEY
          ? {
              engineNames: ENGINE_NAMES,
              engineMenu: engineMenu(),
              /* CACHED, because every one of these is BILLED. Two seats of the
               * same council reaching for google_flights with the same query is
               * the normal case, not the odd one — seven models answering the
               * same question converge on the same lookup — and without this
               * the second one is simply paid for twice.
               *
               * The key carries the engine, the country and the extra params:
               * a flight search differs from another only in its parameters, so
               * keying on the query alone would serve Dubai-to-London for
               * Dubai-to-Cairo. Only successful lookups are stored — caching a
               * failure would keep a transient one alive for fifteen minutes. */
              searchEngine: async ({ engine, query, params, signal }) => {
                const merged = { ...(region && region.country ? { gl: region.country.toLowerCase() } : {}), ...params };
                const key = `serpapi:${engine}:${query}:${JSON.stringify(Object.entries(merged).sort())}`;
                const hit = await getCachedSearch(key, signal);
                if (hit) return hit;
                const res = await searchSerpApi({ engine, query, params: merged, apiKey: SERPAPI_API_KEY, signal });
                if (res && res.ok) setCachedSearch(key, res);
                return res;
              },
            }
          : {}),
        ...(attached.length ? { files } : {}),
      });
      // Opened BEFORE the loop so tool progress can be reported as it happens.
      // The loop can run for the best part of a minute — 25s of tool work plus
      // the council's own deliberation, under a 75s ceiling — and a silent
      // spinner for that long is worse than the router path it replaced. From here on every failure is an SSE frame,
      // never a 500 — see the catch at the end of this route.
      openStream(res);
      const loop = await runAgentLoop({
        members: selection.members.map((m) => m.model),
        registry,
        /* THE SAME QUORUM THE PLAIN COUNCIL RUNS ON. The tools path replaced
         * runCouncilWithWhip and did not replace its quorum release, so a turn
         * that used a tool waited on every seat where a turn that did not waited
         * on the k-th. The router already decides how many answers make a
         * council; there is no second policy here. */
        quorum: selection.quorum,
        onEvent: (e) => {
          console.log(`[TOOLS] r${e.round} ${e.type} ${e.name}${e.ok === false ? ' FAILED' : ''} — ${e.summary}`);
          sendEvent(res, e);
        },
        onSeatTiming: reportCouncilTiming('tools'),
        signal: turnSignal,
        askMember: (model, ctx, signal) =>
          callModel(model, toolMessages(councilMsgs, registry, { ...ctx, attachedFiles: attached }), 0.0, selection.whipMs, selection.tokenLimit, signal),
      });
      if (turnSignal.aborted) return;
      for (const row of loop.toolRounds) telemetry.recordToolRound(row);
      if (loop.stopReason && loop.stopReason !== 'quorum') telemetry.markCeiling(loop.stopReason);
      toolResearch = loop.research;
      toolTruncated = loop.truncated;
      console.log(`[TOOLS] ${loop.rounds} round(s), ${loop.uniqueCallsUsed} unique call(s), ${Object.keys(loop.answers).length} answer(s)${loop.truncated ? ` — ${loop.truncated}` : ''}`);
      // The same predicate the council's quorum uses, rather than a third copy
      // of the skip regex. It was a second copy, and the agent loop had a third
      // rule again — any non-empty string — which is how a bare "skip" came to
      // count toward a quorum here.
      validResponses = Object.entries(loop.answers)
        .filter(([, content]) => isUsableAnswer(content))
        .map(([model, content]) => ({ model, content }));
      // A loop that produced nothing usable falls through to the plain council
      // rather than to the fallback: losing seven experts because the tool
      // round misfired is a worse answer than not having used tools at all.
      const fellBack = validResponses.length === 0;
      if (fellBack) {
        console.log('[TOOLS] no usable answers, falling back to the plain council.');
        const fallbackStartedAt = Date.now();
        validResponses = await runCouncilWithWhip(
          selection.members,
          councilMsgs,
          selection.whipMs,
          selection.quorum,
          selection.tokenLimit,
          sendSeatProgress,
          { signal: turnSignal, onSeatTiming: reportCouncilTiming('tool_plain_fallback'), onFinish: reportCouncilFinish },
        );
        toolPlainFallback = { used: true, durationMs: Date.now() - fallbackStartedAt };
      }

      // Keep all turn telemetry in the one audit row written after synthesis.
      // A second logger would split the answer to "why was this turn slow?"
      // across two retention and query paths, and writing here would put a
      // Supabase round-trip between the council and the first model token.
      telemetryExtra = {
        rounds: loop.rounds,
        uniqueCalls: loop.uniqueCallsUsed,
        toolMs: loop.toolMs,
        members: selection.members.length,
        answered: Object.keys(loop.answers).length,
        usable: validResponses.length,
        fellBack,
        truncated: loop.truncated || null,
        stopReason: loop.stopReason,
        toolPlainFallback,
        councilRelease,
        tools: loop.toolResults.reduce((acc, { call }) => ({ ...acc, [call.name]: (acc[call.name] || 0) + 1 }), {}),
      };
    } else {
      validResponses = await runCouncilWithWhip(
        selection.members,
        councilMsgs,
        selection.whipMs,
        selection.quorum,
        selection.tokenLimit,
        sendSeatProgress,
        { signal: turnSignal, onSeatTiming: reportCouncilTiming('council'), onFinish: reportCouncilFinish },
      );
    }

    // 5. FALLBACK
    if (validResponses.length === 0) {
      console.log('[COUNCIL] Fallback.');
      const fbSys = `${todayLine()}

You are a helpful AI assistant. Answer directly. Match length to question. If you don't know, say "I don't have enough information." Don't guess. Use context if provided. Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
      const fbMsgs = [{ role: 'system', content: fbSys }, ...contextMsgs, ...histArr.slice(-10), { role: 'user', content: truncatedPrompt }];
      openStream(res);
      const fallbackStartedAt = Date.now();
      await streamModel(res, PRIMARY_MODEL, fbMsgs, 0.0, turnSignal);
      telemetry.recordFallback(Date.now() - fallbackStartedAt, 'post_council');
      if (turnSignal.aborted) return;
      if (!res.writableEnded) res.end();
      rememberTurn(chatId, user.id, pv.value, 'Fallback response.');
      await auditTelemetry(
        telemetryExtra.rounds !== undefined ? 'council.tools' : 'council',
        'fallback',
        { ...telemetryExtra, models: 0, seats: selection.members.length, quorum: selection.quorum, tokenLimit: selection.tokenLimit, councilRelease },
      );
      return;
    }

    // 6. SYNTHESIS
    const synthSys = `${todayLine()}

You are the Chief Synthesiser for a panel of independent experts who answered the same question separately. Reconcile them — do not average them.

1. Where they agree, state it once, plainly.
2. Where they disagree on a FACT, say so and give the competing claims. Do not silently pick one.
3. Where they disagree on JUDGEMENT or approach, give the strongest version of each and say what would decide between them.
4. Prefer the more specific, better-supported answer — but never invent a justification for preferring it.
5. Introduce no fact that appears in none of the responses.
6. Never mention the panel, the experts, how many there were, or that synthesis happened. Write as a single voice.
7. Match length to the question's complexity. Do not pad.
8. Use Markdown.
9. End on the answer. No "Would you like help with anything else?", no "Let me know if...", no closing offer of further assistance. The user knows they can ask again.
10. If you are inferring rather than reporting — a price you did not see, a spec you are reasoning to, a substitute product — say so IN THE SAME SENTENCE. "Likely higher" without "I did not find a listed price" reads as a fact.${lang !== 'English' ? `\n11. Respond in ${lang}.` : ''}`;
    // Research and truncation reach the synthesiser, because the design's rule
    // is that a cut-short answer must be able to hedge rather than assert. A
    // truncated answer presented as a complete one is worse than a slow one.
    // The council rounds label this content; synthesis did not, and synthesis is
    // the step that actually writes the user's answer. Labelling only the rounds
    // protects the deliberation and leaves the conclusion exposed.
    const researchBlock = toolResearch ? `\n\n=== RESEARCH GATHERED THIS TURN ===\n${UNTRUSTED_PREAMBLE}\n\n${toolResearch}` : '';
    const truncationBlock = toolTruncated
      ? `\n\n=== NOTE ===\nResearch was cut short: ${toolTruncated} Where the experts' claims rest on something that was not verified, say so plainly rather than asserting it.`
      : '';
    const synthMsgs = [{ role: 'system', content: synthSys }, { role: 'user', content: `Question: ${truncatedPrompt}\n\nResponses:\n${validResponses.map((r,i) => `[Expert ${i+1}]: ${r.content}`).join('\n\n')}${researchBlock}${truncationBlock}` }];
    // The last thing that happens before words appear, and the longest single
    // step on a turn where the seats came back quickly.
    sendStage(res, 'synthesis', validResponses.length === 1 ? 'Writing the reply' : 'Reconciling the answers');
    openStream(res);
    const synthesisStartedAt = Date.now();
    await streamModel(res, PRIMARY_MODEL, synthMsgs, 0.0, turnSignal);
    telemetry.recordSynthesis(Date.now() - synthesisStartedAt);
    if (turnSignal.aborted) return;
    if (!res.writableEnded) res.end();
    const lastA = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
    rememberTurn(chatId, user.id, pv.value, lastA || validResponses[0]?.content?.slice(0,800) || 'Council response.');
    /* msToFirstByte on THIS path too, not only on the tools path.
     *
     * The number that says whether a latency change worked is the wait before
     * the answer starts appearing, and it was recorded only for turns that used
     * tools — the minority. Everything else reported `models` and nothing about
     * time, so the plain council, which is most turns, was unmeasurable and any
     * claim about it was a claim about a log line on somebody's laptop. `quorum`
     * and `tokenLimit` travel with it because they are the two knobs that move
     * this number; without them a shift in the median is unattributable. */
    await auditTelemetry(
      telemetryExtra.rounds !== undefined ? 'council.tools' : 'council',
      'council',
      {
        ...telemetryExtra,
        models: validResponses.length,
        seats: selection.members.length,
        quorum: selection.quorum,
        tokenLimit: selection.tokenLimit,
        councilRelease,
      },
    );
  } catch (err) {
    if (turnSignal.aborted) return;
    console.error('Council error:', err.message);
    Sentry.captureException(err);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    // The stream was already open, so a 500 is no longer available. Ending it
    // silently — which is what this used to do — leaves the client's reader to
    // hit `done` with no [DONE] and no error, and the frontend then SAVES the
    // empty accumulator as the answer. A failed turn became a blank assistant
    // message with no indication anything went wrong.
    //
    // The error text is the same one a pre-stream failure would have put in a
    // 500 body, so the client sees a failure either way.
    sendEvent(res, { type: 'error', text: err.message });
    if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
  } finally {
    cleanupDisconnect();
    /* SETTLE THE RESERVATION DOWN TO WHAT THE TURN ACTUALLY COST.
     *
     * In the `finally` and not at the end of the happy path, because every
     * other exit — an abort, a throw, a ceiling blown mid-turn — has also
     * already reserved, and a reservation that is never settled is a permanent
     * over-charge against a real user's daily balance.
     *
     * Priced from `telemetry.snapshot()`, which counts the seats asked, the
     * synthesis, the tool rounds and the fallback council. An aborted turn is
     * charged for what it managed to spend before the client left — the
     * provider calls were still made — which is why this reads the snapshot
     * rather than assuming a full turn or assuming nothing.
     *
     * NOT AWAITED, for the same reason the audit write below is not: the client
     * may already be gone and there is nobody left to wait for a round trip.
     * `.catch` because an unhandled rejection in a `finally` ends the process
     * under Node's default policy. */
    if (spendReserved > 0 && auditUserId) {
      const actual = priceTurn(telemetry.snapshot({ category: 'settle' }));
      settleSpend(auditUserId, spendReserved, actual);
    }
    /* ABANDONED TURNS ARE THE ONES THE TELEMETRY EXISTS TO MEASURE, and until
     * now they were the only ones it could not see. Every abort path returns
     * before the audit write — the `if (turnSignal.aborted) return` guards
     * throughout, and the catch as well — so a turn the user gave up on left no
     * row at all. The p90 was therefore computed over the survivors, which is
     * the one population guaranteed not to contain the problem. The owner's
     * words: a p90 that hides aborted turns is a lying metric.
     *
     * NOT AWAITED, DELIBERATELY. The client has already disconnected, so there
     * is nobody left to keep waiting; awaiting a Supabase round trip here would
     * hold the handler open past the point where its answer could matter.
     * `auditLog` swallows its own insert failures, and the `.catch` is belt and
     * braces against that changing — an unhandled rejection in a `finally`
     * takes the process down under Node's default policy.
     *
     * The action stays `council`, not a new `council.aborted`. The admin
     * console selects `.in("action", ["council.tools", "council"])` and then
     * keeps rows by `metadata.telemetry === "council_turn"`; a new action name
     * would have written rows that no report reads, which is the same
     * invisibility with more steps. The rows are told apart by the `aborted`
     * flag the snapshot already carries, and `admin-commands.js` keeps them out
     * of the duration percentiles — an abandoned turn's duration is a censored
     * observation, a lower bound on a number nobody measured, and averaging it
     * in with completed turns would make the p90 look BETTER the more people
     * gave up. It is reported as a rate instead.
     *
     * Only `turnSignal.aborted` reaches this. A 400 from `validatePrompt`, and
     * any other early return, is not an abandoned turn and still writes
     * nothing. A non-aborted 500 also still writes nothing — that is a real gap
     * and a separate one; it is in `handoff.md` rather than fixed here. */
    if (turnSignal.aborted && !turnAudited && auditUserId) {
      turnAudited = true;
      auditLog(
        auditUserId,
        'council',
        telemetry.snapshot({
          category: 'aborted',
          msToFirstByte: res.locals?.firstChunkAt ? res.locals.firstChunkAt - t0 : null,
          msToFirstProgress: res.locals?.firstByteAt ? res.locals.firstByteAt - t0 : null,
          aborted: true,
        }),
        req.ip,
      ).catch(() => {});
    }
  }
});

// ===== OVERLAY (bulletproof — never returns 500) =====
app.post('/api/overlay', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId, { cached: req.userRow });
    const { prompt, image, history = [] } = req.body;
    const pv = validatePrompt(prompt);
    if (!pv.valid) return res.status(400).json({ error: pv.error });

    // Vision: only if API key set AND image provided AND not too large
    let ctx = '';
    if (image && typeof image === 'string' && image.startsWith('data:image/') && GOOGLE_API_KEY) {
      try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        if (Buffer.byteLength(base64Data, 'base64') / (1024*1024) < 8) {
          const vm = user.plan === 'pro' ? 'gemini-2.5-pro-preview-05-06' : 'gemini-2.5-flash-preview-05-06';
          ctx = await callGeminiVision(vm, 'Describe screen concisely. Include code, text, UI, errors.', base64Data, 'image/png', 1024);
        }
      } catch (e) { console.error('[OVERLAY] Vision skipped:', e.message); }
    }

    // Single model, fast and reliable.
    //
    // This line used to be `Array.isArray(history) ? history.slice(-4) : []`,
    // spreading client-supplied objects into the message array below with no
    // check on role, content type or size — so a caller could send
    // `role: "system"` and have it land after the overlay's own system prompt.
    // Four turns is the overlay's own budget; the sanitising is shared.
    const histArr = sanitizeHistory(history, { maxMessages: 4 });
    const overlayMsgs = [
      // The overlay answers questions like any other surface, so it gets the
      // same date anchor. It was the last prompt in the app still asserting
      // time-dependent facts from recall with nothing to check them against.
      { role: 'system', content: `${todayLine()}

You are ALOP-AI Overlay. Give concise answers. For coding, provide working code. If screen description provided, use it.` },
      ...histArr,
      { role: 'user', content: ctx ? `Screen: ${ctx}\n\nQuestion: ${pv.value}` : `Question: ${pv.value}` }
    ];

    let answer = '';
    try { answer = await callModel(PRIMARY_MODEL, overlayMsgs, 0.0, 15000, 800); }
    catch (e1) {
      console.error('[OVERLAY] glm-5.2 failed:', e1.message);
      try { answer = await callModel(FAST_MODEL, overlayMsgs, 0.0, 10000, 800); }
      catch (e2) { console.error('[OVERLAY] gemma4 failed:', e2.message); answer = "I couldn't process that. Please try again."; }
    }

        console.log('[OVERLAY] Answered. Vision:', !!ctx);
    res.json({ answer: answer || "No response." });
  } catch (err) {
    console.error('Overlay error:', err.message);
    Sentry.captureException(err);
    res.json({ answer: "Something went wrong. Please try again." });
  }
});

// ===== ADMIN CONSOLE =====
//
// A diagnostics console, not a shell. There is no subprocess anywhere in it —
// see lib/admin-commands.js for why that is the design rather than a
// limitation. It takes a command ID from a closed set and never a command.
//
// Four independent conditions, all required, enforced in lib/terminal-access.js:
// a Clerk session, is_admin, membership of TERMINAL_ADMINS, and a
// TERMINAL_SECRET header. Unset variables DISABLE it rather than relaxing to
// is_admin.
const { buildCommands } = require('./lib/admin-commands');
const { checkTerminalAccess, terminalConfig } = require('./lib/terminal-access');
const adminConsole = buildCommands({ supabase });

// Its own limiter, far tighter than the admin floor. The secret is the only
// guessable credential in the chain, and 10 attempts a minute makes guessing
// it arithmetically hopeless while leaving normal use unhindered.
const terminalLimiter = createLimiter(60000, 10, 'Too many console requests.');

/**
 * Every attempt — allowed or refused — is audited BEFORE the reply.
 *
 * The response is one generic 403 whatever failed. The specific reason goes to
 * the audit log only: telling a rejected caller which of the four conditions
 * they missed hands them a map of the lock, and the difference between "not an
 * admin" and "bad secret" tells an attacker exactly how far they have got.
 */
const requireTerminal = async (req, res, next) => {
  const clerkUserId = req.auth && req.auth.userId;
  let isAdmin = false;
  let userRow = null;
  try {
    const { data } = await supabase.from('users').select('id,is_admin').eq('clerk_id', clerkUserId || '').single();
    userRow = data;
    isAdmin = Boolean(data && data.is_admin);
  } catch { /* absent user is simply not an admin */ }

  const verdict = checkTerminalAccess({ clerkUserId, isAdmin, secret: req.get('x-terminal-secret') }, process.env);
  await auditLog(userRow ? userRow.id : null, verdict.allowed ? 'terminal.access' : 'terminal.denied', {
    reason: verdict.reason,
    clerkUserId: clerkUserId || null,
    command: sanitizeString(req.body && req.body.command, 40) || null,
    userAgent: sanitizeString(req.get('user-agent'), 120) || null,
  }, req.ip);

  if (!verdict.allowed) return res.status(403).json({ error: 'Not available.' });
  req.terminalUserId = userRow ? userRow.id : null;
  next();
};

app.get('/api/admin/console', requireAuth, terminalLimiter, requireTerminal, (req, res) => {
  res.json({ commands: adminConsole.list() });
});

app.post('/api/admin/console', requireAuth, terminalLimiter, requireTerminal, async (req, res) => {
  const id = sanitizeString(req.body && req.body.command, 40);
  const out = await adminConsole.run(id);
  await auditLog(req.terminalUserId, 'terminal.run', { command: id, ok: out.ok }, req.ip);
  res.status(out.ok ? 200 : 400).json(out);
});

// ===== FILES =====
//
// Upload lives behind requireOwnership on the CHAT, so a file can only ever be
// attached to a conversation the caller already owns. That check is what makes
// fileStoreFor's (user, chat) binding meaningful — without it a caller could
// seed a file into someone else's chat for their council to read.
app.post('/api/chats/:id/files', requireAuth, checkSuspended, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { count } = await supabase.from('chat_files').select('id', { count: 'exact', head: true }).eq('chat_id', req.params.id).eq('user_id', user.id);
    if ((count || 0) >= MAX_FILES_PER_CHAT) {
      return res.status(409).json({ error: `This conversation already has ${MAX_FILES_PER_CHAT} files.` });
    }

    // Throws UploadRejected for anything not on the allowlist, anything that
    // is not actually text whatever it claims, and anything oversized.
    const prepared = prepareUpload({ name: req.body.name, mime: req.body.mime, base64: req.body.base64 });

    // The owner columns are written AFTER the spread, not before it. Today
    // prepareUpload returns a fixed six-key literal and the order makes no
    // difference; the day it returns anything derived from req.body, spread
    // last would let that value overwrite user_id and hand the row to another
    // account. Ordering is the whole defence and it costs nothing.
    const { data, error } = await supabase.from('chat_files')
      .insert({ ...prepared, user_id: user.id, chat_id: req.params.id })
      .select('id,name,kind,bytes,truncated')
      .single();
    if (error) throw error;

    await auditLog(user.id, 'file.upload', { chatId: req.params.id, name: prepared.name, kind: prepared.kind, bytes: prepared.bytes }, req.ip);
    res.json(data);
  } catch (err) {
    // A rejected upload is the caller's input, not a server fault, and the
    // message is written to be shown to them verbatim.
    if (err instanceof UploadRejected) return res.status(400).json({ error: err.message });
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:id/files', requireAuth, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    res.json(await fileStoreFor(user.id, req.params.id).list());
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.delete('/api/chats/:id/files/:fileId', requireAuth, requireOwnership('chats'), uuidParam('fileId'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { error } = await supabase.from('chat_files').delete().eq('id', req.params.fileId).eq('user_id', user.id).eq('chat_id', req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== FEEDBACK =====
// ===== CHAT TITLE =====
//
// The sidebar used to name a conversation with the first six words the user
// typed. "How do I get my", "Can you help me with", "Hi I wanted to ask" — all
// different conversations, all indistinguishable in a list a week later. That
// is the low-information-scent failure the chat-history usability work names
// directly, and it makes finding an old chat depend on recalling your own
// phrasing.
//
// DELIBERATELY ITS OWN ENDPOINT rather than a field on the council response.
// The council answer is an SSE stream, and a title is not part of an answer; it
// would need a new frame type, and it would arrive only after the whole reply
// had generated. Here the client fires this alongside the first message and
// renames when it lands.
//
// The client keeps its local six-word title as an immediate placeholder and
// only upgrades it if this succeeds, so a failure here costs nothing — which is
// why every failure path returns 200 with title: null rather than an error the
// caller has to handle.
app.post('/api/chat-title', requireAuth, checkSuspended, async (req, res) => {
  try {
    const pv = validatePrompt(req.body.message);
    if (!pv.valid) return res.json({ title: null });
    // 600 characters is more than enough to name a topic and bounds what a
    // caller can spend on a FAST_MODEL call.
    const raw = await callModel(
      FAST_MODEL,
      [{ role: 'system', content: TITLE_PROMPT }, { role: 'user', content: pv.value.slice(0, 600) }],
      0.0,
      6000,
      24,
    );
    res.json({ title: sanitizeTitle(raw) });
  } catch (err) {
    // Not Sentry-worthy and not a 500: the caller already has a usable title.
    console.error('[TITLE] Failed:', err.message);
    res.json({ title: null });
  }
});

/**
 * Read an answer out loud.
 *
 * Optional by construction: unconfigured it answers 501 and the client falls
 * back to the browser's own voice, which is why this is an upgrade rather than
 * a feature that can be down. See lib/tts.js for why the key cannot simply be
 * shipped to the browser.
 *
 * `no-store`, not a long cache: the same answer is rarely replayed, an mp3 of a
 * council answer is a user's private conversation, and any shared cache in
 * front of this must not hold one.
 */
app.post('/api/speech', requireAuth, checkSuspended, async (req, res) => {
  const text = boundText(req.body?.text);
  if (!text) return res.status(400).json({ error: 'Nothing to speak.' });
  try {
    const out = await synthesize(text);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.set('Content-Type', out.contentType);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(out.body));
  } catch (err) {
    // Not Sentry-worthy: the client has a working voice either way, and a
    // provider outage would otherwise page for something no user notices.
    console.error('[SPEECH] Failed:', err.message);
    res.status(502).json({ error: 'Speech provider failed.' });
  }
});

/* `checkSuspended` WAS MISSING HERE AND THIS ROUTE SPENDS MONEY.
 *
 * Sol's attack review, 2026-08-12. Every other paid route carries it —
 * /api/council, /api/overlay, /api/chat-title, /api/speech, the file upload —
 * and this one did not, while calling FAST_MODEL on every rating. So a
 * suspended account with a still-valid Clerk session could keep POSTing `up` /
 * `down` and keep billing the owner: suspension was not the kill switch it is
 * documented to be. The route is cheap per call and unbounded per account,
 * which is the combination that matters.
 *
 * Ordered immediately after `requireAuth` because it needs `req.auth`. */
app.post('/api/feedback', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { feedback, question, answer } = req.body;
    if (!feedback || !['up','down'].includes(feedback)) return res.status(400).json({ error: 'Invalid feedback' });
    await auditLog(user.id, 'feedback', { feedback, question: question?.slice(0,500), answer: answer?.slice(0,500) }, req.ip);
    // One row per rating in its own table. These notes used to be appended onto
    // users.conversation_summary, so every thumbs-up ate into the same 2000
    // characters the conversation memory needed and eventually destroyed both.
    try {
      const note = await callModel(FAST_MODEL, [
        { role: 'system', content: feedback === 'down' ? 'User disliked this answer. Create a 1-sentence note about what to avoid. Reply ONLY with the note.' : 'User liked this answer. Create a 1-sentence note about what worked. Reply ONLY with the note.' },
        { role: 'user', content: `Q: ${question?.slice(0,300)}\nA: ${answer?.slice(0,300)}` }
      ], 0.0, 3000, 100);
      if (note.trim()) {
        const { error: noteErr } = await supabase.from('feedback_notes').insert({ user_id: user.id, kind: feedback, note: note.trim().slice(0, 300) });
        if (noteErr) console.error(`[LEARN] Save failed (has 001_per_chat_memory.sql been run?):`, noteErr.message);
        else console.log(`[LEARN] ${feedback} feedback saved.`);
      }
    } catch (e) { console.error('[LEARN] Failed:', e.message); }
    res.json({ ok: true });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== CHATS =====
// THE LIST DOES NOT CARRY MESSAGES, and that is the single largest payload
// change in this file.
//
// It used to select `messages` for EVERY chat the user owns, on every app load,
// to render a sidebar that displays a title and a date. A user with 50
// conversations of 20 messages was downloading several megabytes of JSON to
// draw 50 rows of text, over a connection that had just paid a cold start —
// and then the client threw all but one conversation's messages away.
//
// Messages now come from GET /api/chats/:id, one conversation at a time, when
// one is actually opened. `limit` and `offset` bound the list itself, because
// "select every row belonging to this user" has no ceiling and the sidebar can
// only show so many.
const MAX_CHAT_OFFSET = 10000;

/**
 * Write messages without allowing an old browser to replace a newer transcript.
 *
 * The current frontend sends `expectedUpdatedAt`, which turns a full-transcript
 * PUT into compare-and-set: the update happens only if the row still has the
 * version the browser read. Two tabs, a delayed request, and a cached bundle
 * can therefore fail loudly instead of one silently erasing the other tab.
 *
 * Older bundles do not send that token. They get a compatibility path that
 * reads the current row, merges only genuinely new message ids, and updates
 * with the row's timestamp as a compare-and-set predicate. The read/merge/write
 * loop may retry after a race, but it never falls back to an unconditional
 * replacement. That is the server-side guard the client cannot provide.
 */
const writeChatMessages = async (chatId, userId, payload, expectedUpdatedAt) => {
  const hasExpected = expectedUpdatedAt !== undefined && expectedUpdatedAt !== null;
  if (hasExpected && (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.length > 100)) {
    return { error: 'Invalid expectedUpdatedAt' };
  }

  if (hasExpected) {
    const { data, error } = await supabase
      .from('chats')
      .update(payload)
      .eq('id', chatId)
      .eq('user_id', userId)
      .eq('updated_at', expectedUpdatedAt)
      .select('updated_at')
      .maybeSingle();
    if (error) throw error;
    return data ? { updated_at: data.updated_at } : { conflict: true };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from('chats')
      .select('messages,updated_at')
      .eq('id', chatId)
      .eq('user_id', userId)
      .single();
    if (readError) throw readError;

    const merged = mergeMessages(current?.messages, payload.messages);
    if (merged.error) return merged;

    const nextPayload = { ...payload, messages: merged.messages, updated_at: new Date().toISOString() };
    let update = supabase
      .from('chats')
      .update(nextPayload)
      .eq('id', chatId)
      .eq('user_id', userId);
    // `.eq('updated_at', null)` is not SQL NULL semantics. Use `.is` for old
    // rows that predate a timestamp, otherwise the first compatibility write
    // would be rejected forever even though it is safe to perform.
    update = current?.updated_at ? update.eq('updated_at', current.updated_at) : update.is('updated_at', null);
    const { data, error } = await update.select('updated_at').maybeSingle();
    if (error) throw error;
    if (data) return { updated_at: data.updated_at };
  }

  return { conflict: true };
};

app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    // Clamped rather than trusted. A caller asking for 100000 gets 100.
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
    // A huge offset still makes Postgres walk and discard a huge number of
    // rows. Keep pagination bounded even when the caller is not using the
    // frontend, because this route is public to every signed-in client.
    const parsedOffset = Number.parseInt(req.query.offset, 10);
    const offset = Number.isFinite(parsedOffset)
      ? Math.min(Math.max(parsedOffset, 0), MAX_CHAT_OFFSET)
      : 0;
    const { data, error } = await supabase
      .from('chats')
      .select('id,user_id,title,pinned,favorite,created_at,updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    // `hasMore` rather than a total count: a count is a second query over the
    // same rows, and the only question the sidebar asks is whether to fetch
    // another page.
    res.json({ chats: data || [], hasMore: (data || []).length === limit && offset + limit <= MAX_CHAT_OFFSET, limit, offset });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// One conversation, with its messages. requireOwnership re-checks the row
// belongs to the caller before the handler runs, so this cannot become a way to
// read someone else's transcript by guessing a UUID.
app.get('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { data, error } = await supabase
      .from('chats')
      .select('id,user_id,title,messages,pinned,favorite,created_at,updated_at')
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});
app.post('/api/chats', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); const title = sanitizeString(req.body.title, 120) || 'New Chat'; const { data, error } = await supabase.from('chats').insert({ user_id: user.id, title, messages: [] }).select().single(); if (error) throw error; res.json(data); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.put('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { payload, error: buildErr } = buildChatUpdate(req.body);
    if (buildErr) return res.status(400).json({ error: buildErr });
    if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'No updatable fields' });

    if (payload.messages !== undefined) {
      const result = await writeChatMessages(req.params.id, user.id, payload, req.body?.expectedUpdatedAt);
      if (result.error) return res.status(400).json({ error: result.error });
      if (result.conflict) return res.status(409).json({ error: 'Chat changed elsewhere. Reload before saving.' });
      return res.json({ ok: true, updated_at: result.updated_at || payload.updated_at });
    }

    const { error } = await supabase.from('chats').update(payload).eq('id', req.params.id).eq('user_id', user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => { try { const user = await ensureUser(req.auth.userId); const { error } = await supabase.from('chats').delete().eq('id', req.params.id).eq('user_id', user.id); if (error) throw error; res.json({ deleted: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

// ===== ADMIN =====
const MAX_ADMIN_PAGE_OFFSET = 10000;
const ADMIN_PAGE_DEFAULT_LIMIT = 50;
const ADMIN_PAGE_MAX_LIMIT = 100;

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => { try {
  const page = boundedPage(req.query, {
    defaultLimit: ADMIN_PAGE_DEFAULT_LIMIT,
    maxLimit: ADMIN_PAGE_MAX_LIMIT,
    maxOffset: MAX_ADMIN_PAGE_OFFSET,
  });
  // Order by the primary key rather than inventing a created_at index without
  // checking production first. The order is deterministic enough for the
  // admin screen, and users_pkey already serves the scan.
  const { data, error } = await supabase
    .from('users')
    .select('id,clerk_id,email,name,avatar_url,plan,is_admin,suspended,created_at,stripe_subscription_id')
    .order('id', { ascending: true })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw error;
  const users = data || [];
  res.json({ users, ...pageInfo(users, page, MAX_ADMIN_PAGE_OFFSET) });
} catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
// Admin routes take a Supabase users.id in :id. Validating the shape keeps a
// malformed value from reaching Postgres and coming back as a 500 that reads
// like a server fault. requireOwnership already does this for user routes; the
// admin routes did not.
// (uuidParam is defined above, next to the other route guards.)

app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, uuidParam(), async (req, res) => { try { const { data: t } = await supabase.from('users').select('is_admin,email').eq('id', req.params.id).single(); if (!t) return res.status(404).json({ error: 'Not found' }); if (t.is_admin) return res.status(403).json({ error: 'Cannot suspend admin' }); const { error } = await supabase.from('users').update({ suspended: true }).eq('id', req.params.id); if (error) throw error; invalidateUserRows(); await auditLog(req.adminUserId, 'admin.suspend', { target: req.params.id, targetEmail: t.email }, req.ip); res.json({ suspended: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

app.post('/api/admin/users/:id/unsuspend', requireAuth, requireAdmin, uuidParam(), async (req, res) => { try { const { error } = await supabase.from('users').update({ suspended: false }).eq('id', req.params.id); if (error) throw error; invalidateUserRows(); await auditLog(req.adminUserId, 'admin.unsuspend', { target: req.params.id }, req.ip); res.json({ unsuspended: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, uuidParam(), async (req, res) => { try {
  // The old self-delete guard compared req.auth.userId (a Clerk id, "user_2ab…")
  // against req.params.id (a Supabase uuid). Those are different id spaces and
  // can never be equal, so the check never fired once. It was masked by the
  // is_admin check below — an admin deleting themselves was refused as "an
  // admin", which is the right outcome reached by the wrong route. Compare the
  // ids that are actually comparable.
  if (req.adminUserId === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const { data: t } = await supabase.from('users').select('is_admin,email').eq('id', req.params.id).single();
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.is_admin) return res.status(403).json({ error: 'Cannot delete admin' });
  const { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) throw error;
  // A cached row for a deleted user would let their next request through
  // checkSuspended as though the account still existed.
  invalidateUserRows();
  // Written after the delete succeeds and before the reply, so a 200 always has
  // a matching audit row. audit_logs.user_id is ON DELETE SET NULL, so deleting
  // a user cannot take the record of their deletion with them.
  await auditLog(req.adminUserId, 'admin.delete_user', { target: req.params.id, targetEmail: t.email }, req.ip);
  res.json({ deleted: true });
} catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/admin/chats/:userId', requireAuth, requireAdmin, uuidParam('userId'), async (req, res) => { try {
  const page = boundedPage(req.query, {
    defaultLimit: ADMIN_PAGE_DEFAULT_LIMIT,
    maxLimit: ADMIN_PAGE_MAX_LIMIT,
    maxOffset: MAX_ADMIN_PAGE_OFFSET,
  });
  // Admin diagnostics only need chat metadata. `select('*')` also returned the
  // complete messages JSON for every row, turning an unbounded list into a
  // potentially enormous transcript export. The user-facing transcript route
  // remains separate and lazy-loads one owned conversation at a time.
  const { data, error } = await supabase
    .from('chats')
    .select('id,user_id,title,pinned,favorite,created_at,updated_at')
    .eq('user_id', req.params.userId)
    .order('updated_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw error;
  const chats = data || [];
  res.json({ chats, ...pageInfo(chats, page, MAX_ADMIN_PAGE_OFFSET) });
} catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/admin/usage/:userId', requireAuth, requireAdmin, async (req, res) => { try { const { data, error } = await supabase.from('usage').select('*').eq('user_id', req.params.userId).order('date', { ascending: false }).limit(30); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

// ===== STRIPE =====

// Prices are read from Stripe rather than hardcoded in the frontend, so what
// the paywall advertises can never drift from what the customer is actually
// charged. Cached because prices change rarely and this sits on the page-load
// path for every free user.
let priceCache = null;
const PRICE_CACHE_MS = 60 * 60 * 1000;

app.get('/api/billing/prices', requireStripe, requireAuth, async (req, res) => {
  try {
    if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_MS) return res.json(priceCache.data);

    const ids = { monthly: process.env.STRIPE_PRICE_MONTHLY, yearly: process.env.STRIPE_PRICE_YEARLY };
    const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
    // 503 rather than 500: the server is healthy, this deployment simply cannot
    // sell anything. The client hides the upgrade path instead of rendering a
    // paywall that would fail at checkout.
    if (missing.length) return res.status(503).json({ error: `Pricing is not configured (missing: ${missing.join(', ')}).` });

    const [monthly, yearly] = await Promise.all([
      stripe.prices.retrieve(ids.monthly),
      stripe.prices.retrieve(ids.yearly),
    ]);
    const shape = (p) => ({ amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval || null });
    const data = { monthly: shape(monthly), yearly: shape(yearly) };

    priceCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    // A rejected price ID is a configuration problem, not a server fault, so it
    // gets the same 503 treatment and the same graceful hiding on the client.
    console.error('[BILLING] Price lookup failed:', err.message);
    Sentry.captureException(err);
    res.status(503).json({ error: 'Pricing is temporarily unavailable.' });
  }
});

app.post('/api/create-checkout-session', requireStripe, requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); const cu = await clerkClient.users.getUser(req.auth.userId); const email = cu?.emailAddresses?.[0]?.emailAddress; const priceId = req.body.plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY; if (!priceId) throw new Error('Price ID not configured'); const session = await stripe.checkout.sessions.create({ customer_email: user.stripe_customer_id ? undefined : email, customer: user.stripe_customer_id || undefined, line_items: [{ price: priceId, quantity: 1 }], mode: 'subscription', success_url: `${process.env.FRONTEND_URL}/?payment=success`, cancel_url: `${process.env.FRONTEND_URL}/?payment=cancelled`, metadata: { userId: req.auth.userId } }); res.json({ url: session.url }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.post('/api/create-portal-session', requireStripe, requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); if (!user.stripe_customer_id) return res.status(400).json({ error: 'No subscription' }); const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${process.env.FRONTEND_URL}/` }); res.json({ url: session.url }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/user/plan', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); res.json({ plan: user.plan || 'free', subscription_id: user.stripe_subscription_id }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

/* The user's own memory, readable and deletable by them.
 *
 * Not optional polish. This stores statements about a person, derived by a
 * model, and replays them into every later conversation. Memory a user can
 * neither see nor delete is a product that says things about them behind a
 * door they cannot open — and the wrong fact is self-reinforcing, because it
 * conditions the answers that produce the next fact.
 *
 * Both queries carry .eq('user_id', user.id). The service-role key bypasses
 * RLS, so that filter is the entire ownership check — see AGENTS.md. */
app.get('/api/user/facts', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId, { cached: req.userRow });
    const { data, error } = await supabase
      .from('user_facts')
      .select('id,fact,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ facts: data || [] });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.delete('/api/user/facts/:id', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId, { cached: req.userRow });
    // Scoped by BOTH id and user_id. Filtering on the id alone would let any
    // authenticated account delete any other account's memory — the same shape
    // as the cross-tenant write updateChatSummary documents.
    const { data, error } = await supabase
      .from('user_facts')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .select('id');
    if (error) throw error;
    // Nothing deleted means it was not theirs or never existed. Same answer for
    // both, so this cannot be used to ask whether an id exists.
    if (!data || !data.length) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: data[0].id });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.delete('/api/user/facts', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId, { cached: req.userRow });
    const { data, error } = await supabase.from('user_facts').delete().eq('user_id', user.id).select('id');
    if (error) throw error;
    res.json({ deleted: (data || []).length });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== ERRORS =====
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
Sentry.setupExpressErrorHandler(app);
app.use((err, req, res, next) => {
  const isCors = Boolean(err.message && err.message.includes('CORS'));
  const status = isCors ? 403 : (err.status || err.statusCode || 500);
  // 4xx is expected traffic (expired tokens, bad input) — paging on it buries real faults.
  if (status >= 500) Sentry.captureException(err);
  // Only mask 5xx: a 4xx reason is the client's own and is safe to return.
  const masked = status >= 500 && process.env.NODE_ENV === 'production';
  res.status(status).json({ error: masked ? 'Internal server error' : err.message });
});

// ===== START =====
const server = app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  ALOP-AI PRECISION BACKEND                  ║`);
  console.log(`║  Port: ${PORT} | Council: ${COUNCIL.length} pro / ${FREE_COUNCIL.length} free      ║`);
  console.log(`║  T=${TAVILY_API_KEY?'ON':'OFF'} B=${BRAVE_API_KEY?'ON':'OFF'} G=${GOOGLE_SEARCH_API_KEY&&GOOGLE_CSE_ID?'ON':'OFF'} J=${JINA_API_KEY?'ON':'OFF'} P=${PERPLEXITY_API_KEY?'ON':'OFF'} S=${SERPER_API_KEY?'ON':'OFF'} SA=${SERPAPI_API_KEY?'ON':'OFF'} FC=${FIRECRAWL_API_KEY?'ON':'OFF'} Wiki=ON  ║`);
  console.log(`║  Memory: Supabase | Quick + Feedback        ║`);
  console.log(`╚════════════════════════════════════════════╝`);
  // Printed unconditionally, including when it is off. A feature flag that is
  // silent when disabled is indistinguishable from one that is enabled and
  // broken — which is exactly the half hour this cost: COUNCIL_TOOLS=shadow was
  // set correctly, the probe was in unreachable code, and nothing on either
  // side of the boot said so.
  console.log(`[BOOT] COUNCIL_TOOLS=${process.env.COUNCIL_TOOLS || '(unset)'} -> tools ${TOOLS_ENABLED ? 'LIVE' : TOOLS_SHADOW ? 'SHADOW (probe only, answers unchanged)' : 'OFF'}`);
  // Same reasoning as the line above: a store that is silently per-process is
  // indistinguishable from a shared one until the limits are already wrong.
  console.log(`[BOOT] RATE_LIMIT_STORE=${process.env.RATE_LIMIT_STORE || '(unset)'} -> ${USE_PG_RATE_LIMIT ? 'postgres, shared across instances' : 'in-memory, PER PROCESS — set RATE_LIMIT_STORE=postgres before scaling past one instance'}`);
  // Third flag, same rule. The console being disabled is the SAFE state, so it
  // says so plainly rather than staying quiet and looking like it works.
  const tc = terminalConfig();
  console.log(`[BOOT] admin console -> ${tc.enabled ? `ENABLED for ${tc.admins.length} allowlisted admin(s)` : `disabled (${tc.reason})`}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
