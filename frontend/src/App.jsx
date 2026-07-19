import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ClerkProvider, SignIn, useUser, useAuth } from "@clerk/react";

const uid = () => crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);
const API_BASE = import.meta.env.VITE_API_BASE || "https://alop-ai.onrender.com";

const Storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};

const MODELS = {
  fast: [
    { key: "glm-5.2", name: "GLM 5.2" },
    { key: "glm-5.1", name: "GLM 5.1" },
    { key: "deepseek-v4-flash", name: "DeepSeek Flash" }
  ],
  reasoning: [
    { key: "gemma4:31b", name: "Gemma 4" },
    { key: "qwen3.5:397b", name: "Qwen 3.5" },
    { key: "minimax-m2.7", name: "MiniMax M2.7" },
    { key: "minimax-m2.5", name: "MiniMax M2.5" },
    { key: "minimax-m3", name: "MiniMax M3" },
    { key: "nemotron-3-super", name: "Nemotron Super" },
    { key: "nemotron-3-ultra", name: "Nemotron Ultra" },
    { key: "nemotron-3-nano:30b", name: "Nemotron Nano" },
    { key: "kimi-k2.7-code", name: "Kimi K2.7" },
    { key: "kimi-k2.6", name: "Kimi K2.6" },
    { key: "kimi-k2.5", name: "Kimi K2.5" },
    { key: "deepseek-v4-pro", name: "DeepSeek Pro" },
    { key: "gpt-oss:20b", name: "GPT-OSS 20B" },
    { key: "gpt-oss:120b", name: "GPT-OSS 120B" },
    { key: "mistral-large-3:675b", name: "Mistral Large 3" }
  ]
};

const getModelDisplayName = (k) => [...MODELS.fast, ...MODELS.reasoning].find(m => m.key === k)?.name || k;

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

const Icon = ({ name, size = 18 }) => {
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
    warning: <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    pin: <g><path d="M12 2v8M5 12a7 7 0 0 1 14 0v0a7 7 0 0 1-7 7h0a7 7 0 0 1-7-7v0z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    refresh: <g><path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M20.49 9A9 9 0 1 0 5.64 15.36" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />,
    download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    brain: <g><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-5 0v-1M12 4.5A2.5 2.5 0 0 1 14.5 2a2.5 2.5 0 0 1 2.5 2.5v1M12 19.5a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5v-1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    volume: <path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    volumeX: <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    image: <g><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" strokeWidth="2" fill="none" /><circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>,
    crown: <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>{icons[name] || null}</svg>;
};

