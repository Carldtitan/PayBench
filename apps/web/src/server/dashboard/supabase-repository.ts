import {
  dashboardActorSchema,
  dashboardRunEventSchema,
  dashboardRunSnapshotSchema,
  dashboardStageIdSchema,
  jobStatusSchema,
  replayLiveStateSchema,
  sandboxLiveStateSchema,
  type DashboardActor,
  type DashboardArtifact,
  type DashboardRunEvent,
  type DashboardRunListItem,
  type DashboardRunSnapshot,
  type DashboardStageId,
  type DashboardStageStatus,
  type JobStatus,
  type ReplayLiveState,
  type SandboxLiveState,
} from "@paybench/contracts";
import {
  deriveDashboardRunSnapshot,
  type CanonicalRunRecords,
  type CanonicalStageProgress,
  type DashboardRepository,
} from "./repository";

export interface DashboardTableTransport {
  select(
    table: string,
    query: Readonly<Record<string, string>>,
  ): Promise<readonly unknown[]>;
}

export type DashboardFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Server-only PostgREST transport. It never serializes its key or raw rows. */
export class SupabaseRestTransport implements DashboardTableTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly secretKey: string,
    private readonly fetchImpl: DashboardFetch = fetch,
  ) {}

  async select(
    table: string,
    query: Readonly<Record<string, string>>,
  ): Promise<readonly unknown[]> {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid dashboard table");

    const url = new URL(`/rest/v1/${table}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      apikey: this.secretKey,
    };
    // Legacy service-role keys are JWTs. New sb_secret keys authenticate with
    // the apikey header and must not be copied into a browser request.
    if (this.secretKey.startsWith("eyJ")) {
      headers.Authorization = `Bearer ${this.secretKey}`;
    }

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Dashboard data request failed (${response.status})`);
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("Dashboard data response is invalid");
    return data;
  }
}

type UnknownRow = Record<string, unknown>;

const SAFE_EVENT_SUMMARIES = new Set([
  "Website received",
  "Stripe payment confirmed",
  "Superserve opened the submitted website",
  "Automatic paywall capture stopped",
  "Manual capture task prepared",
  "Both paywall variants passed validation",
  "End-user study started",
  "Valid study sessions received",
  "QA started",
  "QA found a blocking checkout issue",
]);

const SUMMARY_BY_REASON: Record<string, string> = {
  intake_received: "Website received",
  payment_confirmed: "Stripe payment confirmed",
  capture_started: "Superserve opened the submitted website",
  capture_blocked: "Automatic paywall capture stopped",
  scout_requested: "Manual capture task prepared",
  variants_ready: "Both paywall variants passed validation",
  study_started: "End-user study started",
  study_progress: "Valid study sessions received",
  replay_started: "QA started",
  replay_failed: "QA found a blocking checkout issue",
};

const STAGE_ACTORS: Record<DashboardStageId, DashboardActor> = {
  intake: "paybench",
  payment: "stripe",
  capture: "superserve",
  variants: "superserve",
  replay: "paybench",
  approvals: "paybench",
  pilot: "terac",
  study: "terac",
  report: "paybench",
  delivery: "linq",
};

function asRow(value: unknown): UnknownRow | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRow)
    : null;
}

function text(row: UnknownRow, key: string): string | undefined {
  return typeof row[key] === "string" ? row[key] : undefined;
}

