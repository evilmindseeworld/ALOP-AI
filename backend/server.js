/**
 * ALOP-AI ULTIMATE PRECISION BACKEND
 *
 * MEMORY SYSTEM: Compressed conversation cache (2-3 sentence summary per chat)
 * - After each exchange, gemma4 compresses conversation into a running summary
 * - On next message: summary + last 10 raw messages + search data (if needed)
 * - Memory/reference questions skip search entirely (instant response)
 * - User can ask for details → history has the raw messages
 *
 * SPEED: Search result cache (5min TTL), reduced timeouts, 1 Jina page
 *
 * 5 Data Sources: Tavily, Brave, Google, Jina Reader, Wikipedia
 * Anti-Hallucination: Temperature 0.0, 12 extraction rules
 */

const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

Sentry.init({
  dsn: "https://83e051994bba3e7ae40145510653a0b6@o4511779597647872.ingest.de.sentry.io/4511779863330896",
  integrations: [Sentry.httpIntegration(), Sentry.expressIntegration(), nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const timeout = require('connect-timeout');
const multer = require('multer');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { ClerkExpressRequireAuth, clerkClient } = require('@clerk/clerk-sdk-node');
const Stripe = require('stripe');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ===== ENV VALIDATION =====
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'FRONTEND_URL', 'OLLAMA_HOST', 'OLLAMA_API_KEY'];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length > 0) { console.error(`Missing: ${missingEnv.join(', ')}`); process.exit(1); }

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || null;
const JINA_API_KEY = process.env.JINA_API_KEY || null;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || null;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || null;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY || null;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || null;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const OLLAMA_HOST = process.env.OLLAMA_HOST;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// ===== MODEL ROSTER =====
const FREE_COUNCIL_MODELS = ['gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.5'];
const ALL_MODELS = ['gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.5', 'minimax-m2.5', 'kimi-k2.7-code', 'deepseek-v4-pro', 'kimi-k2.6', 'glm-5.1', 'minimax-m3', 'minimax-m2.7', 'nemotron-3-super', 'nemotron-3-ultra'];
const OVERLAY_MODELS = ['deepseek-v4-pro', 'glm-5.2', 'kimi-k2.7-code'];

// ===== CONVERSATION CACHE (compressed inner memory per chat) =====
const conversationCache = new Map();
const MAX_CONV_CACHE = 200;

const getConversationCache = (chatId) => {
  if (!chatId) return null;
  if (!conversationCache.has(chatId)) {
    if (conversationCache.size >= MAX_CONV_CACHE) { const k = conversationCache.keys().next().value; conversationCache.delete(k); }
    conversationCache.set(chatId, { summary: '', turnCount: 0, lastUpdated: Date.now() });
  }
  return conversationCache.get(chatId);
};

const updateConversationSummary = async (chatId, userMsg, assistantMsg) => {
  const cache = getConversationCache(chatId);
  if (!cache) return;
  const u = userMsg.slice(0, 800);
  const a = assistantMsg.slice(0, 800);
  try {
    if (cache.summary) {
      const c = await callModel('gemma4', [
        { role: 'system', content: 'Compress the previous summary and new exchange into a concise 2-3 sentence summary. Capture key facts, user preferences, decisions, and context. Reply ONLY with the summary.' },
        { role: 'user', content: `Previous summary:\n${cache.summary}\n\nNew exchange:\nUser: ${u}\nAssistant: ${a}` }
      ], 0.0, 4000, 200);
      if (c.trim()) cache.summary = c.trim();
    } else {
      const s = await callModel('gemma4', [
        { role: 'system', content: 'Summarize this exchange in 1-2 sentences. Capture key context, facts, and user intent. Reply ONLY with the summary.' },
        { role: 'user', content: `User: ${u}\nAssistant: ${a}` }
      ], 0.0, 4000, 150);
      if (s.trim()) cache.summary = s.trim();
    }
    cache.turnCount++; cache.lastUpdated = Date.now();
  } catch (e) { console.error('[CACHE] Summary failed:', e.message); }
};

// ===== SEARCH RESULT CACHE (5 min TTL) =====
const searchCache = new Map();
const SEARCH_CACHE_TTL = 300000;

const getCachedSearch = (q) => {
  const c = searchCache.get(q);
  if (c && (Date.now() - c.timestamp) < SEARCH_CACHE_TTL) { console.log(`[CACHE] Search hit: "${q}"`); return c.data; }
  if (c) searchCache.delete(q);
  return null;
};

const setCachedSearch = (q, d) => {
  if (searchCache.size >= 50) { const k = searchCache.keys().next().value; searchCache.delete(k); }
  searchCache.set(q, { data: d, timestamp: Date.now() });
};

// ===== AI HELPERS =====
const callModel = async (modelName, messages, temperature = 0.0, timeoutMs = 30000, maxTokens = 1000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OLLAMA_HOST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` }, body: JSON.stringify({ model: modelName, messages, stream: false, options: { temperature, num_predict: maxTokens } }), signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) { const t = await res.text(); throw new Error(`Model ${modelName}: ${res.status} ${t.slice(0, 200)}`); }
    const data = await res.json();
    return data.message?.content || data.response || '';
  } catch (err) { clearTimeout(timer); if (err.name === 'AbortError') return ''; throw err; }
};

const streamModel = async (res, modelName, messages, temperature = 0.0) => {
  const response = await fetch(OLLAMA_HOST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` }, body: JSON.stringify({ model: modelName, messages, stream: true, options: { temperature } }) });
  if (!response.ok || !response.body) throw new Error('Stream failed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) { const t = line.trim(); if (!t) continue; try { const p = JSON.parse(t); const d = p.message?.content || p.response || ''; if (d) res.write(`data: ${JSON.stringify({ type: 'chunk', text: d })}\n\n`); if (p.done) res.write('data: [DONE]\n\n'); } catch {} }
  }
};