const buildImageUrl = (prompt) => {
  const enhanced = `${prompt}, professional photography, 8k uhd, highly detailed, sharp focus, cinematic lighting, masterpiece, best quality, ultra realistic`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}?width=1024&height=1024&nologo=true&model=flux&seed=${Math.floor(Math.random()*1e7)}&enhance=true`;
};

const isImageRequest = (text) => {
  const t = text.trim().toLowerCase();
  return t.startsWith("/image") ||
    /\b(generate|create|make|draw|produce|render|design)\s+(an?\s+|the\s+|some\s+)?(image|picture|photo|artwork|illustration|drawing|painting|render|scene|portrait|landscape|wallpaper)\b/.test(t) ||
    /\b(draw|paint|sketch|generate|create|make)\s+(me\s+|us\s+)?(a|an|the|this|that|some)?\s*(image|picture|photo|drawing|painting|illustration|art|scene|portrait|landscape|wallpaper|logo|icon)\b/.test(t) ||
    /\b(image|picture|photo)\s+(of|showing|with|for|about)\b/.test(t);
};

const parseImagePrompt = (text) => {
  return text.replace(/^\/image\s*/i, "")
    .replace(/\b(can\s+you\s+)?(please\s+)?(generate|create|make|draw|produce|render|design)\s+(me\s+|us\s+)?(an?\s+|the\s+|some\s+)?(image|picture|photo|artwork|illustration|drawing|painting|render|scene|portrait|landscape|wallpaper)\s*(of\s*|for\s*|with\s*|showing\s*|about\s*)?/i, "")
    .replace(/\b(draw|paint|sketch|generate|create|make)\s+(me\s+|us\s+)?(a|an|the|this|that|some)?\s*(image|picture|photo|drawing|painting|illustration|art|scene|portrait|landscape|wallpaper|logo|icon)\s*(of\s*|for\s*|with\s*|showing\s*|about\s*)?/i, "")
    .replace(/\b(image|picture|photo)\s+(of|showing|with|for|about)\s*/i, "")
    .trim();
};

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    html, body, #root { height: 100%; min-height: 100dvh; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #0a0a0a; -webkit-font-smoothing: antialiased; overflow: hidden; }
    .app-root { width: 100vw; height: 100vh; height: 100dvh; display: flex; flex-direction: column; position: relative; overflow: hidden; }
    .bg-layer { position: absolute; inset: 0; z-index: 1; background-size: cover; background-position: center; background-repeat: no-repeat; }
    .bg-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
    .app-shell { position: relative; z-index: 10; width: 100%; height: 100%; display: flex; flex-direction: column; padding-bottom: env(safe-area-inset-bottom); }
    .app-header { flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: transparent; min-height: 56px; }
    .brand { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .main-title { font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub-title { font-size: 10px; color: rgba(255,255,255,.45); letter-spacing: .5px; text-transform: uppercase; }
    .header-actions { display: flex; gap: 4px; align-items: center; }
    .icon-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.35); color: rgba(255,255,255,.7); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .15s; flex-shrink: 0; }
    .icon-btn:hover { background: rgba(0,0,0,0.55); color: #fff; }
    .icon-btn.active { background: var(--primary); color: #000; border-color: transparent; }
    .admin-btn { background: rgba(251, 191, 36, 0.2); color: #fbbf24; border-color: rgba(251, 191, 36, 0.3); }
    .admin-btn:hover { background: rgba(251, 191, 36, 0.3); }
    .admin-title { font-size: 20px; font-weight: 800; margin-bottom: 20px; color: #fff; }
    .admin-user-card { padding: 14px; borderRadius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 10px; }
    .admin-user-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .admin-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
    .admin-user-name { font-weight: 700; color: #fff; }
    .admin-user-email { font-size: 12px; color: rgba(255,255,255,.5); }
    .admin-badge { padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; text-transform: uppercase; margin-left: auto; }
    .admin-badge.pro { background: rgba(139, 92, 246, 0.2); color: #8b5cf6; }
    .admin-badge.free { background: rgba(255,255,255,.1); color: rgba(255,255,255,.6); }
    .admin-badge.admin { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
    .admin-stats { display: flex; gap: 16px; font-size: 12px; color: rgba(255,255,255,.5); margin-top: 6px; }
    .app-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }
    .chat-sidebar { width: 260px; flex-shrink: 0; border-right: 1px solid var(--border); background: rgba(0,0,0,0.85); display: flex; flex-direction: column; overflow: hidden; }
    .chat-sidebar.collapsed { width: 0; border-right: none; overflow: hidden; }
    .chat-sidebar.mobile { position: fixed; left: 0; top: 0; bottom: 0; z-index: 100; transform: translateX(-100%); transition: transform .25s ease; }
    .chat-sidebar.mobile.open { transform: translateX(0); }
    .sidebar-header { padding: 12px; border-bottom: 1px solid var(--border); }
    .sidebar-btn { width: 100%; height: 40px; border-radius: 10px; border: none; background: var(--primary); color: #000; cursor: pointer; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .sidebar-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 5px; }
    .sidebar-section { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.3); text-transform: uppercase; letter-spacing: 1px; margin: 6px 4px 4px 4px; }
    .sidebar-item { padding: 10px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 8px; border: 1px solid transparent; position: relative; }
    .sidebar-item:hover { background: rgba(255,255,255,.05); border-color: var(--border); }
    .sidebar-item.active { background: rgba(255,255,255,.08); border-color: var(--primary); }
    .sidebar-icon { width: 28px; height: 28px; border-radius: 7px; background: rgba(255,255,255,.06); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: rgba(255,255,255,.4); flex-shrink: 0; }
    .sidebar-title { flex: 1; font-size: 13px; color: rgba(255,255,255,.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sidebar-meta { font-size: 10px; color: rgba(255,255,255,.35); }
    .sidebar-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .2s; position: absolute; right: 6px; background: rgba(0,0,0,0.7); border-radius: 6px; padding: 2px; }
    .sidebar-item:hover .sidebar-actions { opacity: 1; }
    .chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .chat-content { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .scroll-wrapper { flex: 1; overflow-y: auto; padding: 14px 14px 110px 14px; display: flex; flex-direction: column; gap: 10px; }
    .msg-row { display: flex; gap: 8px; max-width: 92%; }
    .msg-row.user { align-self: flex-end; flex-direction: row-reverse; }
    .msg-row.assistant { align-self: flex-start; }
    .avatar { width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; background: rgba(255,255,255,.06); color: rgba(255,255,255,.5); flex-shrink: 0; }
    .bubble { padding: 10px 14px; border-radius: 12px; font-size: 15px; line-height: 1.5; word-break: break-word; max-width: 100%; }
    .msg-row.user .bubble { background: rgba(139, 92, 246, 0.85); color: #fff; border-bottom-right-radius: 4px; }
    .msg-row.assistant .bubble { background: rgba(0, 0, 0, 0.6); color: rgba(255,255,255,.95); border: 1px solid rgba(255,255,255,0.08); border-bottom-left-radius: 4px; }
    .msg-actions { display: flex; gap: 4px; margin-top: 4px; justify-content: flex-end; opacity: 0; transition: opacity .2s; }
    .msg-row:hover .msg-actions { opacity: 1; }
    .msg-action-btn { padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.4); color: rgba(255,255,255,.6); font-size: 11px; cursor: pointer; }
    .msg-action-btn:hover { background: rgba(0,0,0,0.6); color: #fff; }
    .msg-meta { font-size: 10px; color: rgba(255,255,255,.25); margin-top: 3px; text-align: right; }
    .empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; padding: 30px 16px; }
    .empty-title { font-size: 32px; font-weight: 800; color: #fff; }
    .empty-subtitle { color: rgba(255,255,255,.45); font-size: 15px; max-width: 320px; line-height: 1.5; }
    .empty-subtitle strong { color: var(--primary); }
    .input-area { flex-shrink: 0; padding: 10px 12px 24px 12px; background: transparent; }
    .input-area-inner { max-width: 850px; margin: 0 auto; display: flex; gap: 6px; align-items: center; }
    .input-field { flex: 1; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.4); color: #fff; font-size: 15px; outline: none; caret-color: var(--primary); min-width: 0; }
    .input-field:focus { border-color: var(--primary); background: rgba(0,0,0,0.55); }
    .send-btn { padding: 0 16px; height: 44px; border-radius: 12px; border: none; cursor: pointer; background: var(--primary); color: #000; font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .send-btn:disabled { background: rgba(255,255,255,.06); color: rgba(255,255,255,.25); cursor: not-allowed; }
    .side-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 340px; max-width: 85vw; background: #0f0f12; border-left: 1px solid rgba(255,255,255,0.08); padding: 16px; z-index: 100; overflow-y: auto; }
    .panel-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,0.5); }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .panel-title { font-size: 12px; font-weight: 800; color: rgba(255,255,255,.7); text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
    .memory-card { padding: 14px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 12px; }
    .memory-card-title { font-size: 13px; font-weight: 700; color: rgba(255,255,255,.8); margin-bottom: 10px; }
    .custom-input { width: 100%; padding: 10px 12px; borderRadius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,.04); color: #fff; font-size: 13px; outline: none; }
    .custom-input:focus { border-color: var(--primary); }
    .textarea { min-height: 80px; resize: vertical; font-family: inherit; line-height: 1.5; }
    .setting-row { margin-bottom: 14px; display: flex; flex-direction: column; gap: 8px; }
    .setting-label { color: rgba(255,255,255,.5); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
    .theme-grid { display: flex; gap: 6px; flex-wrap: wrap; }
    .theme-card { padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,.04); color: rgba(255,255,255,.75); cursor: pointer; font-size: 12px; transition: all .15s; }
    .theme-card:hover { background: rgba(255,255,255,.08); }
    .theme-card.selected { border-color: var(--primary); background: rgba(255,255,255,.1); color: #fff; }
    .model-select { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,.04); color: #fff; font-size: 13px; outline: none; cursor: pointer; appearance: none; -webkit-appearance: none; }
    .model-select option, .model-select optgroup { background: #1a1a1f; color: #fff; }
    .model-select:focus { border-color: var(--primary); }
    .slider { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.08); outline: none; -webkit-appearance: none; }
    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--primary); cursor: pointer; }
    .slider-container { display: flex; align-items: center; gap: 8px; font-size: 11px; color: rgba(255,255,255,.4); }
    .toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,.95); color: #fff; padding: 12px 18px; border-radius: 10px; z-index: 9999; font-size: 13px; border-left: 3px solid var(--primary); max-width: 90vw; }
    .camera-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.95); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
    .camera-video { max-width: 95vw; max-height: 70vh; border-radius: 14px; border: 2px solid rgba(255,255,255,0.1); }
    .camera-controls { display: flex; gap: 16px; }
    .camera-btn { padding: 12px 28px; border-radius: 30px; border: none; font-weight: 700; font-size: 14px; cursor: pointer; }
    .camera-btn.primary { background: var(--primary); color: #000; }
    .camera-btn.secondary { background: rgba(255,255,255,.08); color: #fff; border: 1px solid rgba(255,255,255,0.1); }
    .sign-in-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,.85); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; padding: 20px; }
    .mobile-only { display: none; }
    @media (max-width: 900px) {
      .chat-sidebar.desktop { display: none; }
      .chat-sidebar.mobile { display: flex; }
      .side-panel { width: 100vw; max-width: 100vw; }
    }
    @media (max-width: 640px) {
      .app-header { padding: 8px 10px; min-height: 52px; gap: 8px; }
      .main-title { font-size: 14px; }
      .icon-btn { width: 34px; height: 34px; }
      .scroll-wrapper { padding: 10px 10px 100px 10px; gap: 8px; }
      .msg-row { max-width: 95%; }
      .bubble { font-size: 13px; padding: 9px 12px; border-radius: 10px; }
      .avatar { width: 24px; height: 24px; font-size: 8px; }
      .empty-title { font-size: 22px; }
      .empty-subtitle { font-size: 12px; }
      .input-area { padding: 8px 10px 22px 10px; }
      .input-field { padding: 10px 12px; font-size: 14px; border-radius: 10px; }
      .send-btn { padding: 0 12px; height: 40px; border-radius: 10px; }
      .msg-actions { opacity: 1; }
      .sidebar-actions { opacity: 1; }
      .mobile-only { display: flex; }
      .desktop-only { display: none; }
    }
    @media (max-width: 360px) {
      .app-header { padding: 6px 8px; }
      .icon-btn { width: 32px; height: 32px; }
      .input-area-inner { gap: 4px; }
      .bubble { font-size: 12px; padding: 8px 10px; }
      .empty-title { font-size: 20px; }
    }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `}</style>
);

