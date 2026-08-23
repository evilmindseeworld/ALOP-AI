import { describe, expect, it } from "vitest";
import { deriveProcessOutcome, processFromProvenance } from "../lib/processSemantics";

const normal = {
  phase: "complete",
  stages: [
    { key: "context", text: "Reading your conversation" },
    { key: "council", text: "3 of 3 answered" },
    { key: "synthesis", text: "Reconciling the answers" },
  ],
};

describe("process completion semantics", () => {
  it("allows a normal council and synthesis completion", () => {
    expect(deriveProcessOutcome({ process: normal, content: "Answer." })).toMatchObject({
      assemblyComplete: true,
      sealAllowed: true,
      councilCompleted: true,
      synthesisCompleted: true,
    });
  });

  it("qualifies partial council participation without treating it as failure", () => {
    const result = deriveProcessOutcome({
      process: {
        ...normal,
        stages: normal.stages.map((stage) => stage.key === "council" ? { ...stage, text: "2 of 3 answered" } : stage),
      },
      content: "Answer.",
    });
    expect(result).toMatchObject({ assemblyComplete: true, sealAllowed: true, partialCouncil: true });
    expect(result.qualifier).toBe("Partial council participation");
  });

  it.each([
    ["single seat", [{ key: "council", text: "1 of 1 answered" }], null],
    ["fallback", [{ key: "council", text: "3 of 3 answered" }], null],
    ["abort", normal.stages, "aborted"],
    ["timeout", normal.stages, "failed"],
    ["failure", normal.stages, "failed"],
  ])("does not allow a synthesis seal for %s", (_label, stages, state) => {
    const process = { phase: state === "aborted" ? "stopped" : state === "failed" ? "failed" : "complete", stages };
    const result = deriveProcessOutcome({ process, content: "Partial answer." });
    expect(result.sealAllowed).toBe(false);
  });

  it("does not call a partial tool result a clean assembly", () => {
    const result = deriveProcessOutcome({ process: normal, content: "Answer.", activity: [{ ok: false }] });
    expect(result.assemblyComplete).toBe(true);
    expect(result.sealAllowed).toBe(false);
    expect(result.partialToolFailure).toBe(true);
  });

  it("rebuilds an old-chat receipt from bounded provenance", () => {
    const process = processFromProvenance({
      schemaVersion: 1,
      requestState: "complete",
      stageKeys: ["context", "council", "synthesis"],
      council: { seatCount: 3, answered: 3, completed: true, partial: false },
      synthesis: { started: true, completed: true },
    });
    expect(process).toMatchObject({ phase: "complete", synthesisSeen: true });
    expect(process.stages.map((stage) => stage.key)).toEqual(["context", "council", "synthesis"]);
  });
});
