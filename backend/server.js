const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

Sentry.init({
  dsn: "https://83e051994bba3e7ae40145510653a0b6@o4511779597647872.ingest.de.sentry.io/4511779863330896",
  integrations: [
    Sentry.httpIntegration(),
    Sentry.expressIntegration(),
    nodeProfilingIntegration(),
  ],
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
const { createClient } = require('@supabase/supabase-js');
const { ClerkExpressRequireAuth, clerkClient } = require('@clerk/clerk-sdk-node');
const Stripe = require('stripe');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20'
});

const OLLAMA_HOST = process.env.OLLAMA_HOST;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

// ===== THE WHIP: SPEED CONTROLS =====
const COUNCIL_WHIP_MS = parseInt(process.env.COUNCIL_WHIP_MS, 10) || 8000;
const COUNCIL_QUORUM = parseInt(process.env.COUNCIL_QUORUM, 10) || 4;
const COUNCIL_TURBO = process.env.COUNCIL_TURBO === 'true';

if (!OLLAMA_HOST || !OLLAMA_API_KEY) {
  console.error('Missing OLLAMA_HOST or OLLAMA_API_KEY');
  process.exit(1);
}

const FREE_COUNCIL_MODELS = ['gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.5'];
const PRO_COUNCIL_MODELS = [
  'gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.7-code',
  'deepseek-v4-pro', 'kimi-k2.6', 'minimax-m3', 'mistral-large-3'
];

// ===== CORS =====
const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
const isVercelPreview = (origin) => origin && origin.includes('.vercel.app');

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (isVercelPreview(origin)) return callback(null, true);
    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true
}));

// ===== STRIPE WEBHOOK =====
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Stripe event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    if (email) {
      await supabase.from('users').update({
        plan: 'pro',
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription
      }).eq('email', email.toLowerCase());
    }
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    await supabase.from('users').update({ plan: 'pro' }).eq('stripe_customer_id', invoice.customer);
  }

  if (['customer.subscription.deleted', 'customer.subscription.updated'].includes(event.type)) {
    const subscription = event.data.object;
    const newPlan = subscription.status === 'active' ? 'pro' : 'free';
    await supabase.from('users').update({ plan: newPlan }).eq('stripe_subscription_id', subscription.id);
  }

  res.json({ received: true });
});

// ===== SECURITY & PERFORMANCE =====
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(timeout('120s'));
app.use(haltOnTimedout);

function haltOnTimedout(req, res, next) {
  if (req.timedout) return res.status(503).json({ error: 'Request timeout' });
  next();
}

// ===== RATE LIMITING =====
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const councilLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15,
  message: { error: 'Too many council requests. Wait a minute.' }
});

app.use('/api/', generalLimiter);
app.use('/api/council', councilLimiter);

// ===== SUPABASE =====
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ===== CLERK AUTH =====
const requireAuth = ClerkExpressRequireAuth({
  onError: (error) => ({ error: error.message || 'Authentication required' })
});

// ===== HELPERS =====
const ensureUser = async (userId) => {
  if (!userId) throw new Error('Missing userId');

  let clerkUser;
  try {
    clerkUser = await clerkClient.users.getUser(userId);
  } catch (err) {
    throw new Error(`Failed to fetch Clerk user: ${err.message}`);
  }

  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
  const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
  const avatar = clerkUser?.imageUrl || null;

  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('clerk_id', userId)
    .single();

  if (selectError && selectError.code !== 'PGRST116') throw selectError;

  if (existing) {
    const { error: updateError } = await supabase.from('users').update({
      email, name, avatar_url: avatar
    }).eq('clerk_id', userId);
    if (updateError) console.error('Update user failed:', updateError.message);
    return existing;
  }

  const { data: created, error: insertError } = await supabase.from('users').insert({
    clerk_id: userId,
    email,
    name,
    avatar_url: avatar,
    plan: 'free'
  }).select().single();

  if (insertError) throw insertError;
  if (!created) throw new Error('User insert returned no data');
  return created;
};

const checkSuspended = async (req, res, next) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { data: user, error } = await supabase
      .from('users')
      .select('suspended')
      .eq('clerk_id', req.auth.userId)
      .single();
    if (error) throw error;
    if (user?.suspended) return res.status(403).json({ error: 'Account suspended' });
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify account status' });
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'), false);
  }
});