const InputBar = ({ text, setText, onSend, disabled, attachments, setAttachments, onFileSelect, onStartCamera, isListening, toggleListening, onGenerateImage }) => {
  const fileInputRef = useRef(null);
  const handleSubmit = () => { if ((!text.trim() && attachments.length === 0) || disabled) return; onSend(text); };
  return (
    <div className="input-area">
      <div className="input-area-inner">
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={onFileSelect} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={disabled} className="icon-btn desktop-only" title="Attach image"><Icon name="plus" size={18} /></button>
        <button onClick={onStartCamera} disabled={disabled} className="icon-btn" title="Camera"><Icon name="camera" size={18} /></button>
        <button onClick={toggleListening} disabled={disabled} className={`icon-btn ${isListening ? "active" : ""}`} title={isListening ? "Stop voice" : "Voice input"}><Icon name={isListening ? "mic-off" : "mic"} size={18} /></button>
        <button onClick={onGenerateImage} disabled={disabled} className="icon-btn" title="Generate image"><Icon name="image" size={18} /></button>
        <input className="input-field" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }} placeholder={disabled ? "AI is thinking..." : "Ask anything, describe an image..."} disabled={disabled} />
        <button className="send-btn" onClick={handleSubmit} disabled={(!text.trim() && attachments.length === 0) || disabled}><Icon name="send" size={18} /></button>
      </div>
    </div>
  );
};

