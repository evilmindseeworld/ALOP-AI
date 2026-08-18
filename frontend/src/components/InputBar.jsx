import { memo, useState, useEffect, useRef, useCallback } from "react";
import Icon from "./Icon";
import { ComposerSprigs } from "./SakuraFrame";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "./ui/tooltip";

/** The first image in a clipboard or drop payload, or null. */
const firstImage = (transfer) =>
  [...(transfer?.files || [])].find((f) => f.type?.startsWith("image/")) || null;

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
    onImageFile,
    attachedFiles = [],
    attachedFilesError = null,
    onDownloadFile,
    onRetryFiles,
    onDocSelect = () => {},
    onRemoveFile = () => {},
  }) => {
    const [text, setText] = useState("");
    const [isDropping, setIsDropping] = useState(false);
    const textareaRef = useRef(null);
    // dragenter/dragleave fire for every child the pointer crosses, so a plain
    // boolean flickers off the moment the cursor moves from the textarea onto
    // a button. Counting entries against leaves is the standard fix.
    const dragDepth = useRef(0);

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

    /**
     * GIVE THE COMPOSER ITS FOCUS BACK WHEN IT RE-ENABLES.
     *
     * Sending disables the composer while the council answers, and the browser
     * blurs a control the moment it becomes disabled — focus lands on <body>.
     * Nothing handed it back, so a keyboard user typed a question, pressed
     * Enter, waited, and found the next Tab starting again from the top of the
     * document. Measured on the live site: activeElement was BODY from the
     * instant of send until the page was next clicked.
     *
     * THE FLAG IS SET IN `submit`, NOT WHEN `disabled` FLIPS, and the first
     * attempt got that wrong. React writes `disabled` to the DOM during commit
     * and the browser blurs there and then, so by the time any effect runs —
     * layout effects included — activeElement is already <body> and there is
     * nothing left to observe. Submitting is the moment we actually know the
     * composer had the user's attention.
     *
     * Restored only if nothing else has claimed focus since: moving focus out
     * from under someone who deliberately tabbed away is the worse of the two
     * bugs, so <body> — the browser's own "nobody" — is the only state that
     * gets overwritten.
     */
    const refocusOnEnable = useRef(false);
    useEffect(() => {
      const el = textareaRef.current;
      if (disabled || !refocusOnEnable.current) return;
      refocusOnEnable.current = false;
      if (el && document.activeElement === document.body) el.focus();
    }, [disabled]);

    const submit = () => {
      if (disabled || !text.trim()) return;
      refocusOnEnable.current = true;
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

    /**
     * Pasting a screenshot is how most people attach an image, and it did
     * nothing here — the only routes in were the file picker and the camera.
     *
     * Both new paths hand the raw File to the same `onImageFile` the picker
     * uses. Three entry points with three copies of the "is this acceptable"
     * check is three chances for them to disagree.
     */
    const handlePaste = useCallback(
      (e) => {
        if (disabled) return;
        const file = firstImage(e.clipboardData);
        // No image means an ordinary text paste, which must go through
        // untouched — intercepting every paste would break typing.
        if (!file) return;
        e.preventDefault();
        onImageFile?.(file);
      },
      [disabled, onImageFile]
    );

    const handleDrop = useCallback(
      (e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setIsDropping(false);
        if (disabled) return;
        const file = firstImage(e.dataTransfer);
        if (file) onImageFile?.(file);
      },
      [disabled, onImageFile]
    );

    const handleDragEnter = useCallback(
      (e) => {
        if (disabled) return;
        e.preventDefault();
        dragDepth.current += 1;
        setIsDropping(true);
      },
      [disabled]
    );

    const handleDragLeave = useCallback(() => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDropping(false);
    }, []);

    return (
      <div className="input-bar">
        <div
          className={`input-wrapper ${isDropping ? "is-dropping" : ""}`}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          // Without preventDefault on dragover the browser navigates to the
          // dropped file instead of firing drop.
          onDragOver={(e) => e.preventDefault()}
        >
          <ComposerSprigs />
          {attachedImage && (
            <div className="attachment-preview">
              <img src={attachedImage} alt="Attached" />
              <button onClick={onClearAttachment} title="Remove image" aria-label="Remove attached image">
                ×
              </button>
            </div>
          )}

          {/* Documents are listed rather than previewed. An image has something
              worth showing; a CSV does not, and a thumbnail of text is a
              thumbnail of nothing.
              These persist for the whole conversation, unlike the image, which
              belongs to one message — so they live here as a standing list the
              council can read from on any turn. */}
          {/* Said before the chips, because if the read failed the chips are
              whatever the last successful load returned — possibly nothing —
              and the user needs to know the list is not authoritative before
              they conclude a document is gone. */}
          {attachedFilesError && (
            <div className="file-chips-error" role="status">
              <span>Couldn&rsquo;t load this chat&rsquo;s files. They haven&rsquo;t been deleted.</span>
              <button type="button" className="file-chips-retry" onClick={onRetryFiles}>
                Try again
              </button>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <ul className="file-chips">
              {attachedFiles.map((f) => (
                <li key={f.id} className="file-chip">
                  <Icon name="code" size={12} />
                  {/* The name truncates with an ellipsis and the extension is
                      the first thing lost, so the full name has to be
                      recoverable without opening anything. */}
                  <span className="file-chip-name" title={f.name}>{f.name}</span>
                  {/* Only for files whose ORIGINAL was kept. Anything uploaded
                      before that was retained has its text and nothing to give
                      back, and offering a button that can only apologise is
                      worse than not offering one. */}
                  {f.downloadable && onDownloadFile && (
                    <button
                      type="button"
                      className="file-chip-download"
                      onClick={() => onDownloadFile(f.id)}
                      aria-label={`Download ${f.name}`}
                      title={`Download ${f.name}`}
                    >
                      <Icon name="download" size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveFile(f.id)}
                    aria-label={`Remove ${f.name}`}
                    title={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
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

          {/* Tooltips SUPPLEMENT the labels, they do not replace them. Every
              control keeps its aria-label, because a tooltip is not an
              accessible name and never appears for a screen reader at all. */}
          <TooltipProvider delayDuration={400}>
          <div className="input-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="input-btn">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onFileSelect}
                    disabled={disabled}
                    aria-label="Upload image"
                  />
                  <Icon name="image" size={17} />
                </label>
              </TooltipTrigger>
              <TooltipContent>Attach an image, or paste one</TooltipContent>
            </Tooltip>

            {/* `accept` lists the SAME types the server allows, and is a
                convenience only — the browser file picker is not a security
                boundary and a user can always pick "all files". lib/file-intake
                is what actually decides, and it checks the bytes rather than
                the extension. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="input-btn">
                  <input
                    type="file"
                    accept=".txt,.md,.markdown,.csv,.tsv,.json,.pdf,.docx,.xlsx,text/plain,text/markdown,text/csv,text/tab-separated-values,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={onDocSelect}
                    disabled={disabled}
                    aria-label="Attach a document"
                  />
                  <Icon name="code" size={17} />
                </label>
              </TooltipTrigger>
              <TooltipContent>Attach a document: PDF, Word, Excel, text, Markdown, CSV or JSON</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`input-btn ${isListening ? "listening" : ""}`}
                  onClick={toggleListening}
                  aria-label="Voice input"
                  aria-pressed={isListening}
                >
                  <Icon name="mic" size={17} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{isListening ? "Stop dictating" : "Dictate"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button className="input-btn" onClick={onStartCamera} aria-label="Camera" disabled={disabled}>
                  <Icon name="camera" size={17} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Capture from the camera</TooltipContent>
            </Tooltip>

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
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="input-btn primary is-stop" onClick={onStop} aria-label="Stop generating">
                    <Icon name="stop" size={15} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Stop generating</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="input-btn primary"
                    onClick={submit}
                    disabled={disabled || !text.trim()}
                    aria-label="Send"
                  >
                    <Icon name="send" size={17} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Send, or press Enter</TooltipContent>
              </Tooltip>
            )}
          </div>
          </TooltipProvider>
        </div>
      </div>
    );
  }
);

InputBar.displayName = "InputBar";

export default InputBar;
