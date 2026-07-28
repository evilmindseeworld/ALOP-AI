/**
 * ALOP-AI ULTIMATE PRECISION BACKEND
 * 
 * Features: AI memory detection, persistent Supabase memory, 5 search sources,
 * search cache, response cache, language detection, self-selecting council,
 * streaming fallback, image support, 12 anti-hallucination rules, feedback learning,
 * quick mode endpoint, bulletproof overlay.
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
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { ClerkExpressRequireAuth, clerkClient } = require('@clerk/clerk-sdk-node');
const Stripe = require('stripe');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ===== ENV =====
const requiredEnv = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','FRONTEND_URL','OLLAMA_HOST','OLLAMA_API_KEY'];
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

// ===== MODELS =====
const FREE_COUNCIL_MODELS = ['gemma4','qwen3.5','glm-5.2','kimi-k2.5'];
const ALL_MODELS = ['gemma4','qwen3.5','glm-5.2','kimi-k2.5','minimax-m2.5','kimi-k2.7-code','deepseek-v4-pro','kimi-k2.6','glm-5.1','minimax-m3','minimax-m2.7','nemotron-3-super','nemotron-3-ultra'];

// ===== AI HELPERS =====
const callModel = async (modelName, messages, temperature = 0.0, timeoutMs = 30000, maxTokens = 1000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OLLAMA_HOST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` }, body: JSON.stringify({ model: modelName, messages, stream: false, options: { temperature, num_predict: maxTokens } }), signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) { const text = await res.text(); throw new Error(`Model ${modelName}: ${res.status} ${text.slice(0,200)}`); }
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

const callGeminiVision = async (modelName, prompt, base64Image, mimeType = 'image/png', maxTokens = 2048) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  if (Buffer.byteLength(base64Image, 'base64') / (1024*1024) > 8) throw new Error('Image too large');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }], generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens } }) });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini: ${res.status} ${t.slice(0,300)}`); }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

// ===== COUNCIL =====
const runCouncilWithWhip = async (models, messages, temperature, whipMs, quorum, tokenLimit) => {
  const results = [];
  let settledCount = 0, validCount = 0, resolved = false;
  return new Promise((resolve) => {
    const whipTimer = setTimeout(() => { if (!resolved) { resolved = true; resolve(results); } }, whipMs);
    const checkDone = () => { if (resolved) return; if (validCount >= quorum) { resolved = true; clearTimeout(whipTimer); resolve(results); return; } if (settledCount >= models.length) { resolved = true; clearTimeout(whipTimer); resolve(results); } };
    models.forEach((model) => { callModel(model, messages, temperature, whipMs, tokenLimit).then((content) => { settledCount++; if (content && content.trim().toUpperCase().includes('SKIP')) { console.log(`[COUNCIL] ${model} SKIP`); } else if (content && content.trim().length > 3) { validCount++; results.push({ model, content }); } checkDone(); }).catch(() => { settledCount++; checkDone(); }); });
  });
};

// ===== ROUTER =====
const classifyRequest = (text, userPlan) => {
  const lower = text.toLowerCase().trim();
  const wordCount = text.split(/\s+/).length;
  const filterByPlan = (models) => { if (userPlan === 'pro') return models; const s = new Set(FREE_COUNCIL_MODELS); const f = models.filter(m => s.has(m)); return f.length > 0 ? f : FREE_COUNCIL_MODELS; };
  if (wordCount <= 4 && /hi|hello|hey|yo|sup|howdy|gm|good morning/i.test(lower)) return { models: filterByPlan(['gemma4']), quorum: 1, whipMs: 5000, tokenLimit: 200, category: 'greeting' };
  return { models: filterByPlan(ALL_MODELS), quorum: 3, whipMs: 30000, tokenLimit: 2000, category: 'council' };
};

// ===== MEMORY DETECTION =====
const isMemoryOrReferenceQuestion = async (text) => {
  const response = await callModel('gemma4', [{ role: 'system', content: 'Is this question asking about a previous conversation or referencing something discussed earlier? Reply ONLY "YES" or "NO".' }, { role: 'user', content: text.slice(0, 500) }], 0.0, 3000, 10);
  return response.trim().toUpperCase().startsWith('YES');
};

// ===== SEARCH DECISION =====
const getSearchQuery = async (text, convSummary) => {
  const userContent = convSummary ? `Context: ${convSummary}\n\nQuestion: ${text}` : text;
  const response = await callModel('gemma4', [{ role: 'system', content: 'Analyze the prompt. If it needs real-time web search (products, facts, reviews, specs, prices), reply ONLY with the optimal search query. If not, reply ONLY "NO". Memory/reference questions do NOT need search.' }, { role: 'user', content: userContent }], 0.0, 4000, 50);
  const trimmed = response.trim();
  if (trimmed.toUpperCase() === 'NO' || !trimmed) return null;
  return trimmed;
};

// ===== CLASSIFIERS =====
const wantsDetailedAnswer = (text) => ['explain in detail','detailed','in depth','comprehensive','thorough','step by step','deep dive','elaborate','full explanation','essay','write a'].some(t => text.toLowerCase().includes(t));
const needsWikiCheck = (text) => /what is|who is|history|explain|definition|meaning of|tell me about|biography|born|origin/i.test(text);
const detectLanguage = (text) => {
  if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
  if (/[\u4e00-\u9fff]/.test(text)) return 'Chinese';
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u0400-\u04FF]/.test(text)) return 'Russian';
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text)) return 'French';
  if (/[äöüß]/i.test(text)) return 'German';
  if (/[ñ¿áéíóú]/i.test(text)) return 'Spanish';
  return 'English';
};

// ===== CACHES =====
const searchCache = new Map();
const getCachedSearch = (q) => { const c = searchCache.get(q); if (c && (Date.now()-c.timestamp) < 300000) return c.data; if (c) searchCache.delete(q); return null; };
const setCachedSearch = (q, d) => { if (searchCache.size >= 50) { const k = searchCache.keys().next().value; searchCache.delete(k); } searchCache.set(q, { data: d, timestamp: Date.now() }); };

// ===== SEARCH FUNCTIONS =====
const searchBrave = async (query) => {
  if (!BRAVE_API_KEY) return [];
  try { const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query.slice(0,200))}&count=10`, { method: 'GET', headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY }, signal: AbortSignal.timeout(8000) }); if (!res.ok) return []; const data = await res.json(); return (data.web?.results || []).map(r => ({ title: r.title?.slice(0,200)||'', url: r.url, description: r.description?.slice(0,500)||'' })); } catch { return []; }
};
const searchTavily = async (query) => {
  if (!TAVILY_API_KEY) return { answer: '', results: [], images: [] };
  try { const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query.slice(0,400), search_depth: 'advanced', include_answer: true, include_raw_content: false, include_images: true, include_image_descriptions: true, max_results: 5 }), signal: AbortSignal.timeout(7000) }); if (!res.ok) return { answer: '', results: [], images: [] }; const data = await res.json(); return { answer: data.answer||'', results: (data.results||[]).map(r => ({ title: r.title?.slice(0,200)||'', url: r.url, content: (r.content||'').slice(0,3000) })), images: (data.images||[]).map(img => typeof img === 'string' ? img : (img.url||img)) }; } catch { return { answer: '', results: [], images: [] }; }
};
const searchGoogleWeb = async (query) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  try { const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0,200))}&num=10`, { signal: AbortSignal.timeout(8000) }); if (!res.ok) return []; const data = await res.json(); return (data.items||[]).map(r => ({ title: r.title?.slice(0,200)||'', url: r.link, description: (r.snippet||'').slice(0,500) })); } catch { return []; }
};
const searchGoogleImages = async (query) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  try { const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0,200))}&searchType=image&num=5`, { signal: AbortSignal.timeout(8000) }); if (!res.ok) return []; const data = await res.json(); return (data.items||[]).map(r => ({ url: r.link, title: r.title?.slice(0,200)||'' })); } catch { return []; }
};
const readPageContent = async (url) => {
  try { const headers = { 'Accept': 'text/markdown' }; if (JINA_API_KEY) headers['Authorization'] = `Bearer ${JINA_API_KEY}`; const res = await fetch(`https://r.jina.ai/${url}`, { method: 'GET', headers, signal: AbortSignal.timeout(6000) }); if (!res.ok) return ''; return (await res.text()).slice(0, 3000); } catch { return ''; }
};
const searchWikipedia = async (query) => {
  try { const sr = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query.slice(0,100))}&format=json&origin=*`, { signal: AbortSignal.timeout(6000) }); if (!sr.ok) return ''; const sd = await sr.json(); const titles = (sd.query?.search||[]).slice(0,2).map(s => s.title); if (titles.length === 0) return ''; const er = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`, { signal: AbortSignal.timeout(6000) }); if (!er.ok) return ''; const ed = await er.json(); return Object.values(ed.query?.pages||{}).map(p => p.extract||'').filter(e => e.length > 100).join('\n\n').slice(0, 5000); } catch { return ''; }
};

// ===== COMPREHENSIVE SEARCH =====
const comprehensiveSearch = async (query, needsWiki) => {
  const cached = getCachedSearch(query); if (cached) return cached;
  const [tavilyResult, braveResults, googleResults, googleImages, wikiContent] = await Promise.all([searchTavily(query), searchBrave(query), searchGoogleWeb(query), searchGoogleImages(query), needsWiki ? searchWikipedia(query) : Promise.resolve('')]);
  const td = Array.isArray(tavilyResult) ? { answer:'',results:[],images:[] } : tavilyResult;
  const sources = [], allImages = []; let ctx = '';
  if (td.answer) ctx += `TAVILY ANSWER: ${td.answer}\n\n---\n\n`;
  if (td.results?.length > 0) { ctx += `TAVILY RESULTS:\n${td.results.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join('\n\n---\n\n')}\n\n---\n\n`; td.results.forEach(r => sources.push({title:r.title,url:r.url})); }
  if (td.images?.length > 0) allImages.push(...td.images.filter(u => u && u.startsWith('http')));
  if (braveResults.length > 0) { ctx += `BRAVE:\n${braveResults.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.description}`).join('\n\n---\n\n')}\n\n---\n\n`; braveResults.forEach(r => { if (!sources.find(s => s.url === r.url)) sources.push({title:r.title,url:r.url}); }); }
  if (googleResults.length > 0) { ctx += `GOOGLE:\n${googleResults.map((r,i) => `SOURCE ${i+1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.description}`).join('\n\n---\n\n')}\n\n---\n\n`; googleResults.forEach(r => { if (!sources.find(s => s.url === r.url)) sources.push({title:r.title,url:r.url}); }); }
  if (googleImages.length > 0) allImages.push(...googleImages.map(img => img.url).filter(u => u && u.startsWith('http')));
  if (wikiContent) ctx += `WIKIPEDIA:\n${wikiContent}\n\n---\n\n`;
  if (sources.length > 0) { const pc = await readPageContent(sources[0].url); if (pc.length > 200) ctx += `FULL PAGE (${sources[0].url}):\n${pc}\n\n---\n\n`; }
  if (allImages.length > 0) { const unique = [...new Set(allImages)].slice(0,5); ctx += `IMAGES:\n${unique.map((u,i) => `IMAGE ${i+1}: ${u}`).join('\n')}\n\n---\n\n`; }
  const found = sources.length > 0 || !!wikiContent || !!td.answer;
  const result = { context: ctx.trim(), sources, found, images: allImages };
  setCachedSearch(query, result); return result;
};

// ===== MEMORY =====
const updateConversationSummary = async (userId, userMsg, assistantMsg) => {
  try {
    const { data: existing } = await supabase.from('users').select('conversation_summary').eq('id', userId).single();
    const prev = existing?.conversation_summary || '';
    const u = userMsg.slice(0, 800); const a = assistantMsg.slice(0, 800);
    let newSummary = '';
    if (prev) {
      newSummary = await callModel('gemma4', [{ role: 'system', content: 'Compress previous summary and new exchange into 2-3 sentences. Reply ONLY with the summary.' }, { role: 'user', content: `Previous:\n${prev}\n\nNew:\nUser: ${u}\nAssistant: ${a}` }], 0.0, 4000, 200);
    } else {
      newSummary = await callModel('gemma4', [{ role: 'system', content: 'Summarize in 1-2 sentences. Reply ONLY with the summary.' }, { role: 'user', content: `User: ${u}\nAssistant: ${a}` }], 0.0, 4000, 150);
    }
    if (newSummary.trim()) { await supabase.from('users').update({ conversation_summary: newSummary.trim() }).eq('id', userId); console.log('[MEMORY] Saved.'); }
  } catch (e) { console.error('[MEMORY] Failed:', e.message); }
};

// ===== MIDDLEWARE =====
const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
app.use(cors({ origin: (origin, cb) => { if (!origin) return cb(null, true); const l = origin.toLowerCase(); if (allowedOrigins.map(o => o.toLowerCase()).includes(l)) return cb(null, true); if (process.env.NODE_ENV === 'development') return cb(null, true); if (l.includes('.vercel.app')) return cb(null, true); cb(new Error(`CORS: ${origin}`)); }, credentials: true, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Requested-With'], maxAge: 86400 }));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'", process.env.FRONTEND_URL, 'https://*.clerk.com', 'https://*.stripe.com'], scriptSrc: ["'self'", "'unsafe-inline'", 'https://*.clerk.com'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://image.pollinations.ai'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], frameAncestors: ["'none'"], formAction: ["'self'", 'https://*.stripe.com'], upgradeInsecureRequests: [] } }, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }, referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, xContentTypeOptions: true, xFrameOptions: 'DENY', xPermittedCrossDomainPolicies: 'none' }));
app.use((req, res, next) => { req.requestId = crypto.randomUUID(); req.clientFingerprint = crypto.createHash('sha256').update(req.ip + (req.headers['user-agent']||'')).digest('hex').slice(0,16); next(); });

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']; if (!sig) return res.status(400).send('Missing sig');
  let event; try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { Sentry.captureException(err); return res.status(400).send(`Webhook: ${err.message}`); }
  try { if (event.type === 'checkout.session.completed') { const s = event.data.object; const email = s.customer_email || s.customer_details?.email; if (email) await supabase.from('users').update({ plan:'pro', stripe_customer_id: s.customer, stripe_subscription_id: s.subscription }).eq('email', email.toLowerCase()); } if (event.type === 'invoice.paid') await supabase.from('users').update({ plan:'pro' }).eq('stripe_customer_id', event.data.object.customer); if (['customer.subscription.deleted','customer.subscription.updated'].includes(event.type)) { const sub = event.data.object; await supabase.from('users').update({ plan: sub.status === 'active' ? 'pro' : 'free' }).eq('stripe_subscription_id', sub.id); } res.json({ received: true }); } catch (err) { Sentry.captureException(err); res.status(500).send('Webhook failed'); }
});

app.use(compression());
app.use(timeout('300s'));
app.use((req, res, next) => { if (req.timedout) return res.status(503).json({ error: 'Timeout' }); next(); });

const rlKey = (req, res) => { if (req.auth && req.auth.userId) return req.auth.userId; if (req.clientFingerprint) return req.clientFingerprint; return rateLimit.ipKeyGenerator(req, res); };
const createLimiter = (windowMs, max, msg) => rateLimit({ windowMs, max, message: { error: msg }, standardHeaders: true, legacyHeaders: false, keyGenerator: (req, res) => rlKey(req, res), skip: (req) => req.path === '/health' || req.path === '/api/stripe/webhook', handler: (req, res) => { res.status(429).json({ error: msg }); } });
app.use('/api/', createLimiter(60000, 120, 'Too many requests.'));
app.use('/api/council', createLimiter(60000, 30, 'Too many council requests.'));
app.use('/api/quick', createLimiter(60000, 60, 'Too many quick requests.'));
app.use('/api/vision', createLimiter(60000, 10, 'Too many vision requests.'));
app.use('/api/overlay', createLimiter(60000, 30, 'Too many overlay requests.'));
app.use('/api/feedback', createLimiter(60000, 30, 'Too many feedback requests.'));
app.use('/api/image', createLimiter(60000, 10, 'Too many image requests.'));
app.use('/api/create-checkout-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/create-portal-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/admin/', createLimiter(60000, 60, 'Too many admin requests.'));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ===== SANITIZATION =====
const MAX_PROMPT = 100000, MAX_HISTORY = 20, ALLOWED_ROLES = ['user','assistant','system'];
const sanitizeString = (str, max = 200) => typeof str === 'string' ? str.trim().slice(0, max) : '';
const truncatePrompt = (text, maxChars = 90000) => { if (text.length <= maxChars) return text; const h = Math.floor(maxChars/2); return text.slice(0,h) + '\n\n[...truncated...]\n\n' + text.slice(-h); };
const validatePrompt = (p) => { if (!p || typeof p !== 'string') return { valid: false, error: 'Prompt required' }; const t = p.trim(); if (!t) return { valid: false, error: 'Prompt empty' }; if (t.length > MAX_PROMPT) return { valid: false, error: `Exceeds ${MAX_PROMPT}` }; return { valid: true, value: t }; };
const validateHistory = (h) => { if (!h) return []; if (!Array.isArray(h)) return { valid: false, error: 'History must be array' }; if (h.length > MAX_HISTORY) return { valid: false, error: `Exceeds ${MAX_HISTORY}` }; return { valid: true, value: h.filter(m => m && typeof m === 'object').map(m => ({ role: ALLOWED_ROLES.includes(m.role) ? m.role : 'user', content: typeof m.content === 'string' ? m.content.slice(0, MAX_PROMPT) : '' })).slice(0, MAX_HISTORY) }; };

// ===== SUPABASE & CLERK =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const requireAuth = ClerkExpressRequireAuth({ onError: (e) => ({ error: e.message || 'Auth required' }) });

const ensureUser = async (userId) => {
  if (!userId) throw new Error('Missing userId');
  let clerkUser; try { clerkUser = await clerkClient.users.getUser(userId); } catch (e) { throw new Error(`Clerk failed: ${e.message}`); }
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
  const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
  const avatar = clerkUser?.imageUrl || null;
  const { data: existing, error: selErr } = await supabase.from('users').select('*').eq('clerk_id', userId).single();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;
  if (existing) { const { error: updErr } = await supabase.from('users').update({ email, name, avatar_url: avatar }).eq('clerk_id', userId); if (updErr) console.error('Update failed:', updErr.message); return existing; }
  const { data: created, error: insErr } = await supabase.from('users').insert({ clerk_id: userId, email, name, avatar_url: avatar, plan: 'free' }).select().single();
  if (insErr) throw insErr; if (!created) throw new Error('Insert returned no data'); return created;
};

const checkSuspended = async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); const { data: user, error } = await supabase.from('users').select('suspended, plan').eq('clerk_id', req.auth.userId).single(); if (error) throw error; if (user && user.suspended) return res.status(403).json({ error: 'Account suspended' }); req.userPlan = user?.plan || 'free'; next(); } catch (err) { Sentry.captureException(err); return res.status(500).json({ error: 'Verify failed' }); } };
const requireOwnership = (table, col = 'user_id') => async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); const user = await ensureUser(req.auth.userId); const id = req.params.id; if (!id || typeof id !== 'string') return res.status(400).json({ error: 'ID required' }); if (!/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ error: 'Invalid ID' }); const { data: resource, error } = await supabase.from(table).select(col).eq('id', id).single(); if (error || !resource) return res.status(404).json({ error: 'Not found' }); if (resource[col] !== user.id) return res.status(403).json({ error: 'No permission' }); req.resource = resource; next(); } catch (err) { Sentry.captureException(err); return res.status(500).json({ error: 'Ownership check failed' }); } };
const requireAdmin = async (req, res, next) => { try { if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Not authenticated' }); const { data: user, error } = await supabase.from('users').select('is_admin').eq('clerk_id', req.auth.userId).single(); if (error) throw error; if (!user || !user.is_admin) return res.status(403).json({ error: 'Admin only' }); next(); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: 'Admin check failed' }); } };
const auditLog = async (userId, action, metadata = {}) => { try { await supabase.from('audit_logs').insert({ user_id: userId, action, metadata, ip_address: null, created_at: new Date().toISOString() }); } catch (e) { console.error('Audit failed:', e.message); } };

// ===== HEALTH =====
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== COUNCIL =====
app.post('/api/council', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { message, history = [] } = req.body;
    const pv = validatePrompt(message);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    const hv = validateHistory(history);
    if (!hv.valid && hv.error) return res.status(400).json({ error: hv.error });

    const userPlan = user.plan || 'free';
    const isDetailed = wantsDetailedAnswer(pv.value);
    const lang = detectLanguage(pv.value);
    const selection = classifyRequest(pv.value, userPlan);
    const truncatedPrompt = truncatePrompt(pv.value);
    const histArr = Array.isArray(hv) ? hv : (hv.value || []);

    let convSummary = '';
    try { const { data: ud } = await supabase.from('users').select('conversation_summary').eq('id', user.id).single(); convSummary = ud?.conversation_summary || ''; } catch (e) {}

    console.log(`[COUNCIL] ${user.email} | ${userPlan} | ${selection.category} | Mem: ${convSummary ? 'Y' : 'N'} | Lang: ${lang}`);

    // 0. MEMORY BYPASS
    if (await isMemoryOrReferenceQuestion(pv.value)) {
      console.log('[COUNCIL] Memory question.');
      const memSys = `You are ALOP-AI. The user is asking about a previous conversation. The history below IS your memory. Do NOT say you can't remember. Reference what was discussed. Be concise.${convSummary ? `\n\nSummary: ${convSummary}` : ''}`;
      const memMsgs = [{ role: 'system', content: memSys }, ...histArr.slice(-10), { role: 'user', content: pv.value }];
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', memMsgs, 0.0);
      if (!res.writableEnded) res.end();
      updateConversationSummary(user.id, pv.value, 'Answered memory question.').catch(() => {});
      await auditLog(user.id, 'council', { category: 'memory' });
      return;
    }

    // 1. GREETING
    if (selection.category === 'greeting') {
      console.log('[COUNCIL] Greeting.');
      const greetMsgs = [{ role: 'system', content: `You are ALOP-AI. Greet briefly.${convSummary ? ` Context: ${convSummary}` : ''}` }, { role: 'user', content: pv.value }];
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', greetMsgs, 0.0);
      if (!res.writableEnded) res.end();
      await auditLog(user.id, 'council', { category: 'greeting' });
      return;
    }

    // 2. SEARCH
    const searchQuery = await getSearchQuery(pv.value, convSummary);
    const shouldCheckWiki = needsWikiCheck(pv.value);

    if (searchQuery) {
      const { context, sources, found, images } = await comprehensiveSearch(searchQuery, shouldCheckWiki);
      if (!found) {
        res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: "I searched but couldn't find results. Could you rephrase?" })}\n\n`);
        res.write('data: [DONE]\n\n');
        if (!res.writableEnded) res.end();
        await auditLog(user.id, 'council', { category: 'no_results' });
        return;
      }
      console.log(`[COUNCIL] ${sources.length} sources, ${context.length} chars.`);
      const extSys = `You are a precision data extraction engine. Use ONLY the provided data.\n\nRULES:\n1. Only state facts from the data.\n2. No training data.\n3. No inferring/guessing.\n4. No comparing unless both products are in data.\n5. If not in data, say "I couldn't find this in the search results."\n6. Include URLs as Markdown: [Title](URL)\n7. No inventing specs/prices.\n8. Note contradictions between sources.\n9. Format in Markdown. Match answer length to question. Be concise for simple questions.\n10. List sources at bottom under "## Sources".\n11. Embed images if provided: ![Description](url)\n12. CONVERSATION CONTEXT and history are EXEMPT from rules 1-5.${lang !== 'English' ? `\n13. Respond in ${lang}.` : ''}`;
      const extMsgs = [{ role: 'system', content: extSys }, ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convSummary}` }] : []), ...histArr.slice(-10), { role: 'user', content: `${truncatedPrompt}\n\n=== SEARCH DATA ===\n${context}` }];
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', extMsgs, 0.0);
      if (!res.writableEnded) res.end();
      const lastA = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
      updateConversationSummary(user.id, pv.value, lastA || 'Search response.').catch(() => {});
      await auditLog(user.id, 'council', { category: 'search', sources: sources.length });
      return;
    }

    // 3. WIKIPEDIA
    if (shouldCheckWiki) {
      const wiki = await searchWikipedia(pv.value);
      if (wiki) {
        const wikiSys = `You are a data extraction engine. Use ONLY the Wikipedia content. No training data. If not found, say "I couldn't find this on Wikipedia." Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
        const wikiMsgs = [{ role: 'system', content: wikiSys }, ...(convSummary ? [{ role: 'system', content: `CONTEXT: ${convSummary}` }] : []), ...histArr.slice(-10), { role: 'user', content: `${truncatedPrompt}\n=== WIKIPEDIA ===\n${wiki}` }];
        res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
        await streamModel(res, 'glm-5.2', wikiMsgs, 0.0);
        if (!res.writableEnded) res.end();
        updateConversationSummary(user.id, pv.value, 'Wikipedia response.').catch(() => {});
        await auditLog(user.id, 'council', { category: 'wiki' });
        return;
      }
    }

    // 4. COUNCIL
    const councilSys = `You are an elite AI expert in the ALOP-AI Council. If outside your expertise, reply ONLY "SKIP". If you answer, be direct. Match response length to question complexity. Use Markdown. If context/history provided, use for continuity. ${isDetailed ? 'Be thorough.' : 'Be concise.'}${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
    const councilMsgs = [{ role: 'system', content: councilSys }, ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convSummary}` }] : []), ...histArr.slice(-10), { role: 'user', content: truncatedPrompt }];
    const validResponses = await runCouncilWithWhip(selection.models, councilMsgs, 0.0, selection.whipMs, selection.quorum, selection.tokenLimit);

    // 5. FALLBACK
    if (validResponses.length === 0) {
      console.log('[COUNCIL] Fallback.');
      const fbSys = `You are a helpful AI assistant. Answer directly. Match length to question. If you don't know, say "I don't have enough information." Don't guess. Use context if provided. Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
      const fbMsgs = [{ role: 'system', content: fbSys }, ...(convSummary ? [{ role: 'system', content: `CONTEXT: ${convSummary}` }] : []), ...histArr.slice(-10), { role: 'user', content: truncatedPrompt }];
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', fbMsgs, 0.0);
      if (!res.writableEnded) res.end();
      updateConversationSummary(user.id, pv.value, 'Fallback response.').catch(() => {});
      await auditLog(user.id, 'council', { category: 'fallback' });
      return;
    }

    // 6. SYNTHESIS
    const synthSys = `You are the Chief Synthesizer. Combine into ONE answer. No new info. No invented facts. No expert names. Remove redundancy. Match length to question. Use Markdown.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
    const synthMsgs = [{ role: 'system', content: synthSys }, { role: 'user', content: `Question: ${truncatedPrompt}\n\nResponses:\n${validResponses.map((r,i) => `[Expert ${i+1}]: ${r.content}`).join('\n\n')}` }];
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
    await streamModel(res, 'glm-5.2', synthMsgs, 0.0);
    if (!res.writableEnded) res.end();
    const lastA = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
    updateConversationSummary(user.id, pv.value, lastA || validResponses[0]?.content?.slice(0,800) || 'Council response.').catch(() => {});
    await auditLog(user.id, 'council', { category: 'council', models: validResponses.length });
  } catch (err) {
    console.error('Council error:', err.message);
    Sentry.captureException(err);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    if (!res.writableEnded) res.end();
  }
});

// ===== QUICK MODE =====
app.post('/api/quick', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { message, history = [] } = req.body;
    const pv = validatePrompt(message);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    const hv = validateHistory(history);
    const histArr = Array.isArray(hv) ? hv : (hv.value || []);
    const QUICK_MODELS = ['gemma4','qwen3.5','glm-5.2','kimi-k2.5'];
    const lang = detectLanguage(pv.value);
    const truncatedPrompt = truncatePrompt(pv.value);

    let convSummary = '';
    try { const { data: ud } = await supabase.from('users').select('conversation_summary').eq('id', user.id).single(); convSummary = ud?.conversation_summary || ''; } catch (e) {}

    console.log(`[QUICK] ${user.email} | Lang: ${lang} | Mem: ${convSummary ? 'Y' : 'N'}`);

    if (await isMemoryOrReferenceQuestion(pv.value)) {
      const memSys = `You are ALOP-AI Quick. User asks about previous conversation. History IS your memory. Don't say you can't remember. Be very concise — 1-3 sentences.${convSummary ? `\nSummary: ${convSummary}` : ''}`;
      const memMsgs = [{ role: 'system', content: memSys }, ...histArr.slice(-6), { role: 'user', content: pv.value }];
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', memMsgs, 0.0);
      if (!res.writableEnded) res.end();
      updateConversationSummary(user.id, pv.value, 'Quick memory.').catch(() => {});
      return;
    }

    const searchQuery = await getSearchQuery(pv.value, convSummary);
    if (searchQuery) {
      const { context, sources, found } = await comprehensiveSearch(searchQuery, false);
      if (!found) {
        res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: "I couldn't find results. Could you rephrase?" })}\n\n`);
        res.write('data: [DONE]\n\n');
        if (!res.writableEnded) res.end();
        return;
      }
      const extSys = `You are ALOP-AI Quick. Use ONLY the search data. No hallucination. Be concise. Include source links.${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
      const extMsgs = [{ role: 'system', content: extSys }, ...(convSummary ? [{ role: 'system', content: `CONTEXT: ${convSummary}` }] : []), ...histArr.slice(-6), { role: 'user', content: `${truncatedPrompt}\n=== DATA ===\n${context}` }];
      const responses = await runCouncilWithWhip(['gemma4','glm-5.2'], extMsgs, 0.0, 15000, 1, 1000);
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
      if (responses.length > 0) { res.write(`data: ${JSON.stringify({ type: 'chunk', text: responses[0].content })}\n\n`); res.write('data: [DONE]\n\n'); if (!res.writableEnded) res.end(); }
      else { await streamModel(res, 'glm-5.2', extMsgs, 0.0); if (!res.writableEnded) res.end(); }
      updateConversationSummary(user.id, pv.value, 'Quick search.').catch(() => {});
      await auditLog(user.id, 'quick', { category: 'search', sources: sources.length });
      return;
    }

    const councilSys = `You are ALOP-AI Quick. Be concise. Match length to question.${convSummary ? ' Use context for continuity.' : ''}${lang !== 'English' ? ` Respond in ${lang}.` : ''}`;
    const councilMsgs = [{ role: 'system', content: councilSys }, ...(convSummary ? [{ role: 'system', content: `CONTEXT: ${convSummary}` }] : []), ...histArr.slice(-6), { role: 'user', content: truncatedPrompt }];
    const responses = await runCouncilWithWhip(QUICK_MODELS, councilMsgs, 0.0, 15000, 1, 1000);
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
    if (responses.length > 0) { res.write(`data: ${JSON.stringify({ type: 'chunk', text: responses[0].content })}\n\n`); res.write('data: [DONE]\n\n'); if (!res.writableEnded) res.end(); }
    else { await streamModel(res, 'glm-5.2', councilMsgs, 0.0); if (!res.writableEnded) res.end(); }
    updateConversationSummary(user.id, pv.value, 'Quick council.').catch(() => {});
    await auditLog(user.id, 'quick', { category: 'council' });
  } catch (err) {
    console.error('Quick error:', err.message);
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
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ error: 'Image required' });
    const user = await ensureUser(req.auth.userId);
    if (!GOOGLE_API_KEY) return res.status(400).json({ error: 'Vision not configured' });
    const model = user.plan === 'pro' ? 'gemini-2.5-pro-preview-05-06' : 'gemini-2.5-flash-preview-05-06';
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const answer = await callGeminiVision(model, `Answer based on screenshot. Be concise.\nRequest: ${pv.value}`, base64Data, 'image/png', 2048);
    await auditLog(user.id, 'vision');
    res.json({ answer });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== OVERLAY (bulletproof — never returns 500) =====
app.post('/api/overlay', async (req, res) => {
  try {
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

    // Single model, fast and reliable
    const histArr = Array.isArray(history) ? history.slice(-4) : [];
    const overlayMsgs = [
      { role: 'system', content: 'You are ALOP-AI Overlay. Give concise answers. For coding, provide working code. If screen description provided, use it.' },
      ...histArr,
      { role: 'user', content: ctx ? `Screen: ${ctx}\n\nQuestion: ${pv.value}` : `Question: ${pv.value}` }
    ];

    let answer = '';
    try { answer = await callModel('glm-5.2', overlayMsgs, 0.0, 15000, 800); }
    catch (e1) {
      console.error('[OVERLAY] glm-5.2 failed:', e1.message);
      try { answer = await callModel('gemma4', overlayMsgs, 0.0, 10000, 800); }
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

// ===== FEEDBACK =====
app.post('/api/feedback', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { feedback, question, answer } = req.body;
    if (!feedback || !['up','down'].includes(feedback)) return res.status(400).json({ error: 'Invalid feedback' });
    await auditLog(user.id, 'feedback', { feedback, question: question?.slice(0,500), answer: answer?.slice(0,500) });
    if (feedback === 'down' || feedback === 'up') {
      try {
        const note = await callModel('gemma4', [
          { role: 'system', content: feedback === 'down' ? 'User disliked this answer. Create a 1-sentence note about what to avoid. Reply ONLY with the note.' : 'User liked this answer. Create a 1-sentence note about what worked. Reply ONLY with the note.' },
          { role: 'user', content: `Q: ${question?.slice(0,300)}\nA: ${answer?.slice(0,300)}` }
        ], 0.0, 3000, 100);
        if (note.trim()) {
          const { data: ud } = await supabase.from('users').select('conversation_summary').eq('id', user.id).single();
          const prev = ud?.conversation_summary || '';
          const tag = feedback === 'down' ? '[Avoid:' : '[Good:';
          const newSummary = prev ? `${prev}\n\n${tag} ${note.trim()}]` : `${tag} ${note.trim()}]`;
          await supabase.from('users').update({ conversation_summary: newSummary.slice(0,2000) }).eq('id', user.id);
          console.log(`[LEARN] ${feedback} feedback saved.`);
        }
      } catch (e) { console.error('[LEARN] Failed:', e.message); }
    }
    res.json({ ok: true });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== IMAGE =====
app.post('/api/image', requireAuth, checkSuspended, async (req, res) => {
  try { const pv = validatePrompt(req.body.prompt); if (!pv.valid) return res.status(400).json({ error: pv.error }); res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(pv.value)}?width=1024&height=1024&nologo=true` }); }
  catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== CHATS =====
app.get('/api/chats', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); const { data, error } = await supabase.from('chats').select('id,user_id,title,messages,pinned,favorite,created_at,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.post('/api/chats', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); const title = sanitizeString(req.body.title, 120) || 'New Chat'; const { data, error } = await supabase.from('chats').insert({ user_id: user.id, title, messages: [] }).select().single(); if (error) throw error; res.json(data); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.put('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => { try { const user = await ensureUser(req.auth.userId); const { messages, title } = req.body; const payload = { updated_at: new Date().toISOString() }; if (title !== undefined) payload.title = sanitizeString(title, 120); if (messages !== undefined) { if (!Array.isArray(messages)) return res.status(400).json({ error: 'Must be array' }); payload.messages = messages.slice(0, 200).map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 100000) : '', ts: m.ts, id: m.id })); } const { error } = await supabase.from('chats').update(payload).eq('id', req.params.id).eq('user_id', user.id); if (error) throw error; res.json({ ok: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.delete('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => { try { const user = await ensureUser(req.auth.userId); const { error } = await supabase.from('chats').delete().eq('id', req.params.id).eq('user_id', user.id); if (error) throw error; res.json({ deleted: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

// ===== ADMIN =====
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => { try { const { data, error } = await supabase.from('users').select('id,clerk_id,email,name,avatar_url,plan,is_admin,suspended,created_at,stripe_subscription_id'); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, async (req, res) => { try { const { data: t } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single(); if (t && t.is_admin) return res.status(403).json({ error: 'Cannot suspend admin' }); const { error } = await supabase.from('users').update({ suspended: true }).eq('id', req.params.id); if (error) throw error; res.json({ suspended: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.post('/api/admin/users/:id/unsuspend', requireAuth, requireAdmin, async (req, res) => { try { const { error } = await supabase.from('users').update({ suspended: false }).eq('id', req.params.id); if (error) throw error; res.json({ unsuspended: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => { try { if (req.auth.userId === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' }); const { data: t } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single(); if (t && t.is_admin) return res.status(403).json({ error: 'Cannot delete admin' }); const { error } = await supabase.from('users').delete().eq('id', req.params.id); if (error) throw error; res.json({ deleted: true }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/admin/chats/:userId', requireAuth, requireAdmin, async (req, res) => { try { const { data, error } = await supabase.from('chats').select('*').eq('user_id', req.params.userId).order('updated_at', { ascending: false }); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/admin/usage/:userId', requireAuth, requireAdmin, async (req, res) => { try { const { data, error } = await supabase.from('usage').select('*').eq('user_id', req.params.userId).order('date', { ascending: false }).limit(30); if (error) throw error; res.json(data || []); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

// ===== STRIPE =====
app.post('/api/create-checkout-session', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); const cu = await clerkClient.users.getUser(req.auth.userId); const email = cu?.emailAddresses?.[0]?.emailAddress; const priceId = req.body.plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY; if (!priceId) throw new Error('Price ID not configured'); const session = await stripe.checkout.sessions.create({ customer_email: user.stripe_customer_id ? undefined : email, customer: user.stripe_customer_id || undefined, line_items: [{ price: priceId, quantity: 1 }], mode: 'subscription', success_url: `${process.env.FRONTEND_URL}/?payment=success`, cancel_url: `${process.env.FRONTEND_URL}/?payment=cancelled`, metadata: { userId: req.auth.userId } }); res.json({ url: session.url }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.post('/api/create-portal-session', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); if (!user.stripe_customer_id) return res.status(400).json({ error: 'No subscription' }); const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${process.env.FRONTEND_URL}/` }); res.json({ url: session.url }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });
app.get('/api/user/plan', requireAuth, async (req, res) => { try { const user = await ensureUser(req.auth.userId); res.json({ plan: user.plan || 'free', subscription_id: user.stripe_subscription_id }); } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); } });

// ===== ERRORS =====
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
Sentry.setupExpressErrorHandler(app);
app.use((err, req, res, next) => { Sentry.captureException(err); if (err.message && err.message.includes('CORS')) return res.status(403).json({ error: err.message }); res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message }); });

// ===== START =====
const server = app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  ALOP-AI PRECISION BACKEND                  ║`);
  console.log(`║  Port: ${PORT} | Temp: 0.0 | ${ALL_MODELS.length} models      ║`);
  console.log(`║  T=${TAVILY_API_KEY?'ON':'OFF'} B=${BRAVE_API_KEY?'ON':'OFF'} G=${GOOGLE_SEARCH_API_KEY&&GOOGLE_CSE_ID?'ON':'OFF'} J=${JINA_API_KEY?'ON':'OFF'} Wiki=ON  ║`);
  console.log(`║  Memory: Supabase | Quick + Feedback        ║`);
  console.log(`╚════════════════════════════════════════════╝\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