const MessageActions = ({ content, onCopy, onRegenerate }) => (
  <div className="msg-actions">
    <button onClick={onCopy} className="msg-action-btn">Copy</button>
    {onRegenerate && <button onClick={onRegenerate} className="msg-action-btn">Regenerate</button>}
  </div>
);

const ChatSidebar = ({ chats, activeChatId, onSelect, onCreate, onDelete, onRename, onPin, onFavorite, collapsed, mobileOpen, setMobileOpen }) => {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 900;

  const renderItem = (chat) => {
    const isActive = activeChatId === chat.id;
    const isEditing = editingId === chat.id;
    return (
      <div key={chat.id} onClick={() => { onSelect(chat.id); if (isMobile) setMobileOpen(false); }} className={`sidebar-item ${isActive ? "active" : ""}`}>
        <div className="sidebar-icon">{chat.messages?.length > 0 ? chat.messages[0].content.slice(0,1).toUpperCase() : "N"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { onRename(chat.id, editTitle); setEditingId(null); } if (e.key === "Escape") setEditingId(null); }} onBlur={() => setEditingId(null)} autoFocus onClick={e => e.stopPropagation()} className="custom-input" style={{ padding: "3px 6px", fontSize: 12 }} />
          ) : (
            <div className="sidebar-title">{chat.title}</div>
          )}
          <div className="sidebar-meta">{chat.messages?.length || 0} messages</div>
        </div>
        <div className="sidebar-actions">
          <button onClick={e => { e.stopPropagation(); onFavorite(chat.id); }} className="icon-btn" style={{ width: 24, height: 24, borderRadius: 6, background: "transparent" }}><Icon name="star" size={12} /></button>
          <button onClick={e => { e.stopPropagation(); onPin(chat.id); }} className="icon-btn" style={{ width: 24, height: 24, borderRadius: 6, background: "transparent" }}><Icon name="pin" size={12} /></button>
          <button onClick={e => { e.stopPropagation(); setEditingId(chat.id); setEditTitle(chat.title); }} className="icon-btn" style={{ width: 24, height: 24, borderRadius: 6, background: "transparent" }}><Icon name="edit" size={12} /></button>
          <button onClick={e => { e.stopPropagation(); onDelete(chat.id); }} className="icon-btn" style={{ width: 24, height: 24, borderRadius: 6, background: "transparent" }}><Icon name="trash" size={12} /></button>
        </div>
      </div>
    );
  };

  const content = (
    <div className={`chat-sidebar ${isMobile ? "mobile" : "desktop"} ${mobileOpen ? "open" : ""}`} onClick={e => e.stopPropagation()}>
      <div className="sidebar-header">
        <button onClick={onCreate} className="sidebar-btn"><Icon name="plus" size={16} /> New Chat</button>
      </div>
      <div className="sidebar-list">
        {chats.filter(c => c.pinned).length > 0 && <div className="sidebar-section">Pinned</div>}
        {chats.filter(c => c.pinned).map(renderItem)}
        <div className="sidebar-section">Recent</div>
        {chats.filter(c => !c.pinned).map(renderItem)}
      </div>
    </div>
  );

  if (isMobile) return <>{content}{mobileOpen && <div className="panel-overlay" onClick={() => setMobileOpen(false)} />}</>;
  if (collapsed) return null;
  return content;
};

