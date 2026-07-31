import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputBar from "../components/InputBar";

// The composer used to hold its own attachment array and answer every upload
// with "File upload disabled in Council mode". The attachment now lives in the
// parent, because camera capture sets it from outside this component.
const setup = (props = {}) => {
  const onSend = vi.fn();
  const onClearAttachment = vi.fn();
  const onStop = vi.fn();
  const { container } = render(
    <InputBar
      onSend={onSend}
      disabled={false}
      onFileSelect={vi.fn()}
      onStartCamera={vi.fn()}
      isListening={false}
      toggleListening={vi.fn()}
      attachedImage={null}
      onClearAttachment={onClearAttachment}
      isGenerating={false}
      onStop={onStop}
      {...props}
    />
  );
  return { onSend, onClearAttachment, onStop, container };
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

  // Before this, abortRef was only ever used to cancel the previous request
  // when a new one started — a long or wrong answer had to be waited out.
  it("shows Send, not Stop, when idle", () => {
    setup();
    expect(screen.getByLabelText("Send")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stop generating")).not.toBeInTheDocument();
  });

  it("swaps Send for Stop while generating", () => {
    setup({ isGenerating: true, disabled: true });
    expect(screen.getByLabelText("Stop generating")).toBeInTheDocument();
    expect(screen.queryByLabelText("Send")).not.toBeInTheDocument();
  });

  it("calls onStop when Stop is clicked", async () => {
    const { onStop } = setup({ isGenerating: true, disabled: true });

    await userEvent.click(screen.getByLabelText("Stop generating"));

    expect(onStop).toHaveBeenCalledOnce();
  });

  // The composer is disabled while streaming, so a Stop that inherited that
  // disabled state would be unclickable — exactly when it is needed most.
  it("keeps Stop clickable even though the composer is disabled", () => {
    setup({ isGenerating: true, disabled: true });
    expect(screen.getByLabelText("Stop generating")).not.toBeDisabled();
  });

  it("accepts a single image, not a multiple selection", () => {
    // The picker was `multiple` while the backend takes exactly one image.
    setup();
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).not.toHaveAttribute("multiple");
  });
});

/**
 * Pasting a screenshot into a chat box is the most common way anyone attaches
 * an image, and it did nothing at all here — the only route in was the file
 * picker, three clicks away, or the camera.
 *
 * Both new paths hand the raw File to the same `onImageFile` the picker uses,
 * so there is one place that decides what an acceptable attachment is. Three
 * entry points with three copies of that check is three chances to disagree.
 */
const imageFile = (type = "image/png") => new File(["x"], "shot.png", { type });

const dataTransfer = (...files) => ({
  files,
  items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
  types: ["Files"],
});

describe("InputBar — pasting an image", () => {
  it("accepts an image off the clipboard", async () => {
    const onImageFile = vi.fn();
    setup({ onImageFile });
    const file = imageFile();

    fireEvent.paste(screen.getByLabelText("Message the AI Council"), {
      clipboardData: dataTransfer(file),
    });

    expect(onImageFile).toHaveBeenCalledWith(file);
  });

  it("lets ordinary text paste through untouched", async () => {
    // Guarding the common case: intercepting every paste would break typing.
    const onImageFile = vi.fn();
    setup({ onImageFile });

    const textarea = screen.getByLabelText("Message the AI Council");
    fireEvent.paste(textarea, { clipboardData: { files: [], items: [], types: ["text/plain"] } });

    expect(onImageFile).not.toHaveBeenCalled();
  });

  it("ignores a pasted non-image file", async () => {
    const onImageFile = vi.fn();
    setup({ onImageFile });

    fireEvent.paste(screen.getByLabelText("Message the AI Council"), {
      clipboardData: dataTransfer(new File(["x"], "notes.pdf", { type: "application/pdf" })),
    });

    expect(onImageFile).not.toHaveBeenCalled();
  });
});

describe("InputBar — dropping an image", () => {
  it("accepts an image dropped on the composer", () => {
    const onImageFile = vi.fn();
    const { container } = setup({ onImageFile });
    const file = imageFile();

    const wrapper = container.querySelector(".input-wrapper");
    fireEvent.drop(wrapper, { dataTransfer: dataTransfer(file) });

    expect(onImageFile).toHaveBeenCalledWith(file);
  });

  it("marks the composer while a file is over it, and unmarks it after", () => {
    const { container } = setup({ onImageFile: vi.fn() });
    const wrapper = container.querySelector(".input-wrapper");

    fireEvent.dragEnter(wrapper, { dataTransfer: dataTransfer(imageFile()) });
    expect(wrapper.className).toContain("is-dropping");

    fireEvent.drop(wrapper, { dataTransfer: dataTransfer(imageFile()) });
    expect(wrapper.className).not.toContain("is-dropping");
  });

  it("clears the drop state when the file leaves without being dropped", () => {
    const { container } = setup({ onImageFile: vi.fn() });
    const wrapper = container.querySelector(".input-wrapper");

    fireEvent.dragEnter(wrapper, { dataTransfer: dataTransfer(imageFile()) });
    fireEvent.dragLeave(wrapper, { dataTransfer: dataTransfer(imageFile()) });

    expect(wrapper.className).not.toContain("is-dropping");
  });

  it("ignores a dropped non-image", () => {
    const onImageFile = vi.fn();
    const { container } = setup({ onImageFile });

    fireEvent.drop(container.querySelector(".input-wrapper"), {
      dataTransfer: dataTransfer(new File(["x"], "a.zip", { type: "application/zip" })),
    });

    expect(onImageFile).not.toHaveBeenCalled();
  });

  it("does not accept a drop while a reply is streaming", () => {
    // The composer is disabled then; accepting an attachment it cannot send
    // would leave a preview stuck above a dead input.
    const onImageFile = vi.fn();
    const { container } = setup({ onImageFile, disabled: true });

    fireEvent.drop(container.querySelector(".input-wrapper"), {
      dataTransfer: dataTransfer(imageFile()),
    });

    expect(onImageFile).not.toHaveBeenCalled();
  });
});
