import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const uid = () => crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);
const API_BASE = "https://alop-ai.onrender.com";
const Storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  remove: (k) => { try { localStorage.removeItem(k); } catch {} }
};
const extractRgb = (rgbaString) => { const m = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? `${m[1]}, ${m[2]}, ${m[3]}` : "139, 92, 246"; };
const rgbaToHex = (rgbaString, fb) => { const m = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (!m) return fb; return "#" + [m[1],m[2],m[3]].map(v => parseInt(v).toString(16).padStart(2,'0')).join(''); };

const THEMES = {
  midnight: { name: "Midnight", primary: "#8b5cf6", bg: "linear-gradient(135deg, #050507, #0b0b12, #12121f)", cardBg: "rgba(11, 11, 16, 0.96)", borderColor: "rgba(139, 92, 246, 0.14)", userBubble: "rgba(139, 92, 246, 0.13)", aiBubble: "rgba(139, 92, 246, 0.06)" },
  obsidian: { name: "Obsidian", primary: "#a78bfa", bg: "radial-gradient(circle at 30% 20%, #1a1033 0%, #0d0d12 50%, #050507 100%)", cardBg: "rgba(10, 10, 14, 0.97)", borderColor: "rgba(167, 139, 250, 0.15)", userBubble: "rgba(167, 139, 250, 0.13)", aiBubble: "rgba(167, 139, 250, 0.06)" },
  graphite: { name: "Graphite", primary: "#94a3b8", bg: "linear-gradient(135deg, #0a0a0c, #111116, #0a0a0c)", cardBg: "rgba(16, 16, 20, 0.96)", borderColor: "rgba(148, 163, 184, 0.16)", userBubble: "rgba(148, 163, 184, 0.15)", aiBubble: "rgba(148, 163, 184, 0.07)" },
  ocean: { name: "Ocean", primary: "#38bdf8", bg: "radial-gradient(circle at 70% 30%, #0a1f3d 0%, #051020 50%, #02050c 100%)", cardBg: "rgba(5, 16, 32, 0.97)", borderColor: "rgba(56, 189, 248, 0.14)", userBubble: "rgba(56, 189, 248, 0.13)", aiBubble: "rgba(56, 189, 248, 0.06)" },
  emerald: { name: "Emerald", primary: "#34d399", bg: "radial-gradient(circle at 20% 80%, #0a2a1f 0%, #05120d 50%, #020604 100%)", cardBg: "rgba(5, 18, 13, 0.97)", borderColor: "rgba(52, 211, 153, 0.14)", userBubble: "rgba(52, 211, 153, 0.13)", aiBubble: "rgba(52, 211, 153, 0.06)" },
  crimson: { name: "Crimson", primary: "#fb7185", bg: "radial-gradient(circle at 80% 20%, #2a0a12 0%, #120408 50%, #050203 100%)", cardBg: "rgba(18, 4, 8, 0.97)", borderColor: "rgba(251, 113, 133, 0.14)", userBubble: "rgba(251, 113, 133, 0.13)", aiBubble: "rgba(251, 113, 133, 0.06)" },
  gold: { name: "Royal Gold", primary: "#fbbf24", bg: "radial-gradient(circle at 50% 50%, #1f1508 0%, #0f0b05 50%, #050402 100%)", cardBg: "rgba(20, 14, 6, 0.97)", borderColor: "rgba(251, 191, 36, 0.16)", userBubble: "rgba(251, 191, 36, 0.13)", aiBubble: "rgba(251, 191, 36, 0.06)" },
  arctic: { name: "Arctic", primary: "#60a5fa", bg: "linear-gradient(135deg, #f8fafc, #e8eef4, #f8fafc)", cardBg: "rgba(255, 255, 255, 0.98)", borderColor: "rgba(96, 165, 250, 0.22)", userBubble: "rgba(96, 165, 250, 0.1)", aiBubble: "rgba(96, 165, 250, 0.05)" }
};
const DEFAULT_THEME = THEMES.midnight;

const MODEL_DISPLAY_NAMES = {
  'glm-5.2': 'GLM 5.2', 'glm-5.1': 'GLM 5.1', 'gemma4:31b': 'Gemma 4', 'qwen3.5:397b': 'Qwen 3.5',
  'minimax-m2.7': 'MiniMax M2.7', 'minimax-m2.5': 'MiniMax M2.5', 'minimax-m3': 'MiniMax M3',
  'nemotron-3-super': 'Nemotron Super', 'nemotron-3-ultra': 'Nemotron Ultra', 'nemotron-3-nano:30b': 'Nemotron Nano',
  'kimi-k2.7-code': 'Kimi K2.7', 'kimi-k2.6': 'Kimi K2.6', 'kimi-k2.5': 'Kimi K2.5',
  'deepseek-v4-flash': 'DeepSeek Flash', 'deepseek-v4-pro': 'DeepSeek Pro',
  'gpt-oss:20b': 'GPT-OSS 20B', 'gpt-oss:120b': 'GPT-OSS 120B', 'mistral-large-3:675b': 'Mistral Large 3'
};
const getModelDisplayName = (k) => MODEL_DISPLAY_NAMES[k] || k;

