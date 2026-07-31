import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A slide-in panel, built on Radix Dialog.
 *
 * WHAT THIS BUYS OVER THE HAND-ROLLED SidePanel
 *
 * 1. A real focus trap. The old panel registered an Escape handler and nothing
 *    else, so Tab from an open settings panel walked straight into the chat
 *    behind it — invisible to a mouse user, and completely broken for anyone
 *    navigating by keyboard.
 * 2. aria-modal plus inert on the rest of the page, so a screen reader does
 *    not read the transcript underneath an open dialog.
 * 3. Focus returns to the trigger on close, which the old one never did.
 *
 * It keeps the portal for the same reason the original had one: a panel
 * rendered inside .chat-main is trapped in that element's stacking context and
 * loses to the earring ornament whatever its z-index says. docs/FRONTEND.md §1.
 */
const sheetVariants = cva("fixed z-panel bg-popover text-foreground shadow-lg", {
  variants: {
    side: {
      top: "inset-x-0 top-0 border-b border-border",
      bottom: "inset-x-0 bottom-0 border-t border-border",
      left: "inset-y-0 left-0 h-full w-3/4 border-r border-border sm:max-w-sm",
      right: "inset-y-0 right-0 h-full w-3/4 border-l border-border sm:max-w-sm",
    },
  },
  defaultVariants: { side: "right" },
});

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef(({ side = "right", className, children, title, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-panel-overlay bg-black/40" />
    <DialogPrimitive.Content
      ref={ref}
      data-ui-scope=""
      className={cn(sheetVariants({ side }), "flex flex-col", className)}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <DialogPrimitive.Title className="text-sm font-semibold tracking-wide">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close
          className="rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={`Close ${title}`}
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));

SheetContent.displayName = "SheetContent";

export { Sheet, SheetTrigger, SheetClose, SheetContent, sheetVariants };
