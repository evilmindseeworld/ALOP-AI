import { cn } from "@/lib/utils";

/**
 * A loading placeholder. The pulse honours prefers-reduced-motion because
 * Tailwind's animate-pulse is disabled by the reduced-motion block in
 * styles/utilities.css, which forces animation-duration for every element.
 */
function Skeleton({ className, ...props }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
