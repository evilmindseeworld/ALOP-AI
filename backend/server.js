/**
 * ALOP-AI ULTIMATE PRECISION BACKEND
 * 
 * ARCHITECTURE:
 * 1. Ingress: Auth (Clerk), validation, sanitization, rate limiting, security headers
 * 2. Memory: AI-driven memory detection → memory bypass with Supabase-persistent summary
 * 3. Greeting: Instant bypass for greetings
 * 4. Search: AI-driven search decision → 5 parallel sources (Tavily, Brave, Google, Jina, Wikipedia)
 * 5. Extraction: Strict data extraction with 12 anti-hallucination rules, temperature 0.0
 * 6. Council: Self-selecting expert council (models SKIP if outside expertise)
 * 7. Fallback: Direct streaming if all models skip
 * 8. Synthesis: Chief Synthesizer combines expert responses
 * 9. Memory Update: After each exchange, gemma4 compresses conversation into summary, saved to Supabase
 * 
 * DATA SOURCES (all run in parallel):
 * - Tavily API: AI-optimized search, full page content + images
 * - Brave Search API: 10 web results with descriptions
 * - Google Custom Search API: 10 web results + 5 images
 * - Jina AI Reader: Deep reads top page, converts to markdown
 * - Wikipedia REST API: Full article extracts for factual questions
 * 
 * CACHES:
 * - Search results: 5-minute TTL, 50 entries max
 * - Conversation summary: Persistent in Supabase users.conversation_summary column
 * 
 * ANTI-HALLUCINATION:
 * - Temperature 0.0 everywhere (zero randomness)
 * - 12 explicit extraction rules forbidding inference/guessing
 * - If no search results found, REFUSES to answer
 * - Conversation context EXEMPT from extraction rules
 * - Synthesizer forbidden from adding new information
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
const requiredEnv = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'FRONTEND_URL', 'OLLAMA_HOST', 'OLLAMA_API_KEY'
];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`Missing required env vars: ${missingEnv.join(', ')}`);
  process.exit(1);
}

// Optional env vars (enhance search but not required for startup)
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || null;
const JINA_API_KEY = process.env.JINA_API_KEY || null;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || null;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || null;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY || null;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || null;

console.log(`[ENV] Tavily: ${TAVILY_API_KEY ? 'ON' : 'OFF'} | Jina: ${JINA_API_KEY ? 'ON' : 'OFF (free)'} | Brave: ${BRAVE_API_KEY ? 'ON' : 'OFF'} | Google: ${GOOGLE_SEARCH_API_KEY && GOOGLE_CSE_ID ? 'ON' : 'OFF'}`);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const OLLAMA_HOST = process.env.OLLAMA_HOST;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// ===== MODEL ROSTER =====
const FREE_COUNCIL_MODELS = ['gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.5'];
const ALL_MODELS = [
  'gemma4', 'qwen3.5', 'glm-5.2', 'kimi-k2.5', 'minimax-m2.5',
  'kimi-k2.7-code', 'deepseek-v4-pro', 'kimi-k2.6',
  'glm-5.1', 'minimax-m3', 'minimax-m2.7',
  'nemotron-3-super', 'nemotron-3-ultra'
];
const OVERLAY_MODELS = ['deepseek-v4-pro', 'glm-5.2', 'kimi-k2.7-code'];

// ===== AI HELPERS =====

/**
 * Call a model with non-streaming response
 * @param {string} modelName - The model identifier
 * @param {Array} messages - Array of message objects {role, content}
 * @param {number} temperature - 0.0 for precision, higher for creativity
 * @param {number} timeoutMs - Abort timeout in milliseconds
 * @param {number} maxTokens - Maximum tokens to generate
 * @returns {Promise<string>} Model response content
 */
const callModel = async (modelName, messages, temperature = 0.0, timeoutMs = 30000, maxTokens = 1000) => {
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
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Model ${modelName} error: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.message?.content || data.response || '';
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return '';
    throw err;
  }
};

/**
 * Stream a model response directly to the Express response object
 * Uses Server-Sent Events (SSE) format for real-time streaming
 * @param {object} res - Express response object
 * @param {string} modelName - The model identifier
 * @param {Array} messages - Array of message objects
 * @param {number} temperature - 0.0 for precision
 */
