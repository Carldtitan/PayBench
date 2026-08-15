import { describe, expect, it } from "vitest";
import {
  LinqStatusAdapter,
  ReplayStatusAdapter,
  StripeStatusAdapter,
  SuperserveStatusAdapter,
  TeracStatusAdapter,
  createDemoSponsorStatusAdapters,
} from "../../apps/web/src/server/integrations";

const JOB_ID = "63ca958e-3ad5-4f07-9f76-950da5587a1a";
const NOW = new Date("2026-08-15T20:00:00.000Z");
const clock = () => NOW;

describe("sponsor status adapters", () => {
  it("marks every demo read and returns exactly A and B", async () => {
    const adapters = createDemoSponsorStatusAdapters(clock);
    const [superserve, replay, stripe, terac, linq] = await Promise.all([
      adapters.superserve.read(JOB_ID),
      adapters.replay.read(JOB_ID),
      adapters.stripe.read(JOB_ID),
      adapters.terac.read(JOB_ID),
      adapters.linq.read(JOB_ID),
    ]);

    expect([superserve, replay, stripe, terac, linq].every((read) => read.source === "demo")).toBe(true);
    expect(superserve.state.map((view) => view.variant)).toEqual(["A", "B"]);
    expect(superserve.state).toHaveLength(2);
  });

  it("removes expired and unsafe Superserve URLs and never exposes source extras", async () => {
    const adapter = new SuperserveStatusAdapter(
      {
        async readViews() {
          return [
            {
              variant: "A" as const,
              sandbox_id: "a",
              status: "ready" as const,
              task: "Ready",
              viewer: { url: "https://example.com/a", expires_at: "2026-08-15T19:59:59.000Z" },
              preview: { url: "http://example.com/a", expires_at: "2026-08-15T20:05:00.000Z" },
              latest_frame: { url: "https://example.com/a.png", expires_at: "2026-08-15T20:05:00.000Z" },
              last_activity_at: NOW.toISOString(),
              shell_url: "https://example.com/shell",
              api_key: "secret",
            },
            {
              variant: "B" as const,
              sandbox_id: "b",
              status: "paused" as const,
              task: "Paused",
              last_activity_at: NOW.toISOString(),
            },
          ];
        },
      },
      "live",
      clock,
    );

    const result = await adapter.read(JOB_ID);
    const a = result.state[0] as Record<string, unknown>;

    expect(a.viewer_url).toBeUndefined();
    expect(a.preview_url).toBeUndefined();
    expect(a.latest_frame_url).toBe("https://example.com/a.png");
    expect(a.shell_url).toBeUndefined();
    expect(a.api_key).toBeUndefined();
  });

  it("requires one Superserve view for each variant", async () => {
    const adapter = new SuperserveStatusAdapter(
      {
        async readViews() {
          return [
            { variant: "A", sandbox_id: "a", status: "ready", task: "A", last_activity_at: NOW.toISOString() },
            { variant: "A", sandbox_id: "a2", status: "ready", task: "A2", last_activity_at: NOW.toISOString() },
          ];
        },
      },
      "live",
      clock,
    );

    await expect(adapter.read(JOB_ID)).rejects.toMatchObject({ code: "SUPERSERVE_REQUIRES_A_AND_B" });
  });

  it("returns Replay checks and removes an expired run URL", async () => {
    const adapter = new ReplayStatusAdapter(
      {
        async readReplay() {
          return {
            status: "checking",
            current_journey: "Stop decision",
            completed_checks: 2,
            total_checks: 4,
            blocking_findings: 1,
            run: { url: "https://app.replay.io/run", expires_at: "2026-08-15T19:00:00.000Z" },
            last_activity_at: NOW.toISOString(),
          };
        },
      },
      "live",
      clock,
    );

    const result = await adapter.read(JOB_ID);
    expect(result.state).toMatchObject({ current_journey: "Stop decision", completed_checks: 2, total_checks: 4, blocking_findings: 1 });
    expect(result.state.run_url).toBeUndefined();
  });

  it("limits Stripe, Terac, and Linq projections to safe fields", async () => {
    const stripe = new StripeStatusAdapter(
      { async readPayment() { return { paid: true, amount_paid_cents: 2000, currency: "usd", customer_email: "hidden@example.com" }; } },
      "live",
      clock,
    );
    const terac = new TeracStatusAdapter(
      { async readStudy() { return { target: 20, valid: 10, a_valid: 5, b_valid: 5, flagged: 1, rejected: 2, technical_failures: 1, worker_id: "hidden", active_assignment: "A" }; } },
      "live",
      clock,
    );
    const linq = new LinqStatusAdapter(
      { async readDelivery() { return { status: "complete", timestamp: NOW.toISOString(), phone_number: "+15555555555" }; } },
      "live",
      clock,
    );

    const [payment, study, delivery] = await Promise.all([
      stripe.read(JOB_ID),
      terac.read(JOB_ID),
      linq.read(JOB_ID),
    ]);

    expect(Object.keys(payment.state).sort()).toEqual(["amount_paid_cents", "currency", "paid"]);
    expect(Object.keys(study.state).sort()).toEqual(["a_valid", "b_valid", "flagged", "rejected", "target", "technical_failures", "valid"]);
    expect(Object.keys(delivery.state).sort()).toEqual(["status", "timestamp"]);
  });
});
