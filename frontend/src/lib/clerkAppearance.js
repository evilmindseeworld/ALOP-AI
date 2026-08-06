/**
 * How Clerk's own components are themed.
 *
 * THIS REPLACES 21 CSS RULES that named Clerk's internal classes
 * (`.signin-card-inner .cl-formButtonPrimary`, and so on). Clerk warns about
 * exactly that pattern, on every page load, in production:
 *
 *   "Structural CSS detected that may break on updates. These selectors depend
 *    on the internal DOM structure of Clerk's components, which may change when
 *    Clerk deploys component updates."
 *
 * It is the sign-in and sign-up screens, so the failure mode is the first thing
 * every new user sees losing its styling on a day nobody deployed anything.
 *
 * WHAT THIS DOES TO `!important`: 52 declarations become 3 properties. Measured
 * in the browser rather than guessed. Clerk styles the submit button with
 *
 *   .cl-internal-…[data-variant="solid"][data-color="primary"]
 *
 * — specificity 0,3,0, against 0,2,0 for `.signin-card-inner
 * .cl-formButtonPrimary`. Every one of those 52 declarations existed to lose a
 * cascade fight; it was not a habit, it was the only thing that worked.
 *
 * Most of them are simply unnecessary now. Styles passed here are merged into
 * the component's own hashed class, so anything Clerk does not also set at
 * variant level takes our value with no keyword at all — background, colour,
 * font, radius, padding, gap. `box-shadow` and `border` ARE set at variant
 * level, so those still need pinning; see `win` below. That is the honest
 * number: not zero, three.
 *
 * `cssHygiene.test.js` predicted the direction — "if Clerk ever ships a real
 * theming API, this number should fall to zero" — and it falls to zero IN CSS,
 * which is the part that mattered. The residue is in JS, attached to no
 * selector, and is counted by that test rather than left to be rediscovered.
 *
 * `var(--…)` values are deliberate. Custom properties resolve against the
 * document at paint time, so both themes keep working exactly as they did when
 * these lived in the stylesheet; hardcoding the resolved colours here would
 * quietly pin the sign-in card to whichever theme was active when it was
 * written.
 *
 * WHAT IS NOT HERE. `.cl-internalNavigation` had a rule and matches no element
 * in either flow — it was already dead and is not carried over.
 *
 * The layout half — making Clerk's card transparent so it does not read as a
 * second frame inside `.signin-card` — is `RESET`, applied to the five wrapper
 * elements. Its reasoning is worth keeping: `rootBox` sizes to its content, so
 * it was 249px inside a 338px card and everything inside inherited that width.
 * The form was not off-centre; it was left-aligned inside a box narrower than
 * the one it appeared to be in, which looks identical and has a different
 * cause.
 */

/** Clerk ships its own card. We already have one, so its chrome is removed. */
const RESET = {
  background: "transparent",
  border: "none",
  boxShadow: "none",
  borderRadius: 0,
  // Padding too, and leaving it out is what made the form look off-centre:
  // Clerk's card pads horizontally, `.signin-card` pads horizontally, and
  // several of Clerk's inner elements are full-bleed to their own container and
  // so reached the right edge anyway. One source of padding: ours.
  padding: 0,
  width: "100%",
};

/**
 * THREE PROPERTIES STILL NEED `!important`, and the reason is measured.
 *
 * Clerk merges everything in `elements` into the component's own hashed class —
 * `.cl-internal-e0o5zr`, specificity 0,1,0. Its variant styling sits on
 *
 *   .cl-internal-e0o5zr[data-variant="solid"][data-color="primary"]
 *
 * at 0,3,0, and that rule sets `box-shadow` and `border`. So a property Clerk
 * does not set at variant level (background, colour, font, radius, padding)
 * takes ours, and a property it does set beats ours — silently, and only for
 * those two. Caught by diffing computed styles before and after: the button
 * kept its gradient and lost its inset highlights, which is the kind of change
 * that looks like nothing in a screenshot and is wrong.
 *
 * `!important` here is NOT the old problem wearing a new hat. What made the 21
 * deleted CSS rules dangerous was naming `.cl-*` selectors — a dependency on
 * Clerk's internal DOM, which Clerk warns it changes between releases. These
 * declarations name no selector at all; they are handed to the supported API
 * and Clerk decides where they land. If Clerk restructures its DOM tomorrow,
 * this file keeps working and the old CSS would not have.
 *
 * Applied to the narrowest possible set — the two properties that actually lose
 * — rather than everywhere, so the next person can tell which ones are fighting
 * something and which are not. `cssHygiene.test.js` counts them.
 */
