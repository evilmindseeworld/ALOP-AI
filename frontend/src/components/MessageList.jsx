import { memo, lazy, Suspense, useState, useRef, useEffect } from "react";
import SakuraFrame from "./SakuraFrame";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Icon from "./Icon";
import { STARTERS } from "../constants/starters";
import { MessageSkeleton } from "./Skeletons";

// react-syntax-highlighter is ~4.9MB installed and carries a grammar for every
// language it supports. Loading it lazily keeps it off the critical path for
// users whose conversation never contains a fenced code block.
const CodeBlock = lazy(() => import("./CodeBlock"));

// The fallback is the same markup the highlighter renders into, so the block
// appears instantly as plain monospace and gains colour a moment later rather
// than popping in from nothing.
const CodeBlockFallback = ({ code }) => (
  <div className="code-block-wrapper">
    <pre className="code-block-plain">
      <code>{code}</code>
    </pre>
  </div>
);

export const markdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const codeString = String(children).replace(/\n$/, "");

    if (inline) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    return (
      <Suspense fallback={<CodeBlockFallback code={codeString} />}>
        <CodeBlock language={match ? match[1] : "text"} code={codeString} {...props} />
      </Suspense>
    );
  },
};

/** How long the copy button stays confirmed. */
const COPIED_MS = 1600;

export const MessageActions = memo(({ content, onCopy, msgId, onFeedback, feedback }) => {
  /**
   * Copy said nothing at all.
   *
   * It called navigator.clipboard.writeText and that was the whole
   * interaction — no toast, no icon change, no state. The only way to find out
   * whether it had worked was to paste somewhere else and look.
   */
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  // The transcript unmounts rows constantly — switching chats does it — and a
  // timer that outlives its component calls setState on nothing.
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    onCopy();
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
  // `is-voted` keeps the row's actions visible once a vote is cast, so the
  // answer you marked stays marked when the pointer moves away.
  <div className={`msg-actions ${feedback ? "is-voted" : ""}`}>
    <button className={`msg-action-btn ${copied ? "is-copied" : ""}`} onClick={copy}>
      <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
    </button>
    <button
      className={`msg-action-btn ${feedback === "up" ? "active" : ""}`}
      onClick={() => onFeedback(msgId, "up")}
      aria-label="Good answer"
      aria-pressed={feedback === "up"}
    >
      <Icon name="thumbsUp" size={13} />
    </button>
    <button
      className={`msg-action-btn is-down ${feedback === "down" ? "active" : ""}`}
      onClick={() => onFeedback(msgId, "down")}
      aria-label="Bad answer"
      aria-pressed={feedback === "down"}
    >
      <Icon name="thumbsDown" size={13} />
    </button>
  </div>
  );
});

MessageActions.displayName = "MessageActions";

/**
 * A blank page is the hardest prompt to answer. Each starter is one click to a
 * real reply and exercises a different capability, so the council gets shown
 * off rather than described.
 */
export const EmptyState = memo(({ onPick }) => (
  <div className="empty-state">
    {/* Behind everything, and only here — see SakuraFrame for why the frame
        does not follow the transcript. */}
    <SakuraFrame />
    <img src="/logo.png" alt="" className="empty-logo" />
    <p className="empty-eyebrow">The AI Council</p>
    {/* Two typefaces on one line: the product name in the UI sans, the thing it
        does in an italic serif. The accent is a span rather than a second
        heading so screen readers still announce one title, "ALOP-AI Assembled",
        in one breath. */}
    <h2 className="empty-title text-shimmer">
      ALOP-AI<span className="empty-title-accent">Assembled.</span>
    </h2>
    <p className="empty-subtitle">
      Several models answer separately, read each other, then agree on one reply. Tell it when it is wrong and it remembers.
    </p>
    <div className="starter-grid">
      {STARTERS.map((s) => (
        <button key={s.prompt} className="starter-card" onClick={() => onPick(s.prompt)}>
          <span className="starter-icon">
            <Icon name={s.icon} size={15} />
          </span>
          <span className="starter-label">{s.label}</span>
          <span className="starter-prompt">{s.prompt}</span>
        </button>
      ))}
    </div>
  </div>
));

EmptyState.displayName = "EmptyState";

/**
 * One message.
 *
 * The two roles are laid out differently on purpose, and that is the change
 * this rewrite is really about. An assistant answer is long-form prose —
 * headings, lists, code, a sources block — and it now renders as a measured
 * column with no container chrome. A question is short and benefits from being
 * visibly *yours*: right-aligned and filled.
 *
 * Everything used to be an 80%-wide bubble with a bevel, which is the single
 * worst shape for a 900-word research answer.
 */
/**
 * What the council did before it answered.
 *
 * The tool loop runs to completion before synthesis emits a single chunk, so
 * without this the user watches a spinner for up to 25 seconds while seven
 * models search and read pages. The events arrive on the same SSE stream as
 * the answer.
 *
 * `<details>` rather than a hand-rolled disclosure: it is keyboard operable,
 * announced correctly, and survives with no JavaScript at all. Open to begin
 * with, because the whole point is watching it happen; local state after that,
 * so collapsing it makes it stay collapsed instead of springing back open on
 * the next frame.
 *
 * This is NOT persisted. The server's message whitelist keeps role, content
 * and a hasImage flag, so `activity` is dropped on save — the same treatment
 * imagePreview gets, and for the same reason: it is ephemeral progress, not
 * content. A reloaded conversation shows the answer without the trail.
 */
