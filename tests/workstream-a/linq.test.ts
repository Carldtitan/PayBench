import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { handleLinqWebhook, recordFinalReportDelivery } from "../../apps/web/src/server/control/linq";
import {
  dispatchConfirmation,
  dispatchFinalReport,
  dispatchPaymentLink,
  LinqOutboundDispatcher,
  LinqV3HttpTransport,
  type LinqOutboundTransport,
} from "../../apps/web/src/server/control/linq-outbound";
import { deliverReportToHealthyLinqChat } from "../../apps/web/src/server/control/linq-report";
import { MemoryControlRepository } from "../../apps/web/src/server/control/memory-repository";

const secretBytes = randomBytes(32);
const secret = `whsec_${secretBytes.toString("base64")}`;
const now = 1_787_000_000;
const resolver = async () => [{ address: "93.184.216.34", family: 4 }];

class RecordingLinqTransport implements LinqOutboundTransport {
  readonly sends: Array<{ to: string; message: string }> = [];

  async send(input: { to: string; message: string }) {
    this.sends.push(input);
    return { message_id: `message_${this.sends.length}`, chat_id: "chat_demo" };
  }
}

function signedMessage(id: string, text: string, health = "HEALTHY") {
  const body = JSON.stringify({
    type: "message.received",
    data: { chat_id: "chat_demo", chat: { health_status: { status: health } }, message: { text } },
  });
  const signature = createHmac("sha256", secretBytes).update(`${id}.${now}.${body}`).digest("base64");
  return { body, headers: { id, timestamp: String(now), signature: `v1,${signature}` } };
}

