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
const requiredEnv = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','FRONTEND_URL','OLLAMA_HOST','OLLAMA_API_KEY'];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length > 0) { console.error(`Missing: ${missingEnv.join(', ')}`); process.exit(1); }

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const OLLAMA_HOST = process.env.OLLAMA_HOST;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// ===== MODEL TIERS =====
// Tier 1 - Lightning: instant, 4B params
// Tier 2 - Light: fast, general purpose
// Tier 3 - Medium: balanced speed/power
// Tier 4 - Heavy: powerful reasoning
// Tier 5 - Extreme: maximum capability

const COUNCIL_WHIP_MS = parseInt(process.env.COUNCIL_WHIP_MS, 10) || 8000;
const COUNCIL_QUORUM = parseInt(process.env.COUNCIL_QUORUM, 10) || 4;
const COUNCIL_TURBO = process.env.COUNCIL_TURBO === 'true';

const FREE_COUNCIL_MODELS = ['gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.5'];

const PRO_COUNCIL_MODELS = [
  'gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.5',
  'kimi-k2.7-code', 'deepseek-v4-pro', 'kimi-k2.6', 'minimax-m3',
  'mistral-large-3', 'deepseek-v4-flash', 'glm-5.1', 'minimax-m2.5',
  'nemotron-3-super', 'gemini-3-flash-preview'
];

const OVERLAY_MODELS = ['deepseek-v4-pro', 'glm-5.2', 'kimi-k2.7-code'];

const MODEL_POOLS = {
  // Tier 1 - Lightning: 1 model, 3s whip, 200 tokens
  greeting: ['nemotron-3-nano'],

  // Tier 2 - Light: 3 models, 5s whip, 400 tokens
  simple: ['nemotron-3-nano', 'gemma4', 'qwen3.5'],

  // Tier 3 - Medium: 5 models, 8s whip, 600 tokens
  default: ['glm-5.2', 'gemma4', 'qwen3.5', 'deepseek-v4-flash', 'minimax-m2.5'],

  // Tier 3-4 - Coding: 7 models, 10s whip, 800 tokens
  coding: ['kimi-k2.7-code', 'deepseek-v4-pro', 'gpt-oss', 'gemini-3-flash-preview', 'kimi-k2.6', 'minimax-m2.7', 'minimax-m3'],

  // Tier 4 - Math: 6 models, 8s whip, 600 tokens
  math: ['deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-k2.6', 'mistral-large-3', 'gemini-3-flash-preview', 'nemotron-3-super'],

  // Tier 2-3 - Creative: 6 models, 7s whip, 500 tokens
  creative: ['gemma4', 'kimi-k2.5', 'minimax-m2.5', 'glm-5.2', 'qwen3.5', 'minimax-m3'],

  // Tier 4 - Reasoning: 9 models, 10s whip, 700 tokens
  reasoning: ['deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-k2.6', 'glm-5.1', 'minimax-m3', 'nemotron-3-super', 'nemotron-3-ultra', 'mistral-large-3', 'gemini-3-flash-preview'],

  // Tier 4-5 - Essay: 10 models, 12s whip, 1200 tokens
  essay: ['deepseek-v4-pro', 'kimi-k2.6', 'minimax-m3', 'glm-5.1', 'mistral-large-3', 'nemotron-3-ultra', 'nemotron-3-super', 'gemma4', 'kimi-k2.5', 'qwen3.5'],

  // Tier 4-5 - Research: 8 models, 12s whip, 1000 tokens
  research: ['deepseek-v4-pro', 'kimi-k2.6', 'mistral-large-3', 'nemotron-3-super', 'nemotron-3-ultra', 'minimax-m3', 'gemini-3-flash-preview', 'glm-5.1'],

  // Tier 4-5 - Project: 12 models, 14s whip, 1500 tokens
  project: ['kimi-k2.7-code', 'deepseek-v4-pro', 'kimi-k2.6', 'minimax-m3', 'mistral-large-3', 'nemotron-3-super', 'nemotron-3-ultra', 'glm-5.1', 'gemini-3-flash-preview', 'gpt-oss', 'minimax-m2.7', 'deepseek-v4-flash'],

  // Tier 4-5 - Document: 10 models, 12s whip, 1200 tokens
  document: ['deepseek-v4-pro', 'kimi-k2.6', 'minimax-m3', 'mistral-large-3', 'nemotron-3-ultra', 'nemotron-3-super', 'glm-5.1', 'gemma4', 'kimi-k2.5', 'qwen3.5'],

  // All 18 - Extreme: 15s whip, 1500 tokens
  all: ['gemma4','qwen3.5','glm-5.2','kimi-k2.5','minimax-m2.5','kimi-k2.7-code','deepseek-v4-pro','deepseek-v4-flash','kimi-k2.6','glm-5.1','minimax-m3','minimax-m2.7','nemotron-3-super','nemotron-3-ultra','nemotron-3-nano','gpt-oss','gemini-3-flash-preview','mistral-large-3'],
};

