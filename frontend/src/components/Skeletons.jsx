/**
 * Loading placeholders.
 *
 * `InitialLoader` covers the moment before Clerk resolves, when it is not yet
 * known whether to show the app or the sign-in page. `AppSkeleton` covers the
 * first chat fetch, and mirrors the real layout closely enough that nothing
 * jumps when the data lands.
 */

import { useId } from "react";
import { deriveProcessOutcome } from "../lib/processSemantics";

export const InitialLoader = () => (
  <div className="initial-loader dark">
    {/* favicon.png for the same reason as the sign-in mark: this is the
        FIRST thing painted on every visit, and it was pulling 28 KB to show
        a small logo while the app booted. Same mark, 5.5 KB, and already in
        cache from the tab icon. */}
    <img src="/favicon.png" alt="Loading ALOP-AI" />
    <div className="skeleton-block" style={{ width: "120px", height: "10px", marginTop: "10px" }} />
  </div>
);

/**
 * The transcript alone, for a conversation whose messages are still arriving.
 *
 * Messages no longer come with the chat list — they are fetched per
 * conversation on open — so there is now a gap where a chat is selected and its
 * transcript is not here yet. AppSkeleton is the wrong thing to show for it:
 * that replaces the entire application, so clicking between two conversations
 * would blank the sidebar and the header you just clicked in.
 *
 * Deliberately the SAME rows as AppSkeleton's transcript, extracted rather than
 * re-typed, so the two cannot drift into looking like different products.
 */
export const MessageSkeleton = () => (
  <>
    {Array.from({ length: 3 }, (_, i) => (
      <div key={i} className={`msg-row ${i % 2 === 0 ? "assistant" : "user"}`}>
        <div
          className="skeleton-block"
          style={{ width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0 }}
        />
        <div className="msg-content" style={{ gap: "10px", display: "flex", flexDirection: "column" }}>
          <div className="skeleton-block" style={{ height: "16px", width: "70%" }} />
          <div className="skeleton-block" style={{ height: "16px", width: "85%" }} />
        </div>
      </div>
    ))}
  </>
);

const STAGE_LABELS = {
  context: "Context",
  council: "Council",
  synthesis: "Synthesis",
};

const stageLabel = (key) => STAGE_LABELS[key] || (key ? key : "Progress");

const STAGE_STATE_LABELS = {
  pending: "not started",
  active: "in progress",
  completed: "completed",
  partial: "partial participation",
  interrupted: "interrupted",
  failed: "failed",
};

const STAGE_MARKS = {
  pending: "·",
  active: "•",
  completed: "◇",
  partial: "◌",
  interrupted: "—",
  failed: "—",
};

const councilProgress = (text) => {
  const match = typeof text === "string" && text.match(/\b(\d+)\s+of\s+(\d+)\s+answered\b/i);
  return match ? { answered: Number(match[1]), total: Number(match[2]) } : null;
};

const isTerminalFailure = (phase) => phase === "stopped" || phase === "failed";

const derivedStageState = (stage, index, stages, process, partialCouncil) => {
  if (stage.state) return stage.state;

  const phase = process.phase || "working";
  const terminalKey = process.terminalKey || process.activeKey || stages.at(-1)?.key;
  if (phase === "complete") {
    return stage.key === "council" && partialCouncil ? "partial" : "completed";
  }
  if (isTerminalFailure(phase)) {
    if (stage.key === terminalKey && index === stages.length - 1) {
      return phase === "failed" ? "failed" : "interrupted";
    }
    return index < stages.length - 1 ? "completed" : "interrupted";
  }
  if (phase === "answering") return index === stages.length - 1 ? "active" : "completed";

  const activeIndex = stages.findIndex((item) => item.key === process.activeKey);
  if (activeIndex === -1) return index === stages.length - 1 ? "active" : "completed";
  if (index < activeIndex) return "completed";
  if (index === activeIndex) return "active";
  return "pending";
};