const callGemini = async (modelName, prompt, maxTokens = 1024) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens } }) });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini: ${res.status} ${t.slice(0, 300)}`); }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

const callGeminiVision = async (modelName, prompt, base64Image, mimeType = 'image/png', maxTokens = 2048) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  if (Buffer.byteLength(base64Image, 'base64') / (1024 * 1024) > 8) throw new Error('Image too large. Max 8MB.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }], generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens } }) });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini: ${res.status} ${t.slice(0, 300)}`); }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

// ===== DYNAMIC COUNCIL QUORUM =====
const runCouncilWithWhip = async (models, messages, temperature, whipMs, quorum, tokenLimit) => {
  const results = [];
  let settledCount = 0, validCount = 0, resolved = false;
  return new Promise((resolve) => {
    const whipTimer = setTimeout(() => { if (!resolved) { resolved = true; resolve(results); } }, whipMs);
    const checkDone = () => {
      if (resolved) return;
      if (validCount >= quorum) { resolved = true; clearTimeout(whipTimer); resolve(results); return; }
      if (settledCount >= models.length) { resolved = true; clearTimeout(whipTimer); resolve(results); }
    };
    models.forEach((model) => {
      callModel(model, messages, temperature, whipMs, tokenLimit)
        .then((content) => { settledCount++; if (content?.trim().toUpperCase().includes('SKIP')) { console.log(`[COUNCIL] ${model} SKIP`); } else if (content?.trim().length > 3) { validCount++; results.push({ model, content }); } checkDone(); })
        .catch(() => { settledCount++; checkDone(); });
    });
  });
};

// ===== DYNAMIC ROUTER =====
const classifyRequest = (text, userPlan) => {
  const lower = text.toLowerCase().trim();
  const wordCount = text.split(/\s+/).length;
  const filterByPlan = (models) => { if (userPlan === 'pro') return models; const freeSet = new Set(FREE_COUNCIL_MODELS); const filtered = models.filter(m => freeSet.has(m)); return filtered.length > 0 ? filtered : FREE_COUNCIL_MODELS; };
  if (wordCount <= 4 && /hi|hello|hey|yo|sup|howdy|gm|good morning/i.test(lower)) return { models: filterByPlan(['gemma4']), quorum: 1, whipMs: 5000, tokenLimit: 200, category: 'greeting' };
  return { models: filterByPlan(ALL_MODELS), quorum: 3, whipMs: 30000, tokenLimit: 2000, category: 'council' };
};

// ===== MEMORY/REFERENCE QUESTION DETECTOR =====
const isMemoryOrReferenceQuestion = (text) => {
  const lower = text.toLowerCase();
  const triggers = ['do you remember', 'remember', 'you said', 'you mentioned', 'earlier', 'previous', 'last conversation', 'last chat', 'what did we', 'what were we', 'continue', 'pick up where', 'as you said', 'like you said', 'what about the', 'how about that', 'what else', 'tell me more about that', 'go deeper on', 'what did you mean', 'i meant', 'i was asking about', 'can you recall', 'we were talking about', 'you told me'];
  return triggers.some(t => lower.includes(t));
};

// ===== AUTONOMOUS SEARCH DECISION =====
const getSearchQuery = async (text) => {
  const response = await callModel('gemma4', [
    { role: 'system', content: 'Analyze the user prompt. If it requires real-time internet search to answer accurately (e.g., current events, product links, specific facts, reviews, specs, prices, images), reply ONLY with the optimal search query string. If it does not require search, reply ONLY with "NO". Questions about previous conversations, references to earlier messages, or requests to continue a topic do NOT require search — reply "NO" for those.' },
    { role: 'user', content: text }
  ], 0.0, 4000, 50);
  const trimmed = response.trim();
  if (trimmed.toUpperCase() === 'NO' || !trimmed) return null;
  return trimmed;
};

// ===== CLASSIFIERS =====
const wantsDetailedAnswer = (text) => ['explain in detail', 'detailed', 'in depth', 'comprehensive', 'thorough', 'step by step', 'deep dive', 'elaborate', 'full explanation'].some(t => text.toLowerCase().includes(t));
const needsWikiCheck = (text) => /what is|who is|history|explain|definition|meaning of|tell me about|biography|born|origin/i.test(text);

