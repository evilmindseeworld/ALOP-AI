import { memo, lazy, Suspense, useState, useRef, useEffect } from "react";
import CouncilRosette from "./CouncilRosette";
/**
 * THE MARKDOWN STACK IS 160.92 kB RAW / 49.11 kB GZIP AND IS NEEDED BY NO
 * MESSAGE UNTIL ONE HAS FINISHED ARRIVING.
 *
 * Measured from the production build. It was a static import, so it downloaded
 * whenever MessageList did — before the first answer, and even for a
 * conversation that never contains a fenced block, a table or a link.
 *
 * It is deferrable ONLY because of the streaming design directly below: an
 * arriving answer is already rendered as plain paragraphs, and react-markdown
 * is used for exactly one thing — the single parse after the answer stops. So
 * the chunk is not needed until that moment, and the moment is preceded by
 * seconds of streaming during which it can load.
 *
 * The Suspense fallback is that same plain rendering rather than a spinner or
 * null. That is the whole reason this is safe: if the chunk has not landed when
 * the answer completes, the reader keeps seeing the exact frame they were
 * already looking at, and it is replaced in place when the parse is ready.
 * Nothing blanks and nothing jumps.
 */
const Markdown = lazy(() =>
  Promise.all([import("react-markdown"), import("remark-gfm")]).then(([md, gfm]) => ({
    default: ({ children }) => (
      <md.default remarkPlugins={[gfm.default]} components={markdownComponents}>
        {children}
      </md.default>
    ),
  })),
);
import Icon from "./Icon";
import { STARTERS } from "../constants/starters";
import { MessageSkeleton, AnswerSkeleton, CouncilProcess } from "./Skeletons";
import { stopSpeaking, isSpeechSupported } from "../lib/speak";

const PENDING_PROCESS = {
  phase: "working",
  reserve: true,
  stages: [],
  frames: [],
  synthesisSeen: false,
  announcement: "Assembling your answer.",
};

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
    let disposed = false;
    let pulse;
    let drag;
    import("../lib/motion")
      .then(({ animateEmptyLogo }) => {
        if (disposed) return;
        ({ pulse, drag } = animateEmptyLogo(el));
      })
      .catch(() => {});
    return () => {
      disposed = true;
      pulse?.revert();
      drag?.revert();
    };
  }, []);

  return (
  <div className="empty-state">
    {/* THE BRANCHES ARE GONE, on the owner's instruction (2026-08-11): "leave
        the earrings, just delete the branches." The top pair went first as a
        declutter and the rest followed — all four corner sprigs, and the bough
        and falling petals that were on sign-in.

        What stays is the family's harder half: the crescents, the keystone
        above the composer, the seal, the skyline on the prompt bar and the
        asanoha lattice. The centred hero and the 2x2 starter grid below are
        untouched and remain the specification. See SakuraFrame.jsx. */}
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
 * without this the user watches a spinner for up to 25 seconds while five
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

/*
 * A source receipt is the public edge of the evidence ledger. It intentionally
 * accepts only bounded HTTP(S) records and renders no snippets, prompts, tool
 * bodies, or model-private material. The server applies the same allow-list;
 * this second check keeps an older or hand-authored transcript from turning a
 * persisted URL into a script or credential-bearing link.
 */
const parseIpv4 = (value) => {
  const parts = String(value || "").split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
};

const ipv4IsSpecial = (octets) => {
  if (!octets) return false;
  const [a, b, c, d] = octets;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
    || (a === 255 && b === 255 && c === 255 && d === 255);
};

const parseIpv6 = (value) => {
  let input = String(value || "").toLowerCase();
  if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
  if (!input || input.includes("%")) return null;
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const expand = (part) => {
    if (!part) return [];
    const pieces = part.split(":");
    if (pieces.some((piece) => !piece)) return null;
    const values = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const octets = parseIpv4(piece);
        if (!octets || piece !== pieces[pieces.length - 1]) return null;
        values.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
        values.push(parseInt(piece, 16));
      }
    }
    return values;
  };
  const left = expand(halves[0]);
  const right = expand(halves[1]);
  if (!left || !right) return null;
  const values = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
    : [...left];
  return values.length === 8 ? values : null;
};