const streamModel = async (res, modelName, messages, temperature = 0.0) => {
  const response = await fetch(OLLAMA_HOST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OLLAMA_API_KEY}` },
    body: JSON.stringify({ model: modelName, messages, stream: true, options: { temperature } })
  });
  if (!response.ok || !response.body) throw new Error('Stream model failed');
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

/**
 * Call Gemini model for text generation (used in overlay synthesis)
 * @param {string} modelName - Gemini model identifier
 * @param {string} prompt - Text prompt
 * @param {number} maxTokens - Max output tokens
 * @returns {Promise<string>} Generated text
 */
const callGemini = async (modelName, prompt, maxTokens = 1024) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error: ${res.status} ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

/**
 * Call Gemini Vision model for image analysis
 * @param {string} modelName - Gemini model identifier
 * @param {string} prompt - Text prompt describing what to analyze
 * @param {string} base64Image - Base64 encoded image data (without data URI prefix)
 * @param {string} mimeType - Image MIME type
 * @param {number} maxTokens - Max output tokens
 * @returns {Promise<string>} Analysis text
 */
const callGeminiVision = async (modelName, prompt, base64Image, mimeType = 'image/png', maxTokens = 2048) => {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  if (Buffer.byteLength(base64Image, 'base64') / (1024 * 1024) > 8) throw new Error('Image too large. Max 8MB.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }],
      generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error: ${res.status} ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

// ===== DYNAMIC COUNCIL QUORUM =====
/**
 * Run multiple models in parallel with a whip timer
 * Models self-select: reply "SKIP" if outside their expertise
 * Resolves when quorum is reached OR all models settle OR whip timer expires
 * @param {Array} models - Array of model name strings
 * @param {Array} messages - Message array to send to each model
 * @param {number} temperature - Generation temperature
 * @param {number} whipMs - Maximum wait time in milliseconds
 * @param {number} quorum - Number of valid responses needed to resolve early
 * @param {number} tokenLimit - Max tokens per model response
 * @returns {Promise<Array>} Array of {model, content} objects
 */
const runCouncilWithWhip = async (models, messages, temperature, whipMs, quorum, tokenLimit) => {
  const results = [];
  let settledCount = 0, validCount = 0, resolved = false;

  return new Promise((resolve) => {
    const whipTimer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(results); }
    }, whipMs);

    const checkDone = () => {
      if (resolved) return;
      if (validCount >= quorum) {
        resolved = true;
        clearTimeout(whipTimer);
        resolve(results);
        return;
      }
      if (settledCount >= models.length) {
        resolved = true;
        clearTimeout(whipTimer);
        resolve(results);
      }
    };

    models.forEach((model) => {
      callModel(model, messages, temperature, whipMs, tokenLimit)
        .then((content) => {
          settledCount++;
          if (content?.trim().toUpperCase().includes('SKIP')) {
            console.log(`[COUNCIL] ${model} opted out (SKIP).`);
          } else if (content?.trim().length > 3) {
            validCount++;
            results.push({ model, content });
          }
          checkDone();
        })
        .catch(() => {
          settledCount++;
          checkDone();
        });
    });
  });
};

// ===== DYNAMIC ROUTER =====
/**
 * Classify user request to determine model selection and parameters
 * @param {string} text - User's message
 * @param {string} userPlan - 'free' or 'pro'
 * @returns {object} { models, quorum, whipMs, tokenLimit, category }
 */
const classifyRequest = (text, userPlan) => {
  const lower = text.toLowerCase().trim();
  const wordCount = text.split(/\s+/).length;

  const filterByPlan = (models) => {
    if (userPlan === 'pro') return models;
    const freeSet = new Set(FREE_COUNCIL_MODELS);
    const filtered = models.filter(m => freeSet.has(m));
    return filtered.length > 0 ? filtered : FREE_COUNCIL_MODELS;
  };

  // Tier 1: Greeting (Instant)
  if (wordCount <= 4 && /hi|hello|hey|yo|sup|howdy|gm|good morning/i.test(lower)) {
    return { models: filterByPlan(['gemma4']), quorum: 1, whipMs: 5000, tokenLimit: 200, category: 'greeting' };
  }

  // Everything else: All models self-select
  return { models: filterByPlan(ALL_MODELS), quorum: 3, whipMs: 30000, tokenLimit: 2000, category: 'council' };
};

// ===== AI-DRIVEN MEMORY DETECTION =====
/**
 * Uses gemma4 to determine if the user is asking about a previous conversation
 * or referencing something discussed earlier
 * @param {string} text - User's message
 * @returns {Promise<boolean>} true if memory/reference question
 */
const isMemoryOrReferenceQuestion = async (text) => {
  const response = await callModel('gemma4', [
    { role: 'system', content: 'Is this question asking about a previous conversation, referencing something discussed earlier, or requesting continuity from prior messages? Reply ONLY with "YES" or "NO".' },
    { role: 'user', content: text.slice(0, 500) }
  ], 0.0, 3000, 10);
  return response.trim().toUpperCase().startsWith('YES');
};

// ===== AUTONOMOUS SEARCH DECISION =====
/**
 * Uses gemma4 to determine if the user's question requires web search
 * and if so, generates the optimal search query string
 * @param {string} text - User's message
 * @returns {Promise<string|null>} Search query string, or null if no search needed
 */
const getSearchQuery = async (text) => {
  const response = await callModel('gemma4', [
    { role: 'system', content: 'Analyze the user prompt. If it requires real-time internet search to answer accurately (e.g., current events, product links, specific facts, reviews, specs, prices, images), reply ONLY with the optimal search query string to find specific products or answers. If it does not require search, reply ONLY with "NO". Questions about previous conversations or references to earlier messages do NOT require search — reply "NO" for those.' },
    { role: 'user', content: text }
  ], 0.0, 4000, 50);

  const trimmed = response.trim();
  if (trimmed.toUpperCase() === 'NO' || !trimmed) return null;
  return trimmed;
};

// ===== CLASSIFIERS =====
const wantsDetailedAnswer = (text) => ['explain in detail', 'detailed', 'in depth', 'comprehensive', 'thorough', 'step by step', 'deep dive', 'elaborate', 'full explanation'].some(t => text.toLowerCase().includes(t));
const needsWikiCheck = (text) => /what is|who is|history|explain|definition|meaning of|tell me about|biography|born|origin/i.test(text);

// ===== SEARCH RESULT CACHE (5 minute TTL) =====
const searchCache = new Map();
const SEARCH_CACHE_TTL = 300000; // 5 minutes

const getCachedSearch = (query) => {
  const cached = searchCache.get(query);
  if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL) {
    console.log(`[SEARCH CACHE] Hit: "${query}"`);
    return cached.data;
  }
  if (cached) searchCache.delete(query);
  return null;
};

const setCachedSearch = (query, data) => {
  if (searchCache.size >= 50) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
  searchCache.set(query, { data, timestamp: Date.now() });
};

// ===== SEARCH 1: BRAVE SEARCH API =====
/**
 * Search the web using Brave Search API
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of {title, url, description}
 */
const searchBrave = async (query) => {
  if (!BRAVE_API_KEY) return [];
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query.slice(0, 200))}&count=10`, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map(r => ({
      title: r.title?.slice(0, 200) || '',
      url: r.url,
      description: r.description?.slice(0, 500) || ''
    }));
  } catch { return []; }
};

