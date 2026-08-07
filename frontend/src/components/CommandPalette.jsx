import { useState, useEffect, useMemo, useRef, useCallback } from "react";

/**
 * Ctrl/Cmd-K palette: jump to any chat, or run an action.
 *
 * Chat search did not exist before this. The sidebar lists every chat with no
 * filter, so finding an old conversation meant scrolling and reading titles.
 *
 * Deliberately presentational — it receives chats and actions and reports what
 * was chosen. That keeps it testable without Clerk, routing, or a live backend.
 *
 * HAND-ROLLED ON PURPOSE, not for want of a library. Replacing this with cmdk
 * was tried and rejected: cmdk's input is `role="combobox"` where these tests
 * reach for a textbox, and the ordering below — actions first when the query is
 * empty, chats first once you type — means it would have to run with
 * `shouldFilter={false}`, disabling the thing it exists to do. The `.cmdk-*`
 * class names predate that decision and are just names. See FRONTEND.md §9.
 */
export default function CommandPalette({ open, onClose, chats = [], actions = [], onSelectChat }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const listRef = useRef(null);

  // Each entry is normalised to the same shape so keyboard handling and
  // rendering never branch on "is this a chat or an action".
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (text) => !q || (text || "").toLowerCase().includes(q);

    const actionItems = actions
      .filter((a) => match(a.label) || match(a.hint))
      .map((a) => ({ kind: "action", key: `action:${a.id}`, label: a.label, hint: a.hint, icon: a.icon, run: a.run }));

    const chatItems = chats
      .filter((c) => match(c.title || "New Chat"))
      .slice(0, 40)
      .map((c) => ({ kind: "chat", key: `chat:${c.id}`, label: c.title || "New Chat", hint: "Chat", icon: "💬", run: () => onSelectChat(c.id) }));

    // Actions first when the box is empty (they are the reason to open it
    // cold); once you type, chats lead because you are almost certainly
    // searching for one.
    return q ? [...chatItems, ...actionItems] : [...actionItems, ...chatItems];
  }, [query, chats, actions, onSelectChat]);

  /**
   * Open: remember who opened us, then take focus.
   * Close: give it back.
   *
   * `aria-modal="true"` was already declared here, which PROMISES a screen
   * reader that everything outside this element is inert. Nothing enforced
   * it: Tab walked straight out into the page behind, and on close focus
   * landed on <body>, so the next Tab restarted from the top of the document.
   * A keyboard user who opened the palette and pressed Escape lost their
   * place entirely.
   */
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    const opener = document.activeElement;
    // Effects run after commit, so the input is already in the DOM — no rAF
    // needed. Focusing synchronously also means the first keystroke after
    // opening is never dropped.
    inputRef.current?.focus();
    return () => {
      // Only if it is still in the document: the opener may have been a chat
      // row that the action just deleted.
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open]);

  // Clamp rather than reset, so deleting a character does not throw away a
  // selection that is still in range.
  useEffect(() => { setCursor((c) => Math.min(c, Math.max(items.length - 1, 0))); }, [items.length]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const runItem = useCallback((item) => {
    if (!item) return;
    onClose();
    item.run();
  }, [onClose]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }

    /* THE TRAP. Two focusable stops exist in practice — the input and
     * whichever item the pointer last touched — so rather than enumerate
     * them, Tab is simply kept inside: forward from anywhere returns to the
     * input, and the list is driven by the arrow keys that already work.
     * This is what aria-modal already claimed was true. */
    if (e.key === "Tab") {
      const focusable = dialogRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (items.length ? (c + 1) % items.length : 0)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (items.length ? (c - 1 + items.length) % items.length : 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); runItem(items[cursor]); }
  };

  if (!open) return null;

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        // Stops a click inside the panel reaching the backdrop's close handler.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdk-search">
          <span className="cmdk-search-icon" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search chats, or run a command..."
            aria-label="Search chats or run a command"
            aria-controls="cmdk-list"
            autoComplete="off"
          />
          <kbd className="cmdk-kbd">esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-list" ref={listRef} role="listbox" aria-label="Results">
          {items.length === 0 && <div className="cmdk-empty">No matches for “{query}”</div>}
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected={i === cursor}
              data-active={i === cursor}
              className={`cmdk-item ${i === cursor ? "is-active" : ""}`}
              // mouseenter, not focus: the input keeps focus so typing continues
              // to work while the pointer moves over the list.
              onMouseEnter={() => setCursor(i)}
              onClick={() => runItem(item)}
            >
              <span className="cmdk-item-icon" aria-hidden="true">{item.icon}</span>
              <span className="cmdk-item-label">{item.label}</span>
              {item.hint && <span className="cmdk-item-hint">{item.hint}</span>}
            </button>
          ))}
        </div>

        <div className="cmdk-footer">
          <span><kbd className="cmdk-kbd">↑</kbd><kbd className="cmdk-kbd">↓</kbd> navigate</span>
          <span><kbd className="cmdk-kbd">↵</kbd> select</span>
          <span>{items.length} result{items.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
