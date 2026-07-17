import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const uid = () => crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);

const API_BASE = "https://alop-ai.onrender.com";

const Storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  remove: (k) => { try { localStorage.removeItem(k); } catch {} }
};

const extractRgb = (rgbaString) => {
  const match = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return "139, 92, 246";
  return `${match[1]}, ${match[2]}, ${match[3]}`;
};

const rgbaToHex = (rgbaString, fallback) => {
  const match = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return fallback;
  const hex = [match[1], match[2], match[3]].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
  return `#${hex}`;
};

const THEMES = {
  midnight: { name: "Midnight", primary: "#8b5cf6", bg: "linear-gradient(135deg, #0a0a0f, #12121a, #1a1a2e)", cardBg: "rgba(16, 16, 24, 0.88)", borderColor: "rgba(139, 92, 246, 0.18)", userBubble: "rgba(139, 92, 246, 0.18)", aiBubble: "rgba(139, 92, 246, 0.10)" },
  graphite: { name: "Graphite", primary: "#64748b", bg: "linear-gradient(135deg, #0f0f12, #1a1a1f, #0f0f12)", cardBg: "rgba(20, 20, 24, 0.9)", borderColor: "rgba(100, 116, 139, 0.2)", userBubble: "rgba(100, 116, 139, 0.2)", aiBubble: "rgba(100, 116, 139, 0.12)" },
  ocean: { name: "Ocean", primary: "#0ea5e9", bg: "linear-gradient(135deg, #020617, #0c1a2e, #020617)", cardBg: "rgba(8, 20, 36, 0.9)", borderColor: "rgba(14, 165, 233, 0.18)", userBubble: "rgba(14, 165, 233, 0.18)", aiBubble: "rgba(14, 165, 233, 0.10)" },
  emerald: { name: "Emerald", primary: "#10b981", bg: "linear-gradient(135deg, #020c0b, #0a1f1a, #020c0b)", cardBg: "rgba(6, 24, 20, 0.9)", borderColor: "rgba(16, 185, 129, 0.18)", userBubble: "rgba(16, 185, 129, 0.18)", aiBubble: "rgba(16, 185, 129, 0.10)" },
  crimson: { name: "Crimson", primary: "#f43f5e", bg: "linear-gradient(135deg, #1a0508, #2a0a10, #1a0508)", cardBg: "rgba(26, 5, 8, 0.9)", borderColor: "rgba(244, 63, 94, 0.18)", userBubble: "rgba(244, 63, 94, 0.18)", aiBubble: "rgba(244, 63, 94, 0.10)" },
  amber: { name: "Amber", primary: "#f59e0b", bg: "linear-gradient(135deg, #1a1005, #2a1a0a, #1a1005)", cardBg: "rgba(26, 16, 5, 0.9)", borderColor: "rgba(245, 158, 11, 0.18)", userBubble: "rgba(245, 158, 11, 0.18)", aiBubble: "rgba(245, 158, 11, 0.10)" },
  arctic: { name: "Arctic", primary: "#3b82f6", bg: "linear-gradient(135deg, #f8fafc, #e2e8f0, #f8fafc)", cardBg: "rgba(255, 255, 255, 0.92)", borderColor: "rgba(59, 130, 246, 0.25)", userBubble: "rgba(59, 130, 246, 0.15)", aiBubble: "rgba(59, 130, 246, 0.08)" }
};

const DEFAULT_THEME = THEMES.midnight;

const SUGGESTIONS = [
  { text: "Explain quantum computing simply", category: "Science" },
  { text: "Write Python for sales data analysis", category: "Coding" },
  { text: "Create a tech startup business plan", category: "Business" },
  { text: "Explain blockchain applications", category: "Technology" },
  { text: "Optimize database performance", category: "Tech" },
  { text: "Write a poem about AI", category: "Creative" }
];

const MODEL_DISPLAY_NAMES = {
  'glm-5.2': 'GLM 5.2',
  'glm-5.1': 'GLM 5.1',
  'gemma4:31b': 'Gemma 4',
  'qwen3.5:397b': 'Qwen 3.5',
  'minimax-m2.7': 'MiniMax M2.7',
  'minimax-m2.5': 'MiniMax M2.5',
  'minimax-m3': 'MiniMax M3',
  'nemotron-3-super': 'Nemotron Super',
  'nemotron-3-ultra': 'Nemotron Ultra',
  'nemotron-3-nano:30b': 'Nemotron Nano',
  'kimi-k2.7-code': 'Kimi K2.7',
  'kimi-k2.6': 'Kimi K2.6',
  'kimi-k2.5': 'Kimi K2.5',
  'deepseek-v4-flash': 'DeepSeek Flash',
  'deepseek-v4-pro': 'DeepSeek Pro',
  'gpt-oss:20b': 'GPT-OSS 20B',
  'gpt-oss:120b': 'GPT-OSS 120B',
  'mistral-large-3:675b': 'Mistral Large 3'
};

const getModelDisplayName = (key) => MODEL_DISPLAY_NAMES[key] || key;

const MODEL_CATEGORIES = {
  'GLM': ['glm-5.2', 'glm-5.1'],
  'Google': ['gemma4:31b'],
  'Alibaba': ['qwen3.5:397b'],
  'MiniMax': ['minimax-m2.7', 'minimax-m2.5', 'minimax-m3'],
  'NVIDIA': ['nemotron-3-super', 'nemotron-3-ultra', 'nemotron-3-nano:30b'],
  'Moonshot': ['kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5'],
  'DeepSeek': ['deepseek-v4-flash', 'deepseek-v4-pro'],
  'OpenAI': ['gpt-oss:20b', 'gpt-oss:120b'],
  'Mistral': ['mistral-large-3:675b']
};