// ===== SEARCH 2: TAVILY AI SEARCH API =====
/**
 * Search using Tavily — AI-optimized search that returns full page content and images
 * @param {string} query - Search query
 * @returns {Promise<object>} {answer, results, images}
 */
const searchTavily = async (query) => {
  if (!TAVILY_API_KEY) return { answer: '', results: [], images: [] };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query.slice(0, 400),
        search_depth: 'advanced',
        include_answer: true,
        include_raw_content: false,
        include_images: true,
        include_image_descriptions: true,
        max_results: 5
      }),
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return { answer: '', results: [], images: [] };
    const data = await res.json();
    const results = (data.results || []).map(r => ({
      title: r.title?.slice(0, 200) || '',
      url: r.url,
      content: (r.content || '').slice(0, 3000)
    }));
    const images = (data.images || []).map(img => typeof img === 'string' ? img : (img.url || img));
    return { answer: data.answer || '', results, images };
  } catch { return { answer: '', results: [], images: [] }; }
};

// ===== SEARCH 3a: GOOGLE CUSTOM SEARCH (WEB) =====
/**
 * Search the web using Google Custom Search API
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of {title, url, description}
 */
const searchGoogleWeb = async (query) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  try {
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0, 200))}&num=10`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(r => ({
      title: r.title?.slice(0, 200) || '',
      url: r.link,
      description: (r.snippet || '').slice(0, 500)
    }));
  } catch { return []; }
};

// ===== SEARCH 3b: GOOGLE CUSTOM SEARCH (IMAGES) =====
/**
 * Search for images using Google Custom Search API
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of {url, title}
 */
const searchGoogleImages = async (query) => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_CSE_ID) return [];
  try {
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query.slice(0, 200))}&searchType=image&num=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(r => ({
      url: r.link,
      title: r.title?.slice(0, 200) || '',
      context: r.image?.contextLink || ''
    }));
  } catch { return []; }
};

// ===== SEARCH 4: JINA AI READER =====
/**
 * Fetch a web page and convert its content to clean markdown using Jina AI Reader
 * @param {string} url - URL to read
 * @returns {Promise<string>} Page content as markdown (max 3000 chars)
 */
const readPageContent = async (url) => {
  try {
    const headers = { 'Accept': 'text/markdown' };
    if (JINA_API_KEY) {
      headers['Authorization'] = `Bearer ${JINA_API_KEY}`;
    }
    const res = await fetch(`https://r.jina.ai/${url}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return '';
    const text = await res.text();
    return text.slice(0, 3000);
  } catch { return ''; }
};

// ===== SEARCH 5: WIKIPEDIA REST API =====
/**
 * Search Wikipedia and fetch article extracts
 * @param {string} query - Search query
 * @returns {Promise<string>} Article extract text (max 5000 chars)
 */
