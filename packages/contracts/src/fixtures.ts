import type { StudyDraftRequest, TargetCustomerSpec, TeracScreeningSpec } from "./study";

export const targetCustomerFixture: TargetCustomerSpec = {
  description: "US startup founders who currently evaluate paid software for their team.",
  must_match: ["Works at a startup", "Evaluates or buys software"],
  must_not_match: ["Works for the product shown"],
};

export const screeningFixture: TeracScreeningSpec = {
  audience_mode: "screened_target_customer",
  target_customer: targetCustomerFixture,
  rules: [
    {
      id: "software_buyer",
      question: "Do you currently help evaluate or buy software for a startup?",
      accepted_answers: ["Yes"],
      rejection_message: "This task requires people who currently evaluate startup software.",
    },
  ],
  operator_approved: true,
};

export const studyDraftFixture: StudyDraftRequest = {
  contract_version: "2",
  job_id: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
  study_token_hash: "a".repeat(64),
  target_customer: targetCustomerFixture,
  screening: screeningFixture,
  participant_target: 10,
  a_slots: 5,
  b_slots: 5,
  pilot_slots: 2,
  main_slots: 8,
  approved_reward_cents: 500,
  participant_budget_before_fees_cents: 5_000,
  estimated_minutes: 10,
  assignment_mode: "pre_shuffled_persisted",
  terac_mode: "mock",
  live_transport_disabled: true,
};
