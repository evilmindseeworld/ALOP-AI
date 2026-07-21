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
  nebula: { primary: "#c084fc", bg: "radial-gradient(ellipse at 20% 20%, #2e1065 0%, #1a0b2e 40%, #0f0518 100%)", border: "rgba(192, 132, 252, 0.25)", glow: "#c084fc" },
  aurora: { primary: "#5eead4", bg: "radial-gradient(ellipse at 80% 20%, #0f766e 0%, #022c22 40%, #020617 100%)", border: "rgba(94, 234, 212, 0.25)", glow: "#5eead4" },
  cyberpunk: { primary: "#f472b6", bg: "radial-gradient(ellipse at 50% 0%, #4c1d95 0%, #2e1065 30%, #0f0518 100%)", border: "rgba(244, 114, 182, 0.3)", glow: "#f472b6" },
  synthwave: { primary: "#fb7185", bg: "linear-gradient(180deg, #2a0a1a 0%, #4c1d4a 40%, #0f0518 100%)", border: "rgba(251, 113, 133, 0.25)", glow: "#fb7185" },
  galaxy: { primary: "#67e8f9", bg: "radial-gradient(circle at 50% 50%, #0c4a6e 0%, #082f49 30%, #020617 100%)", border: "rgba(103, 232, 249, 0.2)", glow: "#67e8f9" },
  volcanic: { primary: "#f97316", bg: "radial-gradient(ellipse at 50% 100%, #7c2d12 0%, #431407 40%, #0c0a09 100%)", border: "rgba(249, 115, 22, 0.25)", glow: "#f97316" },
  midnight: { primary: "#818cf8", bg: "linear-gradient(135deg, #020617 0%, #1e1b4b 50%, #0f172a 100%)", border: "rgba(129, 140, 248, 0.2)", glow: "#818cf8" },
  ocean: { primary: "#38bdf8", bg: "radial-gradient(circle at 70% 30%, #0a1f3d 0%, #051020 50%, #02050c 100%)", border: "rgba(56, 189, 248, 0.2)", glow: "#38bdf8" },
  emerald: { primary: "#34d399", bg: "radial-gradient(circle at 20% 80%, #0a2a1f 0%, #05120d 50%, #020604 100%)", border: "rgba(52, 211, 153, 0.2)", glow: "#34d399" },
  crimson: { primary: "#fb7185", bg: "radial-gradient(circle at 80% 20%, #2a0a12 0%, #120408 50%, #050203 100%)", border: "rgba(251, 113, 133, 0.2)", glow: "#fb7185" },
  gold: { primary: "#fbbf24", bg: "radial-gradient(circle at 50% 50%, #1f1508 0%, #0f0b05 50%, #050402 100%)", border: "rgba(251, 191, 36, 0.2)", glow: "#fbbf24" },
  matrix: { primary: "#4ade80", bg: "radial-gradient(circle at 50% 100%, #052e16 0%, #020617 100%)", border: "rgba(74, 222, 128, 0.25)", glow: "#4ade80" },
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const getModelDisplayName = (key) => {
  const all = [...MODELS.fast, ...MODELS.reasoning];
  return all.find(m => m.key === key)?.name || key;
};

const isImageRequest = (text) => /^\/image|generate image|create image|draw image|make image/i.test(text);

const parseImagePrompt = (text) => {
  const m = text.match(/(?:generate|create|draw|make)\s+(?:an?\s+)?image\s*(?:of\s+)?(.+)/i);
  return m ? m[1].trim() : text.replace(/^\/image\s*/, "").trim();
};

