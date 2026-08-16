import {
  dashboardRunEventSchema,
  dashboardRunSnapshotSchema,
  type DashboardActor,
  type DashboardArtifact,
  type DashboardRunEvent,
  type DashboardRunListItem,
  type DashboardRunSnapshot,
  type DashboardStage,
  type DashboardStageId,
  type DashboardStageStatus,
  type JobStatus,
  type ReplayLiveState,
  type SandboxLiveState,
} from "@paybench/contracts";

const STAGE_ORDER: readonly DashboardStageId[] = [
  "intake",
  "payment",
  "capture",
  "variants",
  "replay",
  "approvals",
  "pilot",
  "study",
  "report",
  "delivery",
];

const STAGE_META: Record<
  DashboardStageId,
  { actor: DashboardActor; label: string }
> = {
  intake: { actor: "paybench", label: "Intake" },
  payment: { actor: "stripe", label: "Payment" },
  capture: { actor: "superserve", label: "Capture" },
  variants: { actor: "superserve", label: "Variants" },
  replay: { actor: "replay", label: "Replay" },
  approvals: { actor: "paybench", label: "Approvals" },
  pilot: { actor: "terac", label: "Pilot" },
  study: { actor: "terac", label: "Study" },
  report: { actor: "paybench", label: "Report" },
  delivery: { actor: "linq", label: "Delivery" },
};

