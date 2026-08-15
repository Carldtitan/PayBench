import { describe, expect, it } from "vitest";
import { createDirectionalReport } from "../../apps/web/src/server/orchestration/directional-report";
import {
  assertWorkflowTransition,
  canUnlockMain,
} from "../../apps/web/src/server/orchestration/workflow";

const jobId = "63ca958e-3ad5-4f07-9f76-950da5587a1a";

describe("integrated workflow invariants", () => {
  it("keeps Replay and approvals before pilot", () => {
    expect(() => assertWorkflowTransition("qa_replay", "pilot")).toThrow(
      "INVALID_WORKFLOW_TRANSITION",
    );
    expect(() => assertWorkflowTransition("qa_replay", "awaiting_approvals")).not.toThrow();
    expect(() => assertWorkflowTransition("awaiting_approvals", "pilot")).not.toThrow();
  });

  it("unlocks main only after one successful pilot per page", () => {
    expect(
      canUnlockMain([
        { variant: "A", quality: "valid", survey_complete: true, redirect_complete: true },
        { variant: "B", quality: "valid", survey_complete: true, redirect_complete: true },
      ]),
    ).toBe(true);
    expect(
      canUnlockMain([
        { variant: "A", quality: "valid", survey_complete: true, redirect_complete: true },
        { variant: "A", quality: "valid", survey_complete: true, redirect_complete: true },
      ]),
    ).toBe(false);
  });

  it("excludes technical failures and reports directional evidence", () => {
    const sessions = [
      ...Array.from({ length: 5 }, () => ({ variant: "A" as const, decision: "continue" as const, quality: "valid" as const, clarity_score: 4, trust_score: 4 })),
      ...Array.from({ length: 5 }, () => ({ variant: "B" as const, decision: "continue" as const, quality: "valid" as const, clarity_score: 5, trust_score: 5 })),
      { variant: "B" as const, decision: "stop" as const, quality: "technical_failure" as const, clarity_score: 1, trust_score: 1 },
    ];

    const report = createDirectionalReport(jobId, sessions);
    expect(report.result).toBe("no_clear_signal");
    expect(report.valid_sessions).toBe(10);
    expect(report.technical_failures).toBe(1);
    expect(report.limitation).toContain("not statistically significant");
  });
});