const buildImageUrl = (prompt) => `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;

const Storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  getJson: (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  setJson: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const Icon = ({ name, size = 18 }) => {
  const icons = {
    menu: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>,
    settings: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    brain: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>,
    crown: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm2.86-2h8.28l.5-3.37L13.5 14 12 11.5 10.5 14 7.36 10.63l.5 3.37zM5 18h14v2H5v-2z"/></svg>,
    close: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    pin: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM5 19.5h6v-2H5v2z"/></svg>,
    heart: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    copy: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
    refresh: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
    send: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
    image: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
    mic: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
    camera: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    user: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    upgrade: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l9 4v6c0 5.55-3.84 10.74-9 12-5.16-1.26-9-6.45-9-12V6l9-4z"/><path d="M9 12l3-3 3 3"/><path d="M12 9v8"/></svg>,
  };
  return icons[name] || null;
};

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Inter', sans-serif; overflow: hidden; }
    .app-root { width: 100vw; height: 100vh; height: 100dvh; position: relative; color: #fff; overflow: hidden; }
    .bg-layer { position: absolute; inset: 0; background-size: cover; background-position: center; }
    .bg-overlay { position: absolute; inset: 0; pointer-events: none; }
    .app-shell { position: relative; z-index: 1; display: flex; flex-direction: column; width: 100%; height: 100%; }
    .app-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.25); backdrop-filter: blur(16px); }
    .brand { flex: 1; display: flex; flex-direction: column; }
    .main-title { margin: 0; font-size: 16px; font-weight: 700; }
    .sub-title { font-size: 11px; opacity: 0.65; }
    .header-actions { display: flex; gap: 8px; }
    .icon-btn { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); cursor: pointer; transition: all 0.15s; }
    .icon-btn:hover { background: rgba(255,255,255,0.12); transform: translateY(-1px); }
    .icon-btn.active { background: var(--primary); color: #000; border-color: var(--primary); box-shadow: 0 0 20px var(--glow); }
    .admin-btn.active { background: #fbbf24; color: #000; border-color: #fbbf24; box-shadow: 0 0 20px rgba(251,191,36,0.5); }
    .app-body { flex: 1; display: flex; overflow: hidden; position: relative; }
    .chat-main { flex: 1; display: flex; position: relative; min-width: 0; }
    .chat-content { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .scroll-wrapper { flex: 1; overflow-y: auto; padding: 20px; }
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; opacity: 0.75; }
    .empty-title { font-size: 42px; font-weight: 800; margin: 0 0 12px; background: linear-gradient(135deg, #fff 0%, var(--primary) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .empty-subtitle { max-width: 420px; font-size: 14px; line-height: 1.6; opacity: 0.7; }
    .msg-row { display: flex; gap: 12px; margin-bottom: 20px; }
    .msg-row.user { flex-direction: row-reverse; }
    .avatar { width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; background: linear-gradient(135deg, var(--primary), var(--glow)); box-shadow: 0 0 15px rgba(0,0,0,0.3); }
    .msg-content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .msg-row.user .msg-content { align-items: flex-end; }
    .msg-row.assistant .msg-content { align-items: flex-start; }
    .bubble { padding: 14px 18px; border-radius: 18px; border-top-left-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); line-height: 1.55; font-size: 14px; white-space: pre-wrap; word-break: break-word; max-width: 80%; }
    .msg-row.user .bubble { background: var(--primary); color: #000; font-weight: 500; border-top-left-radius: 18px; border-top-right-radius: 4px; }
    .typing-bubble { display: flex; align-items: center; gap: 6px; padding: 18px 16px; }
    .typing-bubble span { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.6); animation: typingBounce 1.4s infinite ease-in-out both; }
    .typing-bubble span:nth-child(1) { animation-delay: -0.32s; }
    .typing-bubble span:nth-child(2) { animation-delay: -0.16s; }
    .typing-bubble span:nth-child(3) { animation-delay: 0s; }
    @keyframes typingBounce { 0%,80%,100% { transform: scale(0.5); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
    .msg-meta { font-size: 11px; opacity: 0.45; margin-top: 6px; }
    .msg-actions { display: flex; gap: 8px; margin-top: 6px; opacity: 0; transition: opacity 0.15s; }
    .msg-row:hover .msg-actions { opacity: 1; }
    .msg-action-btn { background: transparent; border: none; color: rgba(255,255,255,0.6); font-size: 11px; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
    .msg-action-btn:hover { color: var(--primary); background: rgba(255,255,255,0.06); }
    .input-bar { display: flex; align-items: flex-end; gap: 10px; padding: 12px 16px 18px; border-top: 1px solid var(--border); background: rgba(0,0,0,0.25); backdrop-filter: blur(16px); }
    .input-wrapper { flex: 1; display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 20px; padding: 10px 14px; }
    .input-actions { display: flex; gap: 8px; }
    .input-text { background: transparent; border: none; outline: none; color: #fff; font-size: 15px; resize: none; max-height: 120px; min-height: 24px; font-family: inherit; }
    .input-text::placeholder { color: rgba(255,255,255,0.45); }
    .input-btn { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: transparent; border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); cursor: pointer; transition: all 0.15s; }
    .input-btn:hover { background: rgba(255,255,255,0.1); }
    .input-btn.primary { background: var(--primary); color: #000; border-color: var(--primary); }
    .input-btn.listening { background: #ef4444; color: #fff; animation: pulse 1s infinite; }
    .input-btn input[type="file"] { display: none; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
    .attachment-pill { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 4px 10px; font-size: 12px; }
    .sidebar { width: 280px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: rgba(0,0,0,0.35); backdrop-filter: blur(20px); }
    .sidebar.collapsed { width: 0; overflow: hidden; border-right: none; }
    .sidebar.mobile { position: absolute; top: 0; bottom: 0; left: 0; z-index: 50; width: 260px; transform: translateX(-100%); }
    .sidebar.mobileOpen { transform: translateX(0); }
    .sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 10px; }
    .new-chat-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border-radius: 12px; background: var(--primary); color: #000; font-weight: 600; border: none; cursor: pointer; font-size: 13px; }
    .chat-list { flex: 1; overflow-y: auto; padding: 0 10px 10px; }
    .chat-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; margin-bottom: 4px; cursor: pointer; border: 1px solid transparent; }
    .chat-item:hover { background: rgba(255,255,255,0.06); }
    .chat-item.active { background: rgba(255,255,255,0.1); border-color: var(--primary); }
    .chat-item.pinned { border-left: 3px solid #fbbf24; }
    .chat-item.favorite { border-left: 3px solid #f472b6; }
    .chat-title { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chat-actions { display: flex; gap: 4px; opacity: 0; }
    .chat-item:hover .chat-actions { opacity: 1; }
    .chat-action { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 12px; }
    .sidebar-footer { padding: 10px; font-size: 11px; opacity: 0.5; text-align: center; }
    .panel-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.4); z-index: 60; cursor: pointer; }
    .side-panel { position: absolute; top: 0; right: 0; bottom: 0; width: 360px; max-width: 100vw; background: rgba(0,0,0,0.75); backdrop-filter: blur(24px); border-left: 1px solid var(--border); z-index: 70; display: flex; flex-direction: column; animation: slideIn 0.2s ease; }
    @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
    .panel-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border); }
    .panel-title { font-size: 15px; font-weight: 700; }
    .panel-body { flex: 1; overflow-y: auto; padding: 16px; }
    .setting-row { margin-bottom: 22px; }
    .setting-label { font-size: 12px; font-weight: 600; text-transform: uppercase; opacity: 0.7; margin-bottom: 10px; }
    .custom-input { width: 100%; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 14px; outline: none; }
    .custom-input.textarea { min-height: 100px; resize: vertical; }
    .theme-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .theme-card { padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #fff; cursor: pointer; font-size: 12px; font-weight: 500; text-align: center; }
    .theme-card.selected { border-color: var(--primary); background: rgba(255,255,255,0.12); box-shadow: 0 0 15px var(--glow); }
    .slider { flex: 1; accent-color: var(--primary); }
    .model-select { width: 100%; padding: 10px 12px; border-radius: 10px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); color: #fff; font-size: 14px; }
    .memory-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 14px; }
    .admin-user-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .admin-user-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .admin-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
    .admin-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-left: auto; font-weight: 600; }
    .admin-badge.pro { background: #fbbf24; color: #000; }
    .admin-badge.free { background: rgba(255,255,255,0.1); color: #fff; }
    .admin-badge.admin { background: var(--primary); color: #000; margin-left: 6px; }
    .camera-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.85); display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .camera-video { max-width: 80%; max-height: 70%; border-radius: 16px; border: 2px solid var(--primary); }
    .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: #fff; padding: 12px 20px; border-radius: 12px; border: 1px solid var(--primary); z-index: 200; }
    .mobile-only { display: none; }
    .desktop-only { display: flex; }
    @media (max-width: 768px) { .mobile-only { display: flex; } .desktop-only { display: none; } .sidebar { position: absolute; transform: translateX(-100%); } .sidebar.mobileOpen { transform: translateX(0); } .side-panel { width: 100vw; } }
  `}</style>
);

