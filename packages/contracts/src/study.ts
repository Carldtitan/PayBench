import { z } from "zod";

export const PAYBENCH_CONTRACT_VERSION = "2" as const;
export const STUDY_TARGET = 10 as const;
export const STUDY_PER_VARIANT = 5 as const;
export const STUDY_REWARD_CENTS = 500 as const;
export const STUDY_PRE_FEE_BUDGET_CENTS = 5_000 as const;
export const STUDY_DURATION_MINUTES = 10 as const;
export const PILOT_PARTICIPANTS = 2 as const;
export const MAIN_PARTICIPANTS = 8 as const;

export const studyConstantsSchema = z
  .object({
    contract_version: z.literal(PAYBENCH_CONTRACT_VERSION),
    participant_target: z.literal(STUDY_TARGET),
    participants_per_variant: z.literal(STUDY_PER_VARIANT),
    approved_reward_cents: z.literal(STUDY_REWARD_CENTS),
    participant_budget_before_fees_cents: z.literal(STUDY_PRE_FEE_BUDGET_CENTS),
    estimated_minutes: z.literal(STUDY_DURATION_MINUTES),
    evidence_standard: z.literal("directional_not_statistically_significant"),
  })
  .strict();

export const targetCustomerSpecSchema = z
  .object({
    description: z.string().trim().min(20).max(500),
    must_match: z.array(z.string().trim().min(3).max(120)).min(1).max(8),
    must_not_match: z.array(z.string().trim().min(3).max(120)).max(8).default([]),
  })
  .strict();

export const teracScreeningRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{3,40}$/),
    question: z.string().trim().min(8).max(240),
    accepted_answers: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
    rejection_message: z.string().trim().min(8).max(160),
  })
  .strict();

export const teracScreeningSpecSchema = z
  .object({
    audience_mode: z.literal("screened_target_customer"),
    target_customer: targetCustomerSpecSchema,
    rules: z.array(teracScreeningRuleSchema).min(1).max(8),
    operator_approved: z.literal(true),
  })
  .strict();

const lockedTextSchema = z.string().trim().min(1).max(2_000);

/**
 * Commercial facts for one source plan. These values are copied from the
 * captured page and are part of the immutable fact bundle shared by A and B.
 */
export const lockedPlanSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),
    name: lockedTextSchema,
    price_display: lockedTextSchema,
    billing_terms: z.array(lockedTextSchema).max(8),
    product_details: z.array(lockedTextSchema).max(16),
    claims: z.array(lockedTextSchema).max(12),
  })
  .strict();

export const lockedFactsSchema = z
  .object({
    product_name: lockedTextSchema,
    product_details: z.array(lockedTextSchema).min(1).max(20),
    price_display: lockedTextSchema,
    billing_terms: z.array(lockedTextSchema).min(1).max(12),
    legal_text: z.array(lockedTextSchema).min(1).max(20),
    claims: z.array(lockedTextSchema).max(30),
    trial_terms: z.array(lockedTextSchema).max(10),
    guarantee_terms: z.array(lockedTextSchema).max(10),
    // Optional keeps contract-v2 records created before multi-plan capture
    // readable. New engine output always includes this field.
    source_plans: z.array(lockedPlanSchema).min(1).max(8).optional(),
  })
  .strict();

export const paywallComponentTypeSchema = z.enum([
  "PaywallShell",
  "BrandHeader",
  "OfferSummary",
  "PlanSelector",
  "BenefitList",
  "TrustPanel",
  "CheckoutForm",
  "OrderSummary",
  "PrimaryAction",
  "LegalFooter",
  "SimulationNotice",
]);

const safePropValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string().max(2_000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(safePropValueSchema).max(30),
    z.record(z.string().max(60), safePropValueSchema),
  ]),
);

const forbiddenMarkup = /<\/?(?:script|style|iframe|object|embed|form|input)|javascript:|"on[a-z]+"\s*:|dangerouslySetInnerHTML|srcdoc/i;

export const paywallNodeSchema: z.ZodType<{
  id: string;
  type: z.infer<typeof paywallComponentTypeSchema>;
  props: Record<string, unknown>;
  children: Array<z.infer<typeof paywallNodeSchema>>;
}> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
      type: paywallComponentTypeSchema,
      props: z.record(z.string().max(60), safePropValueSchema),
      children: z.array(paywallNodeSchema).max(30),
    })
    .strict()
    .superRefine((node, context) => {
      const serialized = JSON.stringify(node.props);
      if (forbiddenMarkup.test(serialized)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Markup, scripts, handlers, and embedded forms are forbidden" });
      }
    }),
);