// ===== SMART MODEL SELECTION =====
const classifyAndSelectModels = (text, userPlan) => {
  const lower = text.toLowerCase().trim();
  const wordCount = text.split(/\s+/).length;

  const filterByPlan = (models) => {
    if (userPlan === 'pro') return models;
    const freeSet = new Set(FREE_COUNCIL_MODELS);
    const filtered = models.filter(m => freeSet.has(m));
    return filtered.length > 0 ? filtered : FREE_COUNCIL_MODELS.slice(0, 3);
  };

  // === TIER 1: GREETING — 1 lightning model, 3s ===
  const greetings = ['hi','hello','hey','yo','sup','howdy','gm','good morning','good afternoon','good evening','whats up',"what's up",'how are you','how r u','hey there','greetings'];
  if (wordCount <= 4 && greetings.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + '!'))) {
    return { models: filterByPlan(MODEL_POOLS.greeting), quorum: 1, whipMs: 3000, category: 'greeting', tokenLimit: 200 };
  }

  // === TIER 4-5: PROJECT — 12 heavy models, 14s ===
  const projectPatterns = ['build','create a','develop','architect','design a system','implement','project','application','platform','software','system design','database schema','api design','tech stack','infrastructure','scale','microservices','system architecture','develop a','build a','create an app','make an app','build me','develop me','startup','saas','full stack application','web app','mobile app','game','engine','compiler','interpreter','operating system','framework','orchestrate','end-to-end','production ready','scalable system','distributed system','concurrent','parallel computing'];
  if (projectPatterns.some(p => lower.includes(p)) && wordCount > 5) {
    const pool = filterByPlan(MODEL_POOLS.project);
    return { models: pool, quorum: Math.min(4, pool.length), whipMs: 14000, category: 'project', tokenLimit: 1500 };
  }

  // === TIER 4-5: DOCUMENT — 10 heavy models, 12s ===
  const documentPatterns = ['document','summarize','report','white paper','specification','technical doc','write documentation','create a document','draft a','proposal','brief','memorandum','contract','policy','guideline','handbook','manual','standard operating','procedure','write a report','executive summary','meeting notes','minutes','spec','requirements document','design doc','architecture document'];
  if (documentPatterns.some(p => lower.includes(p))) {
    const pool = filterByPlan(MODEL_POOLS.document);
    return { models: pool, quorum: Math.min(3, pool.length), whipMs: 12000, category: 'document', tokenLimit: 1200 };
  }

  // === TIER 3-4: CODING — 7 models, 10s ===
  const codingPatterns = ['code','program','function','script','app','website','bug','error','debug','api','database','sql','python','javascript','react','html','css','java','c++','rust','golang','typescript','node','npm','git','docker','kubernetes','algorithm','leetcode','compile','syntax','stack trace','import ','export ','class ','method','variable','array','object','json','regex','deploy','server','frontend','backend','fullstack','framework','library','package','module','component','hook','endpoint','rest api','graphql','auth','authentication','cors','webpack','vite','tauri','electron','shader','assembly','binary','pointer','memory leak','recursion','big o','design pattern','unit test','integration test','ci/cd','terraform','linux','bash','shell','powershell','command line','thread','async','await','promise','callback','websocket'];
  if (codingPatterns.some(p => lower.includes(p))) {
    const pool = filterByPlan(MODEL_POOLS.coding);
    return { models: pool, quorum: Math.min(2, pool.length), whipMs: 10000, category: 'coding', tokenLimit: 800 };
  }

  // === TIER 4-5: ESSAY — 10 models, 12s ===
  const essayPatterns = ['essay','write a','write an','write me','article','blog post','story','poem','report','paper','thesis','dissertation','novel','chapter','summary','review','critique','argumentative','persuasive','narrative','descriptive','expository','speech','presentation','letter','email draft','cover letter','resume','cv','product description','marketing copy','social media post','caption','headline','slogan','tagline','screenplay','dialogue','monologue'];
  if (essayPatterns.some(p => lower.includes(p))) {
    const pool = filterByPlan(MODEL_POOLS.essay);
    return { models: pool, quorum: Math.min(3, pool.length), whipMs: 12000, category: 'essay', tokenLimit: 1200 };
  }

  // === TIER 4: MATH — 6 models, 8s ===
  const mathPatterns = ['calculate','solve','equation','math','algebra','calculus','geometry','trigonometry','physics','chemistry','biology','statistics','probability','matrix','derivative','integral','theorem','proof','formula','logarithm','exponential','binomial','polynomial','factorial','permutation','combination','standard deviation','regression','correlation','hypothesis test','p-value','quantum','thermodynamics','electromagnetism','newton','relativity','organic chemistry','molecule','atom','electron','dna','rna','protein','cell','enzyme','photosynthesis'];
  if (mathPatterns.some(p => lower.includes(p))) {
    const pool = filterByPlan(MODEL_POOLS.math);
    return { models: pool, quorum: Math.min(2, pool.length), whipMs: 8000, category: 'math', tokenLimit: 600 };
  }

  // === TIER 2-3: CREATIVE — 6 models, 7s ===
  const creativePatterns = ['create','imagine','invent','design a','brainstorm','ideas for','name for','concept','character','world building','plot','theme','metaphor','simile','haiku','sonnet','lyrics','song','jingle','brand name','startup name','creative'];
  if (creativePatterns.some(p => lower.includes(p))) {
    const pool = filterByPlan(MODEL_POOLS.creative);
    return { models: pool, quorum: Math.min(2, pool.length), whipMs: 7000, category: 'creative', tokenLimit: 500 };
  }

  // === TIER 4-5: RESEARCH — 8 models, 12s ===
  const researchPatterns = ['research','analyze','investigate','study','examine','evaluate','assess','compare and contrast','pros and cons','advantages and disadvantages','literature review','case study','systematic review','meta-analysis','data analysis','trends','market research','competitive analysis','swot','feasibility','risk assessment'];
  if (researchPatterns.some(p => lower.includes(p))) {
    const pool = filterByPlan(MODEL_POOLS.research);
    return { models: pool, quorum: Math.min(3, pool.length), whipMs: 12000, category: 'research', tokenLimit: 1000 };
  }

  // === ALL 18: COMPLEX — 14s ===
  const complexPatterns = ['explain in detail','comprehensive','thorough','in depth','in-depth','step by step','deep dive','breakdown','everything about','all about','complete guide','detailed analysis','multi-faceted','elaborate extensively','walk me through','full explanation'];
  if (complexPatterns.some(p => lower.includes(p)) || wordCount > 80) {
    const pool = filterByPlan(MODEL_POOLS.all);
    return { models: pool, quorum: Math.min(COUNCIL_QUORUM, pool.length), whipMs: 15000, category: 'complex', tokenLimit: 1500 };
  }

  // === TIER 2: SIMPLE — 3 light models, 5s ===
  const simplePatterns = ['what is','who is','when did','where is','how many','define','translate','convert','spell','capital of','synonym','antonym','meaning of','what does','how to spell','plural of','past tense','abbreviation'];
  if (wordCount < 15 && simplePatterns.some(p => lower.includes(p))) {
    const pool = filterByPlan(MODEL_POOLS.simple);
    return { models: pool, quorum: 2, whipMs: 5000, category: 'simple', tokenLimit: 400 };
  }

  // === TIER 4: REASONING — 9 models, 10s ===
  const reasoningPatterns = ['why','how come','what happens if','consequences','implications','cause and effect','because','therefore','logical','deductive','inductive','reasoning','justify','rationale','explain why'];
  if (reasoningPatterns.some(p => lower.includes(p)) || wordCount > 25) {
    const pool = filterByPlan(MODEL_POOLS.reasoning);
    return { models: pool, quorum: Math.min(3, pool.length), whipMs: 10000, category: 'reasoning', tokenLimit: 700 };
  }

  // === TIER 3: DEFAULT — 5 medium models, 8s ===
  const defaultPool = filterByPlan(MODEL_POOLS.default);
  return { models: defaultPool, quorum: Math.min(3, defaultPool.length), whipMs: COUNCIL_WHIP_MS, category: 'default', tokenLimit: 600 };
};

