import { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Draggable from "react-draggable";
import { API_BASE } from "../lib/api";
import { markdownComponents } from "../components/MessageList";
import useSpeechRecognition from "../hooks/useSpeechRecognition";

/**
 * The always-on-top desktop overlay.
 *
 * Rendered instead of the main app when the URL carries `overlay=true`, and
 * deliberately OUTSIDE .app-root — it has no theme class, because the overlay
 * window is always dark whatever the main window is set to. Any token it
 * consumes therefore has to be reachable from :root, which the cascade
 * snapshot checks.
 *
 * It talks to /api/overlay rather than /api/council: a single fast answer with
 * optional vision, not a deliberating council.
 */
export default function OverlayAssistant() {
  const { getToken } = useAuth();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const inputRef = useRef(null);
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
      // Dictation is not stopped here: useSpeechRecognition ends its own
      // session on unmount, and calling stop() from two places raced — the
      // hook's cleanup found a session this one had already cleared.
      stopSpeaking();
      stopLiveStream();
    }; 
  }, []);

  const stopSpeaking = () => { window.speechSynthesis.cancel(); setIsSpeaking(false); };
  const speak = (text) => { if (!text) return; stopSpeaking(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.15; u.onend = () => setIsSpeaking(false); window.speechSynthesis.speak(u); setIsSpeaking(true); };
  /**
   * Dictation, from the shared hook rather than a second implementation.
   *
   * This file used to carry its own copy of the SpeechRecognition lifecycle,
   * and the two had already drifted: the overlay's version had NO ten-second
   * ceiling, so a session that never fired `onend` — which is exactly what
   * happens when the overlay window loses focus, and this window loses focus
   * constantly because it is an always-on-top bar over other apps — left the
   * microphone indicator lit with no way to clear it. The hook has had that
   * ceiling and a test for it the whole time.
   *
   * It also called `alert()` on an unsupported browser, which in a frameless
   * always-on-top window is a modal the user cannot obviously dismiss.
   */
  const { isListening: isRecording, toggle: toggleRecording } = useSpeechRecognition({
    onTranscript: (text) => {
      setQuery((p) => p + text);
      inputRef.current?.focus();
    },
    onUnsupported: () => setAnswer("Dictation needs Chrome or Edge. Type your question instead."),
  });
  
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
          {/* The mic and the attach control had no accessible name at all —
              a screen reader announced "button" and an icon. Every other
              control in this bar already had a title; these two were missed. */}
          <button type="button" className={`overlay-action ${isRecording ? 'recording' : ''}`} onClick={toggleRecording} disabled={status === 'loading'} title={isRecording ? 'Stop dictating' : 'Dictate'} aria-label={isRecording ? 'Stop dictating' : 'Dictate'} aria-pressed={isRecording}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
          </button>
          <button className="overlay-submit" type="submit" disabled={status === 'loading' || (!query.trim() && !attachment)}>{status === 'loading' ? '...' : '→'}</button>
        </form>
      </div>
    </Draggable>
  );
}
