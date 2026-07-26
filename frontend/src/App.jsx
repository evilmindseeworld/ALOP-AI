import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ClerkProvider, SignIn, useUser, useAuth, SignOutButton } from "@clerk/react";
import "./App.css";
import SignInPage from "./SignInPage";
import MagneticButton from "./components/ui/MagneticButton";
import { animate, createScope, spring, createDraggable } from "animejs";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const isImageRequest = (text) => {
  if (text.length > 100) return false;
  return /^\/image|^generate image|^create image|^draw image|^make image/i.test(text.trim());
};

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
  if (words.length > 6) title += "...";
  return title.charAt(0).toUpperCase() + title.slice(1);
};

const Storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
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
    sun: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    ),
    moon: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  };
  return icons[name] || null;
};

const MessageActions = ({ content, onCopy }) => (
  <div className="msg-actions">
    <button className="msg-action-btn" onClick={onCopy}>
      <Icon name="copy" size={13} /> Copy
    </button>
  </div>
);

const ChatItem = ({ chat, activeChatId, onSelect, onRename, onDelete, onPin, onFavorite }) => {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chat.title || "New Chat");

  const handleRename = () => { onRename(chat.id, editTitle); setEditing(false); };
  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleRename();
    if (e.key === "Escape") { setEditTitle(chat.title || "New Chat"); setEditing(false); }
  };

  return (
    <div
      className={`chat-item ${chat.id === activeChatId ? "active" : ""} ${chat.pinned ? "pinned" : ""} ${chat.favorite ? "favorite" : ""}`}
      onClick={() => onSelect(chat.id)}
    >
      <div className="chat-title">
        {editing ? (
          <input className="custom-input" style={{ padding: "4px 8px", fontSize: 12 }} value={editTitle} autoFocus
            onChange={(e) => setEditTitle(e.target.value)} onBlur={handleRename} onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()} />
        ) : (chat.title || "New Chat")}
      </div>
      <div className="chat-actions" onClick={(e) => e.stopPropagation()}>
        <button className="chat-action" onClick={() => onPin(chat.id)} title="Pin"><Icon name="pin" size={13} /></button>
        <button className="chat-action" onClick={() => onFavorite(chat.id)} title="Favorite"><Icon name="heart" size={13} /></button>
        <button className="chat-action" onClick={() => { setEditing(true); setEditTitle(chat.title || "New Chat"); }} title="Rename">✎</button>
        <button className="chat-action" onClick={() => onDelete(chat.id)} title="Delete"><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
};

const ChatSidebar = ({ chats, activeChatId, onSelect, onCreate, onDelete, onRename, onPin, onFavorite, collapsed, mobileOpen, setMobileOpen }) => (
  <div className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobileOpen" : ""} ${typeof window !== "undefined" && window.innerWidth <= 768 ? "mobile" : ""}`}>
    <div className="sidebar-header">
      <button className="new-chat-btn" onClick={onCreate}><Icon name="plus" size={16} /> New Chat</button>
      {mobileOpen && <button className="icon-btn" onClick={() => setMobileOpen(false)}><Icon name="close" size={18} /></button>}
    </div>
    <div className="chat-list">
      {chats.length === 0 && <div style={{ textAlign: "center", opacity: 0.5, padding: 20, fontSize: 13 }}>No chats yet</div>}
      {chats.map((chat) => (
        <ChatItem key={chat.id} chat={chat} activeChatId={activeChatId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onPin={onPin} onFavorite={onFavorite} />
      ))}
    </div>
    <div className="sidebar-footer">ALOP-AI • Council of Minds</div>
  </div>
);

const InputBar = ({ text, setText, onSend, disabled, attachments, setAttachments, onFileSelect, onStartCamera, isListening, toggleListening }) => {
  const [rows, setRows] = useState(1);
  useEffect(() => { setRows(Math.min(Math.max(text.split("\n").length, 1), 1000)); }, [text]);
  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!disabled) onSend(text); } };
  const removeAttachment = (idx) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="input-bar">
      <div className="input-wrapper">
        {attachments.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {attachments.map((a, i) => (
              <div key={i} className="attachment-pill">{a.name}<button onClick={() => removeAttachment(i)}>×</button></div>
            ))}
          </div>
        )}
        <textarea className="input-text" rows={rows} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown} placeholder="Ask the AI Council anything..." disabled={disabled} />
        <div className="input-actions">
          <label className="input-btn" title="Upload image" style={{ cursor: "pointer" }}>
            <input type="file" accept="image/*" multiple onChange={onFileSelect} disabled={disabled} style={{ display: "none" }} />
            <Icon name="image" size={16} />
          </label>
          <button className={`input-btn ${isListening ? "listening" : ""}`} onClick={toggleListening} title="Voice input"><Icon name="mic" size={16} /></button>
          <button className="input-btn" onClick={onStartCamera} title="Camera" disabled={disabled}><Icon name="camera" size={16} /></button>
          <div style={{ flex: 1 }}></div>
          <button className="input-btn primary" onClick={() => onSend(text)} disabled={disabled || !text.trim()}><Icon name="send" size={16} /></button>
        </div>
      </div>
    </div>
  );
};

