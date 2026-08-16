import "./server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  REPLAY_QA_MATRIX,
  ReplayGateError,
  type ReplayExecutionResult,
  type ReplayJourneyEvidence,
  type ReplayJourneyId,
} from "./replay";
import {
  createReplayQaContinuation,
  parseReplayQaContinuation,
  parseReplayQaProject,
  resumeReplayQa,
  runtimeReplayQaRestAdapter,
  type ReplayQaContinuation,
  type ReplayQaProject,
  type ReplayQaRestAdapter,
} from "./replay-qa-rest";
import {
  ingestReplayResult,
  ReplayIngestionError,
  runtimeReplayTransport,
  type ReplayResultPayload,
  type ReplayResultTransport,
} from "./replay-ingestion";

type JsonRecord = Record<string, unknown>;

export interface ReplayResumeRequest {
  job_id: string;
  artifact_bundle_hash: string;
  project_id?: string;
  project?: ReplayQaProject;
  continuation?: ReplayQaContinuation;
}

export interface ReplayResumeResponse {
  status: "qa_pending" | "qa_blocked" | "awaiting_approvals";
  project_id: string;
  project_url: string;
  completed_journeys: number;
  total_journeys: number;
  blocking_findings: number;
}

export class ReplayResumeError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
    this.name = "ReplayResumeError";
  }
}

