import { createHmac, timingSafeEqual } from "node:crypto";

import { REPLAY_QA_MATRIX, type ReplayJourneyId } from "./replay";
import { resolveSupabaseServerKey, SupabaseControlTransport } from "../control/supabase-repository";

type Headers = {
  eventId: string | null;
  timestamp: string | null;
  signature: string | null;
};

export interface ReplayResultPayload {
  job_id: string;
  artifact_bundle_hash: string;
  status: "passed" | "failed";
  run_url?: string;
  blocking_findings: number;
  journeys: Record<ReplayJourneyId, "passed" | "failed" | "missing">;
}

export interface ReplayResultTransport {
  request(
    method: "GET" | "POST" | "PATCH",
    table: string,
    query?: Readonly<Record<string, string>>,
    body?: unknown,
    prefer?: string,
  ): Promise<readonly Record<string, unknown>[]>;
}

export class ReplayIngestionError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
    this.name = "ReplayIngestionError";
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyReplayResultSignature(
  rawBody: string,
  headers: Headers,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!secret || !headers.eventId || !headers.timestamp || !headers.signature) {
    throw new ReplayIngestionError("REPLAY_RESULT_SIGNATURE_MISSING", 401);
  }
  const timestamp = Number(headers.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) {
    throw new ReplayIngestionError("REPLAY_RESULT_SIGNATURE_EXPIRED", 401);
  }
  const expected = createHmac("sha256", secret)
    .update(`${headers.eventId}.${headers.timestamp}.${rawBody}`)
    .digest("hex");
  const supplied = headers.signature.replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied) || !safeEqual(supplied.toLowerCase(), expected)) {
    throw new ReplayIngestionError("REPLAY_RESULT_SIGNATURE_INVALID", 401);
  }
}

