import { describe, expect, it } from "vitest";
import {
  MockReplayExecutionAdapter,
  REPLAY_QA_MATRIX,
  ReplayGateError,
  runReplayBeforeRecruitment,
  type ReplayExecutionResult,
} from "../../apps/web/src/server/engine/replay";

const journeys = Object.fromEntries(REPLAY_QA_MATRIX.map((id) => [id, "passed"])) as ReplayExecutionResult["journeys"];
const input = {
  job_id: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
  control_url: "https://preview.example/a",
  challenger_url: "https://preview.example/b",
  artifact_bundle_hash: "a".repeat(64),
  control_matches_source: true,
  challenger_has_exactly_one_change: true,
  locked_facts_match: true,
  pages_approved: true,
  quote_approved: true,
  founder_payment_confirmed: true,
  terac_credit_funding_confirmed: true,
};

describe("Replay pre-recruitment gate", () => {
  it("opens only after every Replay journey and hard gate passes", async () => {
    const result = await runReplayBeforeRecruitment(input, new MockReplayExecutionAdapter({
      status: "passed",
      run_url: "https://app.replay.io/recording/demo",
      blocking_findings: 0,
      journeys,
    }), () => new Date("2026-08-15T20:00:00.000Z"));
    expect(result.gate.open).toBe(true);
    expect(result.gate.checks.replay_run_present).toBe(true);
    expect(result.gate.checked_at).toBe("2026-08-15T20:00:00.000Z");
  });

  it.each([
    { status: "missing" as const, blocking_findings: 0, code: "REPLAY_MISSING" },
    { status: "failed" as const, blocking_findings: 0, code: "REPLAY_FAILED" },
    { status: "passed" as const, blocking_findings: 1, code: "REPLAY_BLOCKING_FINDINGS" },
  ])("fails closed for $code", async ({ status, blocking_findings, code }) => {
    await expect(runReplayBeforeRecruitment(input, new MockReplayExecutionAdapter({
      status,
      run_url: "https://app.replay.io/recording/demo",
      blocking_findings,
      journeys,
    }))).rejects.toMatchObject<Partial<ReplayGateError>>({ code });
  });

  it("fails closed when one required journey is absent", async () => {
    const incomplete = { ...journeys };
    delete incomplete.mocked_terac_redirect;
    await expect(runReplayBeforeRecruitment(input, new MockReplayExecutionAdapter({
      status: "passed",
      run_url: "https://app.replay.io/recording/demo",
      blocking_findings: 0,
      journeys: incomplete,
    }))).rejects.toMatchObject({ code: "REPLAY_JOURNEY_INCOMPLETE" });
  });

  it("keeps the gate closed when an operator approval is missing", async () => {
    const result = await runReplayBeforeRecruitment({ ...input, pages_approved: false }, new MockReplayExecutionAdapter({
      status: "passed",
      run_url: "https://app.replay.io/recording/demo",
      blocking_findings: 0,
      journeys,
    }));
    expect(result.gate.open).toBe(false);
  });
});