export const brandSpecSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    logo_url: z.string().url().optional(),
    primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surface_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    font_family: z.string().trim().min(1).max(120),
  })
  .strict();

export const paywallSpecSchema = z
  .object({
    contract_version: z.literal(PAYBENCH_CONTRACT_VERSION),
    source_url: z.string().url(),
    brand: brandSpecSchema,
    locked_facts: lockedFactsSchema,
    tree: paywallNodeSchema,
    source_hash: z.string().regex(/^[a-f0-9]{64}$/),
    locked_facts_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((spec, context) => {
    if (spec.tree.type !== "PaywallShell") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "The root component must be PaywallShell", path: ["tree", "type"] });
    }

    const ids = new Set<string>();
    const visit = (node: z.infer<typeof paywallNodeSchema>) => {
      if (ids.has(node.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate component id: ${node.id}`, path: ["tree"] });
      }
      ids.add(node.id);
      node.children.forEach(visit);
    };
    visit(spec.tree);
  });

export const changeOperationSchema = z
  .object({
    kind: z.enum(["replace_headline", "replace_primary_action_label", "reorder_benefits", "set_default_plan", "change_trust_emphasis"]),
    target_component_id: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
    value: z.union([z.string().trim().min(1).max(240), z.array(z.string().trim().min(1).max(240)).min(1).max(12)]),
  })
  .strict();

export const changePlanSchema = z
  .object({
    contract_version: z.literal(PAYBENCH_CONTRACT_VERSION),
    hypothesis: z.string().trim().min(12).max(300),
    operation: changeOperationSchema,
    source_spec_hash: z.string().regex(/^[a-f0-9]{64}$/),
    locked_facts_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const qualityGateChecksSchema = z
  .object({
    control_matches_source: z.boolean(),
    challenger_has_exactly_one_change: z.boolean(),
    locked_facts_match: z.boolean(),
    desktop_passes: z.boolean(),
    mobile_passes: z.boolean(),
    purchase_journey_passes: z.boolean(),
    stop_journey_passes: z.boolean(),
    validation_passes: z.boolean(),
    survey_submission_passes: z.boolean(),
    assignment_persistence_passes: z.boolean(),
    mocked_terac_redirect_passes: z.boolean(),
    replay_run_present: z.boolean(),
    replay_blocking_findings: z.literal(0),
    pages_approved: z.boolean(),
    quote_approved: z.boolean(),
    founder_payment_confirmed: z.boolean(),
    terac_credit_funding_confirmed: z.boolean(),
  })
  .strict();

export const prelaunchGateSchema = z
  .object({
    checks: qualityGateChecksSchema,
    artifact_bundle_hash: z.string().regex(/^[a-f0-9]{64}$/),
    open: z.boolean(),
    checked_at: z.string().datetime(),
  })
  .strict()
  .superRefine((gate, context) => {
    const allPassed = Object.values(gate.checks).every((value) => value === true || value === 0);
    if (gate.open !== allPassed) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Gate state must equal the complete check result", path: ["open"] });
    }
  });

export const operatorApprovalSchema = z
  .object({
    kind: z.enum(["pages", "terac_quote"]),
    artifact_bundle_hash: z.string().regex(/^[a-f0-9]{64}$/),
    approved_by: z.string().uuid(),
    approved_at: z.string().datetime(),
  })
  .strict();

export const studyPhaseSchema = z.enum(["locked", "pilot", "main", "complete"]);

export const studyDraftRequestSchema = z
  .object({
    contract_version: z.literal(PAYBENCH_CONTRACT_VERSION),
    job_id: z.string().uuid(),
    study_token_hash: z.string().regex(/^[a-f0-9]{64}$/),
    target_customer: targetCustomerSpecSchema,
    screening: teracScreeningSpecSchema,
    participant_target: z.literal(STUDY_TARGET),
    a_slots: z.literal(STUDY_PER_VARIANT),
    b_slots: z.literal(STUDY_PER_VARIANT),
    pilot_slots: z.literal(PILOT_PARTICIPANTS),
    main_slots: z.literal(MAIN_PARTICIPANTS),
    approved_reward_cents: z.literal(STUDY_REWARD_CENTS),
    participant_budget_before_fees_cents: z.literal(STUDY_PRE_FEE_BUDGET_CENTS),
    estimated_minutes: z.literal(STUDY_DURATION_MINUTES),
    assignment_mode: z.literal("pre_shuffled_persisted"),
    terac_mode: z.literal("mock"),
    live_transport_disabled: z.literal(true),
  })
  .strict();

export const directionalResultSchema = z.enum([
  "a_stronger_signal",
  "b_stronger_signal",
  "no_clear_signal",
  "insufficient_evidence",
]);

export const directionalReportSchema = z
  .object({
    contract_version: z.literal(PAYBENCH_CONTRACT_VERSION),
    job_id: z.string().uuid(),
    result: directionalResultSchema,
    valid_sessions: z.number().int().min(0).max(STUDY_TARGET),
    a_valid: z.number().int().min(0).max(STUDY_PER_VARIANT),
    b_valid: z.number().int().min(0).max(STUDY_PER_VARIANT),
    technical_failures: z.number().int().nonnegative(),
    recommendation: z.string().trim().min(12).max(1_000),
    limitation: z.literal("Directional evidence only; this 10-person study is not statistically significant."),
  })
  .strict();

export const workflowStageV2Schema = z.enum([
  "intake",
  "payment",
  "capture",
  "variants",
  "qa",
  "approvals",
  "pilot",
  "study",
  "report",
  "delivery",
]);

export const dashboardFundingV2Schema = z
  .object({
    founder_fee_cents: z.literal(2_000),
    founder_payment_confirmed: z.boolean(),
    participant_count: z.literal(STUDY_TARGET),
    approved_reward_cents: z.literal(STUDY_REWARD_CENTS),
    participant_subtotal_cents: z.literal(STUDY_PRE_FEE_BUDGET_CENTS),
    terac_platform_fee_cents: z.number().int().nonnegative(),
    quote_approved: z.boolean(),
    sponsor_credits_confirmed: z.boolean(),
  })
  .strict();

export const dashboardStudyV2Schema = z
  .object({
    phase: studyPhaseSchema,
    pilot_completed: z.number().int().min(0).max(PILOT_PARTICIPANTS),
    pilot_target: z.literal(PILOT_PARTICIPANTS),
    main_completed: z.number().int().min(0).max(MAIN_PARTICIPANTS),
    main_target: z.literal(MAIN_PARTICIPANTS),
    total_completed: z.number().int().min(0).max(STUDY_TARGET),
    total_target: z.literal(STUDY_TARGET),
    a_completed: z.number().int().min(0).max(STUDY_PER_VARIANT),
    b_completed: z.number().int().min(0).max(STUDY_PER_VARIANT),
    a_target: z.literal(STUDY_PER_VARIANT),
    b_target: z.literal(STUDY_PER_VARIANT),
  })
  .strict()
  .superRefine((study, context) => {
    if (study.total_completed !== study.pilot_completed + study.main_completed) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Total must equal pilot plus main", path: ["total_completed"] });
    }
    if (study.total_completed !== study.a_completed + study.b_completed) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Total must equal A plus B", path: ["total_completed"] });
    }
  });

export const dashboardRunSnapshotV2Schema = z
  .object({
    contract_version: z.literal(PAYBENCH_CONTRACT_VERSION),
    job_id: z.string().uuid(),
    website_url: z.string().url(),
    target_customer: targetCustomerSpecSchema,
    current_stage: workflowStageV2Schema,
    funding: dashboardFundingV2Schema,
    gate: prelaunchGateSchema,
    study: dashboardStudyV2Schema,
    terac_mode: z.literal("mock"),
    terac_actions: z.tuple([z.literal("copy_brief"), z.literal("copy_study_link")]),
    updated_at: z.string().datetime(),
  })
  .strict();

export type TargetCustomerSpec = z.infer<typeof targetCustomerSpecSchema>;
export type TeracScreeningSpec = z.infer<typeof teracScreeningSpecSchema>;
export type LockedFacts = z.infer<typeof lockedFactsSchema>;
export type LockedPlan = z.infer<typeof lockedPlanSchema>;
export type PaywallNode = z.infer<typeof paywallNodeSchema>;
export type PaywallSpec = z.infer<typeof paywallSpecSchema>;
export type ChangePlan = z.infer<typeof changePlanSchema>;
export type PrelaunchGate = z.infer<typeof prelaunchGateSchema>;
export type OperatorApproval = z.infer<typeof operatorApprovalSchema>;
export type StudyDraftRequest = z.infer<typeof studyDraftRequestSchema>;
export type DirectionalReport = z.infer<typeof directionalReportSchema>;
export type WorkflowStageV2 = z.infer<typeof workflowStageV2Schema>;
export type DashboardRunSnapshotV2 = z.infer<typeof dashboardRunSnapshotV2Schema>;
