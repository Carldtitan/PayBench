import { describe, expect, it, vi } from "vitest";

import {
  REPLAY_QA_MATRIX,
  type ReplayExecutionResult,
  type ReplayJourneyId,
} from "../../apps/web/src/server/engine/replay";
import {
  beginReplayQa,
  resumeReplayQa,
  type ReplayQaProject,
} from "../../apps/web/src/server/engine/replay-qa-rest";

const jobId = "02eb2619-c2ca-4a53-a27a-e401b141e50e";
const controlUrl = "https://a.preview.superserve.ai/control?signed=control";
const challengerUrl = "https://b.preview.superserve.ai/challenger?signed=challenger";

const project: ReplayQaProject = {
  id: "replay-project-paybench",
  url: "https://qa.replay.io/projects/replay-project-paybench",
  journeys: Object.fromEntries(
    REPLAY_QA_MATRIX.map((journey) => [journey, `provider-${journey}`]),
  ),
  targets: {
    control: { url: controlUrl, kind: "superserve_preview" },
    challenger: { url: challengerUrl, kind: "superserve_preview" },
  },
};

function replayResult(options: {
  missing?: ReplayJourneyId;
  omitEvidence?: ReplayJourneyId;
  blockingFindings?: number;
} = {}): ReplayExecutionResult {
  const journeys = Object.fromEntries(
    REPLAY_QA_MATRIX.map((journey) => [
      journey,
      journey === options.missing ? "missing" : "passed",
    ]),
  ) as ReplayExecutionResult["journeys"];
  const evidence = Object.fromEntries(
    REPLAY_QA_MATRIX
      .filter((journey) => journey !== options.missing && journey !== options.omitEvidence)
      .map((journey, index) => [
        journey,
        {
          participant_url: journey.startsWith("b_") ? challengerUrl : controlUrl,
          recording_url: `https://app.replay.io/recording/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          provider_journey_id: `provider-${journey}`,
          target_kind: "superserve_preview" as const,
          status: "passed" as const,
        },
      ]),
  ) as ReplayExecutionResult["evidence"];
  const blockingFindings = options.blockingFindings ?? 0;
  return {
    status: blockingFindings > 0 ? "failed" : options.missing ? "missing" : "passed",
    run_url: "https://app.replay.io/recording/00000000-0000-4000-8000-999999999999",
    blocking_findings: blockingFindings,
    journeys,
    evidence,
    provider: "replay_qa",
    project_id: project.id,
  };
}

describe("asynchronous Replay orchestration", () => {
  it("starts the Replay project and returns pending without waiting or touching Terac", async () => {
    const createParticipantProject = vi.fn(async () => structuredClone(project));
    const readParticipantProject = vi.fn(async () => {
      throw new Error("INITIAL_REQUEST_MUST_NOT_WAIT_FOR_REPLAY");
    });
    const teracWrite = vi.fn(() => {
      throw new Error("TERAC_MUST_REMAIN_DISABLED");
    });

    const started = await beginReplayQa(
      {
        job_id: jobId,
        control_url: controlUrl,
        challenger_url: challengerUrl,
        journeys: REPLAY_QA_MATRIX,
      },
      { createParticipantProject, readParticipantProject },
    );

    expect(started).toEqual({ status: "qa_pending", project });
    expect(createParticipantProject).toHaveBeenCalledOnce();
    expect(readParticipantProject).not.toHaveBeenCalled();
    expect(teracWrite).not.toHaveBeenCalled();
    expect(started.status).not.toMatch(/pilot|terac/i);
  });

  it("keeps the run pending while Replay still reports an unfinished journey", async () => {
    const readParticipantProject = vi.fn(async () =>
      replayResult({ missing: "b_mobile_purchase" }),
    );

    const resumed = await resumeReplayQa(project, {
      createParticipantProject: vi.fn(),
      readParticipantProject,
    });

    expect(resumed.status).toBe("qa_pending");
    expect(readParticipantProject).toHaveBeenCalledOnce();
  });

  it("blocks an inconsistent pass that contains only eleven recordings", async () => {
    const readParticipantProject = vi.fn(async () =>
      replayResult({ omitEvidence: "b_mobile_purchase" }),
    );

    const resumed = await resumeReplayQa(project, {
      createParticipantProject: vi.fn(),
      readParticipantProject,
    });

    expect(resumed.status).toBe("qa_blocked");
    expect(resumed.result.status).toBe("passed");
    expect(resumed.result.journeys.b_mobile_purchase).toBe("passed");
    expect(resumed.result.evidence?.b_mobile_purchase).toBeUndefined();
    expect(Object.values(resumed.result.evidence ?? {})).toHaveLength(11);
    expect(readParticipantProject).toHaveBeenCalledOnce();
    if (resumed.status === "qa_blocked") {
      expect(resumed.error_code).toBe("REPLAY_QA_BLOCKED");
    }
  });

  it("blocks the run when Replay reports a blocking finding", async () => {
    const resumed = await resumeReplayQa(project, {
      createParticipantProject: vi.fn(),
      readParticipantProject: vi.fn(async () => replayResult({ blockingFindings: 1 })),
    });

    expect(resumed.status).toBe("qa_blocked");
    expect(resumed.result.blocking_findings).toBe(1);
  });

  it("advances only after all twelve journeys have Replay recording evidence", async () => {
    const resumed = await resumeReplayQa(project, {
      createParticipantProject: vi.fn(),
      readParticipantProject: vi.fn(async () => replayResult()),
    });

    expect(resumed.status).toBe("awaiting_approvals");
    expect(REPLAY_QA_MATRIX).toHaveLength(12);
    expect(Object.values(resumed.result.journeys)).toHaveLength(12);
    expect(Object.values(resumed.result.journeys).every((status) => status === "passed")).toBe(true);
    expect(Object.values(resumed.result.evidence ?? {})).toHaveLength(12);
    expect(
      Object.values(resumed.result.evidence ?? {}).every(
        (evidence) => evidence?.recording_url?.startsWith("https://app.replay.io/recording/"),
      ),
    ).toBe(true);
  });
});
