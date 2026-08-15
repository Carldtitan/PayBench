import { paymentLinkForJob } from "./payment-link";
import type { ControlRepository, LinqMessageKind } from "./types";
import { ControlError } from "./types";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type LinqChatHealth = "HEALTHY" | "AT_RISK" | "CRITICAL" | "OPTED_OUT";
export type LinqLineReputation = "HEALTHY" | "AT_RISK" | "CRITICAL";

export interface LinqOutboundTransport {
  send(input: {
    to: string;
    message: string;
  }): Promise<{ message_id: string; chat_id?: string }>;
}

export interface LinqOutboundRequest {
  job_id: string;
  chat_id: string;
  to: string;
  kind: LinqMessageKind;
  idempotency_key: string;
  message: string;
  chat_health: LinqChatHealth;
  line_reputation: LinqLineReputation;
}

export type LinqOutboundResult =
  | { sent: true; duplicate: false; provider_message_id: string }
  | { sent: false; duplicate: true; blocked_reason: "DUPLICATE" }
  | {
      sent: false;
      duplicate: false;
      blocked_reason:
        | "OPTED_OUT"
        | "CONVERSATION_NOT_FOUND"
        | `CHAT_${LinqChatHealth}`
        | `LINE_${LinqLineReputation}`;
    };

function row(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireOutboundRequest(input: LinqOutboundRequest): void {
  if (!/^\+[1-9]\d{7,14}$/.test(input.to)) {
    throw new ControlError("LINQ_RECIPIENT_INVALID", 400);
  }
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(input.idempotency_key)) {
    throw new ControlError("LINQ_IDEMPOTENCY_KEY_INVALID", 400);
  }
  if (input.message.trim().length === 0 || input.message.length > 1500) {
    throw new ControlError("LINQ_MESSAGE_INVALID", 400);
  }
  if (input.kind === "confirmation" && /https?:\/\//i.test(input.message)) {
    throw new ControlError("LINQ_CONFIRMATION_MUST_BE_LINK_FREE", 400);
  }
}

/**
 * Dependency-free Linq V3 transport. It follows messages.create semantics:
 * POST /api/partner/v3/messages with `to` and `message`, deliberately no `from`.
 * Constructing this object performs no network request.
 */
export class LinqV3HttpTransport implements LinqOutboundTransport {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.linqapp.com/api/partner",
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async send(input: { to: string; message: string }): Promise<{ message_id: string; chat_id?: string }> {
    if (!this.apiKey) throw new ControlError("LINQ_API_KEY_NOT_CONFIGURED", 503);
    const baseUrl = this.baseUrl.replace(/\/$/, "");
    const messagesUrl = baseUrl.endsWith("/v3") ? `${baseUrl}/messages` : `${baseUrl}/v3/messages`;
    const response = await this.fetcher(messagesUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: [input.to],
        message: { parts: [{ type: "text", value: input.message }] },
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new ControlError("LINQ_SEND_FAILED", 502);

    let payload: Record<string, unknown> | null = null;
    try {
      payload = row(await response.json());
    } catch {
      throw new ControlError("LINQ_SEND_RESPONSE_INVALID", 502);
    }
    const message = row(payload?.message);
    const messageId =
      typeof message?.id === "string"
        ? message.id
        : typeof payload?.message_id === "string"
          ? payload.message_id
          : undefined;
    if (!messageId) throw new ControlError("LINQ_SEND_RESPONSE_INVALID", 502);
    return {
      message_id: messageId,
      chat_id: typeof payload?.chat_id === "string" ? payload.chat_id : undefined,
    };
  }
}

export class LinqOutboundDispatcher {
  constructor(
    private readonly repository: ControlRepository,
    private readonly transport: LinqOutboundTransport,
  ) {}

  async dispatch(input: LinqOutboundRequest): Promise<LinqOutboundResult> {
    requireOutboundRequest(input);
    const conversation = await this.repository.getConversation(input.chat_id);
    if (!conversation) {
      return { sent: false, duplicate: false, blocked_reason: "CONVERSATION_NOT_FOUND" };
    }
    if (conversation.phase.name === "opted_out" || input.chat_health === "OPTED_OUT") {
      return { sent: false, duplicate: false, blocked_reason: "OPTED_OUT" };
    }
    if (input.chat_health !== "HEALTHY") {
      return { sent: false, duplicate: false, blocked_reason: `CHAT_${input.chat_health}` };
    }
    if (input.line_reputation !== "HEALTHY") {
      return { sent: false, duplicate: false, blocked_reason: `LINE_${input.line_reputation}` };
    }

    const claimed = await this.repository.claimLinqOutbound({
      job_id: input.job_id,
      idempotency_key: input.idempotency_key,
      kind: input.kind,
    });
    if (!claimed) return { sent: false, duplicate: true, blocked_reason: "DUPLICATE" };

    try {
      const sent = await this.transport.send({ to: input.to, message: input.message });
      await this.repository.finishLinqOutbound(input.idempotency_key, "sent");
      await this.repository.saveConversation({
        chat_id: conversation.chat_id,
        customer_id: conversation.customer_id,
        phase: conversation.phase,
        outbound_at: new Date().toISOString(),
      });
      return { sent: true, duplicate: false, provider_message_id: sent.message_id };
    } catch {
      await this.repository.finishLinqOutbound(input.idempotency_key, "failed");
      throw new ControlError("LINQ_SEND_FAILED", 502);
    }
  }
}

export function createRuntimeLinqOutboundDispatcher(
  repository: ControlRepository,
  options: { apiKey?: string; baseUrl?: string; fetcher?: Fetcher } = {},
): LinqOutboundDispatcher {
  const apiKey = options.apiKey ?? process.env.LINQ_API_V3_API_KEY;
  if (!apiKey) throw new ControlError("LINQ_API_KEY_NOT_CONFIGURED", 503);
  return new LinqOutboundDispatcher(
    repository,
    new LinqV3HttpTransport(
      apiKey,
      options.baseUrl ?? process.env.LINQ_API_BASE_URL ?? "https://api.linqapp.com/api/partner",
      options.fetcher,
    ),
  );
}

type CommonMessageInput = Omit<LinqOutboundRequest, "kind" | "message">;

export function dispatchConfirmation(
  dispatcher: LinqOutboundDispatcher,
  input: CommonMessageInput & { message: string },
): Promise<LinqOutboundResult> {
  return dispatcher.dispatch({ ...input, kind: "confirmation", message: input.message });
}

export function dispatchPaymentLink(
  dispatcher: LinqOutboundDispatcher,
  input: CommonMessageInput & { payment_link?: string },
): Promise<LinqOutboundResult> {
  return dispatcher.dispatch({
    ...input,
    kind: "payment",
    message: `Pay here to start: ${paymentLinkForJob(input.payment_link ?? process.env.STRIPE_PAYMENT_LINK_URL, input.job_id)}`,
  });
}

export function dispatchFinalReport(
  dispatcher: LinqOutboundDispatcher,
  input: CommonMessageInput & { report_url: string },
): Promise<LinqOutboundResult> {
  let reportUrl: URL;
  try {
    reportUrl = new URL(input.report_url);
  } catch {
    throw new ControlError("REPORT_URL_INVALID", 400);
  }
  if (reportUrl.protocol !== "https:") throw new ControlError("REPORT_URL_INVALID", 400);
  return dispatcher.dispatch({
    ...input,
    kind: "report",
    message: `Your PayBench report is ready: ${reportUrl.toString()}`,
  });
}
