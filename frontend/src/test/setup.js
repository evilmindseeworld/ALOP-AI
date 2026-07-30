import "@testing-library/jest-dom/vitest";

// <model-viewer> is registered at runtime by a script tag in index.html, which
// never runs under jsdom. Without this, React logs an unknown-element warning
// and the element has no layout behaviour. Registering a bare custom element
// keeps the DOM shape honest without pulling in the real WebGL implementation.
if (!customElements.get("model-viewer")) {
  customElements.define("model-viewer", class extends HTMLElement {});
}

// jsdom implements no layout, so it ships no scrollIntoView at all — calling it
// throws rather than no-opping. The command palette uses it to keep the
// keyboard cursor visible. Stubbing it here keeps the guard out of production
// code, where the method genuinely does exist.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Same story for scrollTo, used by the jump-to-latest button.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
