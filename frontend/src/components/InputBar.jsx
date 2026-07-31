import { memo, useState, useEffect, useRef } from "react";
import Icon from "./Icon";

/**
 * The composer.
 *
 * One card: attachments, then the textarea, then the action row — the shape
 * ChatGPT and Claude both converged on, and for the same reason. What was here
 * before put the textarea and the buttons inside a wrapper that the obsidian
 * pass gave a second border to, so it rendered as a box inside a box.
 *
 * The attached image lives in the parent rather than here, because the camera
 * capture flow sets it from outside this component — the overlay closes and
 * hands back a frame.
 */
const InputBar = memo(
  ({
    onSend,
    disabled,
    onFileSelect,
    onStartCamera,
    isListening,
    toggleListening,
    attachedImage,
    onClearAttachment,
    isGenerating,
    onStop,
  }) => {
    const [text, setText] = useState("");
    const textareaRef = useRef(null);

    /**
     * Grow with the content, up to the cap in composer.css.
     *
     * This used to count "\n" and set `rows`, which is wrong the moment a line
     * wraps: a 400-character paragraph with no newline in it stayed one row
     * tall and scrolled internally. Measuring scrollHeight counts wrapped lines
     * too. Height is reset to auto first, or the box can only ever grow.
     */
    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, [text]);

    const submit = () => {
      if (disabled || !text.trim()) return;
      onSend(text);
      setText("");
    };

    // Enter sends, Shift+Enter breaks the line — the convention every chat
    // client uses.
    const handleKeyDown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    };

    return (
      <div className="input-bar">
        <div className="input-wrapper">
          {attachedImage && (
            <div className="attachment-preview">
              <img src={attachedImage} alt="Attached" />
              <button onClick={onClearAttachment} title="Remove image" aria-label="Remove attached image">
                ×
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="input-text"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachedImage ? "Ask about this image..." : "Ask the AI Council anything..."}
            disabled={disabled}
            aria-label="Message the AI Council"
          />

          <div className="input-actions">
            <label className="input-btn" title="Upload image">
              <input
                type="file"
                accept="image/*"
                onChange={onFileSelect}
                disabled={disabled}
                aria-label="Upload image"
              />
              <Icon name="image" size={17} />
            </label>

            <button
              className={`input-btn ${isListening ? "listening" : ""}`}
              onClick={toggleListening}
              title="Voice input"
              aria-label="Voice input"
              aria-pressed={isListening}
            >
              <Icon name="mic" size={17} />
            </button>

            <button className="input-btn" onClick={onStartCamera} title="Camera" aria-label="Camera" disabled={disabled}>
              <Icon name="camera" size={17} />
            </button>

            <div className="input-spacer" />

            {/* The shortcut existed and nothing said so. Hidden while a reply
                streams, where the only useful action is Stop. */}
            {!isGenerating && (
              <span className="input-hint desktop-only">
                <kbd>Enter</kbd> to send
              </span>
            )}

            {/* Send becomes Stop while a reply is streaming. One button, because
                two would leave a disabled Send sitting next to an active Stop. */}
            {isGenerating ? (
              <button
                className="input-btn primary is-stop"
                onClick={onStop}
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Icon name="stop" size={15} />
              </button>
            ) : (
              <button
                className="input-btn primary"
                onClick={submit}
                disabled={disabled || !text.trim()}
                title="Send"
                aria-label="Send"
              >
                <Icon name="send" size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
);

InputBar.displayName = "InputBar";

export default InputBar;
