/*
 * A turn can finish without being assembled by the council. Keep those facts
 * separate so the completion mark never becomes a synonym for "the request
 * stopped" or, worse, "the answer is correct".
 */

const progressFromText = (text) => {
  const match = typeof text === "string" && text.match(/\b(\d+)\s+of\s+(\d+)\s+answered\b/i);
  return match ? { answered: Number(match[1]), total: Number(match[2]) } : null;
};

const stageProgress = (stages) => {
  const row = [...(Array.isArray(stages) ? stages : [])]
    .reverse()
    .find((stage) => stage?.key === "council");
  return row?.progress || progressFromText(row?.text) || null;
};

const hasFailedTool = (activity) => Array.isArray(activity) && activity.some((item) => item?.ok === false);

/**
 * Derive the user-facing completion truth from observed process facts.
 * Missing facts stay missing; the fallback is deliberately conservative.
 */
export const deriveProcessOutcome = ({ process = {}, activity = [], content = "", provenance = null } = {}) => {
  const stages = Array.isArray(process.stages) ? process.stages : [];
  const progress = stageProgress(stages);
  const synthesisSeen = Boolean(
    provenance?.synthesis?.started
      || provenance?.synthesis?.completed
      || process.synthesisSeen
      || stages.some((stage) => stage?.key === "synthesis"),
  );
  const answerProduced = provenance?.answerProduced ?? Boolean(String(content || "").trim());
  const requestState = provenance?.requestState
    || (process.phase === "complete" ? "complete" : process.phase === "stopped" ? "aborted" : process.phase === "failed" ? "failed" : "running");
  const userAborted = Boolean(
    provenance?.failure?.userAborted
      || provenance?.userAborted
      || process.phase === "stopped",
  );
  const failureOccurred = Boolean(
    provenance?.failure?.occurred
      || provenance?.synthesis?.failed
      || process.phase === "failed",
  );
  const partialCouncil = Boolean(
    provenance?.council?.partial
      || process.partialCouncil
      || (progress && progress.total > 0 && progress.answered < progress.total),
  );
  const councilCompleted = Boolean(
    provenance?.council?.completed
      || (progress && progress.total > 0 && progress.answered >= progress.total),
  );
  const synthesisCompleted = Boolean(
    provenance?.synthesis?.completed
      || (requestState === "complete" && synthesisSeen && answerProduced && !failureOccurred),
  );
  const partialToolFailure = Boolean(
    provenance?.evidence?.failedTools
      || hasFailedTool(activity),
  );
  const assemblyComplete = requestState === "complete" && answerProduced && synthesisCompleted && !userAborted && !failureOccurred;
  /* A seal is a receipt for a synthesis that actually ran. Partial council
   * participation is allowed, but only because the qualifier travels with it.
   * Unknown participation and failed evidence stay unsealed. */
  const sealAllowed = assemblyComplete
    && (councilCompleted || partialCouncil)
    && !partialToolFailure;
  const qualifier = partialCouncil
    ? "Partial council participation"
    : partialToolFailure
      ? "Partial evidence work"
      : null;

  return {
    requestState,
    answerProduced: Boolean(answerProduced),
    councilCompleted,
    synthesisCompleted,
    verificationCompleted: Boolean(provenance?.verification?.completed),
    partialCouncil,
    failureOccurred,
    userAborted,
    partialToolFailure,
    assemblyComplete,
    sealAllowed,
    qualifier,
    route: provenance?.route || null,
    progress,
  };
};

const stageFromKey = (key, provenance) => {
  if (key === "context") return { key, text: "Read your conversation", state: "completed" };
  if (key === "council") {
    const answered = provenance?.council?.answered;
    const total = provenance?.council?.seatCount;
    const progress = Number.isFinite(answered) && Number.isFinite(total) && total > 0
      ? { answered, total }
      : null;
    return {
      key,
      text: progress ? `${progress.answered} of ${progress.total} answered` : "Council participation completed",
      ...(progress ? { progress } : {}),
      state: provenance?.council?.partial ? "partial" : "completed",
    };
  }
  if (key === "synthesis") {
    return {
      key,
      text: provenance?.synthesis?.completed ? "Reconciled the answers" : "Synthesis",
      state: provenance?.synthesis?.completed ? "completed" : "interrupted",
    };
  }
  return { key, text: "Progress", state: "completed" };
};

/** Rebuild only the compact receipt needed by a reloaded transcript. */
export const processFromProvenance = (provenance) => {
  if (!provenance || typeof provenance !== "object") return null;
  const keys = Array.isArray(provenance.stageKeys) ? provenance.stageKeys : [];
  const stages = keys.slice(0, 8).map((key) => stageFromKey(key, provenance));
  if (!stages.length && !provenance.synthesis?.completed) return null;
  const phase = provenance.requestState === "aborted"
    ? "stopped"
    : provenance.requestState === "failed"
      ? "failed"
      : provenance.requestState === "complete"
        ? "complete"
        : "working";
  return {
    phase,
    reserve: true,
    activeKey: null,
    terminalKey: stages.at(-1)?.key || null,
    stages,
    frames: stages.map(({ key, text }) => ({ key, text })),
    synthesisSeen: Boolean(provenance.synthesis?.started || provenance.synthesis?.completed),
    partialCouncil: Boolean(provenance.council?.partial),
    pendingTools: false,
    announcement: phase === "complete"
      ? "Answer complete."
      : phase === "failed"
        ? "Answer failed before completion."
        : phase === "stopped"
          ? "Answer stopped before completion."
          : "Assembling your answer.",
    provenance,
  };
};

export { progressFromText };