// ===== AI HELPERS =====
const callModel = async (modelName, messages, temperature = 0.7, timeoutMs = 12000, maxTokens = 400) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OLLAMA_HOST, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OLLAMA_API_KEY}`
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Model ${modelName} error: ${res.status} ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.message?.content || data.response || '';
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.warn(`[COUNCIL] ${modelName} timed out after ${timeoutMs}ms`);
      return '';
    }
    throw err;
  }
};

const streamModel = async (res, modelName, messages, temperature = 0.5) => {
  const response = await fetch(OLLAMA_HOST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_API_KEY}`
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      stream: true,
      options: { temperature }
    })
  });

  if (!response.ok || !response.body) {
    throw new Error('Synthesizer failed');
  }

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
        if (delta) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta })}\n\n`);
        }
        if (parsed.done) {
          res.write('data: [DONE]\n\n');
        }
      } catch {}
    }
  }
};

// ===== THE WHIP: FAST COUNCIL WITH QUORUM =====
// We do not wait for all 8 models. As soon as we hit quorum (default 4),
// OR the whip timeout fires, we synthesize with whoever spoke up.
// Slow models get left behind. This cuts average response time in half
// while keeping enough voices for a good synthesis.
const runCouncilWithWhip = async (models, messages, temperature = 0.6, whipMs = COUNCIL_WHIP_MS, quorum = COUNCIL_QUORUM, tokenLimit = 400) => {
  const results = [];
  let settledCount = 0;
  let validCount = 0;
  let resolved = false;

  return new Promise((resolve) => {
    const whipTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log(`[WHIP] Timeout fired after ${whipMs}ms. ${validCount}/${models.length} models responded.`);
        resolve(results.filter((r) => r.content && r.content.trim().length > 0));
      }
    }, whipMs);

    const checkDone = () => {
      if (resolved) return;

      if (validCount >= quorum) {
        resolved = true;
        clearTimeout(whipTimer);
        console.log(`[WHIP] Quorum reached: ${validCount}/${models.length} models. Laggards skipped.`);
        resolve(results.filter((r) => r.content && r.content.trim().length > 0));
        return;
      }

      if (settledCount >= models.length) {
        resolved = true;
        clearTimeout(whipTimer);
        console.log(`[WHIP] All models settled: ${validCount}/${models.length}.`);
        resolve(results.filter((r) => r.content && r.content.trim().length > 0));
      }
    };

    models.forEach((model) => {
      callModel(model, messages, temperature, whipMs, tokenLimit)
        .then((content) => {
          settledCount++;

          if (content && content.trim().length > 0) {
            validCount++;
            results.push({ model, content });
          }

          checkDone();
        })
        .catch((err) => {
          settledCount++;
          console.warn(`[WHIP] ${model} failed: ${err.message}`);
          checkDone();
        });
    });
  });
};

const needsRealTimeSearch = (text) => {
  const lower = text.toLowerCase();

  const timeTriggers = [
    'today', 'now', 'right now', 'currently', 'at the moment', 'as of',
    'yesterday', 'tomorrow', 'tonight', 'this morning', 'this afternoon',
    'this evening', 'this week', 'this weekend', 'this month', 'this year',
    'last night', 'last week', 'last month', 'last year',
    'next week', 'next month', 'next year', 'upcoming', 'recently',
    'latest', 'most recent', 'just now', 'breaking', 'live', 'update',
    'news', 'in the news', 'happening', 'ongoing', 'developing',
    'did something happen', 'what happened', 'is happening', 'happened today'
  ];

  const sportsTriggers = [
    'football', 'soccer', 'american football', 'basketball', 'baseball',
    'tennis', 'cricket', 'rugby', 'hockey', 'ice hockey', 'volleyball',
    'golf', 'boxing', 'mma', 'ufc', 'wrestling', 'formula 1', 'f1', 'nascar',
    'motogp', 'olympics', 'world cup', 'champions league', 'premier league',
    'la liga', 'serie a', 'bundesliga', 'ligue 1', 'eredivisie', 'mls',
    'nba', 'nfl', 'mlb', 'nhl', 'ncaa', 'ipl', 'psl', 'bbl',
    'match', 'game', 'score', 'scores', 'result', 'results', 'who won',
    'winning', 'lost', 'beat', 'defeated', 'goal', 'goals', 'point', 'points',
    'team', 'teams', 'player', 'players', 'transfer', 'signed', 'traded',
    'draft', 'playoff', 'final', 'finals', 'semifinal', 'quarterfinal',
    'championship', 'tournament', 'league', 'season', 'standings', 'table',
    'fixture', 'fixtures', 'schedule', 'kickoff', 'tip off', 'face off',
    'hat trick', 'red card', 'yellow card', 'penalty', 'overtime',
    'varsity', 'athlete', 'coach', 'manager', 'owner', 'stadium'
  ];

  const financeTriggers = [
    'stock', 'stocks', 'share', 'shares', 'price', 'prices', 'trading',
    'market', 'markets', 'nasdaq', 'dow jones', 's&p 500', 'sp500', 'ftse',
    'crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'coin',
    'cryptocurrency', 'forex', 'exchange rate', 'currency', 'dollar', 'euro',
    'inflation', 'interest rate', 'fed', 'federal reserve', 'recession',
    'economy', 'economic', 'unemployment', 'gdp', 'earnings', 'ipo',
    'dividend', 'split', 'valuation', 'market cap', 'bullish', 'bearish'
  ];

  const weatherTriggers = [
    'weather', 'temperature', 'forecast', 'rain', 'snow', 'storm', 'hurricane',
    'tornado', 'typhoon', 'earthquake', 'flood', 'drought', 'tsunami',
    'volcano', 'eruption', 'wildfire', 'fire', 'air quality', 'uv index',
    'wind', 'humidity', 'sunny', 'cloudy', 'thunderstorm', 'blizzard'
  ];

  const entertainmentTriggers = [
    'movie', 'movies', 'film', 'films', 'box office', 'released', 'release date',
    'tv show', 'series', 'episode', 'season', 'netflix', 'hbo', 'disney',
    'spotify', 'album', 'song', 'single', 'concert', 'tour', 'festival',
    'celebrity', 'actor', 'actress', 'singer', 'rapper', 'musician', 'band',
    'marriage', 'divorce', 'dating', 'breakup', 'scandal', 'died', 'death',
    'passed away', 'award', 'awards', 'oscar', 'grammy', 'emmy', 'golden globe',
    'nominated', 'won an award', 'trailer', 'review', 'rating', 'rotten tomatoes',
    'trending', 'viral', 'tiktok', 'meme', 'memes'
  ];

  const politicsTriggers = [
    'election', 'elections', 'vote', 'voting', 'poll', 'polls', 'candidate',
    'president', 'prime minister', 'minister', 'senator', 'congress', 'parliament',
    'government', 'political', 'policy', 'law', 'bill', 'passed', 'signed',
    'court', 'supreme court', 'ruling', 'verdict', 'trial', 'impeached',
    'resigned', 'appointed', 'cabinet', 'ambassador', 'sanctions', 'war',
    'conflict', 'treaty', 'summit', 'protest', 'protests', 'strike', 'strikes',
    'invasion', 'ceasefire', 'negotiation', 'diplomatic', 'embassy', 'refugee'
  ];

  const techTriggers = [
    'launched', 'release', 'released', 'announcement', 'announced', 'unveiled',
    'new phone', 'new iphone', 'new samsung', 'new android', 'new app',
    'update', 'updated', 'version', 'patch', 'bug', 'security flaw', 'exploit',
    'hack', 'hacked', 'data breach', 'cyberattack', 'ai model', 'chatbot',
    'feature', 'roadmap', 'beta', 'developer conference', 'keynote', 'event',
    'crashed', 'down', 'outage', 'server', 'website not working', 'is down',
    'twitter', 'x', 'instagram', 'facebook', 'youtube', 'tiktok', 'snapchat',
    'reddit', 'linkedin', 'discord', 'threads', 'bluesky', 'mastodon'
  ];

  const scienceTriggers = [
    'space', 'nasa', 'spacex', 'rocket', 'launch', 'satellite', 'iss',
    'astronaut', 'mars', 'moon', 'james webb', 'telescope', 'discovery',
    'study', 'research', 'scientists', 'researchers', 'found', 'published',
    'pandemic', 'virus', 'covid', 'disease', 'outbreak', 'vaccine', 'mutation',
    'climate', 'global warming', 'temperature record', 'extinction', 'species'
  ];

  const travelTriggers = [
    'flight', 'flights', 'airport', 'delay', 'cancelled', 'passport', 'visa',
    'traffic', 'jam', 'road closure', 'highway', 'route', 'bus', 'train',
    'subway', 'metro', 'ferry', 'taxi', 'uber', 'lyft', 'hotel', 'booking',
    'restaurant', 'open now', 'hours today', 'closed today', 'near me',
    'population', 'capital', 'time zone', 'local time', 'currency'
  ];

  const shoppingTriggers = [
    'cheap', 'cheapest', 'price drop', 'sale', 'discount', 'deal', 'deals',
    'coupon', 'promo', 'in stock', 'out of stock', 'pre order', 'preorder',
    'buy', 'where to buy', 'best buy', 'amazon', 'ebay', 'walmart', 'target',
    'cost', 'how much does', 'worth', 'valued at', 'auction', 'bid'
  ];

  const questionPatterns = [
    'who won', 'who is winning', 'who lost', 'who is the current', 'who is the new',
    'what is the current', 'what is the latest', 'what happened to', 'what is happening',
    'when is the next', 'when did', 'where is', 'where can i watch', 'how much is',
    'is it going to', 'will it', 'did they', 'has he', 'has she', 'have they',
    'are they', 'is there', 'was there', 'are we', 'what time is', 'what day is'
  ];

  const allTriggers = [
    ...timeTriggers,
    ...sportsTriggers,
    ...financeTriggers,
    ...weatherTriggers,
    ...entertainmentTriggers,
    ...politicsTriggers,
    ...techTriggers,
    ...scienceTriggers,
    ...travelTriggers,
    ...shoppingTriggers,
    ...questionPatterns
  ];

  return allTriggers.some((trigger) => lower.includes(trigger));
};

const wantsDetailedAnswer = (text) => {
  const lower = text.toLowerCase();
  const detailTriggers = [
    'explain in detail', 'detailed', 'detailed answer', 'in depth', 'in-depth',
    'comprehensive', 'thorough', 'long answer', 'long response', 'full answer',
    'complete answer', 'write an essay', 'write a long', 'step by step',
    'step-by-step', 'all the details', 'every detail', 'elaborate', 'expand on',
    'tell me everything', 'full explanation', 'go into detail', 'deep dive',
    'break it down', 'walk me through', 'comprehensive overview', 'full overview',
    'as much detail as possible', 'be detailed', 'be thorough', 'dont be brief',
    "don't be brief", 'not brief', 'not short', 'more detail', 'more details',
    'explain more', 'explain further', 'expand', 'elaborate more', 'be more detailed'
  ];
  return detailTriggers.some((trigger) => lower.includes(trigger));
};

const searchBrave = async (query) => {
  if (!BRAVE_API_KEY) {
    console.warn('[BRAVE] API key not configured');
    return [];
  }

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=4`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': BRAVE_API_KEY
        }
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('[BRAVE] Error:', res.status, text.slice(0, 200));
      return [];
    }

    const data = await res.json();
    return (data.web?.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description
    }));
  } catch (err) {
    console.error('[BRAVE] Failed:', err.message);
    return [];
  }
};

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
// ===== AI COUNCIL CHAT =====
app.post('/api/council', requireAuth, checkSuspended, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const userPlan = user.plan || 'free';
    const { message, history = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const modelsToUse = userPlan === 'pro' ? PRO_COUNCIL_MODELS : FREE_COUNCIL_MODELS;

    const isDetailed = wantsDetailedAnswer(message);
    const modelTokenLimit = isDetailed ? 900 : 400;

    const councilModels = COUNCIL_TURBO ? modelsToUse.slice(0, 4) : modelsToUse;
    const whipMs = isDetailed ? Math.max(COUNCIL_WHIP_MS, 10000) : COUNCIL_WHIP_MS;
    const quorum = Math.min(COUNCIL_QUORUM, councilModels.length);

    const councilSystemPrompt = userPlan === 'pro'
      ? `You are one expert voice in the ALOP-AI Pro Council of ${councilModels.length} advanced AI models. Give your best individual perspective on the user question. ${isDetailed ? 'Be thorough and detailed.' : 'Be concise.'}`
      : `You are one expert voice in the ALOP-AI Council of 4 AI models. Give your best individual perspective. ${isDetailed ? 'Be thorough and detailed.' : 'Be concise.'}`;

    const councilMessages = [
      { role: 'system', content: councilSystemPrompt },
      ...history.slice(-6),
      { role: 'user', content: message }
    ];

    console.log(`[COUNCIL] User: ${user.email} | Plan: ${userPlan} | Models: ${councilModels.length} | Quorum: ${quorum} | Whip: ${whipMs}ms | Detailed: ${isDetailed} | Tokens: ${modelTokenLimit}`);

    const validResponses = await runCouncilWithWhip(councilModels, councilMessages, 0.6, whipMs, quorum, modelTokenLimit);

    if (validResponses.length === 0) {
      return res.status(500).json({ error: 'All council models failed to respond' });
    }

    console.log(`[COUNCIL] ${validResponses.length} models responded`);

    let webContext = '';
    if (userPlan === 'pro' && needsRealTimeSearch(message)) {
      const searchResults = await searchBrave(message);
      if (searchResults.length > 0) {
        webContext = `\n\nReal-time web search results:\n${searchResults.map((r, i) => `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`).join('\n\n')}`;
        console.log(`[COUNCIL] Brave returned ${searchResults.length} results`);
      }
    }

    const synthesizerMessages = [
      {
        role: 'system',
        content: isDetailed
          ? 'You are the ALOP-AI Council Synthesizer. The user has explicitly requested a detailed, thorough, or comprehensive answer. Combine the expert responses and any real-time web search results into a full, well-structured, in-depth response. Include examples, nuance, and step-by-step reasoning where helpful. Prioritize web search results for current facts, dates, sports scores, news, and recent events. Cite sources naturally when web search results are provided. Do not list individual models unless explicitly asked.'
          : 'You are the ALOP-AI Council Synthesizer. Combine the expert responses into one final, concise, accurate answer. If real-time web search results are included, prioritize them for current facts, dates, sports scores, news, and recent events. Resolve contradictions using the search results. Cite sources naturally when needed. Be brief and to the point. Avoid unnecessary detail unless the user asks for it. Do not list individual models unless explicitly asked.'
      },
      {
        role: 'user',
        content: `User question: ${message}${webContext}\n\nExpert council responses:\n${validResponses.map((r, i) => `[Expert ${i + 1}]: ${r.content}`).join('\n\n')}\n\nNow synthesize the best final answer as ALOP-AI.`
      }
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const synthTemp = isDetailed ? 0.5 : 0.35;
    await streamModel(res, 'glm-5.2', synthesizerMessages, synthTemp);

    if (!res.writableEnded) res.end();

    try {
      await supabase.rpc('increment_usage', {
        p_user_id: user.id,
        p_date: new Date().toISOString().split('T')[0],
        p_messages: 1,
        p_images: 0
      });
    } catch (e) {
      console.error('Usage increment failed:', e.message);
    }

  } catch (err) {
    console.error('Council error:', err.message);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    if (!res.writableEnded) res.end();
  }
});

