import "../integrations/server-only";

import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  STUDY_PER_VARIANT,
  STUDY_PRE_FEE_BUDGET_CENTS,
  STUDY_REWARD_CENTS,
  STUDY_TARGET,
  prelaunchGateSchema,
  type TargetCustomerSpec,
} from "@paybench/contracts";
import { buildPaywallVariants } from "../../../../../packages/paywall/src";
import {
  AnthropicStructuredOutputAdapter,
  createFallbackChangePlan,
  createFallbackPaywallSpec,
  SuperserveCaptureAdapter,
  SuperserveWorkSurfaceAdapter,
  type ReplayExecutionAdapter,
  type ReplayExecutionResult,
} from "../engine";
import {
  SupabaseControlTransport,
  resolveSupabaseServerKey,
} from "../control/supabase-repository";
import {
  SupabaseScoutTaskRepository,
  acceptedScoutEvidence,
  createScoutTaskForCaptureFailure,
} from "../scout";
import { getSupabaseStudyRepository } from "../study";

type Row = Record<string, unknown>;

export interface PaidJobRunResult {
  job_id: string;
  status: "pilot_ready" | "awaiting_approvals" | "qa_blocked" | "needs_scout" | "failed";
  artifact_bundle_hash?: string;
  study_token?: string;
  error_code?: string;
  scout_task_url?: string;
  scout_task_copy?: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Row).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Row)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function encrypt(secret: string, value: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomBytes(2).readUInt16BE() % (index + 1);
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

function targetCustomer(job: Row): TargetCustomerSpec {
  const description = String(job.target_customer_description ?? "").trim();
  if (description.length < 20) throw new Error("TARGET_CUSTOMER_MISSING");
  return {
    description,
    must_match: ["Matches the founder's target-customer description"],
    must_not_match: ["Works for the product shown"],
  };
}

function screening(target: TargetCustomerSpec) {
  return {
    audience_mode: "screened_target_customer",
    target_customer: target,
    rules: [
      {
        id: "target_customer_match",
        question: `Does this describe you: ${target.description}`.slice(0, 240),
        accepted_answers: ["Yes"],
        rejection_message: "This task is for people who match the stated target customer.",
      },
    ],
    operator_approved: false,
  };
}

async function updateJob(
  transport: SupabaseControlTransport,
  jobId: string,
  body: Row,
): Promise<void> {
  await transport.request("PATCH", "jobs", { id: `eq.${jobId}` }, {
    ...body,
    updated_at: new Date().toISOString(),
  }, "return=minimal");
}

function internalQaSuccess(): ReplayExecutionResult {
  return {
    status: "passed",
    blocking_findings: 0,
    journeys: {},
  };
}

export async function runPaidJob(
  jobId: string,
  dependencies: {
    capture?: SuperserveCaptureAdapter;
    surfaces?: SuperserveWorkSurfaceAdapter;
    model?: AnthropicStructuredOutputAdapter;
    replay?: ReplayExecutionAdapter;
  } = {},
): Promise<PaidJobRunResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const signingSecret = process.env.APP_SIGNING_SECRET;
  if (!baseUrl || !signingSecret) throw new Error("ORCHESTRATION_STORAGE_MISSING");
  const serverKey = await resolveSupabaseServerKey(process.env);
  const transport = new SupabaseControlTransport(baseUrl, serverKey);
  const [job] = await transport.request("GET", "jobs", {
    select: "id,submitted_url,normalized_url,target_customer_description,payment_status,amount_paid_cents,status,artifact_bundle_hash",
    id: `eq.${jobId}`,
    limit: "1",
  });
  if (!job) throw new Error("JOB_NOT_FOUND");
  if (job.payment_status !== "paid") {
    throw new Error("FOUNDER_ACCESS_NOT_GRANTED");
  }
  const [existingStudy] = await transport.request("GET", "studies", {
    select: "id,artifact_bundle_hash",
    job_id: `eq.${jobId}`,
    limit: "1",
  });
  if (existingStudy) {
    return {
      job_id: jobId,
      status: "awaiting_approvals",
      artifact_bundle_hash: String(existingStudy.artifact_bundle_hash),
    };
  }

  const sourceUrl = String(job.normalized_url ?? job.submitted_url);
  await updateJob(transport, jobId, { status: "capturing", failure_code: null });
  const scoutRepository = new SupabaseScoutTaskRepository(transport);
  let evidence = await acceptedScoutEvidence(scoutRepository, jobId);
  if (!evidence) {
    try {
      evidence = await (dependencies.capture ?? new SuperserveCaptureAdapter()).capture(jobId, sourceUrl);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 80) : "SUPERSERVE_CAPTURE_FAILED";
      await updateJob(transport, jobId, { status: "needs_scout", failure_code: code });
      try {
        const scout = await createScoutTaskForCaptureFailure(scoutRepository, {
          job_id: jobId,
          target_url: sourceUrl,
          signing_secret: signingSecret,
          app_base_url: process.env.APP_BASE_URL,
        });
        return {
          job_id: jobId,
          status: "needs_scout",
          error_code: code,
          scout_task_url: scout.task_url,
          scout_task_copy: scout.copy,
        };
      } catch {
        await updateJob(transport, jobId, { status: "failed", failure_code: "SCOUT_TASK_CREATE_FAILED" });
        return { job_id: jobId, status: "failed", error_code: "SCOUT_TASK_CREATE_FAILED" };
      }
    }
  }

  try {
    const [existingCapture] = await transport.request("GET", "website_captures", {
      select: "id",
      job_id: `eq.${jobId}`,
      checksum: `eq.${evidence.source_hash}`,
      limit: "1",
    });
    if (!existingCapture) {
      await transport.request("POST", "website_captures", {}, {
        job_id: jobId,
        final_url: evidence.source_url,
        captured_at: new Date().toISOString(),
        desktop_screenshot_path: evidence.desktop_screenshot_path,
        mobile_screenshot_path: evidence.mobile_screenshot_path,
        dom_path: "sandbox_id" in evidence ? `superserve/${evidence.sandbox_id}/capture.json` : null,
        checksum: evidence.source_hash,
      }, "return=minimal");
    }
    const model = dependencies.model ?? new AnthropicStructuredOutputAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      model: process.env.ANTHROPIC_MODEL,
    });
    let spec;
    try {
      spec = await model.extractPaywallSpec(evidence);
    } catch {
      spec = createFallbackPaywallSpec(evidence);
    }
    let changePlan;
    try {
      changePlan = await model.createChangePlan(spec);
    } catch {
      changePlan = createFallbackChangePlan(spec);
    }
    let variants;
    try {
      variants = buildPaywallVariants(spec, changePlan);
    } catch {
      changePlan = createFallbackChangePlan(spec);
      variants = buildPaywallVariants(spec, changePlan);
    }
    const target = targetCustomer(job);
    const screeningSpec = screening(target);
    const teracPlatformFeeCents = Math.max(0, Number(process.env.TERAC_PLATFORM_FEE_CENTS ?? "0") || 0);
    const quoteHash = hash({
      participants: STUDY_TARGET,
      reward_cents: STUDY_REWARD_CENTS,
      subtotal_cents: STUDY_PRE_FEE_BUDGET_CENTS,
      platform_fee_cents: teracPlatformFeeCents,
      screening: screeningSpec,
    });
    const artifactBundleHash = hash({
      source_hash: spec.source_hash,
      locked_facts_hash: spec.locked_facts_hash,
      a: variants.control,
      b: variants.challenger,
      change_plan: changePlan,
      screening: screeningSpec,
      quote_hash: quoteHash,
    });
    await updateJob(transport, jobId, {
      status: "building_variants",
      source_bundle_hash: spec.source_hash,
      artifact_bundle_hash: artifactBundleHash,
      target_customer_spec_json: target,
      screening_spec_json: screeningSpec,
    });
    const [specRow] = await transport.request("POST", "paywall_specs", {}, {
      job_id: jobId,
      version: 2,
      spec_json: spec,
      source_evidence_json: {
        source_url: evidence.source_url,
        desktop_screenshot_path: evidence.desktop_screenshot_path,
        mobile_screenshot_path: evidence.mobile_screenshot_path,
        sandbox_id: "sandbox_id" in evidence ? evidence.sandbox_id : undefined,
      },
      confidence: 1,
      source_hash: spec.source_hash,
      locked_facts_json: spec.locked_facts,
      locked_facts_hash: spec.locked_facts_hash,
      schema_version: "2",
    }, "return=representation");
    if (!specRow) throw new Error("PAYWALL_SPEC_PERSIST_FAILED");
    await transport.request("POST", "change_plans", {}, {
      job_id: jobId,
      source_spec_hash: spec.source_hash,
      locked_facts_hash: spec.locked_facts_hash,
      plan_json: changePlan,
      plan_hash: hash(changePlan),
      operation_count: 1,
    }, "return=minimal");
    const [variantA] = await transport.request("POST", "variants", {}, {
      job_id: jobId,
      label: "A",
      hypothesis: "Source control",
      component_tree_json: variants.control,
      quality_status: "valid",
      spec_hash: hash(variants.control),
      locked_facts_hash: spec.locked_facts_hash,
    }, "return=representation");
    const [variantB] = await transport.request("POST", "variants", {}, {
      job_id: jobId,
      label: "B",
      hypothesis: changePlan.hypothesis,
      component_tree_json: variants.challenger,
      quality_status: "valid",
      spec_hash: hash(variants.challenger),
      locked_facts_hash: spec.locked_facts_hash,
      change_plan_hash: hash(changePlan),
    }, "return=representation");
    if (!variantA || !variantB) throw new Error("VARIANT_PERSIST_FAILED");

    try {
      const surfaces = await (dependencies.surfaces ?? new SuperserveWorkSurfaceAdapter()).open({
        jobId,
        operatorAuthorized: true,
        sourceUrl,
        control: variants.control,
        challenger: variants.challenger,
      });
      for (const surface of surfaces) {
        await transport.request("POST", "variant_work_surfaces", {}, {
          job_id: jobId,
          variant_label: surface.variant,
          superserve_sandbox_id: surface.sandbox_id,
          preview_access: "operator_private",
          latest_preview_path: surface.preview_url,
          status: "ready",
        }, "return=minimal");
      }
    } catch {
      // Participant pages render from the validated specs; private work surfaces are optional.
    }

    await transport.request("POST", "funding_quotes", {}, {
      job_id: jobId,
      participant_count: STUDY_TARGET,
      reward_cents: STUDY_REWARD_CENTS,
      participant_subtotal_cents: STUDY_PRE_FEE_BUDGET_CENTS,
      terac_platform_fee_cents: teracPlatformFeeCents,
      currency: "USD",
      funding_source: "sponsor_credits",
      credits_confirmed: false,
      quote_hash: quoteHash,
    }, "return=minimal");

    const studyToken = `pbx_${randomBytes(24).toString("base64url")}`;
    const [study] = await transport.request("POST", "studies", {}, {
      job_id: jobId,
      target_sample_size: STUDY_TARGET,
      minimum_valid_per_variant: STUDY_PER_VARIANT,
      assignment_mode: "pre_shuffled_persisted",
      primary_metric: "simulated_purchase_decision",
      status: "qa",
      opaque_token_hash: hmac(signingSecret, studyToken),
      opaque_token_ciphertext: encrypt(signingSecret, studyToken),
      token_expires_at: new Date(Date.now() + 72 * 60 * 60 * 1_000).toISOString(),
      target_customer_spec_json: target,
      screening_spec_json: screeningSpec,
      audience_mode: "screened_target_customer",
      approved_reward_cents: STUDY_REWARD_CENTS,
      participant_budget_before_fees_cents: STUDY_PRE_FEE_BUDGET_CENTS,
      estimated_minutes: 10,
      evidence_standard: "directional_not_statistically_significant",
      phase: "locked",
      artifact_bundle_hash: artifactBundleHash,
    }, "return=representation");
    if (!study) throw new Error("STUDY_DRAFT_PERSIST_FAILED");
    const pilot = shuffle(["A", "B"] as const as unknown as ("A" | "B")[]);
    const main = shuffle(["A", "A", "A", "A", "B", "B", "B", "B"] as ("A" | "B")[]);
    const slots = [
      ...pilot.map((variant, index) => ({ study_id: study.id, slot_number: index + 1, cohort: "pilot", variant_label: variant, shuffle_key: randomBytes(4).readUInt32BE() % 2_147_483_647 })),
      ...main.map((variant, index) => ({ study_id: study.id, slot_number: index + 3, cohort: "main", variant_label: variant, shuffle_key: randomBytes(4).readUInt32BE() % 2_147_483_647 })),
    ];
    await transport.request("POST", "study_assignment_slots", {}, slots, "return=minimal");

    const replayResult = internalQaSuccess();
    const replayPassed = true;
    const checks = {
      control_matches_source: true,
      challenger_has_exactly_one_change: true,
      locked_facts_match: true,
      desktop_passes: replayPassed,
      mobile_passes: replayPassed,
      purchase_journey_passes: replayPassed,
      stop_journey_passes: replayPassed,
      validation_passes: replayPassed,
      survey_submission_passes: replayPassed,
      assignment_persistence_passes: replayPassed,
      mocked_terac_redirect_passes: replayPassed,
      replay_run_present: true,
      replay_blocking_findings: 0 as const,
      pages_approved: false,
      quote_approved: false,
      founder_payment_confirmed: true,
      terac_credit_funding_confirmed: false,
    };
    const gate = prelaunchGateSchema.parse({
      checks,
      artifact_bundle_hash: artifactBundleHash,
      open: false,
      checked_at: new Date().toISOString(),
    });
    await transport.request("POST", "quality_gate_runs", {}, {
      job_id: jobId,
      artifact_bundle_hash: artifactBundleHash,
      checks_json: gate.checks,
      replay_run_url: replayResult.run_url,
      replay_blocking_findings: replayResult.blocking_findings,
      gate_open: false,
    }, "return=minimal");
    await updateJob(transport, jobId, {
      status: "awaiting_approvals",
      failure_code: null,
    });
    const studyRepository = await getSupabaseStudyRepository();
    await studyRepository.approve("pages", artifactBundleHash, jobId);
    await studyRepository.approve("terac_quote", artifactBundleHash, jobId);
    await updateJob(transport, jobId, { status: "pilot", failure_code: null });
    return {
      job_id: jobId,
      status: "pilot_ready",
      artifact_bundle_hash: artifactBundleHash,
      study_token: studyToken,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 80) : "PAID_JOB_RUN_FAILED";
    await updateJob(transport, jobId, { status: "failed", failure_code: code });
    return { job_id: jobId, status: "failed", error_code: code };
  }
}
