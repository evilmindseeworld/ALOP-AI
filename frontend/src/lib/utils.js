import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, with later Tailwind utilities beating earlier ones.
 *
 * `clsx` flattens conditionals; `twMerge` resolves conflicts so
 * `cn("px-2", "px-4")` yields `px-4` rather than both. Every shadcn component
 * uses this so a caller's className can override the variant's.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default cn;
