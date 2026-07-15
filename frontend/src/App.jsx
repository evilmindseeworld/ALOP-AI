import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const uid = () => crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);

const getApiUrl = () => {
  const envUrl = import.meta.env?.VITE_API_URL;
  if (envUrl) return envUrl.trim();
  try {
    const host = window.location.hostname;
    if (host.match(/^(192\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/)) return `http://${host}:3000`;
  } catch {}
  return "http://localhost:3000";
};

const API_BASE = getApiUrl();

const Storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};

const THEMES = {
  forest: { name: "Enchanted Forest", primary: "#10b981", bg: "linear-gradient(135deg, #0f2027, #203a43, #2c5364)", cardBg: "rgba(15, 32, 39, 0.92)", borderColor: "rgba(16, 185, 129, 0.25)", userBubble: "rgba(5, 150, 105, 0.2)", aiBubble: "rgba(16, 185, 129, 0.15)", snowColor: "#10b981", emoji: "🌲" },
  sunset: { name: "Mountain Sunset", primary: "#f97316", bg: "linear-gradient(135deg, #2d1b69, #ff6b6b, #ffa500)", cardBg: "rgba(45, 27, 105, 0.92)", borderColor: "rgba(249, 115, 22, 0.25)", userBubble: "rgba(249, 115, 22, 0.2)", aiBubble: "rgba(249, 115, 22, 0.15)", snowColor: "#f97316", emoji: "🌅" },
  galaxy: { name: "Milky Way", primary: "#60a5fa", bg: "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)", cardBg: "rgba(10, 10, 30, 0.92)", borderColor: "rgba(96, 165, 250, 0.25)", userBubble: "rgba(59, 130, 246, 0.2)", aiBubble: "rgba(96, 165, 250, 0.15)", snowColor: "#60a5fa", emoji: "🌠" },
  tokyo: { name: "Neo Tokyo", primary: "#ec4899", bg: "linear-gradient(135deg, #0f0c29, #302b63, #000000)", cardBg: "rgba(15, 12, 41, 0.92)", borderColor: "rgba(236, 72, 153, 0.3)", userBubble: "rgba(236, 72, 153, 0.2)", aiBubble: "rgba(236, 72, 153, 0.15)", snowColor: "#ec4899", emoji: "🗼" },
  cyberpunk: { name: "Cyberpunk Neon", primary: "#00f5d4", bg: "linear-gradient(135deg, #000000, #2b002b, #000000)", cardBg: "rgba(0, 0, 0, 0.92)", borderColor: "rgba(0, 245, 212, 0.3)", userBubble: "rgba(0, 245, 212, 0.2)", aiBubble: "rgba(0, 245, 212, 0.15)", snowColor: "#00f5d4", emoji: "霓虹" },
  obsidian: { name: "Obsidian Black", primary: "#00f5d4", bg: "linear-gradient(135deg, #000000, #0a0a0a, #111111)", cardBg: "rgba(5, 5, 5, 0.95)", borderColor: "rgba(0, 245, 212, 0.2)", userBubble: "rgba(0, 245, 212, 0.15)", aiBubble: "rgba(0, 245, 212, 0.1)", snowColor: "#00f5d4", emoji: "⚫" },
  arctic: { name: "Arctic White", primary: "#3b82f6", bg: "linear-gradient(135deg, #f0f9ff, #e0f2fe, #f0f9ff)", cardBg: "rgba(255, 255, 255, 0.95)", borderColor: "rgba(59, 130, 246, 0.3)", userBubble: "rgba(59, 130, 246, 0.2)", aiBubble: "rgba(59, 130, 246, 0.15)", snowColor: "#3b82f6", emoji: "❄️" }
};

const DEFAULT_THEME = THEMES.forest;

const SUGGESTIONS = [
  { text: "Explain quantum computing in simple terms", icon: "🔬", category: "Science" },
  { text: "Write Python code to analyze sales data", icon: "💻", category: "Coding" },
  { text: "Create a business plan for a tech startup", icon: "📊", category: "Business" },
  { text: "Explain blockchain technology and applications", icon: "🔗", category: "Technology" },
  { text: "How to optimize database performance?", icon: "🗄️", category: "Tech" },
  { text: "Write a poem about artificial intelligence", icon: "✍️", category: "Creative" }
];

