import { createHmac, timingSafeEqual } from "node:crypto";

import type { ControlRepository } from "./types";
import { ControlError } from "./types";

interface StripeCheckoutSession {
  id?: unknown;
  client_reference_id?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  payment_status?: unknown;
  mode?: unknown;
}

interface StripeEvent {
  id?: unknown;
  type?: unknown;
  data?: { object?: StripeCheckoutSession };
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!secret || !signatureHeader) throw new ControlError("STRIPE_SIGNATURE_MISSING", 400);
  const values = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = values.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = values.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const timestampNumber = Number(timestamp);
  if (!timestamp || !Number.isInteger(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > 300) {
    throw new ControlError("STRIPE_SIGNATURE_EXPIRED", 400);
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  if (!signatures.some((signature) => safeEqualHex(signature, expected))) {
    throw new ControlError("STRIPE_SIGNATURE_INVALID", 400);
  }
}

function checkoutSession(event: StripeEvent): {
  id: string;
  jobId: string;
  amount: 2000;
  currency: "USD";
  paymentStatus: string;
} {
  const session = event.data?.object;
  if (
    !session ||
    typeof session.id !== "string" ||
    typeof session.client_reference_id !== "string" ||
    typeof session.payment_status !== "string"
  ) {
    throw new ControlError("STRIPE_SESSION_INVALID", 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(session.client_reference_id)) {
    throw new ControlError("STRIPE_JOB_REFERENCE_INVALID", 400);
  }
  if (session.amount_total !== 2000) throw new ControlError("STRIPE_AMOUNT_MISMATCH", 400);
  if (String(session.currency).toLowerCase() !== "usd") throw new ControlError("STRIPE_CURRENCY_MISMATCH", 400);
  if (session.mode !== undefined && session.mode !== "payment") throw new ControlError("STRIPE_MODE_MISMATCH", 400);
  return {
    id: session.id,
    jobId: session.client_reference_id,
    amount: 2000,
    currency: "USD",
    paymentStatus: session.payment_status,
  };
}

export interface StripeWebhookResult {
  duplicate: boolean;
  action: "capture_queued" | "awaiting_async_payment" | "payment_failed" | "ignored";
}

export async function handleStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  repository: ControlRepository,
  environment: Record<string, string | undefined> = process.env,
  nowSeconds?: number,
): Promise<StripeWebhookResult> {
  verifyStripeSignature(rawBody, signatureHeader, environment.STRIPE_WEBHOOK_SECRET, nowSeconds);
  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    throw new ControlError("STRIPE_EVENT_INVALID", 400);
  }
  if (typeof event.id !== "string" || typeof event.type !== "string") {
    throw new ControlError("STRIPE_EVENT_INVALID", 400);
  }

  const supported = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ].includes(event.type);
  if (!supported) return { duplicate: false, action: "ignored" };

  if (!(await repository.claimWebhook("stripe", event.id))) {
    return { duplicate: true, action: "ignored" };
  }

  try {
    const session = checkoutSession(event);
    const job = await repository.getJob(session.jobId);
    if (!job) throw new ControlError("STRIPE_JOB_NOT_FOUND", 400);
    if (!['awaiting_payment', 'paid'].includes(job.status)) {
      throw new ControlError("STRIPE_JOB_STATUS_MISMATCH", 400);
    }

    if (event.type === "checkout.session.async_payment_failed") {
      if (session.paymentStatus !== "unpaid") throw new ControlError("STRIPE_PAYMENT_STATUS_MISMATCH", 400);
      await repository.markPaymentFailed(session.jobId);
      await repository.finishWebhook("stripe", event.id, "processed");
      return { duplicate: false, action: "payment_failed" };
    }

    if (event.type === "checkout.session.completed" && session.paymentStatus === "unpaid") {
      await repository.finishWebhook("stripe", event.id, "processed");
      return { duplicate: false, action: "awaiting_async_payment" };
    }
    if (session.paymentStatus !== "paid") throw new ControlError("STRIPE_PAYMENT_STATUS_MISMATCH", 400);

    const fulfillment = await repository.confirmPaymentAndEnqueueCapture({
      job_id: session.jobId,
      checkout_session_id: session.id,
      amount_paid_cents: session.amount,
      currency: session.currency,
    });
    await repository.finishWebhook("stripe", event.id, "processed");
    return {
      duplicate: false,
      action: fulfillment.capture_enqueued ? "capture_queued" : "ignored",
    };
  } catch (error) {
    await repository.finishWebhook("stripe", event.id, "failed");
    throw error;
  }
}