describe("Linq inbound conversation", () => {
  it("collects URL and target customer, confirms without a link, then returns the job-bound payment link", async () => {
    const repository = new MemoryControlRepository();
    const first = signedMessage("msg_1", "https://example.com/pricing");
    const askTarget = await handleLinqWebhook(first.body, first.headers, repository, { secret, resolver, paymentLink: "https://buy.stripe.com/paybench", nowSeconds: now });
    expect(askTarget.reply).toContain("target customer");

    const second = signedMessage("msg_2", "Operations leaders at small software companies.");
    const confirmation = await handleLinqWebhook(second.body, second.headers, repository, { secret, resolver, paymentLink: "https://buy.stripe.com/paybench", nowSeconds: now });
    expect(confirmation.reply).toContain("Reply YES");
    expect(confirmation.reply).not.toMatch(/https?:\/\//);

    const third = signedMessage("msg_3", "YES");
    const payment = await handleLinqWebhook(third.body, third.headers, repository, { secret, resolver, paymentLink: "https://buy.stripe.com/paybench", nowSeconds: now });
    expect(payment.reply).toContain("https://buy.stripe.com/");
    const conversation = await repository.getConversation("chat_demo");
    expect(conversation?.phase.name).toBe("awaiting_payment");
  });

  it("handles natural opt-outs and blocks reply intents on unhealthy chats", async () => {
    const optedOutRepository = new MemoryControlRepository();
    const stop = signedMessage("msg_stop", "Please stop messaging me");
    const stopped = await handleLinqWebhook(stop.body, stop.headers, optedOutRepository, { secret, resolver, nowSeconds: now });
    expect(stopped).toMatchObject({ reply: null, reply_blocked_reason: "OPTED_OUT" });

    const criticalRepository = new MemoryControlRepository();
    const critical = signedMessage("msg_critical", "https://example.com/pricing", "CRITICAL");
    const blocked = await handleLinqWebhook(critical.body, critical.headers, criticalRepository, { secret, resolver, nowSeconds: now });
    expect(blocked).toMatchObject({ reply: null, reply_blocked_reason: "CHAT_CRITICAL" });
  });

  it("keeps an opted-out conversation suppressed after every later inbound message", async () => {
    const repository = new MemoryControlRepository();
    const stop = signedMessage("msg_stop_permanent", "Please stop messaging me");
    await handleLinqWebhook(stop.body, stop.headers, repository, { secret, resolver, nowSeconds: now });

    const later = signedMessage("msg_after_stop", "https://example.com/pricing Operations leaders at small software companies.");
    const result = await handleLinqWebhook(later.body, later.headers, repository, { secret, resolver, nowSeconds: now });

    expect(result).toMatchObject({
      duplicate: false,
      reply: null,
      reply_blocked_reason: "OPTED_OUT",
      phase: "opted_out",
    });
    expect((await repository.getConversation("chat_demo"))?.phase.name).toBe("opted_out");
    expect(repository.jobs.size).toBe(0);
  });

  it("is idempotent and records final delivery without sending", async () => {
    const repository = new MemoryControlRepository();
    const inbound = signedMessage("msg_once", "https://example.com/pricing");
    await handleLinqWebhook(inbound.body, inbound.headers, repository, { secret, resolver, nowSeconds: now });
    expect((await handleLinqWebhook(inbound.body, inbound.headers, repository, { secret, resolver, nowSeconds: now })).duplicate).toBe(true);

    const job = await repository.createJob({ website_url: "https://example.com/", target_customer_description: "Operations leaders at small software companies.", initial_status: "awaiting_payment" });
    await recordFinalReportDelivery(repository, { chat_id: "chat_demo", job_id: job.id, delivered_at: "2026-08-15T20:00:00.000Z" });
    expect((await repository.getJob(job.id))?.status).toBe("delivered");
    expect((await repository.getConversation("chat_demo"))?.phase.name).toBe("report_delivered");
  });
});

describe("Linq outbound dispatcher", () => {
  async function setup() {
    const repository = new MemoryControlRepository();
    const job = await repository.createJob({
      website_url: "https://example.com/",
      target_customer_description: "Operations leaders at small software companies.",
      initial_status: "awaiting_confirmation",
    });
    await repository.saveConversation({
      chat_id: "chat_demo",
      customer_id: job.customer_id,
      phase: { name: "awaiting_confirmation", job_id: job.id },
    });
    const transport = new RecordingLinqTransport();
    return { repository, job, transport, dispatcher: new LinqOutboundDispatcher(repository, transport) };
  }

  it("sends a healthy confirmation once and suppresses the same idempotency key", async () => {
    const { job, transport, dispatcher } = await setup();
    const request = {
      job_id: job.id,
      chat_id: "chat_demo",
      to: "+14155551234",
      idempotency_key: "confirmation:job-1",
      message: "I found the page. Reply YES to continue.",
      chat_health: "HEALTHY" as const,
      line_reputation: "HEALTHY" as const,
    };

    await expect(dispatchConfirmation(dispatcher, request)).resolves.toMatchObject({ sent: true });
    await expect(dispatchConfirmation(dispatcher, request)).resolves.toEqual({
      sent: false,
      duplicate: true,
      blocked_reason: "DUPLICATE",
    });
    expect(transport.sends).toHaveLength(1);
    expect(transport.sends[0]?.message).not.toMatch(/https?:\/\//);
  });

  it("blocks stored opt-outs, unhealthy chats, and unhealthy lines before transport", async () => {
    const { repository, job, transport, dispatcher } = await setup();
    const base = {
      job_id: job.id,
      chat_id: "chat_demo",
      to: "+14155551234",
      message: "I found the page. Reply YES to continue.",
      line_reputation: "HEALTHY" as const,
    };
    await expect(dispatchConfirmation(dispatcher, { ...base, idempotency_key: "chat-risk", chat_health: "AT_RISK" })).resolves.toMatchObject({ sent: false, blocked_reason: "CHAT_AT_RISK" });
    await expect(dispatchConfirmation(dispatcher, { ...base, idempotency_key: "line-risk", chat_health: "HEALTHY", line_reputation: "CRITICAL" })).resolves.toMatchObject({ sent: false, blocked_reason: "LINE_CRITICAL" });

    await repository.saveConversation({ chat_id: "chat_demo", customer_id: job.customer_id, phase: { name: "opted_out" } });
    await expect(dispatchConfirmation(dispatcher, { ...base, idempotency_key: "stored-stop", chat_health: "HEALTHY" })).resolves.toMatchObject({ sent: false, blocked_reason: "OPTED_OUT" });
    expect(transport.sends).toHaveLength(0);
  });

  it("builds payment and report messages through the same guarded recorder", async () => {
    const { job, transport, dispatcher } = await setup();
    const common = {
      job_id: job.id,
      chat_id: "chat_demo",
      to: "+14155551234",
      chat_health: "HEALTHY" as const,
      line_reputation: "HEALTHY" as const,
    };
    await dispatchPaymentLink(dispatcher, { ...common, idempotency_key: "payment:job-1", payment_link: "https://buy.stripe.com/demo" });
    await dispatchFinalReport(dispatcher, { ...common, idempotency_key: "report:job-1", report_url: "https://paybench.example/report/demo" });

    expect(transport.sends).toHaveLength(2);
    expect(transport.sends[0]?.message).toContain(`client_reference_id=${job.id}`);
    expect(transport.sends[1]?.message).toContain("https://paybench.example/report/demo");
  });

  it("uses Linq V3 messages.create HTTP semantics without a from field", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ chat_id: "chat_demo", message: { id: "message_demo" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const transport = new LinqV3HttpTransport("test_api_key", "https://api.linqapp.com/api/partner", fetcher);
    await expect(transport.send({ to: "+14155551234", message: "Hello" })).resolves.toEqual({ message_id: "message_demo", chat_id: "chat_demo" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.linqapp.com/api/partner/v3/messages");
    const body = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ to: ["+14155551234"], message: { parts: [{ type: "text", value: "Hello" }] } });
    expect(body).not.toHaveProperty("from");
  });

  it("accepts the configured Linq base URL when it already ends in v3", async () => {
    const urls: string[] = [];
    const transport = new LinqV3HttpTransport(
      "test_api_key",
      "https://api.linqapp.com/api/partner/v3",
      async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ message: { id: "message_demo" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    await transport.send({ to: "+14155551234", message: "Hello" });
    expect(urls).toEqual(["https://api.linqapp.com/api/partner/v3/messages"]);
  });
});

describe("Linq final report delivery", () => {
  function client(chatHealth: "HEALTHY" | "AT_RISK" = "HEALTHY", lineHealth: "HEALTHY" | "CRITICAL" = "HEALTHY") {
    const sends: string[] = [];
    return {
      sends,
      value: {
        chats: {
          retrieve: async () => ({ health_status: { status: chatHealth }, handles: [{ handle: "+14155550199", is_me: true }] }),
          messages: {
            send: async (_chatId: string, body: { message: { parts: Array<{ value: string }> } }) => {
              sends.push(body.message.parts[0]!.value);
              return { message: { id: "message_report" } };
            },
          },
        },
        phoneNumbers: {
          list: async () => ({ phone_numbers: [{ phone_number: "+14155550199", reputation: { status: lineHealth } }] }),
        },
      },
    };
  }

  it("sends one report into the existing healthy inbound chat", async () => {
    const fake = client();
    await expect(deliverReportToHealthyLinqChat("chat_demo", "https://paybench.example/report/token", fake.value)).resolves.toEqual({
      status: "sent",
      provider_message_id: "message_report",
    });
    expect(fake.sends).toEqual(["Your PayBench report is ready: https://paybench.example/report/token"]);
  });

  it("blocks report delivery before transport when chat or line is unhealthy", async () => {
    const chatRisk = client("AT_RISK");
    const lineRisk = client("HEALTHY", "CRITICAL");
    await expect(deliverReportToHealthyLinqChat("chat_demo", "https://paybench.example/report/token", chatRisk.value)).resolves.toEqual({ status: "blocked", reason: "CHAT_AT_RISK" });
    await expect(deliverReportToHealthyLinqChat("chat_demo", "https://paybench.example/report/token", lineRisk.value)).resolves.toEqual({ status: "blocked", reason: "LINE_CRITICAL" });
    expect(chatRisk.sends).toHaveLength(0);
    expect(lineRisk.sends).toHaveLength(0);
  });
});