const MODEL_DISPLAY_NAMES = {
  'glm-5.2': '🧠 GLM 5.2',
  'glm-5.1': '🧠 GLM 5.1',
  'gemma4:31b': '💎 Gemma 4 (31B)',
  'qwen3.5:397b': '🔍 Qwen 3.5 (397B)',
  'minimax-m2.7': '🌊 MiniMax M2.7',
  'minimax-m2.5': '🌊 MiniMax M2.5',
  'minimax-m3': '🌊 MiniMax M3',
  'nemotron-3-super': '🟢 Nemotron 3 Super',
  'nemotron-3-ultra': '🟢 Nemotron 3 Ultra',
  'nemotron-3-nano:30b': '🟢 Nemotron 3 Nano (30B)',
  'kimi-k2.7-code': '🌙 Kimi K2.7 Code',
  'kimi-k2.6': '🌙 Kimi K2.6',
  'kimi-k2.5': '🌙 Kimi K2.5',
  'deepseek-v4-flash': '⚡ DeepSeek V4 Flash',
  'deepseek-v4-pro': '⚡ DeepSeek V4 Pro',
  'gpt-oss:20b': '🔵 GPT-OSS (20B)',
  'gpt-oss:120b': '🔵 GPT-OSS (120B)',
  'mistral-large-3:675b': '🌪️ Mistral Large 3 (675B)'
};

const getModelDisplayName = (key) => MODEL_DISPLAY_NAMES[key] || key;

const MODEL_CATEGORIES = {
  '🧠 GLM Models': ['glm-5.2', 'glm-5.1'],
  '💎 Google Models': ['gemma4:31b'],
  '🔍 Alibaba Models': ['qwen3.5:397b'],
  '🌊 MiniMax Models': ['minimax-m2.7', 'minimax-m2.5', 'minimax-m3'],
  '🟢 NVIDIA Models': ['nemotron-3-super', 'nemotron-3-ultra', 'nemotron-3-nano:30b'],
  '🌙 Moonshot Models': ['kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5'],
  '⚡ DeepSeek Models': ['deepseek-v4-flash', 'deepseek-v4-pro'],
  '🔵 OpenAI Models': ['gpt-oss:20b', 'gpt-oss:120b'],
  '🌪️ Mistral Models': ['mistral-large-3:675b']
};

const useChatSession = () => {
  const [messages, setMessages] = useState(() => { try { return JSON.parse(Storage.get('pa_history') || '[]'); } catch { return []; } });
  const [sessionId] = useState(() => Storage.get('pa_session') || uid());
  const [model, setModel] = useState(() => Storage.get("pa-model") || "glm-5.2");
  const [temperature, setTemperature] = useState(() => parseFloat(Storage.get("pa-temperature")) || 0.7);
  const [streamText, setStreamText] = useState("");
  const [status, setStatus] = useState("idle");
  const [stats, setStats] = useState(null);
  const abortRef = useRef(null);
  const accRef = useRef("");
  const rafIdRef = useRef(null);

  useEffect(() => { Storage.set('pa_history', JSON.stringify(messages)); }, [messages]);
  useEffect(() => { Storage.set("pa-model", model); }, [model]);
  useEffect(() => { Storage.set("pa-temperature", temperature.toString()); }, [temperature]);

  const addMessage = useCallback((msg) => setMessages(prev => [...prev.slice(-99), msg]), []);

  const sendMessage = useCallback(async (text) => {
    if (!text?.trim() || status !== "idle") return;
    setStatus("loading");
    accRef.current = "";
    setStreamText("");
    setStats(null);
    addMessage({ role: "user", content: text, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() });

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          message: text,
          messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
          modelType: model,
          sessionId,
          temperature
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${res.status}`);
      }
      if (!res.body) throw new Error("Streaming not supported");

      setStatus("streaming");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const data = JSON.parse(jsonStr);
            if (data.type === "chunk") {
              accRef.current += data.text;
              if (!rafIdRef.current) {
                rafIdRef.current = requestAnimationFrame(() => { setStreamText(accRef.current); rafIdRef.current = null; });
              }
            } else if (data.type === "end") {
              if (data.stats) setStats(data.stats);
              addMessage({ role: "assistant", content: accRef.current, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() });
              accRef.current = "";
              setStreamText("");
              setStatus("idle");
            } else if (data.type === "error") {
              throw new Error(data.text);
            }
          } catch (parseError) { console.warn('Parse error:', parseError); }
        }
      }

      if (accRef.current) {
        addMessage({ role: "assistant", content: accRef.current, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() });
        accRef.current = "";
      }
      setStreamText("");
      setStatus("idle");
    } catch (err) {
      if (err.name === "AbortError") return;
      setStatus("error");
      addMessage({ role: "assistant", content: `⚠️ ${err.message || 'Connection failed'}`, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() });
    }
  }, [messages, model, sessionId, temperature, status, addMessage]);

  const clearChat = useCallback(() => { setMessages([]); setStreamText(""); setStatus("idle"); accRef.current = ""; setStats(null); }, []);

  return { messages, streamText, status, stats, model, setModel, temperature, setTemperature, sendMessage, clearChat };
};

const useDockStatus = () => {
  const [dock, setDock] = useState({ active: 0, requests: [] });
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const r = await fetch(`${API_BASE}/api/dock`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!cancelled) { const data = await r.json(); setDock(data); }
      } catch { if (!cancelled) setDock({ active: 0, requests: [] }); }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return dock;
};

const useHealthCheck = () => {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const r = await fetch(`${API_BASE}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!cancelled) {
          const d = await r.json();
          setHealth(d.status === 'premium' ? d : { status: 'degraded', error: d.error || 'Service disconnected' });
        }
      } catch (err) { if (!cancelled) setHealth({ status: 'error', error: err.name === 'AbortError' ? 'Timeout' : 'Connection failed' }); }
    };
    check();
    const id = setInterval(check, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return health;
};

