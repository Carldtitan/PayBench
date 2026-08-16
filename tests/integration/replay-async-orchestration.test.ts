import { describe, expect, it, vi } from "vitest";

import {
  REPLAY_QA_MATRIX,
  type ReplayExecutionResult,
  type ReplayJourneyId,
} from "../../apps/web/src/server/engine/replay";
import {
  beginReplayQa,
  createReplayQaContinuation,
  resumeReplayQa,
  type ReplayQaProject,
  type ReplayQaRestAdapter,
} from "../../apps/web/src/server/engine/replay-qa-rest";
import { resumeReplayQaJob } from "../../apps/web/src/server/engine/replay-resume";
import type { ReplayResultTransport } from "../../apps/web/src/server/engine/replay-ingestion";

const jobId = "02eb2619-c2ca-4a53-a27a-e401b141e50e";
const controlUrl = "https://a.preview.superserve.ai/control?signed=control";
const challengerUrl = "https://b.preview.superserve.ai/challenger?signed=challenger";
const artifactHash = "a".repeat(64);

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

  it("rejects mocked evidence even when all twelve journey fields say passed", async () => {
    const mocked = replayResult();
    mocked.provider = "mock";
    const resumed = await resumeReplayQa(project, {
      createParticipantProject: vi.fn(),
      readParticipantProject: vi.fn(async () => mocked),
    });

    expect(resumed.status).toBe("qa_blocked");
  });

  it("rejects evidence from a different Replay project", async () => {
    const wrongProject = replayResult();
    wrongProject.project_id = "another-replay-project";
    const resumed = await resumeReplayQa(project, {
      createParticipantProject: vi.fn(),
      readParticipantProject: vi.fn(async () => wrongProject),
    });

    expect(resumed.status).toBe("qa_blocked");
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

  it("resumes the persisted job with one provider read and never opens pilot or Terac", async () => {
    const calls: Array<{
      method: "GET" | "POST" | "PATCH";
      table: string;
      body?: unknown;
    }> = [];
    const checks = {
      control_matches_source: true,
      challenger_has_exactly_one_change: true,
      locked_facts_match: true,
      desktop_passes: false,
      mobile_passes: false,
      purchase_journey_passes: false,
      stop_journey_passes: false,
      validation_passes: false,
      survey_submission_passes: false,
      assignment_persistence_passes: false,
      mocked_terac_redirect_passes: false,
      replay_run_present: false,
      replay_blocking_findings: 0,
      pages_approved: false,
      quote_approved: false,
      founder_payment_confirmed: true,
      terac_credit_funding_confirmed: false,
    };
    const transport: ReplayResultTransport = {
      async request(method, table, _query, body) {
        calls.push({ method, table, body });
        if (method === "GET" && table === "jobs") {
          return [{
            id: jobId,
            artifact_bundle_hash: artifactHash,
            status: "qa_replay",
            payment_status: "paid",
          }];
        }
        if (method === "GET" && table === "agent_runs") return [{ id: "replay-agent-run" }];
        if (method === "GET" && table === "quality_gate_runs") {
          return [{ id: "replay-gate", checks_json: checks }];
        }
        return [];
      },
    };
    const readParticipantProject = vi.fn(async () => replayResult());
    const adapter = {
      readParticipantProject,
    } as unknown as ReplayQaRestAdapter;
    const continuation = createReplayQaContinuation({
      job_id: jobId,
      artifact_bundle_hash: artifactHash,
      project,
      created_at: "2026-08-15T19:00:00.000Z",
    });

    const resumed = await resumeReplayQaJob(
      { job_id: jobId, artifact_bundle_hash: artifactHash, continuation },
      { transport, adapter, secret: "replay-test-secret-that-is-long-enough" },
    );

    expect(resumed).toMatchObject({
      status: "awaiting_approvals",
      completed_journeys: 12,
      total_journeys: 12,
      blocking_findings: 0,
    });
    expect(readParticipantProject).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.table.toLowerCase().includes("terac"))).toBe(false);
    const jobStatuses = calls
      .filter((call) => call.method === "PATCH" && call.table === "jobs")
      .map((call) => (call.body as { status?: string } | undefined)?.status);
    expect(jobStatuses).toEqual(["awaiting_approvals"]);
    expect(jobStatuses).not.toContain("pilot");
  });
});
