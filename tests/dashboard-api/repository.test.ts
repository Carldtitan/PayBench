import {
  dashboardRunEventSchema,
  dashboardRunSnapshotSchema,
} from "@paybench/contracts";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SESSION_COOKIE,
  dashboardSessionToken,
  isDashboardRequestAuthorized,
} from "../../apps/web/src/server/dashboard/auth";
import { DemoDashboardRepository } from "../../apps/web/src/server/dashboard/demo-repository";

describe("DemoDashboardRepository", () => {
  it("returns exactly three contract-valid demo snapshots", async () => {
    const repository = new DemoDashboardRepository();
    const runs = await repository.listRuns();

    expect(runs).toHaveLength(3);
    for (const item of runs) {
      const snapshot = await repository.getRun(item.job_id);
      expect(dashboardRunSnapshotSchema.safeParse(snapshot).success).toBe(true);
      expect(snapshot?.source).toBe("demo");
    }
  });

  it("includes the active, scout-blocked, and Replay-failed states", async () => {
    const repository = new DemoDashboardRepository();
    const snapshots = await Promise.all(
      (await repository.listRuns()).map((run) => repository.getRun(run.job_id)),
    );

    expect(snapshots.some((run) => run?.job_status === "testing" && run.paid)).toBe(true);
    expect(
      snapshots.some(
        (run) =>
          run?.job_status === "needs_scout" &&
          run.blocker?.code === "SCOUT_REQUIRED",
      ),
    ).toBe(true);
    expect(
      snapshots.some(
        (run) =>
          run?.job_status === "failed" && run.replay.status === "failed",
      ),
    ).toBe(true);
  });

  it("returns only allow-listed short event summaries", async () => {
    const repository = new DemoDashboardRepository();
    const forbidden = /(PB-(?:SCOUT-)?|card number|phone number|survey response)/i;

    for (const run of await repository.listRuns()) {
      const events = await repository.listEvents(run.job_id);
      expect(events).not.toBeNull();
      for (const event of events ?? []) {
        expect(dashboardRunEventSchema.safeParse(event).success).toBe(true);
        expect(event.summary.length).toBeLessThanOrEqual(120);
        expect(event.summary).not.toMatch(forbidden);
      }
    }
  });

  it("returns null for an unknown run", async () => {
    const repository = new DemoDashboardRepository();
    expect(
      await repository.getRun("a93c6bf4-ac47-40d4-bc39-68bed39ad588"),
    ).toBeNull();
    expect(
      await repository.listEvents("a93c6bf4-ac47-40d4-bc39-68bed39ad588"),
    ).toBeNull();
  });
});

describe("dashboard request authorization", () => {
  it("accepts the operator key as a Bearer credential", async () => {
    process.env.DASHBOARD_ACCESS_KEY = "test-dashboard-key";
    const request = new Request("https://paybench.example/api/admin/runs", {
      headers: { Authorization: "Bearer test-dashboard-key" },
    });

    expect(await isDashboardRequestAuthorized(request)).toBe(true);
  });

  it("accepts the derived HttpOnly-session value and rejects a wrong key", async () => {
    process.env.DASHBOARD_ACCESS_KEY = "test-dashboard-key";
    const session = await dashboardSessionToken("test-dashboard-key");
    const cookieRequest = new Request("https://paybench.example/admin", {
      headers: { Cookie: `${DASHBOARD_SESSION_COOKIE}=${session}` },
    });
    const wrongBearer = new Request("https://paybench.example/api/admin/runs", {
      headers: { Authorization: "Bearer wrong-key" },
    });

    expect(await isDashboardRequestAuthorized(cookieRequest)).toBe(true);
    expect(await isDashboardRequestAuthorized(wrongBearer)).toBe(false);
  });
});