// ===== CORS =====
const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
const isVercelPreview = (origin) => origin && origin.includes('.vercel.app');

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const lower = origin.toLowerCase();
    if (allowedOrigins.map(o => o.toLowerCase()).includes(lower)) return callback(null, true);
    if (process.env.NODE_ENV === 'development') return callback(null, true);
    if (isVercelPreview(lower)) return callback(null, true);
    console.warn(`[CORS BLOCKED] ${origin}`);
    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400
}));

// ===== SECURITY HEADERS =====
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", process.env.FRONTEND_URL, 'https://*.clerk.com', 'https://*.stripe.com', 'https://api.openai.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://*.clerk.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://image.pollinations.ai'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      frameAncestors: ["'none'"],
      formAction: ["'self'", 'https://*.stripe.com'],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true,
  xFrameOptions: 'DENY',
  xPermittedCrossDomainPolicies: 'none'
}));

// ===== REQUEST FINGERPRINTING =====
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  req.clientFingerprint = crypto.createHash('sha256').update(req.ip + (req.headers['user-agent'] || '')).digest('hex').slice(0, 16);
  next();
});

// ===== STRIPE WEBHOOK =====
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing signature');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    Sentry.captureException(err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  console.log('Stripe event:', event.type);
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_email || session.customer_details?.email;
      if (email) await supabase.from('users').update({ plan: 'pro', stripe_customer_id: session.customer, stripe_subscription_id: session.subscription }).eq('email', email.toLowerCase());
    }
    if (event.type === 'invoice.paid') await supabase.from('users').update({ plan: 'pro' }).eq('stripe_customer_id', event.data.object.customer);
    if (['customer.subscription.deleted', 'customer.subscription.updated'].includes(event.type)) {
      const sub = event.data.object;
      await supabase.from('users').update({ plan: sub.status === 'active' ? 'pro' : 'free' }).eq('stripe_subscription_id', sub.id);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook processing error:', err.message);
    Sentry.captureException(err);
    res.status(500).send('Webhook processing failed');
  }
});