const GlobalStyles = () => (
  <style>{`
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; overflow:hidden; height:100vh; background: #000000; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    .app-root { min-height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; background: var(--bg); padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .particles { position: fixed; inset:0; z-index:0; pointer-events:none; opacity:.2; }
    .particle { position: absolute; border-radius: 50%; background: var(--snow-color, #10b981); opacity: 0.4; animation: float var(--duration, 20s) infinite ease-in-out; }
    @keyframes float { 0%, 100% { transform: translate(0, 0) rotate(0deg); opacity: 0.4; } 25% { transform: translate(15px, -15px) rotate(90deg); opacity: 0.6; } 50% { transform: translate(0, -30px) rotate(180deg); opacity: 0.3; } 75% { transform: translate(-15px, -15px) rotate(270deg); opacity: 0.6; } }
    .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,.95); color: #fff; padding: 14px 24px; border-radius: 16px; z-index: 9999; font-size: 14px; backdrop-filter: blur(12px); animation: toastIn .3s ease forwards; display:flex; align-items:center; gap:10px; border-left: 4px solid var(--primary); box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 90vw; }
    @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(-10px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
    .glass-main { position: relative; z-index: 10; width: min(96vw, 840px); height: min(96vh, 920px); background: var(--card-bg); backdrop-filter: blur(24px) saturate(1.5); border: 1px solid var(--border); border-radius: 24px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 100px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,.1); }
    .app-header { display: flex; align-items: center; gap: 14px; padding: 18px 22px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .logo-box { width: 44px; height: 44px; border-radius: 16px; background: rgba(255,255,255,.08); display:flex; align-items:center; justify-content:center; font-size: 22px; cursor: pointer; position: relative; border: 1px solid var(--border); transition: all .3s cubic-bezier(0.4, 0, 0.2, 1); }
    .logo-box:hover { transform: scale(1.08); background: rgba(255,255,255,.12); box-shadow: 0 0 20px var(--primary); }
    .logo-box .glow { position:absolute; inset:-6px; border-radius:22px; opacity:0; background: radial-gradient(circle, var(--primary), transparent 70%); transition: opacity .4s ease; pointer-events:none; z-index: -1; }
    .logo-box:hover .glow { opacity:.4; }
    .title-group { flex:1; min-width:0; }
    .main-title { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -.2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom: 2px; }
    .sub-title { font-size: 12px; opacity:.6; letter-spacing: 1px; text-transform: uppercase; }
    .header-actions { display:flex; gap:10px; align-items:center; position:relative; }
    .icon-btn { width:40px; height:40px; border-radius:14px; border:1px solid transparent; background: rgba(255,255,255,.08); color:#fff; font-size:17px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all .2s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0; }
    .icon-btn:hover { background:rgba(255,255,255,.15); border-color:var(--border); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    .icon-btn.active { background: var(--primary); color: #000000; border-color: transparent; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .dot { width: 26px; height: 26px; border-radius:50%; border:2px solid rgba(255,255,255,.2); cursor:pointer; transition: all .25s cubic-bezier(0.4, 0, 0.2, 1); background: var(--color); }
    .dot:hover { transform: scale(1.25); border-color: rgba(255,255,255,.5); box-shadow: 0 0 10px var(--color); }
    .dot.active { border-color: #fff; box-shadow: 0 0 15px var(--color); }
    .app-content { flex:1; display:flex; flex-direction:column; position:relative; overflow:hidden; }
    .settings-drawer { background: rgba(0,0,0,.5); backdrop-filter:blur(16px); padding: 18px 22px; border-bottom: 1px solid var(--border); max-height: 70vh; overflow-y: auto; }
    .setting-row { margin-bottom: 16px; display:flex; flex-direction:column; gap:10px; }
    .setting-label { color:rgba(255,255,255,.7); font-size:14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .theme-grid { display:flex; gap:10px; flex-wrap:wrap; }
    .theme-card { padding: 10px 16px; border-radius:14px; border:1px solid var(--border); background:rgba(255,255,255,.07); color:#fff; cursor:pointer; font-size:13px; display:flex; align-items:center; gap:8px; transition: all .25s cubic-bezier(0.4, 0, 0.2, 1); flex: 1; min-width: 120px; }
    .theme-card:hover { background:rgba(255,255,255,.12); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .theme-card.selected { border-color: var(--primary); background: rgba(255,255,255,.12); box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
    .model-select-container { padding: 12px 16px; border-radius:14px; border:1px solid var(--border); background:rgba(255,255,255,.08); color:#fff; font-size:14px; }
    .model-select { width: 100%; background: transparent; border: none; color: #fff; font-size: 14px; outline: none; cursor: pointer; padding: 4px 0; }
    .model-select option, .model-select optgroup { background: #0a0a0a; color:#fff; }
    .slider-container { display: flex; align-items: center; gap: 12px; }
    .slider { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,.1); outline: none; -webkit-appearance: none; }
    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--primary); cursor: pointer; }
    .search-bar { display:flex; align-items:center; gap:10px; margin: 12px 18px; padding: 12px 18px; border-radius:16px; background:rgba(255,255,255,.07); border:1px solid var(--border); flex-shrink: 0; }
    .search-bar input { flex:1; background:none; border:none; outline:none; color:#fff; font-size:15px; caret-color:var(--primary); }
    .search-bar button { background:none; border:none; color:rgba(255,255,255,.5); cursor:pointer; font-size:16px; padding:4px 8px; border-radius: 6px; transition: all .2s; }
    .search-bar button:hover { background: rgba(255,255,255,.1); color: #fff; }
    .scroll-wrapper { flex:1; overflow-y:auto; scroll-behavior:smooth; padding:18px; display:flex; flex-direction:column; gap:16px; -webkit-overflow-scrolling: touch; }
    .scroll-wrapper::-webkit-scrollbar { width:8px; }
    .scroll-wrapper::-webkit-scrollbar-track { background:transparent; }
    .scroll-wrapper::-webkit-scrollbar-thumb { background:var(--border); border-radius:4px; }
    .msg-row { display:flex; gap:12px; max-width:90%; animation: msgIn .3s cubic-bezier(0.4, 0, 0.2, 1); }
    .msg-row.user { align-self: flex-end; flex-direction: row-reverse; }
    .msg-row.assistant { align-self: flex-start; }
    @keyframes msgIn { from { opacity:0; transform:translateY(15px);} to { opacity:1; transform:translateY(0);} }
    .avatar { width:38px; height:38px; border-radius:14px; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; background:rgba(255,255,255,.1); border: 1px solid var(--border); }
    .bubble { padding: 14px 18px; border-radius: 20px; font-size: 15px; line-height: 1.6; word-break: break-word; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 100%; }
    .msg-row.user .bubble { background: var(--user-bubble, rgba(16, 185, 129, 0.2)); color:#e0f2fe; border-bottom-right-radius:8px; }
    .msg-row.assistant .bubble { background: var(--ai-bubble, rgba(16, 185, 129, 0.15)); color:rgba(255,255,255,.92); border:1px solid var(--border); border-bottom-left-radius:8px; }
    .msg-meta { font-size:11px; opacity:.5; margin-top:6px; text-align: right; }
    .error-banner { display:flex; gap:12px; align-items:center; padding: 14px 18px; margin:10px 18px; border-radius:16px; background: rgba(239,68,68,.15); border: 1px solid rgba(239,68,68,.4); font-size:14px; color:#fca5a5; flex-shrink:0; }
    .empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:40px 24px; text-align: center; }
    .logo-big { font-size:64px; margin-bottom:12px; filter: drop-shadow(0 8px 24px rgba(0,0,0,.5)); animation: floatSubtle 4s ease-in-out infinite; }
    @keyframes floatSubtle { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
    .empty-title { font-size: 24px; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .empty-subtitle { color:rgba(255,255,255,.5); font-size:14px; max-width:380px; line-height: 1.6; }
    .suggestions { display:flex; flex-wrap:wrap; gap:12px; justify-content:center; margin-top:20px; max-width: 520px; }
    .suggestion-btn { padding:12px 18px; border-radius:16px; border:1px solid var(--border); background:rgba(255,255,255,.08); color:#fff; cursor:pointer; font-size:14px; display:flex; align-items:center; gap:10px; transition: all .25s cubic-bezier(0.4, 0, 0.2, 1); text-align: left; flex: 1; min-width: 200px; }
    .suggestion-btn:hover { background:rgba(255,255,255,.12); transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.15); }
    .suggestion-category { font-size: 10px; opacity: 0.6; margin-top: 4px; }
    @keyframes blink { 0%,100%{opacity:1;} 50%{opacity:.3;} }
    .typing-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); margin-left: 4px; animation: blink 1s infinite; }
    @media (max-width: 640px) {
      .glass-main { width: 100vw; height: 100vh; border-radius: 0; max-height: none; }
      .scroll-wrapper { padding: 14px 10px; gap: 12px; }
      .bubble { font-size: 14.5px; padding: 12px 16px; }
      .msg-row { max-width: 92%; }
      .suggestions { gap: 10px; }
      .suggestion-btn { min-width: 160px; font-size: 13px; padding: 10px 14px; }
    }
    @media (max-width: 480px) {
      .app-header { padding: 14px 16px; gap: 10px; }
      .logo-box { width: 38px; height: 38px; font-size: 18px; }
      .main-title { font-size: 18px; }
      .sub-title { font-size: 10px; }
      .theme-card { min-width: 100px; font-size: 12px; padding: 8px 12px; }
    }
  `}</style>
);

