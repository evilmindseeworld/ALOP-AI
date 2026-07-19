require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '50mb' }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// === YOUR EXISTING AI LOGIC GOES HERE ===
// Keep your current /chat endpoint logic. Just wrap it with auth.

const getOrCreateUser = async (clerkUser) => {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('clerk_id', clerkUser.id)
    .single();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('users')
    .insert({
      clerk_id: clerkUser.id,
      email: clerkUser.emailAddresses?.[0]?.emailAddress,
      name: clerkUser.username || `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || 'User',
      avatar_url: clerkUser.imageUrl,
      is_admin: false,
      plan: 'free'
    })
    .select()
    .single();

  if (error) throw error;
  return created;
};

const requireAuth = ClerkExpressRequireAuth();

// Example protected routes for chats
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    const user = await getOrCreateUser(req.auth.user);
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
    const user = await getOrCreateUser(req.auth.user);
    const { title = 'New Chat' } = req.body;
    const { data, error } = await supabase
      .from('chats')
      .insert({ user_id: user.id, title, messages: [] })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    const user = await getOrCreateUser(req.auth.user);
    const { messages } = req.body;
    const { data, error } = await supabase
      .from('chats')
      .update({ messages, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    const user = await getOrCreateUser(req.auth.user);
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  if (err.message.includes('Authorization')) return res.status(401).json({ error: 'Unauthorized' });
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
// ===== ADMIN ROUTES (protected, requires is_admin) =====

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
      .select('id, clerk_id, email, name, avatar_url, plan, is_admin, created_at');
    if (error) throw error;
    res.json(users || []);
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
app.listen(PORT, () => console.log(`ALOP-AI backend running on ${PORT}`));