const searchWikipedia = async (query) => {
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query.slice(0, 100))}&format=json&origin=*`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!searchRes.ok) return '';
    const searchData = await searchRes.json();
    const titles = (searchData.query?.search || []).slice(0, 2).map(s => s.title);
    if (titles.length === 0) return '';

    const extractRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!extractRes.ok) return '';
    const extractData = await extractRes.json();
    const pages = extractData.query?.pages || {};
    const extracts = Object.values(pages).map(p => p.extract || '').filter(e => e.length > 100);
    return extracts.join('\n\n').slice(0, 5000);
  } catch { return ''; }
};

// ===== COMPREHENSIVE SEARCH ENGINE =====
/**
 * Run all 5 search sources in parallel, merge results, deep-read top page
 * Results are cached for 5 minutes
 * @param {string} query - Search query
 * @param {boolean} needsWiki - Whether to also search Wikipedia
 * @returns {Promise<object>} {context, sources, found, images}
 */
const comprehensiveSearch = async (query, needsWiki) => {
  console.log(`[SEARCH] Comprehensive search: "${query}" | Wiki: ${needsWiki}`);

  // Check cache first
  const cached = getCachedSearch(query);
  if (cached) return cached;

  // Run all 5 sources in parallel
  const [tavilyResult, braveResults, googleResults, googleImages, wikiContent] = await Promise.all([
    searchTavily(query),
    searchBrave(query),
    searchGoogleWeb(query),
    searchGoogleImages(query),
    needsWiki ? searchWikipedia(query) : Promise.resolve('')
  ]);

  const tavilyData = Array.isArray(tavilyResult) ? { answer: '', results: [], images: [] } : tavilyResult;
  const sources = [];
  const allImages = [];
  let fullContext = '';

  // 1. Tavily AI Answer (if available)
  if (tavilyData.answer) {
    fullContext += `TAVILY AI ANSWER: ${tavilyData.answer}\n\n---\n\n`;
  }

  // 2. Tavily Results (full content, not just snippets)
  if (tavilyData.results && tavilyData.results.length > 0) {
    fullContext += `TAVILY SEARCH RESULTS:\n${tavilyData.results.map((r, i) =>
      `SOURCE ${i + 1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`
    ).join('\n\n---\n\n')}\n\n---\n\n`;
    tavilyData.results.forEach(r => sources.push({ title: r.title, url: r.url }));
  }

  // 3. Tavily Images
  if (tavilyData.images && tavilyData.images.length > 0) {
    allImages.push(...tavilyData.images.filter(u => u && u.startsWith('http')));
  }

  // 4. Brave Search Results
  if (braveResults.length > 0) {
    fullContext += `BRAVE SEARCH RESULTS:\n${braveResults.map((r, i) =>
      `SOURCE ${i + 1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.description}`
    ).join('\n\n---\n\n')}\n\n---\n\n`;
    braveResults.forEach(r => {
      if (!sources.find(s => s.url === r.url)) sources.push({ title: r.title, url: r.url });
    });
  }

  // 5. Google Search Results
  if (googleResults.length > 0) {
    fullContext += `GOOGLE SEARCH RESULTS:\n${googleResults.map((r, i) =>
      `SOURCE ${i + 1}:\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.description}`
    ).join('\n\n---\n\n')}\n\n---\n\n`;
    googleResults.forEach(r => {
      if (!sources.find(s => s.url === r.url)) sources.push({ title: r.title, url: r.url });
    });
  }

  // 6. Google Image Results
  if (googleImages.length > 0) {
    allImages.push(...googleImages.map(img => img.url).filter(u => u && u.startsWith('http')));
  }

  // 7. Wikipedia Content
  if (wikiContent) {
    fullContext += `WIKIPEDIA CONTENT:\n${wikiContent}\n\n---\n\n`;
  }

  // 8. Deep read top page via Jina Reader (speed: 1 page)
  if (sources.length > 0) {
    console.log(`[SEARCH] Deep reading 1 page via Jina Reader...`);
    const pageContent = await readPageContent(sources[0].url);
    if (pageContent.length > 200) {
      fullContext += `FULL PAGE CONTENT (${sources[0].url}):\n${pageContent}\n\n---\n\n`;
    }
  }

  // 9. Collect images for AI to embed in response
  if (allImages.length > 0) {
    const uniqueImages = [...new Set(allImages)].slice(0, 5);
    fullContext += `AVAILABLE IMAGES (embed relevant ones using Markdown image syntax):\n${uniqueImages.map((url, i) => `IMAGE ${i + 1}: ${url}`).join('\n')}\n\n---\n\n`;
  }

  const found = sources.length > 0 || !!wikiContent || !!tavilyData.answer;
  console.log(`[SEARCH] Found: ${found} | Sources: ${sources.length} | Images: ${allImages.length} | Context: ${fullContext.length} chars`);

  const result = { context: fullContext.trim(), sources, found, images: allImages };
  setCachedSearch(query, result);
  return result;
};

// ===== CONVERSATION MEMORY (persistent in Supabase) =====
/**
 * Update the user's conversation summary in Supabase
 * Uses gemma4 to compress the previous summary + new exchange into a 2-3 sentence summary
 * This is the AI's "inner memory" — it summarizes rather than remembering every word
 * @param {string} userId - User's Supabase ID
 * @param {string} userMsg - User's message (truncated to 800 chars)
 * @param {string} assistantMsg - Assistant's response (truncated to 800 chars)
 */
const updateConversationSummary = async (userId, userMsg, assistantMsg) => {
  try {
    // Load previous summary from Supabase
    const { data: existing } = await supabase.from('users').select('conversation_summary').eq('id', userId).single();
    const prevSummary = existing?.conversation_summary || '';

    const u = userMsg.slice(0, 800);
    const a = assistantMsg.slice(0, 800);

    let newSummary = '';

    if (prevSummary) {
      // Compress previous summary + new exchange
      newSummary = await callModel('gemma4', [
        { role: 'system', content: 'Compress the previous summary and new exchange into a concise 2-3 sentence summary. Capture key facts, user preferences, decisions made, and important context. Reply ONLY with the summary, nothing else.' },
        { role: 'user', content: `Previous summary:\n${prevSummary}\n\nNew exchange:\nUser: ${u}\nAssistant: ${a}` }
      ], 0.0, 4000, 200);
    } else {
      // First exchange — create initial summary
      newSummary = await callModel('gemma4', [
        { role: 'system', content: 'Summarize this exchange in 1-2 sentences. Capture key context, facts, and user intent. Reply ONLY with the summary.' },
        { role: 'user', content: `User: ${u}\nAssistant: ${a}` }
      ], 0.0, 4000, 150);
    }

    if (newSummary.trim()) {
      // Save to Supabase (persists across server restarts)
      const { error } = await supabase.from('users').update({ conversation_summary: newSummary.trim() }).eq('id', userId);
      if (error) {
        console.error('[MEMORY] Save to Supabase failed:', error.message);
      } else {
        console.log('[MEMORY] Summary saved to Supabase.');
      }
    }
  } catch (e) {
    console.error('[MEMORY] Update failed:', e.message);
  }
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
      connectSrc: ["'self'", process.env.FRONTEND_URL, 'https://*.clerk.com', 'https://*.stripe.com'],
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
    Sentry.captureException(err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
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
    Sentry.captureException(err);
    res.status(500).send('Webhook processing failed');
  }
});

// ===== PERFORMANCE & TIMEOUT =====
app.use(compression());
app.use(timeout('300s'));
app.use((req, res, next) => { if (req.timedout) return res.status(503).json({ error: 'Request timeout' }); next(); });

// ===== RATE LIMITING =====
const rlKey = (req, res) => {
  if (req.auth?.userId) return req.auth.userId;
  if (req.clientFingerprint) return req.clientFingerprint;
  return rateLimit.ipKeyGenerator(req, res);
};

const createLimiter = (windowMs, max, msg) => rateLimit({
  windowMs, max, message: { error: msg }, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => rlKey(req, res),
  skip: (req) => req.path === '/health' || req.path === '/api/stripe/webhook',
  handler: (req, res) => {
    Sentry.captureMessage(`Rate limit: ${req.method} ${req.path}`);
    res.status(429).json({ error: msg });
  }
});

app.use('/api/', createLimiter(60000, 120, 'Too many requests. Slow down.'));
app.use('/api/council', createLimiter(60000, 30, 'Too many council requests. Wait a minute.'));
app.use('/api/vision', createLimiter(60000, 10, 'Too many vision requests. Wait a minute.'));
app.use('/api/overlay', createLimiter(60000, 30, 'Too many overlay requests. Wait a minute.'));
app.use('/api/image', createLimiter(60000, 10, 'Too many image requests. Wait a minute.'));
app.use('/api/create-checkout-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/create-portal-session', createLimiter(300000, 5, 'Too many billing requests.'));
app.use('/api/admin/', createLimiter(60000, 60, 'Too many admin requests.'));

// ===== JSON BODY PARSER =====
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ===== INPUT SANITIZATION =====
const MAX_PROMPT = 100000;
const MAX_HISTORY = 20;
const ALLOWED_ROLES = ['user', 'assistant', 'system'];

const sanitizeString = (str, max = 200) => typeof str === 'string' ? str.trim().slice(0, max) : '';

const truncatePrompt = (text, maxChars = 90000) => {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.slice(0, half) + '\n\n[...content truncated for length...]\n\n' + text.slice(-half);
};

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
  return {
    valid: true,
    value: h.filter(m => m && typeof m === 'object')
      .map(m => ({
        role: ALLOWED_ROLES.includes(m.role) ? m.role : 'user',
        content: typeof m.content === 'string' ? m.content.slice(0, MAX_PROMPT) : ''
      }))
      .slice(0, MAX_HISTORY)
  };
};

// ===== SUPABASE & CLERK =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const requireAuth = ClerkExpressRequireAuth({ onError: (e) => ({ error: e.message || 'Authentication required' }) });

/**
 * Ensure user exists in Supabase, create if not, update info if exists
 * @param {string} userId - Clerk user ID
 * @returns {Promise<object>} User record from Supabase
 */
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

/**
 * Middleware: Check if user account is suspended
 */
const checkSuspended = async (req, res, next) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { data: user, error } = await supabase.from('users').select('suspended, plan').eq('clerk_id', req.auth.userId).single();
    if (error) throw error;
    if (user?.suspended) return res.status(403).json({ error: 'Account suspended' });
    req.userPlan = user?.plan || 'free';
    next();
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: 'Failed to verify account status' });
  }
};

/**
 * Middleware: Verify resource ownership
 * @param {string} table - Supabase table name
 * @param {string} col - Column to check ownership (default: 'user_id')
 */
const requireOwnership = (table, col = 'user_id') => async (req, res, next) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await ensureUser(req.auth.userId);
    const id = req.params.id;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Resource ID required' });
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ error: 'Invalid resource ID format' });
    const { data: resource, error } = await supabase.from(table).select(col).eq('id', id).single();
    if (error || !resource) return res.status(404).json({ error: 'Resource not found' });
    if (resource[col] !== user.id) return res.status(403).json({ error: 'You do not have permission to access this resource' });
    req.resource = resource;
    next();
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: 'Failed to verify resource ownership' });
  }
};

/**
 * Middleware: Verify user is admin
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { data: user, error } = await supabase.from('users').select('is_admin').eq('clerk_id', req.auth.userId).single();
    if (error) throw error;
    if (!user?.is_admin) return res.status(403).json({ error: 'Admin only' });
    next();
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: 'Failed to verify admin status' });
  }
};

/**
 * Log an action to the audit_logs table
 * @param {string} userId - User ID
 * @param {string} action - Action name
 * @param {object} metadata - Additional metadata
 */
const auditLog = async (userId, action, metadata = {}) => {
  try {
    await supabase.from('audit_logs').insert({ user_id: userId, action, metadata, ip_address: null, created_at: new Date().toISOString() });
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
};

// ===== HEALTH =====
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== COUNCIL — MAIN AI ENDPOINT =====
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

    const selection = classifyRequest(pv.value, userPlan);
    const truncatedPrompt = truncatePrompt(pv.value);
    const histArr = Array.isArray(hv) ? hv : (hv.value || []);

    // Load conversation summary from Supabase (persistent memory)
    let convSummary = '';
    try {
      const { data: userData } = await supabase.from('users').select('conversation_summary').eq('id', user.id).single();
      convSummary = userData?.conversation_summary || '';
    } catch (e) { console.error('[MEMORY] Load failed:', e.message); }

    console.log(`[COUNCIL] ${user.email} | ${userPlan} | ${selection.category} | Memory: ${convSummary ? 'YES' : 'NO'} | History: ${histArr.length} msgs`);

    // ============================================================
    // 0. MEMORY BYPASS — AI-driven detection of memory/reference questions
    // Skips search AND council, goes straight to streaming with history
    // ============================================================
    if (await isMemoryOrReferenceQuestion(pv.value)) {
      console.log('[COUNCIL] Memory/reference question detected. Memory bypass.');
      const memoryMessages = [
        {
          role: 'system',
          content: `You are ALOP-AI. The user is asking about a previous conversation or something discussed earlier. Below is the conversation summary and message history. The history IS your memory — read it and answer based on what you see.

