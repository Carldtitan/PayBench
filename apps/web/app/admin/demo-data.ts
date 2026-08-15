import type {
  DashboardRunEvent,
  DashboardRunListItem,
  DashboardRunSnapshot,
  DashboardStage,
} from "@paybench/contracts";

const stage = (
  id: DashboardStage["id"],
  label: string,
  actor: DashboardStage["actor"],
  status: DashboardStage["status"],
  detail?: string,
): DashboardStage => ({
  id,
  label,
  actor,
  status,
  detail,
  ...(status === "complete" ? { completed_at: "2026-08-15T20:44:00.000Z" } : {}),
  ...(status === "running" ? { started_at: "2026-08-15T21:31:00.000Z" } : {}),
});

const activeStages: DashboardStage[] = [
  stage("intake", "URL received", "linq", "complete"),
  stage("payment", "$20 confirmed", "stripe", "complete"),
  stage("capture", "Source captured", "superserve", "complete"),
  stage("variants", "A + B ready", "superserve", "complete"),
  stage("replay", "Checkout journeys", "replay", "complete", "12 of 12 · no blockers"),
  stage("study", "Pilot release", "terac", "waiting", "0 of 2"),
  stage("report", "Direction report", "paybench", "waiting"),
  stage("delivery", "Founder delivery", "linq", "waiting"),
];

const active: DashboardRunSnapshot = {
  contract_version: "1",
  job_id: "7c59d21a-9ef0-45f3-8958-b8b20f1d84c0",
  founder_label: "Northstar Labs",
  website_url: "https://example.com/pricing",
  job_status: "testing",
  source: "demo",
  paid: true,
  amount_paid_cents: 2000,
  currency: "usd",
  current_stage: "study",
  next_action: "Approve pages and Terac quote",
  stages: activeStages,
  sandboxes: [
    {
      variant: "A",
      sandbox_id: "ss_demo_a",
      status: "ready",
      task: "Reproduce source paywall",
      last_activity_at: "2026-08-15T21:34:00.000Z",
    },
    {
      variant: "B",
      sandbox_id: "ss_demo_b",
      status: "validating",
      task: "Validate clearer annual price",
      last_activity_at: "2026-08-15T21:35:00.000Z",
    },
  ],
  study: {
    target: 10,
    valid: 0,
    a_valid: 0,
    b_valid: 0,
    flagged: 0,
    rejected: 0,
    technical_failures: 0,
  },
  replay: {
    status: "passed",
    current_journey: "All journeys passed",
    completed_checks: 12,
    total_checks: 12,
    blocking_findings: 0,
    last_activity_at: "2026-08-15T21:36:00.000Z",
  },
  artifacts: [
    { kind: "capture", label: "Source capture", object_path: "jobs/demo/capture/source-v1.png", created_at: "2026-08-15T20:49:00.000Z" },
    { kind: "spec", label: "Paywall spec", object_path: "jobs/demo/spec/paywall-v1.json", created_at: "2026-08-15T20:53:00.000Z" },
    { kind: "variant_a", label: "Control A", object_path: "jobs/demo/variants/a/index.html", created_at: "2026-08-15T21:02:00.000Z" },
    { kind: "variant_b", label: "Challenger B", object_path: "jobs/demo/variants/b/index.html", created_at: "2026-08-15T21:04:00.000Z" },
    { kind: "metrics", label: "Study metrics", object_path: "jobs/demo/analysis/metrics-v1.json", created_at: "2026-08-15T21:29:00.000Z" },
  ],
  updated_at: "2026-08-15T21:36:00.000Z",
};

