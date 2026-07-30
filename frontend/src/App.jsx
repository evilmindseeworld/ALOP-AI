import { useState, useEffect, useRef, useMemo, useCallback, memo, lazy, Suspense } from "react";
import { ClerkProvider, useUser, useAuth, SignOutButton } from "@clerk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";
import SignInPage from "./SignInPage";
import MagneticButton from "./components/ui/MagneticButton";
import CommandPalette from "./components/CommandPalette";
import { animate, createScope, spring, createDraggable } from "animejs";
import Draggable from 'react-draggable';

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

// react-syntax-highlighter is ~4.9MB installed and carries a grammar for every
// language it supports. Loading it lazily keeps it off the critical path for
// users whose conversation never contains a fenced code block.
const CodeBlock = lazy(() => import("./components/CodeBlock"));

// The fallback is the same markup the highlighter renders into, so the block
// appears instantly as plain monospace and gains colour a moment later rather
// than popping in from nothing.
const CodeBlockFallback = ({ code }) => (
  <div className="code-block-wrapper">
    <pre className="code-block-plain"><code>{code}</code></pre>
  </div>
);

// --- Premium Markdown Code Blocks ---
const markdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');

    if (!inline) {
      return (
        <Suspense fallback={<CodeBlockFallback code={codeString} />}>
          <CodeBlock language={match ? match[1] : 'text'} code={codeString} {...props} />
        </Suspense>
      );
    } else {
      return <code className={className} {...props}>{children}</code>;
    }
  }
};

// --- Utilities ---
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const isImageRequest = (text) => text.length <= 100 && /^\/image|^generate image|^create image|^draw image|^make image/i.test(text.trim());
const parseImagePrompt = (text) => {
  const m = text.match(/(?:generate|create|draw|make)\s+(?:an?\s+)?image\s*(?:of\s+)?(.+)/i);
  return m ? m[1].trim() : text.replace(/^\/image\s*/, "").trim();
};
const buildImageUrl = (prompt) => `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
const generateChatTitle = (text) => {
  const cleaned = text.replace(/^\/image\s*/i, "").replace(/^(generate|create|draw|make)\s+(an?\s+)?image\s*(?:of\s+)?/i, "").trim();
  if (!cleaned) return "New Chat";
  const words = cleaned.split(/\s+/);
  let title = words.slice(0, 6).join(" ");
  if (words.length > 6) title += "...";
  return title.charAt(0).toUpperCase() + title.slice(1);
};
// Stripe reports minor units (900 = $9.00). Whole amounts drop the decimals so
// a $9 plan reads "$9" rather than "$9.00".
export const formatPrice = (p) => {
  if (!p || p.amount == null) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (p.currency || "usd").toUpperCase(),
      minimumFractionDigits: p.amount % 100 === 0 ? 0 : 2,
    }).format(p.amount / 100);
  } catch {
    return `${(p.amount / 100).toFixed(2)} ${(p.currency || "").toUpperCase()}`;
  }
};

const Storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// The backend rejects anything over 8MB, and a phone photo clears that easily.
// Downscaling here means the ceiling is never reached rather than reached and
// reported. 1568px is about where vision models stop gaining detail.
const MAX_IMAGE_EDGE = 1568;
const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Couldn't read that file."));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error("That file isn't a readable image."));
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      // Small enough already — keep the original bytes and its format, so a
      // PNG screenshot doesn't get needlessly re-encoded into a lossy JPEG.
      if (scale === 1 && reader.result.length < 4_000_000) return resolve(reader.result);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// Each starter exercises a different path through the backend — deliberation,
// live web search, code reasoning, and image generation — so a first-time user
// sees what the council actually does rather than guessing at it.
export const STARTERS = [
  { icon: "⚖️", label: "Weigh a decision", prompt: "Should I use PostgreSQL or MongoDB for a social app with heavy relational queries? Argue both sides, then commit to one." },
  { icon: "\u{1F50D}", label: "Search the live web", prompt: "What changed in the most recent React release, and should I upgrade?" },
  { icon: "\u{1F41B}", label: "Debug some code", prompt: "Why would a React useEffect run twice on mount, and when is that actually a bug?" },
  { icon: "\u{1F3A8}", label: "Generate an image", prompt: "/image a bioluminescent jellyfish drifting through a neon city skyline at night" },
];

// --- Skeleton Loaders ---
const InitialLoader = () => (
  <div className="initial-loader dark">
    <img src="/logo.png" alt="Loading ALOP-AI" />
    <div className="skeleton-block" style={{ width: '120px', height: '10px', marginTop: '10px' }}></div>
  </div>
);

const AppSkeleton = () => (
  <div className="app-root dark">
    <div className="bg-layer" />
    <div className="bg-overlay" />
        <div className="app-shell">
      <header className="app-header">
        <div className="skeleton-block" style={{ width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0 }}></div>
        <div style={{ marginLeft: '10px', gap: '8px', display: 'flex', flexDirection: 'column' }}>
          <div className="skeleton-block" style={{ width: '140px', height: '16px' }}></div>
          <div className="skeleton-block" style={{ width: '180px', height: '12px' }}></div>
        </div>
        <div style={{ flex: 1 }}></div>
        <div className="skeleton-block" style={{ width: '40px', height: '40px', borderRadius: '12px' }}></div>
      </header>
      <div className="app-body">
        <div className="sidebar">
          <div className="skeleton-block" style={{ height: '42px', marginBottom: '14px', borderRadius: '12px' }}></div>
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton-block" style={{ height: '42px', marginBottom: '8px', borderRadius: '12px' }}></div>)}
        </div>
        <div className="chat-main">
          <div className="scroll-wrapper">
            {[...Array(3)].map((_, i) => (
              <div key={i} className={`msg-row ${i % 2 === 0 ? 'assistant' : 'user'}`}>
                <div className="skeleton-block" style={{ width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0 }}></div>
                <div className="msg-content" style={{ gap: '10px', display: 'flex', flexDirection: 'column' }}>
                  <div className="skeleton-block" style={{ height: '16px', width: '70%' }}></div>
                  <div className="skeleton-block" style={{ height: '16px', width: '85%' }}></div>
                </div>
              </div>
            ))}
          </div>
          <div className="input-bar" style={{ display: 'flex', alignItems: 'center' }}>
            <div className="skeleton-block" style={{ height: '24px', flex: 1, borderRadius: '8px' }}></div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// --- Memoized UI Components ---
const Icon = memo(({ name, size = 18 }) => {
  const icons = {
    menu: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>,
    settings: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
    crown: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm2.86-2h8.28l.5-3.37L13.5 14 12 11.5 10.5 14 7.36 10.63l.5 3.37zM5 18h14v2H5v-2z" /></svg>,
    close: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
    pin: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM5 19.5h6v-2H5v2z" /></svg>,
    heart: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>,
    copy: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
    send: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>,
    image: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>,
    mic: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>,
    camera: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>,
    sun: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>,
    moon: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
    thumbsUp: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>,
    thumbsDown: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" /></svg>,
    stop: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
    refresh: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>,
    download: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>,
    arrowDown: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>,
  };
  return icons[name] || null;
});

const MessageActions = memo(({ content, onCopy, msgId, onFeedback, feedback }) => (
  <div className="msg-actions">
    <button className="msg-action-btn" onClick={onCopy}><Icon name="copy" size={13} /> Copy</button>
    <button className={`msg-action-btn ${feedback === 'up' ? 'active' : ''}`} onClick={() => onFeedback(msgId, 'up')}><Icon name="thumbsUp" size={13} /></button>
    <button className={`msg-action-btn ${feedback === 'down' ? 'active' : ''}`} onClick={() => onFeedback(msgId, 'down')}><Icon name="thumbsDown" size={13} /></button>
  </div>
));

const ChatItem = memo(({ chat, activeChatId, onSelect, onRename, onDelete, onPin, onFavorite }) => {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chat.title || "New Chat");
  const handleRename = () => { onRename(chat.id, editTitle); setEditing(false); };
  const handleKeyDown = (e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") { setEditTitle(chat.title || "New Chat"); setEditing(false); } };
  return (
    <div className={`chat-item ${chat.id === activeChatId ? "active" : ""} ${chat.pinned ? "pinned" : ""} ${chat.favorite ? "favorite" : ""}`} onClick={() => onSelect(chat.id)}>
      <div className="chat-title">{editing ? <input className="custom-input" style={{ padding: "4px 8px", fontSize: 12 }} value={editTitle} autoFocus onChange={(e) => setEditTitle(e.target.value)} onBlur={handleRename} onKeyDown={handleKeyDown} onClick={(e) => e.stopPropagation()} /> : (chat.title || "New Chat")}</div>
      <div className="chat-actions" onClick={(e) => e.stopPropagation()}>
        <button className="chat-action" onClick={() => onPin(chat.id)} title="Pin"><Icon name="pin" size={13} /></button>
        <button className="chat-action" onClick={() => onFavorite(chat.id)} title="Favorite"><Icon name="heart" size={13} /></button>
        <button className="chat-action" onClick={() => { setEditing(true); setEditTitle(chat.title || "New Chat"); }} title="Rename">✎</button>
        <button className="chat-action" onClick={() => onDelete(chat.id)} title="Delete"><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
});

const ChatSidebar = memo(({ chats, activeChatId, onSelect, onCreate, onDelete, onRename, onPin, onFavorite, collapsed, mobileOpen, setMobileOpen }) => (
  <div className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobileOpen" : ""} ${typeof window !== "undefined" && window.innerWidth <= 768 ? "mobile" : ""}`}>
    <div className="sidebar-header"><button className="new-chat-btn" onClick={onCreate}><Icon name="plus" size={16} /> New Chat</button>{mobileOpen && <button className="icon-btn" onClick={() => setMobileOpen(false)}><Icon name="close" size={18} /></button>}</div>
    <div className="chat-list">{chats.length === 0 && <div style={{ textAlign: "center", opacity: 0.5, padding: 20, fontSize: 13 }}>No chats yet</div>}{chats.map((chat) => <ChatItem key={chat.id} chat={chat} activeChatId={activeChatId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onPin={onPin} onFavorite={onFavorite} />)}</div>
    <div className="sidebar-footer">ALOP-AI • Council of Minds • Learning</div>
  </div>
));

