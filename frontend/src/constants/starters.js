/**
 * A blank page is the hardest prompt to answer.
 *
 * THESE USED TO SEND A FINISHED QUESTION. "Generate an image" sent a
 * bioluminescent jellyfish drifting through a neon city skyline; "Weigh a
 * decision" sent a PostgreSQL-versus-MongoDB argument. One click, a real reply,
 * and a demonstration of what the council does — which was the intent, and it
 * was wrong in a way that only shows up once somebody uses it.
 *
 * Nobody arrives wanting a jellyfish. A card that commits you to a question you
 * did not ask is not a shortcut, it is a detour: you wait for an answer about
 * MongoDB, read none of it, and start again. Reported directly — "make it so it
 * doesn't force a prompt when a user presses suggestions".
 *
 * So a starter is now a SEED, not a prompt. Clicking one writes an opening
 * fragment into the composer and puts the cursor after it. Nothing is sent, no
 * model runs, and the user finishes the sentence themselves.
 *
 * WHY A SEED RATHER THAN ASKING THE MODEL "what do you want to generate?".
 * That was the other obvious reading of the request, and it costs a whole
 * council turn to produce a question the interface can ask for free and
 * instantly. It would also put a message in the transcript that the user never
 * asked for. The composer asking is the same conversation, minus the wait.
 *
 * Each seed still exercises a different path through the backend once
 * completed — deliberation, live web search, code reasoning, image generation —
 * so the range is still on display.
 *
 * `icon` is a name from components/Icon, not an emoji. Emoji render as a
 * different glyph on every platform and ignore `currentColor`, so they cannot
 * follow the theme.
 */
export const STARTERS = [
  {
    icon: "scale",
    label: "Weigh a decision",
    // Trailing spaces are load-bearing: the cursor lands after them, so the
    // user types their own words rather than fixing the spacing first.
    seed: "Help me decide between ",
    hint: "…and what matters most in the choice",
  },
  {
    icon: "search",
    label: "Search the live web",
    seed: "What changed recently with ",
    hint: "…a product, a release, a story",
  },
  {
    icon: "bug",
    label: "Debug some code",
    seed: "Why does ",
    hint: "…paste the code or describe the bug",
  },
  {
    icon: "sparkles",
    // The one starter that reaches the client-side image path. The `/image`
    // command has to lead, because that prefix is what routes it.
    label: "Generate an image",
    seed: "/image ",
    hint: "…describe what you want to see",
  },
];

export default STARTERS;
