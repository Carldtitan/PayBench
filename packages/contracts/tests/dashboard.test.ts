import { describe, expect, it } from "vitest";
import { dashboardRunEventSchema, dashboardRunSnapshotSchema } from "../src";

const stages = [
  "intake",
  "payment",
  "capture",
  "variants",
  "study",
  "replay",
  "report",
  "delivery",
] as const;

describe("dashboard contract", () => {
  it("accepts one complete safe snapshot", () => {
    const now = "2026-08-15T20:00:00.000Z";
    const result = dashboardRunSnapshotSchema.safeParse({
      contract_version: "1",
      job_id: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
      founder_label: "Acme",
      website_url: "https://example.com/pricing",
      job_status: "replay_qa",
      source: "demo",
      paid: true,
      amount_paid_cents: 2000,
      currency: "USD",
      current_stage: "replay",
      next_action: "Finish Replay checks",
      stages: stages.map((id, index) => ({
        id,
        status: index < 5 ? "complete" : index === 5 ? "running" : "waiting",
        actor: ["paybench", "stripe", "superserve", "superserve", "terac", "replay", "paybench", "linq"][index],
        label: id,
      })),
      sandboxes: [],
      study: { target: 20, valid: 20, a_valid: 10, b_valid: 10, flagged: 1, rejected: 1, technical_failures: 0 },
      replay: { status: "checking", completed_checks: 6, total_checks: 8, blocking_findings: 0 },
      artifacts: [],
      updated_at: now,
    });

    expect(result.success).toBe(true);
  });

  it("rejects verbose or unsafe event summaries", () => {
    const result = dashboardRunEventSchema.safeParse({
      event_id: "77312510-44d4-44bf-b37f-bb66301bcdf1",
      job_id: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
      stage: "capture",
      status: "running",
      actor: "superserve",
      summary: "x".repeat(121),
      occurred_at: "2026-08-15T20:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});
