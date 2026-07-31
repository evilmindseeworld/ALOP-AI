/**
 * A blank page is the hardest prompt to answer.
 *
 * Each starter exercises a different path through the backend — deliberation,
 * live web search, code reasoning, image generation — so a first-time user
 * sees what the council actually does rather than guessing at it. They are one
 * click to a real reply, not placeholder copy.
 */
export const STARTERS = [
  {
    icon: "⚖️",
    label: "Weigh a decision",
    prompt:
      "Should I use PostgreSQL or MongoDB for a social app with heavy relational queries? Argue both sides, then commit to one.",
  },
  {
    icon: "\u{1F50D}",
    label: "Search the live web",
    prompt: "What changed in the most recent React release, and should I upgrade?",
  },
  {
    icon: "\u{1F41B}",
    label: "Debug some code",
    prompt: "Why would a React useEffect run twice on mount, and when is that actually a bug?",
  },
  {
    icon: "\u{1F3A8}",
    label: "Generate an image",
    prompt: "/image a bioluminescent jellyfish drifting through a neon city skyline at night",
  },
];

export default STARTERS;
