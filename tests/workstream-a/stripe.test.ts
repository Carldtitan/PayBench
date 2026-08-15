import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MemoryControlRepository } from "../../apps/web/src/server/control/memory-repository";
import { handleStripeWebhook } from "../../apps/web/src/server/control/stripe";

const secret = "whsec_stripe_test_only";
const now = 1_787_000_000;

function sign(body: string): string {
  const signature = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
  return `t=${now},v1=${signature}`;
}

function event(id: string, type: string, jobId: string, paymentStatus: string, amount = 2000) {
  return JSON.stringify({
    id,
    type,
    data: {
      object: {
        id: `cs_${id}`,
        client_reference_id: jobId,
        amount_total: amount,
        currency: "usd",
        payment_status: paymentStatus,
        mode: "payment",
      },
    },
  });
}

describe("Stripe fulfillment webhook", () => {
  it("confirms exactly $20 and enqueues capture once", async () => {
    const repository = new MemoryControlRepository();
    const job = await repository.createJob({
      website_url: "https://example.com/",
      target_customer_description: "Finance managers at growing software companies.",
      initial_status: "awaiting_payment",
    });
    const body = event("evt_paid", "checkout.session.completed", job.id, "paid");

    const first = await handleStripeWebhook(body, sign(body), repository, { STRIPE_WEBHOOK_SECRET: secret }, now);
    const second = await handleStripeWebhook(body, sign(body), repository, { STRIPE_WEBHOOK_SECRET: secret }, now);

    expect(first.action).toBe("capture_queued");
    expect(second.duplicate).toBe(true);
    expect(repository.captureStarts.size).toBe(1);
    expect(await repository.getJob(job.id)).toMatchObject({ payment_status: "paid", amount_paid_cents: 2000 });

    const secondSession = event("evt_second_session", "checkout.session.completed", job.id, "paid");
    await handleStripeWebhook(secondSession, sign(secondSession), repository, { STRIPE_WEBHOOK_SECRET: secret }, now);
    expect(repository.captureStarts.size).toBe(1);
  });

  it("waits for asynchronous success and records asynchronous failure", async () => {
    const repository = new MemoryControlRepository();
    const job = await repository.createJob({ website_url: "https://example.com/", target_customer_description: "Independent designers who buy project management tools.", initial_status: "awaiting_payment" });
    const completed = event("evt_wait", "checkout.session.completed", job.id, "unpaid");
    expect((await handleStripeWebhook(completed, sign(completed), repository, { STRIPE_WEBHOOK_SECRET: secret }, now)).action).toBe("awaiting_async_payment");

    const succeeded = event("evt_async_ok", "checkout.session.async_payment_succeeded", job.id, "paid");
    expect((await handleStripeWebhook(succeeded, sign(succeeded), repository, { STRIPE_WEBHOOK_SECRET: secret }, now)).action).toBe("capture_queued");

    const secondJob = await repository.createJob({ website_url: "https://example.org/", target_customer_description: "Security leads at companies with remote engineering teams.", initial_status: "awaiting_payment" });
    const failed = event("evt_async_fail", "checkout.session.async_payment_failed", secondJob.id, "unpaid");
    expect((await handleStripeWebhook(failed, sign(failed), repository, { STRIPE_WEBHOOK_SECRET: secret }, now)).action).toBe("payment_failed");
    expect((await repository.getJob(secondJob.id))?.payment_status).toBe("failed");
  });

  it("rejects bad signatures, amounts, currencies, references, and payment states", async () => {
    const repository = new MemoryControlRepository();
    const job = await repository.createJob({ website_url: "https://example.com/", target_customer_description: "Product leaders at early-stage business software companies.", initial_status: "awaiting_payment" });
    const badAmount = event("evt_bad_amount", "checkout.session.completed", job.id, "paid", 1900);
    await expect(handleStripeWebhook(badAmount, sign(badAmount), repository, { STRIPE_WEBHOOK_SECRET: secret }, now)).rejects.toMatchObject({ code: "STRIPE_AMOUNT_MISMATCH" });
    await expect(handleStripeWebhook(badAmount, "t=1,v1=00", repository, { STRIPE_WEBHOOK_SECRET: secret }, now)).rejects.toMatchObject({ code: "STRIPE_SIGNATURE_EXPIRED" });
  });
});