const VISION_MODELS = ['gemma4:31b', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5', 'mistral-large-3:675b', 'deepseek-v4-pro'];

const PERCHANCE_PROMPTS = [
  "Generate a random fantasy character backstory",
  "Create a random startup idea and pitch it",
  "Write a random plot twist for a sci-fi movie",
  "Invent a new ice cream flavor and describe it vividly",
  "Generate a random D&D quest for level 5 heroes",
  "Describe a random alien planet and its inhabitants",
  "Write a random advertisement for an absurd product",
  "Create a random recipe with unusual ingredients",
  "Generate a random superhero origin story",
  "Describe a random haunted house room",
  "Invent a random video game mechanic",
  "Write a random email from a future civilization"
];

const BACKGROUND_PRESETS = {
  forest: "https://images.unsplash.com/photo-1511497584788-876760111969?w=1920&q=80",
  space: "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1920&q=80",
  beach: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=80",
  mountains: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80",
  abstract: "https://images.unsplash.com/photo-1557683316-973673baf926?w=1920&q=80",
  water: "https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1920&q=80",
  fire: "https://images.unsplash.com/photo-1505009253807-0a4c86083162?w=1920&q=80"
};

const MATERIAL_OVERLAYS = {
  none: "",
  wood: "https://www.transparenttextures.com/patterns/wood-pattern.png",
  metal: "https://www.transparenttextures.com/patterns/brushed-alum.png",
  paper: "https://www.transparenttextures.com/patterns/cream-paper.png",
  fabric: "https://www.transparenttextures.com/patterns/gray-flannel.png",
  concrete: "https://www.transparenttextures.com/patterns/concrete-wall.png",
  leather: "https://www.transparenttextures.com/patterns/leather-nunchuk.png",
  brick: "https://www.transparenttextures.com/patterns/brick-wall.png",
  canvas: "https://www.transparenttextures.com/patterns/canvas-orange.png",
  noise: "https://www.transparenttextures.com/patterns/stardust.png"
};

const Icon = ({ name, size = 18, color = "currentColor" }) => {
  const icons = {
    menu: <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    close: <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    plus: <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    camera: <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    mic: <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    "mic-off": <path d="M1 1l22 22M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
    search: <g><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></g>,
    settings: <g><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></g>,
    copy: <g><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    speaker: <path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    dice: <g><rect x="2" y="2" width="20" height="20" rx="5" ry="5" stroke="currentColor" strokeWidth="2" fill="none" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /><circle cx="16" cy="8" r="1.5" fill="currentColor" /><circle cx="8" cy="16" r="1.5" fill="currentColor" /><circle cx="16" cy="16" r="1.5" fill="currentColor" /></g>,
    export: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    crown: <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    volume: <path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    volumeX: <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    edit: <g><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    trash: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle", color }}>
      {icons[name] || null}
    </svg>
  );
};


const useChatManager = () => {
  const [chats, setChats] = useState(() => {
    try {
      const saved = JSON.parse(Storage.get('pa_chats') || '[]');
      return Array.isArray(saved) && saved.length > 0 ? saved : [];
    } catch { return []; }
  });

  const [activeChatId, setActiveChatId] = useState(null);

  useEffect(() => {
    if (!activeChatId && chats.length > 0) {
      const saved = Storage.get('pa_active_chat');
      const found = chats.find(c => c.id === saved);
      setActiveChatId(found ? found.id : chats[0].id);
    }
  }, [activeChatId, chats]);

  const createChat = useCallback((title = "New Chat") => {
    const newChat = { id: uid(), title, messages: [], createdAt: Date.now() };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    return newChat.id;
  }, []);

  useEffect(() => {
    if (chats.length === 0) createChat("New Chat");
  }, [chats.length, createChat]);

  const deleteChat = useCallback((id) => {
    const chat = chats.find(c => c.id === id);
    chat?.messages?.forEach(m => m.attachments?.forEach(a => { try { URL.revokeObjectURL(a.url); } catch {} }));
    setChats(prev => prev.filter(c => c.id !== id));
    setActiveChatId(prev => {
      if (prev !== id) return prev;
      const remaining = chats.filter(c => c.id !== id);
      return remaining[0]?.id || null;
    });
  }, [chats]);

  const renameChat = useCallback((id, title) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, title } : c));
  }, []);

  const updateChatMessages = useCallback((id, messages) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, messages, updatedAt: Date.now() } : c));
  }, []);

  const exportChat = useCallback((id) => {
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    const data = chat.messages.map(m => ({ role: m.role, content: m.content, time: m.ts }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${chat.title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chats]);

  const exportAllChats = useCallback(() => {
    const blob = new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all-chats-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chats]);

  useEffect(() => { Storage.set('pa_chats', JSON.stringify(chats)); }, [chats]);
  useEffect(() => { if (activeChatId) Storage.set('pa_active_chat', activeChatId); }, [activeChatId]);

  return { chats, activeChatId, setActiveChatId, createChat, deleteChat, renameChat, updateChatMessages, exportChat, exportAllChats };
};

const useChatSession = (chatId, messages, updateMessages) => {
  const [sessionId] = useState(() => Storage.get('pa_session') || uid());
  const [model, setModel] = useState(() => Storage.get("pa-model") || "glm-5.2");
  const [temperature, setTemperature] = useState(() => parseFloat(Storage.get("pa-temperature")) || 0.7);
  const [streamText, setStreamText] = useState("");
  const [status, setStatus] = useState("idle");
  const [stats, setStats] = useState(null);
  const abortRef = useRef(null);
  const accRef = useRef("");
  const rafIdRef = useRef(null);

  useEffect(() => { Storage.set("pa-model", model); }, [model]);
  useEffect(() => { Storage.set("pa-temperature", temperature.toString()); }, [temperature]);

  const sendMessage = useCallback(async (text, attachments = []) => {
    const hasContent = text?.trim() || attachments.length > 0;
    if (!hasContent || status !== "idle" || !chatId) return;

    setStatus("loading");
    accRef.current = "";
    setStreamText("");
    setStats(null);

    const newUserMsg = {
      role: "user",
      content: text || "",
      attachments: attachments.map(f => ({ name: f.name, url: URL.createObjectURL(f), type: f.type })),
      ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      id: uid()
    };

    const updatedMessages = [...messages.slice(-99), newUserMsg];
    updateMessages(chatId, updatedMessages);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      let res;
      const historyJson = JSON.stringify(messages.slice(-10).map(m => ({ role: m.role, content: m.content })));

      if (attachments.length > 0) {
        const formData = new FormData();
        formData.append("message", text || "");
        formData.append("modelType", model);
        formData.append("temperature", temperature.toString());
        formData.append("sessionId", sessionId);
        formData.append("messages", historyJson);
        attachments.forEach(file => formData.append("files", file));
        res = await fetch(`${API_BASE}/chat`, {
          method: "POST",
          body: formData,
          signal: abortRef.current.signal,
        });
      } else {
        res = await fetch(`${API_BASE}/chat`, {
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
      }

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
              const finalMessages = [...updatedMessages, { role: "assistant", content: accRef.current, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }];
              updateMessages(chatId, finalMessages);
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
        const finalMessages = [...updatedMessages, { role: "assistant", content: accRef.current, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }];
        updateMessages(chatId, finalMessages);
        accRef.current = "";
      }
      setStreamText("");
      setStatus("idle");
    } catch (err) {
      if (err.name === "AbortError") return;
      setStatus("error");
      updateMessages(chatId, [...updatedMessages, { role: "assistant", content: `⚠️ ${err.message || 'Connection failed'}`, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]);
    }
  }, [chatId, messages, model, sessionId, temperature, status, updateMessages]);

  return { streamText, status, stats, model, setModel, temperature, setTemperature, sendMessage };
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

const formatMessage = (text) => {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const code = part.slice(3, -3).replace(/^\w+\n/, "");
      return <pre key={i} style={{ background: "rgba(0,0,0,.55)", padding: 14, borderRadius: 8, overflowX: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, border: "1px solid var(--border)", marginTop: 8, marginBottom: 8 }}><code style={{ color: "#e2e8f0", whiteSpace: "pre" }}>{code}</code></pre>;
    }
    return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
  });
};

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; overflow:hidden; height:100vh; background: #000000; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    .app-root { min-height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .app-root.custom-bg { background-size: cover; background-position: center; background-repeat: no-repeat; }
    .glass-main { position: relative; z-index: 10; width: min(98vw, 1200px); height: min(98vh, 1000px); backdrop-filter: blur(24px) saturate(1.5); border: 1px solid var(--border); border-radius: 16px; display: flex; flex-direction: row; overflow: hidden; box-shadow: 0 32px 128px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,.05); }
    .chat-sidebar { width: 280px; flex-shrink: 0; border-right: 1px solid var(--border); background: rgba(0,0,0,.35); display: flex; flex-direction: column; overflow: hidden; transition: width .3s ease, padding .3s ease; }
    .chat-sidebar.collapsed { width: 0; padding: 0; border-right: none; overflow: hidden; }
    .sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); display: flex; gap: 10px; align-items: center; }
    .sidebar-btn { flex: 1; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: var(--primary); color: #000; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all .2s; }
    .sidebar-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .close-sidebar-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,.05); color: rgba(255,255,255,.7); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s; }
    .close-sidebar-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
    .sidebar-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .sidebar-item { padding: 12px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: all .15s; border: 1px solid transparent; position: relative; }
    .sidebar-item:hover { background: rgba(255,255,255,.06); border-color: var(--border); }
    .sidebar-item.active { background: rgba(255,255,255,.1); border-color: var(--primary); }
    .sidebar-icon { width: 30px; height: 30px; border-radius: 8px; background: rgba(255,255,255,.06); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: rgba(255,255,255,.6); flex-shrink: 0; }
    .sidebar-item.active .sidebar-icon { color: var(--primary); background: rgba(255,255,255,.1); }
    .sidebar-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: rgba(255,255,255,.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sidebar-item.active .sidebar-title { color: #fff; }
    .sidebar-meta { font-size: 10px; color: rgba(255,255,255,.4); margin-top: 2px; }
    .sidebar-actions { display: flex; gap: 4px; opacity: 0; transition: opacity .2s; }
    .sidebar-item:hover .sidebar-actions { opacity: 1; }
    .sidebar-action { width: 24px; height: 24px; border-radius: 6px; border: none; background: transparent; color: rgba(255,255,255,.4); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .15s; }
    .sidebar-action:hover { background: rgba(255,255,255,.1); color: #fff; }
    .sidebar-action.delete:hover { background: rgba(239,68,68,.2); color: #fca5a5; }
    .chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .app-header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .menu-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,.05); color: rgba(255,255,255,.7); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s; }
    .menu-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
    .logo-box { width: 36px; height: 36px; border-radius: 10px; background: rgba(255,255,255,.06); display:flex; align-items:center; justify-content:center; font-size: 13px; font-weight: 700; color: var(--primary); cursor: pointer; border: 1px solid var(--border); transition: all .2s; }
    .logo-box:hover { background: rgba(255,255,255,.1); box-shadow: 0 0 20px rgba(139,92,246,.15); }
    .title-group { flex:1; min-width:0; }
    .main-title { font-size: 16px; font-weight: 600; color: #fff; letter-spacing: -.2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sub-title { font-size: 10px; color: rgba(255,255,255,.45); letter-spacing: .5px; text-transform: uppercase; margin-top: 2px; }
    .header-actions { display:flex; gap:8px; align-items:center; position:relative; }
    .icon-btn { width:36px; height:36px; border-radius:10px; border:1px solid transparent; background: rgba(255,255,255,.05); color:rgba(255,255,255,.65); cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all .15s; flex-shrink: 0; }
    .icon-btn:hover { background:rgba(255,255,255,.1); border-color:var(--border); color:#fff; }
    .icon-btn.active { background: var(--primary); color: #000; border-color: transparent; }
    .dot { width: 22px; height: 22px; border-radius:50%; border:2px solid rgba(255,255,255,.15); cursor:pointer; transition: all .2s; background: var(--color); }
    .dot:hover { transform: scale(1.2); border-color: rgba(255,255,255,.4); box-shadow: 0 0 8px var(--color); }
    .dot.active { border-color: #fff; box-shadow: 0 0 12px var(--color); }
    .app-content { flex:1; display:flex; flex-direction:column; position:relative; overflow:hidden; min-height:0; }
    .settings-drawer { background: rgba(0,0,0,.45); backdrop-filter:blur(20px); padding: 16px 18px; border-bottom: 1px solid var(--border); max-height: 60vh; overflow-y: auto; flex-shrink:0; }
    .setting-row { margin-bottom: 16px; display:flex; flex-direction:column; gap:10px; }
    .setting-label { color:rgba(255,255,255,.65); font-size:12px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; display: flex; align-items: center; gap: 8px; }
    .theme-grid { display:flex; gap:8px; flex-wrap:wrap; }
    .theme-card { padding: 8px 12px; border-radius:10px; border:1px solid var(--border); background:rgba(255,255,255,.05); color:rgba(255,255,255,.8); cursor:pointer; font-size:12px; font-weight: 500; display:flex; align-items:center; gap:8px; transition: all .15s; flex: 1; min-width: 100px; }
    .theme-card:hover { background:rgba(255,255,255,.1); border-color: rgba(255,255,255,.2); transform: translateY(-1px); }
    .theme-card.selected { border-color: var(--primary); background: rgba(255,255,255,.1); color: #fff; }
    .model-select-container { padding: 10px 14px; border-radius:10px; border:1px solid var(--border); background:rgba(255,255,255,.05); color:#fff; font-size:13px; }
    .model-select { width: 100%; background: transparent; border: none; color: #fff; font-size: 13px; outline: none; cursor: pointer; padding: 4px 0; }
    .model-select option, .model-select optgroup { background: #0a0a0a; color:#fff; }
    .slider-container { display: flex; align-items: center; gap: 12px; }
    .slider { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.1); outline: none; -webkit-appearance: none; }
    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--primary); cursor: pointer; }
    .custom-input { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,.05); color: #fff; font-size: 13px; outline: none; }
    .custom-input::placeholder { color: rgba(255,255,255,.35); }
    .color-picker { width: 36px; height: 32px; border: none; border-radius: 8px; cursor: pointer; background: transparent; }
    .material-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; background-repeat: repeat; background-size: 180px 180px; mix-blend-mode: overlay; }
    .search-bar { display:flex; align-items:center; gap:10px; margin: 10px 16px; padding: 10px 14px; border-radius:12px; background:rgba(255,255,255,.05); border:1px solid var(--border); flex-shrink: 0; }
    .search-bar input { flex:1; background:none; border:none; outline:none; color:#fff; font-size:14px; caret-color:var(--primary); }
    .search-bar input::placeholder { color: rgba(255,255,255,.4); }
    .search-bar button { background:none; border:none; color:rgba(255,255,255,.4); cursor:pointer; font-size:14px; padding:4px 8px; border-radius: 6px; transition: all .15s; display: flex; align-items: center; justify-content: center; }
    .search-bar button:hover { background: rgba(255,255,255,.1); color: #fff; }
    .scroll-wrapper { flex:1; overflow-y:auto; scroll-behavior:smooth; padding:16px; display:flex; flex-direction:column; gap:14px; min-height:0; }
    .scroll-wrapper::-webkit-scrollbar { width:5px; }
    .scroll-wrapper::-webkit-scrollbar-track { background:transparent; }
    .scroll-wrapper::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
    .msg-row { display:flex; gap:10px; max-width:92%; animation: msgIn .25s ease; }
    .msg-row.user { align-self: flex-end; flex-direction: row-reverse; }
    .msg-row.assistant { align-self: flex-start; }
    @keyframes msgIn { from { opacity:0; transform:translateY(10px);} to { opacity:1; transform:translateY(0);} }
    .avatar { width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight: 700; flex-shrink:0; background:rgba(255,255,255,.06); border: 1px solid var(--border); color: rgba(255,255,255,.5); }
    .msg-row.user .avatar { color: var(--primary); }
    .msg-row.assistant .avatar { color: var(--primary); }
    .bubble { padding: 12px 16px; border-radius: 14px; font-size: 15px; line-height: 1.55; word-break: break-word; position: relative; max-width: 100%; }
    .msg-row.user .bubble { background: var(--user-bubble, rgba(139, 92, 246, 0.15)); color:#f1f5f9; border-bottom-right-radius:4px; }
    .msg-row.assistant .bubble { background: var(--ai-bubble, rgba(139, 92, 246, 0.08)); color:rgba(255,255,255,.9); border:1px solid var(--border); border-bottom-left-radius:4px; }
    .msg-actions { display:flex; gap:6px; margin-top:6px; justify-content:flex-end; opacity:0; transition:opacity .2s; }
    .msg-row:hover .msg-actions { opacity:1; }
    .msg-action-btn { padding:4px 8px; border-radius:6px; border:1px solid var(--border); background:rgba(255,255,255,.05); color:rgba(255,255,255,.5); font-size:11px; cursor:pointer; transition: all .15s; display: flex; align-items: center; gap: 4px; }
    .msg-action-btn:hover { background:rgba(255,255,255,.1); color:#fff; }
    .msg-meta { font-size:10px; color:rgba(255,255,255,.35); margin-top:4px; text-align: right; }
    .error-banner { display:flex; gap:10px; align-items:center; padding: 10px 14px; margin:8px 16px; border-radius:12px; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); font-size:12px; color:#fca5a5; flex-shrink:0; }
    .error-banner svg { flex-shrink: 0; }
    .empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; padding:40px 24px; text-align: center; }
    .logo-big { width:64px; height:64px; border-radius:16px; background: rgba(255,255,255,.05); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:700; color:var(--primary); margin-bottom:8px; }
    .empty-title { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 6px; }
    .empty-subtitle { color:rgba(255,255,255,.45); font-size:13px; max-width:380px; line-height: 1.55; }
    .suggestions { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-top:16px; max-width: 560px; }
    .suggestion-btn { padding:12px 16px; border-radius:12px; border:1px solid var(--border); background:rgba(255,255,255,.05); color:rgba(255,255,255,.8); cursor:pointer; font-size:13px; display:flex; align-items:center; gap:10px; transition: all .15s; text-align: left; flex: 1; min-width: 200px; }
    .suggestion-btn:hover { background:rgba(255,255,255,.1); border-color: rgba(255,255,255,.2); transform: translateY(-1px); }
    .suggestion-category { font-size: 10px; color: rgba(255,255,255,.4); margin-top: 4px; text-transform: uppercase; letter-spacing: .5px; }
    @keyframes blink { 0%,100%{opacity:1;} 50%{opacity:.3;} }
    .typing-indicator { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--primary); margin-left: 4px; animation: blink 1s infinite; }
    .attachment-grid { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
    .attachment-thumb { width:64px; height:64px; border-radius:8px; overflow:hidden; border:1px solid var(--border); position:relative; }
    .attachment-thumb img { width:100%; height:100%; object-fit:cover; }
    .attachment-remove { position:absolute; top:2px; right:2px; width:18px; height:18px; border-radius:50%; border:none; background:rgba(0,0,0,.7); color:#fff; cursor:pointer; font-size:11px; display:flex; align-items:center; justify-content:center; }
    .camera-overlay { position:fixed; inset:0; z-index:1000; background:rgba(0,0,0,.95); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; }
    .camera-video { max-width:90vw; max-height:70vh; border-radius:16px; border:2px solid var(--border); }
    .camera-controls { display:flex; gap:20px; }
    .camera-btn { padding:12px 28px; border-radius:30px; border:none; font-weight:600; font-size:14px; cursor:pointer; }
    .camera-btn.primary { background:var(--primary); color:#000; }
    .camera-btn.secondary { background:rgba(255,255,255,.1); color:#fff; border:1px solid var(--border); }
    .keyboard-hint { position:fixed; bottom:10px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,.6); color:rgba(255,255,255,.4); padding:6px 14px; border-radius:20px; font-size:11px; z-index:5; }
    .no-anim .msg-row, .no-anim .typing-indicator { animation:none; }
    @media (max-width: 800px) {
      .chat-sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 100; transform: translateX(-100%); transition: transform .3s; width: 280px; }
      .chat-sidebar.collapsed { transform: translateX(-100%); }
      .chat-sidebar.open { transform: translateX(0); }
      .glass-main { width: 100vw; height: 100vh; border-radius: 0; }
      .close-sidebar-btn { display: none; }
    }
    @media (max-width: 640px) {
      .scroll-wrapper { padding: 12px; gap: 10px; }
      .bubble { font-size: 14px; padding: 10px 14px; }
      .msg-row { max-width: 94%; }
      .main-title { font-size: 14px; }
      .keyboard-hint { display:none; }
    }
  `}</style>
);

const DockPanel = ({ dock }) => (
  <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,.25)", flexShrink: 0 }}>
    <div style={{ fontSize: 10, color: "rgba(255,255,255,.45)", marginBottom: 6, display: "flex", justifyContent: "space-between", textTransform: "uppercase", letterSpacing: ".5px" }}>
      <span>Active Requests</span>
      <span>{dock?.active || 0}</span>
    </div>
    {(dock?.requests || []).slice(0, 3).map(r => (
      <div key={r.id || Math.random()} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, marginBottom: 4, color: "rgba(255,255,255,.7)" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: r.status === 'completed' ? '#22c55e' : r.status === 'error' ? '#ef4444' : 'var(--primary)' }} />
        <span style={{ flex: 1 }}>{getModelDisplayName(r.model)}</span>
        <span style={{ color: "rgba(255,255,255,.4)" }}>{Math.min(100, Math.round(r.progress || 0))}%</span>
      </div>
    ))}
  </div>
);

const InputBar = ({ text, setText, onSend, disabled, status, stats, attachments, setAttachments, onFileSelect, onPasteImage, onStartCamera, isListening, toggleListening }) => {
  const fileInputRef = useRef(null);

  const handleSubmit = () => {
    if ((!text.trim() && attachments.length === 0) || disabled) return;
    onSend(text);
  };

  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", flexShrink: 0, background: "rgba(0,0,0,.25)" }} onPaste={onPasteImage}>
      {attachments.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {attachments.map((file, idx) => (
            <div key={idx} style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", position: "relative" }}>
              <img src={URL.createObjectURL(file)} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
              <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="attachment-remove">×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={onFileSelect} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={disabled} className="icon-btn" title="Attach image">
          <Icon name="plus" size={18} />
        </button>
        <button onClick={onStartCamera} disabled={disabled} className="icon-btn" title="Camera">
          <Icon name="camera" size={18} />
        </button>
        <button onClick={toggleListening} disabled={disabled} className={`icon-btn ${isListening ? "active" : ""}`} title={isListening ? "Stop voice" : "Voice input"}>
          <Icon name={isListening ? "mic-off" : "mic"} size={18} />
        </button>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder={status === "loading" ? "AI is thinking..." : "Message..."}
          disabled={disabled}
          style={{ flex: 1, padding: "11px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "rgba(255,255,255,.06)", color: "#fff", fontSize: 15, outline: "none", caretColor: "var(--primary)", minWidth: 0 }}
        />
        <button
          onClick={handleSubmit}
          disabled={(!text.trim() && attachments.length === 0) || disabled}
          style={{ padding: "0 18px", height: 42, borderRadius: 12, border: "none", cursor: (text.trim() || attachments.length > 0) && !disabled ? "pointer" : "not-allowed", background: (text.trim() || attachments.length > 0) && !disabled ? "var(--primary)" : "rgba(255,255,255,.08)", color: (text.trim() || attachments.length > 0) && !disabled ? "#000" : "rgba(255,255,255,.3)", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {status === "loading" ? <span style={{ width: 16, height: 16, border: "2px solid rgba(0,0,0,.3)", borderTopColor: "#000", borderRadius: "50%", animation: "spin 1s linear infinite" }} /> : <Icon name="send" size={18} />}
        </button>
      </div>
      {stats && <div style={{ fontSize: 10, color: "rgba(255,255,255,.35)", marginTop: 6, display: "flex", gap: 12, justifyContent: "center" }}>
        <span>{stats.duration > 1000 ? `${(stats.duration / 1000).toFixed(1)}s` : `${stats.duration}ms`}</span>
        <span>{getModelDisplayName(stats.model)}</span>
      </div>}
    </div>
  );
};

const MessageActions = ({ content, onSpeak }) => (
  <div className="msg-actions">
    <button onClick={() => navigator.clipboard.writeText(content)} className="msg-action-btn" title="Copy">
      <Icon name="copy" size={12} /> Copy
    </button>
    <button onClick={() => onSpeak(content)} className="msg-action-btn" title="Read aloud">
      <Icon name="speaker" size={12} /> Read
    </button>
  </div>
);

const ChatSidebar = ({ chats, activeChatId, onSelect, onCreate, onDelete, onRename, sidebarOpen, setSidebarOpen, collapsed }) => {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");

  const startEdit = (chat, e) => {
    e.stopPropagation();
    setEditingId(chat.id);
    setEditTitle(chat.title);
  };

  const saveEdit = () => {
    if (editingId && editTitle.trim()) onRename(editingId, editTitle.trim());
    setEditingId(null);
  };

  const formatDate = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  if (collapsed) return null;

  return (
    <>
      <div className={`chat-sidebar ${sidebarOpen ? "open" : ""}`} onClick={e => e.stopPropagation()}>
        <div className="sidebar-header">
          <button onClick={() => { onCreate(); setSidebarOpen(false); }} className="sidebar-btn">
            <Icon name="plus" size={16} /> New Chat
          </button>
          <button onClick={() => setSidebarOpen(false)} className="close-sidebar-btn">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sidebar-list">
          {chats.map(chat => (
            <div key={chat.id} onClick={() => { onSelect(chat.id); setSidebarOpen(false); }} className={`sidebar-item ${activeChatId === chat.id ? "active" : ""}`}>
              <div className="sidebar-icon">{chat.messages.length > 0 ? chat.messages[0].content.slice(0, 1).toUpperCase() : "N"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingId === chat.id ? (
                  <input
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                    onBlur={saveEdit}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                    style={{ width: "100%", background: "rgba(255,255,255,.1)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "#fff", fontSize: 13, outline: "none" }}
                  />
                ) : (
                  <div className="sidebar-title">{chat.title}</div>
                )}
                <div className="sidebar-meta">{chat.messages.length} messages • {formatDate(chat.updatedAt || chat.createdAt)}</div>
              </div>
              <div className="sidebar-actions">
                <button onClick={e => startEdit(chat, e)} className="sidebar-action" title="Rename">
                  <Icon name="edit" size={14} />
                </button>
                <button onClick={e => { e.stopPropagation(); onDelete(chat.id); }} className="sidebar-action delete" title="Delete">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 90 }} />}
    </>
  );
};

const App = () => {
  const [themeKey, setThemeKey] = useState(() => { const savedTheme = Storage.get("pa-theme"); return savedTheme && THEMES[savedTheme] ? savedTheme : "midnight"; });
  const [customBg, setCustomBg] = useState(() => Storage.get("pa-custom-bg") || "");
  const [customPrimary, setCustomPrimary] = useState(() => Storage.get("pa-custom-primary") || "");
  const [accentColor, setAccentColor] = useState(() => Storage.get("pa-accent-color") || "");
  const [bgOpacity, setBgOpacity] = useState(() => { const v = Storage.get("pa-bg-opacity"); return v !== null ? parseFloat(v) : 0.4; });
  const [glassOpacity, setGlassOpacity] = useState(() => { const v = Storage.get("pa-glass-opacity"); return v !== null ? parseFloat(v) : 0.92; });
  const [materialOverlay, setMaterialOverlay] = useState(() => Storage.get("pa-material-overlay") || "");
  const [overlayStrength, setOverlayStrength] = useState(() => { const v = Storage.get("pa-overlay-strength"); return v !== null ? parseFloat(v) : 0.55; });
  const [fontSize, setFontSize] = useState(() => { const v = Storage.get("pa-font-size"); return v !== null ? parseFloat(v) : 15; });
  const [compactMode, setCompactMode] = useState(() => Storage.get("pa-compact") === "true");
  const [animations, setAnimations] = useState(() => Storage.get("pa-animations") !== "false");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Storage.get("pa-sidebar-collapsed") === "true");
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState(null);

  const { chats, activeChatId, setActiveChatId, createChat, deleteChat, renameChat, updateChatMessages, exportChat, exportAllChats } = useChatManager();
  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);
  const activeMessages = activeChat?.messages || [];

  const { streamText, status, stats, model, setModel, temperature, setTemperature, sendMessage } = useChatSession(activeChatId, activeMessages, updateChatMessages);

  const [attachments, setAttachments] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const [showCamera, setShowCamera] = useState(false);
  const cameraStreamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const listeningTimeoutRef = useRef(null);

  const [ttsEnabled, setTtsEnabled] = useState(() => Storage.get("pa-tts") === "true");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const lastSpokenRef = useRef("");
  const chatRef = useRef(null);

  const dock = useDockStatus();
  const health = useHealthCheck();
  const T = THEMES[themeKey] || DEFAULT_THEME;

  const primaryColor = customPrimary || T.primary;
  const borderColor = accentColor || T.borderColor;

  useEffect(() => { Storage.set("pa-theme", themeKey); }, [themeKey]);
  useEffect(() => { Storage.set("pa-custom-bg", customBg); }, [customBg]);
  useEffect(() => { Storage.set("pa-custom-primary", customPrimary); }, [customPrimary]);
  useEffect(() => { Storage.set("pa-accent-color", accentColor); }, [accentColor]);
  useEffect(() => { Storage.set("pa-bg-opacity", bgOpacity.toString()); }, [bgOpacity]);
  useEffect(() => { Storage.set("pa-glass-opacity", glassOpacity.toString()); }, [glassOpacity]);
  useEffect(() => { Storage.set("pa-material-overlay", materialOverlay); }, [materialOverlay]);
  useEffect(() => { Storage.set("pa-overlay-strength", overlayStrength.toString()); }, [overlayStrength]);
  useEffect(() => { Storage.set("pa-font-size", fontSize.toString()); }, [fontSize]);
  useEffect(() => { Storage.set("pa-compact", compactMode.toString()); }, [compactMode]);
  useEffect(() => { Storage.set("pa-animations", animations.toString()); }, [animations]);
  useEffect(() => { Storage.set("pa-sidebar-collapsed", sidebarCollapsed.toString()); }, [sidebarCollapsed]);
  useEffect(() => { Storage.set("pa-tts", ttsEnabled.toString()); }, [ttsEnabled]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [activeMessages, streamText]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!ttsEnabled || !window.speechSynthesis || status !== "idle") return;
    const last = activeMessages[activeMessages.length - 1];
    if (last && last.role === "assistant" && last.id !== lastSpokenRef.current) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(last.content.replace(/^⚠️ /, ""));
      u.onstart = () => setIsSpeaking(true);
      u.onend = () => setIsSpeaking(false);
      u.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(u);
      lastSpokenRef.current = last.id;
    }
  }, [activeMessages, status, ttsEnabled]);

  const exportChatRef = useRef(exportChat);
  useEffect(() => { exportChatRef.current = exportChat; }, [exportChat]);

  useEffect(() => {
    const handler = (e) => { 
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setSearchQuery(q => q ? "" : "focus"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "j") { e.preventDefault(); if (activeChatId) exportChatRef.current(activeChatId); setToast("Chat exported"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") { e.preventDefault(); createChat(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "b") { e.preventDefault(); setSidebarCollapsed(c => !c); setSidebarOpen(false); }
      if (e.key === "Escape") { setShowSettings(false); setSidebarOpen(false); setSearchQuery(""); stopCamera(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeChatId, createChat]);

  const speakText = (text) => {
    if (!window.speechSynthesis) { setToast("Speech not supported"); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/^⚠️ /, ""));
    u.onstart = () => setIsSpeaking(true);
    u.onend = () => setIsSpeaking(false);
    u.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  const filteredMessages = useMemo(() => searchQuery.trim() ? activeMessages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase())) : activeMessages, [activeMessages, searchQuery]);

  const handleSend = useCallback((text) => {
    if (health?.status === 'error' || health?.status === 'degraded') { setToast(`Service ${health.status}: ${health.error || 'Check connection'}`); return; }
    if (!VISION_MODELS.includes(model) && attachments.length > 0) {
      setToast(`${getModelDisplayName(model)} cannot see images. Switch to a vision model.`);
      return;
    }
    sendMessage(text, attachments);
    setAttachments([]);
    setInputText("");
  }, [sendMessage, health, attachments, model]);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));
    if (files.length === 0) { setToast("Only image files are supported"); return; }
    setAttachments(prev => [...prev, ...files]);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    setAttachments(prev => [...prev, ...files]);
  };

  const pasteImage = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) setAttachments(prev => [...prev, file]);
      }
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      setShowCamera(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 100);
    } catch { setToast("Camera access denied or unavailable"); }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current, canvas = canvasRef.current;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      setAttachments(prev => [...prev, new File([blob], `camera-${Date.now()}.png`, { type: "image/png" })]);
      stopCamera();
    }, "image/png");
  };

  const stopListening = useCallback(() => {
    if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!window.navigator || !window.navigator.mediaDevices) {
      setToast("Microphone not available in this browser");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setToast("Voice input needs Chrome, Edge, or Safari");
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        listeningTimeoutRef.current = setTimeout(() => {
          try { recognition.stop(); } catch {}
        }, 10000);
      };

      recognition.onend = () => {
        setIsListening(false);
        if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
        recognitionRef.current = null;
      };

      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript.trim()) setInputText(prev => prev + transcript + " ");
      };

      recognition.onerror = (event) => {
        console.warn("Voice error:", event.error);
        if (event.error === "not-allowed") setToast("Microphone permission denied");
        else if (event.error === "no-speech") setToast("No speech detected — try again");
        else if (event.error === "network") {
          setToast("Voice network error. Retrying...");
          setTimeout(() => { if (isListening) startListening(); }, 500);
        }
        else if (event.error !== "aborted") setToast("Voice error: " + event.error);
        setIsListening(false);
        if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
        recognitionRef.current = null;
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      setToast("Could not start voice input");
      setIsListening(false);
    }
  }, [isListening]);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, stopListening, startListening]);

  const handlePerchance = () => setInputText(PERCHANCE_PROMPTS[Math.floor(Math.random() * PERCHANCE_PROMPTS.length)]);

  const handleCreateChat = () => {
    createChat();
    setInputText("");
    setAttachments([]);
  };

  const toggleSidebar = () => {
    if (window.innerWidth <= 800) {
      setSidebarOpen(o => !o);
      setSidebarCollapsed(false);
    } else {
      setSidebarCollapsed(c => !c);
      setSidebarOpen(false);
    }
  };

  const instanceVars = { 
    "--primary": primaryColor, 
    "--border": borderColor, 
    "--user-bubble": T.userBubble, 
    "--ai-bubble": T.aiBubble, 
    "--font-size": `${fontSize}px`
  };

  const appBgStyle = customBg
    ? { backgroundImage: `url(${customBg})`, backgroundColor: "#000" }
    : { backgroundImage: T.bg };

  const glassBg = `rgba(${extractRgb(T.cardBg)}, ${glassOpacity})`;

  const overlayStyle = customBg
    ? { backgroundColor: `rgba(0,0,0,${1 - bgOpacity})` }
    : {};

  const themeCardSelected = (k) => themeKey === k && !customBg && !customPrimary && !accentColor;

  return (
    <div className={`app-root ${customBg ? "custom-bg" : ""} ${animations ? "" : "no-anim"}`} style={{ "--bg": customBg ? "none" : T.bg, ...instanceVars, ...appBgStyle }} onDrop={handleDrop} onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)}>
      <GlobalStyles />
      {customBg && <div style={{ position: "absolute", inset: 0, zIndex: 1, ...overlayStyle, pointerEvents: "none" }} />}
      {customBg && materialOverlay && <div className="material-overlay" style={{ backgroundImage: `url(${materialOverlay})`, opacity: overlayStrength }} />}
      {toast && <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,.9)", color: "#fff", padding: "12px 20px", borderRadius: 12, zIndex: 9999, fontSize: 13, borderLeft: "3px solid var(--primary)", boxShadow: "0 10px 30px rgba(0,0,0,.5)" }}>{toast}</div>}
      {showCamera && (
        <div className="camera-overlay">
          <video ref={videoRef} autoPlay className="camera-video" />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <div className="camera-controls">
            <button onClick={capturePhoto} className="camera-btn primary">Capture</button>
            <button onClick={stopCamera} className="camera-btn secondary">Cancel</button>
          </div>
        </div>
      )}
      <div className="glass-main" style={{ background: glassBg, fontSize: `${fontSize}px` }}>
        <ChatSidebar
          chats={chats}
          activeChatId={activeChatId}
          onSelect={setActiveChatId}
          onCreate={handleCreateChat}
          onDelete={deleteChat}
          onRename={renameChat}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          collapsed={sidebarCollapsed}
        />
        <div className="chat-main">
          <header className="app-header">
            <button className="menu-btn" onClick={toggleSidebar} title="Toggle chats (Ctrl+B)">
              <Icon name="menu" size={18} />
            </button>
            <div className="logo-box" onClick={() => setShowSettings(s => !s)} title="Settings">AI</div>
            <div className="title-group">
              <h1 className="main-title">{activeChat?.title || "Cloud AI Assistant"}</h1>
              <span className="sub-title">{T.name} • {getModelDisplayName(model)}{isSpeaking ? " • SPEAKING" : ""}{isListening ? " • LISTENING" : ""}</span>
            </div>
            <div className="header-actions">
              {showSettings && <div style={{ display: "flex", gap: 8, padding: 10, background: "rgba(0,0,0,.85)", borderRadius: 14, position: "absolute", top: 75, right: 20, zIndex: 20, alignItems: "center", boxShadow: "0 10px 30px rgba(0,0,0,.5)", border: "1px solid var(--border)" }}>
                {Object.keys(THEMES).map(k => <button key={k} onClick={() => setThemeKey(k)} className={`dot ${themeKey === k ? "active" : ""}`} style={{ background: THEMES[k]?.primary || DEFAULT_THEME.primary }} title={THEMES[k]?.name} />)}
              </div>}
              <button className={`icon-btn ${ttsEnabled ? "active" : ""}`} onClick={() => { if (isSpeaking) window.speechSynthesis.cancel(); setTtsEnabled(v => !v); }} title="Toggle AI voice">
                <Icon name={ttsEnabled ? "volume" : "volumeX"} size={18} />
              </button>
              <button className="icon-btn" onClick={handlePerchance} title="Random prompt">
                <Icon name="dice" size={18} />
              </button>
              <button className="icon-btn" onClick={() => { if (activeChatId) exportChat(activeChatId); setToast("Chat exported"); }} title="Export chat (Ctrl+J)">
                <Icon name="export" size={18} />
              </button>
              <button className="icon-btn" onClick={() => setToast("Premium features unlocked")} title="Premium">
                <Icon name="crown" size={18} />
              </button>
              <button className={`icon-btn ${showSettings ? "active" : ""}`} onClick={() => setShowSettings(s => !s)} title="Settings">
                <Icon name="settings" size={18} />
              </button>
            </div>
          </header>
          <main className="app-content">
            {showSettings && <div className="settings-drawer">
              <div className="setting-row">
                <div className="setting-label">Theme</div>
                <div className="theme-grid">
                  {Object.entries(THEMES).map(([k, v]) => <button key={k} onClick={() => { setThemeKey(k); setCustomBg(""); setCustomPrimary(""); setAccentColor(""); }} className={`theme-card ${themeCardSelected(k) ? "selected" : ""}`}>{v.name}</button>)}
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
                  <button onClick={() => { setCustomBg(""); setCustomPrimary(""); setAccentColor(""); setMaterialOverlay(""); }} className="theme-card">Reset</button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">Texture Overlay</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => setMaterialOverlay("")} className={`theme-card ${materialOverlay === "" ? "selected" : ""}`}>None</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.wood)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.wood ? "selected" : ""}`}>Wood</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.metal)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.metal ? "selected" : ""}`}>Metal</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.paper)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.paper ? "selected" : ""}`}>Paper</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.fabric)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.fabric ? "selected" : ""}`}>Fabric</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.concrete)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.concrete ? "selected" : ""}`}>Concrete</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.leather)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.leather ? "selected" : ""}`}>Leather</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.brick)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.brick ? "selected" : ""}`}>Brick</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.canvas)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.canvas ? "selected" : ""}`}>Canvas</button>
                  <button onClick={() => setMaterialOverlay(MATERIAL_OVERLAYS.noise)} className={`theme-card ${materialOverlay === MATERIAL_OVERLAYS.noise ? "selected" : ""}`}>Noise</button>
                </div>
                <div className="setting-label">Overlay Strength: {Math.round(overlayStrength * 100)}%</div>
                <div className="slider-container">
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Subtle</span>
                  <input type="range" min="0.05" max="1" step="0.05" value={overlayStrength} onChange={(e) => setOverlayStrength(parseFloat(e.target.value))} className="slider" />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Strong</span>
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
              <Icon name="search" size={16} />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search conversation... (Ctrl+K)" />
              <button onClick={() => setSearchQuery("")}>
                <Icon name="close" size={16} />
              </button>
            </div>}
            <div className="scroll-wrapper" ref={chatRef} style={{ fontSize: `${fontSize}px` }}>
              {(health?.status === 'error' || health?.status === 'degraded') && <div className="error-banner">
                <Icon name="volumeX" size={16} color="#fca5a5" />
                <div><strong style={{ fontSize: 12, textTransform: "uppercase" }}>Service {health?.status}</strong><p style={{ margin: 0, fontSize: 11, marginTop: 3, color: "rgba(255,255,255,.6)" }}>{health?.error || 'Connecting...'}</p></div>
              </div>}
              {activeMessages.length === 0 && !streamText && <div className="empty-state">
                <div className="logo-big">AI</div>
                <div>
                  <h2 className="empty-title">Cloud AI Assistant</h2>
                  <p className="empty-subtitle">Upload images, paste screenshots, use your voice, or type a message. Manage multiple chats from the sidebar.</p>
                </div>
                <div className="suggestions">
                  {SUGGESTIONS.map((s, i) => <button key={i} onClick={() => setInputText(s.text)} className="suggestion-btn">
                    <span style={{ color: "var(--primary)", fontSize: "8px" }}>●</span>
                    <div><div>{s.text}</div><div className="suggestion-category">{s.category}</div></div>
                  </button>)}
                </div>
              </div>}
              {filteredMessages.map((msg, idx) => <div key={msg.id || idx} className={`msg-row ${msg.role}`}>
                <div className="avatar">{msg.role === "user" ? "YOU" : "AI"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="bubble" style={{ padding: compactMode ? "8px 12px" : "12px 16px" }}>{formatMessage(msg.content)}</div>
                  {msg.attachments?.length > 0 && <div className="attachment-grid">
                    {msg.attachments.map((a, i) => <div key={i} className="attachment-thumb"><img src={a.url} alt={a.name} /></div>)}
                  </div>}
                  {msg.role === "assistant" && <MessageActions content={msg.content} onSpeak={speakText} />}
                  <div className="msg-meta">{msg.ts}</div>
                </div>
              </div>)}
              {status === "streaming" && streamText && <div className="msg-row assistant">
                <div className="avatar">AI</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="bubble" style={{ padding: compactMode ? "8px 12px" : "12px 16px" }}>{formatMessage(streamText)}<span className="typing-indicator" /></div>
                  <div className="msg-meta">typing...</div>
                </div>
              </div>}
              {status === "loading" && <div className="msg-row assistant">
                <div className="avatar">AI</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="bubble" style={{ fontStyle: "italic", opacity: .7, display: "flex", alignItems: "center", gap: 8, padding: compactMode ? "8px 12px" : "12px 16px" }}>
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--primary)" }} />
                    <span>Processing with {getModelDisplayName(model)}...</span>
                  </div>
                  <div className="msg-meta">thinking</div>
                </div>
              </div>}
            </div>
            <InputBar
              text={inputText}
              setText={setInputText}
              onSend={handleSend}
              disabled={status !== "idle"}
              status={status}
              stats={stats}
              attachments={attachments}
              setAttachments={setAttachments}
              onFileSelect={handleFileSelect}
              onPasteImage={pasteImage}
              onStartCamera={startCamera}
              isListening={isListening}
              toggleListening={toggleListening}
            />
            <DockPanel dock={dock} />
          </main>
        </div>
      </div>
      <div className="keyboard-hint">Ctrl+N new • Ctrl+B sidebar • Ctrl+K search • Ctrl+J export</div>
    </div>
  );
};

export default App;
