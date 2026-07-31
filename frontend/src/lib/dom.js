/**
 * Append text to a React-controlled <input> or <textarea> from outside React.
 *
 * `el.value += text` looks like it works — the text appears on screen — but it
 * goes through React's own value tracker, which then compares the node against
 * its record, sees no change, and skips onChange. State never learns about the
 * text, so Send posts an empty message and the next render wipes it. Calling
 * the prototype's setter bypasses the tracker, which is what makes the
 * dispatched input event reach React.
 *
 * This is how dictation reaches the composer: speech recognition lives above
 * the composer, and the composer owns its own text state.
 */
export const appendToControlledInput = (el, text) => {
  if (!el || !text) return;

  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, el.value + text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

export default appendToControlledInput;
