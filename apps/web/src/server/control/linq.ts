import { createHmac, timingSafeEqual } from "node:crypto";
import Linq from "@linqapp/sdk";

import type { HostResolver } from "./url";
import { validatePublicWebsiteUrl, validateTargetCustomerDescription } from "./url";
import { paymentLinkForJob } from "./payment-link";
import type { ControlConversation, ControlRepository } from "./types";
import { ControlError } from "./types";

interface LinqWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

interface LinqWebhookResult {
  duplicate: boolean;
  reply: string | null;
  reply_blocked_reason?: string;
  phase?: string;
}

export interface LinqInboundReply {
  event_id: string;
  chat_id: string;
  message: string;
}

function safeEqualBase64(left: string, right: string): boolean {
  try {
    const leftBytes = Buffer.from(left, "base64");
    const rightBytes = Buffer.from(right, "base64");
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
  } catch {
    return false;
  }
}

export function verifyLinqWebhook(
  rawBody: string,
  headers: LinqWebhookHeaders,
  secret: string | undefined,
  nowSeconds?: number,
): void {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) {
    throw new ControlError("LINQ_SIGNATURE_MISSING", 400);
  }
  if (nowSeconds === undefined) {
    try {
      const client = new Linq({ apiKey: process.env.LINQ_API_V3_API_KEY ?? "webhook-verifier" });
      client.webhooks.unwrap(rawBody, {
        headers: {
          "webhook-id": headers.id,
          "webhook-timestamp": headers.timestamp,
          "webhook-signature": headers.signature,
        },
        key: secret,
      });
      return;
    } catch {
      throw new ControlError("LINQ_SIGNATURE_INVALID", 400);
    }
  }
  const timestamp = Number(headers.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) {
    throw new ControlError("LINQ_SIGNATURE_EXPIRED", 400);
  }
  const secretValue = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretValue, "base64");
  } catch {
    throw new ControlError("LINQ_WEBHOOK_SECRET_INVALID", 503);
  }
  if (key.length < 16) throw new ControlError("LINQ_WEBHOOK_SECRET_INVALID", 503);
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`, "utf8")
    .digest("base64");
  const candidates = headers.signature
    .split(" ")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("v1,"))
    .map((value) => value.slice(3));
  if (!candidates.some((signature) => safeEqualBase64(signature, expected))) {
    throw new ControlError("LINQ_SIGNATURE_INVALID", 400);
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function eventText(payload: Record<string, unknown>): string | undefined {
  const data = object(payload.data);
  const message = object(data?.message ?? payload.message);
  const direct = firstString(message?.text, data?.text, payload.text);
  if (direct) return direct;
  const content = object(message?.message);
  const parts = Array.isArray(content?.parts) ? content.parts : Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map(object)
    .map((part) => firstString(part?.value, part?.text))
    .filter((value): value is string => Boolean(value))
    .join("\n") || undefined;
}

function eventChatId(payload: Record<string, unknown>): string | undefined {
  const data = object(payload.data);
  const chat = object(data?.chat ?? payload.chat);
  const message = object(data?.message ?? payload.message);
  return firstString(data?.chat_id, payload.chat_id, chat?.id, message?.chat_id);
}

function eventHealth(payload: Record<string, unknown>): string {
  const data = object(payload.data);
  const chat = object(data?.chat ?? payload.chat);
  const health = object(chat?.health_status ?? data?.health_status ?? payload.health_status);
  return firstString(health?.status, data?.health_status, payload.health_status)?.toUpperCase() ?? "UNKNOWN";
}

function isOptOut(text: string): boolean {
  const trimmed = text.trim();
  if (["STOP", "UNSUBSCRIBE", "OPTOUT", "CANCEL", "END", "QUIT"].includes(trimmed)) return true;
  if (/^opt[\s-]?out$/i.test(trimmed)) return true;
  return /(stop|quit) (texting|messaging|contacting) me|do not (text|message|contact) me|don't (text|message|contact) me|leave me alone|no more messages|take me off/i.test(trimmed);
}

function extractUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s<>"']+/i)?.[0];
}

function brandLabel(url: string): string {
  const label = new URL(url).hostname.replace(/^www\./, "").split(".")[0] ?? "the site";
  return label.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function healthyReply(reply: string, health: string, phase: string): LinqWebhookResult {
  if (health !== "HEALTHY") {
    return { duplicate: false, reply: null, reply_blocked_reason: `CHAT_${health}`, phase };
  }
  return { duplicate: false, reply, phase };
}

async function processInbound(
  text: string,
  chatId: string,
  health: string,
  repository: ControlRepository,
  resolver?: HostResolver,
  paymentLink?: string,
): Promise<LinqWebhookResult> {
  const now = new Date().toISOString();
  const existing = await repository.getConversation(chatId);

  if (isOptOut(text)) {
    await repository.saveConversation({
      chat_id: chatId,
      customer_id: existing?.customer_id,
      phase: { name: "opted_out" },
      inbound_at: now,
    });
    return { duplicate: false, reply: null, reply_blocked_reason: "OPTED_OUT", phase: "opted_out" };
  }

  const conversation: ControlConversation =
    existing ??
    (await repository.saveConversation({
      chat_id: chatId,
      phase: { name: "awaiting_url" },
      inbound_at: now,
    }));

  if (conversation.phase.name === "opted_out") {
    await repository.saveConversation({
      chat_id: chatId,
      customer_id: conversation.customer_id,
      phase: { name: "opted_out" },
      inbound_at: now,
    });
    return {
      duplicate: false,
      reply: null,
      reply_blocked_reason: "OPTED_OUT",
      phase: "opted_out",
    };
  }

  if (conversation.phase.name === "awaiting_target") {
    let target: string;
    try {
      target = validateTargetCustomerDescription(text);
    } catch {
      return healthyReply("Describe the target customer in one clear sentence.", health, "awaiting_target");
    }
    const job = await repository.createJob({
      website_url: conversation.phase.website_url,
      target_customer_description: target,
      initial_status: "awaiting_confirmation",
      customer_id: conversation.customer_id,
    });
    await repository.saveConversation({ chat_id: chatId, customer_id: conversation.customer_id, phase: { name: "awaiting_confirmation", job_id: job.id }, inbound_at: now, outbound_at: health === "HEALTHY" ? now : undefined });
    return healthyReply(`I found ${brandLabel(job.website_url)}. I can test it with people who match that customer for $20. Reply YES to continue.`, health, "awaiting_confirmation");
  }

  if (conversation.phase.name === "awaiting_confirmation") {
    if (text.trim().toUpperCase() !== "YES") {
      return healthyReply("Reply YES to continue, or send a different website.", health, "awaiting_confirmation");
    }
    await repository.setJobAwaitingPayment(conversation.phase.job_id);
    await repository.saveConversation({ chat_id: chatId, customer_id: conversation.customer_id, phase: { name: "awaiting_payment", job_id: conversation.phase.job_id }, inbound_at: now, outbound_at: health === "HEALTHY" ? now : undefined });
    return healthyReply(`Pay here to start: ${paymentLinkForJob(paymentLink ?? process.env.STRIPE_PAYMENT_LINK_URL, conversation.phase.job_id)}`, health, "awaiting_payment");
  }

  const submittedUrl = extractUrl(text);
  if (!submittedUrl) {
    return healthyReply("Send the public checkout or pricing page.", health, conversation.phase.name);
  }

  let websiteUrl: string;
  try {
    websiteUrl = await validatePublicWebsiteUrl(submittedUrl, resolver);
  } catch {
    return healthyReply("That page is not a public website. Send another URL.", health, "awaiting_url");
  }

  const remainder = text.replace(submittedUrl, " ").replace(/^\s*(for|target customer|audience)\s*[:=-]?\s*/i, "").trim();
  if (remainder.length < 20) {
    await repository.saveConversation({ chat_id: chatId, customer_id: conversation.customer_id, phase: { name: "awaiting_target", website_url: websiteUrl }, inbound_at: now, outbound_at: health === "HEALTHY" ? now : undefined });
    return healthyReply("Who should test this page? Describe the target customer.", health, "awaiting_target");
  }

  const target = validateTargetCustomerDescription(remainder);
  const job = await repository.createJob({ website_url: websiteUrl, target_customer_description: target, initial_status: "awaiting_confirmation", customer_id: conversation.customer_id });
  await repository.saveConversation({ chat_id: chatId, customer_id: conversation.customer_id, phase: { name: "awaiting_confirmation", job_id: job.id }, inbound_at: now, outbound_at: health === "HEALTHY" ? now : undefined });
  return healthyReply(`I found ${brandLabel(job.website_url)}. I can test it with people who match that customer for $20. Reply YES to continue.`, health, "awaiting_confirmation");
}

export async function handleLinqWebhook(
  rawBody: string,
  headers: LinqWebhookHeaders,
  repository: ControlRepository,
  options: {
    secret?: string;
    resolver?: HostResolver;
    paymentLink?: string;
    nowSeconds?: number;
    dispatchReply?: (reply: LinqInboundReply) => Promise<void>;
  } = {},
): Promise<LinqWebhookResult> {
  verifyLinqWebhook(rawBody, headers, options.secret ?? process.env.LINQ_WEBHOOK_SECRET, options.nowSeconds);
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    const row = object(parsed);
    if (!row) throw new Error("invalid");
    payload = row;
  } catch {
    throw new ControlError("LINQ_EVENT_INVALID", 400);
  }

  if (!headers.id) throw new ControlError("LINQ_EVENT_INVALID", 400);
  if (!(await repository.claimWebhook("linq", headers.id))) {
    return { duplicate: true, reply: null };
  }

  try {
    const eventType = firstString(payload.type, payload.event_type);
    if (eventType !== "message.received") {
      await repository.finishWebhook("linq", headers.id, "processed");
      return { duplicate: false, reply: null };
    }
    const text = eventText(payload);
    const chatId = eventChatId(payload);
    if (!text || !chatId) throw new ControlError("LINQ_MESSAGE_INVALID", 400);
    const result = await processInbound(text, chatId, eventHealth(payload), repository, options.resolver, options.paymentLink);
    if (result.reply && options.dispatchReply) {
      await options.dispatchReply({
        event_id: headers.id,
        chat_id: chatId,
        message: result.reply,
      });
    }
    await repository.finishWebhook("linq", headers.id, "processed");
    return result;
  } catch (error) {
    await repository.finishWebhook("linq", headers.id, "failed");
    throw error;
  }
}

export async function recordFinalReportDelivery(
  repository: ControlRepository,
  input: { chat_id: string; job_id: string; delivered_at?: string },
): Promise<{ recorded: true }> {
  await repository.recordFinalReportDelivery({
    chat_id: input.chat_id,
    job_id: input.job_id,
    delivered_at: input.delivered_at ?? new Date().toISOString(),
  });
  return { recorded: true };
}
