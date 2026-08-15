import type {
  DashboardRunSnapshotV2,
  PrelaunchGate,
  TargetCustomerSpec,
} from "@paybench/contracts";

export interface ParticipantPlan {
  id: string;
  name: string;
  price: string;
  terms: string;
  detail: string;
}

export interface ParticipantSessionView {
  brand_name: string;
  headline: string;
  supporting_copy: string;
  target_customer: string;
  plans: ParticipantPlan[];
  default_plan_id: string;
  preset: {
    name: "Alex Example";
    postal_code: "00000";
    payment_token: "SIMULATION TOKEN";
  };
  resume_decision?: "stop";
}

export interface ParticipantSurvey {
  understood_offer: string;
  understood_price: string;
  hesitation: string;
  clarity: number;
  trust: number;
  would_continue: "yes" | "no";
  continuation_reason: string;
}

export interface ParticipantDecisionInput {
  decision: "complete_simulated_purchase" | "stop";
  selected_plan_id?: string;
  survey: ParticipantSurvey;
}

export interface ParticipantCompletion {
  outcome: "redirect" | "fallback_code";
  redirect_url?: string;
  completion_code?: string;
}

export interface OperatorStudyStatus extends DashboardRunSnapshotV2 {
  founder_label: string;
  artifact_bundle_hash: string;
  brief: string;
  study_url: string;
  pilot_review_required: boolean;
  target_customer: TargetCustomerSpec;
  gate: PrelaunchGate;
}

export type StudyEventName =
  | "page_view"
  | "plan_selected"
  | "checkout_opened"
  | "review_opened"
  | "stop_selected"
  | "simulated_purchase_completed"
  | "survey_submitted";
