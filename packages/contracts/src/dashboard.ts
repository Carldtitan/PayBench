import { z } from "zod";

export const jobStatusSchema = z.enum([
  "awaiting_confirmation",
  "awaiting_payment",
  "paid",
  "capturing",
  "needs_scout",
  "spec_ready",
  "building_variants",
  "quality_check",
  "recruiting",
  "testing",
  "analyzing",
  "replay_qa",
  "report_ready",
  "delivered",
  "failed",
]);

export const dashboardStageIdSchema = z.enum([
  "intake",
  "payment",
  "capture",
  "variants",
  "study",
  "replay",
  "report",
  "delivery",
]);

export const dashboardStageStatusSchema = z.enum([
  "waiting",
  "running",
  "blocked",
  "complete",
  "failed",
]);

export const dashboardActorSchema = z.enum([
  "paybench",
  "stripe",
  "superserve",
  "terac",
  "replay",
  "linq",
]);

export const dashboardStageSchema = z.object({
  id: dashboardStageIdSchema,
  status: dashboardStageStatusSchema,
  actor: dashboardActorSchema,
  label: z.string().min(1).max(48),
  detail: z.string().max(120).optional(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
});

export const sandboxLiveStateSchema = z.object({
  variant: z.enum(["A", "B"]),
  sandbox_id: z.string().min(1),
  status: z.enum([
    "queued",
    "booting",
    "navigating",
    "capturing",
    "editing",
    "validating",
    "ready",
    "paused",
    "failed",
  ]),
  task: z.string().min(1).max(120),
  viewer_url: z.string().url().optional(),
  preview_url: z.string().url().optional(),
  latest_frame_url: z.string().url().optional(),
  last_activity_at: z.string().datetime(),
});

export const replayLiveStateSchema = z.object({
  status: z.enum(["queued", "recording", "checking", "passed", "failed"]),
  current_journey: z.string().max(120).optional(),
  completed_checks: z.number().int().nonnegative(),
  total_checks: z.number().int().nonnegative(),
  blocking_findings: z.number().int().nonnegative(),
  run_url: z.string().url().optional(),
  last_activity_at: z.string().datetime().optional(),
});

export const dashboardArtifactSchema = z.object({
  kind: z.enum(["capture", "spec", "variant_a", "variant_b", "metrics", "report"]),
  label: z.string().min(1).max(64),
  object_path: z.string().min(1),
  created_at: z.string().datetime(),
});

export const dashboardRunSnapshotSchema = z.object({
  contract_version: z.literal("1"),
  job_id: z.string().uuid(),
  founder_label: z.string().min(1).max(64),
  website_url: z.string().url(),
  job_status: jobStatusSchema,
  source: z.enum(["live", "demo"]),
  paid: z.boolean(),
  amount_paid_cents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  current_stage: dashboardStageIdSchema,
  blocker: z.object({ code: z.string().min(1), label: z.string().min(1).max(80) }).optional(),
  next_action: z.string().max(120).optional(),
  stages: z.array(dashboardStageSchema).length(8),
  sandboxes: z.array(sandboxLiveStateSchema).max(2),
  study: z.object({
    target: z.number().int().nonnegative(),
    valid: z.number().int().nonnegative(),
    a_valid: z.number().int().nonnegative(),
    b_valid: z.number().int().nonnegative(),
    flagged: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    technical_failures: z.number().int().nonnegative(),
  }),
  replay: replayLiveStateSchema,
  artifacts: z.array(dashboardArtifactSchema),
  updated_at: z.string().datetime(),
});

export const dashboardRunEventSchema = z.object({
  event_id: z.string().uuid(),
  job_id: z.string().uuid(),
  stage: dashboardStageIdSchema,
  status: dashboardStageStatusSchema,
  actor: dashboardActorSchema,
  summary: z.string().min(1).max(120),
  occurred_at: z.string().datetime(),
});

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type DashboardStageId = z.infer<typeof dashboardStageIdSchema>;
export type DashboardStageStatus = z.infer<typeof dashboardStageStatusSchema>;
export type DashboardActor = z.infer<typeof dashboardActorSchema>;
export type DashboardStage = z.infer<typeof dashboardStageSchema>;
export type SandboxLiveState = z.infer<typeof sandboxLiveStateSchema>;
export type ReplayLiveState = z.infer<typeof replayLiveStateSchema>;
export type DashboardArtifact = z.infer<typeof dashboardArtifactSchema>;
export type DashboardRunSnapshot = z.infer<typeof dashboardRunSnapshotSchema>;
export type DashboardRunEvent = z.infer<typeof dashboardRunEventSchema>;

export type DashboardRunListItem = Pick<
  DashboardRunSnapshot,
  "job_id" | "founder_label" | "website_url" | "job_status" | "source" | "paid" | "current_stage" | "updated_at"
>;
