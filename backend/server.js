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

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ===== SECURITY & PERFORMANCE MIDDLEWARE =====
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));
app.use(compression());

const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
if (allowedOrigins.length === 0) {
  console.warn('FRONTEND_URL not set. CORS will deny requests from browsers.');
}
app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(timeout('60s'));
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
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Too many messages. Wait a minute.' }
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
    clerk_id: userId, email, name, avatar_url: avatar, plan: 'free'
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
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });

    const user = await ensureUser(req.auth.userId);
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

    const isImage = message.trim().toLowerCase().startsWith('/image') ||
      /\b(generate|create|make|draw)\s+(an?\s+)?image\b/i.test(message);

    const model = isImage ? 'gemma4' : modelType;

    const systemPrompt = 'You are ALOP-AI, a helpful, fast, and accurate assistant. Keep answers concise unless asked for detail.';

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-15),
      { role: 'user', content: message }
    ];

    // Add uploaded images to the last user message if any
    if (req.files?.length > 0) {
      const lastUser = messages[messages.length - 1];
      if (lastUser.role === 'user') {
        const content = [{ type: 'text', text: lastUser.content }];
        for (const file of req.files) {
          const base64 = file.buffer.toString('base64');
          content.push({
            type: 'image_url',
            image_url: { url: `data:${file.mimetype};base64,${base64}` }
          });
        }
        lastUser.content = content;
      }
    }

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

    const API_URL = process.env.AI_API_URL || process.env.OLLAMA_HOST || 'https://api.openai.com/v1/chat/completions';
    const API_KEY = process.env.AI_API_KEY || process.env.OLLAMA_API_KEY;

    if (!API_KEY) {
      throw new Error('AI API key is not configured (AI_API_KEY or OLLAMA_API_KEY)');
    }

    console.log('AI REQUEST URL:', API_URL);
    console.log('AI REQUEST MODEL:', model);
    console.log('AI REQUEST MESSAGES COUNT:', messages.length);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body)
    });

    console.log('AI RESPONSE STATUS:', response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error('AI ERROR BODY:', text);
      throw new Error(`AI API error: ${response.status} ${text.slice(0, 300)}`);
    }

    if (!response.body) {
      throw new Error('AI API returned no response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sentAnything = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          // Ollama native NDJSON: plain JSON lines
          if (line.trim().startsWith('{') && !line.trim().startsWith('data:')) {
            try {
              const parsed = JSON.parse(line.trim());
              const delta = parsed.message?.content || parsed.response || '';
              if (delta) {
                sentAnything = true;
                res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta })}\n\n`);
              }
              if (parsed.done) {
                res.write('data: [DONE]\n\n');
              }
            } catch (e) {
              console.error('Failed to parse Ollama native line:', line.trim(), e.message);
            }
            continue;
          }

          // OpenAI SSE format
          if (!line.trim().startsWith('data:')) continue;
          const jsonStr = line.trim().slice(5).trim();
          if (jsonStr === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || '';
            if (delta) {
              sentAnything = true;
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta })}\n\n`);
            }
          } catch (e) {
            console.error('Failed to parse SSE line:', jsonStr, e.message);
          }
        }
      }

      if (!sentAnything) {
        console.warn('AI API returned no content chunks');
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: 'No response from AI model.' })}\n\n`);
      }

      if (!res.writableEnded) res.end();
    } catch (streamErr) {
      console.error('Stream error:', streamErr.message);
      if (!res.writableEnded) res.end();
    }

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
      .update({ messages: req.body.messages, updated_at: new Date().toISOString() })
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
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(err.status || 500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`ALOP-AI backend running on port ${PORT}`);
});