const DockPanel = ({ dock }) => (
  <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,.4)", flexShrink: 0 }}>
    <div style={{ fontSize: 12, opacity: .6, marginBottom: 10, display: "flex", justifyContent: "space-between", fontWeight: 500 }}>
      📡 Active Requests • {dock?.active || 0}
    </div>
    {(dock?.requests || []).slice(0, 3).map(r => (
      <div key={r.id || Math.random()} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, marginBottom: 6, color: "#fff" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: r.status === 'completed' ? '#22c55e' : r.status === 'error' ? '#ef4444' : 'var(--primary)', animation: r.status === 'processing' ? 'blink 1.2s infinite' : 'none', flexShrink: 0 }} />
        <span style={{ flex: 1, fontWeight: 500 }}>{getModelDisplayName(r.model)}</span>
        <span style={{ opacity: .5, fontSize: 12, fontWeight: 500 }}>{Math.min(100, Math.round(r.progress || 0))}%</span>
      </div>
    ))}
    {dock?.requests?.length > 3 && <div style={{ fontSize: 11, opacity: .4, textAlign: "center", marginTop: 4 }}>+{dock.requests.length - 3} more</div>}
  </div>
);

const InputBar = ({ onSend, disabled, status, stats }) => {
  const [text, setText] = useState("");
  const ref = useRef(null);
  const handleSubmit = () => { if (!text.trim() || disabled) return; onSend(text); setText(""); ref.current?.focus(); };
  return (
    <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)", flexShrink: 0, background: "rgba(0,0,0,.3)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
        <input ref={ref} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }} placeholder={status === "loading" ? "AI is thinking..." : "Ask anything..."} disabled={disabled} style={{ flex: 1, padding: "14px 18px", borderRadius: 18, border: "1px solid var(--border)", background: "rgba(255,255,255,.08)", color: "#fff", fontSize: 15, outline: "none", caretColor: "var(--primary)", transition: "all .2s" }} />
        <button onClick={handleSubmit} disabled={!text.trim() || disabled} style={{ padding: "0 24px", borderRadius: 18, border: "none", cursor: text.trim() && !disabled ? "pointer" : "not-allowed", background: text.trim() && !disabled ? "var(--primary)" : "rgba(255,255,255,.1)", color: text.trim() && !disabled ? "#000000" : "rgba(255,255,255,.4)", fontWeight: 600, fontSize: 15, transition: "all .25s cubic-bezier(0.4, 0, 0.2, 1)", flexShrink: 0 }}>
          {status === "loading" ? "⏳" : "↑"}
        </button>
      </div>
      {stats && <div style={{ fontSize: 11, opacity: 0.5, marginTop: 8, display: "flex", gap: 12, justifyContent: "center" }}>
        <span>⏱️ {stats.duration > 1000 ? `${(stats.duration / 1000).toFixed(1)}s` : `${stats.duration}ms`}</span>
        <span>🤖 {getModelDisplayName(stats.model)}</span>
      </div>}
    </div>
  );
};