// ===== SEARCH: BRAVE =====
const searchBrave = async (query) => {
  if (!BRAVE_API_KEY) return [];
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query.slice(0, 200))}&count=10`, { method: 'GET', headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map(r => ({ title: r.title?.slice(0, 200) || '', url: r.url, description: r.description?.slice(0, 500) || '' }));
  } catch { return []; }
};

// ===== SEARCH: TAVILY =====
const searchTavily = async (query) => {
  if (!TAVILY_API_KEY) return { answer: '', results: [], images: [] };
  try {
    const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query.slice(0, 400), search_depth: 'advanced', include_answer: true, include_raw_content: false, include_images: true, include_image_descriptions: true, max_results: 5 }), signal: AbortSignal.timeout(7000) });
    if (!res.ok) return { answer: '', results: [], images: [] };
    const data = await res.json();
    return { answer: data.answer || '', results: (data.results || []).map(r => ({ title: r.title?.slice(0, 200) || '', url: r.url, content: (r.content || '').slice(0, 3000) })), images: (data.images || []).map(img => typeof img === 'string' ? img : (img.url || img)) };
  } catch { return { answer: '', results: [], images: [] }; }
};

// ===== SEARCH: GOOGLE WEB =====
const searchGoogleWeb = async (query) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  try {
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0, 200))}&num=10`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(r => ({ title: r.title?.slice(0, 200) || '', url: r.link, description: (r.snippet || '').slice(0, 500) }));
  } catch { return []; }
};

// ===== SEARCH: GOOGLE IMAGES =====
const searchGoogleImages = async (query) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  try {
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0, 200))}&searchType=image&num=5`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(r => ({ url: r.link, title: r.title?.slice(0, 200) || '', context: r.image?.contextLink || '' }));
  } catch { return []; }
};

// ===== SEARCH: JINA READER =====
const readPageContent = async (url) => {
  try {
    const headers = { 'Accept': 'text/markdown' };
    if (JINA_API_KEY) headers['Authorization'] = `Bearer ${JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { method: 'GET', headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return '';
    return (await res.text()).slice(0, 3000);
  } catch { return ''; }
};

// ===== SEARCH: WIKIPEDIA =====
const searchWikipedia = async (query) => {
  try {
    const searchRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query.slice(0, 100))}&format=json&origin=*`, { signal: AbortSignal.timeout(6000) });
    if (!searchRes.ok) return '';
    const searchData = await searchRes.json();
    const titles = (searchData.query?.search || []).slice(0, 2).map(s => s.title);
    if (titles.length === 0) return '';
    const extractRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`, { signal: AbortSignal.timeout(6000) });
    if (!extractRes.ok) return '';
    const extractData = await extractRes.json();
    const pages = extractData.query?.pages || {};
    return Object.values(pages).map(p => p.extract || '').filter(e => e.length > 100).join('\n\n').slice(0, 5000);
  } catch { return ''; }
};

