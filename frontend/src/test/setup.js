import "@testing-library/jest-dom/vitest";

// <model-viewer> is registered at runtime by a script tag in index.html, which
// never runs under jsdom. Without this, React logs an unknown-element warning
// and the element has no layout behaviour. Registering a bare custom element
// keeps the DOM shape honest without pulling in the real WebGL implementation.
if (!customElements.get("model-viewer")) {
  customElements.define("model-viewer", class extends HTMLElement {});
}
