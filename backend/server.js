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

// ===== AI COUNCIL CONFIG =====
const FREE_COUNCIL_MODELS = ['gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.5'];
const PRO_COUNCIL_MODELS = [
  'gemma4', 'qwen3.5', 'glm-5.2', 'minimax-m2.5', 'kimi-k2.5',
  'deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-k2.7-code', 'kimi-k2.6',
  'glm-5.1', 'minimax-m3', 'minimax-m2.7', 'nemotron-3-super',
  'nemotron-3-ultra', 'gpt-oss', 'gemini-3-flash-preview', 'mistral-large-3'
];

const OLLAMA_HOST = process.env.OLLAMA_HOST;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

if (!OLLAMA_HOST || !OLLAMA_API_KEY) {
  console.error('Missing OLLAMA_HOST or OLLAMA_API_KEY');
  process.exit(1);
}

const callModel = async (modelName, messages, temperature = 0.7) => {
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
      options: { temperature }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Model ${modelName} error: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.message?.content || data.response || '';
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

    const councilSystemPrompt = userPlan === 'pro'
      ? 'You are one expert voice in the ALOP-AI Pro Council of 14 advanced AI models. Give your best individual perspective on the user question. Be concise but substantive.'
      : 'You are one expert voice in the ALOP-AI Council of 4 AI models. Give your best individual perspective. Be concise.';

    const councilMessages = [
      { role: 'system', content: councilSystemPrompt },
      ...history.slice(-6),
      { role: 'user', content: message }
    ];

    console.log(`[COUNCIL] User: ${user.email} | Plan: ${userPlan} | Models: ${modelsToUse.length}`);

    const responses = await Promise.allSettled(
      modelsToUse.map((model) => callModel(model, councilMessages, 0.7))
    );

    const validResponses = responses
      .map((r, i) => ({
        model: modelsToUse[i],
        content: r.status === 'fulfilled' ? r.value : null
      }))
      .filter((r) => r.content && r.content.trim().length > 0);

    if (validResponses.length === 0) {
      return res.status(500).json({ error: 'All council models failed to respond' });
    }

    console.log(`[COUNCIL] ${validResponses.length} models responded`);

    const synthesizerMessages = [
      {
        role: 'system',
        content: 'You are the ALOP-AI Council Synthesizer. Combine the following individual expert responses into one final, coherent, accurate answer. Resolve contradictions, keep the best insights, and produce a confident, helpful response. Do not list the models separately unless explicitly asked. Be concise unless detail is needed.'
      },
      {
        role: 'user',
        content: `User question: ${message}\n\nExpert council responses:\n${validResponses.map((r, i) => `[Expert ${i + 1}]: ${r.content}`).join('\n\n')}\n\nNow synthesize the best final answer as ALOP-AI.`
      }
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await streamModel(res, 'glm-5.2', synthesizerMessages, 0.5);

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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: 'Failed to verify admin status' }); }
};

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, clerk_id, email, name, avatar_url, plan, is_admin, suspended, created_at, stripe_subscription_id');
    if (error) throw error;
    res.json(users || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('users').update({ suspended: true }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ suspended: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users/:id/unsuspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('users').update({ suspended: false }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ unsuspended: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('users').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error(err.stack);
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(err.status || 500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`ALOP-AI backend running on port ${PORT}`);
});