const MessageActions = ({ content, onCopy, onRegenerate }) => (
  <div className="msg-actions">
    <button className="msg-action-btn" onClick={onCopy}><Icon name="copy" size={13}/> Copy</button>
    {onRegenerate && <button className="msg-action-btn" onClick={onRegenerate}><Icon name="refresh" size={13}/> Retry</button>}
  </div>
);

const ChatSidebar = ({ chats, activeChatId, onSelect, onCreate, onDelete, onRename, onPin, onFavorite, collapsed, mobileOpen, setMobileOpen }) => {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");

  return (
    <div className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobileOpen" : ""} ${typeof window !== 'undefined' && window.innerWidth <= 768 ? "mobile" : ""}`}>
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={onCreate}><Icon name="plus" size={16}/> New Chat</button>
        {mobileOpen && <button className="icon-btn" onClick={() => setMobileOpen(false)}><Icon name="close" size={18}/></button>}
      </div>
      <div className="chat-list">
        {chats.length === 0 && <div style={{ textAlign: "center", opacity: 0.5, padding: 20, fontSize: 13 }}>No chats yet</div>}
        {chats.map(chat => (
          <div key={chat.id} className={`chat-item ${chat.id === activeChatId ? "active" : ""} ${chat.pinned ? "pinned" : ""} ${chat.favorite ? "favorite" : ""}`} onClick={() => onSelect(chat.id)}>
            <div className="chat-title">
              {editingId === chat.id
                ? <input className="custom-input" style={{ padding: "4px 8px", fontSize: 12 }} value={editTitle} autoFocus
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={() => { onRename(chat.id, editTitle); setEditingId(null); }}
                    onKeyDown={e => { if (e.key === "Enter") { onRename(chat.id, editTitle); setEditingId(null); } }}
                    onClick={e => e.stopPropagation()}/>
                : chat.title || "New Chat"}
            </div>
            <div className="chat-actions" onClick={e => e.stopPropagation()}>
              <button className="chat-action" onClick={() => onPin(chat.id)} title="Pin"><Icon name="pin" size={13}/></button>
              <button className="chat-action" onClick={() => onFavorite(chat.id)} title="Favorite"><Icon name="heart" size={13}/></button>
              <button className="chat-action" onClick={() => { setEditingId(chat.id); setEditTitle(chat.title || "New Chat"); }} title="Rename">✎</button>
              <button className="chat-action" onClick={() => onDelete(chat.id)} title="Delete"><Icon name="trash" size={13}/></button>
            </div>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">ALOP-AI • Council of Minds</div>
    </div>
  );
};

const InputBar = ({ text, setText, onSend, disabled, attachments, setAttachments, onFileSelect, onStartCamera, isListening, toggleListening, councilMode, setCouncilMode, plan }) => {
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

  const removeAttachment = (idx) => setAttachments(prev => prev.filter((_, i) => i !== idx));

  return (
    <div className="input-bar">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingRight: 8 }}>
        <button
          className={`icon-btn ${councilMode ? "active" : ""}`}
          onClick={() => setCouncilMode(c => !c)}
          title={plan === 'pro' ? "AI Council (14 models)" : "AI Council (4 models)"}
          style={{ width: 44, height: 44, borderRadius: 12, background: councilMode ? 'var(--primary)' : 'rgba(255,255,255,0.06)' }}
        >
          <Icon name="brain" size={20} />
        </button>
        <span style={{ fontSize: 10, opacity: 0.6, writingMode: 'vertical-rl' }}>COUNCIL</span>
      </div>
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
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={councilMode ? "Ask the AI Council anything..." : "Ask anything, upload a photo, take a picture, use voice, or type 'generate image of...'"}
          disabled={disabled}
        />
        <div className="input-actions">
          <label className="input-btn" title="Upload image" style={{ cursor: "pointer" }}>
            <input type="file" accept="image/*" multiple onChange={onFileSelect} disabled={disabled}/>
            <Icon name="image" size={16}/>
          </label>
          <button className={`input-btn ${isListening ? "listening" : ""}`} onClick={toggleListening} title="Voice input">
            <Icon name="mic" size={16}/>
          </button>
          <button className="input-btn" onClick={onStartCamera} title="Camera" disabled={disabled}><Icon name="camera" size={16}/></button>
          <div style={{ flex: 1 }}></div>
          <button className="input-btn primary" onClick={() => onSend(text)} disabled={disabled || !text.trim()}>
            <Icon name="send" size={16}/>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Storage.get("pa-sidebar-collapsed") === null ? true : Storage.get("pa-sidebar-collapsed") === "true");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userPlan, setUserPlan] = useState('free');
  const [councilMode, setCouncilMode] = useState(() => Storage.get("pa-council") === "true");
  const [toast, setToast] = useState(null);

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [model, setModel] = useState(() => Storage.get("pa-model") || "glm-5.2");
  const [temperature, setTemperature] = useState(() => parseFloat(Storage.get("pa-temperature") || "0.7"));
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
  useEffect(() => Storage.set("pa-bg-opacity", bgOpacity.toString()), [bgOpacity]);
  useEffect(() => Storage.set("pa-sidebar-collapsed", sidebarCollapsed.toString()), [sidebarCollapsed]);
  useEffect(() => Storage.set("pa-model", model), [model]);
  useEffect(() => Storage.set("pa-temperature", temperature.toString()), [temperature]);
  useEffect(() => Storage.set("pa-council", councilMode.toString()), [councilMode]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chats, activeChatId]);

  const api = async (path, options = {}) => {
    const token = await getToken();
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
  };

  const fetchAdminUsers = async () => {
    try { const r = await api('/api/admin/users'); setAdminUsers((await r.json()) || []); } catch {}
  };

  const loadChats = useCallback(async () => {
    try {
      const r = await api('/api/chats');
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        setChats(data);
        if (!activeChatId) setActiveChatId(data[0].id);
      }
    } catch {}
  }, [activeChatId]);

  const fetchPlan = useCallback(async () => {
    try { const r = await api('/api/user/plan'); setUserPlan((await r.json()).plan || 'free'); } catch {}
  }, []);

  useEffect(() => { if (isLoaded && isSignedIn) { loadChats(); fetchPlan(); } }, [isLoaded, isSignedIn, loadChats, fetchPlan]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!isSignedIn || !user?.emailAddresses?.[0]?.emailAddress) return;
      try {
        const r = await api('/api/admin/users');
        if (r.ok) {
          const users = await r.json();
          const me = users.find(u => u.email === user.emailAddresses[0].emailAddress);
          if (me?.is_admin) setIsAdmin(true);
        }
      } catch {}
    };
    if (isLoaded) checkAdmin();
  }, [isLoaded, user, isSignedIn]);

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
      return data.id;
    } catch { setToast('Failed to create chat'); return null; }
  };

  const updateChatMessages = async (chatId, messages, saveToDb = true) => {
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages, updated_at: new Date().toISOString() } : c));
    if (saveToDb) {
      try { await api(`/api/chats/${chatId}`, { method: 'PUT', body: JSON.stringify({ messages }) }); } catch {}
    }
  };

  const deleteChat = async (id) => {
    try { await api(`/api/chats/${id}`, { method: 'DELETE' }); setChats(prev => prev.filter(c => c.id !== id)); if (activeChatId === id) setActiveChatId(null); } catch {}
  };

  const renameChat = async (id, title) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    try { await api(`/api/chats/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }); } catch {}
  };

  const togglePinChat = (id) => setChats(prev => prev.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c));
  const toggleFavoriteChat = (id) => setChats(prev => prev.map(c => c.id === id ? { ...c, favorite: !c.favorite } : c));

  const sortedChats = useMemo(() => [...chats].sort((a,b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
  }), [chats]);

  const adminSuspend = async (id) => { try { if ((await api(`/api/admin/users/${id}/suspend`, { method: 'POST' })).ok) { setToast('User suspended'); fetchAdminUsers(); } } catch {} };
  const adminUnsuspend = async (id) => { try { if ((await api(`/api/admin/users/${id}/unsuspend`, { method: 'POST' })).ok) { setToast('User unsuspended'); fetchAdminUsers(); } } catch {} };
  const adminDeleteUser = async (id) => { if (!confirm('DELETE this user and all their data?')) return; try { if ((await api(`/api/admin/users/${id}`, { method: 'DELETE' })).ok) { setToast('User deleted'); fetchAdminUsers(); } } catch {} };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));
    if (!files.length) { setToast("Only image files supported"); return; }
    setAttachments(prev => [...prev, ...files]);
    e.target.value = "";
  };

  const startCamera = async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); cameraStreamRef.current = s; setShowCamera(true); setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100); } catch { setToast("Camera access denied"); }
  };
  const stopCamera = () => { if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; } setShowCamera(false); };
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current, c = canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob(b => { setAttachments(prev => [...prev, new File([b], `camera-${Date.now()}.png`, { type: "image/png" })]); stopCamera(); }, "image/png");
  };

  const stopListening = useCallback(() => { if (listenTimerRef.current) clearTimeout(listenTimerRef.current); if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; } setIsListening(false); }, []);
  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setToast("Voice input needs Chrome/Edge/Safari"); return; }
    const r = new SpeechRecognition();
    r.continuous = false; r.interimResults = false; r.lang = "en-US"; r.maxAlternatives = 1;
    r.onstart = () => { setIsListening(true); listenTimerRef.current = setTimeout(() => { try { r.stop(); } catch {} }, 10000); };
    r.onend = () => { setIsListening(false); if (listenTimerRef.current) clearTimeout(listenTimerRef.current); recognitionRef.current = null; };
    r.onresult = (e) => { let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; if (t.trim()) setInputText(p => p + t + " "); };
    r.onerror = () => { setIsListening(false); recognitionRef.current = null; };
    r.start(); recognitionRef.current = r;
  }, []);
  const toggleListening = useCallback(() => { if (isListening) stopListening(); else startListening(); }, [isListening, stopListening, startListening]);

  const generateImage = useCallback(async (promptText) => {
    const imagePrompt = parseImagePrompt(promptText) || promptText;
    if (!imagePrompt) { setToast("Describe what image to generate"); return; }
    let chatId = activeChatId;
    if (!chatId) { chatId = await createChat(); }
    if (!chatId) return;
    const userMsg = { role: "user", content: `Generate image: ${imagePrompt}`, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() };
    const withUser = [...(activeMessages || []), userMsg];
    await updateChatMessages(chatId, withUser);
    await updateChatMessages(chatId, [...withUser, { role: "assistant", content: "", imageUrl: buildImageUrl(imagePrompt), imagePrompt, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() }]);
    setInputText(""); setAttachments([]);
  }, [activeChatId, activeMessages]);

  const handleSend = useCallback(async (text) => {
    let chatId = activeChatId;
    if (!chatId) { chatId = await createChat(); }
    if (!chatId) return;
    const cleanText = text.trim();
    if (isImageRequest(cleanText)) { generateImage(cleanText); return; }
    if (councilMode && attachments.length > 0) { setToast("AI Council does not support file uploads yet"); return; }
    if (!VISION_MODELS.includes(model) && attachments.length > 0 && !councilMode) { setToast(`${getModelDisplayName(model)} cannot see images`); return; }
    if ((!cleanText && !attachments.length) || status !== "idle") return;

    setStatus("loading");
    const userMsg = { role: "user", content: cleanText || "", attachments: attachments.map(f => ({ name: f.name, url: URL.createObjectURL(f), type: f.type })), ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: uid() };
    const updated = [...activeMessages, userMsg];
    await updateChatMessages(chatId, updated);
    const assistantId = uid();
    const assistantMsg = { role: "assistant", content: "", typing: true, ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), id: assistantId, isCouncil: councilMode };
    updateChatMessages(chatId, [...updated, assistantMsg], false);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const token = await getToken();
      let res;

      if (councilMode) {
        res = await fetch(`${API_BASE}/api/council`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: cleanText, history: activeMessages.slice(-6).map(m => ({ role: m.role, content: m.content })), plan: userPlan }),
          signal: abortRef.current.signal
        });
      } else {
        const formData = new FormData();
        formData.append("message", cleanText || "");
        formData.append("modelType", model);
        formData.append("temperature", temperature.toString());
        formData.append("messages", JSON.stringify(activeMessages.slice(-10).map(m => ({ role: m.role, content: m.content }))));
        attachments.forEach(f => formData.append("files", f));
        res = await fetch(`${API_BASE}/chat`, { method: "POST", body: formData, signal: abortRef.current.signal, headers: { Authorization: `Bearer ${token}` } });
      }

      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Server error: ${res.status}`); }
      if (!res.body) throw new Error("Streaming not supported");

      setStatus("streaming");
      updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: "" }], false);

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
          try { const d = JSON.parse(j); if (d.type === "chunk") acc += d.text; else if (d.type === "error") throw new Error(d.text); } catch {}
        }
        updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc }], false);
      }
      await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: acc }]);
      setStatus("idle");
    } catch (err) {
      if (err.name === "AbortError") return;
      setStatus("error");
      await updateChatMessages(chatId, [...updated, { ...assistantMsg, typing: false, content: `⚠️ ${err.message || 'Connection failed'}` }]);
    }
    setAttachments([]); setInputText("");
  }, [activeChatId, activeMessages, model, temperature, status, attachments, generateImage, councilMode, userPlan]);

  const upgrade = async (planType) => {
    try { const r = await api('/api/create-checkout-session', { method: 'POST', body: JSON.stringify({ plan: planType }) }); const data = await r.json(); if (data.url) window.location.href = data.url; } catch {}
  };
  const manageSubscription = async () => {
    try { const r = await api('/api/create-portal-session', { method: 'POST' }); const data = await r.json(); if (data.url) window.location.href = data.url; } catch { setToast('No active subscription'); }
  };

  const theme = THEMES[themeKey] || THEMES.nebula;
  const primary = customPrimary || theme.primary;
  const bgLayerStyle = customBg ? { backgroundImage: `url(${customBg})` } : { backgroundImage: theme.bg };
  const overlayStyle = { backgroundColor: `rgba(0,0,0,${1 - bgOpacity})` };

  if (!isLoaded) return null;

  return (
    <div className="app-root" style={{ "--primary": primary, "--border": theme.border, "--glow": theme.glow }}>
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
            <span className="sub-title">{councilMode ? `AI Council • ${userPlan === 'pro' ? '14 models' : '4 models'}` : getModelDisplayName(model)}</span>
          </div>
          <div className="header-actions">
            {isAdmin && <button className={`icon-btn admin-btn ${showAdmin ? "active" : ""}`} onClick={() => { setShowAdmin(s => !s); setShowSettings(false); setShowMemory(false); }} title="Admin"><Icon name="crown" size={20} /></button>}
            <button className={`icon-btn ${showMemory ? "active" : ""}`} onClick={() => { setShowMemory(s => !s); setShowSettings(false); setShowAdmin(false); }} title="Memory"><Icon name="brain" size={20} /></button>
            <button className="icon-btn" onClick={() => setShowPricing(true)} title="Upgrade"><Icon name="upgrade" size={20} /></button>
            <button className="icon-btn" onClick={() => { setShowSettings(s => !s); setShowMemory(false); setShowAdmin(false); }} title="Settings"><Icon name="settings" size={20} /></button>
            <SignOutButton><button className="icon-btn" title="Sign out"><Icon name="user" size={20} /></button></SignOutButton>
          </div>
        </header>
        <div className="app-body">
          <ChatSidebar chats={sortedChats} activeChatId={activeChatId} onSelect={setActiveChatId} onCreate={createChat} onDelete={deleteChat} onRename={renameChat} onPin={togglePinChat} onFavorite={toggleFavoriteChat} collapsed={sidebarCollapsed} mobileOpen={mobileSidebarOpen} setMobileOpen={setMobileSidebarOpen} />
          <div className="chat-main">
            {showPricing && <>
              <div className="panel-overlay" onClick={() => setShowPricing(false)} />
              <div className="side-panel">
                <div className="panel-header">
                  <div className="panel-title">Upgrade your plan 🚀</div>
                  <button onClick={() => setShowPricing(false)} className="icon-btn"><Icon name="close" size={18} /></button>
                </div>
                <div className="panel-body">
                  <div style={{ textAlign: 'center', marginBottom: 24, fontSize: 15, opacity: 0.6 }}>
                    Unlock AI Council with all 14 models, unlimited images, vision, voice, and priority support.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="memory-card" style={{ border: '1px solid rgba(255,255,255,0.1)', position: 'relative', padding: 18, borderRadius: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)' }} /><div style={{ fontSize: 16, fontWeight: 700 }}>Pro Monthly</div></div>
                        <div><div style={{ fontSize: 22, fontWeight: 800 }}>$8<span style={{ fontSize: 12, opacity: 0.5 }}>/month</span></div><div style={{ fontSize: 12, opacity: 0.5, textAlign: 'right' }}>$0.27/day</div></div>
                      </div>
                    </div>
                    <div className="memory-card" style={{ border: '1px solid #fbbf24', position: 'relative', padding: 18, borderRadius: 16 }}>
                      <div style={{ position: 'absolute', top: -10, right: 14, background: '#3b82f6', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 12 }}>Save 17%</div>
                      <div style={{ position: 'absolute', top: -10, left: 14, background: '#fbbf24', color: '#000', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 12 }}>Most Popular</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #fbbf24', background: '#fbbf24' }} /><div style={{ fontSize: 16, fontWeight: 700 }}>Pro Yearly</div></div>
                        <div><div style={{ fontSize: 22, fontWeight: 800 }}>$80<span style={{ fontSize: 12, opacity: 0.5 }}>/year</span></div><div style={{ fontSize: 12, opacity: 0.5, textAlign: 'right' }}>$0.22/day</div></div>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => upgrade('yearly')} className="new-chat-btn" style={{ width: '100%', marginTop: 16, background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', borderRadius: 14, padding: 14, fontSize: 15 }}>Continue</button>
                  <div className="sign-in-trust-badges" style={{ marginTop: 16 }}><span>🔒</span> Pay safe & secure</div>
                  <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Pro includes</div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, opacity: 0.8, lineHeight: 1.9 }}>
                      <li>✅ AI Council with 14 models</li>
                      <li>✅ Unlimited image generation</li>
                      <li>✅ Vision & file analysis</li>
                      <li>✅ Voice input</li>
                      <li>✅ Cloud sync & priority support</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>}
            {showAdmin && isAdmin && <>
              <div className="panel-overlay" onClick={() => setShowAdmin(false)} />
              <div className="side-panel">
                <div className="panel-header"><div className="panel-title">Admin Dashboard</div><button onClick={() => setShowAdmin(false)} className="icon-btn"><Icon name="close" size={18} /></button></div>
                <div className="panel-body">
                  <div className="admin-title">{adminUsers.length} Users</div>
                  {adminUsers.map(u => (
                    <div key={u.id} className="admin-user-card">
                      <div className="admin-user-header">
                        <img src={u.avatar_url || 'https://via.placeholder.com/36'} alt="" className="admin-avatar" />
                        <div><div style={{ fontWeight: 600, fontSize: 13 }}>{u.name || 'Anonymous'}</div><div style={{ fontSize: 11, opacity: 0.6 }}>{u.email || 'No email'}</div></div>
                        <span className={`admin-badge ${u.plan === 'pro' ? 'pro' : 'free'}`}>{u.plan || 'free'}</span>
                        {u.is_admin && <span className="admin-badge admin">Admin</span>}
                      </div>
                      <div className="msg-actions" style={{ justifyContent: 'flex-start', marginTop: 8, opacity: 1 }}>
                        {u.suspended ? <button onClick={() => adminUnsuspend(u.id)} className="msg-action-btn">Unsuspend</button> : <button onClick={() => adminSuspend(u.id)} className="msg-action-btn">Suspend</button>}
                        <button onClick={() => adminDeleteUser(u.id)} className="msg-action-btn" style={{ color: '#fb7185' }}>Delete User</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>}
            {showMemory && <>
              <div className="panel-overlay" onClick={() => setShowMemory(false)} />
              <div className="side-panel">
                <div className="panel-header"><div className="panel-title">Memory</div><button onClick={() => setShowMemory(false)} className="icon-btn"><Icon name="close" size={18} /></button></div>
                <div className="panel-body"><div className="memory-card"><div className="memory-card-title">AI Instructions</div><textarea className="custom-input textarea" placeholder="Tell the AI how to behave..." /></div></div>
              </div>
            </>}
            {showSettings && <>
              <div className="panel-overlay" onClick={() => setShowSettings(false)} />
              <div className="side-panel">
                <div className="panel-header"><div className="panel-title">Settings</div><button onClick={() => setShowSettings(false)} className="icon-btn"><Icon name="close" size={18} /></button></div>
                <div className="panel-body">
                  <div className="setting-row"><div className="setting-label">Theme</div><div className="theme-grid">{Object.keys(THEMES).map(k => <button key={k} onClick={() => setThemeKey(k)} className={`theme-card ${themeKey === k ? "selected" : ""}`} style={{ textTransform: "capitalize" }}>{k}</button>)}</div></div>
                  <div className="setting-row"><div className="setting-label">Background</div><input className="custom-input" type="text" value={customBg} onChange={e => setCustomBg(e.target.value)} placeholder="Image URL" /><div className="theme-grid">{Object.entries(BACKGROUND_PRESETS).map(([k, url]) => <button key={k} onClick={() => setCustomBg(url)} className="theme-card" style={{ textTransform: "capitalize" }}>{k}</button>)}<button onClick={() => setCustomBg("")} className="theme-card">Reset</button></div></div>
                  <div className="setting-row"><div className="setting-label">Intensity: {Math.round(bgOpacity * 100)}%</div><div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}><span>Dim</span><input type="range" min="0" max="1" step="0.05" value={bgOpacity} onChange={e => setBgOpacity(parseFloat(e.target.value))} className="slider" /><span>Bright</span></div></div>
                  <div className="setting-row"><div className="setting-label">Button Color</div><input type="color" value={customPrimary || primary} onChange={e => setCustomPrimary(e.target.value)} style={{ width: 50, height: 36, borderRadius: 8, border: "none" }} />{customPrimary && <button onClick={() => setCustomPrimary("")} className="theme-card">Reset</button>}</div>
                  <div className="setting-row"><div className="setting-label">AI Model</div><select value={model} onChange={e => setModel(e.target.value)} className="model-select"><optgroup label="Fast Models">{MODELS.fast.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}</optgroup><optgroup label="Reasoning Models">{MODELS.reasoning.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}</optgroup></select></div>
                  <div className="setting-row"><div className="setting-label">Creativity: {temperature.toFixed(1)}</div><div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}><span>Precise</span><input type="range" min="0" max="1" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} className="slider" /><span>Creative</span></div></div>
                  <div className="setting-row"><button onClick={() => activeChatId && deleteChat(activeChatId)} className="theme-card">Delete Chat</button></div>
                </div>
              </div>
            </>}
            <div className="chat-content">
              <div className="scroll-wrapper" ref={chatRef}>
                {activeMessages.length === 0 && status === "idle" && <div className="empty-state">
                  <h2 className="empty-title">ALOP-AI</h2>
                  <p className="empty-subtitle">{councilMode ? "The AI Council combines multiple models to give you the best possible answer." : "Ask anything, upload photos, take a picture, use your voice, or type 'generate image of...'"}</p>
                </div>}
                {activeMessages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`msg-row ${msg.role}`}>
                    <div className="avatar">{msg.role === "user" ? "YOU" : msg.isCouncil ? "C" : "AI"}</div>
                    <div className="msg-content">
                      {msg.typing && <div className="bubble typing-bubble"><span></span><span></span><span></span></div>}
                      {msg.content && !msg.typing && <div className="bubble">{msg.content}</div>}
                      {msg.imageUrl && <div style={{ marginTop: 8 }}><img src={msg.imageUrl} alt="Generated" style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 12, cursor: "pointer" }} onClick={() => window.open(msg.imageUrl, "_blank")} /><div className="msg-meta" style={{ textAlign: "left" }}>{msg.imagePrompt}</div></div>}
                      {msg.attachments?.length > 0 && <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>{msg.attachments.map((a, i) => <img key={i} src={a.url} alt={a.name} style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover" }} />)}</div>}
                      {msg.role === "assistant" && !msg.imageUrl && !msg.typing && <MessageActions content={msg.content} onCopy={() => navigator.clipboard.writeText(msg.content)} />}
                      <div className="msg-meta">{msg.ts}{msg.isCouncil ? " • AI Council" : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
              <InputBar text={inputText} setText={setInputText} onSend={handleSend} disabled={status !== "idle"} attachments={attachments} setAttachments={setAttachments} onFileSelect={handleFileSelect} onStartCamera={startCamera} isListening={isListening} toggleListening={toggleListening} councilMode={councilMode} setCouncilMode={setCouncilMode} plan={userPlan} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  return (
    <ClerkProvider
      publishableKey={clerkKey}
      signInUrl="/"
      signUpUrl="/"
      afterSignInUrl="/"
      afterSignUpUrl="/"
      appearance={{
        baseTheme: "dark",
        variables: { colorPrimary: "#3b82f6", colorBackground: "#0f0f14", colorText: "#ffffff" }
      }}
    >
      <div style={{ width: "100vw", height: "100dvh" }}><AuthenticatedAppWrapper /></div>
    </ClerkProvider>
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
              <div className="feature-row header"><div className="feature-name">Feature</div><div>Free</div><div>Pro</div></div>
              {[
                { icon: "🧠", name: "AI Council models", free: "4", pro: "14" },
                { icon: "🖼️", name: "Image Generation", free: false, pro: true },
                { icon: "👁️", name: "Vision & Files", free: false, pro: true },
                { icon: "🎙️", name: "Voice Input", free: false, pro: true },
                { icon: "☁️", name: "Cloud Sync", free: true, pro: true },
                { icon: "💬", name: "Unlimited Messages", free: false, pro: true },
              ].map((f, i) => (
                <div className="feature-row" key={i}>
                  <div className="feature-name"><div className="feature-icon">{f.icon}</div><div>{f.name}</div></div>
                  <div style={{ textAlign: 'center', fontSize: 12, opacity: 0.7 }}>{typeof f.free === 'boolean' ? (f.free ? <span className="feature-check">✓</span> : <span className="feature-cross">×</span>) : f.free}</div>
                  <div style={{ textAlign: 'center', fontSize: 12, opacity: 0.7 }}>{typeof f.pro === 'boolean' ? (f.pro ? <span className="feature-check">✓</span> : <span className="feature-cross">×</span>) : f.pro}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 'auto', fontSize: 12, opacity: 0.4, paddingTop: 20 }}>Sign in free to sync chats. Upgrade to Pro for full AI Council power.</div>
          </div>
          <div className="sign-in-form-side">
            <div className="sign-in-logo">
              <div className="sign-in-logo-icon">A</div>
              <div className="sign-in-logo-text">ALOP-AI</div>
            </div>
            <div className="sign-in-form-title">Sign in to ALOP-AI</div>
            <div className="sign-in-form-subtitle">One account for every frontier AI model. Chat with a council of models, generate images, analyze files, and build your knowledge base.</div>
            <div className="sign-in-card"><SignIn fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" /></div>
            <div className="sign-in-trust-badges"><span>🔒</span> Secure authentication<span>•</span><span>No credit card required</span></div>
            <div className="payment-icons"><div className="payment-icon">VISA</div><div className="payment-icon">MC</div><div className="payment-icon">AMEX</div><div className="payment-icon">PP</div></div>
          </div>
        </div>
      </div>
    );
  }
  return <AuthenticatedApp />;
};

export default App;