const ipv6IsSpecial = (value) => {
  const groups = parseIpv6(value);
  if (!groups) return false;
  const first = groups[0];
  if (groups.every((group) => group === 0) || (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1)) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const compatible = groups.slice(0, 6).every((group) => group === 0);
  if (mapped || compatible) {
    return ipv4IsSpecial([
      groups[6] >> 8, groups[6] & 0xff,
      groups[7] >> 8, groups[7] & 0xff,
    ]);
  }
  return false;
};

const isPublicHttpHostname = (hostname) => {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")
    || normalized === "local" || normalized.endsWith(".local")
    || normalized.endsWith(".internal") || normalized.endsWith(".intranet")
    || normalized.endsWith(".lan") || normalized.endsWith(".home")
    || normalized.endsWith(".corp")) return false;
  const ipv4 = parseIpv4(normalized);
  if (ipv4) return !ipv4IsSpecial(ipv4);
  if (normalized.includes(":")) return !ipv6IsSpecial(normalized);
  return true;
};

const safeSourceRows = (provenance) => {
  const seen = new Set();
  return (Array.isArray(provenance?.sources) ? provenance.sources : []).flatMap((source) => {
    if (!source || typeof source.url !== "string") return [];
    try {
      const url = new URL(source.url);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return [];
      if (!isPublicHttpHostname(url.hostname)) return [];
      url.hash = "";
      const href = url.toString();
      if (seen.has(href)) return [];
      seen.add(href);
      return [{
        ...source,
        url: href,
        title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : url.hostname,
        domain: typeof source.domain === "string" && source.domain.trim() ? source.domain.trim() : url.hostname,
      }];
    } catch {
      return [];
    }
  }).slice(0, 24);
};

/* When the evidence ledger has the same public URLs that a model repeated in
 * a trailing Markdown `Sources` block, the structured receipt is the clearer
 * and safer surface. Remove only an exact, link-only duplicate; unknown or
 * prose-bearing source sections stay visible because the frontend cannot
 * prove that they are redundant. The raw message remains available to Copy.
 */
export const stripRedundantMarkdownSources = (content, provenance) => {
  if (typeof content !== "string" || !safeSourceRows(provenance).length) return content;

  const match = /\n{2,}#{1,6}\s*(?:sources?|references?)\s*:?\s*\n([\s\S]*)$/i.exec(content);
  if (!match) return content;

  const prefix = content.slice(0, match.index).trimEnd();
  const tail = match[1];
  if (!prefix || !tail.trim()) return content;

  const normalize = (value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  };
  const urls = [...tail.matchAll(/https?:\/\/[^\s)\]>"']+/gi)]
    .map(([value]) => normalize(value.replace(/[.,;:!?]+$/, "")))
    .filter(Boolean);
  const known = new Set(safeSourceRows(provenance).map((source) => source.url));
  if (!urls.length || !urls.every((url) => known.has(url))) return content;

  const residual = tail
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/[^\s)\]>"']+/gi, "")
    .replace(/^\s*(?:[-*+] |\d+\. )/gm, "")
    .trim();
  return residual ? content : prefix;
};

export const ProvenanceReceipt = memo(({ provenance }) => {
  const sources = safeSourceRows(provenance);
  if (!sources.length) return null;
  const verificationRecorded = provenance?.verification?.completed === true;

  return (
    <details className="source-receipt">
      <summary>
        <span>Sources · {sources.length}</span>
        {verificationRecorded && <span className="source-receipt-state">Evidence recorded</span>}
      </summary>
      <ol className="source-receipt-list">
        {sources.map((source) => (
          <li className="source-receipt-row" key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.title}
            </a>
            <span className="source-receipt-domain">{source.domain}</span>
            {source.date && <time className="source-receipt-date">{source.date}</time>}
          </li>
        ))}
      </ol>
    </details>
  );
});

