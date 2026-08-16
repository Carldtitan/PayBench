import "../integrations/server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  PAYBENCH_CONTRACT_VERSION,
  STUDY_PER_VARIANT,
  STUDY_PRE_FEE_BUDGET_CENTS,
  STUDY_REWARD_CENTS,
  STUDY_TARGET,
  dashboardRunSnapshotV2Schema,
  prelaunchGateSchema,
  type OperatorApproval,
  type PaywallNode,
  type PrelaunchGate,
  type TargetCustomerSpec,
} from "@paybench/contracts";
import {
  SupabaseControlTransport,
  resolveSupabaseServerKey,
} from "../control/supabase-repository";
import { createDirectionalReport } from "../orchestration/directional-report";
import { deliverReportToHealthyLinqChat } from "../control/linq-report";
import type {
  OperatorStudyStatus,
  ParticipantCompletion,
  ParticipantDecisionInput,
  ParticipantPlan,
  ParticipantSessionView,
  StudyEventName,
} from "./types";
import { NEUTRAL_TERAC_BRIEF, StudyError } from "./repository";

type Row = Record<string, unknown>;

const OPERATOR_ID = "00000000-0000-4000-8000-000000000001";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function objectValue(value: unknown): Row | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : undefined;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validSurvey(input: ParticipantDecisionInput): boolean {
  const survey = input.survey;
  return (
    survey.understood_offer.trim().length >= 2 &&
    survey.understood_price.trim().length >= 2 &&
    survey.hesitation.trim().length >= 2 &&
    Number.isInteger(survey.clarity) &&
    survey.clarity >= 1 &&
    survey.clarity <= 5 &&
    Number.isInteger(survey.trust) &&
    survey.trust >= 1 &&
    survey.trust <= 5 &&
    (survey.would_continue === "yes" || survey.would_continue === "no") &&
    survey.continuation_reason.trim().length >= 2
  );
}

