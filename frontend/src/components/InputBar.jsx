import { memo, useState, useEffect } from "react";
import Icon from "./Icon";

/**
 * The composer.
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
    const [rows, setRows] = useState(1);

    useEffect(() => {
      setRows(Math.min(Math.max(text.split("\n").length, 1), 1000));
    }, [text]);

    const submit = () => {
      if (disabled || !text.trim()) return;
      onSend(text);
      setText("");
    };

    // Enter sends, Shift+Enter breaks the line — the convention every chat
    // client uses, and the reason rows is computed above.
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
            className="input-text"
            rows={rows}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachedImage ? "Ask about this image..." : "Ask the AI Council anything..."}
            disabled={disabled}
          />

          <div className="input-actions">
            <label className="input-btn" title="Upload image" style={{ cursor: "pointer" }}>
              <input
                type="file"
                accept="image/*"
                onChange={onFileSelect}
                disabled={disabled}
                style={{ display: "none" }}
              />
              <Icon name="image" size={16} />
            </label>

            <button
              className={`input-btn ${isListening ? "listening" : ""}`}
              onClick={toggleListening}
              title="Voice input"
              aria-label="Voice input"
              aria-pressed={isListening}
            >
              <Icon name="mic" size={16} />
            </button>

            <button className="input-btn" onClick={onStartCamera} title="Camera" aria-label="Camera" disabled={disabled}>
              <Icon name="camera" size={16} />
            </button>

            <div style={{ flex: 1 }} />

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
                <Icon name="send" size={16} />
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