const TOOL_ICON = { web_search: "search", read_url: "code", read_file: "image", run_code: "code" };

export const ToolTrail = memo(({ activity }) => {
  const pending = activity.some((a) => a.pending);
  const [open, setOpen] = useState(true);

  return (
    <details className="tool-trail" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="tool-trail-summary">
        <Icon name={pending ? "refresh" : "check"} size={13} />
        <span>
          {pending
            ? "Researching…"
            : `Checked ${activity.length} source${activity.length === 1 ? "" : "s"}`}
        </span>
      </summary>
      <ol className="tool-trail-list">
        {activity.map((a, i) => (
          <li
            key={`${a.round}-${a.name}-${i}`}
            className={`tool-trail-row ${a.pending ? "is-pending" : a.ok === false ? "is-failed" : "is-done"}`}
          >
            <Icon name={TOOL_ICON[a.name] || "sparkles"} size={12} />
            <span className="tool-trail-text">{a.summary}</span>
          </li>
        ))}
      </ol>
    </details>
  );
});

ToolTrail.displayName = "ToolTrail";

export const Message = memo(({ msg, isStreaming, onCopy, onFeedback, feedback }) => {
  const isUser = msg.role === "user";

  return (
    <div className={`msg-row ${msg.role}`}>
      {/* Only the assistant gets an avatar. A right-aligned filled pill is
          already unmistakably yours — an avatar, a "YOU" label and the
          alignment were three ways of saying the same thing, in the corner
          where the eye lands first. */}
      {!isUser && <div className="avatar">AI</div>}
      <div className="msg-content">
        {/* Above the answer, because it happened before the answer. */}
        {!isUser && msg.activity?.length > 0 && <ToolTrail activity={msg.activity} />}
        {/* imagePreview only exists in this session; after a reload the hasImage
            flag survives but the bytes deliberately do not — a data URL runs to
            megabytes and a chat row holds up to 200 messages. */}
        {msg.hasImage &&
          (msg.imagePreview ? (
            <img className="msg-attachment" src={msg.imagePreview} alt="Attached" />
          ) : (
            <div className="msg-attachment-placeholder">
              <Icon name="image" size={13} /> Image attached
            </div>
          ))}

        {msg.typing ? (
          <div className="bubble typing-bubble" role="status" aria-label="The council is thinking">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        ) : msg.content ? (
          <div
            className={`bubble markdown-body ${isStreaming ? "is-streaming" : ""} ${
              msg.stopped ? "is-stopped" : ""
            }`}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {msg.content}
            </ReactMarkdown>
          </div>
        ) : null}

        {msg.stopped && (
          <span className="msg-stopped-note">
            <Icon name="stop" size={10} /> Stopped
          </span>
        )}

        {msg.imageUrl && (
          <img
            className="msg-image"
            src={msg.imageUrl}
            alt={msg.imagePrompt || "Generated image"}
            onClick={() => window.open(msg.imageUrl, "_blank", "noopener,noreferrer")}
          />
        )}

        {!isUser && msg.content && !msg.imageUrl && !msg.typing && !isStreaming && (
          <MessageActions
            content={msg.content}
            onCopy={() => onCopy(msg.content)}
            msgId={msg.id}
            onFeedback={onFeedback}
            feedback={feedback}
          />
        )}

        <div className="msg-meta">
          {!isUser && <span className="msg-role">ALOP-AI</span>}
          {msg.ts && <span>{msg.ts}</span>}
        </div>
      </div>
    </div>
  );
});

Message.displayName = "Message";

export default function MessageList({
  messages,
  status,
  feedback,
  onCopy,
  onFeedback,
  onPickStarter,
  isLoadingMessages,
  messageLoadError,
  onRetryMessages,
}) {
  // A conversation whose transcript is still in flight is NOT an empty one.
  //
  // Messages no longer arrive with the chat list — they are fetched per
  // conversation when it is opened — so between the click and the response
  // `messages` is legitimately empty. Without this branch the user opens a chat
  // with fifty messages in it and is shown "ask me anything", which reads as
  // their history having been deleted. On a cold backend that lasts twenty
  // seconds.
  if (isLoadingMessages) return <MessageSkeleton />;
  if (messageLoadError) {
    return (
      <div className="empty-state message-load-error" role="alert">
        <p>Couldn&apos;t load this conversation.</p>
        <button className="input-btn primary" onClick={onRetryMessages}>
          Retry
        </button>
      </div>
    );
  }
  if (messages.length === 0 && status === "idle") return <EmptyState onPick={onPickStarter} />;

  // Only the last assistant message can be the one currently arriving, so the
  // caret is decided here rather than per message.
  const lastIndex = messages.length - 1;

  return (
    <div className="msg-stream">
      {messages.map((msg, i) => (
        <Message
          key={msg.id || i}
          msg={msg}
          isStreaming={status === "streaming" && i === lastIndex && msg.role === "assistant"}
          onCopy={onCopy}
          onFeedback={onFeedback}
          feedback={feedback[msg.id]}
        />
      ))}

      {/* Announced, not just animated. A screen reader had no way to know an
          answer had finished arriving — the only signal was a caret stopping. */}
      <p className="sr-only" role="status" aria-live="polite">
        {status === "streaming" ? "Answer in progress" : status === "idle" ? "Answer complete" : ""}
      </p>
    </div>
  );
}