function walk(node: PaywallNode, type: PaywallNode["type"]): PaywallNode | undefined {
  if (node.type === type) return node;
  for (const child of node.children) {
    const found = walk(child, type);
    if (found) return found;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function viewFromRows(
  variant: Row,
  job: Row,
  resumeDecision?: "stop",
): ParticipantSessionView {
  const rawTree = objectValue(variant.component_tree_json);
  const tree = objectValue(rawTree?.tree) ?? rawTree;
  const typedTree = tree as unknown as PaywallNode | undefined;
  const offer = typedTree ? walk(typedTree, "OfferSummary") : undefined;
  const selector = typedTree ? walk(typedTree, "PlanSelector") : undefined;
  const brand = typedTree ? walk(typedTree, "BrandHeader") : undefined;
  const planRows = Array.isArray(selector?.props.plans)
    ? selector.props.plans
    : [];
  const plans: ParticipantPlan[] = planRows
    .map(objectValue)
    .filter((plan): plan is Row => Boolean(plan))
    .map((plan, index) => ({
      id: stringValue(plan.id) ?? `plan-${index + 1}`,
      name: stringValue(plan.name) ?? `Plan ${index + 1}`,
      price: stringValue(plan.price_display) ?? stringValue(offer?.props.price_display) ?? "Price shown above",
      terms: stringArray(plan.billing_terms)[0] ?? stringArray(offer?.props.billing_terms)[0] ?? "Terms shown above",
      detail: stringValue(plan.detail) ?? "Select this plan to continue",
    }))
    .slice(0, 6);
  if (plans.length === 0) {
    plans.push({
      id: "source-plan",
      name: stringValue(offer?.props.product_name) ?? "Selected offer",
      price: stringValue(offer?.props.price_display) ?? "Price shown above",
      terms: stringArray(offer?.props.billing_terms)[0] ?? "Terms shown above",
      detail: "Captured from the source page",
    });
  }

  const submittedUrl = stringValue(job.normalized_url) ?? stringValue(job.submitted_url) ?? "https://example.com";
  const hostname = new URL(submittedUrl).hostname.replace(/^www\./, "");
  return {
    brand_name: stringValue(brand?.props.name) ?? hostname.split(".")[0] ?? "PayBench study",
    headline: stringValue(offer?.props.headline) ?? "Choose the option that fits your needs",
    supporting_copy:
      stringArray(offer?.props.supporting_copy).join(" ") ||
      stringArray(offer?.props.description).join(" ") ||
      "Review the offer and decide what you would do.",
    target_customer:
      stringValue(job.target_customer_description) ??
      "People currently evaluating this kind of product.",
    plans,
    default_plan_id:
      stringValue(selector?.props.default_plan_id) ?? plans[0]!.id,
    preset: {
      name: "Alex Example",
      postal_code: "00000",
      payment_token: "SIMULATION TOKEN",
    },
    ...(resumeDecision ? { resume_decision: resumeDecision } : {}),
  };
}

export class SupabaseStudyRepository {
  constructor(
    private readonly transport: SupabaseControlTransport,
    private readonly baseUrl: string,
    private readonly serverKey: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private hmac(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private encrypt(value: string): string {
    const key = createHash("sha256").update(this.secret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }

  private decrypt(value: string): string {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) throw new StudyError("STUDY_TOKEN_INVALID", 503);
    const key = createHash("sha256").update(this.secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private signedCookie(token: string): string {
    return `${token}.${this.hmac(`session:${token}`)}`;
  }

  private cookieToken(cookie?: string): string | undefined {
    if (!cookie) return undefined;
    const separator = cookie.indexOf(".");
    if (separator < 1) return undefined;
    const token = cookie.slice(0, separator);
    return this.safeEqual(cookie.slice(separator + 1), this.hmac(`session:${token}`))
      ? token
      : undefined;
  }

  private async rpc(name: string, body: Row): Promise<Row[]> {
    const response = await this.fetcher(
      `${this.baseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: {
          apikey: this.serverKey,
          Authorization: `Bearer ${this.serverKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      const text = await response.text();
      if (text.includes("STUDY_NOT_AVAILABLE")) throw new StudyError("STUDY_NOT_FOUND", 404);
      if (text.includes("NO_STUDY_SLOTS_AVAILABLE")) throw new StudyError("NO_ASSIGNMENT_AVAILABLE", 409);
      throw new StudyError("STUDY_ASSIGNMENT_FAILED", 503);
    }
    const payload: unknown = await response.json();
    return Array.isArray(payload) ? payload.filter((row): row is Row => Boolean(row) && typeof row === "object") : [];
  }

  private async sessionFromCookie(cookie?: string): Promise<Row | undefined> {
    const token = this.cookieToken(cookie);
    if (!token) return undefined;
    const [session] = await this.transport.request("GET", "participant_sessions", {
      select: "id,study_id,assigned_variant_id,assignment_slot_id,terac_submission_hmac,terac_submission_ciphertext,decision,completed_at,survey_completed_at,is_pilot",
      session_cookie_hash: `eq.${this.hmac(`cookie:${token}`)}`,
      limit: "1",
    });
    return session;
  }

  private async sessionView(session: Row): Promise<ParticipantSessionView> {
    const [study] = await this.transport.request("GET", "studies", {
      select: "id,job_id",
      id: `eq.${String(session.study_id)}`,
      limit: "1",
    });
    if (!study) throw new StudyError("STUDY_NOT_FOUND", 404);
    const [job] = await this.transport.request("GET", "jobs", {
      select: "id,submitted_url,normalized_url,target_customer_description,target_customer_spec_json",
      id: `eq.${String(study.job_id)}`,
      limit: "1",
    });
    const [variant] = await this.transport.request("GET", "variants", {
      select: "id,component_tree_json",
      id: `eq.${String(session.assigned_variant_id)}`,
      limit: "1",
    });
    if (!job || !variant) throw new StudyError("VARIANT_NOT_READY", 423);
    return viewFromRows(variant, job, session.decision === "stop" ? "stop" : undefined);
  }

  async claimSession(input: {
    token: string;
    cookie_value?: string;
    terac_submission_id?: string;
  }): Promise<{ view: ParticipantSessionView; cookie_value: string; reused: boolean }> {
    const existing = await this.sessionFromCookie(input.cookie_value);
    if (existing) {
      return {
        view: await this.sessionView(existing),
        cookie_value: input.cookie_value!,
        reused: true,
      };
    }

    const submissionId = input.terac_submission_id?.trim();
    if (submissionId && submissionId.length > 200) throw new StudyError("TERAC_SUBMISSION_INVALID", 400);
    const cookieToken = randomBytes(24).toString("base64url");
    const [claimed] = await this.rpc("claim_study_slot", {
      requested_study_token_hash: this.hmac(input.token),
      requested_session_cookie_hash: this.hmac(`cookie:${cookieToken}`),
      requested_participant_token_hash: this.hmac(`participant:${randomUUID()}`),
      requested_terac_submission_hmac: submissionId ? this.hmac(`terac:${submissionId}`) : null,
      requested_terac_submission_ciphertext: submissionId ? this.encrypt(submissionId) : null,
    });
    if (!claimed?.participant_session_id) throw new StudyError("STUDY_ASSIGNMENT_FAILED", 503);
    const [session] = await this.transport.request("GET", "participant_sessions", {
      select: "id,study_id,assigned_variant_id,assignment_slot_id,terac_submission_hmac,terac_submission_ciphertext,decision,completed_at,survey_completed_at,is_pilot",
      id: `eq.${String(claimed.participant_session_id)}`,
      limit: "1",
    });
    if (!session) throw new StudyError("STUDY_ASSIGNMENT_FAILED", 503);
    return {
      view: await this.sessionView(session),
      cookie_value: this.signedCookie(cookieToken),
      reused: false,
    };
  }

  async recordEvent(cookie: string | undefined, event: StudyEventName): Promise<void> {
    const session = await this.sessionFromCookie(cookie);
    if (!session) throw new StudyError("SESSION_REQUIRED", 401);
    if (session.completed_at) throw new StudyError("SESSION_COMPLETE", 409);
    const map: Record<StudyEventName, string> = {
      page_view: "page_view",
      plan_selected: "plan_selected",
      checkout_opened: "primary_action_clicked",
      review_opened: "primary_action_clicked",
      stop_selected: "stop_action_clicked",
      simulated_purchase_completed: "simulated_purchase_completed",
      survey_submitted: "survey_submitted",
    };
    const [latest] = await this.transport.request("GET", "behavior_events", {
      select: "sequence_number",
      participant_session_id: `eq.${String(session.id)}`,
      order: "sequence_number.desc",
      limit: "1",
    });
    const sequence = Number(latest?.sequence_number ?? -1) + 1;
    await this.transport.request("POST", "behavior_events", {}, {
      participant_session_id: session.id,
      variant_id: session.assigned_variant_id,
      event_name: map[event],
      event_time: new Date().toISOString(),
      sequence_number: sequence,
      metadata_json: { source: "participant_page" },
    }, "return=minimal");
    if (event === "stop_selected") {
      await this.transport.request("PATCH", "participant_sessions", { id: `eq.${String(session.id)}` }, {
        decision: "stop",
        decision_at: new Date().toISOString(),
      }, "return=minimal");
    }
  }

  async completeDecision(
    cookie: string | undefined,
    input: ParticipantDecisionInput,
  ): Promise<ParticipantCompletion> {
    const session = await this.sessionFromCookie(cookie);
    if (!session) throw new StudyError("SESSION_REQUIRED", 401);
    if (session.completed_at) throw new StudyError("DECISION_ALREADY_RECORDED", 409);
    if (!validSurvey(input)) throw new StudyError("SURVEY_INCOMPLETE", 400);
    if (input.decision === "complete_simulated_purchase" && !input.selected_plan_id) {
      throw new StudyError("PLAN_REQUIRED", 400);
    }
    const now = new Date().toISOString();
    const decision = input.decision === "complete_simulated_purchase" ? "continue" : "stop";
    await this.transport.request("POST", "participant_feedback", {}, {
      participant_session_id: session.id,
      variant_id: session.assigned_variant_id,
      understood_offer_text: input.survey.understood_offer,
      understood_price_terms_text: input.survey.understood_price,
      hesitation_text: input.survey.hesitation,
      clarity_score: input.survey.clarity,
      trust_score: input.survey.trust,
      would_continue_with_real_money: input.survey.would_continue === "yes",
      continuation_reason_text: input.survey.continuation_reason,
    }, "return=minimal");

    if (session.terac_submission_hmac) {
      await this.transport.request("PATCH", "participant_sessions", { id: `eq.${String(session.id)}` }, {
        decision,
        decision_at: now,
        survey_completed_at: now,
        completed_at: now,
        quality_status: "valid",
        completion_method: "external_redirect",
        redirect_state: "mocked",
        redirected_at: now,
      }, "return=minimal");
      await this.finalizeAfterParticipant(String(session.study_id), String(session.id));
      return {
        outcome: "redirect",
        redirect_url: `/s/complete?receipt=${this.hmac(`receipt:${String(session.id)}`).slice(0, 20)}`,
      };
    }

    const code = `PB-${this.hmac(`completion:${String(session.id)}`).slice(0, 12).toUpperCase()}`;
    await this.transport.request("PATCH", "participant_sessions", { id: `eq.${String(session.id)}` }, {
      decision,
      decision_at: now,
      survey_completed_at: now,
      completed_at: now,
      quality_status: "valid",
      completion_method: "pb_fallback",
      redirect_state: "fallback_issued",
      confirmation_code_hash: this.hmac(code),
    }, "return=minimal");
    await this.finalizeAfterParticipant(String(session.study_id), String(session.id));
    return { outcome: "fallback_code", completion_code: code };
  }

  private async finalizeAfterParticipant(studyId: string, sessionId: string): Promise<void> {
    try {
      await this.finalizeStudyIfComplete(studyId);
    } catch {
      await this.transport.request("POST", "agent_runs", {}, {
        job_id: (await this.transport.request("GET", "studies", { select: "job_id", id: `eq.${studyId}`, limit: "1" }))[0]?.job_id,
        request_id: `report:failure:${sessionId}`,
        command_type: "directional_report",
        stage: "report",
        status: "failed",
        error_code: "REPORT_GENERATION_FAILED",
        safe_progress_json: { status: "failed" },
        completed_at: new Date().toISOString(),
      }, "return=minimal").catch(() => undefined);
    }
  }

  private async finalizeStudyIfComplete(studyId: string): Promise<void> {
    const [study] = await this.transport.request("GET", "studies", {
      select: "id,job_id,phase",
      id: `eq.${studyId}`,
      limit: "1",
    });
    if (!study || study.phase !== "main") return;
    const [existing] = await this.transport.request("GET", "reports", {
      select: "id",
      job_id: `eq.${String(study.job_id)}`,
      limit: "1",
    });
    if (existing) return;

    const sessions = await this.transport.request("GET", "participant_sessions", {
      select: "id,assigned_variant_id,decision,quality_status,completed_at,survey_completed_at",
      study_id: `eq.${studyId}`,
      completed_at: "not.is.null",
    });
    const valid = sessions.filter(
      (session) =>
        session.quality_status === "valid" &&
        session.survey_completed_at &&
        (session.decision === "continue" || session.decision === "stop"),
    );
    if (valid.length !== STUDY_TARGET) return;

    const variants = await this.transport.request("GET", "variants", {
      select: "id,label",
      job_id: `eq.${String(study.job_id)}`,
    });
    const labels = new Map(variants.map((variant) => [String(variant.id), String(variant.label)]));
    const sessionIds = valid.map((session) => String(session.id));
    const feedback = await this.transport.request("GET", "participant_feedback", {
      select: "participant_session_id,clarity_score,trust_score",
      participant_session_id: `in.(${sessionIds.join(",")})`,
    });
    const scores = new Map(feedback.map((row) => [String(row.participant_session_id), row]));
    const report = createDirectionalReport(
      String(study.job_id),
      valid.flatMap((session) => {
        const label = labels.get(String(session.assigned_variant_id));
        const score = scores.get(String(session.id));
        if ((label !== "A" && label !== "B") || !score) return [];
        return [{
          variant: label,
          decision: session.decision as "continue" | "stop",
          quality: "valid" as const,
          clarity_score: Number(score.clarity_score),
          trust_score: Number(score.trust_score),
        }];
      }),
    );
    if (report.a_valid !== STUDY_PER_VARIANT || report.b_valid !== STUDY_PER_VARIANT) return;

    const reportToken = `pbr_${randomBytes(24).toString("base64url")}`;
    const reportPath = `jobs/${String(study.job_id)}/reports/directional-v2.json`;
    const reportBody = JSON.stringify(report);
    const upload = await this.fetcher(
      `${this.baseUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(process.env.SUPABASE_ARTIFACT_BUCKET ?? "paybench-artifacts")}/${reportPath}`,
      {
        method: "POST",
        headers: {
          apikey: this.serverKey,
          Authorization: `Bearer ${this.serverKey}`,
          "Content-Type": "application/json",
          "x-upsert": "false",
        },
        body: reportBody,
        cache: "no-store",
      },
    );
    if (!upload.ok && upload.status !== 409) throw new StudyError("REPORT_UPLOAD_FAILED", 503);

    await this.transport.request("POST", "reports", {}, {
      job_id: study.job_id,
      result: report.result,
      metrics_json: report,
      report_path: reportPath,
      public_token_hash: this.hmac(`report:${reportToken}`),
      public_token_ciphertext: this.encrypt(reportToken),
      expires_at: new Date(Date.now() + 72 * 60 * 60 * 1_000).toISOString(),
      directional_only: true,
      valid_session_count: report.valid_sessions,
      a_valid_count: report.a_valid,
      b_valid_count: report.b_valid,
    }, "return=minimal");
    await this.transport.request("PATCH", "studies", { id: `eq.${studyId}` }, {
      phase: "complete",
      status: "complete",
      completed_at: new Date().toISOString(),
    }, "return=minimal");
    await this.transport.request("PATCH", "jobs", { id: `eq.${String(study.job_id)}` }, {
      status: "report_ready",
      updated_at: new Date().toISOString(),
    }, "return=minimal");
    await this.transport.request("POST", "agent_runs", {}, {
      job_id: study.job_id,
      request_id: `linq:report:${String(study.job_id)}`,
      command_type: "linq_report_delivery",
      stage: "delivery",
      status: "queued",
      output_artifact_path: reportPath,
      safe_progress_json: {
        status: "queued",
        report_url: `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/report/${reportToken}`,
      },
    }, "return=minimal");

    const reportUrl = `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/report/${reportToken}`;
    const [job] = await this.transport.request("GET", "jobs", {
      select: "customer_id",
      id: `eq.${String(study.job_id)}`,
      limit: "1",
    });
    const [conversation] = job
      ? await this.transport.request("GET", "conversations", {
          select: "id,linq_chat_id,state",
          customer_id: `eq.${String(job.customer_id)}`,
          linq_chat_id: "not.is.null",
          order: "last_inbound_at.desc",
          limit: "1",
        })
      : [];
    if (!conversation?.linq_chat_id || String(conversation.state).includes('"opted_out"')) return;
    let delivery;
    try {
      delivery = await deliverReportToHealthyLinqChat(String(conversation.linq_chat_id), reportUrl);
    } catch {
      delivery = { status: "blocked" as const, reason: "LINQ_DELIVERY_FAILED" };
    }
    await this.transport.request("PATCH", "agent_runs", {
      request_id: `eq.linq:report:${String(study.job_id)}`,
    }, {
      status: delivery.status === "sent" ? "sent" : "failed",
      error_code: delivery.status === "blocked" ? delivery.reason : null,
      completed_at: new Date().toISOString(),
      safe_progress_json: delivery.status === "sent"
        ? { status: "sent", report_url: reportUrl, provider_message_id: delivery.provider_message_id }
        : { status: "blocked", report_url: reportUrl, reason: delivery.reason },
    }, "return=minimal");
    if (delivery.status === "sent") {
      await this.transport.request("PATCH", "jobs", { id: `eq.${String(study.job_id)}` }, {
        status: "delivered",
        updated_at: new Date().toISOString(),
      }, "return=minimal");
      await this.transport.request("PATCH", "conversations", { id: `eq.${String(conversation.id)}` }, {
        state: JSON.stringify({ name: "report_delivered", job_id: String(study.job_id) }),
        last_outbound_at: new Date().toISOString(),
      }, "return=minimal");
    }
  }

  async approve(
    kind: OperatorApproval["kind"],
    artifactHash: string,
    jobId?: string,
  ): Promise<OperatorStudyStatus> {
    if (!jobId || !uuid(jobId)) throw new StudyError("RUN_NOT_FOUND", 404);
    const [job] = await this.transport.request("GET", "jobs", {
      select: "id,artifact_bundle_hash",
      id: `eq.${jobId}`,
      limit: "1",
    });
    if (!job || !stringValue(job.artifact_bundle_hash) || !this.safeEqual(String(job.artifact_bundle_hash), artifactHash)) {
      throw new StudyError("APPROVAL_ARTIFACT_MISMATCH", 409);
    }
    try {
      await this.transport.request("POST", "operator_approvals", {}, {
        job_id: jobId,
        approval_kind: kind,
        artifact_bundle_hash: artifactHash,
        approved_by: OPERATOR_ID,
      }, "return=minimal");
    } catch {
      // A matching approval is idempotent. A changed bundle uses a different key.
    }
    if (kind === "terac_quote") {
      await this.transport.request("PATCH", "funding_quotes", { job_id: `eq.${jobId}` }, {
        credits_confirmed: true,
      }, "return=minimal");
      const [study] = await this.transport.request("GET", "studies", {
        select: "id,screening_spec_json",
        job_id: `eq.${jobId}`,
        limit: "1",
      });
      if (study) {
        const screening = objectValue(study.screening_spec_json) ?? {};
        await this.transport.request("PATCH", "studies", { id: `eq.${String(study.id)}` }, {
          screening_spec_json: { ...screening, operator_approved: true },
        }, "return=minimal");
      }
    }
    await this.refreshGate(jobId, artifactHash);
    return this.dashboardStatus(jobId);
  }

  private async refreshGate(jobId: string, artifactHash: string): Promise<void> {
    const [gateRow] = await this.transport.request("GET", "quality_gate_runs", {
      select: "id,checks_json,replay_blocking_findings",
      job_id: `eq.${jobId}`,
      artifact_bundle_hash: `eq.${artifactHash}`,
      order: "checked_at.desc",
      limit: "1",
    });
    if (!gateRow) throw new StudyError("GATE_NOT_FOUND", 423);
    const approvals = await this.transport.request("GET", "operator_approvals", {
      select: "approval_kind",
      job_id: `eq.${jobId}`,
      artifact_bundle_hash: `eq.${artifactHash}`,
      invalidated_at: "is.null",
    });
    const base = objectValue(gateRow.checks_json) ?? {};
    const [quote] = await this.transport.request("GET", "funding_quotes", {
      select: "credits_confirmed",
      job_id: `eq.${jobId}`,
      limit: "1",
    });
    const checks = {
      ...base,
      pages_approved: approvals.some((row) => row.approval_kind === "pages"),
      quote_approved: approvals.some((row) => row.approval_kind === "terac_quote"),
      terac_credit_funding_confirmed: Boolean(quote?.credits_confirmed),
      replay_blocking_findings: 0,
    };
    const open = Object.values(checks).every((value) => value === true || value === 0);
    const parsed = prelaunchGateSchema.parse({
      checks,
      artifact_bundle_hash: artifactHash,
      open,
      checked_at: new Date().toISOString(),
    });
    await this.transport.request("PATCH", "quality_gate_runs", { id: `eq.${String(gateRow.id)}` }, {
      checks_json: parsed.checks,
      gate_open: parsed.open,
      checked_at: parsed.checked_at,
    }, "return=minimal");
    if (parsed.open) {
      const [study] = await this.transport.request("GET", "studies", {
        select: "id",
        job_id: `eq.${jobId}`,
        limit: "1",
      });
      if (study) {
        await this.transport.request("PATCH", "studies", { id: `eq.${String(study.id)}` }, {
          phase: "pilot",
          status: "pilot",
        }, "return=minimal");
        await this.transport.request("PATCH", "study_assignment_slots", {
          study_id: `eq.${String(study.id)}`,
          cohort: "eq.pilot",
        }, { unlocked_at: new Date().toISOString() }, "return=minimal");
      }
    }
  }

  async unlockMain(jobId?: string): Promise<OperatorStudyStatus> {
    if (!jobId || !uuid(jobId)) throw new StudyError("RUN_NOT_FOUND", 404);
    const [study] = await this.transport.request("GET", "studies", {
      select: "id,phase",
      job_id: `eq.${jobId}`,
      limit: "1",
    });
    if (!study || study.phase !== "pilot") throw new StudyError("PILOT_INCOMPLETE", 423);
    const pilotSlots = await this.transport.request("GET", "study_assignment_slots", {
      select: "id,variant_label,claimed_session_id",
      study_id: `eq.${String(study.id)}`,
      cohort: "eq.pilot",
    });
    const claimed = pilotSlots.filter((slot) => stringValue(slot.claimed_session_id));
    if (claimed.length !== 2 || new Set(claimed.map((slot) => slot.variant_label)).size !== 2) {
      throw new StudyError("PILOT_INCOMPLETE", 423);
    }
    const sessionIds = claimed.map((slot) => String(slot.claimed_session_id));
    const sessions = await this.transport.request("GET", "participant_sessions", {
      select: "id,completed_at,quality_status,survey_completed_at",
      id: `in.(${sessionIds.join(",")})`,
    });
    if (sessions.length !== 2 || sessions.some((session) => !session.completed_at || !session.survey_completed_at || !["valid", "pending"].includes(String(session.quality_status)))) {
      throw new StudyError("PILOT_INCOMPLETE", 423);
    }
    await this.transport.request("PATCH", "studies", { id: `eq.${String(study.id)}` }, {
      phase: "main",
      status: "recruiting",
    }, "return=minimal");
    await this.transport.request("PATCH", "study_assignment_slots", {
      study_id: `eq.${String(study.id)}`,
      cohort: "eq.main",
    }, { unlocked_at: new Date().toISOString() }, "return=minimal");
    return this.dashboardStatus(jobId);
  }

  async dashboardStatus(
    jobId?: string,
    baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000",
  ): Promise<OperatorStudyStatus> {
    if (!jobId || !uuid(jobId)) throw new StudyError("RUN_NOT_FOUND", 404);
    const [job] = await this.transport.request("GET", "jobs", {
      select: "id,submitted_url,normalized_url,target_customer_description,target_customer_spec_json,amount_paid_cents,payment_status,artifact_bundle_hash",
      id: `eq.${jobId}`,
      limit: "1",
    });
    const [study] = await this.transport.request("GET", "studies", {
      select: "id,phase,opaque_token_hash,opaque_token_ciphertext,artifact_bundle_hash,target_customer_spec_json",
      job_id: `eq.${jobId}`,
      limit: "1",
    });
    if (!job || !study) throw new StudyError("RUN_NOT_FOUND", 404);
    const artifactHash = stringValue(study.artifact_bundle_hash) ?? stringValue(job.artifact_bundle_hash);
    if (!artifactHash) throw new StudyError("ARTIFACT_BUNDLE_MISSING", 423);
    const [gateRow] = await this.transport.request("GET", "quality_gate_runs", {
      select: "checks_json,gate_open,checked_at",
      job_id: `eq.${jobId}`,
      artifact_bundle_hash: `eq.${artifactHash}`,
      order: "checked_at.desc",
      limit: "1",
    });
    if (!gateRow) throw new StudyError("GATE_NOT_FOUND", 423);
    const checks = objectValue(gateRow.checks_json);
    const gate: PrelaunchGate = prelaunchGateSchema.parse({
      checks,
      artifact_bundle_hash: artifactHash,
      open: Boolean(gateRow.gate_open),
      checked_at: new Date(String(gateRow.checked_at)).toISOString(),
    });
    const [quote] = await this.transport.request("GET", "funding_quotes", {
      select: "participant_count,reward_cents,participant_subtotal_cents,terac_platform_fee_cents,credits_confirmed",
      job_id: `eq.${jobId}`,
      limit: "1",
    });
    if (!quote) throw new StudyError("QUOTE_NOT_FOUND", 423);
    const slots = await this.transport.request("GET", "study_assignment_slots", {
      select: "id,cohort,variant_label,claimed_session_id",
      study_id: `eq.${String(study.id)}`,
    });
    const claimedIds = slots.map((slot) => stringValue(slot.claimed_session_id)).filter((value): value is string => Boolean(value));
    const sessions = claimedIds.length > 0
      ? await this.transport.request("GET", "participant_sessions", {
          select: "id,completed_at",
          id: `in.(${claimedIds.join(",")})`,
        })
      : [];
    const completeIds = new Set(sessions.filter((session) => session.completed_at).map((session) => String(session.id)));
    const completeSlots = slots.filter((slot) => completeIds.has(String(slot.claimed_session_id)));
    const targetSpec = objectValue(study.target_customer_spec_json) ?? objectValue(job.target_customer_spec_json);
    const targetCustomer: TargetCustomerSpec = targetSpec
      ? (targetSpec as TargetCustomerSpec)
      : {
          description: String(job.target_customer_description),
          must_match: ["Matches the founder's target-customer description"],
          must_not_match: ["Works for the product shown"],
        };
    const snapshot = dashboardRunSnapshotV2Schema.parse({
      contract_version: PAYBENCH_CONTRACT_VERSION,
      job_id: jobId,
      website_url: String(job.normalized_url ?? job.submitted_url),
      target_customer: targetCustomer,
      current_stage: study.phase === "pilot" ? "pilot" : study.phase === "main" ? "study" : study.phase === "complete" ? "report" : "approvals",
      funding: {
        founder_fee_cents: 2_000,
        founder_payment_confirmed: job.payment_status === "paid" && Number(job.amount_paid_cents) === 2_000,
        participant_count: STUDY_TARGET,
        approved_reward_cents: STUDY_REWARD_CENTS,
        participant_subtotal_cents: STUDY_PRE_FEE_BUDGET_CENTS,
        terac_platform_fee_cents: Number(quote.terac_platform_fee_cents),
        quote_approved: gate.checks.quote_approved,
        sponsor_credits_confirmed: Boolean(quote.credits_confirmed),
      },
      gate,
      study: {
        phase: study.phase,
        pilot_completed: completeSlots.filter((slot) => slot.cohort === "pilot").length,
        pilot_target: 2,
        main_completed: completeSlots.filter((slot) => slot.cohort === "main").length,
        main_target: 8,
        total_completed: completeSlots.length,
        total_target: STUDY_TARGET,
        a_completed: completeSlots.filter((slot) => slot.variant_label === "A").length,
        b_completed: completeSlots.filter((slot) => slot.variant_label === "B").length,
        a_target: STUDY_PER_VARIANT,
        b_target: STUDY_PER_VARIANT,
      },
      terac_mode: "mock",
      terac_actions: ["copy_brief", "copy_study_link"],
      updated_at: new Date().toISOString(),
    });
    return {
      ...snapshot,
      founder_label: new URL(snapshot.website_url).hostname.replace(/^www\./, ""),
      artifact_bundle_hash: artifactHash,
      brief: NEUTRAL_TERAC_BRIEF.replace(
        /Target customer:[\s\S]*?Act as this customer/,
        `Target customer: ${targetCustomer.description}\n\nAct as this customer`,
      ),
      study_url: `${baseUrl.replace(/\/$/, "")}/s/${encodeURIComponent(this.decrypt(String(study.opaque_token_ciphertext)))}`,
      pilot_review_required:
        completeSlots.filter((slot) => slot.cohort === "pilot").length === 2 && study.phase === "pilot",
    };
  }
}

let liveRepository: Promise<SupabaseStudyRepository> | undefined;

export function getSupabaseStudyRepository(): Promise<SupabaseStudyRepository> {
  liveRepository ??= (async () => {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.APP_SIGNING_SECRET;
    if (!baseUrl || !secret) throw new StudyError("STUDY_STORAGE_NOT_CONFIGURED", 503);
    const serverKey = await resolveSupabaseServerKey(process.env);
    return new SupabaseStudyRepository(
      new SupabaseControlTransport(baseUrl, serverKey),
      baseUrl,
      serverKey,
      secret,
    );
  })();
  return liveRepository;
}