// ===== PERFORMANCE =====
app.use(compression());
app.use(timeout('120s'));
app.use((req, res, next) => { if (req.timedout) return res.status(503).json({ error: 'Request timeout' }); next(); });

// ===== RATE LIMITING =====
const rlKey = (req) => req.auth?.userId || req.clientFingerprint || req.ip || 'unknown';
const createLimiter = (windowMs, max, msg) => rateLimit({
  windowMs, max, message: { error: msg }, standardHeaders: true, legacyHeaders: false,
  keyGenerator: rlKey,
  skip: (req) => req.path === '/health' || req.path === '/api/stripe/webhook',
  handler: (req, res, next, opts) => {
    console.warn(`[RATE LIMIT] ${req.requestId} | ${req.method} ${req.path}`);
    Sentry.captureMessage(`Rate limit: ${req.method} ${req.path}`);
    res.status(429).json({ error: msg });
  }
});

app.use('/api/', createLimiter(60000, 120, 'Too many requests. Slow down.'));
app.use('/api/council', createLimiter(60000, 15, 'Too many council requests. Wait a minute.'));
app.use('/api/vision', createLimiter(60000, 10, 'Too many vision requests. Wait a minute.'));
app.use('/api/overlay', createLimiter(60000, 30, 'Too many overlay requests. Wait a minute.'));
app.use('/api/image', createLimiter(60000, 10, 'Too many image requests. Wait a minute.'));
app.use('/api/create-checkout-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/create-portal-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/admin/', createLimiter(60000, 60, 'Too many admin requests.'));

// ===== JSON BODY PARSER =====
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== INPUT SANITIZATION =====
const MAX_PROMPT = 10000000000000000;
const MAX_HISTORY = 20;
const ALLOWED_ROLES = ['user', 'assistant', 'system'];

const sanitizeString = (str, max = 200) => typeof str === 'string' ? str.trim().slice(0, max) : '';