const AuthenticatedApp = () => {
  const { user, isLoaded } = useUser();
  const { getToken, isSignedIn } = useAuth();

  const [darkMode, setDarkMode] = useState(() => {
    const stored = Storage.get("alop-dark-mode");
    return stored === null ? true : stored === "true";
  });
  const [creativity, setCreativity] = useState(() => {
    const stored = Storage.get("alop-creativity");
    return stored === null ? 0.6 : parseFloat(stored);
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const v = Storage.get("pa-sidebar-collapsed");
    return v === null ? true : v === "true";
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
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
    if (params.get('desktop') === 'true') {
      const focusInput = () => { const input = document.querySelector('.input-text'); if (input) input.focus(); };
      focusInput();
      const handleFocusEvent = () => focusInput();
      window.addEventListener('alop-focus', handleFocusEvent);
      return () => window.removeEventListener('alop-focus', handleFocusEvent);
    }
  }, []);

  useEffect(() => Storage.set("alop-dark-mode", darkMode.toString()), [darkMode]);
  useEffect(() => Storage.set("alop-creativity", creativity.toString()), [creativity]);
  useEffect(() => Storage.set("pa-sidebar-collapsed", sidebarCollapsed.toString()), [sidebarCollapsed]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chats, activeChatId]);

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId]);
  const activeMessages = activeChat?.messages || [];

  // Anime.js: Draggable logo + spring messages + elastic buttons
  useEffect(() => {
    if (!chatRef.current) return;

    if (activeMessages.length === 0) {
      const scope = createScope({ root: chatRef.current }).add(() => {
        animate('.empty-logo', {
          scale: [
            { to: 1.08, ease: 'inOut(3)', duration: 400 },
            { to: 1, ease: spring({ bounce: 0.7 }) }
          ],
          loop: true,
          loopDelay: 1200,
        });

        createDraggable('.empty-logo', {
          container: [0, 0, 0, 0],
          releaseEase: spring({ bounce: 0.8 }),
        });
      });

      return () => scope.revert();
    }

    const msgs = chatRef.current.querySelectorAll('.msg-row');
    if (msgs.length > 0) {
      animate(msgs[msgs.length - 1], {
        opacity: [0, 1],
        translateY: [16, 0],
        scale: [0.97, 1],
        ease: spring({ bounce: 0.3, stiffness: 120 }),
        duration: 700,
      });
    }
  }, [activeMessages]);

  useEffect(() => {
    const handler = (e) => {
      const btn = e.target.closest('.input-btn.primary, .new-chat-btn, .overlay-submit');
      if (!btn) return;
      animate(btn, {
        scale: [
          { to: 0.9, duration: 80 },
          { to: 1, ease: spring({ bounce: 0.6 }) }
        ],
      });
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const apiCall = async (path, options = {}) => {
    const token = await getToken();
    return fetch(`${API_BASE}${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  };

  const fetchAdminUsers = async () => {
    try { const r = await apiCall("/api/admin/users"); const data = await r.json(); setAdminUsers(data || []); }
    catch (err) { console.error("Failed to fetch admin users:", err.message); }
  };

  const loadChats = useCallback(async () => {
    try { const r = await apiCall("/api/chats"); const data = await r.json(); if (Array.isArray(data)) setChats(data); }
    catch (err) { console.error("Failed to load chats:", err.message); }
  }, []);

  const fetchPlan = useCallback(async () => {
    try { const r = await apiCall("/api/user/plan"); const data = await r.json(); setUserPlan(data.plan || "free"); }
    catch (err) { console.error("Failed to fetch plan:", err.message); }
  }, []);

  const startFreshChat = useCallback(async () => {
    await loadChats();
    const fresh = await createChat();
    if (fresh) setActiveChatId(fresh);
  }, [loadChats]);

  useEffect(() => { if (isLoaded && isSignedIn) { fetchPlan(); startFreshChat(); } }, [isLoaded, isSignedIn, fetchPlan, startFreshChat]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!isSignedIn || !user?.emailAddresses?.[0]?.emailAddress) return;
      try { const r = await apiCall("/api/admin/users"); if (r.ok) { const users = await r.json(); const me = users.find((u) => u.email === user.emailAddresses[0].emailAddress); if (me?.is_admin) setIsAdmin(true); } }
      catch (err) { console.error("Admin check failed:", err.message); }
    };
    if (isLoaded) checkAdmin();
  }, [isLoaded, user, isSignedIn]);

  useEffect(() => { if (isAdmin && showAdmin) fetchAdminUsers(); }, [isAdmin, showAdmin]);

  const createChat = async () => {
    try { const r = await apiCall("/api/chats", { method: "POST", body: JSON.stringify({ title: "New Chat" }) }); const data = await r.json(); setChats((prev) => [data, ...prev]); setActiveChatId(data.id); setInputText(""); setAttachments([]); return data.id; }
    catch (err) { setToast("Failed to create chat"); console.error("Create chat failed:", err.message); return null; }
  };

  const updateChatMessages = async (chatId, messages, saveToDb = true) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, messages, updated_at: new Date().toISOString() } : c)));
    if (saveToDb) { try { await apiCall(`/api/chats/${chatId}`, { method: "PUT", body: JSON.stringify({ messages }) }); } catch (err) { console.error("Failed to save messages:", err.message); } }
  };

  const deleteChat = async (id) => {
    try { await apiCall(`/api/chats/${id}`, { method: "DELETE" }); setChats((prev) => prev.filter((c) => c.id !== id)); if (activeChatId === id) setActiveChatId(null); }
    catch (err) { console.error("Delete chat failed:", err.message); }
  };

  const renameChat = async (id, title) => {
    if (!title || !title.trim()) return;
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    try { await apiCall(`/api/chats/${id}`, { method: "PUT", body: JSON.stringify({ title }) }); } catch (err) { console.error("Rename chat failed:", err.message); }
  };

  const togglePinChat = (id) => setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
  const toggleFavoriteChat = (id) => setChats((prev) => prev.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)));

  const sortedChats = useMemo(() => [...chats].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
  }), [chats]);

  const adminSuspend = async (id) => { try { if ((await apiCall(`/api/admin/users/${id}/suspend`, { method: "POST" })).ok) { setToast("User suspended"); fetchAdminUsers(); } } catch (err) { console.error("Suspend failed:", err.message); } };
  const adminUnsuspend = async (id) => { try { if ((await apiCall(`/api/admin/users/${id}/unsuspend`, { method: "POST" })).ok) { setToast("User unsuspended"); fetchAdminUsers(); } } catch (err) { console.error("Unsuspend failed:", err.message); } };
  const adminDeleteUser = async (id) => { if (!confirm("DELETE this user and all their data?")) return; try { if ((await apiCall(`/api/admin/users/${id}`, { method: "DELETE" })).ok) { setToast("User deleted"); fetchAdminUsers(); } } catch (err) { console.error("Delete user failed:", err.message); } };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files).filter((f) => f.type.startsWith("image/"));
    if (!files.length) { setToast("Only image files supported"); return; }
    setAttachments((prev) => [...prev, ...files]); e.target.value = "";
  };

  const startCamera = async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); cameraStreamRef.current = s; setShowCamera(true); setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100); } catch { setToast("Camera access denied"); } };
  const stopCamera = () => { if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach((t) => t.stop()); cameraStreamRef.current = null; } setShowCamera(false); };
  const capturePhoto = () => { if (!videoRef.current || !canvasRef.current) return; const v = videoRef.current; const c = canvasRef.current; c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0); c.toBlob((b) => { setAttachments((prev) => [...prev, new File([b], `camera-${Date.now()}.png`, { type: "image/png" })]); stopCamera(); }, "image/png"); };

  const stopListening = useCallback(() => { if (listenTimerRef.current) clearTimeout(listenTimerRef.current); if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; } setIsListening(false); }, []);
  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setToast("Voice input needs Chrome/Edge/Safari"); return; }
    const r = new SpeechRecognition(); r.continuous = false; r.interimResults = false; r.lang = "en-US"; r.maxAlternatives = 1;
    r.onstart = () => { setIsListening(true); listenTimerRef.current = setTimeout(() => { try { r.stop(); } catch {} }, 10000); };
    r.onend = () => { setIsListening(false); if (listenTimerRef.current) clearTimeout(listenTimerRef.current); recognitionRef.current = null; };
    r.onresult = (e) => { let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; if (t.trim()) setInputText((p) => p + t + " "); };
    r.onerror = () => { setIsListening(false); recognitionRef.current = null; };
    r.start(); recognitionRef.current = r;
  }, []);
  const toggleListening = useCallback(() => { if (isListening) stopListening(); else startListening(); }, [isListening, stopListening, startListening]);

  const generateImage = useCallback(async (promptText) => {
    const imagePrompt = parseImagePrompt(promptText) || promptText;
    if (!imagePrompt) { setToast("Describe what image to generate"); return; }
    let chatId = activeChatId; if (!chatId) chatId = await createChat(); if (!chatId) return;
    const userMsg = { role: "user", content: `Generate image: ${imagePrompt}`, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), id: uid() };
    const withUser = [...(activeMessages || []), userMsg];
    await updateChatMessages(chatId, withUser);
    if ((activeMessages || []).length === 0) { const autoTitle = generateChatTitle(imagePrompt); if (autoTitle) renameChat(chatId, autoTitle); }
    await updateChatMessages(chatId, [...withUser, { role: "assistant", content: "", imageUrl: buildImageUrl(imagePrompt), imagePrompt, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), id: uid() }]);
    setInputText(""); setAttachments([]);
  }, [activeChatId, activeMessages]);

  const handleSend = useCallback(async (text) => {
    let chatId = activeChatId; if (!chatId) chatId = await createChat(); if (!chatId) return;
    const cleanText = text.trim();
    if (isImageRequest(cleanText)) { generateImage(cleanText); return; }
    if (attachments.length > 0) { setToast("File upload temporarily disabled in Council mode"); return; }
    if (!cleanText || status !== "idle") return;
    setStatus("loading");
    const userMsg = { role: "user", content: cleanText, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), id: uid() };
    const updated = [...activeMessages, userMsg];
    await updateChatMessages(chatId, updated);
    if (activeMessages.length === 0 && cleanText) { const autoTitle = generateChatTitle(cleanText); if (autoTitle) renameChat(chatId, autoTitle); }
    const assistantId = uid();
    const assistantMsg = { role: "assistant", content: "", typing: true, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), id: assistantId };
    updateChatMessages(chatId, [...updated, assistantMsg], false);
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/council`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: cleanText, history: activeMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })), temperature: creativity }), signal: abortRef.current.signal });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Server error: ${res.status}`); }
      if (!res.body) throw new Error("Streaming not supported");
      setStatus("streaming");
      updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: "" }], false);
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let acc = ""; let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) { const t = line.trim(); if (!t.startsWith("data: ")) continue; const j = t.slice(6).trim(); if (j === "[DONE]") break; try { const d = JSON.parse(j); if (d.type === "chunk") acc += d.text; else if (d.type === "error") throw new Error(d.text); } catch {} }
        updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc }], false);
      }
      await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc }]);
      setStatus("idle");
    } catch (err) {
      if (err.name === "AbortError") return;
      setStatus("error");
      await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: `⚠️ ${err.message || "Connection failed"}` }]);
    }
    setInputText("");
  }, [activeChatId, activeMessages, status, generateImage, attachments, creativity]);

  if (!isLoaded) return null;
  return (
    <div className={`app-root ${darkMode ? "dark" : "light"}`}>
      <div className="bg-layer" />
      <div className="bg-overlay" />

      {toast && <div className="toast">{toast}</div>}

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

      <div className="app-shell">
        <header className="app-header">
          <button className="icon-btn mobile-only" onClick={() => setMobileSidebarOpen(true)} title="Chats"><Icon name="menu" size={20} /></button>
          <button className="icon-btn desktop-only" onClick={() => setSidebarCollapsed((c) => !c)} title="Chats"><Icon name="menu" size={20} /></button>
          <div className="brand">
            <img src="/logo.png" alt="" className="header-logo" />
            <div className="brand-text">
              <h1 className="main-title">{activeChat?.title || "ALOP-AI"}</h1>
              <span className="sub-title">AI Council • {userPlan === "pro" ? "15 models" : "4 models"}</span>
            </div>
          </div>
          <div className="header-actions">
            {isAdmin && (
              <MagneticButton className={`icon-btn admin-btn ${showAdmin ? "active" : ""}`} onClick={() => { setShowAdmin((s) => !s); setShowSettings(false); }} ariaLabel="Admin">
                <Icon name="crown" size={20} />
              </MagneticButton>
            )}
            <MagneticButton className="icon-btn" onClick={() => setDarkMode((d) => !d)} ariaLabel="Toggle theme">
              <Icon name={darkMode ? "sun" : "moon"} size={20} />
            </MagneticButton>
            <MagneticButton className="icon-btn" onClick={() => { setShowSettings((s) => !s); setShowAdmin(false); }} ariaLabel="Settings">
              <Icon name="settings" size={20} />
            </MagneticButton>
          </div>
        </header>

        <div className="app-body">
          <ChatSidebar chats={sortedChats} activeChatId={activeChatId} onSelect={setActiveChatId} onCreate={createChat} onDelete={deleteChat} onRename={renameChat} onPin={togglePinChat} onFavorite={toggleFavoriteChat} collapsed={sidebarCollapsed} mobileOpen={mobileSidebarOpen} setMobileOpen={setMobileSidebarOpen} />

          <div className="chat-main">
            {showAdmin && isAdmin && (
              <>
                <div className="panel-overlay" onClick={() => setShowAdmin(false)} />
                <div className="side-panel">
                  <div className="panel-header"><div className="panel-title">Admin Dashboard</div><button onClick={() => setShowAdmin(false)} className="icon-btn"><Icon name="close" size={18} /></button></div>
                  <div className="panel-body">
                    <div className="admin-title">{adminUsers.length} Users</div>
                    {adminUsers.map((u) => (
                      <div key={u.id} className="admin-user-card">
                        <div className="admin-user-header">
                          <img src={u.avatar_url || "https://via.placeholder.com/36"} alt="" className="admin-avatar" />
                          <div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{u.name || "Anonymous"}</div><div style={{ fontSize: 11, color: "var(--text-subtle)" }}>{u.email || "No email"}</div></div>
                          <span className={`admin-badge ${u.plan === "pro" ? "pro" : "free"}`}>{u.plan || "free"}</span>
                          {u.is_admin && <span className="admin-badge admin">Admin</span>}
                        </div>
                        <div className="msg-actions" style={{ justifyContent: "flex-start", marginTop: 8, opacity: 1 }}>
                          {u.suspended ? <button onClick={() => adminUnsuspend(u.id)} className="msg-action-btn">Unsuspend</button> : <button onClick={() => adminSuspend(u.id)} className="msg-action-btn">Suspend</button>}
                          <button onClick={() => adminDeleteUser(u.id)} className="msg-action-btn" style={{ color: "var(--danger)" }}>Delete</button>
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
                  <div className="panel-header"><div className="panel-title">Settings</div><button onClick={() => setShowSettings(false)} className="icon-btn"><Icon name="close" size={18} /></button></div>
                  <div className="panel-body">
                    <div className="setting-row">
                      <div className="setting-label">Appearance</div>
                      <div className={`theme-toggle ${darkMode ? "active" : ""}`} onClick={() => setDarkMode((d) => !d)}>
                        <span className="theme-toggle-label">{darkMode ? "Sakura Night" : "Bamboo Day"}</span>
                        <div className="theme-toggle-switch" />
                      </div>
                    </div>
                    <div className="setting-row">
                      <button onClick={() => activeChatId && deleteChat(activeChatId)} className="theme-card">Delete Chat</button>
                    </div>
                    <div className="setting-row">
                      <SignOutButton>
                        <button className="theme-card" style={{ width: "100%" }}>Sign Out</button>
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
                    <img src="/logo.png" alt="ALOP-AI" className="empty-logo" />
                    <p className="empty-subtitle">Ask the AI Council anything. Multiple models work together.</p>
                  </div>
                )}
                {activeMessages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`msg-row ${msg.role}`}>
                    <div className="avatar">{msg.role === "user" ? "YOU" : "AI"}</div>
                    <div className="msg-content">
                      {msg.content && !msg.typing && <div className="bubble">{msg.content}</div>}
                      {msg.imageUrl && (
                        <div style={{ marginTop: 8 }}>
                          <img src={msg.imageUrl} alt="Generated" style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: "var(--radius-lg)", cursor: "pointer" }} onClick={() => window.open(msg.imageUrl, "_blank")} />
                          <div className="msg-meta" style={{ textAlign: "left" }}>{msg.imagePrompt}</div>
                        </div>
                      )}
                      {msg.attachments?.length > 0 && (
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          {msg.attachments.map((a, i) => <img key={i} src={a.url} alt={a.name} style={{ width: 60, height: 60, borderRadius: "var(--radius-sm)", objectFit: "cover" }} />)}
                        </div>
                      )}
                      {msg.role === "assistant" && !msg.imageUrl && !msg.typing && <MessageActions content={msg.content} onCopy={() => navigator.clipboard.writeText(msg.content)} />}
                      <div className="msg-meta">{msg.ts}</div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="creativity-bar">
                <span className="creativity-label">Creativity</span>
                <div
                  className="creativity-track"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    setCreativity(Math.round(pct * 10) / 10);
                  }}
                >
                  <div className="creativity-fill" style={{ width: `${creativity * 100}%` }} />
                </div>
                <span className="creativity-value">{Math.round(creativity * 100)}%</span>
              </div>

              <InputBar text={inputText} setText={setInputText} onSend={handleSend} disabled={status !== "idle"} attachments={attachments} setAttachments={setAttachments} onFileSelect={handleFileSelect} onStartCamera={startCamera} isListening={isListening} toggleListening={toggleListening} />
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
  if (!isSignedIn) return <SignInPage />;
  return <AuthenticatedApp />;
};

const OverlayAssistant = () => {
  const { getToken } = useAuth();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e) => { if (e.key === 'Escape' && window.alopHideOverlay) window.alopHideOverlay(); };
    const handleFocus = () => inputRef.current?.focus();
    window.addEventListener('keydown', handleKey);
    window.addEventListener('alop-focus', handleFocus);
    return () => { window.removeEventListener('keydown', handleKey); window.removeEventListener('alop-focus', handleFocus); stopRecording(); stopSpeaking(); stopLiveStream(); };
  }, []);

  const stopSpeaking = () => { window.speechSynthesis.cancel(); setIsSpeaking(false); };
  const speak = (text) => { if (!text) return; stopSpeaking(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.15; u.pitch = 1; u.onend = () => setIsSpeaking(false); u.onerror = () => setIsSpeaking(false); window.speechSynthesis.speak(u); setIsSpeaking(true); };
  const stopRecording = () => { if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; } setIsRecording(false); };
  const toggleRecording = () => {
    if (isRecording) { stopRecording(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Voice input needs Chrome/Edge/Safari'); return; }
    const r = new SR(); r.continuous = false; r.interimResults = false; r.lang = 'en-US';
    r.onstart = () => setIsRecording(true);
    r.onend = () => { setIsRecording(false); recognitionRef.current = null; };
    r.onresult = (e) => { const t = e.results[0][0].transcript; setQuery((p) => p + t + ' '); inputRef.current?.focus(); };
    r.onerror = () => setIsRecording(false);
    r.start(); recognitionRef.current = r;
  };
  const stopLiveStream = () => { if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; videoRef.current = null; } setLiveActive(false); };
  const startLiveStream = async () => {
    try { const s = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false }); s.getVideoTracks()[0].onended = () => stopLiveStream(); const v = document.createElement('video'); v.srcObject = s; v.play(); streamRef.current = s; videoRef.current = v; setLiveActive(true); }
    catch (err) { console.error('Live stream failed:', err); }
  };
  const captureFromLiveStream = async () => {
    if (!videoRef.current || !streamRef.current) return null;
    await new Promise((r) => setTimeout(r, 150));
    const v = videoRef.current; const c = document.createElement('canvas'); c.width = v.videoWidth || 1920; c.height = v.videoHeight || 1080; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); return c.toDataURL('image/png');
  };
  const captureScreen = async () => {
    if (liveActive) return await captureFromLiveStream();
    try { const s = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false }); const v = document.createElement('video'); v.srcObject = s; await new Promise((res) => { v.onloadedmetadata = () => { v.play(); res(); }; }); await new Promise((r) => setTimeout(r, 300)); const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); s.getTracks().forEach((t) => t.stop()); return c.toDataURL('image/png'); }
    catch (err) { console.error('Screen capture failed:', err); return null; }
  };
  const handleFile = (e) => {
    const f = e.target.files[0]; if (!f) return; if (!f.type.startsWith('image/')) { alert('Only images supported'); return; }
    const r = new FileReader(); r.onload = () => setAttachment(r.result); r.readAsDataURL(f); e.target.value = '';
  };
  const handleSubmit = async (e) => {
    e.preventDefault(); if (!query.trim() || status === 'loading') return;
    setStatus('loading'); const image = await captureScreen();
    const body = { prompt: query, image: image || attachment || undefined };
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/overlay`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json(); const text = data.answer || 'No answer returned';
      setAnswer(text); setStatus('done'); setAttachment(null); setQuery(''); speak(text);
    } catch (err) { setStatus('error'); setAnswer(`Error: ${err.message}`); }
  };

  return (
    <div className="overlay-root">
      <div className="overlay-answer-stack">
        {answer && (
          <div className="overlay-answer-card">
            <div className="overlay-answer-text">{answer}</div>
            <button className="overlay-tts-btn" onClick={() => isSpeaking ? stopSpeaking() : speak(answer)} title={isSpeaking ? 'Stop speaking' : 'Speak answer'}>{isSpeaking ? '■' : '▶'}</button>
          </div>
        )}
      </div>
      {attachment && <div className="overlay-thumb-pill">Image attached<button onClick={() => setAttachment(null)}>×</button></div>}
      <form className="overlay-bar" onSubmit={handleSubmit}>
        <div className={`overlay-icon ${liveActive ? 'live' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v14a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
        </div>
        <input ref={inputRef} className="overlay-input" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={liveActive ? "Live screen connected. Ask anything..." : "Ask about your screen or anything..."} disabled={status === 'loading'} />
        <button type="button" className={`overlay-action ${liveActive ? 'recording' : ''}`} onClick={liveActive ? stopLiveStream : startLiveStream} title={liveActive ? 'Stop live screen' : 'Start live screen'} disabled={status === 'loading'}>●</button>
        <label className="overlay-action" title="Attach image"><input type="file" accept="image/*" className="overlay-file-input" onChange={handleFile} disabled={status === 'loading'} />+</label>
        <button type="button" className={`overlay-action ${isRecording ? 'recording' : ''}`} onClick={toggleRecording} title="Voice input" disabled={status === 'loading'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
        </button>
        <button className="overlay-submit" type="submit" disabled={status === 'loading' || (!query.trim() && !attachment)}>{status === 'loading' ? '...' : '→'}</button>
      </form>
    </div>
  );
};

const App = () => {
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const isOverlay = typeof window !== 'undefined' && (window.location.search.includes('overlay=true') || window.location.hash.includes('overlay') || window.location.href.includes('overlay=true'));

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
          colorPrimary: "#ec7d96",
          colorBackground: "#1b120c",
          colorText: "#faf0e6",
        },
      }}
    >
      <div style={{ width: "100vw", height: "100dvh" }}>
        {isOverlay ? <OverlayAssistant /> : <AuthenticatedAppWrapper />}
        <div className="scanlines" aria-hidden="true" />
      </div>
    </ClerkProvider>
  );
};

export default App;