function integer(row: UnknownRow, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function isoDate(value: unknown, fallback?: string): string | undefined {
  const candidate = typeof value === "string" ? value : fallback;
  if (!candidate) return undefined;
  const date = new Date(candidate);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function safeWebsiteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function founderLabel(websiteUrl: string, jobId: string): string {
  const hostname = new URL(websiteUrl).hostname.replace(/^www\./, "");
  const firstLabel = hostname.split(".")[0]?.replace(/[-_]+/g, " ").trim();
  if (!firstLabel) return `Run ${jobId.slice(0, 8)}`;
  return firstLabel
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 64);
}

function safeObjectPath(value: unknown, jobId: string): string | undefined {
  if (typeof value !== "string" || value.length > 512) return undefined;
  if (!value.startsWith(`jobs/${jobId}/`) || value.includes("..")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
  return value;
}

function jobStatus(row: UnknownRow): JobStatus | null {
  const result = jobStatusSchema.safeParse(row.status);
  return result.success ? result.data : null;
}

function paymentSucceeded(row: UnknownRow): boolean {
  return ["paid", "succeeded", "complete", "completed"].includes(
    text(row, "payment_status")?.toLowerCase() ?? "",
  );
}

function mapAgentStatus(value: unknown): DashboardStageStatus | null {
  if (typeof value !== "string") return null;
  if (["completed", "complete", "succeeded", "ready", "passed"].includes(value)) {
    return "complete";
  }
  if (["running", "started", "in_progress", "recording", "checking"].includes(value)) {
    return "running";
  }
  if (["blocked", "needs_input", "paused"].includes(value)) return "blocked";
  if (["failed", "error"].includes(value)) return "failed";
  if (["queued", "pending", "waiting"].includes(value)) return "waiting";
  return null;
}

function stageProgress(rows: readonly unknown[]): CanonicalStageProgress[] {
  const progress: CanonicalStageProgress[] = [];
  for (const value of rows) {
    const row = asRow(value);
    if (!row) continue;
    const stage = dashboardStageIdSchema.safeParse(row.stage);
    const status = mapAgentStatus(row.status);
    if (stage.success && status) progress.push({ stage: stage.data, status });
  }
  return progress;
}

function safeProgressObject(row: UnknownRow): UnknownRow | null {
  const value = row.safe_progress_json;
  if (typeof value === "string") {
    try {
      return asRow(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRow(value);
}

function liveSurfaces(rows: readonly unknown[]): {
  sandboxes: SandboxLiveState[];
  replay: ReplayLiveState;
} {
  const byVariant = new Map<"A" | "B", SandboxLiveState>();
  let replay: ReplayLiveState = {
    status: "queued",
    completed_checks: 0,
    total_checks: 0,
    blocking_findings: 0,
  };

  for (const value of rows) {
    const row = asRow(value);
    if (!row) continue;
    const progress = safeProgressObject(row);
    if (progress) {
      const candidates = Array.isArray(progress.sandboxes)
        ? progress.sandboxes
        : progress.sandbox
          ? [progress.sandbox]
          : [];
      for (const candidate of candidates) {
        const parsed = sandboxLiveStateSchema.safeParse(candidate);
        if (parsed.success) byVariant.set(parsed.data.variant, parsed.data);
      }

      const parsedReplay = replayLiveStateSchema.safeParse(progress.replay);
      if (parsedReplay.success) replay = parsedReplay.data;
    }

    if (row.stage === "replay" && !progress?.replay) {
      const status = text(row, "status");
      if (status === "failed") replay = { ...replay, status: "failed" };
      if (status === "completed" || status === "passed") {
        replay = { ...replay, status: "passed" };
      }
    }
  }

  return { sandboxes: [...byVariant.values()].slice(0, 2), replay };
}

function persistedSurfaces(rows: readonly unknown[]): SandboxLiveState[] {
  const latest = new Map<"A" | "B", SandboxLiveState>();
  const statusMap: Record<string, SandboxLiveState["status"]> = {
    queued: "queued",
    working: "editing",
    ready: "ready",
    failed: "failed",
  };
  for (const value of rows) {
    const row = asRow(value);
    if (!row) continue;
    const variant = text(row, "variant_label");
    const sandboxId = text(row, "superserve_sandbox_id");
    const status = statusMap[text(row, "status") ?? ""];
    const lastActivity = isoDate(row.updated_at ?? row.created_at);
    if ((variant !== "A" && variant !== "B") || !sandboxId || !status || !lastActivity) continue;
    const previewUrl =
      text(row, "preview_access") === "operator_private"
        ? safeHttpsUrl(row.latest_preview_path)
        : undefined;
    latest.set(variant, {
      variant,
      sandbox_id: sandboxId.slice(0, 160),
      status,
      task:
        status === "ready"
          ? `Variant ${variant} ready`
          : status === "failed"
            ? `Variant ${variant} stopped`
            : `Building variant ${variant}`,
      ...(previewUrl ? { preview_url: previewUrl } : {}),
      last_activity_at: lastActivity,
    });
  }
  return [...latest.values()].sort((left, right) => left.variant.localeCompare(right.variant));
}

function jsonObject(value: unknown): UnknownRow | null {
  if (typeof value !== "string") return asRow(value);
  try {
    return asRow(JSON.parse(value));
  } catch {
    return null;
  }
}

function persistedReplay(
  rows: readonly unknown[],
  fallback: ReplayLiveState,
  jobStatus: string,
): ReplayLiveState {
  const row = asRow(rows[0]);
  if (!row) return fallback;
  const checks = jsonObject(row.checks_json) ?? {};
  const blockers = integer(row, "replay_blocking_findings") ?? 0;
  const runUrl = safeHttpsUrl(row.replay_run_url);
  const weights: Array<[string, number]> = [
    ["purchase_journey_passes", 4],
    ["stop_journey_passes", 2],
    ["validation_passes", 2],
    ["survey_submission_passes", 2],
    ["assignment_persistence_passes", 1],
    ["mocked_terac_redirect_passes", 1],
  ];
  const completed = weights.reduce(
    (total, [key, weight]) => total + (checks[key] === true ? weight : 0),
    0,
  );
  const passed = Boolean(runUrl) && blockers === 0 && completed === 12;
  const running = jobStatus === "qa_replay" && Boolean(runUrl) && !passed;
  return {
    status: passed ? "passed" : running ? "checking" : "failed",
    completed_checks: completed,
    total_checks: 12,
    blocking_findings: blockers,
    ...(runUrl ? { run_url: runUrl } : {}),
    ...(isoDate(row.checked_at) ? { last_activity_at: isoDate(row.checked_at) } : {}),
  };
}

function artifact(
  kind: DashboardArtifact["kind"],
  label: string,
  rawPath: unknown,
  jobId: string,
  createdAt: string,
): DashboardArtifact | null {
  const objectPath = safeObjectPath(rawPath, jobId);
  return objectPath
    ? { kind, label, object_path: objectPath, created_at: createdAt }
    : null;
}

function collectArtifacts(
  jobId: string,
  updatedAt: string,
  captures: readonly unknown[],
  variants: readonly unknown[],
  reports: readonly unknown[],
  agentRuns: readonly unknown[],
): DashboardArtifact[] {
  const output: DashboardArtifact[] = [];
  const add = (value: DashboardArtifact | null) => {
    if (value && !output.some((item) => item.object_path === value.object_path)) {
      output.push(value);
    }
  };

  for (const value of captures) {
    const row = asRow(value);
    if (!row) continue;
    const createdAt = isoDate(row.captured_at, updatedAt) ?? updatedAt;
    add(artifact("capture", "Desktop capture", row.desktop_screenshot_path, jobId, createdAt));
    add(artifact("capture", "Mobile capture", row.mobile_screenshot_path, jobId, createdAt));
  }

  for (const value of variants) {
    const row = asRow(value);
    if (!row) continue;
    const label = text(row, "label")?.toUpperCase();
    const kind = label === "A" ? "variant_a" : label === "B" ? "variant_b" : null;
    if (kind) add(artifact(kind, `Variant ${label}`, row.screenshot_path ?? row.preview_path, jobId, updatedAt));
  }

  for (const value of reports) {
    const row = asRow(value);
    if (row) add(artifact("report", "Final report", row.report_path, jobId, updatedAt));
  }

  for (const value of agentRuns) {
    const row = asRow(value);
    if (!row) continue;
    const stage = text(row, "stage");
    const kind = stage === "capture" ? "spec" : stage === "study" ? "metrics" : null;
    if (!kind) continue;
    const createdAt = isoDate(row.completed_at, updatedAt) ?? updatedAt;
    add(artifact(kind, kind === "spec" ? "Paywall spec" : "Study metrics", row.output_artifact_path, jobId, createdAt));
  }

  return output;
}

function studyAggregate(
  studies: readonly unknown[],
  sessions: readonly unknown[],
  variants: readonly unknown[],
): CanonicalRunRecords["study"] {
  const latestStudy = asRow(studies[0]);
  const target = latestStudy ? integer(latestStudy, "target_sample_size") ?? 0 : 0;
  const variantLabels = new Map<string, "A" | "B">();
  for (const value of variants) {
    const row = asRow(value);
    const id = row ? text(row, "id") : undefined;
    const label = row ? text(row, "label")?.toUpperCase() : undefined;
    if (id && (label === "A" || label === "B")) variantLabels.set(id, label);
  }

  let valid = 0;
  let aValid = 0;
  let bValid = 0;
  let flagged = 0;
  let rejected = 0;
  let technicalFailures = 0;
  for (const value of sessions) {
    const row = asRow(value);
    if (!row) continue;
    const quality = text(row, "quality_status")?.toLowerCase();
    if (quality === "valid" || quality === "accepted") {
      valid += 1;
      const label = variantLabels.get(text(row, "assigned_variant_id") ?? "");
      if (label === "A") aValid += 1;
      if (label === "B") bValid += 1;
    } else if (quality === "flagged") {
      flagged += 1;
    } else if (["rejected", "invalid", "duplicate"].includes(quality ?? "")) {
      rejected += 1;
    } else if (quality === "technical_failure") {
      technicalFailures += 1;
    }
  }

  return {
    target,
    valid,
    a_valid: aValid,
    b_valid: bValid,
    flagged,
    rejected,
    technical_failures: technicalFailures,
  };
}

function failedStage(
  status: JobStatus,
  agentRuns: readonly unknown[],
  transitions: readonly unknown[],
): DashboardStageId | undefined {
  if (status !== "failed") return undefined;
  const rows = [...agentRuns, ...transitions].reverse();
  for (const value of rows) {
    const row = asRow(value);
    const stage = row ? dashboardStageIdSchema.safeParse(row.stage) : null;
    if (stage?.success) return stage.data;
  }
  return "intake";
}

function buildCanonicalRecords(
  jobRow: UnknownRow,
  related: {
    transitions: readonly unknown[];
    agentRuns: readonly unknown[];
    studies: readonly unknown[];
    sessions: readonly unknown[];
    variants: readonly unknown[];
    reports: readonly unknown[];
    captures: readonly unknown[];
    workSurfaces: readonly unknown[];
    qualityGates: readonly unknown[];
  },
): CanonicalRunRecords {
  const id = text(jobRow, "id");
  const websiteUrl = safeWebsiteUrl(jobRow.submitted_url ?? jobRow.normalized_url);
  const status = jobStatus(jobRow);
  const updatedAt = isoDate(jobRow.updated_at);
  if (!id || !websiteUrl || !status || !updatedAt) {
    throw new Error("Canonical job cannot be projected");
  }

  const agentState = liveSurfaces(related.agentRuns);
  const surfaces = persistedSurfaces(related.workSurfaces);
  const failureCode = text(jobRow, "failure_code");
  const failureStage =
    status === "failed" && failureCode?.startsWith("REPLAY_")
      ? "replay"
      : failedStage(status, related.agentRuns, related.transitions);
  return {
    job: {
      id,
      founder_label: founderLabel(websiteUrl, id),
      website_url: websiteUrl,
      status,
      source: "live",
      failed_stage: failureStage,
      blocker_code:
        status === "needs_scout"
          ? "SCOUT_REQUIRED"
          : status === "failed" && failureStage === "replay"
            ? "REPLAY_BLOCKED"
            : undefined,
      next_action_code:
        status === "needs_scout"
          ? "POST_SCOUT_TASK"
          : status === "failed" && failureStage === "replay"
            ? "FIX_REPLAY_FINDING"
            : status === "testing"
              ? "WAIT_FOR_STUDY"
              : undefined,
      updated_at: updatedAt,
    },
    payments: paymentSucceeded(jobRow)
      ? [{ status: "succeeded", amount_cents: 2000, currency: "USD" }]
      : [],
    stage_progress: stageProgress(related.agentRuns),
    sandboxes: surfaces.length > 0 ? surfaces : agentState.sandboxes,
    study: studyAggregate(related.studies, related.sessions, related.variants),
    replay: persistedReplay(related.qualityGates, agentState.replay, status),
    artifacts: collectArtifacts(
      id,
      updatedAt,
      related.captures,
      related.variants,
      related.reports,
      related.agentRuns,
    ),
    transitions: [],
  };
}

function eventStatus(
  toStatusValue: unknown,
  stage: DashboardStageId,
): DashboardStageStatus {
  const parsed = jobStatusSchema.safeParse(toStatusValue);
  if (!parsed.success) return "running";
  if (parsed.data === "failed") return "failed";
  if (parsed.data === "needs_scout") return "blocked";
  if (parsed.data === "delivered") return "complete";

  const currentStage: Record<Exclude<JobStatus, "failed">, DashboardStageId> = {
    awaiting_confirmation: "intake",
    awaiting_payment: "payment",
    paid: "capture",
    capturing: "capture",
    needs_scout: "capture",
    spec_ready: "capture",
    building_variants: "variants",
    quality_check: "replay",
    qa_replay: "replay",
    awaiting_approvals: "approvals",
    pilot: "pilot",
    recruiting: "study",
    testing: "study",
    analyzing: "study",
    replay_qa: "replay",
    report_ready: "report",
    delivered: "delivery",
  };
  const order: DashboardStageId[] = ["intake", "payment", "capture", "variants", "replay", "approvals", "pilot", "study", "report", "delivery"];
  return order.indexOf(stage) < order.indexOf(currentStage[parsed.data])
    ? "complete"
    : "running";
}

function safeSummary(row: UnknownRow): string {
  const reason = text(row, "reason_code") ?? "";
  const fromReason = SUMMARY_BY_REASON[reason];
  if (fromReason) return fromReason;
  const supplied = text(row, "safe_summary");
  return supplied && SAFE_EVENT_SUMMARIES.has(supplied)
    ? supplied
    : "Run status changed";
}

function transitionEvents(jobId: string, rows: readonly unknown[]): DashboardRunEvent[] {
  const events: DashboardRunEvent[] = [];
  for (const value of rows) {
    const row = asRow(value);
    if (!row) continue;
    const stage = dashboardStageIdSchema.safeParse(row.stage);
    const actor = dashboardActorSchema.safeParse(row.actor);
    const occurredAt = isoDate(row.occurred_at);
    if (!stage.success || !actor.success || !occurredAt) continue;
    const parsed = dashboardRunEventSchema.safeParse({
      event_id: row.id,
      job_id: jobId,
      stage: stage.data,
      status: eventStatus(row.to_status, stage.data),
      actor: actor.data,
      summary: safeSummary(row),
      occurred_at: occurredAt,
    });
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

function agentRunEvents(jobId: string, rows: readonly unknown[]): DashboardRunEvent[] {
  const events: DashboardRunEvent[] = [];
  for (const value of rows) {
    const row = asRow(value);
    if (!row) continue;
    const stage = dashboardStageIdSchema.safeParse(row.stage);
    const status = mapAgentStatus(row.status);
    const occurredAt = isoDate(row.completed_at ?? row.started_at);
    if (!stage.success || !status || !occurredAt) continue;
    const parsed = dashboardRunEventSchema.safeParse({
      event_id: row.id,
      job_id: jobId,
      stage: stage.data,
      status,
      actor: STAGE_ACTORS[stage.data],
      summary: `${STAGE_ACTORS[stage.data][0]?.toUpperCase()}${STAGE_ACTORS[stage.data].slice(1)} status updated`,
      occurred_at: occurredAt,
    });
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

export class SupabaseDashboardRepository implements DashboardRepository {
  constructor(private readonly transport: DashboardTableTransport) {}

  async listRuns(): Promise<DashboardRunListItem[]> {
    const rows = await this.transport.select("jobs", {
      select: "id,submitted_url,normalized_url,status,payment_status,failure_code,updated_at",
      order: "updated_at.desc",
      limit: "100",
    });
    const runs: DashboardRunListItem[] = [];
    for (const value of rows) {
      const row = asRow(value);
      if (!row) continue;
      try {
        const snapshot = deriveDashboardRunSnapshot(
          buildCanonicalRecords(row, {
            transitions: [],
            agentRuns: [],
            studies: [],
            sessions: [],
            variants: [],
            reports: [],
            captures: [],
            workSurfaces: [],
            qualityGates: [],
          }),
        );
        runs.push({
          job_id: snapshot.job_id,
          founder_label: snapshot.founder_label,
          website_url: snapshot.website_url,
          job_status: snapshot.job_status,
          source: snapshot.source,
          paid: snapshot.paid,
          current_stage: snapshot.current_stage,
          updated_at: snapshot.updated_at,
        });
      } catch {
        // One malformed row must not expose raw data or hide healthy runs.
      }
    }
    const activeStatuses = new Set([
      "paid",
      "capturing",
      "spec_ready",
      "building_variants",
      "quality_check",
      "qa_replay",
      "awaiting_approvals",
      "pilot",
      "recruiting",
      "testing",
      "analyzing",
      "replay_qa",
    ]);
    return runs
      .filter((run) => run.paid && activeStatuses.has(run.job_status))
      .slice(0, 4);
  }

  async getRun(jobId: string): Promise<DashboardRunSnapshot | null> {
    const [jobs, transitions, agentRuns, studies, variants, reports, captures, workSurfaces, qualityGates] =
      await Promise.all([
        this.transport.select("jobs", {
          select: "id,submitted_url,normalized_url,status,payment_status,failure_code,created_at,updated_at",
          id: `eq.${jobId}`,
          limit: "1",
        }),
        this.transport.select("job_transitions", {
          select: "id,job_id,to_status,stage,actor,reason_code,safe_summary,occurred_at",
          job_id: `eq.${jobId}`,
          order: "occurred_at.asc",
        }),
        this.transport.select("agent_runs", {
          select: "id,job_id,stage,status,error_code,safe_progress_json,output_artifact_path,started_at,completed_at",
          job_id: `eq.${jobId}`,
          order: "started_at.asc",
        }),
        this.transport.select("studies", {
          select: "id,job_id,target_sample_size,status,started_at,completed_at",
          job_id: `eq.${jobId}`,
          order: "started_at.desc",
        }),
        this.transport.select("variants", {
          select: "id,job_id,label,screenshot_path,preview_path,quality_status",
          job_id: `eq.${jobId}`,
        }),
        this.transport.select("reports", {
          select: "id,job_id,result,report_path,expires_at",
          job_id: `eq.${jobId}`,
        }),
        this.transport.select("website_captures", {
          select: "id,job_id,desktop_screenshot_path,mobile_screenshot_path,captured_at",
          job_id: `eq.${jobId}`,
          order: "captured_at.desc",
        }),
        this.transport.select("variant_work_surfaces", {
          select: "id,job_id,variant_label,superserve_sandbox_id,preview_access,latest_preview_path,status,created_at,updated_at",
          job_id: `eq.${jobId}`,
          order: "updated_at.asc",
        }),
        this.transport.select("quality_gate_runs", {
          select: "id,job_id,checks_json,replay_run_url,replay_blocking_findings,gate_open,checked_at",
          job_id: `eq.${jobId}`,
          order: "checked_at.desc",
          limit: "1",
        }),
      ]);

    const job = asRow(jobs[0]);
    if (!job) return null;
    const studyIds = studies
      .map(asRow)
      .map((row) => (row ? text(row, "id") : undefined))
      .filter((id): id is string => Boolean(id));
    const sessions = studyIds.length
      ? await this.transport.select("participant_sessions", {
          select: "id,study_id,assigned_variant_id,quality_status,started_at,completed_at",
          study_id: `in.(${studyIds.join(",")})`,
        })
      : [];

    return dashboardRunSnapshotSchema.parse(
      deriveDashboardRunSnapshot(
        buildCanonicalRecords(job, {
          transitions,
          agentRuns,
          studies,
          sessions,
          variants,
          reports,
          captures,
          workSurfaces,
          qualityGates,
        }),
      ),
    );
  }

  async listEvents(jobId: string): Promise<DashboardRunEvent[] | null> {
    const [jobs, transitions, agentRuns] = await Promise.all([
      this.transport.select("jobs", { select: "id", id: `eq.${jobId}`, limit: "1" }),
      this.transport.select("job_transitions", {
        select: "id,job_id,to_status,stage,actor,reason_code,safe_summary,occurred_at",
        job_id: `eq.${jobId}`,
        order: "occurred_at.asc",
      }),
      this.transport.select("agent_runs", {
        select: "id,job_id,stage,status,started_at,completed_at",
        job_id: `eq.${jobId}`,
        order: "started_at.asc",
      }),
    ]);
    if (!jobs[0]) return null;

    const deduplicated = new Map<string, DashboardRunEvent>();
    for (const event of [
      ...transitionEvents(jobId, transitions),
      ...agentRunEvents(jobId, agentRuns),
    ]) {
      deduplicated.set(event.event_id, event);
    }
    return [...deduplicated.values()].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at),
    );
  }
}