// ===== COMPREHENSIVE SEARCH =====
const comprehensiveSearch = async (query, needsWiki) => {
  console.log(`[SEARCH] "${query}" | Wiki: ${needsWiki}`);
  const cached = getCachedSearch(query);
  if (cached) return cached;

  const [tavilyResult, braveResults, googleResults, googleImages, wikiContent] = await Promise.all([
    searchTavily(query), searchBrave(query), searchGoogleWeb(query), searchGoogleImages(query),
    needsWiki ? searchWikipedia(query) : Promise.resolve('')
  ]);

  const tavilyData = Array.isArray(tavilyResult) ? { answer: '', results: [], images: [] } : tavilyResult;
  const sources = [], allImages = [];
  let ctx = '';

  if (tavilyData.answer) ctx += `TAVILY AI ANSWER: ${tavilyData.answer}\n\n---\n\n`;
  if (tavilyData.results?.length > 0) {
    ctx += `TAVILY RESULTS:\n${tavilyData.results.map((r, i) => `SOURCE ${i + 1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join('\n\n---\n\n')}\n\n---\n\n`;
    tavilyData.results.forEach(r => sources.push({ title: r.title, url: r.url }));
  }
  if (tavilyData.images?.length > 0) allImages.push(...tavilyData.images.filter(u => u && u.startsWith('http')));
  if (braveResults.length > 0) {
    ctx += `BRAVE RESULTS:\n${braveResults.map((r, i) => `SOURCE ${i + 1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.description}`).join('\n\n---\n\n')}\n\n---\n\n`;
    braveResults.forEach(r => { if (!sources.find(s => s.url === r.url)) sources.push({ title: r.title, url: r.url }); });
  }
  if (googleResults.length > 0) {
    ctx += `GOOGLE RESULTS:\n${googleResults.map((r, i) => `SOURCE ${i + 1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.description}`).join('\n\n---\n\n')}\n\n---\n\n`;
    googleResults.forEach(r => { if (!sources.find(s => s.url === r.url)) sources.push({ title: r.title, url: r.url }); });
  }
  if (googleImages.length > 0) allImages.push(...googleImages.map(img => img.url).filter(u => u && u.startsWith('http')));
  if (wikiContent) ctx += `WIKIPEDIA:\n${wikiContent}\n\n---\n\n`;

  // Deep read top 1 page (speed optimization)
  const topUrls = sources.slice(0, 1);
  if (topUrls.length > 0) {
    console.log(`[SEARCH] Deep reading 1 page via Jina...`);
    const pageContent = await readPageContent(topUrls[0].url);
    if (pageContent.length > 200) ctx += `FULL PAGE CONTENT (${topUrls[0].url}):\n${pageContent}\n\n---\n\n`;
  }

  if (allImages.length > 0) {
    const unique = [...new Set(allImages)].slice(0, 5);
    ctx += `IMAGES:\n${unique.map((url, i) => `IMAGE ${i + 1}: ${url}`).join('\n')}\n\n---\n\n`;
  }

  const found = sources.length > 0 || !!wikiContent || !!tavilyData.answer;
  console.log(`[SEARCH] Found: ${found} | Sources: ${sources.length} | Images: ${allImages.length} | ${ctx.length} chars`);
  const result = { context: ctx.trim(), sources, found, images: allImages };
  setCachedSearch(query, result);
  return result;
};

// ===== MIDDLEWARE =====
const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
app.use(cors({ origin: (origin, cb) => { if (!origin) return cb(null, true); const l = origin.toLowerCase(); if (allowedOrigins.map(o => o.toLowerCase()).includes(l)) return cb(null, true); if (process.env.NODE_ENV === 'development') return cb(null, true); if (l.includes('.vercel.app')) return cb(null, true); cb(new Error(`CORS: ${origin}`)); }, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'], maxAge: 86400 }));

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'", process.env.FRONTEND_URL, 'https://*.clerk.com', 'https://*.stripe.com'], scriptSrc: ["'self'", "'unsafe-inline'", 'https://*.clerk.com'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://image.pollinations.ai'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], frameAncestors: ["'none'"], formAction: ["'self'", 'https://*.stripe.com'], upgradeInsecureRequests: [] } }, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }, referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, xContentTypeOptions: true, xFrameOptions: 'DENY', xPermittedCrossDomainPolicies: 'none' }));

app.use((req, res, next) => { req.requestId = crypto.randomUUID(); req.clientFingerprint = crypto.createHash('sha256').update(req.ip + (req.headers['user-agent'] || '')).digest('hex').slice(0, 16); next(); });

// ===== STRIPE WEBHOOK =====
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing signature');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { Sentry.captureException(err); return res.status(400).send(`Webhook Error: ${err.message}`); }
  try {
    if (event.type === 'checkout.session.completed') { const session = event.data.object; const email = session.customer_email || session.customer_details?.email; if (email) await supabase.from('users').update({ plan: 'pro', stripe_customer_id: session.customer, stripe_subscription_id: session.subscription }).eq('email', email.toLowerCase()); }
    if (event.type === 'invoice.paid') await supabase.from('users').update({ plan: 'pro' }).eq('stripe_customer_id', event.data.object.customer);
    if (['customer.subscription.deleted', 'customer.subscription.updated'].includes(event.type)) { const sub = event.data.object; await supabase.from('users').update({ plan: sub.status === 'active' ? 'pro' : 'free' }).eq('stripe_subscription_id', sub.id); }
    res.json({ received: true });
  } catch (err) { Sentry.captureException(err); res.status(500).send('Webhook failed'); }
});

app.use(compression());
app.use(timeout('300s'));
app.use((req, res, next) => { if (req.timedout) return res.status(503).json({ error: 'Timeout' }); next(); });

// ===== RATE LIMITING =====
const rlKey = (req, res) => { if (req.auth?.userId) return req.auth.userId; if (req.clientFingerprint) return req.clientFingerprint; return rateLimit.ipKeyGenerator(req, res); };
const createLimiter = (windowMs, max, msg) => rateLimit({ windowMs, max, message: { error: msg }, standardHeaders: true, legacyHeaders: false, keyGenerator: (req, res) => rlKey(req, res), skip: (req) => req.path === '/health' || req.path === '/api/stripe/webhook', handler: (req, res) => { Sentry.captureMessage(`Rate limit: ${req.method} ${req.path}`); res.status(429).json({ error: msg }); } });

app.use('/api/', createLimiter(60000, 120, 'Too many requests.'));
app.use('/api/council', createLimiter(60000, 30, 'Too many council requests.'));
app.use('/api/vision', createLimiter(60000, 10, 'Too many vision requests.'));
app.use('/api/overlay', createLimiter(60000, 30, 'Too many overlay requests.'));
app.use('/api/image', createLimiter(60000, 10, 'Too many image requests.'));
app.use('/api/create-checkout-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/create-portal-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/admin/', createLimiter(60000, 60, 'Too many admin requests.'));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ===== INPUT SANITIZATION =====
const MAX_PROMPT = 100000, MAX_HISTORY = 20, ALLOWED_ROLES = ['user', 'assistant', 'system'];
const sanitizeString = (str, max = 200) => typeof str === 'string' ? str.trim().slice(0, max) : '';
const truncatePrompt = (text, maxChars = 90000) => { if (text.length <= maxChars) return text; const half = Math.floor(maxChars / 2); return text.slice(0, half) + '\n\n[...truncated...]\n\n' + text.slice(-half); };
const validatePrompt = (p) => { if (!p || typeof p !== 'string') return { valid: false, error: 'Prompt required' }; const t = p.trim(); if (!t) return { valid: false, error: 'Prompt empty' }; if (t.length > MAX_PROMPT) return { valid: false, error: `Prompt exceeds ${MAX_PROMPT}` }; return { valid: true, value: t }; };
const validateHistory = (h) => { if (!h) return []; if (!Array.isArray(h)) return { valid: false, error: 'History must be array' }; if (h.length > MAX_HISTORY) return { valid: false, error: `History exceeds ${MAX_HISTORY}` }; return { valid: true, value: h.filter(m => m && typeof m === 'object').map(m => ({ role: ALLOWED_ROLES.includes(m.role) ? m.role : 'user', content: typeof m.content === 'string' ? m.content.slice(0, MAX_PROMPT) : '' })).slice(0, MAX_HISTORY) }; };

// ===== SUPABASE & CLERK =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const requireAuth = ClerkExpressRequireAuth({ onError: (e) => ({ error: e.message || 'Auth required' }) });

const ensureUser = async (userId) => {
  if (!userId) throw new Error('Missing userId');
  let clerkUser;
  try { clerkUser = await clerkClient.users.getUser(userId); } catch (e) { throw new Error(`Clerk fetch failed: ${e.message}`); }
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
  const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
  const avatar = clerkUser?.imageUrl || null;
  const { data: existing, error: selErr } = await supabase.from('users').select('*').eq('clerk_id', userId).single();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;
  if (existing) { const { error: updErr } = await supabase.from('users').update({ email, name, avatar_url: avatar }).eq('clerk_id', userId); if (updErr) console.error('Update user failed:', updErr.message); return existing; }
  const { data: created, error: insErr } = await supabase.from('users').insert({ clerk_id: userId, email, name, avatar_url: avatar, plan: 'free' }).select().single();
  if (insErr) throw insErr;
  if (!created) throw new Error('User insert returned no data');
  return created;
};

const checkSuspended = async (req, res, next) => {
  try { if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' }); const { data: user, error } = await supabase.from('users').select('suspended, plan').eq('clerk_id', req.auth.userId).single(); if (error) throw error; if (user?.suspended) return res.status(403).json({ error: 'Account suspended' }); req.userPlan = user?.plan || 'free'; next(); }
  catch (err) { Sentry.captureException(err); return res.status(500).json({ error: 'Failed to verify account' }); }
};

const requireOwnership = (table, col = 'user_id') => async (req, res, next) => {
  try { if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' }); const user = await ensureUser(req.auth.userId); const id = req.params.id; if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Resource ID required' }); if (!/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ error: 'Invalid resource ID' }); const { data: resource, error } = await supabase.from(table).select(col).eq('id', id).single(); if (error || !resource) return res.status(404).json({ error: 'Not found' }); if (resource[col] !== user.id) return res.status(403).json({ error: 'No permission' }); req.resource = resource; next(); }
  catch (err) { Sentry.captureException(err); return res.status(500).json({ error: 'Ownership check failed' }); }
};

const requireAdmin = async (req, res, next) => {
  try { if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' }); const { data: user, error } = await supabase.from('users').select('is_admin').eq('clerk_id', req.auth.userId).single(); if (error) throw error; if (!user?.is_admin) return res.status(403).json({ error: 'Admin only' }); next(); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: 'Admin check failed' }); }
};

const auditLog = async (userId, action, metadata = {}) => { try { await supabase.from('audit_logs').insert({ user_id: userId, action, metadata, ip_address: null, created_at: new Date().toISOString() }); } catch (e) { console.error('Audit log failed:', e.message); } };

// ===== HEALTH =====
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== COUNCIL =====
app.post('/api/council', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { message, history = [], chatId } = req.body;
    const convCache = getConversationCache(chatId);
    const pv = validatePrompt(message);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    const hv = validateHistory(history);
    if (!hv.valid && hv.error) return res.status(400).json({ error: hv.error });

    const userPlan = user.plan || 'free';
    const isDetailed = wantsDetailedAnswer(pv.value);
    const selection = classifyRequest(pv.value, userPlan);
    const truncatedPrompt = truncatePrompt(pv.value);
    const histArr = Array.isArray(hv) ? hv : (hv.value || []);

    console.log(`[COUNCIL] ${user.email} | ${userPlan} | ${selection.category} | Cache: ${convCache ? `${convCache.turnCount} turns` : 'none'}`);

    // 1. GREETING BYPASS
    if (selection.category === 'greeting') {
      console.log('[COUNCIL] Greeting. Instant bypass.');
      const greetingMessages = [
        { role: 'system', content: 'You are ALOP-AI, a friendly AI assistant. Greet the user briefly and ask how you can help.' },
        ...(convCache?.summary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convCache.summary}` }] : []),
        { role: 'user', content: pv.value }
      ];
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', greetingMessages, 0.0);
      if (!res.writableEnded) res.end();
      await auditLog(user.id, 'council_message', { plan: userPlan, category: 'greeting', models: 1 });
      return;
    }

    // 2. MEMORY/REFERENCE DETECTION (skip search, use cache + history)
    const isMemoryQuestion = isMemoryOrReferenceQuestion(pv.value);

    // 3. SEARCH DECISION (skip if memory question)
    let searchQuery = null;
    if (!isMemoryQuestion) {
      searchQuery = await getSearchQuery(pv.value);
    } else {
      console.log('[COUNCIL] Memory/reference question. Skipping search, using cache + history.');
    }

    const shouldCheckWiki = !isMemoryQuestion && needsWikiCheck(pv.value);

    // 4. SEARCH MODE
    if (searchQuery) {
      const { context, sources, found, images } = await comprehensiveSearch(searchQuery, shouldCheckWiki);

      if (!found) {
        console.log('[COUNCIL] No results. Refusing.');
        res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: "I searched multiple sources but couldn't find any results for that query. Could you rephrase or provide more specific details?" })}\n\n`);
        res.write('data: [DONE]\n\n');
        if (!res.writableEnded) res.end();
        await auditLog(user.id, 'council_message', { plan: userPlan, category: 'no_results', models: 0 });
        return;
      }

      console.log(`[COUNCIL] ${sources.length} sources. Extraction with ${context.length} chars.`);

      const extractionMessages = [
        { role: 'system', content: `You are a precision data extraction engine. Below is data from multiple web sources (Tavily, Brave, Google, Wikipedia, Jina Reader). Answer using ONLY this data.