const validatePrompt = (p) => {
  if (!p || typeof p !== 'string') return { valid: false, error: 'Prompt is required' };
  const t = p.trim();
  if (!t) return { valid: false, error: 'Prompt cannot be empty' };
  if (t.length > MAX_PROMPT) return { valid: false, error: `Prompt exceeds ${MAX_PROMPT} characters` };
  return { valid: true, value: t };
};

const validateHistory = (h) => {
  if (!h) return [];
  if (!Array.isArray(h)) return { valid: false, error: 'History must be an array' };
  if (h.length > MAX_HISTORY) return { valid: false, error: `History exceeds ${MAX_HISTORY} messages` };
  return { valid: true, value: h.filter(m => m && typeof m === 'object').map(m => ({ role: ALLOWED_ROLES.includes(m.role) ? m.role : 'user', content: typeof m.content === 'string' ? m.content.slice(0, MAX_PROMPT) : '' })).slice(0, MAX_HISTORY) };
};

// ===== SUPABASE =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// ===== CLERK =====
const requireAuth = ClerkExpressRequireAuth({ onError: (e) => ({ error: e.message || 'Authentication required' }) });

// ===== HELPERS =====
const ensureUser = async (userId) => {
  if (!userId) throw new Error('Missing userId');
  let clerkUser;
  try { clerkUser = await clerkClient.users.getUser(userId); } catch (e) { throw new Error(`Failed to fetch Clerk user: ${e.message}`); }
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
  const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
  const avatar = clerkUser?.imageUrl || null;
  const { data: existing, error: selErr } = await supabase.from('users').select('*').eq('clerk_id', userId).single();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;
  if (existing) {
    const { error: updErr } = await supabase.from('users').update({ email, name, avatar_url: avatar }).eq('clerk_id', userId);
    if (updErr) console.error('Update user failed:', updErr.message);
    return existing;
  }
  const { data: created, error: insErr } = await supabase.from('users').insert({ clerk_id: userId, email, name, avatar_url: avatar, plan: 'free' }).select().single();
  if (insErr) throw insErr;
  if (!created) throw new Error('User insert returned no data');
  return created;
};

const checkSuspended = async (req, res, next) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { data: user, error } = await supabase.from('users').select('suspended, plan').eq('clerk_id', req.auth.userId).single();
    if (error) throw error;
    if (user?.suspended) return res.status(403).json({ error: 'Account suspended' });
    req.userPlan = user?.plan || 'free';
    next();
  } catch (err) {
    console.error('Suspension check failed:', err.message);
    Sentry.captureException(err);
    return res.status(500).json({ error: 'Failed to verify account status' });
  }
};

const requireOwnership = (table, col = 'user_id') => async (req, res, next) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await ensureUser(req.auth.userId);
    const id = req.params.id;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Resource ID required' });
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ error: 'Invalid resource ID format' });
    const { data: resource, error } = await supabase.from(table).select(col).eq('id', id).single();
    if (error || !resource) return res.status(404).json({ error: 'Resource not found' });
    if (resource[col] !== user.id) {
      console.warn(`[OWNERSHIP] User ${user.id} attempted access to ${table}:${id}`);
      return res.status(403).json({ error: 'You do not have permission to access this resource' });
    }
    req.resource = resource;
    next();
  } catch (err) {
    console.error('Ownership check failed:', err.message);
    Sentry.captureException(err);
    return res.status(500).json({ error: 'Failed to verify resource ownership' });
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { data: user, error } = await supabase.from('users').select('is_admin').eq('clerk_id', req.auth.userId).single();
    if (error) throw error;
    if (!user?.is_admin) { console.warn(`[ADMIN] Non-admin attempt: ${req.auth.userId}`); return res.status(403).json({ error: 'Admin only' }); }
    next();
  } catch (err) { console.error('Admin check failed:', err.message); Sentry.captureException(err); res.status(500).json({ error: 'Failed to verify admin status' }); }
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files'), false) });

const auditLog = async (userId, action, metadata = {}) => {
  try { await supabase.from('audit_logs').insert({ user_id: userId, action, metadata, ip_address: null, created_at: new Date().toISOString() }); }
  catch (err) { console.error('Audit log failed:', err.message); }
};

