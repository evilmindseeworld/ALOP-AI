import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputBar from "../components/InputBar";
import { appendToControlledInput } from "../lib/dom";

/**
 * Dictation is written into the composer from outside React. A plain
 * `el.value += text` shows the words and sends nothing — the composer's state
 * never changes, so Send posts an empty message. This is the test that fails if
 * the native setter is dropped again.
 */
const setup = () => {
  const onSend = vi.fn();
  render(
    <InputBar
      onSend={onSend}
      disabled={false}
      onFileSelect={vi.fn()}
      onStartCamera={vi.fn()}
      isListening={false}
      toggleListening={vi.fn()}
      attachedImage={null}
      onClearAttachment={vi.fn()}
      isGenerating={false}
      onStop={vi.fn()}
    />
  );
  return { onSend, input: document.querySelector(".input-text") };
};

describe("appendToControlledInput", () => {
  it("puts dictated text where Send can actually read it", async () => {
    const { onSend, input } = setup();

    act(() => appendToControlledInput(input, "dictated words "));

    expect(input.value).toBe("dictated words ");
    await userEvent.click(screen.getByLabelText("Send"));
    expect(onSend).toHaveBeenCalledWith("dictated words ");
  });

  it("appends to what the user has already typed", async () => {
    const { onSend, input } = setup();

    await userEvent.type(input, "typed ");
    act(() => appendToControlledInput(input, "and dictated"));

    await userEvent.click(screen.getByLabelText("Send"));
    expect(onSend).toHaveBeenCalledWith("typed and dictated");
  });

  it("ignores a missing element or empty transcript", () => {
    const { input } = setup();
    expect(() => appendToControlledInput(null, "x")).not.toThrow();
    appendToControlledInput(input, "");
    expect(input.value).toBe("");
  });
});
