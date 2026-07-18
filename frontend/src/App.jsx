const App = () => {
  console.log("Clerk key exists:", !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  console.log("API base:", import.meta.env.VITE_API_BASE);

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ClerkProvider, SignIn, useUser, useAuth } from "@clerk/clerk-react";

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
    image: <g><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" strokeWidth="2" fill="none" /><circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
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
    .custom-input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,.04); color: #fff; font-size: 13px; outline: none; }
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