const AuthenticatedApp = () => {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [themeKey, setThemeKey] = useState(() => Storage.get("pa-theme") || "midnight");
  const [customBg, setCustomBg] = useState(() => Storage.get("pa-custom-bg") || "");
  const [customPrimary, setCustomPrimary] = useState(() => Storage.get("pa-custom-primary") || "");
  const [accentColor, setAccentColor] = useState(() => Storage.get("pa-accent-color") || "");
  const [bgOpacity, setBgOpacity] = useState(() => parseFloat(Storage.get("pa-bg-opacity") || "1"));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Storage.get("pa-sidebar-collapsed") === null ? true : Storage.get("pa-sidebar-collapsed") === "true");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState(null);

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [model, setModel] = useState(() => Storage.get("pa-model") || "glm-5.2");
  const [temperature, setTemperature] = useState(() => parseFloat(Storage.get("pa-temperature") || "0.7"));
  const [streamText, setStreamText] = useState("");
  const [status, setStatus] = useState("idle");

  const [attachments, setAttachments] = useState([]);
  const [inputText, setInputText] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const cameraStreamRef = useRef(null), videoRef = useRef(null), canvasRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null), listenTimerRef = useRef(null);
  const chatRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => Storage.set("pa-theme", themeKey), [themeKey]);
  useEffect(() => Storage.set("pa-custom-bg", customBg), [customBg]);
  useEffect(() => Storage.set("pa-custom-primary", customPrimary), [customPrimary]);
  useEffect(() => Storage.set("pa-accent-color", accentColor), [accentColor]);
  useEffect(() => Storage.set("pa-bg-opacity", bgOpacity.toString()), [bgOpacity]);
  useEffect(() => Storage.set("pa-sidebar-collapsed", sidebarCollapsed.toString()), [sidebarCollapsed]);
  useEffect(() => Storage.set("pa-model", model), [model]);
  useEffect(() => Storage.set("pa-temperature", temperature.toString()), [temperature]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chats, activeChatId, streamText]);

  const api = async (path, options = {}) => {
    const token = await getToken();
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  };

  const fetchAdminUsers = async () => {
    try {
      const r = await api('/api/admin/users');
      const data = await r.json();
      setAdminUsers(data || []);
    } catch (err) { setToast('Failed to load admin users'); }
  };

  const loadChats = useCallback(async () => {
    try {
      const r = await api('/api/chats');
      const data = await r.json();
      if (Array.isArray(data)) {
        setChats(data);
        if (!activeChatId && data.length) setActiveChatId(data[0].id);
      }
    } catch (err) { console.error('Load chats failed', err); }
  }, [activeChatId]);

  useEffect(() => { if (isLoaded && user) loadChats(); }, [isLoaded, user, loadChats]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!user?.emailAddresses?.[0]?.emailAddress) return;
      try {
        const r = await api('/api/admin/users');
        if (r.ok) {
          const users = await r.json();
          const me = users.find(u => u.email === user.emailAddresses[0].emailAddress);
          if (me?.is_admin) setIsAdmin(true);
        }
      } catch {}
    };
    if (isLoaded && user) checkAdmin();
  }, [isLoaded, user]);

  useEffect(() => { if (isAdmin) fetchAdminUsers(); }, [isAdmin]);

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);
  const activeMessages = activeChat?.messages || [];

  const createChat = async () => {
    try {
      const r = await api('/api/chats', { method: 'POST', body: JSON.stringify({ title: 'New Chat' }) });
      const data = await r.json();
      setChats(prev => [data, ...prev]);
      setActiveChatId(data.id);
      setInputText(""); setAttachments([]);
    } catch (err) { setToast('Failed to create chat'); }
  };

  const updateChatMessages = async (chatId, messages) => {
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages, updated_at: new Date().toISOString() } : c));
    try {
      await api(`/api/chats/${chatId}`, { method: 'PUT', body: JSON.stringify({ messages }) });
    } catch (err) { console.error('Save chat failed', err); }
  };

  const deleteChat = async (id) => {
    try {
      await api(`/api/chats/${id}`, { method: 'DELETE' });
      setChats(prev => prev.filter(c => c.id !== id));
      if (activeChatId === id) setActiveChatId(null);
    } catch (err) { setToast('Failed to delete chat'); }
  };

  const renameChat = async (id, title) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, title } : c));
  };

  const togglePinChat = (id) => setChats(prev => prev.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c));
  const toggleFavoriteChat = (id) => setChats(prev => prev.map(c => c.id === id ? { ...c, favorite: !c.favorite } : c));

  const sortedChats = useMemo(() => [...chats].sort((a,b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
  }), [chats]);

  const adminSuspend = async (id) => {
    try {
      const r = await api(`/api/admin/users/${id}/suspend`, { method: 'POST' });
      if (r.ok) { setToast('User suspended'); fetchAdminUsers(); }
      else setToast('Failed to suspend');
    } catch { setToast('Failed to suspend'); }
  };

  const adminUnsuspend = async (id) => {
    try {
      const r = await api(`/api/admin/users/${id}/unsuspend`, { method: 'POST' });
      if (r.ok) { setToast('User unsuspended'); fetchAdminUsers(); }
      else setToast('Failed to unsuspend');
    } catch { setToast('Failed to unsuspend'); }
  };

  const adminDeleteUser = async (id) => {
    if (!confirm('DELETE this user and all their data? This cannot be undone.')) return;
    try {
      const r = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      if (r.ok) { setToast('User deleted'); fetchAdminUsers(); }
      else setToast('Failed to delete');
    } catch { setToast('Failed to delete'); }
  };

  const handleFileSelect = (e) => { const files = Array.from(e.target.files).filter(f => f.type.startsWith("image/")); if (!files.length) { setToast("Only image files supported"); return; } setAttachments(prev => [...prev, ...files]); e.target.value = ""; };

  const startCamera = async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); cameraStreamRef.current = s; setShowCamera(true); setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100); } catch { setToast("Camera access denied"); } };
  const stopCamera = () => { if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; } setShowCamera(false); };
  const capturePhoto = () => { if (!videoRef.current || !canvasRef.current) return; const v = videoRef.current, c = canvasRef.current; c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0); c.toBlob(b => { setAttachments(prev => [...prev, new File([b], `camera-${Date.now()}.png`, { type: "image/png" })]); stopCamera(); }, "image/png"); };

  const stopListening = useCallback(() => { if (listenTimerRef.current) clearTimeout(listenTimerRef.current); if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; } setIsListening(false); }, []);
  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setToast("Voice input needs Chrome/Edge/Safari"); return; }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    try {
      const r = new SpeechRecognition();
      r.continuous = false; r.interimResults = false; r.lang = "en-US"; r.maxAlternatives = 1;
      r.onstart = () => { setIsListening(true); listenTimerRef.current = setTimeout(() => { try { r.stop(); } catch {} }, 10000); };
      r.onend = () => { setIsListening(false); if (listenTimerRef.current) clearTimeout(listenTimerRef.current); recognitionRef.current = null; };
      r.onresult = (e) => { let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; if (t.trim()) setInputText(p => p + t + " "); };
      r.onerror = (e) => { if (e.error === "not-allowed") setToast("Microphone permission denied"); else if (e.error === "no-speech") setToast("No speech detected"); else if (e.error !== "aborted") setToast("Voice error: " + e.error); setIsListening(false); if (listenTimerRef.current) clearTimeout(listenTimerRef.current); recognitionRef.current = null; };
      r.start(); recognitionRef.current = r;
    } catch { setToast("Could not start voice input"); setIsListening(false); }
  }, []);
  const toggleListening = useCallback(() => { if (isListening) stopListening(); else startListening(); }, [isListening, stopListening, startListening]);

  const generateImage = useCallback(async (promptText) => {
    const imagePrompt = parseImagePrompt(promptText) || promptText;
    if (!imagePrompt) { setToast("Describe what image to generate"); return; }
    let chatId = activeChatId;
    if (!chatId) { await createChat(); chatId = activeChatId; }
    if (!chatId) return;
    const userMsg = { role: "user", content: `Generate image: ${imagePrompt}`, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() };
    const withUser = [...(activeMessages || []), userMsg];
    await updateChatMessages(chatId, withUser);
    await new Promise(r => setTimeout(r, 300));
    await updateChatMessages(chatId, [...withUser, { role: "assistant", content: "", imageUrl: buildImageUrl(imagePrompt), imagePrompt, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]);
    setInputText(""); setAttachments([]);
  }, [activeChatId, activeMessages]);

  const handleSend = useCallback(async (text) => {
    let chatId = activeChatId;
    if (!chatId) { await createChat(); chatId = activeChatId; }
    if (!chatId) return;
    const cleanText = text.trim();
    if (isImageRequest(cleanText)) { generateImage(cleanText); return; }
    if (!VISION_MODELS.includes(model) && attachments.length > 0) { setToast(`${getModelDisplayName(model)} cannot see images`); return; }
    if ((!cleanText && !attachments.length) || status !== "idle") return;

    setStatus("loading"); setStreamText("");
    const userMsg = { role: "user", content: cleanText || "", attachments: attachments.map(f => ({ name: f.name, url: URL.createObjectURL(f), type: f.type })), ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() };
    const updated = [...activeMessages, userMsg];
    await updateChatMessages(chatId, updated);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append("message", cleanText || "");
      formData.append("modelType", model);
      formData.append("temperature", temperature.toString());
      formData.append("messages", JSON.stringify(activeMessages.slice(-10).map(m => ({ role: m.role, content: m.content }))));
      attachments.forEach(f => formData.append("files", f));

      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        body: formData,
        signal: abortRef.current.signal,
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Server error: ${res.status}`); }
      if (!res.body) throw new Error("Streaming not supported");

      setStatus("streaming");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "", buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
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
        setStreamText(acc);
      }
      await updateChatMessages(chatId, [...updated, { role: "assistant", content: acc, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]);
      setStreamText(""); setStatus("idle");
    } catch (err) {
      if (err.name === "AbortError") return;
      setStatus("error");
      await updateChatMessages(chatId, [...updated, { role: "assistant", content: `⚠️ ${err.message || 'Connection failed'}`, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]);
    }
    setAttachments([]); setInputText("");
  }, [activeChatId, activeMessages, model, temperature, status, attachments, generateImage]);

  const theme = themeKey === "ocean" ? { primary: "#38bdf8", bg: "radial-gradient(circle at 70% 30%, #0a1f3d 0%, #051020 50%, #02050c 100%)", border: "rgba(56, 189, 248, 0.2)" }
    : themeKey === "emerald" ? { primary: "#34d399", bg: "radial-gradient(circle at 20% 80%, #0a2a1f 0%, #05120d 50%, #020604 100%)", border: "rgba(52, 211, 153, 0.2)" }
    : themeKey === "crimson" ? { primary: "#fb7185", bg: "radial-gradient(circle at 80% 20%, #2a0a12 0%, #120408 50%, #050203 100%)", border: "rgba(251, 113, 133, 0.2)" }
    : themeKey === "gold" ? { primary: "#fbbf24", bg: "radial-gradient(circle at 50% 50%, #1f1508 0%, #0f0b05 50%, #050402 100%)", border: "rgba(251, 191, 36, 0.2)" }
    : { primary: "#8b5cf6", bg: "linear-gradient(135deg, #050507, #0b0b12, #12121f)", border: "rgba(139, 92, 246, 0.2)" };

  const primary = customPrimary || theme.primary;
  const border = accentColor || theme.border;
  const bgLayerStyle = customBg ? { backgroundImage: `url(${customBg})` } : { backgroundImage: theme.bg };
  const overlayStyle = { backgroundColor: `rgba(0,0,0,${1 - bgOpacity})` };

  if (!isLoaded) return null;

  return (
    <div className="app-root" style={{ "--primary": primary, "--border": border }}>
      <GlobalStyles />
      <div className="bg-layer" style={bgLayerStyle} />
      <div className="bg-overlay" style={overlayStyle} />
      {toast && <div className="toast">{toast}</div>}
      {showCamera && <div className="camera-overlay">
        <video ref={videoRef} autoPlay className="camera-video" />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div className="camera-controls">
          <button onClick={capturePhoto} className="camera-btn primary">Capture</button>
          <button onClick={stopCamera} className="camera-btn secondary">Cancel</button>
        </div>
      </div>}
      <div className="app-shell">
        <header className="app-header">
          <button className="icon-btn mobile-only" onClick={() => setMobileSidebarOpen(true)} title="Chats"><Icon name="menu" size={20} /></button>
          <button className="icon-btn desktop-only" onClick={() => setSidebarCollapsed(c => !c)} title="Chats"><Icon name="menu" size={20} /></button>
          <div className="brand">
            <h1 className="main-title">{activeChat?.title || "ALOP-AI"}</h1>
            <span className="sub-title">{getModelDisplayName(model)}</span>
          </div>
          <div className="header-actions">
            {isAdmin && <button className={`icon-btn admin-btn ${showAdmin ? "active" : ""}`} onClick={() => { setShowAdmin(s => !s); setShowSettings(false); setShowMemory(false); }} title="Admin"><Icon name="crown" size={20} /></button>}
            <button className="icon-btn" onClick={() => { setShowMemory(s => !s); setShowSettings(false); setShowAdmin(false); }} title="Memory"><Icon name="brain" size={20} /></button>
            <button className="icon-btn" onClick={() => { setShowSettings(s => !s); setShowMemory(false); setShowAdmin(false); }} title="Settings"><Icon name="settings" size={20} /></button>
          </div>
        </header>
        <div className="app-body">
          <ChatSidebar chats={sortedChats} activeChatId={activeChatId} onSelect={setActiveChatId} onCreate={createChat} onDelete={deleteChat} onRename={renameChat} onPin={togglePinChat} onFavorite={toggleFavoriteChat} collapsed={sidebarCollapsed} mobileOpen={mobileSidebarOpen} setMobileOpen={setMobileSidebarOpen} />
          <div className="chat-main">
            {showAdmin && isAdmin && <>
              <div className="panel-overlay" onClick={() => setShowAdmin(false)} />
              <div className="side-panel">
                <div className="panel-header">
                  <div className="panel-title">Admin Dashboard</div>
                  <button onClick={() => setShowAdmin(false)} className="icon-btn"><Icon name="close" size={18} /></button>
                </div>
                <div className="admin-title">{adminUsers.length} Users</div>
                {adminUsers.map(u => (
                  <div key={u.id} className="admin-user-card">
                    <div className="admin-user-header">
                      <img src={u.avatar_url || 'https://via.placeholder.com/36'} alt="" className="admin-avatar" />
                      <div>
                        <div className="admin-user-name">{u.name || 'Anonymous'}</div>
                        <div className="admin-user-email">{u.email || 'No email'}</div>
                      </div>
                      <span className={`admin-badge ${u.plan === 'pro' ? 'pro' : 'free'}`}>{u.plan || 'free'}</span>
                      {u.is_admin && <span className="admin-badge admin">Admin</span>}
                    </div>
                    <div className="admin-stats">
                      <span>Joined: {new Date(u.created_at).toLocaleDateString()}</span>
                      <span>{u.suspended ? 'SUSPENDED' : 'Active'}</span>
                    </div>
                    <div className="msg-actions" style={{ justifyContent: 'flex-start', marginTop: 8, opacity: 1 }}>
                      {u.suspended
                        ? <button onClick={() => adminUnsuspend(u.id)} className="msg-action-btn">Unsuspend</button>
                        : <button onClick={() => adminSuspend(u.id)} className="msg-action-btn">Suspend</button>}
                      <button onClick={() => adminDeleteUser(u.id)} className="msg-action-btn" style={{ color: '#fb7185' }}>Delete User</button>
                    </div>
                  </div>
                ))}
              </div>
            </>}
            {showMemory && <>
              <div className="panel-overlay" onClick={() => setShowMemory(false)} />
              <div className="side-panel">
                <div className="panel-header">
                  <div className="panel-title">Memory</div>
                  <button onClick={() => setShowMemory(false)} className="icon-btn"><Icon name="close" size={18} /></button>
                </div>
                <div className="memory-card">
                  <div className="memory-card-title">AI Instructions</div>
                  <textarea className="custom-input textarea" placeholder="Tell the AI how to behave..." />
                </div>
              </div>
            </>}
            {showSettings && <>
              <div className="panel-overlay" onClick={() => setShowSettings(false)} />
              <div className="side-panel">
                <div className="panel-header">
                  <div className="panel-title">Settings</div>
                  <button onClick={() => setShowSettings(false)} className="icon-btn"><Icon name="close" size={18} /></button>
                </div>
                <div className="setting-row">
                  <div className="setting-label">Theme</div>
                  <div className="theme-grid">
                    {["midnight","ocean","emerald","crimson","gold"].map(k => <button key={k} onClick={() => setThemeKey(k)} className={`theme-card ${themeKey === k ? "selected" : ""}`} style={{ textTransform: "capitalize" }}>{k}</button>)}
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-label">Background</div>
                  <input className="custom-input" type="text" value={customBg} onChange={e => setCustomBg(e.target.value)} placeholder="Image URL" />
                  <div className="theme-grid">
                    {Object.entries(BACKGROUND_PRESETS).map(([k, url]) => <button key={k} onClick={() => setCustomBg(url)} className="theme-card" style={{ textTransform: "capitalize" }}>{k}</button>)}
                    <button onClick={() => setCustomBg("")} className="theme-card">Reset</button>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-label">Background Intensity: {Math.round(bgOpacity * 100)}%</div>
                  <div className="slider-container">
                    <span>Dim</span>
                    <input type="range" min="0" max="1" step="0.05" value={bgOpacity} onChange={e => setBgOpacity(parseFloat(e.target.value))} className="slider" />
                    <span>Bright</span>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-label">Button Color</div>
                  <input type="color" value={customPrimary || primary} onChange={e => setCustomPrimary(e.target.value)} style={{ width: 50, height: 36, borderRadius: 8, border: "none", cursor: "pointer" }} />
                  {customPrimary && <button onClick={() => setCustomPrimary("")} className="theme-card">Reset</button>}
                </div>
                <div className="setting-row">
                  <div className="setting-label">AI Model</div>
                  <select value={model} onChange={e => setModel(e.target.value)} className="model-select">
                    <optgroup label="Fast Models">{MODELS.fast.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}</optgroup>
                    <optgroup label="Reasoning Models">{MODELS.reasoning.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}</optgroup>
                  </select>
                </div>
                <div className="setting-row">
                  <div className="setting-label">Creativity: {temperature.toFixed(1)}</div>
                  <div className="slider-container">
                    <span>Precise</span>
                    <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} className="slider" />
                    <span>Creative</span>
                  </div>
                </div>
                <div className="setting-row">
                  <button onClick={() => activeChatId && deleteChat(activeChatId)} className="theme-card">Delete Chat</button>
                </div>
              </div>
            </>}
            <div className="chat-content">
              <div className="scroll-wrapper" ref={chatRef}>
                {activeMessages.length === 0 && !streamText && <div className="empty-state">
                  <h2 className="empty-title">ALOP-AI</h2>
                  <p className="empty-subtitle">Ask anything, upload photos, take a picture, use your voice, or tap the image button.</p>
                </div>}
                {activeMessages.map((msg, idx) => <div key={msg.id || idx} className={`msg-row ${msg.role}`}>
                  <div className="avatar">{msg.role === "user" ? "YOU" : "AI"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {msg.content && <div className="bubble">{msg.content}</div>}
                    {msg.imageUrl && <div style={{ marginTop: 8 }}>
                      <img src={msg.imageUrl} alt="Generated" style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 12, cursor: "pointer" }} onnClick={() => window.open(msg.imageUrl, "_blank")} />
                      <div className="msg-meta" style={{ textAlign: "left" }}>{msg.imagePrompt}</div>
                    </div>}
                    {msg.attachments?.length > 0 && <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>{msg.attachments.map((a, i) => <img key={i} src={a.url} alt={a.name} style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover" }} />)}</div>}
                    {msg.role === "assistant" && !msg.imageUrl && <MessageActions content={msg.content} onCopy={() => navigator.clipboard.writeText(msg.content)} onRegenerate={idx === activeMessages.length - 1 ? () => {} : null} />}
                    <div className="msg-meta">{msg.ts}</div>
                  </div>
                </div>)}
                {streamText && <div className="msg-row assistant">
                  <div className="avatar">AI</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="bubble">{streamText}</div></div>
                </div>}
              </div>
              <InputBar text={inputText} setText={setInputText} onSend={handleSend} disabled={status !== "idle"} attachments={attachments} setAttachments={setAttachments} onFileSelect={handleFileSelect} onStartCamera={startCamera} isListening={isListening} toggleListening={toggleListening} onGenerateImage={() => { if (inputText.trim()) generateImage(inputText); else setToast("Type what image to generate"); }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const clerkKey = "pk_test_cmVsYXhpbmctaW1wYWxhLTUuY2xlcmsuYWNjb3VudHMuZGV2JA";
  return (
    <ClerkProvider publishableKey={clerkKey}>
      <div style={{ width: "100vw", height: "100dvh" }}>
        <AuthenticatedAppWrapper />
      </div>
    </ClerkProvider>
  );
};

const AuthenticatedAppWrapper = () => {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="sign-in-overlay">
        <SignIn />
      </div>
    );
  }
  return <AuthenticatedApp />;
};

export default App;