CRITICAL RULES:
1. Do NOT say you don't have memory, can't remember, or don't have access to previous conversations.
2. The message history below IS your conversation memory. Use it.
3. Reference specific things the user asked and specific answers you gave.
4. If the user asks "do you remember what I asked?", look at the last user message in the history and tell them what they asked.
5. If the user asks for details, look at the assistant responses in the history and extract the relevant details.
6. Be conversational and natural. Use Markdown.
${convSummary ? `\nConversation summary: ${convSummary}` : ''}`
        },
        ...histArr.slice(-10),
        { role: 'user', content: pv.value }
      ];

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', memoryMessages, 0.0);
      if (!res.writableEnded) res.end();

      // Update conversation memory (async, non-blocking)
      updateConversationSummary(user.id, pv.value, 'Answered memory/reference question.').catch(() => {});
      await auditLog(user.id, 'council_message', { plan: userPlan, category: 'memory_bypass', models: 1 });
      return;
    }

    // ============================================================
    // 1. GREETING BYPASS — Instant response for greetings
    // ============================================================
    if (selection.category === 'greeting') {
      console.log('[COUNCIL] Greeting detected. Instant bypass.');
      const greetingMessages = [
        { role: 'system', content: 'You are ALOP-AI, a friendly AI assistant. Greet the user briefly and ask how you can help.' },
        ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convSummary}` }] : []),
        { role: 'user', content: pv.value }
      ];

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', greetingMessages, 0.0);
      if (!res.writableEnded) res.end();
      await auditLog(user.id, 'council_message', { plan: userPlan, category: 'greeting', models: 1 });
      return;
    }

    // ============================================================
    // 2. SEARCH DECISION — AI determines if web search is needed
    // ============================================================
    const searchQuery = await getSearchQuery(pv.value);
    const shouldCheckWiki = needsWikiCheck(pv.value);

    // ============================================================
    // 3. SEARCH MODE — 5 parallel sources, strict extraction
    // ============================================================
    if (searchQuery) {
      const { context, sources, found, images } = await comprehensiveSearch(searchQuery, shouldCheckWiki);

      if (!found) {
        // No results from any source — REFUSE to answer (anti-hallucination)
        console.log('[COUNCIL] All search sources returned no results. Refusing.');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: "I searched multiple sources (Tavily, Brave, Google, Wikipedia) but couldn't find any results for that query. Could you rephrase or provide more specific details?" })}\n\n`);
        res.write('data: [DONE]\n\n');
        if (!res.writableEnded) res.end();
        await auditLog(user.id, 'council_message', { plan: userPlan, category: 'no_search_results', models: 0 });
        return;
      }

      // STRICT EXTRACTION MODE — extract ONLY from search data
      console.log(`[COUNCIL] ${sources.length} sources found. Strict extraction with ${context.length} chars. Images: ${images.length}.`);

      const extractionMessages = [
        {
          role: 'system',
          content: `You are a precision data extraction engine. Below is comprehensive data from multiple web sources (Tavily, Brave Search, Google Search, Wikipedia, and full page content extracted via Jina Reader). Answer the user's question using ONLY the data provided.

