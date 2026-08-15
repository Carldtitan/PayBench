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
import {
  createDashboardRepository,
  DemoDashboardRepository,
} from "../../apps/web/src/server/dashboard/demo-repository";
import {
  SupabaseDashboardRepository,
  type DashboardTableTransport,
} from "../../apps/web/src/server/dashboard/supabase-repository";

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

class MemoryDashboardTransport implements DashboardTableTransport {
  constructor(private readonly tables: Record<string, readonly unknown[]>) {}

  async select(table: string): Promise<readonly unknown[]> {
    return this.tables[table] ?? [];
  }
}

describe("dashboard repository selection", () => {
  it("uses Supabase when both server credentials exist", () => {
    const repository = createDashboardRepository(
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "server-only-key",
      },
      new MemoryDashboardTransport({}),
    );
    expect(repository).toBeInstanceOf(SupabaseDashboardRepository);
  });

  it("honors explicit demo mode and falls back visibly when credentials are absent", () => {
    expect(
      createDashboardRepository({
        DASHBOARD_DATA_SOURCE: "demo",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "server-only-key",
      }),
    ).toBeInstanceOf(DemoDashboardRepository);
    expect(createDashboardRepository({})).toBeInstanceOf(
      DemoDashboardRepository,
    );
  });
});

describe("SupabaseDashboardRepository", () => {
  it("projects safe aggregates and never returns raw sensitive fields", async () => {
    const jobId = "02eb2619-c2ca-4a53-a27a-e401b141e50e";
    const studyId = "4bc402bf-dd2c-4932-b33a-8718239bf9a9";
    const variantA = "ee1d29f9-e9bf-4dd7-a0a2-dcbcae78fd07";
    const variantB = "6f034752-654b-4c14-9332-aae332fb82ec";
    const transport = new MemoryDashboardTransport({
      jobs: [
        {
          id: jobId,
          submitted_url: "https://acme.example/pricing",
          status: "testing",
          payment_status: "paid",
          updated_at: "2026-08-15T20:30:00.000Z",
          phone_number: "+1 555 0100",
          stripe_checkout_session_id: "cs_secret_value",
        },
      ],
      job_transitions: [
        {
          id: "5f693458-2e65-4bdf-b996-98349569a4d7",
          job_id: jobId,
          to_status: "testing",
          stage: "study",
          actor: "terac",
          reason_code: "unknown_external_reason",
          safe_summary: "Call +1 555 0100 and use card 4242",
          occurred_at: "2026-08-15T20:29:00.000Z",
        },
      ],
      agent_runs: [
        {
          id: "e7640030-5772-44e8-91fe-d23a6f0d3b9a",
          job_id: jobId,
          stage: "variants",
          status: "completed",
          started_at: "2026-08-15T20:20:00.000Z",
          completed_at: "2026-08-15T20:25:00.000Z",
          safe_progress_json: {
            sandboxes: [
              {
                variant: "A",
                sandbox_id: "sandbox-safe-a",
                status: "ready",
                task: "Control paywall ready",
                last_activity_at: "2026-08-15T20:25:00.000Z",
                shell_secret: "must-not-leak",
              },
            ],
            raw_survey_text: "must-not-leak",
          },
          output_artifact_path: `jobs/${jobId}/variants/manifest-v1.json`,
        },
      ],
      studies: [
        {
          id: studyId,
          job_id: jobId,
          target_sample_size: 20,
          status: "running",
          started_at: "2026-08-15T20:26:00.000Z",
        },
      ],
      participant_sessions: [
        {
          id: "session-raw-id",
          study_id: studyId,
          assigned_variant_id: variantA,
          quality_status: "valid",
          confirmation_code_hash: "must-not-leak",
          survey_free_text: "must-not-leak",
        },
        {
          id: "session-raw-id-2",
          study_id: studyId,
          assigned_variant_id: variantB,
          quality_status: "technical_failure",
        },
      ],
      variants: [
        {
          id: variantA,
          job_id: jobId,
          label: "A",
          screenshot_path: `jobs/${jobId}/variants/a.png`,
          preview_path: "https://unsafe.example/permanent",
        },
        { id: variantB, job_id: jobId, label: "B" },
      ],
      reports: [
        {
          id: "report-id",
          job_id: jobId,
          report_path: `jobs/${jobId}/reports/final.html`,
          public_token_hash: "must-not-leak",
        },
      ],
      website_captures: [
        {
          id: "capture-id",
          job_id: jobId,
          desktop_screenshot_path: `jobs/${jobId}/capture/desktop.png`,
          mobile_screenshot_path: "../private.env",
          captured_at: "2026-08-15T20:18:00.000Z",
        },
      ],
    });
    const repository = new SupabaseDashboardRepository(transport);

    const snapshot = await repository.getRun(jobId);
    expect(snapshot?.source).toBe("live");
    expect(snapshot?.paid).toBe(true);
    expect(snapshot?.study).toEqual({
      target: 20,
      valid: 1,
      a_valid: 1,
      b_valid: 0,
      flagged: 0,
      rejected: 0,
      technical_failures: 1,
    });
    expect(snapshot?.sandboxes).toHaveLength(1);
    expect(snapshot?.artifacts.map((item) => item.object_path)).toEqual([
      `jobs/${jobId}/capture/desktop.png`,
      `jobs/${jobId}/variants/a.png`,
      `jobs/${jobId}/reports/final.html`,
    ]);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(
      /555 0100|cs_secret|must-not-leak|confirmation_code|survey_free_text|private\.env/,
    );
    const events = await repository.listEvents(jobId);
    expect(events?.some((event) => event.summary === "Run status changed")).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toContain("4242");
  });
});