ProvenanceReceipt.displayName = "ProvenanceReceipt";

/**
 * Raw streamed text, split into the blocks markdown will make of it.
 *
 * Only blank lines, because that is the one boundary markdown and plain text
 * agree on. Anything cleverer here — detecting headings, list items, fences —
 * would be a second markdown parser written to avoid running the first one.
 *
 * The trailing empty string is dropped so a message ending in a newline, which
 * every streamed message does at some point, does not render an empty
 * paragraph and take a block gap with it.
 */
const splitParagraphs = (text) => text.split(/\n{2,}/).filter((p) => p !== "");

/**
 * The unparsed form of an answer, used in two places that must not diverge:
 * while it streams, and as the Suspense fallback if the markdown chunk has not
 * arrived by the time it stops. Extracted rather than duplicated precisely
 * because the swap between them is only invisible while they are the same —
 * two copies would drift and the drift would show as a jump at the exact moment
 * the answer completes.
 */
const PlainParagraphs = ({ text }) =>
  splitParagraphs(text).map((para, i) => (
    <p className="stream-plain" key={i}>
      {para}
    </p>
  ));

export const Message = memo(({ msg, isStreaming, onCopy, onSpeak, onFeedback, feedback }) => {
  const isUser = msg.role === "user";
  const hasProcess = !isUser && Boolean(msg.process && (msg.process.reserve || msg.process.stages?.length));
  const displayContent = !isUser && !isStreaming
    ? stripRedundantMarkdownSources(msg.content, msg.provenance)
    : msg.content;

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
        {hasProcess ? (
          <CouncilProcess process={msg.process} activity={msg.activity} />
        ) : (
          /* Above the answer, because it happened before the answer. */
          !isUser && msg.activity?.length > 0 && <ToolTrail activity={msg.activity} />
        )}
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
          <AnswerSkeleton stage={msg.stage} showStage={!hasProcess} announce={!hasProcess} />
        ) : msg.content ? (
          <div
            className={`bubble markdown-body ${isStreaming ? "is-streaming" : ""} ${
              msg.stopped ? "is-stopped" : ""
            }`}
          >
            {/* PLAIN WHILE IT STREAMS, PARSED ONCE WHEN IT STOPS.
                react-markdown re-parses the WHOLE accumulated message on every
                paint, and the reveal cadence paints continuously — so a
                2,000-word answer was parsed from scratch a few hundred times on
                its way in, each parse longer than the last, and every fenced
                block inside it re-tokenised by the syntax highlighter along
                with it. The final parse is the only one whose output anyone
                keeps.
                The bubble element is deliberately the SAME div in both
                branches: React reconciles it in place and swaps only the
                children, so nothing unmounts, no entrance animation replays,
                and there is no flash at the swap. Same box, same padding, same
                measure — only the contents of it change.
                The trade, stated: raw syntax is visible while the answer
                arrives. Asked for, and it is what makes the parse deferrable
                at all. */}
            {/* One renderer for the plain form, because it is now used twice —
                while the answer streams, and as the Suspense fallback if the
                markdown chunk has not landed by the time it stops. Identical
                output in both, which is what makes the swap invisible. */}
            {isStreaming ? (
              /* ONE <p> PER PARAGRAPH, not one <p> for the whole thing.
                 The first version put the raw text in a single pre-wrap block,
                 which turned every blank line into a full line of leading —
                 27px where markdown's own block rhythm is the 16px of
                 `.markdown-body > * + *`. Measured at an 820px column: 82px
                 plain against 54px parsed, so the transcript jumped 28px under
                 the reader at the exact moment the answer finished.
                 Split on blank lines, each paragraph is spaced by the same
                 rule that will space it after the parse, and single newlines
                 inside a paragraph are still preserved by pre-wrap. A split is
                 a few microseconds against a full markdown parse. */
              <PlainParagraphs text={msg.content} />
            ) : (
              <Suspense fallback={<PlainParagraphs text={displayContent} />}>
                <Markdown>{displayContent}</Markdown>
              </Suspense>
            )}
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

        {!isUser && !msg.typing && !isStreaming && (
          <ProvenanceReceipt provenance={msg.provenance} />
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

/* The persisted transcript is one memo boundary, and the one changing draft
 * is deliberately outside it.
 *
 * A streaming answer repaints at display cadence. Mapping the full transcript
 * in MessageList on every paint still made reconciliation O(message count),
 * even though each Message below was memoized and skipped its own render. The
 * history props stay referentially stable for the life of a stream, so React
 * can now skip both the map and every old row while the draft advances. */
const MessageHistory = memo(function MessageHistory({ messages, feedback, onCopy, onSpeak, onFeedback }) {
  return messages.map((msg, i) => (
    <Message
      key={msg.id || i}
      msg={msg}
      onCopy={onCopy}
      onSpeak={onSpeak}
      onFeedback={onFeedback}
      feedback={feedback[msg.id]}
    />
  ));
});

MessageHistory.displayName = "MessageHistory";

export default function MessageList({
  messages,
  streamDraft,
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
  const previousStatusRef = useRef(status);
  const wasResponding = previousStatusRef.current === "loading" || previousStatusRef.current === "streaming";
  const hasProcess = Boolean(streamDraft?.process && (streamDraft.process.reserve || streamDraft.process.stages?.length));
  useEffect(() => {
    previousStatusRef.current = status;
  }, [status]);

  // A conversation whose transcript is still in flight is NOT an empty one.
  //
  // Messages no longer arrive with the chat list — they are fetched per
  // conversation when it is opened — so between the click and the response
  // `messages` is legitimately empty. Without this branch the user opens a chat
  // with fifty messages in it and is shown "ask me anything", which reads as
  // their history having been deleted. On a cold backend that lasts twenty
  // seconds.
  if (isLoadingMessages) return <MessageSkeleton />;
  if (messageLoadError && !streamDraft?.retryable) {
    return (
      <div className="empty-state message-load-error" role="alert">
        <p>Couldn&apos;t load this conversation.</p>
        <button className="input-btn primary" onClick={onRetryMessages}>
          Retry
        </button>
      </div>
    );
  }
  if (messages.length === 0 && !streamDraft && status === "idle") return <EmptyState onPick={onPickStarter} />;

  return (
    <div className="msg-stream">
      <MessageHistory
        messages={messages}
        feedback={feedback}
        onCopy={onCopy}
        onSpeak={onSpeak}
        onFeedback={onFeedback}
      />

      {streamDraft && (
        <Message
          key={streamDraft.id || "stream-draft"}
          msg={streamDraft}
          isStreaming={status === "streaming"}
          onCopy={onCopy}
          onSpeak={onSpeak}
          onFeedback={onFeedback}
          feedback={feedback[streamDraft.id]}
        />
      )}

      {status === "reconnecting" && (
        <div className="empty-state message-load-error" aria-live="polite">
          <p>Connection lost. Reconnecting...</p>
        </div>
      )}
      {status === "offline" && (
        <div className="empty-state message-load-error" aria-live="polite">
          <p>You&apos;re offline. Waiting for the connection...</p>
        </div>
      )}
      {messageLoadError && streamDraft?.retryable && (
        <div className="empty-state message-load-error" role="alert">
          <p>The answer paused before it finished.</p>
          <button className="input-btn primary" onClick={onRetryMessages}>
            Retry
          </button>
        </div>
      )}

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
      {status === "loading" && !streamDraft && (
        <Message msg={{ role: "assistant", content: "", typing: true, id: "pending", process: PENDING_PROCESS }} />
      )}

      {/* Announced, not just animated. A screen reader had no way to know an
          answer had finished arriving — the only signal was a caret stopping. */}
      <p className="sr-only" role="status" aria-live="polite">
        {!hasProcess && status === "streaming"
          ? "Answer in progress"
          : !hasProcess && status === "idle" && wasResponding
            ? "Answer complete"
            : ""}
      </p>
    </div>
  );
}
