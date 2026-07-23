import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ClerkProvider, SignIn, useUser, useAuth, SignOutButton } from "@clerk/react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

const MODELS = {
  fast: [
    { key: "gemma4", name: "Gemma 4" },
    { key: "qwen3.5", name: "Qwen 3.5" },
    { key: "glm-5.2", name: "GLM 5.2" },
    { key: "minimax-m2.5", name: "MiniMax M2.5" },
    { key: "kimi-k2.5", name: "Kimi K2.5" },
  ],
  reasoning: [
    { key: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { key: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { key: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { key: "kimi-k2.6", name: "Kimi K2.6" },
    { key: "glm-5.1", name: "GLM 5.1" },
    { key: "minimax-m3", name: "MiniMax M3" },
    { key: "minimax-m2.7", name: "MiniMax M2.7" },
    { key: "nemotron-3-super", name: "Nemotron 3 Super" },
    { key: "nemotron-3-ultra", name: "Nemotron 3 Ultra" },
    { key: "gpt-oss", name: "GPT-OSS" },
    { key: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { key: "mistral-large-3", name: "Mistral Large 3" },
  ]
};

const VISION_MODELS = ["gemma4", "kimi-k2.6", "kimi-k2.5", "gemini-3-flash-preview", "minimax-m3"];

const BACKGROUND_PRESETS = {
  nebula: "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=1920&q=80",
  aurora: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80",
  citynight: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1920&q=80",
  synthwave: "https://images.unsplash.com/photo-1563089145-599997674d42?w=1920&q=80",
  galaxy: "https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3?w=1920&q=80",
  japan: "https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=1920&q=80",
  forest: "https://images.unsplash.com/photo-1511497584788-876760111969?w=1920&q=80",
  ocean: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=80",
};

const THEMES = {
  nebula: {
    primary: "#c084fc",
    bg: "radial-gradient(ellipse at 20% 20%, #2e1065 0%, #1a0b2e 40%, #0f0518 100%)",
    border: "rgba(192, 132, 252, 0.25)",
    glow: "#c084fc",
  },
  aurora: {
    primary: "#5eead4",
    bg: "radial-gradient(ellipse at 80% 20%, #0f766e 0%, #022c22 40%, #020617 100%)",
    border: "rgba(94, 234, 212, 0.25)",
    glow: "#5eead4",
  },
  cyberpunk: {
    primary: "#f472b6",
    bg: "radial-gradient(ellipse at 50% 0%, #4c1d95 0%, #2e1065 30%, #0f0518 100%)",
    border: "rgba(244, 114, 182, 0.3)",
    glow: "#f472b6",
  },
  synthwave: {
    primary: "#fb7185",
    bg: "linear-gradient(180deg, #2a0a1a 0%, #4c1d4a 40%, #0f0518 100%)",
    border: "rgba(251, 113, 133, 0.25)",
    glow: "#fb7185",
  },
  galaxy: {
    primary: "#67e8f9",
    bg: "radial-gradient(circle at 50% 50%, #0c4a6e 0%, #082f49 30%, #020617 100%)",
    border: "rgba(103, 232, 249, 0.2)",
    glow: "#67e8f9",
  },
  volcanic: {
    primary: "#f97316",
    bg: "radial-gradient(ellipse at 50% 100%, #7c2d12 0%, #431407 40%, #0c0a09 100%)",
    border: "rgba(249, 115, 22, 0.25)",
    glow: "#f97316",
  },
  midnight: {
    primary: "#818cf8",
    bg: "linear-gradient(135deg, #020617 0%, #1e1b4b 50%, #0f172a 100%)",
    border: "rgba(129, 140, 248, 0.2)",
    glow: "#818cf8",
  },
  ocean: {
    primary: "#38bdf8",
    bg: "radial-gradient(circle at 70% 30%, #0a1f3d 0%, #051020 50%, #02050c 100%)",
    border: "rgba(56, 189, 248, 0.2)",
    glow: "#38bdf8",
  },
  emerald: {
    primary: "#34d399",
    bg: "radial-gradient(circle at 20% 80%, #0a2a1f 0%, #05120d 50%, #020604 100%)",
    border: "rgba(52, 211, 153, 0.2)",
    glow: "#34d399",
  },
  crimson: {
    primary: "#fb7185",
    bg: "radial-gradient(circle at 80% 20%, #2a0a12 0%, #120408 50%, #050203 100%)",
    border: "rgba(251, 113, 133, 0.2)",
    glow: "#fb7185",
  },
  gold: {
    primary: "#fbbf24",
    bg: "radial-gradient(circle at 50% 50%, #1f1508 0%, #0f0b05 50%, #050402 100%)",
    border: "rgba(251, 191, 36, 0.2)",
    glow: "#fbbf24",
  },
  matrix: {
    primary: "#4ade80",
    bg: "radial-gradient(circle at 50% 100%, #052e16 0%, #020617 100%)",
    border: "rgba(74, 222, 128, 0.25)",
    glow: "#4ade80",
  },
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const getModelDisplayName = (key) => {
  const all = [...MODELS.fast, ...MODELS.reasoning];
  return all.find((m) => m.key === key)?.name || key;
};

const isImageRequest = (text) => /^\/image|generate image|create image|draw image|make image/i.test(text);

const parseImagePrompt = (text) => {
  const m = text.match(/(?:generate|create|draw|make)\s+(?:an?\s+)?image\s*(?:of\s+)?(.+)/i);
  return m ? m[1].trim() : text.replace(/^\/image\s*/, "").trim();
};

const buildImageUrl = (prompt) => {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
};

const generateChatTitle = (text) => {
  const cleaned = text
    .replace(/^\/image\s*/i, "")
    .replace(/^(generate|create|draw|make)\s+(an?\s+)?image\s*(of\s+)?/i, "")
    .trim();

  if (!cleaned) return "New Chat";

  const words = cleaned.split(/\s+/);
  const titleWords = words.slice(0, 6);
  let title = titleWords.join(" ");

  if (words.length > 6) {
    title += "...";
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
};

const Storage = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

const Icon = ({ name, size = 18 }) => {
  const icons = {
    menu: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12h18M3 6h18M3 18h18" />
      </svg>
    ),
    settings: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    brain: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
      </svg>
    ),
    crown: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm2.86-2h8.28l.5-3.37L13.5 14 12 11.5 10.5 14 7.36 10.63l.5 3.37zM5 18h14v2H5v-2z" />
      </svg>
    ),
    close: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    ),
    plus: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
    trash: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
    pin: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM5 19.5h6v-2H5v2z" />
      </svg>
    ),
    heart: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
    copy: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    ),
    refresh: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    ),
    send: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    ),
    image: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    ),
    mic: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    camera: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
    upgrade: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2l9 4v6c0 5.55-3.84 10.74-9 12-5.16-1.26-9-6.45-9-12V6l9-4z" />
        <path d="M9 12l3-3 3 3" />
        <path d="M12 9v8" />
      </svg>
    ),
  };
  return icons[name] || null;
};

