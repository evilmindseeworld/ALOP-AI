import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InputBar } from "../App";

// The composer used to hold its own attachment array and answer every upload
// with "File upload disabled in Council mode". The attachment now lives in the
// parent, because camera capture sets it from outside this component.
const setup = (props = {}) => {
  const onSend = vi.fn();
  const onClearAttachment = vi.fn();
  render(
    <InputBar
      onSend={onSend}
      disabled={false}
      onFileSelect={vi.fn()}
      onStartCamera={vi.fn()}
      isListening={false}
      toggleListening={vi.fn()}
      attachedImage={null}
      onClearAttachment={onClearAttachment}
      {...props}
    />
  );
  return { onSend, onClearAttachment };
};

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

describe("InputBar", () => {
  it("shows no attachment preview when nothing is attached", () => {
    setup();
    expect(screen.queryByAltText("Attached")).not.toBeInTheDocument();
  });

  it("previews an attached image", () => {
    setup({ attachedImage: PNG });
    expect(screen.getByAltText("Attached")).toHaveAttribute("src", PNG);
  });

  it("asks the parent to clear the attachment", async () => {
    const { onClearAttachment } = setup({ attachedImage: PNG });

    await userEvent.click(screen.getByLabelText("Remove attached image"));

    expect(onClearAttachment).toHaveBeenCalledOnce();
  });

  it("prompts about the image once one is attached", () => {
    setup({ attachedImage: PNG });
    expect(screen.getByPlaceholderText("Ask about this image...")).toBeInTheDocument();
  });

  it("sends the typed text and clears the field", async () => {
    const { onSend } = setup();
    const box = screen.getByPlaceholderText("Ask the AI Council anything...");

    await userEvent.type(box, "what is this");
    await userEvent.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("what is this");
    expect(box).toHaveValue("");
  });

  it("does not send on shift+enter", async () => {
    const { onSend } = setup();

    await userEvent.type(screen.getByPlaceholderText("Ask the AI Council anything..."), "line one");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("refuses to send whitespace", async () => {
    const { onSend } = setup();

    await userEvent.type(screen.getByPlaceholderText("Ask the AI Council anything..."), "   ");
    await userEvent.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send while a response is streaming", async () => {
    const { onSend } = setup({ disabled: true });

    const box = screen.getByPlaceholderText("Ask the AI Council anything...");
    await userEvent.type(box, "hello");
    await userEvent.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("accepts a single image, not a multiple selection", () => {
    // The picker was `multiple` while the backend takes exactly one image.
    setup();
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).not.toHaveAttribute("multiple");
  });
});