const MODEL_CATEGORIES = {
  'GLM': ['glm-5.2','glm-5.1'], 'Google': ['gemma4:31b'], 'Alibaba': ['qwen3.5:397b'],
  'MiniMax': ['minimax-m2.7','minimax-m2.5','minimax-m3'], 'NVIDIA': ['nemotron-3-super','nemotron-3-ultra','nemotron-3-nano:30b'],
  'Moonshot': ['kimi-k2.7-code','kimi-k2.6','kimi-k2.5'], 'DeepSeek': ['deepseek-v4-flash','deepseek-v4-pro'],
  'OpenAI': ['gpt-oss:20b','gpt-oss:120b'], 'Mistral': ['mistral-large-3:675b']
};
const VISION_MODELS = ['gemma4:31b', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5', 'mistral-large-3:675b', 'deepseek-v4-pro'];

const BACKGROUND_PRESETS = {
  forest: "https://images.unsplash.com/photo-1511497584788-876760111969?w=1920&q=80",
  space: "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1920&q=80",
  beach: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=80",
  mountains: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80",
  abstract: "https://images.unsplash.com/photo-1557683316-973673baf926?w=1920&q=80",
  water: "https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1920&q=80",
  fire: "https://images.unsplash.com/photo-1505009253807-0a4c86083162?w=1920&q=80"
};

const IMAGE_GENERATION = { endpoint: "https://image.pollinations.ai/prompt", model: "flux" };

const Icon = ({ name, size = 18, color = "currentColor" }) => {
  const icons = {
    menu: <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    close: <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    plus: <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    camera: <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    mic: <g><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /><path d="M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></g>,
    "mic-off": <path d="M1 1l22 22M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M19 10v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    search: <g><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></g>,
    settings: <g><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></g>,
    copy: <g><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    edit: <g><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    trash: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    check: <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    warning: <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    pin: <g><path d="M12 2v8M5 12a7 7 0 0 1 14 0v0a7 7 0 0 1-7 7h0a7 7 0 0 1-7-7v0z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    refresh: <g><path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M20.49 9A9 9 0 1 0 5.64 15.36" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />,
    download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    brain: <g><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-5 0v-1M12 4.5A2.5 2.5 0 0 1 14.5 2a2.5 2.5 0 0 1 2.5 2.5v1M12 19.5a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5v-1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    crown: <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    volume: <path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    volumeX: <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle", color }}>{icons[name] || null}</svg>;
};

const enhanceImagePrompt = (prompt) => prompt ? `${prompt}, professional photography, 8k uhd, highly detailed, sharp focus, cinematic lighting, masterpiece, best quality, ultra realistic` : "";
const buildImageUrl = (prompt, w = 1024, h = 1024) => `${IMAGE_GENERATION.endpoint}/${encodeURIComponent(enhanceImagePrompt(prompt))}?width=${w}&height=${h}&nologo=true&model=${IMAGE_GENERATION.model}&seed=${Math.floor(Math.random()*1e7)}&enhance=true`;
const isImageRequest = (text) => { const t = text.trim().toLowerCase(); return t.startsWith("/image") || /\b(generate|create|make|draw|produce)\s+(an?\s+)?(image|picture|photo)\b/.test(t) || /\b(draw|generate|create|make)\s+(a|an|the|this|that)?\s*(picture|image|photo|scene|portrait|landscape)\s+(of|showing|with|for)\b/.test(t); };
const parseImagePrompt = (text) => text.replace(/^\/image\s*/i,"").replace(/\b(can\s+you\s+)?(please\s+)?(generate|create|make|draw|produce)\s+(an?\s+)?(image|picture|photo)\s*(of\s*|for\s*|with\s*|showing\s*)?/i,"").replace(/\b(draw|generate|create|make)\s+(a|an|the|this|that)?\s*(picture|image|photo|scene|portrait|landscape)\s+(of\s|for\s|with\s|showing\s)?/i,"").trim();

const useChatManager = () => {
  const [chats, setChats] = useState(() => { try { const s = JSON.parse(Storage.get('pa_chats') || '[]'); return Array.isArray(s) && s.length ? s : []; } catch { return []; } });
  const [activeChatId, setActiveChatId] = useState(null);
  useEffect(() => { if (!activeChatId && chats.length) { const s = Storage.get('pa_active_chat'); const f = chats.find(c => c.id === s); setActiveChatId(f ? f.id : chats[0].id); } }, [activeChatId, chats]);
  const createChat = useCallback((title = "New Chat") => { const c = { id: uid(), title, messages: [], createdAt: Date.now(), pinned: false, favorite: false }; setChats(p => [c, ...p]); setActiveChatId(c.id); return c.id; }, []);
  useEffect(() => { if (!chats.length) createChat("New Chat"); }, [chats.length, createChat]);
  const deleteChat = useCallback((id) => { const c = chats.find(x => x.id === id); c?.messages?.forEach(m => m.attachments?.forEach(a => { try { URL.revokeObjectURL(a.url); } catch {} })); setChats(p => p.filter(x => x.id !== id)); setActiveChatId(p => { if (p !== id) return p; const r = chats.filter(x => x.id !== id); return r[0]?.id || null; }); }, [chats]);
  const renameChat = useCallback((id, title) => setChats(p => p.map(c => c.id === id ? { ...c, title } : c)), []);
  const togglePinChat = useCallback((id) => setChats(p => p.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c)), []);
  const toggleFavoriteChat = useCallback((id) => setChats(p => p.map(c => c.id === id ? { ...c, favorite: !c.favorite } : c)), []);
  const updateChatMessages = useCallback((id, messages) => setChats(p => p.map(c => c.id === id ? { ...c, messages, updatedAt: Date.now() } : c)), []);
  const sortedChats = useMemo(() => [...chats].sort((a,b) => { if (a.pinned !== b.pinned) return a.pinned ? -1 : 1; if (a.favorite !== b.favorite) return a.favorite ? -1 : 1; return (b.updatedAt||b.createdAt) - (a.updatedAt||a.createdAt); }), [chats]);
  const exportChat = useCallback((id, format = "json") => { const c = chats.find(x => x.id === id); if (!c) return; if (format === "markdown") { const md = c.messages.map(m => m.imageUrl ? `**${m.role.toUpperCase()}** — Image: ${m.imagePrompt || "Generated image"}\n\n![Generated](${m.imageUrl})\n\n` : `**${m.role.toUpperCase()}** (${m.ts}):\n\n${m.content}\n\n---\n\n`).join(""); const b = new Blob([md], { type: "text/markdown" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `${c.title.replace(/\s+/g,'-').toLowerCase()}.md`; a.click(); URL.revokeObjectURL(u); } else { const b = new Blob([JSON.stringify(c.messages.map(m => ({ role:m.role, content:m.content, time:m.ts, imageUrl:m.imageUrl, imagePrompt:m.imagePrompt })), null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `${c.title.replace(/\s+/g,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(u); } }, [chats]);
  const exportAllChats = useCallback(() => { const b = new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `all-chats-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(u); }, [chats]);
  useEffect(() => Storage.set('pa_chats', JSON.stringify(chats)), [chats]);
  useEffect(() => { if (activeChatId) Storage.set('pa_active_chat', activeChatId); }, [activeChatId]);
  return { chats, sortedChats, activeChatId, setActiveChatId, createChat, deleteChat, renameChat, togglePinChat, toggleFavoriteChat, updateChatMessages, exportChat, exportAllChats };
};

const useChatSession = (chatId, messages, updateMessages, userProfile, systemPrompt) => {
  const [sessionId] = useState(() => Storage.get('pa_session') || uid());
  const [model, setModel] = useState(() => Storage.get("pa-model") || "glm-5.2");
  const [temperature, setTemperature] = useState(() => parseFloat(Storage.get("pa-temperature")) || 0.7);
  const [streamText, setStreamText] = useState("");
  const [status, setStatus] = useState("idle");
  const [stats, setStats] = useState(null);
  const [wakeUp, setWakeUp] = useState(false);
  const abortRef = useRef(null), accRef = useRef(""), rafIdRef = useRef(null), wakeTimerRef = useRef(null);

  useEffect(() => Storage.set("pa-model", model), [model]);
  useEffect(() => Storage.set("pa-temperature", temperature.toString()), [temperature]);

  const buildContext = useCallback(() => {
    const ctx = [];
    if (systemPrompt?.trim()) ctx.push({ role: "system", content: systemPrompt.trim() });
    if (userProfile?.trim()) ctx.push({ role: "system", content: `User profile and preferences to remember: ${userProfile.trim()}` });
    return ctx;
  }, [systemPrompt, userProfile]);

  const stopGeneration = useCallback(() => { if (abortRef.current) abortRef.current.abort(); abortRef.current = null; setStatus("idle"); accRef.current = ""; setStreamText(""); setWakeUp(false); }, []);

  const sendMessage = useCallback(async (text, attachments = []) => {
    if ((!text?.trim() && !attachments.length) || status !== "idle" || !chatId) return;
    setStatus("loading"); setWakeUp(false); accRef.current = ""; setStreamText(""); setStats(null);
    const userMsg = { role: "user", content: text || "", attachments: attachments.map(f => ({ name: f.name, url: URL.createObjectURL(f), type: f.type })), ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() };
    const updated = [...messages.slice(-99), userMsg];
    updateMessages(chatId, updated);
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    wakeTimerRef.current = setTimeout(() => setWakeUp(true), 3000);

    try {
      const ctx = buildContext();
      let res;
      if (attachments.length) {
        const fd = new FormData();
        fd.append("message", text || ""); fd.append("modelType", model); fd.append("temperature", temperature.toString()); fd.append("sessionId", sessionId);
        fd.append("messages", JSON.stringify([...ctx, ...messages.slice(-10)].map(m => ({ role: m.role, content: m.content }))));
        attachments.forEach(f => fd.append("files", f));
        res = await fetch(`${API_BASE}/chat`, { method: "POST", body: fd, signal: abortRef.current.signal });
      } else {
        res = await fetch(`${API_BASE}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abortRef.current.signal, body: JSON.stringify({ message: text, messages: [...ctx, ...messages.slice(-10)].map(m => ({ role: m.role, content: m.content })), modelType: model, sessionId, temperature }) });
      }
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Server error: ${res.status}`); }
      if (!res.body) throw new Error("Streaming not supported");
      clearTimeout(wakeTimerRef.current); setWakeUp(false); setStatus("streaming");
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim(); if (!t.startsWith("data: ")) continue;
          const j = t.slice(6).trim(); if (j === "[DONE]") break;
          try {
            const d = JSON.parse(j);
            if (d.type === "chunk") { accRef.current += d.text; if (!rafIdRef.current) rafIdRef.current = requestAnimationFrame(() => { setStreamText(accRef.current); rafIdRef.current = null; }); }
            else if (d.type === "end") { if (d.stats) setStats(d.stats); updateMessages(chatId, [...updated, { role: "assistant", content: accRef.current, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]); accRef.current = ""; setStreamText(""); setStatus("idle"); }
            else if (d.type === "error") throw new Error(d.text);
          } catch (e) { console.warn('Parse error:', e); }
        }
      }
      if (accRef.current) { updateMessages(chatId, [...updated, { role: "assistant", content: accRef.current, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]); accRef.current = ""; }
      setStreamText(""); setStatus("idle");
    } catch (err) {
      clearTimeout(wakeTimerRef.current); setWakeUp(false);
      if (err.name === "AbortError") return;
      setStatus("error");
      updateMessages(chatId, [...updated, { role: "assistant", content: `⚠️ ${err.message || 'Connection failed'}`, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]);
    }
  }, [chatId, messages, model, sessionId, temperature, status, updateMessages, buildContext]);

  return { streamText, status, stats, model, setModel, temperature, setTemperature, sendMessage, stopGeneration, wakeUp };
};

const useHealthCheck = () => {
  const [health, setHealth] = useState(null);
  useEffect(() => { let c = false; const check = async () => { try { const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) }); if (!c) { const d = await r.json(); setHealth(d.status === 'premium' ? d : { status: 'degraded', error: d.error || 'Service disconnected' }); } } catch (e) { if (!c) setHealth({ status: 'error', error: e.name === 'AbortError' ? 'Timeout' : 'Connection failed' }); } }; check(); const i = setInterval(check, 8000); return () => { c = true; clearInterval(i); }; }, []);
  return health;
};

const formatMessage = (text) => {
  if (!text) return null;
  return text.split(/(```[\s\S]*?```)/g).map((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const code = part.slice(3, -3).replace(/^\w+\n/, "");
      return <pre key={i} style={{ background: "rgba(0,0,0,.55)", padding: 16, borderRadius: 10, overflowX: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, border: "1px solid var(--border)", marginTop: 8, marginBottom: 8 }}><code style={{ color: "#e2e8f0", whiteSpace: "pre" }}>{code}</code></pre>;
    }
    return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
  });
};

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    html, body, #root { height: 100%; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #000; overflow: hidden; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    .app-root { width: 100vw; height: 100vh; display: flex; position: relative; overflow: hidden; }
    .app-root.custom-bg { background-size: cover; background-position: center; background-repeat: no-repeat; }
    .bg-layer { position: absolute; inset: 0; z-index: 1; background-size: cover; background-position: center; background-repeat: no-repeat; }
    .bg-overlay { position: absolute; inset: 0; z-index: 2; background: rgba(0,0,0,0.55); pointer-events: none; }
    .app-shell { position: relative; z-index: 10; width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
    .app-header { display: flex; align-items: center; gap: 14px; padding: 14px 22px; flex-shrink: 0; border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.02); backdrop-filter: blur(20px); }
    .menu-btn { width: 40px; height: 40px; border-radius: 11px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.35); backdrop-filter: blur(10px); color: rgba(255,255,255,.7); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s; }
    .menu-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
    .brand { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; cursor: default; user-select: none; }
    .brand-logo { width: 40px; height: 40px; border-radius: 11px; background: linear-gradient(135deg, var(--primary), rgba(255,255,255,.25)); display:flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 900; color: #000; border: 1px solid rgba(255,255,255,.1); }
    .title-group { flex:1; min-width:0; }
    .main-title { font-size: 16px; font-weight: 700; color: #fff; letter-spacing: -.2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sub-title { font-size: 10px; color: rgba(255,255,255,.4); letter-spacing: .6px; text-transform: uppercase; margin-top: 1px; }
    .header-actions { display:flex; gap:6px; align-items:center; }
    .icon-btn { width:40px; height:40px; border-radius:11px; border:1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.35); backdrop-filter: blur(10px); color:rgba(255,255,255,.7); cursor:pointer; display:flex; align-items: center; justify-content: center; transition: all .15s; flex-shrink: 0; }
    .icon-btn:hover { background:rgba(0,0,0,0.55); border-color:rgba(255,255,255,0.15); color:#fff; }
    .icon-btn.active { background: var(--primary); color: #000; border-color: transparent; }
    .icon-btn.premium { position: relative; overflow: hidden; }
    .icon-btn.premium::after { content: ""; position: absolute; inset: 0; border-radius: 11px; padding: 1px; background: linear-gradient(135deg, #ffd700, #ff8c00, #ffd700); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: shimmer 2.5s linear infinite; background-size: 200% 200%; }
    @keyframes shimmer { 0%{background-position: 0% 50%} 50%{background-position: 100% 50%} 100%{background-position: 0% 50%} }
    .app-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }
    .chat-sidebar { width: 280px; flex-shrink: 0; border-right: 1px solid var(--border); background: rgba(0,0,0,0.55); backdrop-filter: blur(30px); display: flex; flex-direction: column; overflow: hidden; transition: width .3s ease, padding .3s ease; }
    .chat-sidebar.collapsed { width: 0; padding: 0; border-right: none; overflow: hidden; }
    .sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); }
    .sidebar-btn { width: 100%; height: 42px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--primary), rgba(255,255,255,.25)); color: #000; cursor: pointer; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all .2s; }
    .sidebar-btn:hover { transform: translateY(-1px); filter: brightness(1.1); }
    .sidebar-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 5px; }
    .sidebar-section { font-size: 10px; font-weight: 800; color: rgba(255,255,255,.2); text-transform: uppercase; letter-spacing: 1px; margin: 6px 4px 4px 4px; }
    .sidebar-item { padding: 11px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: all .15s; border: 1px solid transparent; position: relative; }
    .sidebar-item:hover { background: rgba(255,255,255,.05); border-color: var(--border); }
    .sidebar-item.active { background: rgba(255,255,255,.08); border-color: var(--primary); }
    .sidebar-item.pinned { border-left: 2px solid var(--primary); }
    .sidebar-icon { width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,.05); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: rgba(255,255,255,.4); flex-shrink: 0; }
    .sidebar-item.active .sidebar-icon { color: var(--primary); background: rgba(255,255,255,.1); }
    .sidebar-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: rgba(255,255,255,.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sidebar-item.active .sidebar-title { color: #fff; }
    .sidebar-meta { font-size: 10px; color: rgba(255,255,255,.32); margin-top: 1px; }
    .sidebar-actions { display: flex; gap: 3px; opacity: 0; transition: opacity .2s; }
    .sidebar-item:hover .sidebar-actions { opacity: 1; }
    .sidebar-action { width: 24px; height: 24px; border-radius: 6px; border: none; background: transparent; color: rgba(255,255,255,.35); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .15s; }
    .sidebar-action:hover { background: rgba(255,255,255,.1); color: #fff; }
    .sidebar-action.active { color: var(--primary); }
    .sidebar-action.delete:hover { background: rgba(239,68,68,.2); color: #fca5a5; }
    .chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
    .chat-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; position: relative; }
    .panel-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,.4); backdrop-filter: blur(2px); }
    .panel { position: absolute; top: 70px; right: 16px; width: 340px; max-height: calc(100vh - 100px); overflow-y: auto; background: rgba(0,0,0,.92); border: 1px solid var(--border); border-radius: 16px; padding: 18px; z-index: 100; box-shadow: 0 24px 80px rgba(0,0,0,.7); }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .panel-title { font-size: 12px; font-weight: 800; color: rgba(255,255,255,.7); text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
    .memory-panel { position: absolute; top: 0; left: 0; right: 0; z-index: 80; background: rgba(0,0,0,.85); backdrop-filter: blur(24px); border-bottom: 1px solid var(--border); padding: 18px 22px; max-height: 65vh; overflow-y: auto; }
    .setting-row { margin-bottom: 16px; display:flex; flex-direction:column; gap:10px; }
    .setting-row:last-child { margin-bottom: 0; }
    .setting-label { color:rgba(255,255,255,.45); font-size:10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
    .theme-grid { display:flex; gap:6px; flex-wrap:wrap; }
    .theme-card { padding: 7px 11px; border-radius:8px; border:1px solid var(--border); background:rgba(255,255,255,.04); color:rgba(255,255,255,.75); cursor:pointer; font-size:12px; font-weight: 500; display:flex; align-items:center; gap:6px; transition: all .15s; flex: 1; min-width: 90px; }
    .theme-card:hover { background:rgba(255,255,255,.09); border-color: rgba(255,255,255,.18); transform: translateY(-1px); }
    .theme-card.selected { border-color: var(--primary); background: rgba(255,255,255,.1); color: #fff; }
    .model-select-container { padding: 10px 12px; border-radius:8px; border:1px solid var(--border); background:rgba(255,255,255,.04); color:#fff; font-size:13px; }
    .model-select { width: 100%; background: transparent; border: none; color: #fff; font-size: 13px; outline: none; cursor: pointer; padding: 4px 0; }
    .model-select option, .model-select optgroup { background: #0a0a0a; color:#fff; }
    .slider-container { display: flex; align-items: center; gap: 10px; }
    .slider { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.08); outline: none; -webkit-appearance: none; }
    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--primary); cursor: pointer; }
    .custom-input { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,.04); color: #fff; font-size: 13px; outline: none; transition: all .15s; }
    .custom-input:focus { border-color: var(--primary); background: rgba(255,255,255,.06); }
    .custom-input::placeholder { color: rgba(255,255,255,.3); }
    .textarea { min-height: 80px; resize: vertical; font-family: inherit; line-height: 1.5; }
    .color-picker { width: 32px; height: 28px; border: none; border-radius: 6px; cursor: pointer; background: transparent; }
    .scroll-wrapper { flex:1; overflow-y:auto; scroll-behavior:smooth; padding:22px; display:flex; flex-direction:column; gap:14px; min-height:0; }
    .scroll-wrapper::-webkit-scrollbar { width:5px; }
    .scroll-wrapper::-webkit-scrollbar-track { background:transparent; }
    .scroll-wrapper::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
    .msg-row { display:flex; gap:12px; max-width:86%; animation: msgIn .25s ease; }
    .msg-row.user { align-self: flex-end; flex-direction: row-reverse; }
    .msg-row.assistant { align-self: flex-start; }
    @keyframes msgIn { from { opacity:0; transform:translateY(10px);} to { opacity:1; transform:translateY(0);} }
    .avatar { width:32px; height:32px; border-radius:9px; display:flex; align-items: center; justify-content: center; font-size:10px; font-weight: 900; flex-shrink:0; background:rgba(255,255,255,.05); border: 1px solid var(--border); color: rgba(255,255,255,.45); }
    .msg-row.user .avatar { color: var(--primary); background: rgba(255,255,255,.08); }
    .bubble { padding: 14px 18px; border-radius: 14px; font-size: 15px; line-height: 1.6; word-break: break-word; max-width: 100%; }
    .msg-row.user .bubble { background: rgba(139, 92, 246, 0.75); color:#f8fafc; border-bottom-right-radius:4px; }
    .msg-row.assistant .bubble { background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(14px); color:rgba(255,255,255,.95); border:1px solid rgba(255,255,255,0.08); border-bottom-left-radius:4px; }
    .msg-actions { display:flex; gap:5px; margin-top:5px; justify-content:flex-end; opacity:0; transition:opacity .2s; }
    .msg-row:hover .msg-actions { opacity:1; }
    .msg-action-btn { padding:5px 10px; border-radius:6px; border:1px solid var(--border); background:rgba(255,255,255,.04); color:rgba(255,255,255,.5); font-size:11px; cursor:pointer; transition: all .15s; display: flex; align-items: center; gap: 5px; }
    .msg-action-btn:hover { background:rgba(255,255,255,.1); color:#fff; }
    .msg-meta { font-size:10px; color:rgba(255,255,255,.25); margin-top:3px; text-align: right; }
    .generated-image { max-width: 100%; max-height: 70vh; border-radius: 12px; border: 1px solid var(--border); display: block; box-shadow: 0 14px 42px rgba(0,0,0,.5); transition: transform .3s; cursor: pointer; }
    .generated-image:hover { transform: scale(1.01); }
    .image-prompt { font-size: 12px; color: rgba(255,255,255,.4); margin-top: 8px; font-style: italic; }
    .error-banner { display:flex; gap:10px; align-items:center; padding: 10px 14px; margin:8px 18px; border-radius:10px; background: rgba(239,68,68,.07); border: 1px solid rgba(239,68,68,.22); font-size:12px; color:#fca5a5; flex-shrink:0; }
    .empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:40px 24px; text-align: center; }
    .logo-big { width:64px; height:64px; border-radius:16px; background: linear-gradient(135deg, rgba(255,255,255,.08), rgba(255,255,255,.02)); border:1px solid var(--border); display:flex; align-items: center; justify-content: center; font-size:24px; font-weight:900; color:var(--primary); margin:0 auto; box-shadow: 0 14px 42px rgba(0,0,0,.35); }
    .empty-title { font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -.3px; }
    .empty-subtitle { color:rgba(255,255,255,.45); font-size:14px; max-width:420px; line-height: 1.6; }
    .empty-subtitle strong { color: var(--primary); font-weight: 700; }
    @keyframes blink { 0%,100%{opacity:1;} 50%{opacity:.3;} }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .typing-indicator { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--primary); margin-left: 4px; animation: blink 1s infinite; }
    .attachment-grid { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
    .attachment-thumb { width:60px; height:60px; border-radius:7px; overflow:hidden; border:1px solid var(--border); position:relative; }
    .attachment-thumb img { width:100%; height:100%; object-fit:cover; }
    .attachment-remove { position:absolute; top:2px; right:2px; width:18px; height:18px; border-radius:50%; border:none; background:rgba(0,0,0,.7); color:#fff; cursor:pointer; font-size:11px; display:flex; align-items: center; justify-content: center; }
    .input-area { padding: 14px 18px; border-top: 1px solid var(--border); background: rgba(255,255,255,0.02); backdrop-filter: blur(20px); flex-shrink: 0; }
    .input-area-inner { max-width: 900px; margin: 0 auto; display: flex; gap: 8px; align-items: center; }
    .input-field { flex: 1; padding: 12px 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.35); backdrop-filter: blur(14px); color: #fff; font-size: 15px; outline: none; caret-color: var(--primary); min-width: 0; }
    .input-field:focus { border-color: var(--primary); background: rgba(0,0,0,0.45); box-shadow: 0 0 0 3px rgba(139,92,246,.08); }
    .input-field::placeholder { color: rgba(255,255,255,.35); }
    .send-btn { padding: 0 18px; height: 44px; border-radius: 12px; border: none; cursor: pointer; background: var(--primary); color: #000; font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; transition: all .15s; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
    .send-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .send-btn:disabled { background: rgba(255,255,255,.06); color: rgba(255,255,255,.25); cursor: not-allowed; transform: none; filter: none; }
    .attachment-preview { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; max-width: 900px; margin-left: auto; margin-right: auto; }
    .wake-banner { display:flex; gap:10px; align-items:center; padding: 10px 14px; margin:8px 18px; border-radius:10px; background: rgba(251, 191, 36, .1); border: 1px solid rgba(251, 191, 36, .25); font-size:12px; color:#fbbf24; flex-shrink:0; }
    .wake-banner svg { flex-shrink: 0; animation: spin 2s linear infinite; }
    .camera-overlay { position:fixed; inset:0; z-index:1000; background:rgba(0,0,0,.97); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; }
    .camera-video { max-width:90vw; max-height:70vh; border-radius:14px; border:2px solid var(--border); }
    .camera-controls { display:flex; gap:20px; }
    .camera-btn { padding:12px 28px; border-radius:30px; border:none; font-weight:700; font-size:14px; cursor:pointer; }
    .camera-btn.primary { background:var(--primary); color:#000; }
    .camera-btn.secondary { background:rgba(255,255,255,.08); color:#fff; border:1px solid var(--border); }
    .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,.95); color: #fff; padding: 12px 20px; border-radius: 10px; z-index: 9999; font-size: 13px; border-left: 3px solid var(--primary); box-shadow: 0 20px 60px rgba(0,0,0,.6); display: flex; align-items: center; gap: 10px; }
    @media (max-width: 900px) {
      .chat-sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 100; transform: translateX(-100%); transition: transform .3s; width: 260px; }
      .chat-sidebar.collapsed { transform: translateX(-100%); }
      .chat-sidebar.open { transform: translateX(0); }
      .panel { width: calc(100vw - 32px); right: 16px; left: 16px; top: 80px; }
      .memory-panel { padding: 14px 16px; }
    }
    @media (max-width: 640px) {
      .app-header { padding: 10px 14px; }
      .scroll-wrapper { padding: 14px; gap: 10px; }
      .bubble { font-size: 14px; padding: 12px 14px; }
      .msg-row { max-width: 94%; }
      .input-area { padding: 10px 12px; }
      .empty-title { font-size: 20px; }
      .icon-btn { width: 36px; height: 36px; }
      .brand-logo { width: 36px; height: 36px; }
    }
  `}</style>
);

const InputBar = ({ text, setText, onSend, disabled, status, stats, attachments, setAttachments, onFileSelect, onPasteImage, onStartCamera, isListening, toggleListening }) => {
  const fileInputRef = useRef(null);
  const handleSubmit = () => { if ((!text.trim() && attachments.length === 0) || disabled) return; onSend(text); };
  return (
    <div className="input-area" onPaste={onPasteImage}>
      {attachments.length > 0 && (
        <div className="attachment-preview">
          {attachments.map((file, idx) => (
            <div key={idx} style={{ width: 60, height: 60, borderRadius: 7, overflow: "hidden", border: "1px solid var(--border)", position: "relative" }}>
              <img src={URL.createObjectURL(file)} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
              <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="attachment-remove">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="input-area-inner">
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={onFileSelect} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={disabled} className="icon-btn" title="Attach image"><Icon name="plus" size={18} /></button>
        <button onClick={onStartCamera} disabled={disabled} className="icon-btn" title="Camera"><Icon name="camera" size={18} /></button>
        <button onClick={toggleListening} disabled={disabled} className={`icon-btn ${isListening ? "active" : ""}`} title={isListening ? "Stop voice" : "Voice input"}><Icon name={isListening ? "mic-off" : "mic"} size={18} /></button>
        <input className="input-field" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }} placeholder={status === "loading" ? "AI is thinking..." : "Message... try /image to generate images"} disabled={disabled} />
        <button className="send-btn" onClick={handleSubmit} disabled={(!text.trim() && attachments.length === 0) || disabled}>
          {status === "loading" ? <span style={{ width: 16, height: 16, border: "2px solid rgba(0,0,0,.3)", borderTopColor: "#000", borderRadius: "50%", animation: "spin 1s linear infinite" }} /> : <Icon name="send" size={18} />}
        </button>
      </div>
      {stats && <div style={{ fontSize: 10, color: "rgba(255,255,255,.25)", marginTop: 5, display: "flex", gap: 12, justifyContent: "center" }}>
        <span>{stats.duration > 1000 ? `${(stats.duration / 1000).toFixed(1)}s` : `${stats.duration}ms`}</span>
        <span>{getModelDisplayName(stats.model)}</span>
      </div>}
    </div>
  );
};

const MessageActions = ({ content, onSpeak, onRegenerate }) => (
  <div className="msg-actions">
    <button onClick={() => navigator.clipboard.writeText(content)} className="msg-action-btn" title="Copy"><Icon name="copy" size={11} /> Copy</button>
    <button onClick={() => onSpeak(content)} className="msg-action-btn" title="Read aloud"><Icon name="volume" size={11} /> Read</button>
    {onRegenerate && <button onClick={onRegenerate} className="msg-action-btn" title="Regenerate"><Icon name="refresh" size={11} /> Regenerate</button>}
  </div>
);

const ChatSidebar = ({ chats, activeChatId, onSelect, onCreate, onDelete, onRename, onPin, onFavorite, sidebarOpen, setSidebarOpen, collapsed }) => {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const startEdit = (chat, e) => { e.stopPropagation(); setEditingId(chat.id); setEditTitle(chat.title); };
  const saveEdit = () => { if (editingId && editTitle.trim()) onRename(editingId, editTitle.trim()); setEditingId(null); };
  const formatDate = (ts) => ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : "";
  const handleCreate = () => { onCreate(); setSidebarOpen(false); };
  if (collapsed) return null;
  return (
    <>
      <div className={`chat-sidebar ${sidebarOpen ? "open" : ""}`} onClick={e => e.stopPropagation()}>
        <div className="sidebar-header">
          <button onClick={handleCreate} className="sidebar-btn"><Icon name="plus" size={16} /> New Chat</button>
        </div>
        <div className="sidebar-list">
          {chats.filter(c => c.pinned).length > 0 && <div className="sidebar-section">Pinned</div>}
          {chats.filter(c => c.pinned).map(chat => <SidebarItem key={chat.id} chat={chat} activeChatId={activeChatId} editingId={editingId} editTitle={editTitle} setEditTitle={setEditTitle} startEdit={startEdit} saveEdit={saveEdit} formatDate={formatDate} onSelect={onSelect} onDelete={onDelete} onPin={onPin} onFavorite={onFavorite} setSidebarOpen={setSidebarOpen} />)}
          <div className="sidebar-section">Recent</div>
          {chats.filter(c => !c.pinned).map(chat => <SidebarItem key={chat.id} chat={chat} activeChatId={activeChatId} editingId={editingId} editTitle={editTitle} setEditTitle={setEditTitle} startEdit={startEdit} saveEdit={saveEdit} formatDate={formatDate} onSelect={onSelect} onDelete={onDelete} onPin={onPin} onFavorite={onFavorite} setSidebarOpen={setSidebarOpen} />)}
        </div>
      </div>
      {sidebarOpen && <div className="panel-overlay" onClick={() => setSidebarOpen(false)} />}
    </>
  );
};

const SidebarItem = ({ chat, activeChatId, editingId, editTitle, setEditTitle, startEdit, saveEdit, formatDate, onSelect, onDelete, onPin, onFavorite, setSidebarOpen }) => {
  const isActive = activeChatId === chat.id;
  const isEditing = editingId === chat.id;
  return (
    <div onClick={() => { onSelect(chat.id); setSidebarOpen(false); }} className={`sidebar-item ${isActive ? "active" : ""} ${chat.pinned ? "pinned" : ""}`}>
      <div className="sidebar-icon">{chat.pinned ? <Icon name="pin" size={12} /> : chat.messages.length > 0 ? chat.messages[0].content.slice(0, 1).toUpperCase() : "N"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isEditing ? (
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditTitle(chat.title); }} onBlur={saveEdit} autoFocus onClick={e => e.stopPropagation()} style={{ width: "100%", background: "rgba(255,255,255,.1)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px", color: "#fff", fontSize: 12, outline: "none" }} />
        ) : (
          <div className="sidebar-title">{chat.title}</div>
        )}
        <div className="sidebar-meta">{chat.messages.length} messages • {formatDate(chat.updatedAt || chat.createdAt)}</div>
      </div>
      <div className="sidebar-actions">
        <button onClick={e => { e.stopPropagation(); onFavorite(chat.id); }} className={`sidebar-action ${chat.favorite ? "active" : ""}`} title={chat.favorite ? "Unfavorite" : "Favorite"}><Icon name="star" size={13} /></button>
        <button onClick={e => { e.stopPropagation(); onPin(chat.id); }} className={`sidebar-action ${chat.pinned ? "active" : ""}`} title={chat.pinned ? "Unpin" : "Pin"}><Icon name="pin" size={13} /></button>
        <button onClick={e => startEdit(chat, e)} className="sidebar-action" title="Rename"><Icon name="edit" size={13} /></button>
        <button onClick={e => { e.stopPropagation(); onDelete(chat.id); }} className="sidebar-action delete" title="Delete"><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
};

const App = () => {
  const [themeKey, setThemeKey] = useState(() => { const s = Storage.get("pa-theme"); return s && THEMES[s] ? s : "midnight"; });
  const [customBg, setCustomBg] = useState(() => Storage.get("pa-custom-bg") || "");
  const [customPrimary, setCustomPrimary] = useState(() => Storage.get("pa-custom-primary") || "");
  const [accentColor, setAccentColor] = useState(() => Storage.get("pa-accent-color") || "");
  const [bgOpacity, setBgOpacity] = useState(() => { const v = Storage.get("pa-bg-opacity"); return v !== null ? parseFloat(v) : 0.45; });
  const [glassOpacity, setGlassOpacity] = useState(() => { const v = Storage.get("pa-glass-opacity"); return v !== null ? parseFloat(v) : 0.92; });
  const [fontSize, setFontSize] = useState(() => { const v = Storage.get("pa-font-size"); return v !== null ? parseFloat(v) : 15; });
  const [compactMode, setCompactMode] = useState(() => Storage.get("pa-compact") === "true");
  const [animations, setAnimations] = useState(() => Storage.get("pa-animations") !== "false");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Storage.get("pa-sidebar-collapsed") === "true");
  const [showSettings, setShowSettings] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);

  const [userProfile, setUserProfile] = useState(() => Storage.get("pa-user-profile") || "");
  const [systemPrompt, setSystemPrompt] = useState(() => Storage.get("pa-system-prompt") || "");
  const [autoExtractMemory, setAutoExtractMemory] = useState(() => Storage.get("pa-auto-memory") !== "false");

  const { chats, sortedChats, activeChatId, setActiveChatId, createChat, deleteChat, renameChat, togglePinChat, toggleFavoriteChat, updateChatMessages, exportChat, exportAllChats } = useChatManager();
  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);
  const activeMessages = activeChat?.messages || [];

  const { streamText, status, stats, model, setModel, temperature, setTemperature, sendMessage, stopGeneration, wakeUp } = useChatSession(activeChatId, activeMessages, updateChatMessages, userProfile, systemPrompt);

  const [attachments, setAttachments] = useState([]);
  const [inputText, setInputText] = useState("");

  const [showCamera, setShowCamera] = useState(false);
  const cameraStreamRef = useRef(null), videoRef = useRef(null), canvasRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null), listeningTimeoutRef = useRef(null);
  const [ttsEnabled, setTtsEnabled] = useState(() => Storage.get("pa-tts") === "true");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const lastSpokenRef = useRef("");
  const chatRef = useRef(null);
  const health = useHealthCheck();
  const T = THEMES[themeKey] || DEFAULT_THEME;

  const primaryColor = customPrimary || T.primary;
  const borderColor = accentColor || T.borderColor;

  const extractMemory = useCallback(async () => {
    if (!autoExtractMemory || activeMessages.length < 4) return;
    const recent = activeMessages.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n");
    try {
      const res = await fetch(`${API_BASE}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `Based on this conversation, extract 3-5 key facts about the user's preferences, goals, or identity. Return only a concise bullet list.\n\n${recent}`, messages: [], modelType: model, sessionId: "memory-extract", temperature: 0.3 }) });
      const data = await res.json();
      const newFacts = data?.response || data?.text || "";
      if (newFacts.trim()) {
        setUserProfile(prev => { const existing = prev.split("\n").filter(f => f.trim()).slice(0, 15); const updated = [...new Set([...existing, ...newFacts.split("\n").filter(f => f.trim())])].slice(0, 20).join("\n"); Storage.set("pa-user-profile", updated); return updated; });
      }
    } catch {}
  }, [activeMessages, autoExtractMemory, model]);

  useEffect(() => Storage.set("pa-theme", themeKey), [themeKey]);
  useEffect(() => Storage.set("pa-custom-bg", customBg), [customBg]);
  useEffect(() => Storage.set("pa-custom-primary", customPrimary), [customPrimary]);
  useEffect(() => Storage.set("pa-accent-color", accentColor), [accentColor]);
  useEffect(() => Storage.set("pa-bg-opacity", bgOpacity.toString()), [bgOpacity]);
  useEffect(() => Storage.set("pa-glass-opacity", glassOpacity.toString()), [glassOpacity]);
  useEffect(() => Storage.set("pa-font-size", fontSize.toString()), [fontSize]);
  useEffect(() => Storage.set("pa-compact", compactMode.toString()), [compactMode]);
  useEffect(() => Storage.set("pa-animations", animations.toString()), [animations]);
  useEffect(() => Storage.set("pa-sidebar-collapsed", sidebarCollapsed.toString()), [sidebarCollapsed]);
  useEffect(() => Storage.set("pa-tts", ttsEnabled.toString()), [ttsEnabled]);
  useEffect(() => Storage.set("pa-user-profile", userProfile), [userProfile]);
  useEffect(() => Storage.set("pa-system-prompt", systemPrompt), [systemPrompt]);
  useEffect(() => Storage.set("pa-auto-memory", autoExtractMemory.toString()), [autoExtractMemory]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [activeMessages, streamText]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!ttsEnabled || !window.speechSynthesis || status !== "idle") return;
    const last = activeMessages[activeMessages.length - 1];
    if (last && last.role === "assistant" && last.id !== lastSpokenRef.current && !last.imageUrl) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(last.content.replace(/^⚠️ /, ""));
      u.onstart = () => setIsSpeaking(true); u.onend = () => setIsSpeaking(false); u.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(u); lastSpokenRef.current = last.id;
    }
  }, [activeMessages, status, ttsEnabled]);

  const exportChatRef = useRef(exportChat);
  useEffect(() => { exportChatRef.current = exportChat; }, [exportChat]);

  useEffect(() => {
    const handler = (e) => { 
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setSearchQuery(q => q ? "" : "focus"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "j") { e.preventDefault(); if (activeChatId) exportChatRef.current(activeChatId, "markdown"); setToast("Chat exported"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") { e.preventDefault(); createChat(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "b") { e.preventDefault(); setSidebarCollapsed(c => !c); setSidebarOpen(false); }
      if (e.key === "Escape") { setShowSettings(false); setShowMemory(false); setSidebarOpen(false); setSearchQuery(""); stopCamera(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeChatId, createChat]);

  const speakText = (text) => {
    if (!window.speechSynthesis) { setToast("Speech not supported"); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/^⚠️ /, ""));
    u.onstart = () => setIsSpeaking(true); u.onend = () => setIsSpeaking(false); u.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  const filteredMessages = useMemo(() => searchQuery.trim() ? activeMessages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase())) : activeMessages, [activeMessages, searchQuery]);

  const handleSend = useCallback(async (text) => {
    const cleanText = text.trim();
    if (isImageRequest(cleanText)) {
      const imagePrompt = parseImagePrompt(cleanText);
      if (!imagePrompt) { setToast("Describe the image. Example: /image a futuristic classroom"); return; }
      setImageLoading(true);
      const userMsg = { role: "user", content: cleanText, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() };
      const withUser = [...activeMessages, userMsg];
      updateChatMessages(activeChatId, withUser);
      try {
        await new Promise(r => setTimeout(r, 500));
        updateChatMessages(activeChatId, [...withUser, { role: "assistant", content: "", imageUrl: buildImageUrl(imagePrompt), imagePrompt, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]);
      } catch {
        updateChatMessages(activeChatId, [...withUser, { role: "assistant", content: "⚠️ Failed to generate image. Please try again.", ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]);
      } finally { setImageLoading(false); setInputText(""); setAttachments([]); }
      return;
    }
    if (health?.status === 'error' || health?.status === 'degraded') { setToast(`Service ${health.status}: ${health.error || 'Check connection'}`); return; }
    if (!VISION_MODELS.includes(model) && attachments.length > 0) { setToast(`${getModelDisplayName(model)} cannot see images. Switch to a vision model.`); return; }
    sendMessage(text, attachments); setAttachments([]); setInputText("");
  }, [sendMessage, health, attachments, model, activeChatId, activeMessages, updateChatMessages]);

  const regenerateLast = useCallback(() => {
    const lastUser = [...activeMessages].reverse().find(m => m.role === "user");
    if (!lastUser) return;
    updateChatMessages(activeChatId, activeMessages.filter(m => m.id !== lastUser.id));
    setTimeout(() => handleSend(lastUser.content), 100);
  }, [activeMessages, activeChatId, updateChatMessages, handleSend]);

  const handleFileSelect = (e) => { const files = Array.from(e.target.files).filter(f => f.type.startsWith("image/")); if (!files.length) { setToast("Only image files are supported"); return; } setAttachments(prev => [...prev, ...files]); e.target.value = ""; };
  const handleDrop = (e) => { e.preventDefault(); setAttachments(prev => [...prev, ...Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"))]); };
  const pasteImage = (e) => { const items = e.clipboardData?.items; if (!items) return; for (const item of items) if (item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) setAttachments(prev => [...prev, f]); } };

  const startCamera = async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); cameraStreamRef.current = s; setShowCamera(true); setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100); } catch { setToast("Camera access denied or unavailable"); } };
  const stopCamera = () => { if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; } setShowCamera(false); };
  const capturePhoto = () => { if (!videoRef.current || !canvasRef.current) return; const v = videoRef.current, c = canvasRef.current; c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0); c.toBlob(b => { setAttachments(prev => [...prev, new File([b], `camera-${Date.now()}.png`, { type: "image/png" })]); stopCamera(); }, "image/png"); };

  const stopListening = useCallback(() => { if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current); if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; } setIsListening(false); }, []);
  const startListening = useCallback(() => {
    if (!window.navigator?.mediaDevices) { setToast("Microphone not available in this browser"); return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setToast("Voice input needs Chrome, Edge, or Safari"); return; }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    try {
      const r = new SpeechRecognition();
      r.continuous = false; r.interimResults = false; r.lang = "en-US"; r.maxAlternatives = 1;
      r.onstart = () => { setIsListening(true); listeningTimeoutRef.current = setTimeout(() => { try { r.stop(); } catch {} }, 10000); };
      r.onend = () => { setIsListening(false); if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current); recognitionRef.current = null; };
      r.onresult = (e) => { let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; if (t.trim()) setInputText(p => p + t + " "); };
      r.onerror = (e) => { console.warn("Voice error:", e.error); if (e.error === "not-allowed") setToast("Microphone permission denied"); else if (e.error === "no-speech") setToast("No speech detected — try again"); else if (e.error === "network") setToast("Voice recognition needs an internet connection. Try Chrome desktop with a stable connection."); else if (e.error !== "aborted") setToast("Voice error: " + e.error); setIsListening(false); if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current); recognitionRef.current = null; };
      r.start(); recognitionRef.current = r;
    } catch { setToast("Could not start voice input"); setIsListening(false); }
  }, []);
  const toggleListening = useCallback(() => { if (isListening) stopListening(); else startListening(); }, [isListening, stopListening, startListening]);
  const handlePerchance = () => { const p = ["Generate a random fantasy character backstory","Create a random startup idea and pitch it","Write a random plot twist for a sci-fi movie","Invent a new ice cream flavor and describe it vividly","Generate a random D&D quest for level 5 heroes","Describe a random alien planet and its inhabitants","Write a random advertisement for an absurd product","Create a random recipe with unusual ingredients","Generate a random superhero origin story","Describe a random haunted house room","Invent a random video game mechanic","Write a random email from a future civilization"]; setInputText(p[Math.floor(Math.random()*p.length)]); };
  const handleCreateChat = () => { createChat(); setInputText(""); setAttachments([]); };
  const toggleSidebar = () => { if (window.innerWidth <= 900) { setSidebarOpen(o => !o); setSidebarCollapsed(false); } else { setSidebarCollapsed(c => !c); setSidebarOpen(false); } };

  const instanceVars = { "--primary": primaryColor, "--border": borderColor, "--user-bubble": T.userBubble, "--ai-bubble": T.aiBubble, "--font-size": `${fontSize}px` };
  const bgLayerStyle = customBg ? { backgroundImage: `url(${customBg})` } : { backgroundImage: T.bg };
  const overlayStyle = customBg ? { backgroundColor: `rgba(0,0,0,${1 - bgOpacity})` } : { backgroundColor: "rgba(0,0,0,0.55)" };
  const shellBg = `rgba(${extractRgb(T.cardBg)}, ${glassOpacity})`;
  const themeCardSelected = (k) => themeKey === k && !customBg && !customPrimary && !accentColor;

  return (
    <div className={`app-root ${customBg ? "custom-bg" : ""} ${animations ? "" : "no-anim"}`} style={{ ...instanceVars }} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
      <GlobalStyles />
      <div className="bg-layer" style={bgLayerStyle} />
      <div className="bg-overlay" style={overlayStyle} />
      {toast && <div className="toast"><Icon name="warning" size={16} color="#fca5a5" /> <span>{toast}</span></div>}
      {showCamera && <div className="camera-overlay"><video ref={videoRef} autoPlay className="camera-video" /><canvas ref={canvasRef} style={{ display: "none" }} /><div className="camera-controls"><button onClick={capturePhoto} className="camera-btn primary">Capture</button><button onClick={stopCamera} className="camera-btn secondary">Cancel</button></div></div>}
      <div className="app-shell" style={{ fontSize: `${fontSize}px` }}>
        <header className="app-header">
          <button className="menu-btn" onClick={toggleSidebar} title="Toggle chats (Ctrl+B)"><Icon name="menu" size={20} /></button>
          <div className="brand">
            
            <div className="title-group">
              <h1 className="main-title">{activeChat?.title || "ALOP-AI"}</h1>
              <span className="sub-title">{T.name} • {getModelDisplayName(model)}{isSpeaking ? " • SPEAKING" : ""}{isListening ? " • LISTENING" : ""}</span>
            </div>
          </div>
          <div className="header-actions">
            <button className={`icon-btn ${ttsEnabled ? "active" : ""}`} onClick={() => { if (isSpeaking) window.speechSynthesis.cancel(); setTtsEnabled(v => !v); }} title="Toggle AI voice"><Icon name={ttsEnabled ? "volume" : "volumeX"} size={20} /></button>
            <button className={`icon-btn ${showMemory ? "active" : ""}`} onClick={() => { setShowMemory(s => !s); setShowSettings(false); }} title="Memory & Learning"><Icon name="brain" size={20} /></button>
            <button className="icon-btn" onClick={handlePerchance} title="Random prompt"><Icon name="refresh" size={20} /></button>
            <button className="icon-btn" onClick={() => { if (activeChatId) exportChat(activeChatId, "markdown"); setToast("Chat exported as Markdown"); }} title="Export chat (Ctrl+J)"><Icon name="download" size={20} /></button>
            <button className={`icon-btn ${showSettings ? "active" : ""}`} onClick={() => { setShowSettings(s => !s); setShowMemory(false); }} title="Settings"><Icon name="settings" size={20} /></button>
          </div>
        </header>
        <div className="app-body">
          <ChatSidebar chats={sortedChats} activeChatId={activeChatId} onSelect={setActiveChatId} onCreate={handleCreateChat} onDelete={deleteChat} onRename={renameChat} onPin={togglePinChat} onFavorite={toggleFavoriteChat} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} collapsed={sidebarCollapsed} />
          <div className="chat-main">
            {showMemory && <div className="memory-panel">
              <div className="panel-header">
                <div className="panel-title"><Icon name="brain" size={16} /> Memory & Learning</div>
                <button onClick={() => setShowMemory(false)} className="icon-btn" title="Close"><Icon name="close" size={18} /></button>
              </div>
              <div className="memory-card">
                <div className="memory-card-title">AI Instructions (system prompt)</div>
                <textarea className="custom-input textarea" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="Example: You are a helpful tutor for high school students. Always explain concepts simply." />
              </div>
              <div className="memory-card">
                <div className="memory-card-title">What the AI remembers about you</div>
                <textarea className="custom-input textarea" value={userProfile} onChange={e => setUserProfile(e.target.value)} placeholder="The AI uses this in every conversation. Example: I am a biology teacher. I prefer short answers with examples." />
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={() => { setUserProfile(""); setToast("Memory cleared"); }} className="theme-card">Clear Memory</button>
                  <button onClick={() => { extractMemory(); setToast("Memory updated from chat"); }} className="theme-card">Extract from Chat</button>
                  <button onClick={() => setAutoExtractMemory(v => !v)} className={`theme-card ${autoExtractMemory ? "selected" : ""}`}>{autoExtractMemory ? "Auto-Memory On" : "Auto-Memory Off"}</button>
                </div>
              </div>
            </div>}
            {showSettings && <div className="memory-panel">
              <div className="panel-header">
                <div className="panel-title">Settings</div>
                <button onClick={() => setShowSettings(false)} className="icon-btn" title="Close"><Icon name="close" size={18} /></button>
              </div>
              <div className="setting-row">
                <div className="setting-label">Theme</div>
                <div className="theme-grid">
                  {Object.entries(THEMES).map(([k, v]) => <button key={k} onClick={() => { setThemeKey(k); setCustomPrimary(""); setAccentColor(""); }} className={`theme-card ${themeCardSelected(k) ? "selected" : ""}`}>{v.name}</button>)}
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Background Image</div>
                <input className="custom-input" type="text" value={customBg} onChange={e => setCustomBg(e.target.value)} placeholder="Paste image URL" />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => setCustomBg(BACKGROUND_PRESETS.forest)} className="theme-card">Forest</button>
                  <button onClick={() => setCustomBg(BACKGROUND_PRESETS.space)} className="theme-card">Space</button>
                  <button onClick={() => setCustomBg(BACKGROUND_PRESETS.beach)} className="theme-card">Beach</button>
                  <button onClick={() => setCustomBg(BACKGROUND_PRESETS.mountains)} className="theme-card">Mountains</button>
                  <button onClick={() => setCustomBg(BACKGROUND_PRESETS.abstract)} className="theme-card">Abstract</button>
                  <button onClick={() => setCustomBg(BACKGROUND_PRESETS.water)} className="theme-card">Water</button>
                  <button onClick={() => setCustomBg(BACKGROUND_PRESETS.fire)} className="theme-card">Fire</button>
                  <button onClick={() => { setCustomBg(""); setCustomPrimary(""); setAccentColor(""); }} className="theme-card">Reset</button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Background Intensity: {Math.round(bgOpacity * 100)}%</div>
                <div className="slider-container">
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Dim</span>
                  <input type="range" min="0" max="1" step="0.05" value={bgOpacity} onChange={(e) => setBgOpacity(parseFloat(e.target.value))} className="slider" />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Bright</span>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Chat Opacity: {Math.round(glassOpacity * 100)}%</div>
                <div className="slider-container">
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Clear</span>
                  <input type="range" min="0" max="1" step="0.05" value={glassOpacity} onChange={(e) => setGlassOpacity(parseFloat(e.target.value))} className="slider" />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Solid</span>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Font Size: {fontSize}px</div>
                <div className="slider-container">
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Small</span>
                  <input type="range" min="12" max="22" step="1" value={fontSize} onChange={(e) => setFontSize(parseFloat(e.target.value))} className="slider" />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Large</span>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Accent Color</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="color" value={accentColor || rgbaToHex(T.borderColor, T.primary)} onChange={e => setAccentColor(e.target.value)} className="color-picker" />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>{accentColor || "Theme default"}</span>
                  {accentColor && <button onClick={() => setAccentColor("")} className="theme-card">Reset</button>}
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Button Color</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="color" value={customPrimary || T.primary} onChange={e => setCustomPrimary(e.target.value)} className="color-picker" />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>{customPrimary || "Theme default"}</span>
                  {customPrimary && <button onClick={() => setCustomPrimary("")} className="theme-card">Reset</button>}
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Options</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => setCompactMode(v => !v)} className={`theme-card ${compactMode ? "selected" : ""}`}>{compactMode ? "Compact On" : "Compact Off"}</button>
                  <button onClick={() => setAnimations(v => !v)} className={`theme-card ${animations ? "selected" : ""}`}>{animations ? "Animations On" : "Animations Off"}</button>
                  <button onClick={() => { if (activeChatId) deleteChat(activeChatId); }} className="theme-card">Delete Chat</button>
                  <button onClick={() => { exportAllChats(); setToast("All chats exported"); }} className="theme-card">Export All</button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">AI Model</div>
                <div className="model-select-container">
                  <select value={model} onChange={(e) => setModel(e.target.value)} className="model-select">
                    {Object.entries(MODEL_CATEGORIES).map(([category, models]) => <optgroup key={category} label={category}>
                      {models.map(modelKey => <option key={modelKey} value={modelKey}>{getModelDisplayName(modelKey)}</option>)}
                    </optgroup>)}
                  </select>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Creativity: {temperature.toFixed(1)}</div>
                <div className="slider-container">
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Precise</span>
                  <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="slider" />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Creative</span>
                </div>
              </div>
            </div>}
            {activeMessages.length > 0 && <div className="search-bar">
              <Icon name="search" size={18} />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search conversation... (Ctrl+K)" />
              <button onClick={() => setSearchQuery("")}><Icon name="close" size={18} /></button>
            </div>}
            <div className="chat-content">
              <div className="scroll-wrapper" ref={chatRef} style={{ fontSize: `${fontSize}px` }}>
                {(health?.status === 'error' || health?.status === 'degraded') && <div className="error-banner">
                  <Icon name="warning" size={18} color="#fca5a5" />
                  <div><strong style={{ fontSize: 13, textTransform: "uppercase" }}>Service {health?.status}</strong><p style={{ margin: 0, fontSize: 12, marginTop: 3, color: "rgba(255,255,255,.55)" }}>{health?.error || 'Connecting...'}</p></div>
                </div>}
                {wakeUp && status === "loading" && <div className="wake-banner">
                  <Icon name="refresh" size={16} color="#fbbf24" />
                  <div><strong style={{ fontSize: 13 }}>Waking up the AI server...</strong><p style={{ margin: 0, fontSize: 12, marginTop: 3, color: "rgba(255,255,255,.6)" }}>Free servers sleep after inactivity. First response may take 30-60 seconds.</p></div>
                </div>}
                {activeMessages.length === 0 && !streamText && !imageLoading && <div className="empty-state">
                  
                  <div>
                    <h2 className="empty-title">ALOP-AI</h2>
                    <p className="empty-subtitle">Upload images, paste screenshots, use your voice, or type a message. Try <strong>/image</strong> to generate professional images.</p>
                  </div>
                </div>}
                {filteredMessages.map((msg, idx) => <div key={msg.id || idx} className={`msg-row ${msg.role}`}>
                  <div className="avatar">{msg.role === "user" ? "YOU" : "AI"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {msg.content && <div className="bubble" style={{ padding: compactMode ? "10px 14px" : "14px 18px" }}>{formatMessage(msg.content)}</div>}
                    {msg.imageUrl && (
                      <div style={{ marginTop: 10 }}>
                        <img className="generated-image" src={msg.imageUrl} alt={msg.imagePrompt || "Generated image"} loading="lazy" onClick={() => window.open(msg.imageUrl, "_blank")} />
                        <div className="image-prompt">{msg.imagePrompt}</div>
                        <div className="msg-actions" style={{ opacity: 1, marginTop: 6 }}>
                          <a href={msg.imageUrl} download="generated-image.png" target="_blank" rel="noopener noreferrer" className="msg-action-btn"><Icon name="download" size={11} /> Download</a>
                        </div>
                      </div>
                    )}
                    {msg.attachments?.length > 0 && <div className="attachment-grid">
                      {msg.attachments.map((a, i) => <div key={i} className="attachment-thumb"><img src={a.url} alt={a.name} /></div>)}
                    </div>}
                    {msg.role === "assistant" && !msg.imageUrl && <MessageActions content={msg.content} onSpeak={speakText} onRegenerate={idx === filteredMessages.length - 1 ? regenerateLast : null} />}
                    <div className="msg-meta">{msg.ts}</div>
                  </div>
                </div>)}
                {status === "streaming" && streamText && <div className="msg-row assistant">
                  <div className="avatar">AI</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bubble" style={{ padding: compactMode ? "10px 14px" : "14px 18px" }}>{formatMessage(streamText)}<span className="typing-indicator" /></div>
                    <div className="msg-actions" style={{ opacity: 1 }}><button onClick={stopGeneration} className="msg-action-btn"><Icon name="stop" size={11} /> Stop</button></div>
                    <div className="msg-meta">typing...</div>
                  </div>
                </div>}
                {status === "loading" && <div className="msg-row assistant">
                  <div className="avatar">AI</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bubble" style={{ fontStyle: "italic", opacity: .7, display: "flex", alignItems: "center", gap: 8, padding: compactMode ? "10px 14px" : "14px 18px" }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--primary)" }} />
                      <span>Processing with {getModelDisplayName(model)}...</span>
                    </div>
                    <div className="msg-meta">thinking</div>
                  </div>
                </div>}
                {imageLoading && <div className="msg-row assistant">
                  <div className="avatar">AI</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bubble" style={{ display: "flex", alignItems: "center", gap: 10, padding: compactMode ? "10px 14px" : "14px 18px" }}>
                      <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,.2)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                      <span>Generating image with FLUX...</span>
                    </div>
                    <div className="msg-meta">this may take a few seconds</div>
                  </div>
                </div>}
              </div>
              <InputBar text={inputText} setText={setInputText} onSend={handleSend} disabled={status !== "idle" || imageLoading} status={status} stats={stats} attachments={attachments} setAttachments={setAttachments} onFileSelect={handleFileSelect} onPasteImage={pasteImage} onStartCamera={startCamera} isListening={isListening} toggleListening={toggleListening} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
