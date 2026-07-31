import { memo } from "react";
import Crescent from "./Crescent";

/**
 * Purely decorative hanging ornament.
 *
 * Positioning and stacking live in src/styles/decoration.css
 * (.earring-wrap / .earring-left / .earring-right) — deliberately NOT inline,
 * because inline styles silently outrank the stylesheet, and that mismatch is
 * what caused a long run of duelling z-index commits. See docs/FRONTEND.md §1.
 *
 * The ornament used to be a <model-viewer> rendering a 9.4MB model.glb. See
 * components/Crescent.jsx for why that went.
 */
const Earring = memo(({ side, active = false }) => (
  // `active` is set while an answer is arriving. It is the app's one piece of
  // ornamental motion that carries information: the ornament swings wider
  // while the council is working, so the periphery says "something is
  // happening" without another spinner in the middle of the page.
  <div
    className={`earring-wrap earring-${side} ${active ? "is-active" : ""}`}
    aria-hidden="true"
    data-testid={`earring-${side}`}
  >
    <div className="earring-chain" />
    <div className="earring-pivot">
      <Crescent side={side} />
    </div>
  </div>
));

Earring.displayName = "Earring";

export default Earring;