// ===== AI HELPERS =====
const callModel = async (modelName, messages, temperature = 0.7, timeoutMs = 12000, maxTokens = 400) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OLLAMA_HOST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` },
      body: JSON.stringify({ model: modelName, messages, stream: false, options: { temperature, num_predict: maxTokens } }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) { const text = await res.text(); throw new Error(`Model ${modelName} error: ${res.status} ${text.slice(0, 200)}`); }
    const data = await res.json();
    return data.message?.content || data.response || '';
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') { console.warn(`[COUNCIL] ${modelName} timed out after ${timeoutMs}ms`); return ''; }
    throw err;
  }
};

const streamModel = async (res, modelName, messages, temperature = 0.5) => {
  const response = await fetch(OLLAMA_HOST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` },
    body: JSON.stringify({ model: modelName, messages, stream: true, options: { temperature } })
  });
  if (!response.ok || !response.body) throw new Error('Synthesizer failed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t);
        const delta = parsed.message?.content || parsed.response || '';
        if (delta) res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta })}\n\n`);
        if (parsed.done) res.write('data: [DONE]\n\n');
      } catch {}
    }
  }
};

const callGemini = async (modelName, prompt, maxTokens = 1024) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: maxTokens } }) });
  if (!res.ok) { const text = await res.text(); throw new Error(`Gemini error: ${res.status} ${text.slice(0, 300)}`); }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

const callGeminiVision = async (modelName, prompt, base64Image, mimeType = 'image/png', maxTokens = 2048) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  if (Buffer.byteLength(base64Image, 'base64') / (1024 * 1024) > 8) throw new Error('Image too large. Max 8MB.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }], generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens } }) });
  if (!res.ok) { const text = await res.text(); throw new Error(`Gemini error: ${res.status} ${text.slice(0, 300)}`); }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

const runCouncilWithWhip = async (models, messages, temperature = 0.6, whipMs = COUNCIL_WHIP_MS, quorum = COUNCIL_QUORUM, tokenLimit = 400) => {
  const results = [];
  let settledCount = 0, validCount = 0, resolved = false;
  return new Promise((resolve) => {
    const whipTimer = setTimeout(() => {
      if (!resolved) { resolved = true; console.log(`[WHIP] Timeout ${whipMs}ms. ${validCount}/${models.length} responded.`); resolve(results.filter(r => r.content?.trim().length > 0)); }
    }, whipMs);
    const checkDone = () => {
      if (resolved) return;
      if (validCount >= quorum) { resolved = true; clearTimeout(whipTimer); console.log(`[WHIP] Quorum: ${validCount}/${models.length}`); resolve(results.filter(r => r.content?.trim().length > 0)); return; }
      if (settledCount >= models.length) { resolved = true; clearTimeout(whipTimer); resolve(results.filter(r => r.content?.trim().length > 0)); }
    };
    models.forEach((model) => {
      callModel(model, messages, temperature, whipMs, tokenLimit)
        .then((content) => { settledCount++; if (content?.trim()) { validCount++; results.push({ model, content }); } checkDone(); })
        .catch((err) => { settledCount++; console.warn(`[WHIP] ${model} failed: ${err.message}`); checkDone(); });
    });
  });
};

// ===== CLASSIFIERS =====
const needsRealTimeSearch = (text) => ['today','now','currently','latest','news','score','weather','stock','price','who won','what happened','election','launched','released','update','breaking'].some(t => text.toLowerCase().includes(t));
const wantsDetailedAnswer = (text) => ['explain in detail','detailed','in depth','comprehensive','thorough','step by step','deep dive','elaborate','full explanation'].some(t => text.toLowerCase().includes(t));

const searchBrave = async (query) => {
  if (!BRAVE_API_KEY) return [];
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query.slice(0, 200))}&count=4`, { method: 'GET', headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map(r => ({ title: r.title?.slice(0, 200) || '', url: r.url, description: r.description?.slice(0, 400) || '' }));
  } catch (err) { console.error('[BRAVE] Failed:', err.message); return []; }
};

