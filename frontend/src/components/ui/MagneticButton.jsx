import { lazy, Suspense } from "react";

/**
 * The magnetic header button, with framer-motion kept off the critical path.
 *
 * WHY THIS FILE EXISTS. framer-motion is 61.7 KB gzipped and this was the only
 * thing in the app importing it. Because App.jsx imports the header
 * statically, every visitor downloaded all 61.7 KB before the sign-in form
 * could render — for a hover effect on four buttons that a signed-out person
 * never sees, and that a phone has no pointer to trigger.
 *
 * The split lives here rather than at the four call sites in App.jsx so that
 * nothing there has to know about it. The fallback renders the same element
 * with the same class and the same handlers, so the only difference during the
 * one-off chunk fetch is that the magnet has not engaged yet — and the magnet
 * is driven by mousemove, which cannot have happened before the button exists.
 *
 * NOT replaced with a CSS transition, which would also have removed the
 * dependency: the spring is what the effect feels like, and swapping physics
 * for an ease curve is a visual change dressed up as an optimisation. This
 * keeps the behaviour byte for byte and moves when it loads.
 */
const MagneticButtonMotion = lazy(() => import("./MagneticButtonMotion"));

/**
 * Deliberately identical in structure to the motion version's rendered output,
 * minus the transform. A fallback that differs in tag, class or layout would
 * trade a download cost for a layout shift.
 */
const PlainButton = ({ children, className = "", onClick, disabled = false, ariaLabel }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className={className}
    style={{ display: "inline-flex" }}
  >
    {children}
  </button>
);

export default function MagneticButton(props) {
  return (
    <Suspense fallback={<PlainButton {...props} />}>
      <MagneticButtonMotion {...props} />
    </Suspense>
  );
}