const scout: DashboardRunSnapshot = {
  ...active,
  job_id: "03a16b13-9ee4-4d4c-a40b-8b8b133fdcc1",
  founder_label: "Ledgerline",
  website_url: "https://example.org/upgrade",
  job_status: "needs_scout",
  current_stage: "capture",
  blocker: { code: "SCOUT_REQUIRED", label: "Paywall needs a signed-in path" },
  next_action: "Wait for Terac scout evidence",
  stages: [
    stage("intake", "URL received", "linq", "complete"),
    stage("payment", "$20 confirmed", "stripe", "complete"),
    stage("capture", "Scout evidence", "terac", "blocked", "Signed-in path required"),
    stage("variants", "A + B", "superserve", "waiting"),
    stage("replay", "Checkout journeys", "replay", "waiting"),
    stage("study", "End-user study", "terac", "waiting"),
    stage("report", "Direction report", "paybench", "waiting"),
    stage("delivery", "Founder delivery", "linq", "waiting"),
  ],
  sandboxes: [
    {
      variant: "A",
      sandbox_id: "ss_scout_a",
      status: "paused",
      task: "Wait for scout evidence",
      last_activity_at: "2026-08-15T21:12:00.000Z",
    },
  ],
  study: { target: 10, valid: 0, a_valid: 0, b_valid: 0, flagged: 0, rejected: 0, technical_failures: 0 },
  replay: { status: "queued", completed_checks: 0, total_checks: 12, blocking_findings: 0 },
  artifacts: [active.artifacts[0]],
  updated_at: "2026-08-15T21:12:00.000Z",
};

const delivered: DashboardRunSnapshot = {
  ...active,
  job_id: "7c874f29-1b85-4f68-8280-f696af881ae1",
  founder_label: "Sprout Security",
  website_url: "https://example.net/plans",
  job_status: "delivered",
  current_stage: "delivery",
  next_action: undefined,
  stages: activeStages.map((item) => ({ ...item, status: "complete", started_at: undefined, completed_at: "2026-08-15T19:12:00.000Z" })),
  sandboxes: active.sandboxes.map((item) => ({ ...item, status: "ready" })),
  study: { target: 10, valid: 10, a_valid: 5, b_valid: 5, flagged: 0, rejected: 0, technical_failures: 0 },
  replay: { ...active.replay, status: "passed", completed_checks: 12, current_journey: "All journeys passed" },
  artifacts: [
    ...active.artifacts,
    { kind: "report", label: "Founder report", object_path: "jobs/demo/report/report-v1.json", created_at: "2026-08-15T19:10:00.000Z" },
  ],
  updated_at: "2026-08-15T19:12:00.000Z",
};

export const demoSnapshots: Record<string, DashboardRunSnapshot> = {
  [active.job_id]: active,
  [scout.job_id]: scout,
  [delivered.job_id]: delivered,
};

export const demoRuns: DashboardRunListItem[] = Object.values(demoSnapshots).map((run) => ({
  job_id: run.job_id,
  founder_label: run.founder_label,
  website_url: run.website_url,
  job_status: run.job_status,
  source: run.source,
  paid: run.paid,
  current_stage: run.current_stage,
  updated_at: run.updated_at,
}));

export const demoEvents: Record<string, DashboardRunEvent[]> = {
  [active.job_id]: [
    { event_id: "a1111111-1111-4111-8111-111111111111", job_id: active.job_id, stage: "replay", status: "complete", actor: "replay", summary: "All journeys passed with no blockers", occurred_at: "2026-08-15T21:36:00.000Z" },
    { event_id: "a3333333-3333-4333-8333-333333333333", job_id: active.job_id, stage: "variants", status: "complete", actor: "superserve", summary: "Control and challenger passed quality gates", occurred_at: "2026-08-15T21:04:00.000Z" },
    { event_id: "a4444444-4444-4444-8444-444444444444", job_id: active.job_id, stage: "payment", status: "complete", actor: "stripe", summary: "Payment confirmed", occurred_at: "2026-08-15T20:44:00.000Z" },
  ],
  [scout.job_id]: [
    { event_id: "b1111111-1111-4111-8111-111111111111", job_id: scout.job_id, stage: "capture", status: "blocked", actor: "terac", summary: "Scout task opened", occurred_at: "2026-08-15T21:12:00.000Z" },
    { event_id: "b2222222-2222-4222-8222-222222222222", job_id: scout.job_id, stage: "payment", status: "complete", actor: "stripe", summary: "Payment confirmed", occurred_at: "2026-08-15T20:58:00.000Z" },
  ],
  [delivered.job_id]: [
    { event_id: "c1111111-1111-4111-8111-111111111111", job_id: delivered.job_id, stage: "delivery", status: "complete", actor: "linq", summary: "Report delivered", occurred_at: "2026-08-15T19:12:00.000Z" },
    { event_id: "c2222222-2222-4222-8222-222222222222", job_id: delivered.job_id, stage: "replay", status: "complete", actor: "replay", summary: "12 journeys passed", occurred_at: "2026-08-15T19:06:00.000Z" },
  ],
};