const App = () => {
  const [themeKey, setThemeKey] = useState(() => { const savedTheme = Storage.get("pa-theme"); return savedTheme && THEMES[savedTheme] ? savedTheme : "forest"; });
  const { messages, streamText, status, stats, model, setModel, temperature, setTemperature, sendMessage, clearChat } = useChatSession();
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState(null);
  const chatRef = useRef(null);
  const dock = useDockStatus();
  const health = useHealthCheck();
  const T = THEMES[themeKey] || DEFAULT_THEME;

  useEffect(() => { try { Storage.set("pa-theme", themeKey); } catch {} }, [themeKey]);
  useEffect(() => { if (chatRef.current) { setTimeout(() => { chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 100); } }, [messages, streamText]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const handler = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setSearchQuery(q => q ? "" : "focus"); } if (e.key === "Escape") { setShowSettings(false); setSearchQuery(""); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => { if (searchQuery === "focus") { const input = document.querySelector('.search-bar input'); if (input) { input.focus(); input.select(); } } setSearchQuery(s => s === "focus" ? "" : s); }, [searchQuery]);

  const filteredMessages = useMemo(() => searchQuery.trim() ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase())) : messages, [messages, searchQuery]);

  const handleSend = useCallback((t) => {
    if (health?.status === 'error' || health?.status === 'degraded') { setToast({ msg: `Service ${health.status}: ${health.error || 'Check connection'}`, type: "error" }); return; }
    sendMessage(t);
  }, [sendMessage, health]);

  const instanceVars = { "--user-bubble": T.userBubble, "--ai-bubble": T.aiBubble, "--snow-color": T.snowColor };
  const particles = useMemo(() => [...Array(20)].map((_, i) => ({ id: i, size: Math.random() * 3 + 1, x: Math.random() * 100, y: Math.random() * 100, duration: Math.random() * 30 + 15, delay: Math.random() * 10 })), []);

  return (
    <div className="app-root" style={{ "--primary": T.primary, "--bg": T.bg, "--card-bg": T.cardBg, "--border": T.borderColor, ...instanceVars }}>
      <GlobalStyles />
      <div className="particles">
        {particles.map(p => <div key={p.id} className="particle" style={{ width: `${p.size}px`, height: `${p.size}px`, left: `${p.x}%`, top: `${p.y}%`, "--duration": `${p.duration}s`, animationDelay: `${p.delay}s` }} />)}
      </div>
      {toast && <div className="toast toast-error">❌ <span>{toast.msg}</span></div>}
      <div className="glass-main">
        <header className="app-header">
          <div className="logo-box" onClick={() => setShowSettings(s => !s)} title="Settings">
            <div className="glow" />
            <span>{T.emoji}</span>
          </div>
          <div className="title-group">
            <h1 className="main-title">Cloud AI Assistant</h1>
            <span className="sub-title">{T.name.toUpperCase()} • {getModelDisplayName(model)}</span>
          </div>
          <div className="header-actions">
            {showSettings && <div style={{ display: "flex", gap: 10, padding: 10, background: "rgba(0,0,0,.8)", borderRadius: 18, position: "absolute", top: 85, right: 25, zIndex: 20, alignItems: "center", boxShadow: "0 10px 25px rgba(0,0,0,0.5)", border: "1px solid var(--border)" }}>
              {Object.keys(THEMES).map(k => <button key={k} onClick={() => setThemeKey(k)} className={`dot ${themeKey === k ? "active" : ""}`} style={{ background: THEMES[k]?.primary || DEFAULT_THEME.primary }} title={THEMES[k]?.name} />)}
            </div>}
            <button className="icon-btn" onClick={() => setToast({ msg: "Premium features unlocked!", type: "success" })}>⭐</button>
            <button className={`icon-btn ${showSettings ? "active" : ""}`} onClick={() => setShowSettings(s => !s)}>⚙️</button>
          </div>
        </header>
        <main className="app-content">
          {showSettings && <div className="settings-drawer">
            <div className="setting-row">
              <div className="setting-label">🎨 Premium Themes</div>
              <div className="theme-grid">
                {Object.entries(THEMES).map(([k, v]) => <button key={k} onClick={() => setThemeKey(k)} className={`theme-card ${themeKey === k ? "selected" : ""}`}><span style={{ fontSize: "16px" }}>{v.emoji}</span><span>{v.name}</span></button>)}
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">☁️ Premium Cloud AI Models</div>
              <div className="model-select-container">
                <select value={model} onChange={(e) => setModel(e.target.value)} className="model-select">
                  {Object.entries(MODEL_CATEGORIES).map(([category, models]) => <optgroup key={category} label={category}>
                    {models.map(modelKey => <option key={modelKey} value={modelKey}>{getModelDisplayName(modelKey)}</option>)}
                  </optgroup>)}
                </select>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">🎛️ Creativity Level: {temperature.toFixed(1)}</div>
              <div className="slider-container">
                <span>📉</span>
                <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="slider" />
                <span>📈</span>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-label">🧠 Conversation Management</div>
              <button onClick={clearChat} style={{ padding: "12px 18px", borderRadius: 14, border: "1px solid rgba(239,68,68,.4)", background: "rgba(239,68,68,.15)", color: "#fca5a5", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>🗑️ Clear Chat History</button>
            </div>
          </div>}
          {messages.length > 0 && <div className="search-bar">
            <span style={{ color: "rgba(255,255,255,.6)", fontSize: "16px" }}>🔍</span>
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search conversation... (Ctrl+K)" />
            <button onClick={() => setSearchQuery("")}>✕</button>
          </div>}
          <div className="scroll-wrapper" ref={chatRef}>
            {(health?.status === 'error' || health?.status === 'degraded') && <div className="error-banner">
              <span className="icon">⚠️</span>
              <div><strong>Premium Service: {health?.status}</strong><p style={{ margin: 0, fontSize: 13, marginTop: 4 }}>{health?.error || 'Connecting to premium cloud AI...'}</p></div>
            </div>}
            {messages.length === 0 && !streamText && <div className="empty-state">
              <div className="logo-big">{T.emoji}</div>
              <div>
                <h2 className="empty-title">Cloud AI Assistant</h2>
                <p className="empty-subtitle">Access the world's most powerful AI models instantly. No downloads, no setup - just premium performance.</p>
              </div>
              <div className="suggestions">
                {SUGGESTIONS.map((s, i) => <button key={i} onClick={() => handleSend(s.text)} className="suggestion-btn">
                  <span style={{ fontSize: "16px" }}>{s.icon}</span>
                  <div><div>{s.text}</div><div className="suggestion-category">{s.category}</div></div>
                </button>)}
              </div>
            </div>}
            {filteredMessages.map((msg, idx) => <div key={msg.id || idx} className={`msg-row ${msg.role}`}>
              <div className="avatar">{msg.role === "user" ? "👤" : T.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="bubble">{msg.content}</div>
                <div className="msg-meta">{msg.ts}</div>
              </div>
            </div>)}
            {status === "streaming" && streamText && <div className="msg-row assistant">
              <div className="avatar">{T.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="bubble">{streamText}<span className="typing-indicator" /></div>
                <div className="msg-meta">AI is typing...</div>
              </div>
            </div>}
            {status === "loading" && <div className="msg-row assistant">
              <div className="avatar">{T.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="bubble" style={{ fontStyle: "italic", opacity: .7, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>⚡</span><span>Processing with {getModelDisplayName(model)}...</span>
                </div>
                <div className="msg-meta">AI is thinking</div>
              </div>
            </div>}
          </div>
          <InputBar onSend={handleSend} disabled={status !== "idle"} status={status} stats={stats} />
          <DockPanel dock={dock} />
        </main>
      </div>
    </div>
  );
};

export default App;
