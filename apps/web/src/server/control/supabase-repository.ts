import { randomUUID } from "node:crypto";

import type {
  ClaimLinqOutboundInput,
  ControlConversation,
  ControlJob,
  ControlRepository,
  ConversationPhase,
  CreateJobInput,
} from "./types";
import { ControlError } from "./types";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;

function validServerKey(value: string | undefined): value is string {
  if (!value) return false;
  if (value.startsWith("sb_secret_") && value.length >= 24) return true;
  return value.startsWith("eyJ") && value.split(".").length === 3;
}

export async function resolveSupabaseServerKey(
  environment: Record<string, string | undefined>,
  fetcher: Fetcher = fetch,
): Promise<string> {
  if (validServerKey(environment.SUPABASE_SECRET_KEY)) {
    return environment.SUPABASE_SECRET_KEY;
  }
  if (validServerKey(environment.SUPABASE_SERVICE_ROLE_KEY)) {
    return environment.SUPABASE_SERVICE_ROLE_KEY;
  }

  const accessToken = environment.SUPABASE_ACCESS_TOKEN;
  const projectRef = environment.SUPABASE_PROJECT_REF;
  if (!accessToken || !projectRef) throw new ControlError("SUPABASE_SERVER_KEY_NOT_CONFIGURED", 503);

  const response = await fetcher(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/api-keys`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store" },
  );
  if (!response.ok) throw new ControlError("SUPABASE_SERVER_KEY_LOOKUP_FAILED", 503);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new ControlError("SUPABASE_SERVER_KEY_LOOKUP_FAILED", 503);
  for (const value of payload) {
    if (!value || typeof value !== "object") continue;
    const row = value as Row;
    const name = typeof row.name === "string" ? row.name : typeof row.type === "string" ? row.type : "";
    const key = typeof row.api_key === "string" ? row.api_key : typeof row.key === "string" ? row.key : undefined;
    if (name === "service_role" && key) return key;
  }
  throw new ControlError("SUPABASE_SERVER_KEY_LOOKUP_FAILED", 503);
}

export class SupabaseControlTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly serverKey: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async request(
    method: "GET" | "POST" | "PATCH",
    table: string,
    query: Readonly<Record<string, string>> = {},
    body?: unknown,
    prefer?: string,
  ): Promise<readonly Row[]> {
    if (!/^[a-z_]+$/.test(table)) throw new ControlError("SUPABASE_TABLE_INVALID", 500);
    const url = new URL(`/rest/v1/${table}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const headers: Record<string, string> = {
      Accept: "application/json",
      apikey: this.serverKey,
    };
    if (this.serverKey.startsWith("eyJ")) headers.Authorization = `Bearer ${this.serverKey}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;

    const response = await this.fetcher(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) throw new ControlError(`SUPABASE_${table.toUpperCase()}_${method}_FAILED`, 503);
    if (response.status === 204) return [];
    const payload: unknown = await response.json();
    return Array.isArray(payload) ? payload.filter((row): row is Row => Boolean(row) && typeof row === "object") : [];
  }
}

function phaseToText(phase: ConversationPhase): string {
  return JSON.stringify(phase);
}

function textToPhase(value: unknown): ConversationPhase {
  if (typeof value !== "string") return { name: "awaiting_url" };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("name" in parsed)) return { name: "awaiting_url" };
    const phase = parsed as ConversationPhase;
    if (["awaiting_url", "awaiting_target", "awaiting_confirmation", "awaiting_payment", "paid", "report_delivered", "opted_out"].includes(phase.name)) {
      return phase;
    }
  } catch {
    // Older plain-text states safely restart at URL intake.
  }
  return { name: "awaiting_url" };
}

function controlJob(row: Row): ControlJob {
  return {
    id: String(row.id),
    customer_id: String(row.customer_id),
    website_url: String(row.normalized_url ?? row.submitted_url),
    target_customer_description: String(row.target_customer_description ?? ""),
    status: row.status as ControlJob["status"],
    payment_status: row.payment_status as ControlJob["payment_status"],
    amount_paid_cents: Number(row.amount_paid_cents ?? 0),
    currency: String(row.currency ?? "USD"),
    stripe_checkout_session_id:
      typeof row.stripe_checkout_session_id === "string"
        ? row.stripe_checkout_session_id
        : undefined,
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

export class SupabaseControlRepository implements ControlRepository {
  constructor(private readonly transport: SupabaseControlTransport) {}

  async createJob(input: CreateJobInput): Promise<ControlJob> {
    let customerId = input.customer_id;
    if (!customerId) {
      const [customer] = await this.transport.request("POST", "customers", {}, {}, "return=representation");
      customerId = typeof customer?.id === "string" ? customer.id : undefined;
    }
    if (!customerId) throw new ControlError("CUSTOMER_CREATE_FAILED", 503);

    const [job] = await this.transport.request(
      "POST",
      "jobs",
      {},
      {
        customer_id: customerId,
        submitted_url: input.website_url,
        normalized_url: input.website_url,
        target_customer_description: input.target_customer_description,
        status: input.initial_status,
        payment_status: input.initial_status === "awaiting_payment" ? "pending" : "unpaid",
        amount_paid_cents: 0,
        currency: "USD",
      },
      "return=representation",
    );
    if (!job) throw new ControlError("JOB_CREATE_FAILED", 503);
    return controlJob(job);
  }

  async getJob(jobId: string): Promise<ControlJob | null> {
    const [row] = await this.transport.request("GET", "jobs", {
      select: "id,customer_id,submitted_url,normalized_url,target_customer_description,status,payment_status,amount_paid_cents,currency,stripe_checkout_session_id,updated_at",
      id: `eq.${jobId}`,
      limit: "1",
    });
    return row ? controlJob(row) : null;
  }

  async setJobAwaitingPayment(jobId: string): Promise<ControlJob> {
    const [row] = await this.transport.request(
      "PATCH",
      "jobs",
      { id: `eq.${jobId}`, select: "id,customer_id,submitted_url,normalized_url,target_customer_description,status,payment_status,amount_paid_cents,currency,stripe_checkout_session_id,updated_at" },
      { status: "awaiting_payment", payment_status: "pending", updated_at: new Date().toISOString() },
      "return=representation",
    );
    if (!row) throw new ControlError("JOB_NOT_FOUND", 404);
    return controlJob(row);
  }

  async confirmPaymentAndEnqueueCapture(input: {
    job_id: string;
    checkout_session_id: string;
    amount_paid_cents: 2000;
    currency: "USD";
  }): Promise<{ job: ControlJob; capture_enqueued: boolean }> {
    const current = await this.getJob(input.job_id);
    if (!current) throw new ControlError("JOB_NOT_FOUND", 404);
    if (
      current.payment_status === "paid" &&
      current.stripe_checkout_session_id &&
      current.stripe_checkout_session_id !== input.checkout_session_id
    ) {
      return { job: current, capture_enqueued: false };
    }
    const [row] = await this.transport.request(
      "PATCH",
      "jobs",
      { id: `eq.${input.job_id}`, select: "id,customer_id,submitted_url,normalized_url,target_customer_description,status,payment_status,amount_paid_cents,currency,stripe_checkout_session_id,updated_at" },
      {
        status: "paid",
        payment_status: "paid",
        stripe_checkout_session_id: input.checkout_session_id,
        amount_paid_cents: input.amount_paid_cents,
        currency: input.currency,
        updated_at: new Date().toISOString(),
      },
      "return=representation",
    );
    if (!row) throw new ControlError("JOB_PAYMENT_UPDATE_FAILED", 503);

    const requestId = `stripe:${input.checkout_session_id}:capture`;
    let captureEnqueued = true;
    try {
      await this.transport.request(
        "POST",
        "agent_runs",
        {},
        {
          job_id: input.job_id,
          request_id: requestId,
          command_type: "capture_job",
          stage: "capture",
          status: "queued",
          safe_progress_json: { status: "queued", task: "Capture queued locally" },
        },
        "return=minimal",
      );
    } catch (error) {
      const existing = await this.transport.request("GET", "agent_runs", {
        select: "id",
        request_id: `eq.${requestId}`,
        limit: "1",
      });
      if (!existing[0]) throw error;
      captureEnqueued = false;
    }

    if (captureEnqueued) {
      await this.appendTransition(input.job_id, "payment", "stripe", "payment_confirmed", "Stripe payment confirmed");
      await this.appendTransition(input.job_id, "capture", "paybench", "capture_queued", "Capture queued locally");
    }
    return { job: controlJob(row), capture_enqueued: captureEnqueued };
  }

  async markPaymentFailed(jobId: string): Promise<ControlJob> {
    const current = await this.getJob(jobId);
    if (!current) throw new ControlError("JOB_NOT_FOUND", 404);
    if (current.payment_status === "paid") return current;
    const [row] = await this.transport.request(
      "PATCH",
      "jobs",
      { id: `eq.${jobId}`, select: "id,customer_id,submitted_url,normalized_url,target_customer_description,status,payment_status,amount_paid_cents,currency,stripe_checkout_session_id,updated_at" },
      { payment_status: "failed", status: "awaiting_payment", updated_at: new Date().toISOString() },
      "return=representation",
    );
    if (!row) throw new ControlError("JOB_NOT_FOUND", 404);
    return controlJob(row);
  }

  async claimWebhook(provider: "stripe" | "linq", eventId: string): Promise<boolean> {
    const existing = await this.transport.request("GET", "webhook_events", {
      select: "status",
      provider: `eq.${provider}`,
      external_event_id: `eq.${eventId}`,
      limit: "1",
    });
    if (existing[0]?.status === "processed" || existing[0]?.status === "processing") return false;
    if (existing[0]) {
      await this.transport.request("PATCH", "webhook_events", { provider: `eq.${provider}`, external_event_id: `eq.${eventId}` }, { status: "processing", processed_at: null }, "return=minimal");
      return true;
    }
    try {
      await this.transport.request("POST", "webhook_events", {}, { provider, external_event_id: eventId, status: "processing" }, "return=minimal");
      return true;
    } catch {
      return false;
    }
  }

  async finishWebhook(provider: "stripe" | "linq", eventId: string, status: "processed" | "failed"): Promise<void> {
    await this.transport.request("PATCH", "webhook_events", { provider: `eq.${provider}`, external_event_id: `eq.${eventId}` }, { status, processed_at: new Date().toISOString() }, "return=minimal");
  }

  async getConversation(chatId: string): Promise<ControlConversation | null> {
    const [row] = await this.transport.request("GET", "conversations", {
      select: "id,customer_id,linq_chat_id,state,last_inbound_at,last_outbound_at",
      linq_chat_id: `eq.${chatId}`,
      limit: "1",
    });
    return row
      ? {
          id: String(row.id),
          customer_id: String(row.customer_id),
          chat_id: String(row.linq_chat_id),
          phase: textToPhase(row.state),
          last_inbound_at: typeof row.last_inbound_at === "string" ? row.last_inbound_at : undefined,
          last_outbound_at: typeof row.last_outbound_at === "string" ? row.last_outbound_at : undefined,
        }
      : null;
  }

  async saveConversation(input: {
    chat_id: string;
    phase: ConversationPhase;
    customer_id?: string;
    inbound_at?: string;
    outbound_at?: string;
  }): Promise<ControlConversation> {
    const existing = await this.getConversation(input.chat_id);
    if (existing) {
      const [row] = await this.transport.request(
        "PATCH",
        "conversations",
        { id: `eq.${existing.id}`, select: "id,customer_id,linq_chat_id,state,last_inbound_at,last_outbound_at" },
        { state: phaseToText(input.phase), last_inbound_at: input.inbound_at ?? existing.last_inbound_at, last_outbound_at: input.outbound_at ?? existing.last_outbound_at },
        "return=representation",
      );
      if (!row) throw new ControlError("CONVERSATION_UPDATE_FAILED", 503);
      return { ...existing, phase: input.phase, last_inbound_at: input.inbound_at ?? existing.last_inbound_at, last_outbound_at: input.outbound_at ?? existing.last_outbound_at };
    }

    let customerId = input.customer_id;
    if (!customerId) {
      const [customer] = await this.transport.request("POST", "customers", {}, {}, "return=representation");
      customerId = typeof customer?.id === "string" ? customer.id : undefined;
    }
    if (!customerId) throw new ControlError("CUSTOMER_CREATE_FAILED", 503);
    const [row] = await this.transport.request(
      "POST",
      "conversations",
      {},
      { customer_id: customerId, linq_chat_id: input.chat_id, state: phaseToText(input.phase), last_inbound_at: input.inbound_at, last_outbound_at: input.outbound_at },
      "return=representation",
    );
    if (!row) throw new ControlError("CONVERSATION_CREATE_FAILED", 503);
    return { id: String(row.id), customer_id: customerId, chat_id: input.chat_id, phase: input.phase, last_inbound_at: input.inbound_at, last_outbound_at: input.outbound_at };
  }

  async recordFinalReportDelivery(input: { chat_id: string; job_id: string; delivered_at: string }): Promise<void> {
    const job = await this.getJob(input.job_id);
    if (!job) throw new ControlError("JOB_NOT_FOUND", 404);
    await this.transport.request("PATCH", "jobs", { id: `eq.${input.job_id}` }, { status: "delivered", updated_at: input.delivered_at }, "return=minimal");
    await this.saveConversation({ chat_id: input.chat_id, customer_id: job.customer_id, phase: { name: "report_delivered", job_id: input.job_id }, outbound_at: input.delivered_at });
    await this.appendTransition(input.job_id, "delivery", "linq", "report_delivered", "Report delivery recorded");
  }

  async claimLinqOutbound(input: ClaimLinqOutboundInput): Promise<boolean> {
    const requestId = `linq:${input.idempotency_key}`;
    const [existing] = await this.transport.request("GET", "agent_runs", {
      select: "id,status",
      request_id: `eq.${requestId}`,
      limit: "1",
    });
    if (existing?.status === "sending" || existing?.status === "sent") return false;

    if (existing) {
      await this.transport.request(
        "PATCH",
        "agent_runs",
        { request_id: `eq.${requestId}` },
        {
          status: "sending",
          error_code: null,
          completed_at: null,
          updated_at: new Date().toISOString(),
          safe_progress_json: { status: "sending", kind: input.kind },
        },
        "return=minimal",
      );
      return true;
    }

    try {
      await this.transport.request(
        "POST",
        "agent_runs",
        {},
        {
          job_id: input.job_id,
          request_id: requestId,
          command_type: `linq_${input.kind}`,
          stage: input.kind === "report" ? "delivery" : input.kind === "payment" ? "payment" : "intake",
          status: "sending",
          safe_progress_json: { status: "sending", kind: input.kind },
        },
        "return=minimal",
      );
      return true;
    } catch (error) {
      const [winner] = await this.transport.request("GET", "agent_runs", {
        select: "id,status",
        request_id: `eq.${requestId}`,
        limit: "1",
      });
      if (winner) return false;
      throw error;
    }
  }

  async finishLinqOutbound(
    idempotencyKey: string,
    status: "sent" | "failed",
  ): Promise<void> {
    await this.transport.request(
      "PATCH",
      "agent_runs",
      { request_id: `eq.linq:${idempotencyKey}` },
      {
        status,
        error_code: status === "failed" ? "LINQ_SEND_FAILED" : null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        safe_progress_json: { status },
      },
      "return=minimal",
    );
  }

  private async appendTransition(jobId: string, stage: string, actor: string, reasonCode: string, summary: string): Promise<void> {
    await this.transport.request(
      "POST",
      "job_transitions",
      {},
      { job_id: jobId, to_status: stage === "delivery" ? "delivered" : stage === "payment" ? "paid" : "paid", stage, actor, reason_code: reasonCode, safe_summary: summary, idempotency_key: `${jobId}:${reasonCode}:${randomUUID()}` },
      "return=minimal",
    );
  }
}

let repositoryPromise: Promise<ControlRepository> | undefined;

export function getControlRepository(): Promise<ControlRepository> {
  repositoryPromise ??= (async () => {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!baseUrl) throw new ControlError("SUPABASE_URL_NOT_CONFIGURED", 503);
    const serverKey = await resolveSupabaseServerKey(process.env);
    return new SupabaseControlRepository(new SupabaseControlTransport(baseUrl, serverKey));
  })();
  return repositoryPromise;
}