// ===== HEALTH =====
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== COUNCIL =====
app.post('/api/council', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { message, history = [], temperature } = req.body;
    const pv = validatePrompt(message);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    const hv = validateHistory(history);
    if (!hv.valid && hv.error) return res.status(400).json({ error: hv.error });

    const userPlan = user.plan || 'free';
    const isDetailed = wantsDetailedAnswer(pv.value);
    const creativity = typeof temperature === 'number' ? Math.max(0, Math.min(1, temperature)) : 0.6;

    const selection = classifyAndSelectModels(pv.value, userPlan);
    const councilModels = COUNCIL_TURBO ? selection.models.slice(0, 4) : selection.models;
    const whipMs = selection.whipMs;
    const quorum = selection.quorum;
    const tokenLimit = isDetailed ? Math.max(selection.tokenLimit, 900) : selection.tokenLimit;

    console.log(`[COUNCIL] ${user.email} | ${userPlan} | ${selection.category} | ${councilModels.length} models | Q:${quorum} | ${whipMs}ms | ${tokenLimit}tok | cr:${creativity}`);

    const councilMessages = [
      { role: 'system', content: `You are one expert voice in the ALOP-AI Council of ${councilModels.length} models answering a ${selection.category} question. ${isDetailed ? 'Be thorough and detailed.' : 'Be concise.'}` },
      ...(Array.isArray(hv) ? hv : hv.value || []).slice(-6),
      { role: 'user', content: pv.value }
    ];

    const validResponses = await runCouncilWithWhip(councilModels, councilMessages, creativity, whipMs, quorum, tokenLimit);
    if (validResponses.length === 0) return res.status(500).json({ error: 'All council models failed to respond' });

    let webContext = '';
    if (userPlan === 'pro' && needsRealTimeSearch(pv.value)) {
      const results = await searchBrave(pv.value);
      if (results.length > 0) webContext = `\n\nReal-time web search results:\n${results.map((r, i) => `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`).join('\n\n')}`;
    }

    const synthMessages = [
      { role: 'system', content: isDetailed ? 'Synthesize expert responses into a detailed, well-structured answer. Cite sources naturally.' : 'Synthesize expert responses into a concise, accurate final answer.' },
      { role: 'user', content: `User question: ${pv.value}${webContext}\n\nExpert responses:\n${validResponses.map((r, i) => `[Expert ${i + 1}]: ${r.content}`).join('\n\n')}` }
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await streamModel(res, 'glm-5.2', synthMessages, isDetailed ? 0.5 : 0.35);
    if (!res.writableEnded) res.end();

    await auditLog(user.id, 'council_message', { plan: userPlan, category: selection.category, models: councilModels.length });
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
  } catch (err) { console.error('Vision error:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
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
    const responses = await runCouncilWithWhip(OVERLAY_MODELS, overlayMessages, 0.5, 6000, 2, 600);
    if (responses.length === 0) return res.status(500).json({ error: 'Overlay models failed to respond' });
    const synth = [{ role: 'system', content: 'Synthesize expert answers into one final, concise response. Prioritize accuracy.' }, { role: 'user', content: `Question: ${pv.value}\n\nExpert answers:\n${responses.map((r, i) => `[Expert ${i + 1}]: ${r.content}`).join('\n\n')}` }];
    const answer = await callGemini('glm-5.2', synth.map(m => `${m.role}: ${m.content}`).join('\n\n'), 1024);
    await auditLog(user.id, 'overlay_request', { plan: user.plan });
    res.json({ answer });
  } catch (err) { console.error('Overlay error:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== IMAGE =====
app.post('/api/image', requireAuth, checkSuspended, async (req, res) => {
  try {
    const pv = validatePrompt(req.body.prompt);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(pv.value)}?width=1024&height=1024&nologo=true` });
  } catch (err) { Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== CHATS =====
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { data, error } = await supabase.from('chats').select('id, user_id, title, messages, pinned, favorite, created_at, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    await auditLog(user.id, 'chats_list');
    res.json(data || []);
  } catch (err) { console.error('List chats:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/chats', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const title = sanitizeString(req.body.title, 120) || 'New Chat';
    const { data, error } = await supabase.from('chats').insert({ user_id: user.id, title, messages: [] }).select().single();
    if (error) throw error;
    await auditLog(user.id, 'chat_create', { chat_id: data.id });
    res.json(data);
  } catch (err) { console.error('Create chat:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.put('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { messages, title } = req.body;
    const payload = { updated_at: new Date().toISOString() };
    if (title !== undefined) payload.title = sanitizeString(title, 120);
    if (messages !== undefined) {
      if (!Array.isArray(messages)) return res.status(400).json({ error: 'Messages must be an array' });
      payload.messages = messages.slice(0, 200).map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 10000) : '', ts: m.ts, id: m.id }));
    }
    const { error } = await supabase.from('chats').update(payload).eq('id', req.params.id).eq('user_id', user.id);
    if (error) throw error;
    await auditLog(user.id, 'chat_update', { chat_id: req.params.id });
    res.json({ ok: true });
  } catch (err) { console.error('Update chat:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.delete('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { error } = await supabase.from('chats').delete().eq('id', req.params.id).eq('user_id', user.id);
    if (error) throw error;
    await auditLog(user.id, 'chat_delete', { chat_id: req.params.id });
    res.json({ deleted: true });
  } catch (err) { console.error('Delete chat:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== ADMIN =====
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('id, clerk_id, email, name, avatar_url, plan, is_admin, suspended, created_at, stripe_subscription_id');
    if (error) throw error;
    await auditLog(req.auth.userId, 'admin_users_list');
    res.json(data || []);
  } catch (err) { console.error('Admin users:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: t } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single();
    if (t?.is_admin) return res.status(403).json({ error: 'Cannot suspend another admin' });
    const { error } = await supabase.from('users').update({ suspended: true }).eq('id', req.params.id);
    if (error) throw error;
    await auditLog(req.auth.userId, 'admin_suspend', { target: req.params.id });
    res.json({ suspended: true });
  } catch (err) { console.error('Suspend:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/:id/unsuspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('users').update({ suspended: false }).eq('id', req.params.id);
    if (error) throw error;
    await auditLog(req.auth.userId, 'admin_unsuspend', { target: req.params.id });
    res.json({ unsuspended: true });
  } catch (err) { console.error('Unsuspend:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.auth.userId === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    const { data: t } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single();
    if (t?.is_admin) return res.status(403).json({ error: 'Cannot delete another admin' });
    const { error } = await supabase.from('users').delete().eq('id', req.params.id);
    if (error) throw error;
    await auditLog(req.auth.userId, 'admin_delete_user', { target: req.params.id });
    res.json({ deleted: true });
  } catch (err) { console.error('Delete user:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/chats/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('chats').select('*').eq('user_id', req.params.userId).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { console.error('Admin chats:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/usage/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('usage').select('*').eq('user_id', req.params.userId).order('date', { ascending: false }).limit(30);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { console.error('Admin usage:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== STRIPE =====
app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const clerkUser = await clerkClient.users.getUser(req.auth.userId);
    const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
    const priceId = req.body.plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY;
    if (!priceId) throw new Error('Stripe price ID not configured');
    const session = await stripe.checkout.sessions.create({
      customer_email: user.stripe_customer_id ? undefined : email,
      customer: user.stripe_customer_id || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/?payment=success`,
      cancel_url: `${process.env.FRONTEND_URL}/?payment=cancelled`,
      metadata: { userId: req.auth.userId }
    });
    await auditLog(user.id, 'checkout_create', { plan: req.body.plan });
    res.json({ url: session.url });
  } catch (err) { console.error('Checkout:', err); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/create-portal-session', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    if (!user.stripe_customer_id) return res.status(400).json({ error: 'No subscription found' });
    const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${process.env.FRONTEND_URL}/` });
    await auditLog(user.id, 'portal_create');
    res.json({ url: session.url });
  } catch (err) { console.error('Portal:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

app.get('/api/user/plan', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    res.json({ plan: user.plan || 'free', subscription_id: user.stripe_subscription_id });
  } catch (err) { console.error('Plan:', err.message); Sentry.captureException(err); res.status(500).json({ error: err.message }); }
});

// ===== 404 =====
app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// ===== SENTRY =====
Sentry.setupExpressErrorHandler(app);

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.requestId} | ${err.message}`);
  Sentry.captureException(err);
  if (err.message?.includes('CORS blocked')) return res.status(403).json({ error: err.message });
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ===== START =====
const server = app.listen(PORT, () => {
  console.log(`ALOP-AI backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => { console.log('[SHUTDOWN] SIGTERM'); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { console.log('[SHUTDOWN] SIGINT'); server.close(() => process.exit(0)); });
