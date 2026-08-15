import {
  prelaunchGateSchema,
  type PrelaunchGate,
} from "@paybench/contracts";

export type WorkflowState =
  | "awaiting_payment"
  | "paid"
  | "capturing"
  | "building_variants"
  | "qa_replay"
  | "awaiting_approvals"
  | "pilot"
  | "study"
  | "analyzing"
  | "report_ready"
  | "delivered"
  | "failed";

const transitions: Record<WorkflowState, readonly WorkflowState[]> = {
  awaiting_payment: ["paid", "failed"],
  paid: ["capturing", "failed"],
  capturing: ["building_variants", "failed"],
  building_variants: ["qa_replay", "failed"],
  qa_replay: ["awaiting_approvals", "failed"],
  awaiting_approvals: ["pilot", "failed"],
  pilot: ["study", "failed"],
  study: ["analyzing", "failed"],
  analyzing: ["report_ready", "failed"],
  report_ready: ["delivered", "failed"],
  delivered: [],
  failed: [],
};

export function assertWorkflowTransition(
  from: WorkflowState,
  to: WorkflowState,
): void {
  if (!transitions[from].includes(to)) {
    throw new Error(`INVALID_WORKFLOW_TRANSITION:${from}:${to}`);
  }
}

export function canOpenPilot(gate: PrelaunchGate): boolean {
  const validated = prelaunchGateSchema.safeParse(gate);
  return validated.success && validated.data.open;
}

export interface PilotJourney {
  variant: "A" | "B";
  quality: "valid" | "technical_failure" | "rejected";
  survey_complete: boolean;
  redirect_complete: boolean;
}

export function canUnlockMain(journeys: PilotJourney[]): boolean {
  const valid = journeys.filter(
    (journey) =>
      journey.quality === "valid" &&
      journey.survey_complete &&
      journey.redirect_complete,
  );

  return (
    valid.length === 2 &&
    valid.filter((journey) => journey.variant === "A").length === 1 &&
    valid.filter((journey) => journey.variant === "B").length === 1
  );
}
