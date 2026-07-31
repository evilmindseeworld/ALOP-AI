/**
 * A blank page is the hardest prompt to answer.
 *
 * Each starter exercises a different path through the backend — deliberation,
 * live web search, code reasoning, image generation — so a first-time user
 * sees what the council actually does rather than guessing at it. They are one
 * click to a real reply, not placeholder copy.
 *
 * `icon` is a name from components/Icon, not an emoji. Emoji render as a
 * different glyph on every platform, ignore `currentColor` — so they cannot
 * follow the theme — and are the first item on the icon rule in the
 * pre-delivery checklist.
 */
export const STARTERS = [
  {
    icon: "scale",
    label: "Weigh a decision",
    prompt:
      "Should I use PostgreSQL or MongoDB for a social app with heavy relational queries? Argue both sides, then commit to one.",
  },
  {
    icon: "search",
    label: "Search the live web",
    prompt: "What changed in the most recent React release, and should I upgrade?",
  },
  {
    icon: "bug",
    label: "Debug some code",
    prompt: "Why would a React useEffect run twice on mount, and when is that actually a bug?",
  },
  {
    icon: "sparkles",
    label: "Generate an image",
    prompt: "/image a bioluminescent jellyfish drifting through a neon city skyline at night",
  },
];

export default STARTERS;