ABSOLUTE RULES (violating any rule is a critical failure):
1. You may ONLY state facts that appear explicitly in the provided data.
2. You may NOT use ANY knowledge from your training data.
3. You may NOT infer, guess, estimate, or extrapolate anything.
4. You may NOT compare two products unless BOTH appear in the data with their actual specifications.
5. If the data does not contain the answer to a specific question, say EXACTLY: "I couldn't find specific information about this in the search results."
6. When mentioning a product, source, or article, include the URL as a Markdown link: [Title](URL)
7. Do NOT invent specifications, prices, model numbers, features, or release dates that are not explicitly in the data.
8. If a spec is mentioned in one source but contradicted in another, note the discrepancy and cite both sources.
9. 9. Format in clean Markdown. MATCH your answer length to the question. A simple question gets a 1-3 sentence answer. A complex question gets a detailed answer. An essay request gets a full essay. Do NOT pad answers with unnecessary introductions or conclusions. Get straight to the point.
10. List your sources at the bottom of your response as clickable Markdown links under a "## Sources" heading.
11. If images are provided in the data, embed the most relevant ones in your answer using Markdown image syntax: ![Description](image_url). Place images where they are contextually relevant.
12. CONVERSATION CONTEXT and message history are EXEMPT from rules 1-5. Use them for continuity and referencing previous topics discussed.`
        },
        ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT (previous messages summary): ${convSummary}` }] : []),
        ...histArr.slice(-10),
        { role: 'user', content: `${truncatedPrompt}\n\n\n=== COMPREHENSIVE SEARCH DATA ===\n${context}` }
      ];

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', extractionMessages, 0.0);
      if (!res.writableEnded) res.end();

      // Update conversation memory
      const lastAssistant = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
      updateConversationSummary(user.id, pv.value, lastAssistant || 'Responded with search results.').catch(() => {});

      await auditLog(user.id, 'council_message', { plan: userPlan, category: 'search_extraction', models: 1, sources: sources.length, images: images.length, context_chars: context.length });
      return;
    }

    // ============================================================
    // 4. WIKIPEDIA MODE — factual questions without web search
    // ============================================================
    if (shouldCheckWiki) {
      const wikiContent = await searchWikipedia(pv.value);
      if (wikiContent) {
        console.log('[COUNCIL] Wikipedia content found. Streaming extraction.');
        const wikiMessages = [
          { role: 'system', content: 'You are a precision data extraction engine. Below is content from Wikipedia. Answer the user\'s request directly. Match your response length to the question — simple questions get short answers, complex questions get detailed ones. If you don\'t know, say "I don\'t have enough information." Do NOT guess. Use Markdown.
          ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convSummary}` }] : []),
          ...histArr.slice(-10),
          { role: 'user', content: `${truncatedPrompt}\n\n\n=== WIKIPEDIA CONTENT ===\n${wikiContent}` }
        ];

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        await streamModel(res, 'glm-5.2', wikiMessages, 0.0);
        if (!res.writableEnded) res.end();

        updateConversationSummary(user.id, pv.value, 'Responded with Wikipedia content.').catch(() => {});
        await auditLog(user.id, 'council_message', { plan: userPlan, category: 'wiki_extraction', models: 1 });
        return;
      }
    }

    // ============================================================
    // 5. COUNCIL MODE — Self-selecting expert council
    // All models receive the prompt. Irrelevant models reply "SKIP".
    // ============================================================
    const councilMessages = [
      {
        role: 'system',
        content: `You are an elite AI expert in the ALOP-AI Council. Analyze the user's request. If this request is completely outside your core expertise or capabilities, reply ONLY with the word "SKIP". If you choose to answer, be direct and match your response length to the question's complexity. Simple questions get short answers. Complex questions get detailed answers. Use Markdown. If CONVERSATION CONTEXT or history is provided, use it for continuity. ${isDetailed ? 'Be thorough and detailed.' : 'Be concise — do not over-explain simple questions.'}

      ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT (previous messages summary): ${convSummary}` }] : []),
      ...histArr.slice(-10),
      { role: 'user', content: truncatedPrompt }
    ];

    const validResponses = await runCouncilWithWhip(selection.models, councilMessages, 0.0, selection.whipMs, selection.quorum, selection.tokenLimit);

    // ============================================================
    // 6. FALLBACK — If all models skip or fail, stream directly
    // ============================================================
    if (validResponses.length === 0) {
      console.log('[COUNCIL] No valid responses. Streaming fallback generalist.');
      const fallbackMessages = [
        { role: 'system', content: 'You are a helpful AI assistant. Answer the user\'s request directly and concisely. If you do not know the answer, say "I don\'t have enough information to answer that accurately." Do NOT guess or invent information. If CONVERSATION CONTEXT or message history is provided, use it for continuity and reference previous topics. Use Markdown for formatting.' },
        ...(convSummary ? [{ role: 'system', content: `CONVERSATION CONTEXT: ${convSummary}` }] : []),
        ...histArr.slice(-10),
        { role: 'user', content: truncatedPrompt }
      ];

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      await streamModel(res, 'glm-5.2', fallbackMessages, 0.0);
      if (!res.writableEnded) res.end();

      updateConversationSummary(user.id, pv.value, 'Responded via fallback.').catch(() => {});
      await auditLog(user.id, 'council_message', { plan: userPlan, category: 'fallback', models: 1 });
      return;
    }

    // ============================================================
    // 7. SYNTHESIS — Chief Synthesizer combines expert responses
    // ============================================================
    const synthMessages = [
      { role: 'system', content: 'You are the Chief Synthesizer of the ALOP-AI Council. Combine the expert responses into ONE cohesive answer. Do NOT add information not in the responses. Do NOT invent facts. Do NOT mention expert names. Remove redundancy and padding. Match the answer length to the question complexity. Use Markdown.
 for formatting.' },
      { role: 'user', content: `User question: ${truncatedPrompt}\n\nExpert responses:\n${validResponses.map((r, i) => `[Expert ${i + 1}]: ${r.content}`).join('\n\n')}` }
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    await streamModel(res, 'glm-5.2', synthMessages, 0.0);
    if (!res.writableEnded) res.end();

    // Update conversation memory
    const lastAssistant = histArr.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
    updateConversationSummary(user.id, pv.value, lastAssistant || validResponses[0]?.content?.slice(0, 800) || 'Responded via council.').catch(() => {});

    await auditLog(user.id, 'council_message', { plan: userPlan, category: selection.category, models: validResponses.length });
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
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
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
    if (responses.length === 0) return res.status(500).json({ error: 'Overlay models failed to respond' });
    const synth = [
      { role: 'system', content: 'Synthesize expert answers into one final, concise response. Prioritize accuracy. Do not add information not present in expert responses.' },
      { role: 'user', content: `Question: ${pv.value}\n\nExpert answers:\n${responses.map((r, i) => `[Expert ${i + 1}]: ${r.content}`).join('\n\n')}` }
    ];
    const answer = await callGemini('glm-5.2', synth.map(m => `${m.role}: ${m.content}`).join('\n\n'), 1024);
    await auditLog(user.id, 'overlay_request', { plan: user.plan });
    res.json({ answer });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== IMAGE GENERATION =====
app.post('/api/image', requireAuth, checkSuspended, async (req, res) => {
  try {
    const pv = validatePrompt(req.body.prompt);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    res.json({ url: `https://image.pollinations.ai/prompt/${encodeURIComponent(pv.value)}?width=1024&height=1024&nologo=true` });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== CHATS =====
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { data, error } = await supabase.from('chats').select('id, user_id, title, messages, pinned, favorite, created_at, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const title = sanitizeString(req.body.title, 120) || 'New Chat';
    const { data, error } = await supabase.from('chats').insert({ user_id: user.id, title, messages: [] }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { messages, title } = req.body;
    const payload = { updated_at: new Date().toISOString() };
    if (title !== undefined) payload.title = sanitizeString(title, 120);
    if (messages !== undefined) {
      if (!Array.isArray(messages)) return res.status(400).json({ error: 'Messages must be an array' });
      payload.messages = messages.slice(0, 200).map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.slice(0, 100000) : '',
        ts: m.ts,
        id: m.id
      }));
    }
    const { error } = await supabase.from('chats').update(payload).eq('id', req.params.id).eq('user_id', user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chats/:id', requireAuth, requireOwnership('chats'), async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    const { error } = await supabase.from('chats').delete().eq('id', req.params.id).eq('user_id', user.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== ADMIN =====
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('id, clerk_id, email, name, avatar_url, plan, is_admin, suspended, created_at, stripe_subscription_id');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: t } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single();
    if (t?.is_admin) return res.status(403).json({ error: 'Cannot suspend another admin' });
    const { error } = await supabase.from('users').update({ suspended: true }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ suspended: true });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/unsuspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('users').update({ suspended: false }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ unsuspended: true });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.auth.userId === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    const { data: t } = await supabase.from('users').select('is_admin').eq('id', req.params.id).single();
    if (t?.is_admin) return res.status(403).json({ error: 'Cannot delete another admin' });
    const { error } = await supabase.from('users').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ deleted: true });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/chats/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('chats').select('*').eq('user_id', req.params.userId).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/usage/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('usage').select('*').eq('user_id', req.params.userId).order('date', { ascending: false }).limit(30);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
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
    res.json({ url: session.url });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/create-portal-session', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    if (!user.stripe_customer_id) return res.status(400).json({ error: 'No subscription found' });
    const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${process.env.FRONTEND_URL}/` });
    res.json({ url: session.url });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/plan', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.auth.userId);
    res.json({ plan: user.plan || 'free', subscription_id: user.stripe_subscription_id });
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== 404 & ERRORS =====
app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));
Sentry.setupExpressErrorHandler(app);
app.use((err, req, res, next) => {
  Sentry.captureException(err);
  if (err.message?.includes('CORS blocked')) return res.status(403).json({ error: err.message });
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ===== START =====
const server = app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║   ALOP-AI ULTIMATE PRECISION BACKEND                 ║`);
  console.log(`║   Port: ${PORT}                                       ║`);
  console.log(`║   Environment: ${process.env.NODE_ENV || 'development'}                    ║`);
  console.log(`║   Models: ${ALL_MODELS.length} | Temperature: 0.0 (Precision)       ║`);
  console.log(`║   Search: T=${TAVILY_API_KEY?'ON':'OFF'} B=${BRAVE_API_KEY?'ON':'OFF'} G=${GOOGLE_SEARCH_API_KEY&&GOOGLE_CSE_ID?'ON':'OFF'} J=${JINA_API_KEY?'ON':'OFF'} Wiki=ON   ║`);
  console.log(`║   Memory: Supabase persistent | Search cache: 5min  ║`);
  console.log(`║   Images: Enabled | Anti-hallucination: 12 rules    ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
