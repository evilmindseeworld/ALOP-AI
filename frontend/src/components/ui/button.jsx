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
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
    "disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        outline: "border border-border bg-transparent hover:bg-muted",
        secondary: "bg-muted text-foreground hover:opacity-90",
        ghost: "bg-transparent hover:bg-muted",
        link: "bg-transparent underline-offset-4 hover:underline text-primary",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  // asChild renders the caller's element with these classes instead of a
  // <button> — needed whenever a trigger must be an <a> or a Radix child.
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

Button.displayName = "Button";

export { Button, buttonVariants };
