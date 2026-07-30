import { memo, lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Icon from "./Icon";
import { STARTERS } from "../constants/starters";

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

export const MessageActions = memo(({ content, onCopy, msgId, onFeedback, feedback }) => (
  <div className="msg-actions">
    <button className="msg-action-btn" onClick={onCopy}>
      <Icon name="copy" size={13} /> Copy
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
      className={`msg-action-btn ${feedback === "down" ? "active" : ""}`}
      onClick={() => onFeedback(msgId, "down")}
      aria-label="Bad answer"
      aria-pressed={feedback === "down"}
    >
      <Icon name="thumbsDown" size={13} />
    </button>
  </div>
));

MessageActions.displayName = "MessageActions";

/**
 * A blank page is the hardest prompt to answer. Each starter is one click to a
 * real reply and exercises a different capability, so the council gets shown
 * off rather than described.
 */
export const EmptyState = memo(({ onPick }) => (
  <div className="empty-state">
    <img src="/logo.png" alt="ALOP-AI" className="empty-logo" />
    <h2 className="empty-title text-shimmer">ALOP-AI</h2>
    <p className="empty-subtitle">
      Ask the AI Council anything. Multiple models work together, debate, then answer. It learns from your feedback.
    </p>
    <div className="starter-grid">
      {STARTERS.map((s) => (
        <button key={s.prompt} className="starter-card" onClick={() => onPick(s.prompt)}>
          <span className="starter-icon" aria-hidden="true">
            {s.icon}
          </span>
          <span className="starter-label">{s.label}</span>
          <span className="starter-prompt">{s.prompt}</span>
        </button>
      ))}
    </div>
  </div>
));

EmptyState.displayName = "EmptyState";

export const Message = memo(({ msg, onCopy, onFeedback, feedback }) => (
  <div className={`msg-row ${msg.role}`}>
    <div className="avatar">{msg.role === "user" ? "YOU" : "AI"}</div>
    <div className="msg-content">
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
        <div className="bubble typing-bubble">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      ) : msg.content ? (
        <div className="bubble markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {msg.content}
          </ReactMarkdown>
        </div>
      ) : null}

      {msg.imageUrl && (
        <div style={{ marginTop: 8 }}>
          <img
            src={msg.imageUrl}
            alt={msg.imagePrompt || "Generated"}
            style={{
              maxWidth: "100%",
              maxHeight: "60vh",
              borderRadius: "var(--radius-lg)",
              cursor: "pointer",
            }}
            onClick={() => window.open(msg.imageUrl, "_blank", "noopener,noreferrer")}
          />
          <div className="msg-meta" style={{ textAlign: "left" }}>
            {msg.imagePrompt}
          </div>
        </div>
      )}

      {msg.role === "assistant" && msg.content && !msg.imageUrl && !msg.typing && (
        <MessageActions
          content={msg.content}
          onCopy={() => onCopy(msg.content)}
          msgId={msg.id}
          onFeedback={onFeedback}
          feedback={feedback}
        />
      )}

      <div className="msg-meta">{msg.ts}</div>
    </div>
  </div>
));

Message.displayName = "Message";

export default function MessageList({ messages, status, feedback, onCopy, onFeedback, onPickStarter }) {
  if (messages.length === 0 && status === "idle") return <EmptyState onPick={onPickStarter} />;

  return messages.map((msg, i) => (
    <Message
      key={msg.id || i}
      msg={msg}
      onCopy={onCopy}
      onFeedback={onFeedback}
      feedback={feedback[msg.id]}
    />
  ));
}
