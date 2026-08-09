import { Sheet, SheetContent } from "@/components/ui/sheet";

/**
 * A slide-in panel (settings / admin / upgrade).
 *
 * Now a thin adapter over the Radix-backed Sheet, keeping the original
 * `open` / `title` / `onClose` shape so the three call sites did not all have
 * to change at once.
 *
 * THE PORTAL IS STILL THE WHOLE POINT — do not "simplify" it away.
 *
 * These panels used to be nested inside .chat-main, which sits at --z-chat (3)
 * and is positioned, so it creates a stacking context. Everything inside it is
 * composited within that context, which means the panel's --z-panel (70) was
 * effectively "3.70" in the root context — below the earring ornament at
 * --z-ornament (4). The decoration visibly overlapped the settings menu.
 *
 * Comparing 70 > 4 and concluding the panel wins is exactly the mistake that
 * kept that bug alive: z-index values in different stacking contexts are not
 * comparable. Sheet renders through a Radix portal to document.body, which
 * puts the panel in the root context where its 70 competes with the earring's
 * 4 for real. zIndexOrder.test.js asserts this.
 *
 * What the migration added, none of which the hand-rolled version had:
 *
 *   - A focus trap. Tab from an open panel used to walk straight into the chat
 *     behind it — invisible with a mouse, and unusable by keyboard.
 *   - Focus returned to whatever opened the panel when it closes.
 *   - The rest of the page hidden from assistive tech while it is open, so a
 *     screen reader does not read the transcript underneath.
 *   - Scroll lock, so the chat does not scroll behind an open panel.
 *
 * Escape still closes it; that behaviour now comes from Radix rather than a
 * hand-registered window listener.
 */
export default function SidePanel({ open, title, onClose, children }) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" title={title} className="side-panel">
        {children}
      </SheetContent>
    </Sheet>
  );
}
