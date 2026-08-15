import "../integrations/server-only";

import {
  dashboardRunSnapshotV2Schema,
  PAYBENCH_CONTRACT_VERSION,
  PILOT_PARTICIPANTS,
  prelaunchGateSchema,
  STUDY_DURATION_MINUTES,
  STUDY_PER_VARIANT,
  STUDY_PRE_FEE_BUDGET_CENTS,
  STUDY_REWARD_CENTS,
  STUDY_TARGET,
  type OperatorApproval,
  type PrelaunchGate,
  type TargetCustomerSpec,
} from "@paybench/contracts";
import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type {
  OperatorStudyStatus,
  ParticipantCompletion,
  ParticipantDecisionInput,
  ParticipantSessionView,
  StudyEventName,
} from "./types";

export const DEMO_STUDY_TOKEN = "pbx_7Qm4vN9kR2sL8cW6hF3dT1yP";
export const DEMO_JOB_ID = "7c59d21a-9ef0-45f3-8958-b8b20f1d84c0";
export const PARTICIPANT_COOKIE = "paybench_participant";

const OPERATOR_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_PLATFORM_FEE_CENTS = 750;
const DEMO_ARTIFACT_HASH = createHash("sha256")
  .update("paybench-demo-artifacts-v2|quote-500-10-50|replay-pass")
  .digest("hex");

const TARGET_CUSTOMER: TargetCustomerSpec = {
  description:
    "People who lead or contribute to a small software team and can evaluate a paid collaboration tool.",
  must_match: ["Works on a software team", "Helps choose or use paid work software"],
  must_not_match: ["Has never worked with a software team"],
};

const TARGET_CUSTOMER_TASK_COPY = `${TARGET_CUSTOMER.description}\n\nOnly take this task if:\n- ${TARGET_CUSTOMER.must_match.join("\n- ")}`;

export const NEUTRAL_TERAC_BRIEF = `Title: Review an online purchase page

Time: About 10 minutes
Pay: $5. You receive the same pay whether you complete the simulated purchase or stop.

Target customer: ${TARGET_CUSTOMER_TASK_COPY}

Act as this customer and decide whether to buy the product shown. Use only the simulated money and preset details on the page.

You will not be charged. Do not create an account. Do not enter real payment information. There is no correct answer. Stop when you would naturally stop, or complete the simulated purchase when you would naturally continue.

Finish the short survey. The page will complete the task or give you a one-use PB code.`;

type Variant = "A" | "B";
type SlotPhase = "pilot" | "main";

interface AssignmentSlot {
  id: string;
  variant: Variant;
  phase: SlotPhase;
  claimed_session_id?: string;
}

interface StoredSession {
  id: string;
  slot_id: string;
  terac_submission_hash?: string;
  terac_submission_ciphertext?: string;
  events: StudyEventName[];
  completed: boolean;
  fallback_code_issued: boolean;
  pending_decision?: "stop";
}

interface StudyRecord {
  token_hash: string;
  approvals: Partial<Record<OperatorApproval["kind"], OperatorApproval>>;
  gate: PrelaunchGate;
  phase: "locked" | "pilot" | "main" | "complete";
  main_unlocked: boolean;
  slots: AssignmentSlot[];
  sessions: Map<string, StoredSession>;
  submission_hashes: Set<string>;
}

interface RepositoryOptions {
  random?: () => number;
  signing_secret?: string;
}

export class StudyError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "StudyError";
  }
}

function runtimeSecret(explicit?: string): string {
  if (explicit) return explicit;
  const configured = process.env.APP_SIGNING_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new StudyError("APP_SIGNING_SECRET_MISSING", 503);
  }
  return "paybench-local-study-secret-change-before-production";
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function allBaseChecks() {
  return {
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
    replay_blocking_findings: 0 as const,
    pages_approved: false,
    quote_approved: false,
    founder_payment_confirmed: true,
    terac_credit_funding_confirmed: true,
  };
}

