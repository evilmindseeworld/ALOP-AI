// Keep the asynchronously-loaded motion surface narrow. Importing animejs as
// a dynamic namespace retains every export; real wrapper functions preserve a
// dynamic boundary while letting Vite tree-shake to the primitives used here.
import { animate, createDraggable, spring } from "animejs";

export const animateMessageEntrance = (element) => animate(element, {
  opacity: [0, 1],
  translateY: [16, 0],
  scale: [0.97, 1],
  ease: spring({ bounce: 0.3, stiffness: 120 }),
  duration: 700,
});

export const animateButtonPress = (element) => animate(element, {
  scale: [
    { to: 0.9, duration: 80 },
    { to: 1, ease: spring({ bounce: 0.6 }) },
  ],
});