// The attachment lives in the parent rather than here, because the camera
// capture flow sets it from outside this component.
export const InputBar = memo(({ onSend, disabled, onFileSelect, onStartCamera, isListening, toggleListening, attachedImage, onClearAttachment, isGenerating, onStop }) => {
  const [text, setText] = useState("");
  const [rows, setRows] = useState(1);

  useEffect(() => { setRows(Math.min(Math.max(text.split("\n").length, 1), 1000)); }, [text]);

  const submit = () => { if (disabled || !text.trim()) return; onSend(text); setText(""); };
  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };

  return (
    <div className="input-bar"><div className="input-wrapper">
      {attachedImage && (
        <div className="attachment-preview">
          <img src={attachedImage} alt="Attached" />
          <button onClick={onClearAttachment} title="Remove image" aria-label="Remove attached image">×</button>
        </div>
      )}
      <textarea className="input-text" rows={rows} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown} placeholder={attachedImage ? "Ask about this image..." : "Ask the AI Council anything..."} disabled={disabled} />
      <div className="input-actions">
        <label className="input-btn" title="Upload image" style={{ cursor: "pointer" }}><input type="file" accept="image/*" onChange={onFileSelect} disabled={disabled} style={{ display: "none" }} /><Icon name="image" size={16} /></label>
        <button className={`input-btn ${isListening ? "listening" : ""}`} onClick={toggleListening} title="Voice input"><Icon name="mic" size={16} /></button>
        <button className="input-btn" onClick={onStartCamera} title="Camera" disabled={disabled}><Icon name="camera" size={16} /></button>
        <div style={{ flex: 1 }}></div>
        {isGenerating
          ? <button className="input-btn primary is-stop" onClick={onStop} title="Stop generating" aria-label="Stop generating"><Icon name="stop" size={15} /></button>
          : <button className="input-btn primary" onClick={submit} disabled={disabled || !text.trim()} title="Send" aria-label="Send"><Icon name="send" size={16} /></button>}
      </div>
    </div></div>
  );
});