function makeGate(checks = allBaseChecks()): PrelaunchGate {
  const open = Object.values(checks).every((value) => value === true || value === 0);
  return prelaunchGateSchema.parse({
    checks,
    artifact_bundle_hash: DEMO_ARTIFACT_HASH,
    open,
    checked_at: new Date().toISOString(),
  });
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

export class MockStudyRepository {
  private readonly secret: string;
  private readonly record: StudyRecord;

  constructor(options: RepositoryOptions = {}) {
    this.secret = runtimeSecret(options.signing_secret);
    const random = options.random ?? Math.random;
    const pilot = shuffled<Variant>(["A", "B"], random);
    const main = shuffled<Variant>(["A", "A", "A", "A", "B", "B", "B", "B"], random);
    const slots: AssignmentSlot[] = [
      ...pilot.map((variant, index) => ({ id: `pilot-${index + 1}`, variant, phase: "pilot" as const })),
      ...main.map((variant, index) => ({ id: `main-${index + 1}`, variant, phase: "main" as const })),
    ];

    this.record = {
      token_hash: this.hmac(DEMO_STUDY_TOKEN),
      approvals: {},
      gate: makeGate(),
      phase: "locked",
      main_unlocked: false,
      slots,
      sessions: new Map(),
      submission_hashes: new Set(),
    };
  }

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

  private signedCookie(sessionId: string): string {
    return `${sessionId}.${this.hmac(`session:${sessionId}`)}`;
  }

  private sessionFromCookie(cookieValue?: string): StoredSession | undefined {
    if (!cookieValue) return undefined;
    const separator = cookieValue.indexOf(".");
    if (separator < 1) return undefined;
    const sessionId = cookieValue.slice(0, separator);
    const signature = cookieValue.slice(separator + 1);
    if (!this.safeEqual(signature, this.hmac(`session:${sessionId}`))) return undefined;
    return this.record.sessions.get(sessionId);
  }

  private assertToken(token: string): void {
    if (!this.safeEqual(this.hmac(token), this.record.token_hash)) {
      throw new StudyError("STUDY_NOT_FOUND", 404);
    }
  }

  private viewFor(session: StoredSession): ParticipantSessionView {
    const slot = this.record.slots.find((candidate) => candidate.id === session.slot_id);
    if (!slot) throw new StudyError("ASSIGNMENT_NOT_FOUND", 409);

    return {
      brand_name: "Northstar",
      headline: slot.variant === "A" ? "Choose a plan for your team" : "Ship together without extra process",
      supporting_copy:
        slot.variant === "A"
          ? "Shared planning and review for growing software teams."
          : "One workspace for planning, review, and weekly team decisions.",
      target_customer: TARGET_CUSTOMER.description,
      plans: [
        { id: "growth-monthly", name: "Growth", price: "$29 / month", terms: "Billed monthly", detail: "For teams shipping weekly" },
        { id: "growth-annual", name: "Growth annual", price: "$290 / year", terms: "Billed annually", detail: "Two months included" },
      ],
      default_plan_id: slot.variant === "A" ? "growth-monthly" : "growth-annual",
      preset: { name: "Alex Example", postal_code: "00000", payment_token: "SIMULATION TOKEN" },
      ...(session.pending_decision ? { resume_decision: session.pending_decision } : {}),
    };
  }

  claimSession(input: {
    token: string;
    cookie_value?: string;
    terac_submission_id?: string;
  }): { view: ParticipantSessionView; cookie_value: string; reused: boolean } {
    this.assertToken(input.token);
    const existing = this.sessionFromCookie(input.cookie_value);
    if (existing) {
      return { view: this.viewFor(existing), cookie_value: this.signedCookie(existing.id), reused: true };
    }

    if (!this.record.gate.open) throw new StudyError("STUDY_LOCKED", 423);
    if (this.record.phase === "pilot" && this.completedCount("pilot") >= PILOT_PARTICIPANTS) {
      throw new StudyError("PILOT_REVIEW_REQUIRED", 423);
    }
    if (this.record.phase === "complete" || this.record.phase === "locked") {
      throw new StudyError("STUDY_NOT_OPEN", 423);
    }

    const phase = this.record.phase;
    const slot = this.record.slots.find((candidate) => candidate.phase === phase && !candidate.claimed_session_id);
    if (!slot) throw new StudyError("NO_ASSIGNMENT_AVAILABLE", 409);

    let submissionHash: string | undefined;
    let submissionCiphertext: string | undefined;
    const submissionId = input.terac_submission_id?.trim();
    if (submissionId) {
      if (submissionId.length > 200) throw new StudyError("TERAC_SUBMISSION_INVALID", 400);
      submissionHash = this.hmac(`terac:${submissionId}`);
      if (this.record.submission_hashes.has(submissionHash)) {
        throw new StudyError("TERAC_SUBMISSION_DUPLICATE", 409);
      }
      submissionCiphertext = this.encrypt(submissionId);
      this.record.submission_hashes.add(submissionHash);
    }

    const session: StoredSession = {
      id: randomUUID(),
      slot_id: slot.id,
      terac_submission_hash: submissionHash,
      terac_submission_ciphertext: submissionCiphertext,
      events: ["page_view"],
      completed: false,
      fallback_code_issued: false,
    };
    slot.claimed_session_id = session.id;
    this.record.sessions.set(session.id, session);
    return { view: this.viewFor(session), cookie_value: this.signedCookie(session.id), reused: false };
  }

  recordEvent(cookieValue: string | undefined, event: StudyEventName): void {
    const session = this.sessionFromCookie(cookieValue);
    if (!session) throw new StudyError("SESSION_REQUIRED", 401);
    if (session.completed) throw new StudyError("SESSION_COMPLETE", 409);
    if (!session.events.includes(event)) session.events.push(event);
    if (event === "stop_selected") session.pending_decision = "stop";
  }

  completeDecision(cookieValue: string | undefined, input: ParticipantDecisionInput): ParticipantCompletion {
    const session = this.sessionFromCookie(cookieValue);
    if (!session) throw new StudyError("SESSION_REQUIRED", 401);
    if (session.completed) throw new StudyError("DECISION_ALREADY_RECORDED", 409);
    if (!validSurvey(input)) throw new StudyError("SURVEY_INCOMPLETE", 400);
    if (input.decision === "complete_simulated_purchase" && !input.selected_plan_id) {
      throw new StudyError("PLAN_REQUIRED", 400);
    }

    session.completed = true;
    session.pending_decision = input.decision === "stop" ? "stop" : undefined;
    session.events.push(
      input.decision === "complete_simulated_purchase" ? "simulated_purchase_completed" : "stop_selected",
      "survey_submitted",
    );

    if (this.completedCount("pilot") === PILOT_PARTICIPANTS && this.record.phase === "pilot") {
      // Main remains locked until the operator reviews the two pilot sessions.
      this.record.main_unlocked = false;
    }
    if (this.completedCount("main") === 8 && this.record.phase === "main") {
      this.record.phase = "complete";
    }

    if (session.terac_submission_hash) {
      const receipt = this.hmac(`receipt:${session.id}`).slice(0, 20);
      return { outcome: "redirect", redirect_url: `/s/complete?receipt=${receipt}` };
    }

    session.fallback_code_issued = true;
    return {
      outcome: "fallback_code",
      completion_code: `PB-${this.hmac(`completion:${session.id}`).slice(0, 12).toUpperCase()}`,
    };
  }

  approve(kind: OperatorApproval["kind"], artifactHash: string, jobId = DEMO_JOB_ID): OperatorStudyStatus {
    if (jobId !== DEMO_JOB_ID) throw new StudyError("RUN_NOT_FOUND", 404);
    if (!this.safeEqual(artifactHash, DEMO_ARTIFACT_HASH)) {
      throw new StudyError("APPROVAL_ARTIFACT_MISMATCH", 409);
    }
    this.record.approvals[kind] = {
      kind,
      artifact_bundle_hash: DEMO_ARTIFACT_HASH,
      approved_by: OPERATOR_ID,
      approved_at: new Date().toISOString(),
    };
    this.record.gate = makeGate({
      ...allBaseChecks(),
      pages_approved: Boolean(this.record.approvals.pages),
      quote_approved: Boolean(this.record.approvals.terac_quote),
    });
    if (this.record.gate.open && this.record.phase === "locked") this.record.phase = "pilot";
    return this.dashboardStatus();
  }

  unlockMain(jobId = DEMO_JOB_ID): OperatorStudyStatus {
    if (jobId !== DEMO_JOB_ID) throw new StudyError("RUN_NOT_FOUND", 404);
    if (!this.record.gate.open) throw new StudyError("GATE_CLOSED", 423);
    if (this.completedCount("pilot") !== PILOT_PARTICIPANTS) {
      throw new StudyError("PILOT_INCOMPLETE", 423);
    }
    this.record.main_unlocked = true;
    this.record.phase = "main";
    return this.dashboardStatus();
  }

  private completedCount(phase: SlotPhase): number {
    return this.record.slots.filter((slot) => {
      const session = slot.claimed_session_id ? this.record.sessions.get(slot.claimed_session_id) : undefined;
      return slot.phase === phase && session?.completed;
    }).length;
  }

  dashboardStatus(jobIdOrBaseUrl = DEMO_JOB_ID, explicitBaseUrl?: string): OperatorStudyStatus {
    const isBaseUrl = /^https?:\/\//.test(jobIdOrBaseUrl);
    const jobId = isBaseUrl ? DEMO_JOB_ID : jobIdOrBaseUrl;
    const baseUrl = isBaseUrl
      ? jobIdOrBaseUrl
      : explicitBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
    if (jobId !== DEMO_JOB_ID) throw new StudyError("RUN_NOT_FOUND", 404);
    const pilotCompleted = this.completedCount("pilot");
    const mainCompleted = this.completedCount("main");
    const completed = this.record.slots.filter((slot) => {
      const session = slot.claimed_session_id ? this.record.sessions.get(slot.claimed_session_id) : undefined;
      return session?.completed;
    });
    const aCompleted = completed.filter((slot) => slot.variant === "A").length;
    const bCompleted = completed.filter((slot) => slot.variant === "B").length;

    const snapshot = dashboardRunSnapshotV2Schema.parse({
      contract_version: PAYBENCH_CONTRACT_VERSION,
      job_id: DEMO_JOB_ID,
      website_url: "https://northstar.example/pricing",
      target_customer: TARGET_CUSTOMER,
      current_stage: this.record.phase === "locked" ? "approvals" : this.record.phase === "pilot" ? "pilot" : this.record.phase === "main" ? "study" : "report",
      funding: {
        founder_fee_cents: 2_000,
        founder_payment_confirmed: true,
        participant_count: STUDY_TARGET,
        approved_reward_cents: STUDY_REWARD_CENTS,
        participant_subtotal_cents: STUDY_PRE_FEE_BUDGET_CENTS,
        terac_platform_fee_cents: DEMO_PLATFORM_FEE_CENTS,
        quote_approved: this.record.gate.checks.quote_approved,
        sponsor_credits_confirmed: true,
      },
      gate: this.record.gate,
      study: {
        phase: this.record.phase,
        pilot_completed: pilotCompleted,
        pilot_target: 2,
        main_completed: mainCompleted,
        main_target: 8,
        total_completed: pilotCompleted + mainCompleted,
        total_target: STUDY_TARGET,
        a_completed: aCompleted,
        b_completed: bCompleted,
        a_target: STUDY_PER_VARIANT,
        b_target: STUDY_PER_VARIANT,
      },
      terac_mode: "mock",
      terac_actions: ["copy_brief", "copy_study_link"],
      updated_at: new Date().toISOString(),
    });

    return {
      ...snapshot,
      founder_label: "Northstar",
      artifact_bundle_hash: DEMO_ARTIFACT_HASH,
      brief: NEUTRAL_TERAC_BRIEF,
      study_url: `${baseUrl.replace(/\/$/, "")}/s/${DEMO_STUDY_TOKEN}`,
      pilot_review_required: pilotCompleted === PILOT_PARTICIPANTS && !this.record.main_unlocked,
    };
  }

  inspectForTests() {
    return {
      slots: this.record.slots.map((slot) => ({ ...slot })),
      sessions: [...this.record.sessions.values()].map((session) => ({ ...session, events: [...session.events] })),
      gate: this.record.gate,
      phase: this.record.phase,
    };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __paybenchStudyRepository: MockStudyRepository | undefined;
}

export async function getStudyRepository() {
  if (
    process.env.STUDY_DATA_SOURCE === "mock" ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  ) {
    globalThis.__paybenchStudyRepository ??= new MockStudyRepository();
    return globalThis.__paybenchStudyRepository;
  }
  const { getSupabaseStudyRepository } = await import("./supabase-repository");
  return getSupabaseStudyRepository();
}

export function participantCookieHeader(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${PARTICIPANT_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${45 * 60}${secure}`;
}

export function readCookie(request: Request, name: string): string | undefined {
  const source = request.headers.get("cookie")?.split(";") ?? [];
  for (const item of source) {
    const [candidate, ...value] = item.trim().split("=");
    if (candidate === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export const STUDY_PUBLIC_FACTS = {
  duration_minutes: STUDY_DURATION_MINUTES,
  reward_cents: STUDY_REWARD_CENTS,
} as const;
