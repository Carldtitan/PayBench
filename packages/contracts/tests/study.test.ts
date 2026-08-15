import { describe, expect, it } from "vitest";
import {
  directionalReportSchema,
  paywallSpecSchema,
  prelaunchGateSchema,
  studyConstantsSchema,
  studyDraftRequestSchema,
} from "../src";

const hash = "a".repeat(64);
const targetCustomer = {
  description: "US startup founders currently evaluating paid analytics software.",
  must_match: ["Works at a startup", "Evaluates software purchases"],
  must_not_match: ["Works for the company shown"],
};

describe("PayBench contract v2", () => {
  it("accepts only the frozen study economics", () => {
    const valid = studyConstantsSchema.parse({
      contract_version: "2",
      participant_target: 10,
      participants_per_variant: 5,
      approved_reward_cents: 500,
      participant_budget_before_fees_cents: 5000,
      estimated_minutes: 10,
      evidence_standard: "directional_not_statistically_significant",
    });

    expect(valid.participant_target).toBe(10);
    expect(() => studyConstantsSchema.parse({ ...valid, participant_target: 20 })).toThrow();
    expect(() => studyConstantsSchema.parse({ ...valid, approved_reward_cents: 400 })).toThrow();
  });

  it("forbids a general-population or live Terac draft", () => {
    const draft = {
      contract_version: "2",
      job_id: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
      study_token_hash: hash,
      target_customer: targetCustomer,
      screening: {
        audience_mode: "screened_target_customer",
        target_customer: targetCustomer,
        rules: [{
          id: "buyer_role",
          question: "Do you help evaluate software purchases at a startup?",
          accepted_answers: ["Yes"],
          rejection_message: "This task requires current software evaluators.",
        }],
        operator_approved: true,
      },
      participant_target: 10,
      a_slots: 5,
      b_slots: 5,
      pilot_slots: 2,
      main_slots: 8,
      approved_reward_cents: 500,
      participant_budget_before_fees_cents: 5000,
      estimated_minutes: 10,
      assignment_mode: "pre_shuffled_persisted",
      terac_mode: "mock",
      live_transport_disabled: true,
    };

    expect(studyDraftRequestSchema.safeParse(draft).success).toBe(true);
    expect(studyDraftRequestSchema.safeParse({ ...draft, terac_mode: "live" }).success).toBe(false);
    expect(studyDraftRequestSchema.safeParse({
      ...draft,
      screening: { ...draft.screening, audience_mode: "general_population" },
    }).success).toBe(false);
  });

  it("opens the hard gate only when every check passes", () => {
    const checks = {
      control_matches_source: true,
      challenger_has_exactly_one_change: true,
      locked_facts_match: true,
      desktop_passes: true,
      mobile_passes: true,
      purchase_journey_passes: true,
      stop_journey_passes: true,
      validation_passes: true,
      survey_submission_passes: true,
      assignment_persistence_passes: true,
      mocked_terac_redirect_passes: true,
      replay_run_present: true,
      replay_blocking_findings: 0,
      pages_approved: true,
      quote_approved: true,
      founder_payment_confirmed: true,
      terac_credit_funding_confirmed: true,
    } as const;

    const base = { checks, artifact_bundle_hash: hash, checked_at: "2026-08-15T20:00:00.000Z" };
    expect(prelaunchGateSchema.safeParse({ ...base, open: true }).success).toBe(true);
    expect(prelaunchGateSchema.safeParse({ ...base, open: false }).success).toBe(false);
    expect(prelaunchGateSchema.safeParse({
      ...base,
      open: true,
      checks: { ...checks, pages_approved: false },
    }).success).toBe(false);
  });

  it("permits directional outcomes only", () => {
    const report = {
      contract_version: "2",
      job_id: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
      result: "b_stronger_signal",
      valid_sessions: 10,
      a_valid: 5,
      b_valid: 5,
      technical_failures: 0,
      recommendation: "Use the challenger wording as the next production hypothesis.",
      limitation: "Directional evidence only; this 10-person study is not statistically significant.",
    };

    expect(directionalReportSchema.safeParse(report).success).toBe(true);
    expect(directionalReportSchema.safeParse({ ...report, result: "b_wins" }).success).toBe(false);
  });

  it("rejects model-authored markup and handlers", () => {
    const base = {
      contract_version: "2",
      source_url: "https://example.com/pricing",
      brand: {
        name: "Acme",
        primary_color: "#112233",
        accent_color: "#334455",
        surface_color: "#ffffff",
        text_color: "#111111",
        font_family: "Inter",
      },
      locked_facts: {
        product_name: "Acme Pro",
        product_details: ["Team plan"],
        price_display: "$20 monthly",
        billing_terms: ["Billed monthly"],
        legal_text: ["Terms apply"],
        claims: [],
        trial_terms: [],
        guarantee_terms: [],
      },
      tree: { id: "paywall_root", type: "PaywallShell", props: {}, children: [] },
      source_hash: hash,
      locked_facts_hash: hash,
    };

    expect(paywallSpecSchema.safeParse(base).success).toBe(true);
    expect(paywallSpecSchema.safeParse({
      ...base,
      tree: { ...base.tree, props: { html: "<script>alert(1)</script>" } },
    }).success).toBe(false);
    expect(paywallSpecSchema.safeParse({
      ...base,
      tree: { ...base.tree, props: { onClick: "steal()" } },
    }).success).toBe(false);
  });
});
