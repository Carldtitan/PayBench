import "./server-only";

import {
  prelaunchGateSchema,
  type PrelaunchGate,
} from "@paybench/contracts";

export const REPLAY_QA_MATRIX = Object.freeze([
  "a_desktop_purchase",
  "b_desktop_purchase",
  "a_mobile_purchase",
  "b_mobile_purchase",
  "a_desktop_stop",
  "b_desktop_stop",
  "a_form_validation",
  "b_form_validation",
  "a_survey_submission",
  "b_survey_submission",
  "assignment_refresh_persistence",
  "mocked_terac_redirect",
] as const);

export type ReplayJourneyId = (typeof REPLAY_QA_MATRIX)[number];

export interface ReplayExecutionResult {
  status: "passed" | "failed" | "missing";
  run_url?: string;
  blocking_findings: number;
  journeys: Partial<Record<ReplayJourneyId, "passed" | "failed" | "missing">>;
  evidence?: Partial<Record<ReplayJourneyId, ReplayJourneyEvidence>>;
  provider?: "replay_qa" | "replay_browser" | "mock";
  project_id?: string;
}

export interface ReplayJourneyEvidence {
  participant_url: string;
  recording_url?: string;
  provider_journey_id?: string;
  target_kind?: "participant" | "superserve_preview";
  status: "passed" | "failed" | "missing";
}

export interface ReplayExecutionAdapter {
  run(input: {
    job_id: string;
    control_url: string;
    challenger_url: string;
    journeys: readonly ReplayJourneyId[];
  }): Promise<ReplayExecutionResult>;
}

export class MockReplayExecutionAdapter implements ReplayExecutionAdapter {
  constructor(private readonly result: ReplayExecutionResult) {}
  async run(): Promise<ReplayExecutionResult> {
    return structuredClone(this.result);
  }
}

export class ReplayGateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReplayGateError";
  }
}

function parseReplayResult(input: unknown): ReplayExecutionResult {
  if (!input || typeof input !== "object") throw new ReplayGateError("REPLAY_RESULT_INVALID", "Replay result is invalid");
  const value = input as Record<string, unknown>;
  if (!["passed", "failed", "missing"].includes(String(value.status))) throw new ReplayGateError("REPLAY_RESULT_INVALID", "Replay status is invalid");
  if (!Number.isInteger(value.blocking_findings) || Number(value.blocking_findings) < 0) throw new ReplayGateError("REPLAY_RESULT_INVALID", "Replay blocker count is invalid");
  if (!value.journeys || typeof value.journeys !== "object" || Array.isArray(value.journeys)) throw new ReplayGateError("REPLAY_RESULT_INVALID", "Replay journey results are missing");
  const journeys: ReplayExecutionResult["journeys"] = {};
  for (const id of REPLAY_QA_MATRIX) {
    const status = (value.journeys as Record<string, unknown>)[id];
    if (status === "passed" || status === "failed" || status === "missing") journeys[id] = status;
  }
  return {
    status: value.status as ReplayExecutionResult["status"],
    run_url: typeof value.run_url === "string" ? value.run_url : undefined,
    blocking_findings: Number(value.blocking_findings),
    journeys,
    evidence:
      value.evidence && typeof value.evidence === "object" && !Array.isArray(value.evidence)
        ? (value.evidence as ReplayExecutionResult["evidence"])
        : undefined,
    provider:
      value.provider === "replay_qa" || value.provider === "replay_browser" || value.provider === "mock"
        ? value.provider
        : undefined,
    project_id: typeof value.project_id === "string" ? value.project_id : undefined,
  };
}

export interface AutomatedQaInputs {
  job_id: string;
  control_url: string;
  challenger_url: string;
  artifact_bundle_hash: string;
  control_matches_source: boolean;
  challenger_has_exactly_one_change: boolean;
  locked_facts_match: boolean;
  pages_approved: boolean;
  quote_approved: boolean;
  founder_payment_confirmed: boolean;
  terac_credit_funding_confirmed: boolean;
}

export interface ReplayPreRecruitmentResult {
  gate: PrelaunchGate;
  replay: ReplayExecutionResult;
}

function allPassed(result: ReplayExecutionResult, ids: readonly ReplayJourneyId[]): boolean {
  return ids.every((id) => result.journeys[id] === "passed");
}