ABSOLUTE RULES:
1. ONLY state facts that appear explicitly in the provided data.
2. Do NOT use training data knowledge.
3. Do NOT infer, guess, estimate, or extrapolate.
4. Do NOT compare products unless BOTH appear in the data with actual specs.
5. If data doesn't contain the answer, say: "I couldn't find specific information about this in the search results."
6. Include URLs as Markdown links: [Title](URL)
7. Do NOT invent specs, prices, model numbers, or features.
8. If sources contradict, note the discrepancy and cite both.
9. Format in clean Markdown with headers, bold, bullets, tables.
10. List sources at the bottom under "## Sources".
11. If images are provided, embed relevant ones: ![Description](image_url).
12. CONVERSATION CONTEXT and message history are EXEMPT from rules 1-5. Use them for continuity and referencing previous topics.` },
        ...(convCache?.summary ? [{ role: 'system', content: `CONVERSATION CONTEXT (previous messages summary): ${convCache.summary}` }] : []),
        ...histArr.slice(-10),
        { role: 'user', content: `${truncatedPrompt}\n\n\n=== SEARCH DATA ===\n${context}` }
      ];

      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', extractionMessages, 0.0);
      if (!res.writableEnded) res.end();

      // Update conversation cache
      if (chatId) {
        const lastAssistant = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
        updateConversationSummary(chatId, pv.value, lastAssistant || 'Responded with search results.').catch(() => {});
      }
      await auditLog(user.id, 'council_message', { plan: userPlan, category: 'search_extraction', models: 1, sources: sources.length, images: images.length });
      return;
    }

    // 5. WIKIPEDIA MODE (factual questions without web search)
    if (shouldCheckWiki) {
      const wikiContent = await searchWikipedia(pv.value);
      if (wikiContent) {
        console.log('[COUNCIL] Wikipedia content found.');
        const wikiMessages = [
          { role: 'system', content: 'You are a precision data extraction engine. Use ONLY the Wikipedia content below. Do NOT use training data. If the content doesn\'t contain the answer, say "I couldn\'t find this on Wikipedia." Use Markdown.' },
          ...(convCache?.summary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convCache.summary}` }] : []),
          ...histArr.slice(-10),
          { role: 'user', content: `${truncatedPrompt}\n\n=== WIKIPEDIA ===\n${wikiContent}` }
        ];
        res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
        await streamModel(res, 'glm-5.2', wikiMessages, 0.0);
        if (!res.writableEnded) res.end();
        if (chatId) updateConversationSummary(chatId, pv.value, 'Responded with Wikipedia content.').catch(() => {});
        await auditLog(user.id, 'council_message', { plan: userPlan, category: 'wiki', models: 1 });
        return;
      }
    }

    // 6. COUNCIL MODE (logic, coding, math, creative, OR memory questions)
    const memoryContext = isMemoryQuestion && convCache?.summary
      ? `\n\nIMPORTANT: The user is asking about a previous conversation. Here is the conversation summary: ${convCache.summary}\n\nThe message history below contains the actual previous messages. Use BOTH the summary and history to answer. Do NOT say you don't have memory. You DO have the conversation context below.`
      : '';

    const councilMessages = [
      { role: 'system', content: `You are an elite AI expert in the ALOP-AI Council. If this request is outside your expertise, reply ONLY with "SKIP". If you answer, be direct and comprehensive. Use Markdown. If CONVERSATION CONTEXT or history is provided, use it for continuity and reference previous topics.${memoryContext} ${isDetailed ? 'Be thorough.' : 'Be concise.'}` },
      ...(convCache?.summary ? [{ role: 'system', content: `CONVERSATION CONTEXT (previous messages summary): ${convCache.summary}` }] : []),
      ...histArr.slice(-10),
      { role: 'user', content: truncatedPrompt }
    ];

    const validResponses = await runCouncilWithWhip(selection.models, councilMessages, 0.0, selection.whipMs, selection.quorum, selection.tokenLimit);

    // 7. FALLBACK
    if (validResponses.length === 0) {
      console.log('[COUNCIL] No valid responses. Fallback.');
      const fallbackMessages = [
        { role: 'system', content: `You are a helpful AI assistant. Answer directly. If you don't know, say "I don't have enough information." Do NOT guess. If CONVERSATION CONTEXT or history is provided, use it for continuity and reference previous topics. Use Markdown.` },
        ...(convCache?.summary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convCache.summary}` }] : []),
        ...histArr.slice(-10),
        { role: 'user', content: truncatedPrompt }
      ];
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', fallbackMessages, 0.0);
      if (!res.writableEnded) res.end();
      if (chatId) updateConversationSummary(chatId, pv.value, 'Responded via fallback.').catch(() => {});
      await auditLog(user.id, 'council_message', { plan: userPlan, category: 'fallback', models: 1 });
      return;
    }

    // 8. SYNTHESIS
    const synthMessages = [
      { role: 'system', content: 'You are the Chief Synthesizer. Combine expert responses into one cohesive answer. Do NOT add information not in the expert responses. Do NOT invent facts. Do NOT mention expert names. Use Markdown.' },
      { role: 'user', content: `User question: ${truncatedPrompt}\n\nExpert responses:\n${validResponses.map((r, i) => `[Expert ${i + 1}]: ${r.content}`).join('\n\n')}` }
    ];

    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
    await streamModel(res, 'glm-5.2', synthMessages, 0.0);
    if (!res.writableEnded) res.end();

    // Update conversation cache
    if (chatId) {
      const lastAssistant = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
      updateConversationSummary(chatId, pv.value, lastAssistant || validResponses[0]?.content?.slice(0, 800) || 'Responded via council.').catch(() => {});
    }
    await auditLog(user.id, 'council_message', { plan: userPlan, category: selection.category, models: validResponses.length, memory: isMemoryQuestion });
  } catch (err) {
    console.error('Council error:', err.message);
    Sentry.captureException(err);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    if (!res.writableEnded) res.end();
  }
});

// ===== VISION =====
app.post('/api/vision', requireAuth, checkSuspended, async (req, res) => {
  try {
    const { prompt, image } = req.body;
    const pv = validatePrompt(prompt);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ error: 'Valid base64 image required' });
    const user = await ensureUser(req.auth.userId);
    const model = user.plan === 'pro' ? 'gemini-2.5-pro-preview-05-06' : 'gemini-2.5-flash-preview-05-06';
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const answer = await callGeminiVision(model, `You are ALOP-AI vision assistant. Answer based on the screenshot. Be concise.\n\nUser request: ${pv.value}`, base64Data, 'image/png', 2048);
    await auditLog(user.id, 'vision_request', { plan: user.plan });
    res.json({ answer });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== OVERLAY =====
app.post('/api/overlay', requireAuth, checkSuspended, async (req, res) => {
  try {
    const { prompt, image, history = [] } = req.body;
    const pv = validatePrompt(prompt);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    const hv = validateHistory(history);
    if (!hv.valid && hv.error) return res.status(400).json({ error: hv.error });
    const user = await ensureUser(req.auth.userId);
    let ctx = '';
    if (image && typeof image === 'string' && image.startsWith('data:image/')) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const vm = user.plan === 'pro' ? 'gemini-2.5-pro-preview-05-06' : 'gemini-2.5-flash-preview-05-06';
      ctx = await callGeminiVision(vm, 'Describe what is visible on the screen concisely. Include code, text, UI, errors. Be brief.', base64Data, 'image/png', 1024);
    }
    const overlayMessages = [
      { role: 'system', content: 'You are ALOP-AI Overlay. Give concise, accurate answers. For coding, provide working code.' },
      ...(Array.isArray(hv) ? hv : hv.value || []).slice(-4),
      { role: 'user', content: ctx ? `Screen description: ${ctx}\n\nUser question: ${pv.value}` : `User question: ${pv.value}` }
    ];
    const responses = await runCouncilWithWhip(OVERLAY_MODELS, overlayMessages, 0.0, 10000, 2, 800);
    if (responses.length === 0) return res.status(500).json({ error: 'Overlay models failed' });
    const synth = [{ role: 'system', content: 'Synthesize expert answers into one concise response. Prioritize accuracy.' }, { role: 'user', content: `Question: ${pv.value}\n\nExpert answers:\n${responses.map((r, i) => `[Expert ${i + 1}]: ${r.content}`).join('\n\n')}` }];
    const answer = await callGemini('glm-5.2', synth.map(m => `${m.role}: ${m.content}`).join('\n\n'), 1024);
    await auditLog(user.id, 'overlay_request', { plan: user.plan });
    res.json({ answer });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== IMAGE =====
app.post('/api/image', requireAuth, checkSuspended, async (req, res) => {
  try { const pv = validatePrompt(req.body.prompt); if (!pv.valid) return res.status(400).json({ error: pv.error }); res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(pv.value)}?width=1024&height=1024&nologo=true` }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== CHATS =====
app.get('/api/chats', requireAuth, async (req, res) => {
  try { const user = await ensureUser(req.auth.userId); const { data, error } = await supabase.from('chats').select('id, user_id, title, messages, pinned, favorite, created_at, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }); if (error) throw error; res.json(data || []); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/chats', requireAuth, async (req, res) => {
  try { const user = await ensureUser(req.auth.userId); const title = sanitizeString(req.body.title, 120) || 'New Chat'; const { data, error } = await supabase.from('chats').insert({ user_id: user.id, title, messages: [] }).select().single(); if (error) throw error; res.json(data); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.put('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => {
  try { const user = await ensureUser(req.auth.userId); const { messages, title } = req.body; const payload = { updated_at: new Date().toISOString() }; if (title !== undefined) payload.title = sanitizeString(title, 120); if (messages !== undefined) { if (!Array.isArray(messages)) return res.status(400).json({ error: 'Messages must be array' }); payload.messages = messages.slice(0, 200).map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 100000) : '', ts: m.ts, id: m.id })); } const { error } = await supabase.from('chats').update(payload).eq('id', req.params.id).eq('user_id', user.id); if (error) throw error; res.json({ ok: true }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.delete('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => {
  try { const user = await ensureUser(req.auth.userId); const { error } = await supabase.from('chats').delete().eq('id', req.params.id).eq('user_id', user.id); if (error) throw error; if (req.params.id) conversationCache.delete(req.params.id); res.json({ deleted: true }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== ADMIN =====
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try { const { data, error } = await supabase.from('users').select('id, clerk_id, email, name, avatar_url, plan, is_admin, suspended, created_at, stripe_subscription_id'); if (error) throw error; res.json(data || []); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, async (req, res) => {
  try { const { data: t } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single(); if (t?.is_admin) return res.status(403).json({ error: 'Cannot suspend admin' }); const { error } = await supabase.from('users').update({ suspended: true }).eq('id', req.params.id); if (error) throw error; res.json({ suspended: true }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/:id/unsuspend', requireAuth, requireAdmin, async (req, res) => {
  try { const { error } = await supabase.from('users').update({ suspended: false }).eq('id', req.params.id); if (error) throw error; res.json({ unsuspended: true }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try { if (req.auth.userId === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' }); const { data: t } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single(); if (t?.is_admin) return res.status(403).json({ error: 'Cannot delete admin' }); const { error } = await supabase.from('users').delete().eq('id', req.params.id); if (error) throw error; res.json({ deleted: true }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/chats/:userId', requireAuth, requireAdmin, async (req, res) => {
  try { const { data, error } = await supabase.from('chats').select('*').eq('user_id', req.params.userId).order('updated_at', { ascending: false }); if (error) throw error; res.json(data || []); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/usage/:userId', requireAuth, requireAdmin, async (req, res) => {
  try { const { data, error } = await supabase.from('usage').select('*').eq('user_id', req.params.userId).order('date', { ascending: false }).limit(30); if (error) throw error; res.json(data || []); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== STRIPE =====
app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
  try { const user = await ensureUser(req.auth.userId); const clerkUser = await clerkClient.users.getUser(req.auth.userId); const email = clerkUser?.emailAddresses?.[0]?.emailAddress; const priceId = req.body.plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY; if (!priceId) throw new Error('Stripe price ID not configured'); const session = await stripe.checkout.sessions.create({ customer_email: user.stripe_customer_id ? undefined : email, customer: user.stripe_customer_id || undefined, line_items: [{ price: priceId, quantity: 1 }], mode: 'subscription', success_url: `${process.env.FRONTEND_URL}/?payment=success`, cancel_url: `${process.env.FRONTEND_URL}/?payment=cancelled`, metadata: { userId: req.auth.userId } }); res.json({ url: session.url }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/create-portal-session', requireAuth, async (req, res) => {
  try { const user = await ensureUser(req.auth.userId); if (!user.stripe_customer_id) return res.status(400).json({ error: 'No subscription found' }); const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${process.env.FRONTEND_URL}/` }); res.json({ url: session.url }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.get('/api/user/plan', requireAuth, async (req, res) => {
  try { const user = await ensureUser(req.auth.userId); res.json({ plan: user.plan || 'free', subscription_id: user.stripe_subscription_id }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== 404 & ERRORS =====
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
Sentry.setupExpressErrorHandler(app);
app.use((err, req, res, next) => { Sentry.captureException(err); if (err.message?.includes('CORS')) return res.status(403).json({ error: err.message }); res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message }); });

// ===== START =====
const server = app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║   ALOP-AI PRECISION BACKEND                          ║`);
  console.log(`║   Port: ${PORT} | Temp: 0.0 | Models: ${ALL_MODELS.length}             ║`);
  console.log(`║   Search: T=${TAVILY_API_KEY ? 'ON' : 'OFF'} B=${BRAVE_API_KEY ? 'ON' : 'OFF'} G=${GOOGLE_SEARCH_API_KEY && GOOGLE_CSE_ID ? 'ON' : 'OFF'} J=${JINA_API_KEY ? 'ON' : 'OFF'} Wiki=ON ║`);
  console.log(`║   Memory: Conv cache 200 | Search cache 50/5min     ║`);
  console.log(`║   Speed: 1 Jina page | 7s Tavily | 4s search decision║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