function object(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function safeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyReplayResumeAuthorization(authorization: string | null, secret: string | undefined): void {
  if (!secret || secret.length < 24) throw new ReplayResumeError("REPLAY_RESUME_SECRET_MISSING", 503);
  const supplied = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (!supplied || !safeStringEqual(supplied, secret)) {
    throw new ReplayResumeError("REPLAY_RESUME_UNAUTHORIZED", 401);
  }
}

function parseRequest(value: unknown): ReplayResumeRequest {
  const row = object(value);
  const jobId = typeof row.job_id === "string" ? row.job_id : "";
  const artifactHash = typeof row.artifact_bundle_hash === "string" ? row.artifact_bundle_hash : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new ReplayResumeError("REPLAY_RESUME_JOB_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(artifactHash)) {
    throw new ReplayResumeError("REPLAY_RESUME_ARTIFACT_INVALID");
  }
  return {
    job_id: jobId,
    artifact_bundle_hash: artifactHash,
    ...(typeof row.project_id === "string" ? { project_id: row.project_id } : {}),
    ...(row.project ? { project: row.project as ReplayQaProject } : {}),
    ...(row.continuation ? { continuation: row.continuation as ReplayQaContinuation } : {}),
  };
}

function requestId(continuation: Pick<ReplayQaContinuation, "job_id" | "artifact_bundle_hash">): string {
  return `replay:${continuation.job_id}:${continuation.artifact_bundle_hash}`;
}

export async function persistReplayQaContinuation(
  transport: ReplayResultTransport,
  continuation: ReplayQaContinuation,
  state: "pending" | "passed" | "failed" = "pending",
  result?: ReplayExecutionResult,
): Promise<void> {
  const safeProgress = {
    status: state,
    replay_qa_continuation: continuation,
    project_id: continuation.project.id,
    project_url: continuation.project.url,
    completed_journeys: result
      ? REPLAY_QA_MATRIX.filter((journey) => result.journeys[journey] === "passed").length
      : 0,
    total_journeys: REPLAY_QA_MATRIX.length,
    blocking_findings: result?.blocking_findings ?? 0,
  };
  const id = requestId(continuation);
  const [existing] = await transport.request("GET", "agent_runs", {
    request_id: `eq.${id}`,
    select: "id",
    limit: "1",
  });
  if (existing) {
    await transport.request("PATCH", "agent_runs", { request_id: `eq.${id}` }, {
      status: state === "pending" ? "running" : state,
      result_type: state === "pending" ? null : "replay_qa_result",
      error_code: state === "failed" ? "REPLAY_QA_BLOCKED" : null,
      safe_progress_json: safeProgress,
      completed_at: state === "pending" ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, "return=minimal");
    return;
  }
  await transport.request("POST", "agent_runs", {}, {
    job_id: continuation.job_id,
    request_id: id,
    command_type: "replay_qa",
    result_type: state === "pending" ? null : "replay_qa_result",
    stage: "replay",
    model: "replay-qa-rest",
    status: state === "pending" ? "running" : state,
    error_code: state === "failed" ? "REPLAY_QA_BLOCKED" : null,
    safe_progress_json: safeProgress,
    ...(state === "pending" ? {} : { completed_at: new Date().toISOString() }),
  }, "return=minimal");
}

async function storedContinuation(
  transport: ReplayResultTransport,
  input: Pick<ReplayResumeRequest, "job_id" | "artifact_bundle_hash">,
): Promise<ReplayQaContinuation | undefined> {
  const [gate] = await transport.request("GET", "quality_gate_runs", {
    job_id: `eq.${input.job_id}`,
    artifact_bundle_hash: `eq.${input.artifact_bundle_hash}`,
    select: "checks_json",
    limit: "1",
  });
  const gateChecks = object(gate?.checks_json);
  if (gateChecks._replay_continuation) {
    return parseReplayQaContinuation(gateChecks._replay_continuation);
  }
  const [row] = await transport.request("GET", "agent_runs", {
    request_id: `eq.replay:${input.job_id}:${input.artifact_bundle_hash}`,
    select: "safe_progress_json",
    limit: "1",
  });
  if (!row) return undefined;
  const progress = object(row.safe_progress_json);
  if (!progress.replay_qa_continuation) return undefined;
  return parseReplayQaContinuation(progress.replay_qa_continuation);
}

async function persistPendingGate(
  transport: ReplayResultTransport,
  continuation: ReplayQaContinuation,
  result: ReplayExecutionResult,
): Promise<void> {
  const [gate] = await transport.request("GET", "quality_gate_runs", {
    job_id: `eq.${continuation.job_id}`,
    artifact_bundle_hash: `eq.${continuation.artifact_bundle_hash}`,
    select: "id,checks_json",
    limit: "1",
  });
  if (!gate) throw new ReplayResumeError("REPLAY_RESUME_GATE_NOT_FOUND", 409);
  const checks = {
    ...object(gate.checks_json),
    _replay_continuation: continuation,
    replay_run_present: false,
    replay_blocking_findings: result.blocking_findings,
  };
  await transport.request("PATCH", "quality_gate_runs", { id: `eq.${String(gate.id)}` }, {
    checks_json: checks,
    replay_run_id: continuation.project.id,
    replay_run_url: continuation.project.url,
    replay_blocking_findings: result.blocking_findings,
    gate_open: false,
    checked_at: new Date().toISOString(),
  }, "return=minimal");
}

async function ensureGate(
  transport: ReplayResultTransport,
  continuation: ReplayQaContinuation,
): Promise<void> {
  const [gate] = await transport.request("GET", "quality_gate_runs", {
    job_id: `eq.${continuation.job_id}`,
    artifact_bundle_hash: `eq.${continuation.artifact_bundle_hash}`,
    select: "id",
    limit: "1",
  });
  if (gate) return;
  const checks = {
    control_matches_source: false,
    challenger_has_exactly_one_change: false,
    locked_facts_match: false,
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
    founder_payment_confirmed: false,
    terac_credit_funding_confirmed: false,
  };
  await transport.request("POST", "quality_gate_runs", {}, {
    job_id: continuation.job_id,
    artifact_bundle_hash: continuation.artifact_bundle_hash,
    checks_json: checks,
    replay_run_id: continuation.project.id,
    replay_run_url: continuation.project.url,
    replay_blocking_findings: 0,
    gate_open: false,
  }, "return=minimal");
}

function completeEvidence(result: ReplayExecutionResult): Record<ReplayJourneyId, ReplayJourneyEvidence> {
  const evidence = {} as Record<ReplayJourneyId, ReplayJourneyEvidence>;
  for (const journey of REPLAY_QA_MATRIX) {
    const item = result.evidence?.[journey];
    if (!item) throw new ReplayResumeError("REPLAY_RESUME_EVIDENCE_INVALID", 502);
    evidence[journey] = item;
  }
  return evidence;
}

async function ingestPulledResult(input: {
  continuation: ReplayQaContinuation;
  result: ReplayExecutionResult;
  transport: ReplayResultTransport;
  secret: string;
}): Promise<void> {
  const payload: ReplayResultPayload = {
    job_id: input.continuation.job_id,
    artifact_bundle_hash: input.continuation.artifact_bundle_hash,
    provider: "replay_qa",
    project_id: input.continuation.project.id,
    targets: {
      control: input.continuation.project.targets.control.url,
      challenger: input.continuation.project.targets.challenger.url,
    },
    status: input.result.status === "passed" ? "passed" : "failed",
    ...(input.result.run_url ? { run_url: input.result.run_url } : {}),
    blocking_findings: input.result.blocking_findings,
    journeys: Object.fromEntries(REPLAY_QA_MATRIX.map((journey) => [journey, input.result.journeys[journey] ?? "missing"])) as ReplayResultPayload["journeys"],
    evidence: completeEvidence(input.result),
  };
  const rawBody = JSON.stringify(payload);
  const digest = createHash("sha256").update(rawBody).digest("hex").slice(0, 32);
  const eventId = `replay-pull:${input.continuation.project.id}:${digest}`;
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", input.secret)
    .update(`${eventId}.${timestamp}.${rawBody}`)
    .digest("hex");
  await ingestReplayResult(rawBody, {
    eventId,
    timestamp,
    signature: `sha256=${signature}`,
  }, input.transport, { secret: input.secret });
}

function assertJobMatches(row: Record<string, unknown> | undefined, input: ReplayResumeRequest): void {
  if (!row) throw new ReplayResumeError("REPLAY_RESUME_JOB_NOT_FOUND", 404);
  if (row.artifact_bundle_hash !== input.artifact_bundle_hash) {
    throw new ReplayResumeError("REPLAY_RESUME_ARTIFACT_STALE", 409);
  }
}

async function resolveContinuation(
  input: ReplayResumeRequest,
  transport: ReplayResultTransport,
  adapter: ReplayQaRestAdapter,
): Promise<ReplayQaContinuation> {
  if (input.continuation) {
    const parsed = parseReplayQaContinuation(input.continuation);
    if (parsed.job_id !== input.job_id || parsed.artifact_bundle_hash !== input.artifact_bundle_hash) {
      throw new ReplayResumeError("REPLAY_RESUME_CONTINUATION_MISMATCH", 409);
    }
    return parsed;
  }
  if (input.project) {
    return createReplayQaContinuation({
      job_id: input.job_id,
      artifact_bundle_hash: input.artifact_bundle_hash,
      project: parseReplayQaProject(input.project),
    });
  }
  const stored = await storedContinuation(transport, input);
  if (stored) return stored;
  if (!input.project_id) throw new ReplayResumeError("REPLAY_RESUME_PROJECT_MISSING", 404);
  const project = await adapter.fetchParticipantProject(input.project_id);
  return createReplayQaContinuation({
    job_id: input.job_id,
    artifact_bundle_hash: input.artifact_bundle_hash,
    project,
  });
}

export async function resumeReplayQaJob(
  requestBody: unknown,
  dependencies: {
    transport: ReplayResultTransport;
    adapter: ReplayQaRestAdapter;
    secret: string;
  },
): Promise<ReplayResumeResponse> {
  const input = parseRequest(requestBody);
  const [job] = await dependencies.transport.request("GET", "jobs", {
    id: `eq.${input.job_id}`,
    select: "id,artifact_bundle_hash,status",
    limit: "1",
  });
  assertJobMatches(job, input);
  const continuation = await resolveContinuation(input, dependencies.transport, dependencies.adapter);
  await persistReplayQaContinuation(dependencies.transport, continuation);
  await ensureGate(dependencies.transport, continuation);

  // This is the only provider read used for a resume. We never accept a status
  // supplied by a caller or webhook as proof that Replay passed.
  const resumed = await resumeReplayQa(continuation.project, dependencies.adapter);
  const state = resumed.status === "qa_pending" ? "pending" : resumed.status === "qa_blocked" ? "failed" : "passed";
  await persistReplayQaContinuation(dependencies.transport, continuation, state, resumed.result);
  if (resumed.status === "qa_pending") {
    await persistPendingGate(dependencies.transport, continuation, resumed.result);
    await dependencies.transport.request("PATCH", "jobs", { id: `eq.${continuation.job_id}` }, {
      status: "qa_replay",
      failure_code: null,
      updated_at: new Date().toISOString(),
    }, "return=minimal");
  } else {
    await ingestPulledResult({
      continuation,
      result: resumed.result,
      transport: dependencies.transport,
      secret: dependencies.secret,
    });
  }
  return {
    status: resumed.status,
    project_id: continuation.project.id,
    project_url: continuation.project.url,
    completed_journeys: REPLAY_QA_MATRIX.filter((journey) => resumed.result.journeys[journey] === "passed").length,
    total_journeys: REPLAY_QA_MATRIX.length,
    blocking_findings: resumed.result.blocking_findings,
  };
}

export async function runtimeReplayResumeDependencies(): Promise<{
  transport: ReplayResultTransport;
  adapter: ReplayQaRestAdapter;
  secret: string;
}> {
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!secret || secret.length < 24) throw new ReplayResumeError("REPLAY_RESUME_SECRET_MISSING", 503);
  return {
    transport: await runtimeReplayTransport(),
    adapter: runtimeReplayQaRestAdapter(),
    secret,
  };
}

export function replayResumeError(error: unknown): ReplayResumeError {
  if (error instanceof ReplayResumeError) return error;
  if (error instanceof ReplayIngestionError) return new ReplayResumeError(error.code, error.status);
  if (error instanceof ReplayGateError) return new ReplayResumeError(error.code, 502);
  return new ReplayResumeError("REPLAY_RESUME_FAILED", 500);
}
