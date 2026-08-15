import { randomUUID } from "node:crypto";

import type {
  CaptureStartRecord,
  ClaimLinqOutboundInput,
  ControlConversation,
  ControlJob,
  ControlRepository,
  ConversationPhase,
  CreateJobInput,
} from "./types";
import { ControlError } from "./types";

export class MemoryControlRepository implements ControlRepository {
  readonly jobs = new Map<string, ControlJob>();
  readonly conversations = new Map<string, ControlConversation>();
  readonly captureStarts = new Map<string, CaptureStartRecord>();
  readonly webhookStates = new Map<string, "processing" | "processed" | "failed">();
  readonly linqOutboundStates = new Map<string, "sending" | "sent" | "failed">();
  readonly transitions: Array<{ job_id: string; stage: string; summary: string }> = [];

  async createJob(input: CreateJobInput): Promise<ControlJob> {
    const now = new Date().toISOString();
    const job: ControlJob = {
      id: randomUUID(),
      customer_id: input.customer_id ?? randomUUID(),
      website_url: input.website_url,
      target_customer_description: input.target_customer_description,
      status: input.initial_status,
      payment_status: "unpaid",
      amount_paid_cents: 0,
      currency: "USD",
      updated_at: now,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async getJob(jobId: string): Promise<ControlJob | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async setJobAwaitingPayment(jobId: string): Promise<ControlJob> {
    return this.updateJob(jobId, { status: "awaiting_payment", payment_status: "pending" });
  }

  async confirmPaymentAndEnqueueCapture(input: {
    job_id: string;
    checkout_session_id: string;
    amount_paid_cents: 2000;
    currency: "USD";
  }): Promise<{ job: ControlJob; capture_enqueued: boolean }> {
    const job = await this.getJob(input.job_id);
    if (!job) throw new ControlError("JOB_NOT_FOUND", 404);
    if (
      job.payment_status === "paid" &&
      job.stripe_checkout_session_id &&
      job.stripe_checkout_session_id !== input.checkout_session_id
    ) {
      return { job, capture_enqueued: false };
    }
    const updated = await this.updateJob(input.job_id, {
      status: "paid",
      payment_status: "paid",
      amount_paid_cents: input.amount_paid_cents,
      currency: input.currency,
      stripe_checkout_session_id: input.checkout_session_id,
    });
    const requestId = `stripe:${input.checkout_session_id}:capture`;
    const captureEnqueued = !this.captureStarts.has(requestId);
    if (captureEnqueued) {
      this.captureStarts.set(requestId, {
        request_id: requestId,
        job_id: input.job_id,
        status: "queued",
        created_at: new Date().toISOString(),
      });
      this.transitions.push({ job_id: input.job_id, stage: "payment", summary: "Stripe payment confirmed" });
      this.transitions.push({ job_id: input.job_id, stage: "capture", summary: "Capture queued locally" });
    }
    return { job: updated, capture_enqueued: captureEnqueued };
  }

  async markPaymentFailed(jobId: string): Promise<ControlJob> {
    const job = await this.getJob(jobId);
    if (!job) throw new ControlError("JOB_NOT_FOUND", 404);
    if (job.payment_status === "paid") return job;
    return this.updateJob(jobId, { payment_status: "failed", status: "awaiting_payment" });
  }

  async claimWebhook(provider: "stripe" | "linq", eventId: string): Promise<boolean> {
    const key = `${provider}:${eventId}`;
    const current = this.webhookStates.get(key);
    if (current === "processed" || current === "processing") return false;
    this.webhookStates.set(key, "processing");
    return true;
  }

  async finishWebhook(
    provider: "stripe" | "linq",
    eventId: string,
    status: "processed" | "failed",
  ): Promise<void> {
    this.webhookStates.set(`${provider}:${eventId}`, status);
  }

  async getConversation(chatId: string): Promise<ControlConversation | null> {
    const conversation = this.conversations.get(chatId);
    return conversation ? structuredClone(conversation) : null;
  }

  async saveConversation(input: {
    chat_id: string;
    phase: ConversationPhase;
    customer_id?: string;
    inbound_at?: string;
    outbound_at?: string;
  }): Promise<ControlConversation> {
    const current = this.conversations.get(input.chat_id);
    const conversation: ControlConversation = {
      id: current?.id ?? randomUUID(),
      customer_id: current?.customer_id ?? input.customer_id ?? randomUUID(),
      chat_id: input.chat_id,
      phase: structuredClone(input.phase),
      last_inbound_at: input.inbound_at ?? current?.last_inbound_at,
      last_outbound_at: input.outbound_at ?? current?.last_outbound_at,
    };
    this.conversations.set(input.chat_id, conversation);
    return structuredClone(conversation);
  }

  async recordFinalReportDelivery(input: {
    chat_id: string;
    job_id: string;
    delivered_at: string;
  }): Promise<void> {
    const job = await this.getJob(input.job_id);
    if (!job) throw new ControlError("JOB_NOT_FOUND", 404);
    await this.updateJob(input.job_id, { status: "delivered" });
    await this.saveConversation({
      chat_id: input.chat_id,
      customer_id: job.customer_id,
      phase: { name: "report_delivered", job_id: input.job_id },
      outbound_at: input.delivered_at,
    });
    this.transitions.push({ job_id: input.job_id, stage: "delivery", summary: "Report delivery recorded" });
  }

  async claimLinqOutbound(input: ClaimLinqOutboundInput): Promise<boolean> {
    const job = await this.getJob(input.job_id);
    if (!job) throw new ControlError("JOB_NOT_FOUND", 404);
    const current = this.linqOutboundStates.get(input.idempotency_key);
    if (current === "sending" || current === "sent") return false;
    this.linqOutboundStates.set(input.idempotency_key, "sending");
    return true;
  }

  async finishLinqOutbound(
    idempotencyKey: string,
    status: "sent" | "failed",
  ): Promise<void> {
    this.linqOutboundStates.set(idempotencyKey, status);
  }

  private async updateJob(jobId: string, patch: Partial<ControlJob>): Promise<ControlJob> {
    const current = this.jobs.get(jobId);
    if (!current) throw new ControlError("JOB_NOT_FOUND", 404);
    const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
    this.jobs.set(jobId, updated);
    return { ...updated };
  }
}