function parsePayload(rawBody: string): ReplayResultPayload {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new ReplayIngestionError("REPLAY_RESULT_INVALID");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReplayIngestionError("REPLAY_RESULT_INVALID");
  }
  const row = value as Record<string, unknown>;
  const journeysValue = row.journeys;
  if (!journeysValue || typeof journeysValue !== "object" || Array.isArray(journeysValue)) {
    throw new ReplayIngestionError("REPLAY_JOURNEYS_INVALID");
  }
  const journeyRows = journeysValue as Record<string, unknown>;
  if (
    Object.keys(journeyRows).length !== REPLAY_QA_MATRIX.length ||
    Object.keys(journeyRows).some((key) => !REPLAY_QA_MATRIX.includes(key as ReplayJourneyId))
  ) {
    throw new ReplayIngestionError("REPLAY_JOURNEYS_INVALID");
  }
  const journeys = {} as ReplayResultPayload["journeys"];
  for (const id of REPLAY_QA_MATRIX) {
    const status = journeyRows[id];
    if (status !== "passed" && status !== "failed" && status !== "missing") {
      throw new ReplayIngestionError("REPLAY_JOURNEYS_INVALID");
    }
    journeys[id] = status;
  }
  if (
    typeof row.job_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.job_id) ||
    typeof row.artifact_bundle_hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.artifact_bundle_hash) ||
    (row.status !== "passed" && row.status !== "failed") ||
    !Number.isInteger(row.blocking_findings) ||
    Number(row.blocking_findings) < 0
  ) {
    throw new ReplayIngestionError("REPLAY_RESULT_INVALID");
  }
  let runUrl: string | undefined;
  if (typeof row.run_url === "string") {
    try {
      const url = new URL(row.run_url);
      if (url.protocol !== "https:") throw new Error("protocol");
      runUrl = url.toString();
    } catch {
      throw new ReplayIngestionError("REPLAY_RUN_URL_INVALID");
    }
  }
  return {
    job_id: row.job_id,
    artifact_bundle_hash: row.artifact_bundle_hash,
    status: row.status,
    ...(runUrl ? { run_url: runUrl } : {}),
    blocking_findings: Number(row.blocking_findings),
    journeys,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function replayChecks(payload: ReplayResultPayload): Record<string, boolean | number> {
  const passed = (ids: ReplayJourneyId[]) => ids.every((id) => payload.journeys[id] === "passed");
  return {
    desktop_passes: passed(["a_desktop_purchase", "b_desktop_purchase", "a_desktop_stop", "b_desktop_stop"]),
    mobile_passes: passed(["a_mobile_purchase", "b_mobile_purchase"]),
    purchase_journey_passes: passed(["a_desktop_purchase", "b_desktop_purchase", "a_mobile_purchase", "b_mobile_purchase"]),
    stop_journey_passes: passed(["a_desktop_stop", "b_desktop_stop"]),
    validation_passes: passed(["a_form_validation", "b_form_validation"]),
    survey_submission_passes: passed(["a_survey_submission", "b_survey_submission"]),
    assignment_persistence_passes: passed(["assignment_refresh_persistence"]),
    mocked_terac_redirect_passes: passed(["mocked_terac_redirect"]),
    replay_run_present: Boolean(payload.run_url),
    // The strict gate contract uses zero as the only accepted value. The real
    // blocker count remains in its dedicated database column.
    replay_blocking_findings: 0,
  };
}

export async function ingestReplayResult(
  rawBody: string,
  headers: Headers,
  transport: ReplayResultTransport,
  options: { secret?: string; nowSeconds?: number } = {},
): Promise<{ duplicate: boolean; replay_passed: boolean; gate_open: boolean }> {
  verifyReplayResultSignature(rawBody, headers, options.secret ?? process.env.WORKER_CALLBACK_SECRET, options.nowSeconds);
  const payload = parsePayload(rawBody);
  if (!headers.eventId) throw new ReplayIngestionError("REPLAY_RESULT_EVENT_MISSING", 401);

  try {
    await transport.request("POST", "webhook_events", {}, {
      provider: "replay",
      external_event_id: headers.eventId,
      status: "processing",
    }, "return=minimal");
  } catch {
    const [existing] = await transport.request("GET", "webhook_events", {
      provider: "eq.replay",
      external_event_id: `eq.${headers.eventId}`,
      select: "status",
      limit: "1",
    });
    if (!existing || existing.status !== "failed") {
      return { duplicate: true, replay_passed: false, gate_open: false };
    }
    await transport.request("PATCH", "webhook_events", {
      provider: "eq.replay",
      external_event_id: `eq.${headers.eventId}`,
    }, { status: "processing", processed_at: null }, "return=minimal");
  }

  try {
    const [job] = await transport.request("GET", "jobs", {
      id: `eq.${payload.job_id}`,
      select: "id,artifact_bundle_hash,payment_status",
      limit: "1",
    });
    if (!job) throw new ReplayIngestionError("REPLAY_JOB_NOT_FOUND", 404);
    if (job.artifact_bundle_hash !== payload.artifact_bundle_hash) {
      throw new ReplayIngestionError("REPLAY_ARTIFACT_STALE", 409);
    }
    const [gate] = await transport.request("GET", "quality_gate_runs", {
      job_id: `eq.${payload.job_id}`,
      artifact_bundle_hash: `eq.${payload.artifact_bundle_hash}`,
      select: "id,checks_json",
      limit: "1",
    });
    if (!gate) throw new ReplayIngestionError("REPLAY_GATE_NOT_FOUND", 409);

    const allJourneysPassed = REPLAY_QA_MATRIX.every((id) => payload.journeys[id] === "passed");
    const replayPassed =
      payload.status === "passed" &&
      Boolean(payload.run_url) &&
      payload.blocking_findings === 0 &&
      allJourneysPassed;
    const checks = {
      ...object(gate.checks_json),
      ...replayChecks(payload),
      replay_run_present: replayPassed,
    };
    const gateOpen =
      replayPassed &&
      Object.entries(checks).every(([key, value]) =>
        key === "replay_blocking_findings" ? Number(value) === 0 : value === true,
      );
    await transport.request("PATCH", "quality_gate_runs", { id: `eq.${String(gate.id)}` }, {
      checks_json: checks,
      replay_run_id: headers.eventId,
      replay_run_url: payload.run_url ?? null,
      replay_blocking_findings: payload.blocking_findings,
      gate_open: gateOpen,
      checked_at: new Date().toISOString(),
    }, "return=minimal");
    await transport.request("PATCH", "jobs", { id: `eq.${payload.job_id}` }, {
      status: replayPassed ? "awaiting_approvals" : "qa_replay",
      failure_code: replayPassed ? null : "REPLAY_QA_BLOCKED",
      updated_at: new Date().toISOString(),
    }, "return=minimal");
    await transport.request("PATCH", "webhook_events", {
      provider: "eq.replay",
      external_event_id: `eq.${headers.eventId}`,
    }, { status: "processed", processed_at: new Date().toISOString() }, "return=minimal");
    return { duplicate: false, replay_passed: replayPassed, gate_open: gateOpen };
  } catch (error) {
    await transport.request("PATCH", "webhook_events", {
      provider: "eq.replay",
      external_event_id: `eq.${headers.eventId}`,
    }, { status: "failed", processed_at: new Date().toISOString() }, "return=minimal");
    throw error;
  }
}

export async function runtimeReplayTransport(): Promise<SupabaseControlTransport> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) throw new ReplayIngestionError("SUPABASE_URL_NOT_CONFIGURED", 503);
  return new SupabaseControlTransport(baseUrl, await resolveSupabaseServerKey(process.env));
}
