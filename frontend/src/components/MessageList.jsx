import { memo, lazy, Suspense, useState, useRef, useEffect } from "react";
import { animate, spring, createDraggable } from "animejs";
import SakuraFrame from "./SakuraFrame";
import CouncilRosette from "./CouncilRosette";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Icon from "./Icon";
import { STARTERS } from "../constants/starters";
import { MessageSkeleton, AnswerSkeleton } from "./Skeletons";
import { stopSpeaking, isSpeechSupported } from "../lib/speak";

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

export const MessageActions = memo(({ content, onCopy, onSpeak, msgId, onFeedback, feedback }) => {
  /**
   * Copy said nothing at all.
   *
   * It called navigator.clipboard.writeText and that was the whole
   * interaction — no toast, no icon change, no state. The only way to find out
   * whether it had worked was to paste somewhere else and look.
   */
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const timer = useRef(null);

  // The transcript unmounts rows constantly — switching chats does it — and a
  // timer that outlives its component calls setState on nothing.
  useEffect(() => () => clearTimeout(timer.current), []);

  // A voice that keeps reading a message that is no longer on screen is the
  // worst version of this feature. Switching chats unmounts the row, so this
  // is where it has to stop.
  useEffect(() => () => stopSpeaking(), []);

  const copy = () => {
    onCopy();
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  /**
   * One voice at a time is enforced in lib/speak, so pressing Listen on a
   * second answer cuts the first off rather than talking over it — and the
   * interrupted row's onEnd fires, so its button goes back to "Listen" instead
   * of sitting on "Stop" for an utterance that is no longer playing.
   */
  const toggleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    onSpeak(content, { onEnd: () => setSpeaking(false) });
  };

  return (
  // `is-voted` keeps the row's actions visible once a vote is cast, so the
  // answer you marked stays marked when the pointer moves away.
  <div className={`msg-actions ${feedback ? "is-voted" : ""}`}>
    <button className={`msg-action-btn ${copied ? "is-copied" : ""}`} onClick={copy}>
      <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
    </button>
    {/* Only where a voice exists. jsdom has neither, and so does a browser old
        enough that offering the control would be a button that does nothing. */}
    {isSpeechSupported() && (
      <button
        className={`msg-action-btn ${speaking ? "is-speaking" : ""}`}
        onClick={toggleSpeak}
        aria-pressed={speaking}
      >
        <Icon name={speaking ? "stop" : "speaker"} size={13} /> {speaking ? "Stop" : "Listen"}
      </button>
    )}
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
export const EmptyState = memo(({ onPick }) => {
  const logoRef = useRef(null);

  /* THE LOGO'S MOTION IS OWNED BY THE LOGO, and bound to the element rather
   * than to `.empty-logo`.
   *
   * This ran in App.jsx from an effect keyed on the message list, which is not
   * the same thing as "the empty state is on screen". It fired twice when the
   * element did not exist: once on mount, because MessageList is a lazy chunk
   * and Suspense was still showing the fallback, and again the instant a
   * message was sent, because `status` leaves "idle" before the list has a
   * message in it and this component unmounts. Both times the selector matched
   * nothing.
   *
   * animejs resolves a selector that matches nothing to `undefined`, and
   * `new Animatable(undefined, ...)` returns early with no property methods
   * defined. Draggable then calls the one it expects and throws
   *
   *   this.animate[this.xProp] is not a function
   *
   * which is why the crash named no element and no file. A ref cannot miss:
   * this effect runs after the element it points at is in the document. */
  useEffect(() => {
    const el = logoRef.current;
    if (!el) return;
    const pulse = animate(el, {
      scale: [
        { to: 1.08, ease: "inOut(3)", duration: 400 },
        { to: 1, ease: spring({ bounce: 0.7 }) },
      ],
      loop: true,
      loopDelay: 1200,
    });
    const drag = createDraggable(el, { container: [0, 0, 0, 0], releaseEase: spring({ bounce: 0.8 }) });
    return () => {
      pulse.revert();
      drag.revert();
    };
  }, []);

  return (
  <div className="empty-state">
    {/* Behind everything, and only here — see SakuraFrame for why the frame
        does not follow the transcript. */}
    <SakuraFrame />
    {/* The seal goes round the mark, not round the panel.
        The rosette's traces all pass through one centre and leave a clear disc
        there — the figure is a ring, and the mark is exactly what that ring is
        the right size to hold. Sitting in the frame it was concentric with
        nothing: .empty-state centres its whole column, so the mark's y moves
        with the height of the title, subtitle and starter grid, and the ring
        floated 42px above it with its top half clipped off the panel. Inside
        the mark's own box it cannot come apart, at any viewport. */}
    <span className="empty-mark">
      <CouncilRosette />
      <img ref={logoRef} src="/logo-mark.png" alt="" className="empty-logo" />
    </span>
    {/* No eyebrow. "The AI Council" sat between the mark and the title,
        saying nothing the title and subtitle below do not — see SignInPage
        for the same removal. */}
    {/* An empty screen is an invitation to act, so it asks rather than
        announces. "ALOP-AI Assembled." named the product and its own machinery
        to somebody who had just opened the product and can see its name in the
        header — and it carried both the italic-serif accent and the animated
        gradient shimmer, which were the two most decorative things in the app.
        All three are gone; the subtitle below already explains the mechanic. */}
    <h2 className="empty-title">What do you want to ask?</h2>
    <p className="empty-subtitle">
      Several models answer separately, read each other, then agree on one reply. Tell it when it is wrong and it remembers.
    </p>
    <div className="starter-grid">
      {STARTERS.map((s) => (
        /* Keyed on the label, not the seed: two seeds could legitimately share
           an opening fragment, a label may not — starters.test asserts it. */
        <button
          key={s.label}
          className="starter-card"
          onClick={() => onPick(s)}
          /* The card no longer sends anything, so saying "Generate an image"
             alone would promise a result it does not deliver. The accessible
             name says what the click actually does. */
          aria-label={`${s.label}: start a message in the composer`}
        >
          <span className="starter-icon">
            <Icon name={s.icon} size={15} />
          </span>
          <span className="starter-label">{s.label}</span>
          <span className="starter-prompt">{s.hint}</span>
        </button>
      ))}
    </div>
  </div>
  );
});

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

export const Message = memo(({ msg, isStreaming, onCopy, onSpeak, onFeedback, feedback }) => {
  const isUser = msg.role === "user";

  return (
    <div className={`msg-row ${msg.role}`}>
      {/* WHO IS SPEAKING WAS A VISUAL FACT ONLY.
          Alignment and a filled pill say "yours" to someone who can see the
          transcript; in the accessibility tree the two roles were a div with a
          class name apiece, so a screen reader read a question and an answer
          as one undifferentiated run of text. The avatar was the only marker
          of either, and it marked one side. */}
      <span className="sr-only">{isUser ? "You asked:" : "The council answered:"}</span>
      {/* Only the assistant gets an avatar. A right-aligned filled pill is
          already unmistakably yours — an avatar, a "YOU" label and the
          alignment were three ways of saying the same thing, in the corner
          where the eye lands first. It is decoration now that the line above
          carries the same fact: read out, it would say "AI" twice. */}
      {!isUser && <div className="avatar" aria-hidden="true">AI</div>}
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
          <AnswerSkeleton stage={msg.stage} />
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
            onSpeak={onSpeak}
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
  onSpeak,
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
          onSpeak={onSpeak}
          onFeedback={onFeedback}
          feedback={feedback[msg.id]}
        />
      ))}

      {/* THE WAIT BEFORE THE WAIT.
          `send` sets status to "loading" immediately, but the assistant
          placeholder that carries `typing: true` is only inserted after up to
          three round trips — createChat, ensureMessagesLoaded, and the awaited
          message PUT. The question painted optimistically and then nothing
          happened underneath it, for one round trip on a warm chat and for the
          whole cold-start on a new one. It read as a dead app, which is exactly
          what it looked like.

          A synthetic message rather than repeated row markup, so the skeleton
          sits in a real `.msg-row.assistant` with the same avatar and the same
          "The council answered:" cue a real answer gets. The guard is against
          the moment both exist: once the real placeholder lands, it renders the
          skeleton itself and this one must go, or the transcript grows a second
          empty answer.

          Covers image generation too, which never had any in-transcript
          feedback at all — it sets the same status and inserts no placeholder
          of its own. */}
      {status === "loading" && !messages[lastIndex]?.typing && (
        <Message msg={{ role: "assistant", content: "", typing: true, id: "pending" }} />
      )}

      {/* Announced, not just animated. A screen reader had no way to know an
          answer had finished arriving — the only signal was a caret stopping. */}
      <p className="sr-only" role="status" aria-live="polite">
        {status === "loading"
          ? "The council is working"
          : status === "streaming"
            ? "Answer in progress"
            : status === "idle"
              ? "Answer complete"
              : ""}
      </p>
    </div>
  );
}