const win = (value) => `${value} !important`;

const FIELD_BORDER = win("1px solid color-mix(in srgb, var(--text) 5%, transparent)");
const INSET_WELL = "inset 0 1px 2px rgba(0,0,0,0.2)";
const TRANSITION = "background 0.2s ease, border-color 0.2s ease, color 0.2s ease";

export const clerkAppearance = {
  baseTheme: "dark",
  variables: {
    colorPrimary: "#ec7d96",
    colorBackground: "#1b120c",
    colorText: "#faf0e6",
  },
  elements: {
    rootBox: RESET,
    cardBox: RESET,
    card: RESET,
    footer: RESET,
    main: RESET,

    formButtonPrimary: {
      width: "100%",
      background: "linear-gradient(135deg, var(--primary), var(--primary-soft))",
      color: "#fff",
      fontFamily: "'Switzer', sans-serif",
      fontWeight: 700,
      fontSize: "14px",
      borderRadius: "12px",
      padding: "12px",
      border: "none",
      boxShadow:
        win("0 1px 0 rgba(255,255,255,0.15) inset, 0 -1px 0 rgba(0,0,0,0.2) inset, 0 4px 12px color-mix(in srgb, var(--primary) 20%, transparent)"),
      transition: TRANSITION,
      "&:hover": {
        transform: "translateY(-1px)",
        boxShadow:
          win("0 1px 0 rgba(255,255,255,0.15) inset, 0 -1px 0 rgba(0,0,0,0.2) inset, 0 8px 24px color-mix(in srgb, var(--primary) 25%, transparent)"),
      },
      "&:active": {
        transform: "scale(0.98)",
        boxShadow: win("inset 0 1px 2px rgba(0,0,0,0.3)"),
      },
    },

    socialButtonsBlockButton: {
      background: "var(--surface-2)",
      border: FIELD_BORDER,
      borderRadius: "12px",
      color: "var(--text)",
      boxShadow:
        win("0 1px 0 color-mix(in srgb, var(--text) 3%, transparent) inset, 0 -1px 0 rgba(0,0,0,0.15) inset"),
      transition: TRANSITION,
      "&:hover": {
        background: "var(--surface-3)",
        borderColor: "color-mix(in srgb, var(--text) 10%, transparent)",
        transform: "translateY(-1px)",
      },
    },

    headerTitle: {
      color: "var(--text)",
      fontFamily: "'Clash Grotesk', sans-serif",
      fontWeight: 600,
    },
    headerSubtitle: { color: "var(--text-muted)" },

    formFieldLabel: { color: "var(--text-muted)", fontSize: "12px" },
    formFieldInput: {
      background: "var(--surface-2)",
      border: FIELD_BORDER,
      borderRadius: "12px",
      color: "var(--text)",
      padding: "11px 13px",
      fontSize: "14px",
      boxShadow: win(INSET_WELL),
      transition: TRANSITION,
      "&:focus": {
        borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
        boxShadow: win(`${INSET_WELL}, 0 0 0 3px color-mix(in srgb, var(--primary) 8%, transparent)`),
      },
    },

    footerActionLink: {
      color: "var(--primary-soft)",
      fontWeight: 600,
      transition: "color 0.15s",
      "&:hover": { color: "var(--primary)" },
    },

    form: { gap: "10px" },
  },
};

export default clerkAppearance;
