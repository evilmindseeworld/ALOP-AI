require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const timeout = require('connect-timeout');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== SECURITY & PERFORMANCE MIDDLEWARE =====
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(timeout('60s'));
app.use(haltOnTimedout);

function haltOnTimedout(req, res, next) {
  if (!req.timedout) next();
}

// ===== RATE LIMITING =====
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Too many messages. Wait a minute.' },
  skip: (req) => {
    // Optional: skip rate limit for admins
    return false;
  }
});
app.use('/api/', generalLimiter);
app.use('/chat', chatLimiter);

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
const ensureUser = async (clerkUser) => {
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress || null;
  const name = clerkUser?.fullName || clerkUser?.username || (email ? email.split('@')[0] : 'User');
  const avatar = clerkUser?.imageUrl || null;

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('clerk_id', clerkUser.id)
    .single();

  if (existing) {
    await supabase.from('users').update({
      email, name, avatar_url: avatar, last_seen: new Date().toISOString()
    }).eq('clerk_id', clerkUser.id);
    return existing;
  }

  const { data: created } = await supabase.from('users').insert({
    clerk_id: clerkUser.id, email, name, avatar_url: avatar, plan: 'free'
  }).select().single();

  return created;
};

const checkSuspended = async (req, res, next) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('suspended')
      .eq('clerk_id', req.auth.user.id)
      .single();
    if (user?.suspended) return res.status(403).json({ error: 'Account suspended' });
    next();
  } catch (err) { next(); }
};

// ===== FILE UPLOAD =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'), false);
  }
});

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== CHAT ENDPOINT =====
app.post('/chat', requireAuth, checkSuspended, upload.array('files', 5), async (req, res) => {
  try {
    const clerkUser = req.auth.user;
    const user = await ensureUser(clerkUser);
    const userId = user.id;

    const message = req.body.message || '';
    const modelType = req.body.modelType || 'glm-5.2';
    const temperature = parseFloat(req.body.temperature || '0.7');
    const history = JSON.parse(req.body.messages || '[]');

    // Increment usage
    try {
      await supabase.rpc('increment_usage', {
        p_user_id: userId,
        p_date: new Date().toISOString().split('T')[0],
        p_messages: 1,
        p_images: 0
      });
    } catch (e) { console.error('Usage increment failed', e.message); }

    // Build prompt
    const isImage = message.trim().toLowerCase().startsWith('/image') ||
      /\b(generate|create|make|draw)\s+(an?\s+)?image\b/i.test(message);

    const model = isImage ? 'kimi-k2.7-code' : modelType;

    const systemPrompt = 'You are ALOP-AI, a helpful, fast, and accurate assistant. Keep answers concise unless asked for detail.';

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-15),
      { role: 'user', content: message }
    ];

    const body = {
      model,
      messages,
      temperature,
      max_tokens: isImage ? 1024 : 4096,
      stream: true
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const API_URL = process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
    const API_KEY = process.env.AI_API_KEY;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI API error: ${response.status} ${text.slice(0, 200)}`);
    }

    const reader = response.body;
    reader.on('data', (chunk) => {
      if (res.writableEnded) return;
      const text = chunk.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta })}\n\n`);
        } catch {}
      }
    });

    reader.on('end', () => {
      if (!res.writableEnded) res.end();
    });

    reader.on('error', (err) => {
      console.error('Stream error:', err.message);
      if (!res.writableEnded) res.end();
    });

    req.on('close', () => {
      if (!res.writableEnded) res.end();
    });

  } catch (err) {
    console.error('Chat error:', err.message);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
  }
});

// ===== CHAT MANAGEMENT =====
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.user);
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
    const user = await ensureUser(req.auth.user);
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
    const user = await ensureUser(req.auth.user);
    const { error } = await supabase
      .from('chats')
      .update({ messages: req.body.messages, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.user);
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
    const { data: user } = await supabase
      .from('users')
      .select('is_admin')
      .eq('clerk_id', req.auth.user.id)
      .single();
    if (!user?.is_admin) return res.status(403).json({ error: 'Admin only' });
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
};

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, clerk_id, email, name, avatar_url, plan, is_admin, suspended, created_at');
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

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`ALOP-AI backend running on port ${PORT}`);
});