const MessageActions = ({ content, onCopy }) => {
  return (
    <div className="msg-actions">
      <button className="msg-action-btn" onClick={onCopy}>
        <Icon name="copy" size={13} /> Copy
      </button>
    </div>
  );
};

const ChatItem = ({ chat, activeChatId, onSelect, onRename, onDelete, onPin, onFavorite }) => {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chat.title || "New Chat");

  const handleRename = () => {
    onRename(chat.id, editTitle);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleRename();
    if (e.key === "Escape") {
      setEditTitle(chat.title || "New Chat");
      setEditing(false);
    }
  };

  return (
    <div
      className={`chat-item ${chat.id === activeChatId ? "active" : ""} ${chat.pinned ? "pinned" : ""} ${chat.favorite ? "favorite" : ""}`}
      onClick={() => onSelect(chat.id)}
    >
      <div className="chat-title">
        {editing ? (
          <input
            className="custom-input"
            style={{ padding: "4px 8px", fontSize: 12 }}
            value={editTitle}
            autoFocus
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          chat.title || "New Chat"
        )}
      </div>
      <div className="chat-actions" onClick={(e) => e.stopPropagation()}>
        <button className="chat-action" onClick={() => onPin(chat.id)} title="Pin">
          <Icon name="pin" size={13} />
        </button>
        <button className="chat-action" onClick={() => onFavorite(chat.id)} title="Favorite">
          <Icon name="heart" size={13} />
        </button>
        <button
          className="chat-action"
          onClick={() => {
            setEditing(true);
            setEditTitle(chat.title || "New Chat");
          }}
          title="Rename"
        >
          ✎
        </button>
        <button className="chat-action" onClick={() => onDelete(chat.id)} title="Delete">
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
};