const STATUS_STAGE: Record<Exclude<JobStatus, "failed">, DashboardStageId> = {
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

const BLOCKER_LABELS: Record<string, string> = {
  SCOUT_REQUIRED: "Paywall needs a manual capture",
  REPLAY_BLOCKED: "Replay found a blocking checkout issue",
};

const NEXT_ACTIONS: Record<string, string> = {
  WAIT_FOR_STUDY: "Collect the remaining valid sessions",
  POST_SCOUT_TASK: "Send the manual capture task to Terac",
  FIX_REPLAY_FINDING: "Repair the failed journey, then run Replay again",
};

const EVENT_SUMMARIES = {
  intake_received: "Website received",
  payment_confirmed: "Stripe payment confirmed",
  capture_started: "Superserve opened the submitted website",
  capture_blocked: "Automatic paywall capture stopped",
  scout_requested: "Manual capture task prepared",
  variants_ready: "Both paywall variants passed validation",
  study_started: "End-user study started",
  study_progress: "Valid study sessions received",
  replay_started: "Replay QA started",
  replay_failed: "Replay found a blocking checkout issue",
} as const;

type EventSummaryCode = keyof typeof EVENT_SUMMARIES;

export interface CanonicalJobRecord {
  id: string;
  founder_label: string;
  website_url: string;
  status: JobStatus;
  source: "live" | "demo";
  failed_stage?: DashboardStageId;
  blocker_code?: keyof typeof BLOCKER_LABELS;
  next_action_code?: keyof typeof NEXT_ACTIONS;
  updated_at: string;
}

export interface CanonicalPaymentRecord {
  status: "pending" | "succeeded" | "refunded";
  amount_cents: number;
  currency: string;
}

export interface CanonicalStageProgress {
  stage: DashboardStageId;
  status: DashboardStageStatus;
}

export interface CanonicalTransitionRecord {
  event_id: string;
  stage: DashboardStageId;
  status: DashboardStageStatus;
  actor: DashboardActor;
  summary_code: EventSummaryCode;
  occurred_at: string;
}

export interface CanonicalStudyAggregate {
  target: number;
  valid: number;
  a_valid: number;
  b_valid: number;
  flagged: number;
  rejected: number;
  technical_failures: number;
}

export interface CanonicalRunRecords {
  job: CanonicalJobRecord;
  payments: readonly CanonicalPaymentRecord[];
  stage_progress: readonly CanonicalStageProgress[];
  sandboxes: readonly SandboxLiveState[];
  study: CanonicalStudyAggregate;
  replay: ReplayLiveState;
  artifacts: readonly DashboardArtifact[];
  transitions: readonly CanonicalTransitionRecord[];
}

export interface DashboardRepository {
  listRuns(): Promise<DashboardRunListItem[]>;
  getRun(jobId: string): Promise<DashboardRunSnapshot | null>;
  listEvents(jobId: string): Promise<DashboardRunEvent[] | null>;
}

function currentStageFor(job: CanonicalJobRecord): DashboardStageId {
  return job.status === "failed"
    ? (job.failed_stage ?? "intake")
    : STATUS_STAGE[job.status];
}

function defaultStageStatus(
  stage: DashboardStageId,
  currentStage: DashboardStageId,
  job: CanonicalJobRecord,
): DashboardStageStatus {
  const stageIndex = STAGE_ORDER.indexOf(stage);
  const currentIndex = STAGE_ORDER.indexOf(currentStage);

  if (stageIndex < currentIndex) return "complete";
  if (stageIndex > currentIndex) return "waiting";
  if (job.status === "needs_scout") return "blocked";
  if (job.status === "failed") return "failed";
  if (job.status === "delivered") return "complete";
  return "running";
}

function deriveStages(records: CanonicalRunRecords): DashboardStage[] {
  const currentStage = currentStageFor(records.job);

  return STAGE_ORDER.map((id) => {
    const explicit = [...records.stage_progress]
      .reverse()
      .find((progress) => progress.stage === id);
    const stageEvents = records.transitions
      .filter((event) => event.stage === id)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const completedEvent = [...stageEvents]
      .reverse()
      .find((event) => event.status === "complete");

    const stage: DashboardStage = {
      id,
      status:
        explicit?.status ?? defaultStageStatus(id, currentStage, records.job),
      actor: STAGE_META[id].actor,
      label: STAGE_META[id].label,
    };

    if (stageEvents[0]) stage.started_at = stageEvents[0].occurred_at;
    if (completedEvent) stage.completed_at = completedEvent.occurred_at;
    return stage;
  });
}

/**
 * Builds the dashboard read model from workflow-owned records. It never stores a
 * second copy of the job state machine.
 */
export function deriveDashboardRunSnapshot(
  records: CanonicalRunRecords,
): DashboardRunSnapshot {
  const successfulPayments = records.payments.filter(
    (payment) => payment.status === "succeeded",
  );
  const amountPaid = successfulPayments.reduce(
    (total, payment) => total + payment.amount_cents,
    0,
  );
  const currency = successfulPayments[0]?.currency ?? "USD";
  const blockerLabel = records.job.blocker_code
    ? BLOCKER_LABELS[records.job.blocker_code]
    : undefined;

  const snapshot: DashboardRunSnapshot = {
    contract_version: "2",
    job_id: records.job.id,
    founder_label: records.job.founder_label,
    website_url: records.job.website_url,
    job_status: records.job.status,
    source: records.job.source,
    paid: successfulPayments.length > 0,
    amount_paid_cents: amountPaid,
    currency,
    current_stage: currentStageFor(records.job),
    stages: deriveStages(records),
    sandboxes: [...records.sandboxes],
    study: { ...records.study },
    replay: { ...records.replay },
    artifacts: [...records.artifacts],
    updated_at: records.job.updated_at,
  };

  if (records.job.blocker_code && blockerLabel) {
    snapshot.blocker = {
      code: records.job.blocker_code,
      label: blockerLabel,
    };
  }
  if (records.job.next_action_code) {
    snapshot.next_action = NEXT_ACTIONS[records.job.next_action_code];
  }

  return dashboardRunSnapshotSchema.parse(snapshot);
}

export function deriveDashboardRunEvents(
  records: CanonicalRunRecords,
): DashboardRunEvent[] {
  return records.transitions
    .map((transition) =>
      dashboardRunEventSchema.parse({
        event_id: transition.event_id,
        job_id: records.job.id,
        stage: transition.stage,
        status: transition.status,
        actor: transition.actor,
        summary: EVENT_SUMMARIES[transition.summary_code],
        occurred_at: transition.occurred_at,
      }),
    )
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}