const processHeading = ({ process, hasStages, synthesisSeen, partialCouncil }) => {
  if (process.phase === "stopped" || process.phase === "failed") return "Process incomplete";
  if (process.phase === "complete") {
    return partialCouncil ? "Answer assembled with partial council" : "Answer assembled";
  }
  if (!hasStages) return "Assembling your answer";
  if (process.phase === "answering" || synthesisSeen) return "Coming together";
  return "Assembling your answer";
};

const processTransition = ({ process, synthesisSeen, partialCouncil, pendingTools }) => {
  if (process.phase === "stopped") return "Answer stopped before completion";
  if (process.phase === "failed") return "Answer failed before completion";
  if (pendingTools) return "Evidence work is still in progress";
  if (process.phase === "complete") {
    if (!synthesisSeen) return "Answer complete without a synthesis stage";
    if (partialCouncil) return "Answer complete; council participation was partial";
    return null;
  }
  if (process.phase === "answering") {
    if (!synthesisSeen) return "No synthesis stage was reported";
    if (partialCouncil) return "Council participation was partial";
    return null;
  }
  return null;
};

const ProcessEvidence = ({ activity }) => {
  if (!activity?.length) return null;
  const pending = activity.some((item) => item.pending);
  return (
    <details className="council-process-tools">
      <summary>
        {pending ? "Evidence work in progress" : `Evidence work · ${activity.length} check${activity.length === 1 ? "" : "s"}`}
      </summary>
      <ol className="council-process-tools-list">
        {activity.map((item, index) => (
          <li
            className={`council-process-tool ${item.pending ? "is-pending" : item.ok === false ? "is-failed" : "is-done"}`}
            key={`${item.round}-${item.name}-${index}`}
          >
            <span className="council-process-tool-mark" aria-hidden="true">
              {item.pending ? "·" : item.ok === false ? "—" : "◇"}
            </span>
            <span>{item.summary}</span>
          </li>
        ))}
      </ol>
    </details>
  );
};

/**
 * The truthful process receipt for the live turn.
 *
 * The server's stage frames are not a transcript and are not a debate log.
 * They are bounded facts about which phase is active and what it last said.
 * Grouping repeated frames by their key keeps the council legible while
 * retaining the completed context/council/synthesis sequence when the first
 * answer token replaces the skeleton.
 */
