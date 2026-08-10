import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Variants are data, not branches.
 *
 * The alternative — a `variant` prop read through a chain of ternaries — is
 * what produces the "add one more boolean prop" drift that filled App.css with
 * duplicate rules. CVA keeps the whole matrix in one readable place.
 */
const buttonVariants = cva(
  "relative isolate inline-flex w-fit origin-center items-center justify-center gap-2 select-none " +
    "whitespace-nowrap rounded-md text-sm font-medium [-webkit-tap-highlight-color:transparent] " +
    // Two clocks, not one. Colour feedback has to land on the frame the pointer
    // goes down, so it runs at --dur-fast; the press scale reads as a physical
    // squash only if the release eases back, so it runs at --dur on the spring.
    // A single `transition-colors` gave the first and dropped the second.
    "[transition:transform_var(--dur)_var(--ease-spring),background-color_var(--dur-fast)_var(--ease-out),filter_var(--dur-fast)_var(--ease-out)] " +
    // The scale is motion, not decoration, so it goes when the user has asked
    // for less of it — otherwise reduced-motion keeps the instant snap, which
    // is the jarring half of the effect with none of the softening.
    "motion-reduce:transition-none motion-reduce:active:scale-100 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    // An icon inside a button must never be the thing that sets its height, and
    // must never swallow the click that was aimed at the button.
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // brightness, not opacity, for the filled variants. `opacity-90` fades
        // the label along with the fill and lets whatever sits behind the
        // button bleed through it; every hand-written filled button in
        // App.css already hovers with `filter: brightness(1.06–1.08)`.
        default: "bg-primary text-primary-foreground hover:brightness-[1.07]",
        destructive: "bg-destructive text-destructive-foreground hover:brightness-[1.07]",
        outline: "border border-border bg-transparent hover:bg-muted",
        secondary: "bg-muted text-foreground hover:brightness-[1.07]",
        ghost: "bg-transparent hover:bg-muted",
        link: "bg-transparent underline-offset-4 hover:underline text-primary",
      },
      size: {
        // The press scale shrinks as the button grows. A fixed 0.97 is a 1px
        // move on a small button and a 4px lurch on a wide one; matching the
        // ratio to the size is what makes both read as the same press.
        default: "h-9 px-4 py-2 active:scale-[0.97]",
        sm: "h-8 rounded-md px-3 text-xs active:scale-[0.98]",
        lg: "h-10 rounded-md px-8 active:scale-[0.96]",
        icon: "h-9 w-9 active:scale-[0.97]",
      },
      fullWidth: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "default", size: "default", fullWidth: false },
  }
);

const Button = React.forwardRef(
  ({ className, variant, size, fullWidth, asChild = false, ...props }, ref) => {
    // asChild renders the caller's element with these classes instead of a
    // <button> — needed whenever a trigger must be an <a> or a Radix child.
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
