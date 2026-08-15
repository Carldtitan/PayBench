export type JobStatus =
  | "awaiting_confirmation"
  | "awaiting_payment"
  | "paid"
  | "capturing"
  | "needs_scout"
  | "spec_ready"
  | "building_variants"
  | "quality_check"
  | "qa_replay"
  | "awaiting_approvals"
  | "pilot"
  | "recruiting"
  | "testing"
  | "analyzing"
  | "report_ready"
  | "delivered"
  | "failed";

export interface ControlJob {
  id: string;
  customer_id: string;
  website_url: string;
  target_customer_description: string;
  status: JobStatus;
  payment_status: "unpaid" | "pending" | "paid" | "failed" | "refunded";
  amount_paid_cents: number;
  currency: string;
  stripe_checkout_session_id?: string;
  updated_at: string;
}

export type ConversationPhase =
  | { name: "awaiting_url" }
  | { name: "awaiting_target"; website_url: string }
  | { name: "awaiting_confirmation"; job_id: string }
  | { name: "awaiting_payment"; job_id: string }
  | { name: "paid"; job_id: string }
  | { name: "report_delivered"; job_id: string }
  | { name: "opted_out" };

export interface ControlConversation {
  id: string;
  customer_id: string;
  chat_id: string;
  phase: ConversationPhase;
  last_inbound_at?: string;
  last_outbound_at?: string;
}

export interface CaptureStartRecord {
  request_id: string;
  job_id: string;
  status: "queued";
  created_at: string;
}

export interface CreateJobInput {
  website_url: string;
  target_customer_description: string;
  initial_status: "awaiting_confirmation" | "awaiting_payment";
  customer_id?: string;
}

export type LinqMessageKind = "confirmation" | "payment" | "report";

export interface ClaimLinqOutboundInput {
  job_id: string;
  idempotency_key: string;
  kind: LinqMessageKind;
}

export interface ControlRepository {
  createJob(input: CreateJobInput): Promise<ControlJob>;
  getJob(jobId: string): Promise<ControlJob | null>;
  setJobAwaitingPayment(jobId: string): Promise<ControlJob>;
  confirmPaymentAndEnqueueCapture(input: {
    job_id: string;
    checkout_session_id: string;
    amount_paid_cents: 2000;
    currency: "USD";
  }): Promise<{ job: ControlJob; capture_enqueued: boolean }>;
  markPaymentFailed(jobId: string): Promise<ControlJob>;
  claimWebhook(provider: "stripe" | "linq", eventId: string): Promise<boolean>;
  finishWebhook(
    provider: "stripe" | "linq",
    eventId: string,
    status: "processed" | "failed",
  ): Promise<void>;
  getConversation(chatId: string): Promise<ControlConversation | null>;
  saveConversation(input: {
    chat_id: string;
    phase: ConversationPhase;
    customer_id?: string;
    inbound_at?: string;
    outbound_at?: string;
  }): Promise<ControlConversation>;
  recordFinalReportDelivery(input: {
    chat_id: string;
    job_id: string;
    delivered_at: string;
  }): Promise<void>;
  claimLinqOutbound(input: ClaimLinqOutboundInput): Promise<boolean>;
  finishLinqOutbound(
    idempotencyKey: string,
    status: "sent" | "failed",
  ): Promise<void>;
}

export class ControlError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
    this.name = "ControlError";
  }
}
