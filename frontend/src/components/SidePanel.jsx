import { createPortal } from "react-dom";
import { useEffect } from "react";

/**
 * A slide-in panel (settings / admin / upgrade) rendered through a portal to
 * document.body.
 *
 * THE PORTAL IS THE WHOLE POINT — do not "simplify" it away.
 *
 * These panels used to be nested inside .chat-main, which sits at --z-chat (3)
 * and is positioned, so it creates a stacking context. Everything inside it is
 * composited within that context, which means the panel's --z-panel (70) was
 * effectively "3.70" in the root context — below the earring ornament at
 * --z-earring (4). The earrings visibly overlapped the settings menu.
 *
 * Comparing 70 > 4 and concluding the panel wins is exactly the mistake that
 * kept this bug alive: z-index values in different stacking contexts are not
 * comparable. Rendering to document.body puts the panel in the root context,
 * where its 70 competes with the earring's 4 for real.
 */
export default function SidePanel({ open, title, onClose, children }) {
  // Escape closes. Registered only while open so a stack of panels does not
  // accumulate listeners, and so it does not steal Escape from the palette.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="panel-overlay" onClick={onClose} role="presentation" />
      <div className="side-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-header">
          <div className="panel-title">{title}</div>
          <button onClick={onClose} className="icon-btn" aria-label={`Close ${title}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </>,
    document.body
  );
}