export const CouncilProcess = ({ process, activity }) => {
  const headingId = useId();
  const statusId = `${headingId}-status`;
  const pendingTools = Boolean(process?.pendingTools || activity?.some((item) => item.pending));
  const stages = process?.stages || [];
  if (!process) return null;

  const synthesisSeen = process.synthesisSeen ?? stages.some((stage) => stage.key === "synthesis");
  const partialCouncil = Boolean(
    process.partialCouncil
      || stages.some((stage) => {
        const progress = stage.progress || councilProgress(stage.text);
        return stage.key === "council" && progress && progress.answered < progress.total;
      }),
  );
  const hasStages = stages.length > 0;
  const heading = processHeading({ process, hasStages, synthesisSeen, partialCouncil });
  const outcome = deriveProcessOutcome({ process, activity, provenance: process.provenance });
  const completionHeading = outcome.assemblyComplete
    ? (outcome.qualifier ? `ALOP assembled · ${outcome.qualifier.toLowerCase()}` : "ALOP assembled")
    : heading;
  const phaseLabel = process.phase === "stopped"
    ? "ALOP stopped before the answer was complete"
    : process.phase === "failed"
      ? "ALOP could not complete the answer"
      : process.phase === "complete"
        ? partialCouncil
          ? "ALOP assembled an answer with partial council participation"
          : "ALOP assembled the answer"
        : process.phase === "answering"
          ? "ALOP is forming the answer"
          : pendingTools
            ? "ALOP is still checking evidence"
            : "ALOP is assembling the answer";
  const announcement = process.announcement || stages.at(-1)?.text || phaseLabel;
  const transition = processTransition({ process, synthesisSeen, partialCouncil, pendingTools });
  const isConverging = !pendingTools && synthesisSeen && (process.phase === "working" || process.phase === "answering");
  const isTerminal = process.phase === "complete" || process.phase === "stopped" || process.phase === "failed";

  return (
    <section
      className={`council-process is-${process.phase || "working"} ${isConverging ? "is-converging" : ""} ${isTerminal ? "is-terminal" : "is-live"} ${outcome.sealAllowed ? "is-assembled" : ""}`}
      aria-labelledby={headingId}
      aria-describedby={statusId}
      aria-label={outcome.assemblyComplete ? `${completionHeading}; process completion, not correctness` : phaseLabel}
    >
      <h3 id={headingId} className="council-process-heading">{completionHeading}</h3>
      {outcome.sealAllowed && (
        <p className="council-process-completion" aria-label="Process complete; this does not claim correctness">
          <span className="council-process-completion-mark" aria-hidden="true">◇</span>
          <span>Assembly complete{outcome.qualifier ? ` · ${outcome.qualifier.toLowerCase()}` : ""}</span>
          <span className="sr-only">This is a process receipt, not a correctness claim.</span>
        </p>
      )}
      <p id={statusId} className="sr-only council-process-announcement" role="status" aria-live="polite" aria-atomic="true" aria-label={announcement}>
        {announcement}
      </p>
      {hasStages && <ol className="council-process-list">
        {stages.map((stage, index) => {
          const state = derivedStageState(stage, index, stages, process, partialCouncil);
          const stateLabel = STAGE_STATE_LABELS[state] || STAGE_STATE_LABELS.pending;
          return (
            <li
              className={`council-stage-row is-${state} ${state === "active" ? "is-active" : ""} ${state === "completed" ? "is-complete" : ""}`}
              key={`${stage.key || "status"}-${index}`}
              aria-current={state === "active" ? "step" : undefined}
            >
              <span className="council-stage-mark" aria-hidden="true">
                {STAGE_MARKS[state] || STAGE_MARKS.pending}
              </span>
              <span className="council-stage-copy">
                <span className="council-stage-key">{stageLabel(stage.key)}</span>
                <span className="council-stage-text">{stage.text}</span>
                <span className="sr-only">, {stateLabel}</span>
              </span>
            </li>
          );
        })}
      </ol>
      }
      <ProcessEvidence activity={activity} />
      {transition && <p className="council-process-transition">{transition}</p>}
    </section>
  );
};

/**
 * The shape of the answer that has not arrived yet.
 *
 * This replaces three bouncing dots. Dots are a spinner with extra steps: they
 * say "wait" and nothing else, they occupy a box the wrong size, and the moment
 * the first token lands the whole row jumps as a 40px pill becomes a paragraph.
 * Ragged lines at the prose column's real width say the same "wait" while
 * reserving roughly the space the first sentences will take, so the transcript
 * settles instead of snapping.
 *
 * Three lines, not six: over-reserving is its own jump, in the other direction.
 * The last line is short because a paragraph's last line is.
 */
export const AnswerSkeleton = ({ stage, showStage = true, announce = true }) => (
  <div
    className="answer-skeleton"
    {...(announce ? {
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
      "aria-label": stage || "The council is thinking",
    } : {})}
  >
    <div className="skeleton-block" style={{ height: "14px", width: "92%" }} />
    <div className="skeleton-block" style={{ height: "14px", width: "97%" }} />
    <div className="skeleton-block" style={{ height: "14px", width: "58%" }} />
    {/* WHAT IT IS DOING, NOT THAT IT IS DOING SOMETHING.
        The skeleton reserves the answer's space and says "wait". On the
        council path the wait is most of the turn — seats are polled without
        streaming, so no word can exist until the last one settles — and until
        now the whole of it looked identical to a hung request.

        Only ever real work: the count of seats that have actually answered,
        the query that was actually searched. There is no rotating list of
        plausible activities here, because the first time it claims to be
        searching on a turn that ran no search, nothing else this product
        reports about itself is worth believing.

        The live text is in the DOM, not only in a mutating `aria-label`: a
        label on an element with no text content is not a reliable
        announcement mechanism.

        The visible line is suppressed when the process receipt already owns
        the same fact, so the two cannot say it twice. */}
    {announce && <span className="sr-only">{stage || "The council is thinking"}</span>}
    {stage && showStage && <p className="answer-stage">{stage}</p>}
  </div>
);

