export type StudyDecision = "complete_simulated_purchase" | "stop_here";

export interface StudySurvey {
  understood_offer: string;
  understood_price_terms: string;
  hesitation: string;
  clarity_score: number;
  trust_score: number;
  would_continue_with_real_money: boolean;
  continuation_reason: string;
}

export interface PaywallInteractionState {
  phase: "offer" | "checkout" | "review" | "survey" | "complete";
  selectedPlanId?: string;
  fakeDetailsConfirmed: boolean;
  decision?: StudyDecision;
  survey?: StudySurvey;
}

export type PaywallInteractionAction =
  | { type: "select_plan"; planId: string }
  | { type: "open_checkout" }
  | { type: "confirm_fake_details"; confirmed: boolean }
  | { type: "open_review" }
  | { type: "complete_simulated_purchase" }
  | { type: "stop_here" }
  | { type: "submit_survey"; survey: StudySurvey };

export class PaywallInteractionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaywallInteractionError";
  }
}

export function createPaywallInteraction(defaultPlanId?: string): PaywallInteractionState {
  return { phase: "offer", selectedPlanId: defaultPlanId, fakeDetailsConfirmed: false };
}

function validateSurvey(survey: StudySurvey): void {
  const requiredText = [
    survey.understood_offer,
    survey.understood_price_terms,
    survey.hesitation,
    survey.continuation_reason,
  ];
  if (requiredText.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new PaywallInteractionError("SURVEY_REQUIRED", "Answer every survey question");
  }
  if (![survey.clarity_score, survey.trust_score].every((score) => Number.isInteger(score) && score >= 1 && score <= 5)) {
    throw new PaywallInteractionError("SURVEY_SCORE_INVALID", "Clarity and trust scores must be from 1 to 5");
  }
}

export function reducePaywallInteraction(
  state: PaywallInteractionState,
  action: PaywallInteractionAction,
): PaywallInteractionState {
  if (state.phase === "complete") {
    throw new PaywallInteractionError("SESSION_COMPLETE", "The simulated checkout is already complete");
  }

  switch (action.type) {
    case "select_plan":
      if (state.phase !== "offer") throw new PaywallInteractionError("PLAN_SELECTION_CLOSED", "Plan selection is closed");
      if (!/^[a-z][a-z0-9_-]{1,39}$/.test(action.planId)) throw new PaywallInteractionError("PLAN_INVALID", "Select a valid plan");
      return { ...state, selectedPlanId: action.planId };
    case "open_checkout":
      if (state.phase !== "offer" || !state.selectedPlanId) throw new PaywallInteractionError("PLAN_REQUIRED", "Select a plan first");
      return { ...state, phase: "checkout" };
    case "confirm_fake_details":
      if (state.phase !== "checkout") throw new PaywallInteractionError("CHECKOUT_NOT_OPEN", "Open the simulated checkout first");
      return { ...state, fakeDetailsConfirmed: action.confirmed };
    case "open_review":
      if (state.phase !== "checkout" || !state.fakeDetailsConfirmed) {
        throw new PaywallInteractionError("FAKE_DETAILS_REQUIRED", "Confirm the supplied fake details before review");
      }
      return { ...state, phase: "review" };
    case "complete_simulated_purchase":
      if (state.phase !== "review") throw new PaywallInteractionError("REVIEW_REQUIRED", "Review the simulated order first");
      return { ...state, phase: "survey", decision: "complete_simulated_purchase" };
    case "stop_here":
      if (state.phase === "survey") throw new PaywallInteractionError("DECISION_RECORDED", "A decision is already recorded");
      return { ...state, phase: "survey", decision: "stop_here" };
    case "submit_survey":
      if (state.phase !== "survey" || !state.decision) throw new PaywallInteractionError("DECISION_REQUIRED", "Choose continue or stop before the survey");
      validateSurvey(action.survey);
      return { ...state, phase: "complete", survey: structuredClone(action.survey) };
  }
}