// ===== IMAGE GENERATION =====
app.post('/api/image', requireAuth, checkSuspended, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });

    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    res.json({ url: imageUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== CHAT MANAGEMENT =====
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await ensureUser(req.auth.userId);
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats', requireAuth, async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await ensureUser(req.auth.userId);
    const { data, error } = await supabase
      .from('chats')
      .insert({ user_id: user.id, title: req.body.title || 'New Chat', messages: [] })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await ensureUser(req.auth.userId);
    const { error } = await supabase
      .from('chats')
      .update({
        messages: req.body.messages,
        title: req.body.title,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('user_id', user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await ensureUser(req.auth.userId);
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ADMIN ROUTES =====
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { data: user, error } = await supabase
      .from('users')
      .select('is_admin')
      .eq('clerk_id', req.auth.userId)
      .single();
    if (error) throw error;
    if (!user?.is_admin) return res.status(403).json({ error: 'Admin only' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify admin status' });
  }
};

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, clerk_id, email, name, avatar_url, plan, is_admin, suspended, created_at, stripe_subscription_id');
    if (error) throw error;
    res.json(users || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('users').update({ suspended: true }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ suspended: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/unsuspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('users').update({ suspended: false }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ unsuspended: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('users').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/chats/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/usage/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usage')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('date', { ascending: false })
      .limit(30);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== STRIPE PAYMENTS =====
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

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/create-portal-session', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    if (!user.stripe_customer_id) return res.status(400).json({ error: 'No subscription found' });
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/`
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/plan', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    res.json({ plan: user.plan || 'free', subscription_id: user.stripe_subscription_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SENTRY ERROR HANDLER =====
Sentry.setupExpressErrorHandler(app);

// ===== FALLBACK ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error(err.stack);
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(err.status || 500).json({ error: message });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`ALOP-AI backend running on port ${PORT}`);
});