/**
 * The lazy transcript chunk's visible boundary.
 *
 * The app shell can finish loading before MessageList and its Markdown stack.
 * A null Suspense fallback made the entire transcript blank in that interval.
 * These are the two loading shapes the transcript already owns: history rows
 * while the chunk itself is arriving, and the existing answer placeholder when
 * a send is already pending. No third visual language is introduced here.
 */
export const TranscriptFallback = ({ answerPending = false }) => (
  <div className="msg-stream" aria-busy="true">
    {answerPending ? (
      <div className="msg-row assistant">
        <span className="sr-only">The council answered:</span>
        <div className="avatar" aria-hidden="true">AI</div>
        <div className="msg-content">
          <AnswerSkeleton />
        </div>
      </div>
    ) : (
      <MessageSkeleton />
    )}
  </div>
);

export const AppSkeleton = () => (
  <div className="app-root dark">
    <div className="bg-layer" />
    <div className="bg-overlay" />
    <div className="app-shell">
      <header className="app-header">
        <div className="skeleton-block" style={{ width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0 }} />
        <div style={{ marginLeft: "10px", gap: "8px", display: "flex", flexDirection: "column" }}>
          <div className="skeleton-block" style={{ width: "140px", height: "16px" }} />
          <div className="skeleton-block" style={{ width: "180px", height: "12px" }} />
        </div>
        <div style={{ flex: 1 }} />
        <div className="skeleton-block" style={{ width: "40px", height: "40px", borderRadius: "12px" }} />
      </header>

      <div className="app-body">
        <div className="sidebar">
          <div className="skeleton-block" style={{ height: "42px", marginBottom: "14px", borderRadius: "12px" }} />
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="skeleton-block"
              style={{ height: "42px", marginBottom: "8px", borderRadius: "12px" }}
            />
          ))}
        </div>

        <div className="chat-main">
          <div className="scroll-wrapper">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={`msg-row ${i % 2 === 0 ? "assistant" : "user"}`}>
                <div
                  className="skeleton-block"
                  style={{ width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0 }}
                />
                <div className="msg-content" style={{ gap: "10px", display: "flex", flexDirection: "column" }}>
                  <div className="skeleton-block" style={{ height: "16px", width: "70%" }} />
                  <div className="skeleton-block" style={{ height: "16px", width: "85%" }} />
                </div>
              </div>
            ))}
          </div>
          <div className="input-bar" style={{ display: "flex", alignItems: "center" }}>
            <div className="skeleton-block" style={{ height: "24px", flex: 1, borderRadius: "8px" }} />
          </div>
        </div>
      </div>
    </div>
  </div>
);

/**
 * Shown when the app has been on skeletons long enough that it is not loading
 * any more, it is stuck.
 *
 * Reuses the sign-in outage styles rather than inventing a third error look —
 * a user who meets both should not think they are in two different products.
 */
export const StuckLoading = () => (
  <div className="signin-root">
    <div className="signin-down" role="alert">
      <h1 className="signin-down-title">This is taking too long.</h1>
      <p className="signin-down-body">
        The app couldn&rsquo;t finish loading your conversations. They are stored on the server
        and are not affected &mdash; nothing has been lost.
      </p>
      <p className="signin-down-body">
        Reloading usually clears it. If it keeps happening, signing out and back in will.
      </p>
      <button className="signin-down-retry" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  </div>
);