// Purely decorative. Positioning and stacking live in App.css (.earring-wrap /
// .earring-left / .earring-right) — deliberately NOT inline, because inline
// styles silently outrank the stylesheet and that mismatch is what caused the
// long run of duelling z-index commits.
//
// aria-hidden: a 3D ornament carries no information, so announcing it to a
// screen reader is noise. pointer-events:none is set on the <model-viewer>
// itself as well as the wrapper, because model-viewer is a custom element that
// otherwise captures drag gestures aimed at the UI behind it.
export const Earring = memo(({ side }) => (
  <div className={`earring-wrap earring-${side}`} aria-hidden="true" data-testid={`earring-${side}`}>
    <div className="earring-pivot">
      <model-viewer
        src="/model.glb"
        orientation="0deg 90deg 0deg"
        camera-orbit="0deg 90deg 105%"
        interaction-prompt="none"
        style={{ width: '140px', height: '200px', pointerEvents: 'none', transform: side === 'right' ? 'scaleX(-1)' : 'none' }}
      ></model-viewer>
    </div>
  </div>
));


const AuthenticatedApp = () => {
  const { user, isLoaded } = useUser();
  const { getToken, isSignedIn } = useAuth();

  const [darkMode, setDarkMode] = useState(() => { const s = Storage.get("alop-dark-mode"); return s === null ? true : s === "true"; });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { const v = Storage.get("pa-sidebar-collapsed"); return v === null ? true : v === "true"; });
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
  const [showCamera, setShowCamera] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  // Only true when the user has scrolled meaningfully away from the bottom.
  // The existing auto-scroll already stops following once you scroll up, which
  // previously left you stranded with no way back.
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  // null means "no pricing available" — the endpoint 503s when this deployment
  // has no Stripe price IDs, and the upgrade path stays hidden rather than
  // offering a checkout that would fail.
  const [prices, setPrices] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [feedback, setFeedback] = useState({});
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  const cameraStreamRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const listenTimerRef = useRef(null);
  const chatRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.get('desktop') === 'true') { const f = () => { const i = document.querySelector('.input-text'); if (i) i.focus(); }; f(); window.addEventListener('alop-focus', f); return () => window.removeEventListener('alop-focus', f); } }, []);
  useEffect(() => Storage.set("alop-dark-mode", darkMode.toString()), [darkMode]);
  useEffect(() => Storage.set("pa-sidebar-collapsed", sidebarCollapsed.toString()), [sidebarCollapsed]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => { if (!chatRef.current) return; const el = chatRef.current; const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150; if (nearBottom) el.scrollTop = el.scrollHeight; }, [chats, activeChatId]);
  useEffect(() => { if (chatRef.current && status === 'loading') chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [status]);

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId]);
  const activeMessages = useMemo(() => activeChat?.messages || [], [activeChat]);

  useEffect(() => {
    if (!chatRef.current) return;
    if (activeMessages.length === 0) { 
      const scope = createScope({ root: chatRef.current }).add(() => { 
        animate('.empty-logo', { scale: [{ to: 1.08, ease: 'inOut(3)', duration: 400 }, { to: 1, ease: spring({ bounce: 0.7 }) }], loop: true, loopDelay: 1200 }); 
        createDraggable('.empty-logo', { container: [0, 0, 0, 0], releaseEase: spring({ bounce: 0.8 }) }); 
      }); 
      return () => scope.revert(); 
    }
    const msgs = chatRef.current.querySelectorAll('.msg-row');
    if (msgs.length > 0) { animate(msgs[msgs.length - 1], { opacity: [0, 1], translateY: [16, 0], scale: [0.97, 1], ease: spring({ bounce: 0.3, stiffness: 120 }), duration: 700 }); }
  }, [activeMessages]);

  useEffect(() => { const h = (e) => { const b = e.target.closest('.input-btn.primary, .new-chat-btn, .overlay-submit'); if (!b) return; animate(b, { scale: [{ to: 0.9, duration: 80 }, { to: 1, ease: spring({ bounce: 0.6 }) }] }); }; document.addEventListener('click', h); return () => document.removeEventListener('click', h); }, []);

  const apiCall = useCallback(async (path, options = {}) => {
    const token = await getToken();
    return fetch(`${API_BASE}${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  }, [getToken]);

  const fetchAdminUsers = useCallback(async () => { try { const r = await apiCall("/api/admin/users"); setAdminUsers(await r.json() || []); } catch (e) { console.error(e.message); } }, [apiCall]);
  const fetchPlan = useCallback(async () => { try { const r = await apiCall("/api/user/plan"); setUserPlan((await r.json()).plan || "free"); } catch (e) { console.error(e.message); } }, [apiCall]);

  // A non-OK response here is not an error worth surfacing: it means billing
  // isn't configured, and the correct behaviour is to show no upgrade path.
  const fetchPrices = useCallback(async () => {
    try {
      const r = await apiCall("/api/billing/prices");
      if (!r.ok) return;
      setPrices(await r.json());
    } catch (e) { console.error(e.message); }
  }, [apiCall]);

  const startCheckout = useCallback(async (plan) => {
    setBillingBusy(true);
    try {
      const r = await apiCall("/api/create-checkout-session", { method: "POST", body: JSON.stringify({ plan }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || "Couldn't start checkout.");
      window.location.href = d.url;
      // Deliberately leaves billingBusy set — we are navigating away.
    } catch (e) { setToast(e.message); setBillingBusy(false); }
  }, [apiCall]);

  const openBillingPortal = useCallback(async () => {
    setBillingBusy(true);
    try {
      const r = await apiCall("/api/create-portal-session", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || "Couldn't open the billing portal.");
      window.location.href = d.url;
    } catch (e) { setToast(e.message); setBillingBusy(false); }
  }, [apiCall]);
  
  const createChat = useCallback(async () => {
    try { 
      const r = await apiCall("/api/chats", { method: "POST", body: JSON.stringify({ title: "New Chat" }) }); 
      const d = await r.json(); 
      setChats((p) => [d, ...p]); 
      setActiveChatId(d.id); 
      return d.id; 
    } catch (e) { setToast("Failed to create chat"); return null; } 
  }, [apiCall]);

  // Load existing chats only. The chat row is created lazily on the first
  // message (see handleSend/generateImage), so opening the app no longer
  // leaves an empty "New Chat" row behind on every page load.
  const loadChats = useCallback(async () => {
    try {
      const res = await apiCall("/api/chats");
      const chatData = await res.json();
      if (Array.isArray(chatData)) setChats(chatData);
    } catch (e) {
      console.error(e.message);
      setToast("Couldn't load your chats.");
    } finally {
      setIsInitialLoading(false);
    }
  }, [apiCall]);

  useEffect(() => { if (isLoaded && isSignedIn) { fetchPlan(); fetchPrices(); loadChats(); } }, [isLoaded, isSignedIn, fetchPlan, fetchPrices, loadChats]);

  // Stripe sends the customer back to `/?payment=success`, which nothing used
  // to read — a completed payment landed on an unchanged page with no
  // acknowledgement at all.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const payment = new URLSearchParams(window.location.search).get("payment");
    if (!payment) return;
    // Strip it straight away so a refresh doesn't replay the toast.
    window.history.replaceState({}, "", window.location.pathname);

    if (payment === "cancelled") { setToast("Checkout cancelled — you haven't been charged."); return; }
    if (payment !== "success") return;

    setToast("Payment received. Activating Pro...");
    // The webhook that flips the plan can land after this redirect, so reading
    // the plan once would often still say "free" to someone who just paid.
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 6 && !cancelled; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;
        try {
          const d = await (await apiCall("/api/user/plan")).json();
          if (d.plan === "pro") { setUserPlan("pro"); setToast("Pro is active — all 7 models unlocked."); return; }
        } catch (e) { console.error(e.message); }
      }
      if (!cancelled) setToast("Payment received. Pro will activate shortly.");
    })();
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, apiCall]);

  useEffect(() => { const c = async () => { if (!isSignedIn || !user?.emailAddresses?.[0]?.emailAddress) return; try { const r = await apiCall("/api/admin/users"); if (r.ok) { const u = await r.json(); const me = u.find((x) => x.email === user.emailAddresses[0].emailAddress); if (me?.is_admin) setIsAdmin(true); } } catch (e) { console.error(e.message); } }; if (isLoaded) c(); }, [isLoaded, user, isSignedIn, apiCall]);
  useEffect(() => { if (isAdmin && showAdmin) fetchAdminUsers(); }, [isAdmin, showAdmin, fetchAdminUsers]);

  const handleFeedback = useCallback(async (msgId, type) => {
    setFeedback((p) => ({ ...p, [msgId]: type }));
    try {
      const msg = activeMessages.find((m) => m.id === msgId); if (!msg) return;
      const idx = activeMessages.findIndex(m => m.id === msgId);
      const q = idx > 0 ? activeMessages[idx - 1]?.content : '';
      await apiCall('/api/feedback', { method: 'POST', body: JSON.stringify({ messageId: msgId, feedback: type, question: q, answer: msg.content }) });
      setToast(type === 'up' ? 'AI will learn from this good answer.' : 'Noted. AI will avoid this pattern.');
    } catch (e) { console.error(e.message); }
  }, [activeMessages, apiCall]);

  const updateChatMessages = useCallback(async (chatId, messages, saveToDb = true) => {
    setChats((p) => p.map((c) => (c.id === chatId ? { ...c, messages, updated_at: new Date().toISOString() } : c)));
    if (saveToDb) { try { await apiCall(`/api/chats/${chatId}`, { method: "PUT", body: JSON.stringify({ messages }) }); } catch (e) { console.error(e.message); } }
  }, [apiCall]);

  const deleteChat = useCallback(async (id) => { try { await apiCall(`/api/chats/${id}`, { method: "DELETE" }); setChats((p) => p.filter((c) => c.id !== id)); if (activeChatId === id) setActiveChatId(null); } catch (e) { console.error(e.message); } }, [apiCall, activeChatId]);
  const renameChat = useCallback(async (id, title) => { if (!title?.trim()) return; setChats((p) => p.map((c) => (c.id === id ? { ...c, title } : c))); try { await apiCall(`/api/chats/${id}`, { method: "PUT", body: JSON.stringify({ title }) }); } catch (e) { console.error(e.message); } }, [apiCall]);
  
  // Optimistic: flip locally so the sidebar responds instantly, then persist.
  // These used to be local-only, which is why pins silently vanished on reload.
  const toggleChatFlag = useCallback(async (id, field) => {
    const current = chats.find((c) => c.id === id);
    if (!current) return;
    const next = !current[field];
    setChats((p) => p.map((c) => (c.id === id ? { ...c, [field]: next } : c)));
    try {
      const res = await apiCall(`/api/chats/${id}`, { method: "PUT", body: JSON.stringify({ [field]: next }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setChats((p) => p.map((c) => (c.id === id ? { ...c, [field]: !next } : c)));
      setToast(`Couldn't save ${field === "pinned" ? "pin" : "favorite"}.`);
    }
  }, [chats, apiCall]);

  const togglePinChat = useCallback((id) => toggleChatFlag(id, "pinned"), [toggleChatFlag]);
  const toggleFavoriteChat = useCallback((id) => toggleChatFlag(id, "favorite"), [toggleChatFlag]);
  
  const sortedChats = useMemo(() => [...chats].sort((a, b) => { if (a.pinned !== b.pinned) return a.pinned ? -1 : 1; if (a.favorite !== b.favorite) return a.favorite ? -1 : 1; return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at); }), [chats]);
  
  const adminSuspend = useCallback(async (id) => { try { if ((await apiCall(`/api/admin/users/${id}/suspend`, { method: "POST" })).ok) { setToast("Suspended"); fetchAdminUsers(); } } catch (e) {} }, [apiCall, fetchAdminUsers]);
  const adminUnsuspend = useCallback(async (id) => { try { if ((await apiCall(`/api/admin/users/${id}/unsuspend`, { method: "POST" })).ok) { setToast("Unsuspended"); fetchAdminUsers(); } } catch (e) {} }, [apiCall, fetchAdminUsers]);
  const adminDeleteUser = useCallback(async (id) => { if (!confirm("DELETE this user?")) return; try { if ((await apiCall(`/api/admin/users/${id}`, { method: "DELETE" })).ok) { setToast("Deleted"); fetchAdminUsers(); } } catch (e) {} }, [apiCall, fetchAdminUsers]);

  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setToast("Only images can be attached."); return; }
    try {
      setAttachedImage(await fileToDataUrl(file));
    } catch (err) {
      setToast(err.message);
    }
  }, []);
  const startCamera = useCallback(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); cameraStreamRef.current = s; setShowCamera(true); setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100); } catch { setToast("Camera denied"); } }, [setToast]);
  const stopCamera = useCallback(() => { if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach((t) => t.stop()); cameraStreamRef.current = null; } setShowCamera(false); }, []);
  // This used to end in `c.toBlob((b) => { stopCamera(); })` — the frame was
  // drawn, handed to a callback, and thrown away. The whole capture UI did
  // nothing. toDataURL is what the overlay's screen capture already uses.
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current, c = canvasRef.current;
    if (!v.videoWidth) { setToast("Camera isn't ready yet."); return; }
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    setAttachedImage(c.toDataURL("image/jpeg", 0.85));
    stopCamera();
  }, [stopCamera]);
  
  const stopListening = useCallback(() => { if (listenTimerRef.current) clearTimeout(listenTimerRef.current); if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; } setIsListening(false); }, []);
  const startListening = useCallback(() => { const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { setToast("Needs Chrome/Edge/Safari"); return; } const r = new SR(); r.continuous = false; r.interimResults = false; r.lang = "en-US"; r.onstart = () => { setIsListening(true); listenTimerRef.current = setTimeout(() => { try { r.stop(); } catch {} }, 10000); }; r.onend = () => { setIsListening(false); if (listenTimerRef.current) clearTimeout(listenTimerRef.current); recognitionRef.current = null; }; r.onresult = (e) => { let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; if (t.trim()) { const i = document.querySelector('.input-text'); if (i) { i.value += t + " "; i.dispatchEvent(new Event('input', { bubbles: true })); } } }; r.onerror = () => setIsListening(false); r.start(); recognitionRef.current = r; }, [setToast]);
  const toggleListening = useCallback(() => { if (isListening) stopListening(); else startListening(); }, [isListening, stopListening, startListening]);

  const generateImage = useCallback(async (promptText) => {
    const imagePrompt = parseImagePrompt(promptText) || promptText; if (!imagePrompt) { setToast("Describe image"); return; }
    let chatId = activeChatId; if (!chatId) chatId = await createChat(); if (!chatId) return;
    const userMsg = { role: "user", content: `Generate image: ${imagePrompt}`, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), id: uid() };
    const withUser = [...(activeMessages || []), userMsg]; await updateChatMessages(chatId, withUser);
    if ((activeMessages || []).length === 0) { const t = generateChatTitle(imagePrompt); if (t) renameChat(chatId, t); }
    await updateChatMessages(chatId, [...withUser, { role: "assistant", content: "", imageUrl: buildImageUrl(imagePrompt), imagePrompt, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), id: uid() }]);
  }, [activeChatId, activeMessages, createChat, renameChat, updateChatMessages]);

  // There was no way to stop a running generation. abortRef existed but was
  // only ever used to cancel the previous request when a new one started, so a
  // long or wrong answer had to be waited out in full.
  const stopGeneration = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const handleSend = useCallback(async (text) => {
    const cleanText = text.trim();
    // An attached image means "look at this", never "draw me one".
    if (!attachedImage && isImageRequest(cleanText)) { generateImage(cleanText); return; }
    if (!cleanText || status !== "idle") return;
    let chatId = activeChatId; if (!chatId) chatId = await createChat(); if (!chatId) return;

    const image = attachedImage;
    setAttachedImage(null);
    setStatus("loading");
    // imagePreview is local-only: the server whitelist keeps hasImage and drops
    // it, so a reloaded chat shows the marker without storing megabytes per row.
    const userMsg = { role: "user", content: cleanText, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), id: uid(), ...(image ? { hasImage: true, imagePreview: image } : {}) };
    const updated = [...activeMessages, userMsg]; 
    await updateChatMessages(chatId, updated);
    
    if (activeMessages.length === 0 && cleanText) { const t = generateChatTitle(cleanText); if (t) renameChat(chatId, t); }
    
    const assistantId = uid();
    const assistantMsg = { role: "assistant", content: "", typing: true, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), id: assistantId };
    updateChatMessages(chatId, [...updated, assistantMsg], false);
    
    const cleanHistory = activeMessages.filter(m => m.content && m.content.trim() && !m.typing).slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    // Hoisted so the catch can persist whatever streamed before an abort.
    // Discarding it would throw away text the user already watched arrive.
    let acc = "";

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/council`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: cleanText, history: cleanHistory, chatId, ...(image ? { image } : {}) }), signal: abortRef.current.signal });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Server error: ${res.status}`); }
      if (!res.body) throw new Error("No stream");
      
      setStatus("streaming");
      updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: "" }], false);
      
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ""; let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data: ")) continue;
          const j = t.slice(6).trim();
          if (j === "[DONE]") { streamDone = true; break; }
          // A frame that isn't valid JSON is a transport artifact, not a failure
          // worth aborting the whole response for — skip it and keep reading.
          let d; try { d = JSON.parse(j); } catch { continue; }
          if (d.type === 'chunk') acc += d.text;
          else if (d.type === 'error') throw new Error(d.text);
        }
        setChats((p) => p.map((c) => (c.id === chatId ? { ...c, messages: [...updated, { ...assistantMsg, typing: false, content: acc }] } : c)));
      }
      await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc }]);
      setStatus("idle");
    } catch (err) {
      if (err.name === "AbortError") {
        // Two things this used to get wrong. It returned without resetting
        // status, which left the composer disabled forever once a user-facing
        // Stop existed; and it dropped `acc`, discarding text already on screen.
        if (acc.trim()) {
          await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc, stopped: true }]);
        } else {
          await updateChatMessages(chatId, updated);
        }
        setStatus("idle");
        return;
      }
      setStatus("error");
      await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: `⚠️ ${err.message || "Connection failed"}` }]); 
    }
  }, [activeChatId, activeMessages, status, generateImage, createChat, renameChat, updateChatMessages, getToken, attachedImage]);

  // Re-run the last exchange. Drops the previous answer and everything after
  // it, then replays the user's message — so a bad answer can be retried
  // without retyping, and without leaving the stale reply in the transcript.
  const regenerateLast = useCallback(async () => {
    if (status !== "idle") return;
    const lastUserIdx = [...activeMessages].map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;
    const prompt = activeMessages[lastUserIdx].content;
    if (!prompt?.trim()) return;
    await updateChatMessages(activeChatId, activeMessages.slice(0, lastUserIdx));
    handleSend(prompt);
  }, [status, activeMessages, activeChatId, updateChatMessages, handleSend]);

  const exportChat = useCallback(() => {
    if (!activeMessages.length) { setToast("Nothing to export yet."); return; }
    const title = activeChat?.title || "ALOP-AI chat";
    const body = activeMessages
      .filter((m) => m.content?.trim())
      .map((m) => `### ${m.role === "user" ? "You" : "ALOP-AI"}${m.ts ? ` · ${m.ts}` : ""}\n\n${m.content}`)
      .join("\n\n---\n\n");
    const md = `# ${title}\n\n_Exported ${new Date().toLocaleString()}_\n\n${body}\n`;
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w\s-]/g, "").trim().slice(0, 60) || "chat"}.md`;
    a.click();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setToast("Chat exported.");
  }, [activeMessages, activeChat]);

  const paletteActions = useMemo(() => [
    { id: "new", label: "New chat", hint: "Ctrl N", icon: "✚", run: () => createChat() },
    { id: "regen", label: "Regenerate last answer", hint: "Chat", icon: "↻", run: regenerateLast },
    { id: "export", label: "Export chat as Markdown", hint: "Chat", icon: "⭳", run: exportChat },
    { id: "theme", label: darkMode ? "Switch to Bamboo Day" : "Switch to Sakura Night", hint: "Appearance", icon: darkMode ? "☀" : "☾", run: () => setDarkMode((d) => !d) },
    { id: "settings", label: "Open settings", hint: "App", icon: "⚙", run: () => { setShowSettings(true); setShowAdmin(false); setShowUpgrade(false); } },
    ...(userPlan !== "pro" && prices ? [{ id: "upgrade", label: "Upgrade to Pro", hint: "Billing", icon: "♛", run: () => { setShowUpgrade(true); setShowSettings(false); } }] : []),
  ], [createChat, regenerateLast, exportChat, darkMode, userPlan, prices]);

  // Ctrl/Cmd-K from anywhere. Capture phase so it still fires while focus is
  // in the composer, where keydown is otherwise handled locally.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((p) => !p);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); createChat(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [createChat]);

  if (!isLoaded) return null;
  if (isInitialLoading) return <AppSkeleton />;
  
  return (
    <div className={`app-root ${darkMode ? "dark" : "light"}`}>
      <div className="bg-layer" />
      <div className="bg-overlay" />
       <Earring side="left" />
      <Earring side="right" />

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        chats={sortedChats}
        actions={paletteActions}
        onSelectChat={setActiveChatId}
      />

      {toast && <div className="toast">{toast}</div>}
      {showCamera && <div className="camera-overlay"><video ref={videoRef} autoPlay className="camera-video" /><canvas ref={canvasRef} style={{ display: "none" }} /><div className="camera-controls"><button onClick={capturePhoto} className="camera-btn primary">Capture</button><button onClick={stopCamera} className="camera-btn secondary">Cancel</button></div></div>}
      
      <div className="app-shell">
        <header className="app-header">
          <button className="icon-btn mobile-only" onClick={() => setMobileSidebarOpen(true)} title="Chats"><Icon name="menu" size={20} /></button>
          <button className="icon-btn desktop-only" onClick={() => setSidebarCollapsed((c) => !c)} title="Chats"><Icon name="menu" size={20} /></button>
          <div className="brand"><img src="/logo.png" alt="" className="header-logo" /><div className="brand-text"><h1 className="main-title">{activeChat?.title || "ALOP-AI"}</h1><span className="sub-title">AI Council • {userPlan === "pro" ? "7 models" : "4 models"} • Precision • Learning</span></div></div>
          <div className="header-actions">
            <button className="cmdk-trigger desktop-only" onClick={() => setShowPalette(true)} title="Search chats and commands (Ctrl+K)" aria-label="Search chats and commands">
              <Icon name="search" size={14} /> <span>Search</span> <kbd>Ctrl K</kbd>
            </button>
            {userPlan !== "pro" && prices && <MagneticButton className="upgrade-btn" onClick={() => { setShowUpgrade(true); setShowSettings(false); setShowAdmin(false); }} ariaLabel="Upgrade to Pro"><Icon name="crown" size={14} /> Upgrade</MagneticButton>}
            {isAdmin && <MagneticButton className={`icon-btn admin-btn ${showAdmin ? "active" : ""}`} onClick={() => { setShowAdmin((s) => !s); setShowSettings(false); setShowUpgrade(false); }} ariaLabel="Admin"><Icon name="crown" size={20} /></MagneticButton>}
            <MagneticButton className="icon-btn" onClick={() => setDarkMode((d) => !d)} ariaLabel="Theme"><Icon name={darkMode ? "sun" : "moon"} size={20} /></MagneticButton>
            <MagneticButton className="icon-btn" onClick={() => { setShowSettings((s) => !s); setShowAdmin(false); setShowUpgrade(false); }} ariaLabel="Settings"><Icon name="settings" size={20} /></MagneticButton>
          </div>
        </header>
        
        <div className="app-body">
          <ChatSidebar chats={sortedChats} activeChatId={activeChatId} onSelect={setActiveChatId} onCreate={createChat} onDelete={deleteChat} onRename={renameChat} onPin={togglePinChat} onFavorite={toggleFavoriteChat} collapsed={sidebarCollapsed} mobileOpen={mobileSidebarOpen} setMobileOpen={setMobileSidebarOpen} />
          <div className="chat-main">
            {showAdmin && isAdmin && (<><div className="panel-overlay" onClick={() => setShowAdmin(false)} /><div className="side-panel"><div className="panel-header"><div className="panel-title">Admin Dashboard</div><button onClick={() => setShowAdmin(false)} className="icon-btn"><Icon name="close" size={18} /></button></div><div className="panel-body"><div className="admin-title">{adminUsers.length} Users</div>{adminUsers.map((u) => (<div key={u.id} className="admin-user-card"><div className="admin-user-header"><img src={u.avatar_url || "https://via.placeholder.com/36"} alt="" className="admin-avatar" /><div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{u.name || "Anonymous"}</div><div style={{ fontSize: 11, color: "var(--text-subtle)" }}>{u.email || "No email"}</div></div><span className={`admin-badge ${u.plan === "pro" ? "pro" : "free"}`}>{u.plan || "free"}</span>{u.is_admin && <span className="admin-badge admin">Admin</span>}</div><div className="msg-actions" style={{ justifyContent: "flex-start", marginTop: 8, opacity: 1 }}>{u.suspended ? <button onClick={() => adminUnsuspend(u.id)} className="msg-action-btn">Unsuspend</button> : <button onClick={() => adminSuspend(u.id)} className="msg-action-btn">Suspend</button>}<button onClick={() => adminDeleteUser(u.id)} className="msg-action-btn" style={{ color: "var(--danger)" }}>Delete</button></div></div>))}</div></div></>)}
            {showUpgrade && prices && (<><div className="panel-overlay" onClick={() => setShowUpgrade(false)} /><div className="side-panel"><div className="panel-header"><div className="panel-title">Upgrade to Pro</div><button onClick={() => setShowUpgrade(false)} className="icon-btn"><Icon name="close" size={18} /></button></div><div className="panel-body">
              <div className="plan-grid">
                <div className="plan-col">
                  <div className="plan-name">Free</div>
                  <ul className="plan-feats"><li>4 models in the council</li><li>Image generation</li><li>Voice input</li><li>Vision &amp; screen analysis</li></ul>
                </div>
                <div className="plan-col is-pro">
                  <div className="plan-name">Pro <span className="plan-badge">Recommended</span></div>
                  <ul className="plan-feats"><li><strong>All 7 models</strong>, including DeepSeek, Nemotron and MiniMax</li><li>Higher-quality vision model</li><li>Everything in Free</li></ul>
                </div>
              </div>
              <div className="plan-buttons">
                <button className="plan-buy" disabled={billingBusy} onClick={() => startCheckout("monthly")}>{billingBusy ? "Opening checkout..." : `Monthly — ${formatPrice(prices.monthly)}`}</button>
                <button className="plan-buy is-secondary" disabled={billingBusy} onClick={() => startCheckout("yearly")}>{billingBusy ? "Opening checkout..." : `Yearly — ${formatPrice(prices.yearly)}`}</button>
              </div>
              <div className="plan-note">Secure checkout by Stripe. Cancel any time.</div>
            </div></div></>)}
            {showSettings && (<><div className="panel-overlay" onClick={() => setShowSettings(false)} /><div className="side-panel"><div className="panel-header"><div className="panel-title">Settings</div><button onClick={() => setShowSettings(false)} className="icon-btn"><Icon name="close" size={18} /></button></div><div className="panel-body"><div className="setting-row"><div className="setting-label">Appearance</div><div className={`theme-toggle ${darkMode ? "active" : ""}`} onClick={() => setDarkMode((d) => !d)}><span className="theme-toggle-label">{darkMode ? "Sakura Night" : "Bamboo Day"}</span><div className="theme-toggle-switch" /></div></div><div className="setting-row"><button onClick={() => activeChatId && deleteChat(activeChatId)} className="theme-card">Delete Chat</button></div>{userPlan === "pro" && <div className="setting-row"><button onClick={openBillingPortal} disabled={billingBusy} className="theme-card" style={{ width: "100%" }}>{billingBusy ? "Opening..." : "Manage subscription"}</button></div>}{userPlan !== "pro" && prices && <div className="setting-row"><button onClick={() => { setShowSettings(false); setShowUpgrade(true); }} className="theme-card" style={{ width: "100%" }}>Upgrade to Pro</button></div>}<div className="setting-row"><SignOutButton><button className="theme-card" style={{ width: "100%" }}>Sign Out</button></SignOutButton></div></div></div></>)}
            
            <div className="chat-content">
              <div
                className="scroll-wrapper"
                ref={chatRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  // Same 150px threshold the auto-scroll uses, so the button
                  // appears exactly when following stops.
                  setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 150);
                }}
              >
                {activeMessages.length === 0 && status === "idle" && (
                  <div className="empty-state">
                    <img src="/logo.png" alt="ALOP-AI" className="empty-logo" />
                    <h2 className="empty-title text-shimmer">ALOP-AI</h2>
                    <p className="empty-subtitle">Ask the AI Council anything. Multiple models work together, debate, then answer. It learns from your feedback.</p>
                    {/* A blank page is the hardest prompt to answer. These are
                        one click to a real reply, and each one exercises a
                        different capability so the council gets shown off. */}
                    <div className="starter-grid">
                      {STARTERS.map((s) => (
                        <button key={s.prompt} className="starter-card" onClick={() => handleSend(s.prompt)}>
                          <span className="starter-icon" aria-hidden="true">{s.icon}</span>
                          <span className="starter-label">{s.label}</span>
                          <span className="starter-prompt">{s.prompt}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {activeMessages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`msg-row ${msg.role}`}>
                    <div className="avatar">{msg.role === "user" ? "YOU" : "AI"}</div>
                    <div className="msg-content">
                      {/* imagePreview only exists in this session; after a reload
                          the hasImage flag survives but the bytes deliberately do not. */}
                      {msg.hasImage && (msg.imagePreview
                        ? <img className="msg-attachment" src={msg.imagePreview} alt="Attached" />
                        : <div className="msg-attachment-placeholder"><Icon name="image" size={13} /> Image attached</div>)}
                      {msg.typing ? (
                        <div className="bubble typing-bubble">
                          <span className="typing-dot"></span>
                          <span className="typing-dot"></span>
                          <span className="typing-dot"></span>
                        </div>
                      ) : msg.content ? (
                        <div className="bubble markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{msg.content}</ReactMarkdown>
                        </div>
                      ) : null}
                      {msg.imageUrl && (
                        <div style={{ marginTop: 8 }}>
                          <img src={msg.imageUrl} alt="Generated" style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: "var(--radius-lg)", cursor: "pointer" }} onClick={() => window.open(msg.imageUrl, "_blank")} />
                          <div className="msg-meta" style={{ textAlign: "left" }}>{msg.imagePrompt}</div>
                        </div>
                      )}
                      {msg.role === "assistant" && msg.content && !msg.imageUrl && !msg.typing && (
                        <MessageActions content={msg.content} onCopy={() => navigator.clipboard.writeText(msg.content)} msgId={msg.id} onFeedback={handleFeedback} feedback={feedback[msg.id]} />
                      )}
                      <div className="msg-meta">{msg.ts}</div>
                    </div>
                  </div>
                ))}
              </div>
              {showScrollDown && (
                <button
                  className="scroll-down-btn"
                  onClick={() => { if (chatRef.current) chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }}
                  title="Jump to latest"
                  aria-label="Jump to latest message"
                >
                  <Icon name="arrowDown" size={16} />
                </button>
              )}
              {activeMessages.length > 0 && status === "idle" && (
                <div className="chat-toolbar">
                  <button className="chat-toolbar-btn" onClick={regenerateLast} title="Regenerate the last answer"><Icon name="refresh" size={13} /> Regenerate</button>
                  <button className="chat-toolbar-btn" onClick={exportChat} title="Download this chat as Markdown"><Icon name="download" size={13} /> Export</button>
                </div>
              )}
              <InputBar onSend={handleSend} disabled={status !== "idle"} onFileSelect={handleFileSelect} onStartCamera={startCamera} isListening={isListening} toggleListening={toggleListening} attachedImage={attachedImage} onClearAttachment={() => setAttachedImage(null)} isGenerating={status === "loading" || status === "streaming"} onStop={stopGeneration} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AuthenticatedAppWrapper = () => { 
  const { isSignedIn, isLoaded } = useUser(); 
  if (!isLoaded) return <InitialLoader />; 
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
    const h = (e) => { if (e.key === 'Escape' && window.alopHideOverlay) window.alopHideOverlay(); }; 
    const f = () => inputRef.current?.focus(); 
    window.addEventListener('keydown', h); 
    window.addEventListener('alop-focus', f); 
    return () => { 
      window.removeEventListener('keydown', h); 
      window.removeEventListener('alop-focus', f); 
      stopRecording(); 
      stopSpeaking(); 
      stopLiveStream(); 
    }; 
  }, []);

  const stopSpeaking = () => { window.speechSynthesis.cancel(); setIsSpeaking(false); };
  const speak = (text) => { if (!text) return; stopSpeaking(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.15; u.onend = () => setIsSpeaking(false); window.speechSynthesis.speak(u); setIsSpeaking(true); };
  const stopRecording = () => { if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; } setIsRecording(false); };
  const toggleRecording = () => { 
    if (isRecording) { stopRecording(); return; } 
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; 
    if (!SR) { alert('Needs Chrome/Edge'); return; } 
    const r = new SR(); 
    r.continuous = false; r.interimResults = false; r.lang = 'en-US'; 
    r.onstart = () => setIsRecording(true); 
    r.onend = () => { setIsRecording(false); recognitionRef.current = null; }; 
    r.onresult = (e) => { setQuery((p) => p + e.results[0][0].transcript + ' '); inputRef.current?.focus(); }; 
    r.onerror = () => setIsRecording(false); 
    r.start(); recognitionRef.current = r; 
  };
  
  const stopLiveStream = () => { if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; videoRef.current = null; } setLiveActive(false); };
  const startLiveStream = async () => { 
    try { 
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false }); 
      s.getVideoTracks()[0].onended = () => stopLiveStream(); 
      const v = document.createElement('video'); 
      v.srcObject = s; 
      v.play(); 
      streamRef.current = s; 
      videoRef.current = v; 
      setLiveActive(true); 
    } catch (e) { console.error(e); } 
  };
  
  const captureFromLiveStream = async () => { 
    if (!videoRef.current || !streamRef.current) return null; 
    await new Promise((r) => setTimeout(r, 150)); 
    const v = videoRef.current; 
    const c = document.createElement('canvas'); 
    c.width = v.videoWidth || 1920; 
    c.height = v.videoHeight || 1080; 
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); 
    return c.toDataURL('image/png'); 
  };
  
  const handleFile = (e) => { const f = e.target.files[0]; if (!f || !f.type.startsWith('image/')) return; const r = new FileReader(); r.onload = () => setAttachment(r.result); r.readAsDataURL(f); e.target.value = ''; };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim() || status === 'loading') return;
    setStatus('loading');
    let image = null;
    if (liveActive) { image = await captureFromLiveStream(); }
    const body = { prompt: query, image: image || attachment || undefined };
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in to use the overlay.');
      const res = await fetch(`${API_BASE}/api/overlay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(res.status === 401 ? 'Session expired — please sign in again.' : `Error: ${res.status}`);
      const data = await res.json();
      setAnswer(data.answer || 'No answer');
      setStatus('done'); setAttachment(null); setQuery('');
      speak(data.answer);
    } catch (err) { setStatus('error'); setAnswer(`Error: ${err.message}`); }
  };

  return (
    <Draggable handle=".overlay-drag-handle">
      <div className="overlay-root">
        <div className="overlay-answer-stack">
          {answer && (
            <div className="overlay-answer-card">
              <div className="overlay-answer-text markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{answer}</ReactMarkdown>
              </div>
              <button className="overlay-tts-btn" onClick={() => isSpeaking ? stopSpeaking() : speak(answer)}>
                {isSpeaking ? '■' : '▶'}
              </button>
            </div>
          )}
        </div>
        {attachment && <div className="overlay-thumb-pill">Image attached<button onClick={() => setAttachment(null)}>×</button></div>}
        <form className="overlay-bar" onSubmit={handleSubmit}>
          <div className="overlay-drag-handle" title="Drag to move">⠿</div>
          <div className={`overlay-icon ${liveActive ? 'live' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v14a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
          </div>
          <input ref={inputRef} className="overlay-input" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={liveActive ? "Live screen active. Ask anything..." : "Ask anything... (click ● for screen)"} disabled={status === 'loading'} />
          <button type="button" className={`overlay-action ${liveActive ? 'recording' : ''}`} onClick={liveActive ? stopLiveStream : startLiveStream} title={liveActive ? 'Stop live screen' : 'Start live screen'} disabled={status === 'loading'}>●</button>
          <label className="overlay-action" title="Attach image"><input type="file" accept="image/*" className="overlay-file-input" onChange={handleFile} disabled={status === 'loading'} />+</label>
          <button type="button" className={`overlay-action ${isRecording ? 'recording' : ''}`} onClick={toggleRecording} disabled={status === 'loading'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
          </button>
          <button className="overlay-submit" type="submit" disabled={status === 'loading' || (!query.trim() && !attachment)}>{status === 'loading' ? '...' : '→'}</button>
        </form>
      </div>
    </Draggable>
  );
};

const App = () => {
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const isOverlay = typeof window !== 'undefined' && (window.location.search.includes('overlay=true') || window.location.hash.includes('overlay') || window.location.href.includes('overlay=true'));
  return (
    <ClerkProvider publishableKey={clerkKey} signInUrl="/" signUpUrl="/" afterSignInUrl="/" afterSignUpUrl="/" appearance={{ baseTheme: "dark", variables: { colorPrimary: "#ec7d96", colorBackground: "#1b120c", colorText: "#faf0e6" } }}>
      <div style={{ width: "100vw", height: "100dvh" }}>
        {isOverlay ? <OverlayAssistant /> : <AuthenticatedAppWrapper />}
      </div>
    </ClerkProvider>
  );
};

export default App;