const ChatSidebar = ({
  chats,
  activeChatId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onPin,
  onFavorite,
  collapsed,
  mobileOpen,
  setMobileOpen,
}) => {
  return (
    <div
      className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobileOpen" : ""} ${
        typeof window !== "undefined" && window.innerWidth <= 768 ? "mobile" : ""
      }`}
    >
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={onCreate}>
          <Icon name="plus" size={16} /> New Chat
        </button>
        {mobileOpen && (
          <button className="icon-btn" onClick={() => setMobileOpen(false)}>
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      <div className="chat-list">
        {chats.length === 0 && (
          <div style={{ textAlign: "center", opacity: 0.5, padding: 20, fontSize: 13 }}>
            No chats yet
          </div>
        )}
        {chats.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            activeChatId={activeChatId}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
            onPin={onPin}
            onFavorite={onFavorite}
          />
        ))}
      </div>

      <div className="sidebar-footer">ALOP-AI • Council of Minds</div>
    </div>
  );
};

const InputBar = ({
  text,
  setText,
  onSend,
  disabled,
  attachments,
  setAttachments,
  onFileSelect,
  onStartCamera,
  isListening,
  toggleListening,
}) => {
  const [rows, setRows] = useState(1);

  useEffect(() => {
    const lines = text.split("\n").length;
    setRows(Math.min(Math.max(lines, 1), 6));
  }, [text]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled) onSend(text);
    }
  };

  const removeAttachment = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="input-bar">
      <div className="input-wrapper">
        {attachments.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {attachments.map((a, i) => (
              <div key={i} className="attachment-pill">
                {a.name}
                <button onClick={() => removeAttachment(i)}>×</button>
              </div>
            ))}
          </div>
        )}

        <textarea
          className="input-text"
          rows={rows}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the AI Council anything, upload a photo, take a picture, or use your voice..."
          disabled={disabled}
        />

        <div className="input-actions">
          <label className="input-btn" title="Upload image" style={{ cursor: "pointer" }}>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={onFileSelect}
              disabled={disabled}
              style={{ display: "none" }}
            />
            <Icon name="image" size={16} />
          </label>

          <button
            className={`input-btn ${isListening ? "listening" : ""}`}
            onClick={toggleListening}
            title="Voice input"
          >
            <Icon name="mic" size={16} />
          </button>

          <button
            className="input-btn"
            onClick={onStartCamera}
            title="Camera"
            disabled={disabled}
          >
            <Icon name="camera" size={16} />
          </button>

          <div style={{ flex: 1 }}></div>

          <button
            className="input-btn primary"
            onClick={() => onSend(text)}
            disabled={disabled || !text.trim()}
          >
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

const AuthenticatedApp = () => {
  const { user, isLoaded } = useUser();
  const { getToken, isSignedIn } = useAuth();

  const [themeKey, setThemeKey] = useState(() => Storage.get("pa-theme") || "nebula");
  const [customBg, setCustomBg] = useState(() => Storage.get("pa-custom-bg") || "");
  const [customPrimary, setCustomPrimary] = useState(() => Storage.get("pa-custom-primary") || "");
  const [bgOpacity, setBgOpacity] = useState(() => parseFloat(Storage.get("pa-bg-opacity") || "1"));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const v = Storage.get("pa-sidebar-collapsed");
    return v === null ? true : v === "true";
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userPlan, setUserPlan] = useState("free");
  const [toast, setToast] = useState(null);

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [status, setStatus] = useState("idle");

  const [attachments, setAttachments] = useState([]);
  const [inputText, setInputText] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const cameraStreamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const listenTimerRef = useRef(null);
  const chatRef = useRef(null);
  const abortRef = useRef(null);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const isDesktop = params.get('desktop') === 'true';

  if (isDesktop) {
    const focusInput = () => {
      const input = document.querySelector('.input-text');
      if (input) input.focus();
    };

    focusInput();

    const handleFocusEvent = () => {
      focusInput();
    };

    window.addEventListener('alop-focus', handleFocusEvent);

    return () => {
      window.removeEventListener('alop-focus', handleFocusEvent);
    };
  }
}, []);


  useEffect(() => Storage.set("pa-theme", themeKey), [themeKey]);
  useEffect(() => Storage.set("pa-custom-bg", customBg), [customBg]);
  useEffect(() => Storage.set("pa-custom-primary", customPrimary), [customPrimary]);
  useEffect(() => Storage.set("pa-bg-opacity", bgOpacity.toString()), [bgOpacity]);
  useEffect(() => Storage.set("pa-sidebar-collapsed", sidebarCollapsed.toString()), [sidebarCollapsed]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chats, activeChatId]);

  const api = async (path, options = {}) => {
    const token = await getToken();
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  };

  const fetchAdminUsers = async () => {
    try {
      const r = await api("/api/admin/users");
      const data = await r.json();
      setAdminUsers(data || []);
    } catch (err) {
      console.error("Failed to fetch admin users:", err.message);
    }
  };

  const loadChats = useCallback(async () => {
    try {
      const r = await api("/api/chats");
      const data = await r.json();
      if (Array.isArray(data)) {
        setChats(data);
      }
    } catch (err) {
      console.error("Failed to load chats:", err.message);
    }
  }, []);

  const fetchPlan = useCallback(async () => {
    try {
      const r = await api("/api/user/plan");
      const data = await r.json();
      setUserPlan(data.plan || "free");
    } catch (err) {
      console.error("Failed to fetch plan:", err.message);
    }
  }, []);

  const startFreshChat = useCallback(async () => {
    await loadChats();
    const fresh = await createChat();
    if (fresh) {
      setActiveChatId(fresh);
    }
  }, [loadChats]);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      fetchPlan();
      startFreshChat();
    }
  }, [isLoaded, isSignedIn, fetchPlan, startFreshChat]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!isSignedIn || !user?.emailAddresses?.[0]?.emailAddress) return;
      try {
        const r = await api("/api/admin/users");
        if (r.ok) {
          const users = await r.json();
          const me = users.find((u) => u.email === user.emailAddresses[0].emailAddress);
          if (me?.is_admin) setIsAdmin(true);
        }
      } catch (err) {
        console.error("Admin check failed:", err.message);
      }
    };
    if (isLoaded) checkAdmin();
  }, [isLoaded, user, isSignedIn]);

  useEffect(() => {
    if (isAdmin && showAdmin) fetchAdminUsers();
  }, [isAdmin, showAdmin]);

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId]);
  const activeMessages = activeChat?.messages || [];

  const createChat = async () => {
    try {
      const r = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ title: "New Chat" }),
      });
      const data = await r.json();
      setChats((prev) => [data, ...prev]);
      setActiveChatId(data.id);
      setInputText("");
      setAttachments([]);
      return data.id;
    } catch (err) {
      setToast("Failed to create chat");
      console.error("Create chat failed:", err.message);
      return null;
    }
  };

  const updateChatMessages = async (chatId, messages, saveToDb = true) => {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, messages, updated_at: new Date().toISOString() } : c))
    );
    if (saveToDb) {
      try {
        await api(`/api/chats/${chatId}`, { method: "PUT", body: JSON.stringify({ messages }) });
      } catch (err) {
        console.error("Failed to save messages:", err.message);
      }
    }
  };

  const deleteChat = async (id) => {
    try {
      await api(`/api/chats/${id}`, { method: "DELETE" });
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeChatId === id) setActiveChatId(null);
    } catch (err) {
      console.error("Delete chat failed:", err.message);
    }
  };

  const renameChat = async (id, title) => {
    if (!title || !title.trim()) return;
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    try {
      await api(`/api/chats/${id}`, { method: "PUT", body: JSON.stringify({ title }) });
    } catch (err) {
      console.error("Rename chat failed:", err.message);
    }
  };

  const togglePinChat = (id) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
  };

  const toggleFavoriteChat = (id) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)));
  };

  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
    });
  }, [chats]);

  const adminSuspend = async (id) => {
    try {
      if ((await api(`/api/admin/users/${id}/suspend`, { method: "POST" })).ok) {
        setToast("User suspended");
        fetchAdminUsers();
      }
    } catch (err) {
      console.error("Suspend failed:", err.message);
    }
  };

  const adminUnsuspend = async (id) => {
    try {
      if ((await api(`/api/admin/users/${id}/unsuspend`, { method: "POST" })).ok) {
        setToast("User unsuspended");
        fetchAdminUsers();
      }
    } catch (err) {
      console.error("Unsuspend failed:", err.message);
    }
  };

  const adminDeleteUser = async (id) => {
    if (!confirm("DELETE this user and all their data?")) return;
    try {
      if ((await api(`/api/admin/users/${id}`, { method: "DELETE" })).ok) {
        setToast("User deleted");
        fetchAdminUsers();
      }
    } catch (err) {
      console.error("Delete user failed:", err.message);
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files).filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      setToast("Only image files supported");
      return;
    }
    setAttachments((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = s;
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = s;
      }, 100);
    } catch {
      setToast("Camera access denied");
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob((b) => {
      setAttachments((prev) => [
        ...prev,
        new File([b], `camera-${Date.now()}.png`, { type: "image/png" }),
      ]);
      stopCamera();
    }, "image/png");
  };

  const stopListening = useCallback(() => {
    if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setToast("Voice input needs Chrome/Edge/Safari");
      return;
    }
    const r = new SpeechRecognition();
    r.continuous = false;
    r.interimResults = false;
    r.lang = "en-US";
    r.maxAlternatives = 1;

    r.onstart = () => {
      setIsListening(true);
      listenTimerRef.current = setTimeout(() => {
        try {
          r.stop();
        } catch {}
      }, 10000);
    };

    r.onend = () => {
      setIsListening(false);
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
      recognitionRef.current = null;
    };

    r.onresult = (e) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      if (t.trim()) setInputText((p) => p + t + " ");
    };

    r.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    r.start();
    recognitionRef.current = r;
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, stopListening, startListening]);

  const generateImage = useCallback(
    async (promptText) => {
      const imagePrompt = parseImagePrompt(promptText) || promptText;
      if (!imagePrompt) {
        setToast("Describe what image to generate");
        return;
      }

      let chatId = activeChatId;
      if (!chatId) {
        chatId = await createChat();
      }
      if (!chatId) return;

      const userMsg = {
        role: "user",
        content: `Generate image: ${imagePrompt}`,
        ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        id: uid(),
      };

      const withUser = [...(activeMessages || []), userMsg];
      await updateChatMessages(chatId, withUser);

      if ((activeMessages || []).length === 0) {
        const autoTitle = generateChatTitle(imagePrompt);
        if (autoTitle) {
          renameChat(chatId, autoTitle);
        }
      }

      await updateChatMessages(chatId, [
        ...withUser,
        {
          role: "assistant",
          content: "",
          imageUrl: buildImageUrl(imagePrompt),
          imagePrompt,
          ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          id: uid(),
        },
      ]);

      setInputText("");
      setAttachments([]);
    },
    [activeChatId, activeMessages]
  );

  const handleSend = useCallback(
    async (text) => {
      let chatId = activeChatId;
      if (!chatId) {
        chatId = await createChat();
      }
      if (!chatId) return;

      const cleanText = text.trim();
      if (isImageRequest(cleanText)) {
        generateImage(cleanText);
        return;
      }

      if (attachments.length > 0) {
        setToast("File upload temporarily disabled in Council mode");
        return;
      }

      if (!cleanText || status !== "idle") return;

      setStatus("loading");

      const userMsg = {
        role: "user",
        content: cleanText,
        ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        id: uid(),
      };

      const updated = [...activeMessages, userMsg];
      await updateChatMessages(chatId, updated);

      if (activeMessages.length === 0 && cleanText) {
        const autoTitle = generateChatTitle(cleanText);
        if (autoTitle) {
          renameChat(chatId, autoTitle);
        }
      }

      const assistantId = uid();
      const assistantMsg = {
        role: "assistant",
        content: "",
        typing: true,
        ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        id: assistantId,
      };

      updateChatMessages(chatId, [...updated, assistantMsg], false);

      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/council`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: cleanText,
            history: activeMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `Server error: ${res.status}`);
        }

        if (!res.body) throw new Error("Streaming not supported");

        setStatus("streaming");
        updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: "" }], false);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data: ")) continue;
            const j = t.slice(6).trim();
            if (j === "[DONE]") break;

            try {
              const d = JSON.parse(j);
              if (d.type === "chunk") acc += d.text;
              else if (d.type === "error") throw new Error(d.text);
            } catch {}
          }

          updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc }], false);
        }

        await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc }]);
        setStatus("idle");
      } catch (err) {
        if (err.name === "AbortError") return;
        setStatus("error");
        await updateChatMessages(chatId, [
          ...updated,
          { ...assistantMsg, typing: false, content: `⚠️ ${err.message || "Connection failed"}` },
        ]);
      }

      setInputText("");
    },
    [activeChatId, activeMessages, status, generateImage, attachments]
  );

  const upgrade = async (planType) => {
    try {
      const r = await api("/api/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: planType }),
      });
      const data = await r.json();
      if (data.url) window.location.href = data.url;
    } catch (err) {
      console.error("Checkout error:", err.message);
    }
  };

  const manageSubscription = async () => {
    try {
      const r = await api("/api/create-portal-session", { method: "POST" });
      const data = await r.json();
      if (data.url) window.location.href = data.url;
    } catch {
      setToast("No active subscription");
    }
  };

  const theme = THEMES[themeKey] || THEMES.nebula;
  const primary = customPrimary || theme.primary;
  const bgLayerStyle = customBg ? { backgroundImage: `url(${customBg})` } : { backgroundImage: theme.bg };
  const overlayStyle = { backgroundColor: `rgba(0,0,0,${1 - bgOpacity})` };

  if (!isLoaded) return null;

  return (
    <div className="app-root" style={{ "--primary": primary, "--border": theme.border, "--glow": theme.glow }}>
      <div className="bg-layer" style={bgLayerStyle} />
      <div className="bg-overlay" style={overlayStyle} />

      {toast && <div className="toast">{toast}</div>}

      {showCamera && (
        <div className="camera-overlay">
          <video ref={videoRef} autoPlay className="camera-video" />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <div className="camera-controls">
            <button onClick={capturePhoto} className="camera-btn primary">
              Capture
            </button>
            <button onClick={stopCamera} className="camera-btn secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="app-shell">
        <header className="app-header">
          <button
            className="icon-btn mobile-only"
            onClick={() => setMobileSidebarOpen(true)}
            title="Chats"
          >
            <Icon name="menu" size={20} />
          </button>

          <button
            className="icon-btn desktop-only"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title="Chats"
          >
            <Icon name="menu" size={20} />
          </button>

          <div className="brand">
            <h1 className="main-title">{activeChat?.title || "ALOP-AI"}</h1>
            <span className="sub-title">
              AI Council • {userPlan === "pro" ? "8 models" : "4 models"}
            </span>
          </div>

          <div className="header-actions">
            {isAdmin && (
              <button
                className={`icon-btn admin-btn ${showAdmin ? "active" : ""}`}
                onClick={() => {
                  setShowAdmin((s) => !s);
                  setShowSettings(false);
                }}
                title="Admin"
              >
                <Icon name="crown" size={20} />
              </button>
            )}

            <button className="icon-btn" onClick={() => setShowPricing(true)} title="Upgrade">
              <Icon name="upgrade" size={20} />
            </button>

            <button
              className="icon-btn"
              onClick={() => {
                setShowSettings((s) => !s);
                setShowAdmin(false);
              }}
              title="Settings"
            >
              <Icon name="settings" size={20} />
            </button>
          </div>
        </header>

        <div className="app-body">
          <ChatSidebar
            chats={sortedChats}
            activeChatId={activeChatId}
            onSelect={setActiveChatId}
            onCreate={createChat}
            onDelete={deleteChat}
            onRename={renameChat}
            onPin={togglePinChat}
            onFavorite={toggleFavoriteChat}
            collapsed={sidebarCollapsed}
            mobileOpen={mobileSidebarOpen}
            setMobileOpen={setMobileSidebarOpen}
          />

          <div className="chat-main">
            {showPricing && (
              <>
                <div className="panel-overlay" onClick={() => setShowPricing(false)} />
                <div className="side-panel">
                  <div className="panel-header">
                    <div className="panel-title">Upgrade to Pro 🚀</div>
                    <button onClick={() => setShowPricing(false)} className="icon-btn">
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  <div className="panel-body">
                    <div style={{ textAlign: "center", marginBottom: 24, fontSize: 15, opacity: 0.6 }}>
                      Unlock the full AI Council with all 8 models, plus unlimited images, vision, voice, and priority support.
                    </div>

                    <div className="pricing-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Pro Monthly</div>
                          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>$0.27/day</div>
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 800 }}>
                          $8<span style={{ fontSize: 12, opacity: 0.5 }}>/mo</span>
                        </div>
                      </div>
                    </div>

                    <div className="pricing-card popular">
                      <div className="popular-badge">Most Popular</div>
                      <div className="save-badge">Save 17%</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Pro Yearly</div>
                          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>$0.22/day</div>
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 800 }}>
                          $80<span style={{ fontSize: 12, opacity: 0.5 }}>/yr</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => upgrade("yearly")}
                      className="new-chat-btn"
                      style={{
                        width: "100%",
                        marginTop: 16,
                        background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                        borderRadius: 14,
                        padding: 14,
                        fontSize: 15,
                      }}
                    >
                      Continue
                    </button>

                    <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Pro includes</div>
                      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13, opacity: 0.8, lineHeight: 1.9 }}>
                        <li>✅ AI Council with 8 models</li>
                        <li>✅ Real-time web search & current news</li>
                        <li>✅ Unlimited image generation</li>
                        <li>✅ Vision & file analysis</li>
                        <li>✅ Voice input</li>
                        <li>✅ Cloud sync & priority support</li>
                      </ul>
                    </div>

                    {userPlan === "pro" && (
                      <button
                        onClick={manageSubscription}
                        className="theme-card"
                        style={{ width: "100%", marginTop: 16 }}
                      >
                        Manage subscription
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {showAdmin && isAdmin && (
              <>
                <div className="panel-overlay" onClick={() => setShowAdmin(false)} />
                <div className="side-panel">
                  <div className="panel-header">
                    <div className="panel-title">Admin Dashboard</div>
                    <button onClick={() => setShowAdmin(false)} className="icon-btn">
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  <div className="panel-body">
                    <div className="admin-title">{adminUsers.length} Users</div>
                    {adminUsers.map((u) => (
                      <div key={u.id} className="admin-user-card">
                        <div className="admin-user-header">
                          <img src={u.avatar_url || "https://via.placeholder.com/36"} alt="" className="admin-avatar" />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name || "Anonymous"}</div>
                            <div style={{ fontSize: 11, opacity: 0.6 }}>{u.email || "No email"}</div>
                          </div>
                          <span className={`admin-badge ${u.plan === "pro" ? "pro" : "free"}`}>
                            {u.plan || "free"}
                          </span>
                          {u.is_admin && <span className="admin-badge admin">Admin</span>}
                        </div>
                        <div className="msg-actions" style={{ justifyContent: "flex-start", marginTop: 8, opacity: 1 }}>
                          {u.suspended ? (
                            <button onClick={() => adminUnsuspend(u.id)} className="msg-action-btn">
                              Unsuspend
                            </button>
                          ) : (
                            <button onClick={() => adminSuspend(u.id)} className="msg-action-btn">
                              Suspend
                            </button>
                          )}
                          <button
                            onClick={() => adminDeleteUser(u.id)}
                            className="msg-action-btn"
                            style={{ color: "#fb7185" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {showSettings && (
              <>
                <div className="panel-overlay" onClick={() => setShowSettings(false)} />
                <div className="side-panel">
                  <div className="panel-header">
                    <div className="panel-title">Settings</div>
                    <button onClick={() => setShowSettings(false)} className="icon-btn">
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  <div className="panel-body">
                    <div className="setting-row">
                      <div className="setting-label">Theme</div>
                      <div className="theme-grid">
                        {Object.keys(THEMES).map((k) => (
                          <button
                            key={k}
                            onClick={() => setThemeKey(k)}
                            className={`theme-card ${themeKey === k ? "selected" : ""}`}
                          >
                            {k}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="setting-row">
                      <div className="setting-label">Background</div>
                      <input
                        className="custom-input"
                        type="text"
                        value={customBg}
                        onChange={(e) => setCustomBg(e.target.value)}
                        placeholder="Image URL"
                      />
                      <div className="theme-grid">
                        {Object.entries(BACKGROUND_PRESETS).map(([k, url]) => (
                          <button key={k} onClick={() => setCustomBg(url)} className="theme-card">
                            {k}
                          </button>
                        ))}
                        <button onClick={() => setCustomBg("")} className="theme-card">
                          Reset
                        </button>
                      </div>
                    </div>

                    <div className="setting-row">
                      <div className="setting-label">Background Intensity: {Math.round(bgOpacity * 100)}%</div>
                      <div className="slider-container">
                        <span>Dim</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={bgOpacity}
                          onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                          className="slider"
                        />
                        <span>Bright</span>
                      </div>
                    </div>

                    <div className="setting-row">
                      <div className="setting-label">Accent Color</div>
                      <input
                        type="color"
                        value={customPrimary || primary}
                        onChange={(e) => setCustomPrimary(e.target.value)}
                        style={{ width: 50, height: 36, border: "none", cursor: "pointer" }}
                      />
                      {customPrimary && (
                        <button onClick={() => setCustomPrimary("")} className="theme-card">
                          Reset
                        </button>
                      )}
                    </div>

                    <div className="setting-row">
                      <button onClick={() => activeChatId && deleteChat(activeChatId)} className="theme-card">
                        Delete Chat
                      </button>
                    </div>

                    <div className="setting-row">
                      <SignOutButton>
                        <button className="theme-card" style={{ width: "100%", background: "rgba(255,255,255,0.1)" }}>
                          Sign Out
                        </button>
                      </SignOutButton>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="chat-content">
              <div className="scroll-wrapper" ref={chatRef}>
                {activeMessages.length === 0 && status === "idle" && (
                  <div className="empty-state">
                    <h2 className="empty-title">ALOP-AI</h2>
                    <p className="empty-subtitle">
                      Ask the AI Council anything. Multiple models work together to give you the most accurate, helpful answer.
                    </p>
                  </div>
                )}

                {activeMessages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`msg-row ${msg.role}`}>
                    <div className="avatar">{msg.role === "user" ? "YOU" : "AI"}</div>
                    <div className="msg-content">
                      {msg.typing && (
                        <div className="bubble typing-bubble">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      )}

                      {msg.content && !msg.typing && <div className="bubble">{msg.content}</div>}

                      {msg.imageUrl && (
                        <div style={{ marginTop: 8 }}>
                          <img
                            src={msg.imageUrl}
                            alt="Generated"
                            style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 12, cursor: "pointer" }}
                            onClick={() => window.open(msg.imageUrl, "_blank")}
                          />
                          <div className="msg-meta" style={{ textAlign: "left" }}>
                            {msg.imagePrompt}
                          </div>
                        </div>
                      )}

                      {msg.attachments?.length > 0 && (
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          {msg.attachments.map((a, i) => (
                            <img
                              key={i}
                              src={a.url}
                              alt={a.name}
                              style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover" }}
                            />
                          ))}
                        </div>
                      )}

                      {msg.role === "assistant" && !msg.imageUrl && !msg.typing && (
                        <MessageActions
                          content={msg.content}
                          onCopy={() => navigator.clipboard.writeText(msg.content)}
                        />
                      )}

                      <div className="msg-meta">{msg.ts}</div>
                    </div>
                  </div>
                ))}
              </div>

              <InputBar
                text={inputText}
                setText={setInputText}
                onSend={handleSend}
                disabled={status !== "idle"}
                attachments={attachments}
                setAttachments={setAttachments}
                onFileSelect={handleFileSelect}
                onStartCamera={startCamera}
                isListening={isListening}
                toggleListening={toggleListening}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AuthenticatedAppWrapper = () => {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return (
      <div className="sign-in-overlay">
        <div className="sign-in-modal">
          <div className="sign-in-features-side">
            <div className="sign-in-features-title">What's included</div>
            <div className="feature-table">
              <div className="feature-row header">
                <div className="feature-name">Feature</div>
                <div>Free</div>
                <div>Pro</div>
              </div>

              {[
                { icon: "🧠", name: "AI Council models", free: "4", pro: "8" },
                { icon: "🔍", name: "Real-time web search", free: false, pro: true },
                { icon: "🖼️", name: "Image Generation", free: false, pro: true },
                { icon: "👁️", name: "Vision & Files", free: false, pro: true },
                { icon: "🎙️", name: "Voice Input", free: false, pro: true },
                { icon: "☁️", name: "Cloud Sync", free: true, pro: true },
                { icon: "💬", name: "Unlimited Messages", free: false, pro: true },
              ].map((f, i) => (
                <div className="feature-row" key={i}>
                  <div className="feature-name">
                    <div className="feature-icon">{f.icon}</div>
                    <div>{f.name}</div>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12, opacity: 0.7 }}>
                    {typeof f.free === "boolean" ? (
                      f.free ? <span className="feature-check">✓</span> : <span className="feature-cross">×</span>
                    ) : (
                      f.free
                    )}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12, opacity: 0.7 }}>
                    {typeof f.pro === "boolean" ? (
                      f.pro ? <span className="feature-check">✓</span> : <span className="feature-cross">×</span>
                    ) : (
                      f.pro
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "auto", fontSize: 12, opacity: 0.4, paddingTop: 20 }}>
              Sign in free to sync chats. Upgrade to Pro for the full AI Council.
            </div>
          </div>

          <div className="sign-in-form-side">
            <div className="sign-in-logo">
              <div className="sign-in-logo-icon">A</div>
              <div className="sign-in-logo-text">ALOP-AI</div>
            </div>
            <div className="sign-in-form-title">Sign in to ALOP-AI</div>
            <div className="sign-in-form-subtitle">
              One account for every frontier AI model. Chat with a council of models, generate images, analyze files, and build your knowledge base.
            </div>
            <div className="sign-in-card">
              <SignIn fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
            </div>
            <div className="sign-in-trust-badges">
              <span>🔒</span> Secure authentication
              <span>•</span>
              <span>No credit card required</span>
            </div>
            <div className="payment-icons">
              <div className="payment-icon">VISA</div>
              <div className="payment-icon">MC</div>
              <div className="payment-icon">AMEX</div>
              <div className="payment-icon">PP</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <AuthenticatedApp />;
};

const OverlayAssistant = () => {
  const { getToken } = useAuth();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();

    const handleKey = (e) => {
      if (e.key === 'Escape' && window.alopHideOverlay) {
        window.alopHideOverlay();
      }
    };

    const handleFocus = () => inputRef.current?.focus();

    window.addEventListener('keydown', handleKey);
    window.addEventListener('alop-focus', handleFocus);

    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('alop-focus', handleFocus);
    };
  }, []);

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const speak = (text) => {
    if (!text) return;
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.15;
    utterance.pitch = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  const captureScreen = async () => {
    try {
      if (typeof window === 'undefined' || !window.__TAURI__ || !window.__TAURI__.invoke) {
        console.warn('Screen capture only works in the desktop app');
        return null;
      }

      const image = await window.__TAURI__.invoke('capture_screen');
      return image;
    } catch (err) {
      console.error('Native screen capture failed:', err);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim() || status === 'loading') return;

    setStatus('loading');
    setAnswer('');

    const image = await captureScreen();

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/overlay`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: query,
          image: image
        })
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const data = await res.json();
      const text = data.answer || 'No answer returned';
      setAnswer(text);
      setStatus('done');
      speak(text);
    } catch (err) {
      setStatus('error');
      setAnswer(`Error: ${err.message}`);
    }
  };

  return (
    <div className="overlay-root">
      {answer && (
        <div className="overlay-answer-card">
          <div className="overlay-answer-text">{answer}</div>
          <button
            className="overlay-tts-btn"
            onClick={() => isSpeaking ? stopSpeaking() : speak(answer)}
            title={isSpeaking ? 'Stop speaking' : 'Speak answer'}
          >
            {isSpeaking ? '■' : '▶'}
          </button>
        </div>
      )}

      <form className="overlay-bar" onSubmit={handleSubmit}>
        <div className="overlay-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v14a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>

        <input
          ref={inputRef}
          className="overlay-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about your screen or anything..."
          disabled={status === 'loading'}
        />

        <button
          className="overlay-submit"
          type="submit"
          disabled={status === 'loading' || !query.trim()}
        >
          {status === 'loading' ? '...' : '→'}
        </button>
      </form>
    </div>
  );
};


const App = () => {
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const isOverlay = window.location.search.includes('overlay=true');

  return (
    <ClerkProvider
      publishableKey={clerkKey}
      signInUrl="/"
      signUpUrl="/"
      afterSignInUrl="/"
      afterSignUpUrl="/"
      appearance={{
        baseTheme: "dark",
        variables: {
          colorPrimary: "#3b82f6",
          colorBackground: "#0f0f14",
          colorText: "#ffffff",
        },
      }}
    >
      <div style={{ width: "100vw", height: "100dvh" }}>
        {isOverlay ? <OverlayAssistant /> : <AuthenticatedAppWrapper />}
      </div>
    </ClerkProvider>
  );
};

export default App;