export async function runReplayBeforeRecruitment(
  input: AutomatedQaInputs,
  adapter: ReplayExecutionAdapter,
  clock: () => Date = () => new Date(),
): Promise<ReplayPreRecruitmentResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.job_id)) {
    throw new ReplayGateError("JOB_ID_INVALID", "Replay requires a valid job ID");
  }
  if (!/^[a-f0-9]{64}$/.test(input.artifact_bundle_hash)) {
    throw new ReplayGateError("ARTIFACT_HASH_INVALID", "Replay requires the frozen artifact bundle hash");
  }
  for (const candidate of [input.control_url, input.challenger_url]) {
    let preview: URL;
    try {
      preview = new URL(candidate);
    } catch {
      throw new ReplayGateError("PREVIEW_URL_INVALID", "Replay preview URL is invalid");
    }
    if (preview.protocol !== "https:") throw new ReplayGateError("PREVIEW_URL_INVALID", "Replay previews must use HTTPS");
  }
  const replay = parseReplayResult(await adapter.run({
    job_id: input.job_id,
    control_url: input.control_url,
    challenger_url: input.challenger_url,
    journeys: REPLAY_QA_MATRIX,
  }));

  if (replay.status === "missing") throw new ReplayGateError("REPLAY_MISSING", "Recruitment is blocked until Replay runs");
  if (replay.status !== "passed") throw new ReplayGateError("REPLAY_FAILED", "Recruitment is blocked because Replay failed");
  if (replay.blocking_findings > 0) throw new ReplayGateError("REPLAY_BLOCKING_FINDINGS", "Recruitment is blocked by Replay findings");
  if (!replay.run_url) throw new ReplayGateError("REPLAY_RUN_URL_MISSING", "Recruitment is blocked without a Replay run URL");
  let runUrl: URL;
  try {
    runUrl = new URL(replay.run_url);
  } catch {
    throw new ReplayGateError("REPLAY_RUN_URL_INVALID", "Replay run URL is invalid");
  }
  if (runUrl.protocol !== "https:") throw new ReplayGateError("REPLAY_RUN_URL_INVALID", "Replay run URL must use HTTPS");
  const missing = REPLAY_QA_MATRIX.filter((id) => replay.journeys[id] !== "passed");
  if (missing.length > 0) throw new ReplayGateError("REPLAY_JOURNEY_INCOMPLETE", `Replay journey did not pass: ${missing[0]}`);
  if (replay.provider === "replay_qa") {
    const evidenceMissing = REPLAY_QA_MATRIX.find((id) => {
      const evidence = replay.evidence?.[id];
      if (!evidence || evidence.status !== "passed" || !evidence.recording_url) return true;
      try {
        const target = new URL(evidence.participant_url);
        const recording = new URL(evidence.recording_url);
        const expectedTarget = id.startsWith("b_") ? input.challenger_url : input.control_url;
        const targetMatchesInput = target.toString() === new URL(expectedTarget).toString();
        return (
          target.protocol !== "https:" ||
          !targetMatchesInput ||
          (evidence.target_kind !== "participant" && evidence.target_kind !== "superserve_preview") ||
          recording.protocol !== "https:" ||
          recording.hostname !== "app.replay.io" ||
          !recording.pathname.startsWith("/recording/")
        );
      } catch {
        return true;
      }
    });
    if (evidenceMissing) {
      throw new ReplayGateError(
        "REPLAY_EVIDENCE_MISSING",
        `Replay QA did not provide participant-page recording evidence: ${evidenceMissing}`,
      );
    }
  }

  const checks = {
    control_matches_source: input.control_matches_source,
    challenger_has_exactly_one_change: input.challenger_has_exactly_one_change,
    locked_facts_match: input.locked_facts_match,
    desktop_passes: allPassed(replay, ["a_desktop_purchase", "b_desktop_purchase", "a_desktop_stop", "b_desktop_stop"]),
    mobile_passes: allPassed(replay, ["a_mobile_purchase", "b_mobile_purchase"]),
    purchase_journey_passes: allPassed(replay, ["a_desktop_purchase", "b_desktop_purchase", "a_mobile_purchase", "b_mobile_purchase"]),
    stop_journey_passes: allPassed(replay, ["a_desktop_stop", "b_desktop_stop"]),
    validation_passes: allPassed(replay, ["a_form_validation", "b_form_validation"]),
    survey_submission_passes: allPassed(replay, ["a_survey_submission", "b_survey_submission"]),
    assignment_persistence_passes: allPassed(replay, ["assignment_refresh_persistence"]),
    mocked_terac_redirect_passes: allPassed(replay, ["mocked_terac_redirect"]),
    replay_run_present: true,
    replay_blocking_findings: 0 as const,
    pages_approved: input.pages_approved,
    quote_approved: input.quote_approved,
    founder_payment_confirmed: input.founder_payment_confirmed,
    terac_credit_funding_confirmed: input.terac_credit_funding_confirmed,
  };
  const gate = prelaunchGateSchema.parse({
    checks,
    artifact_bundle_hash: input.artifact_bundle_hash,
    open: Object.values(checks).every((value) => value === true || value === 0),
    checked_at: clock().toISOString(),
  });
  return { gate, replay };
}
