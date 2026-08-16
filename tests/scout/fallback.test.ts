import { describe, expect, it } from "vitest";

import { MemoryScoutTaskRepository } from "../../apps/web/src/server/scout/repository";
import {
  acceptedScoutEvidence,
  createScoutTaskForCaptureFailure,
  getOperatorScoutTask,
  getScoutTaskView,
  normalizeScoutSubmission,
  submitScoutTask,
} from "../../apps/web/src/server/scout/service";
import { ScoutError } from "../../apps/web/src/server/scout/types";

const secret = "scout-test-secret-with-at-least-24-characters";
const now = new Date("2026-08-15T20:00:00.000Z");
const jobId = "10000000-0000-4000-8000-000000000001";

const submission = {
  final_url: "https://example.com/checkout",
  click_steps: ["Clicked Pricing", "Selected the monthly plan", "Clicked Continue"],
  visible_offer: "Team plan with shared projects",
  visible_price: "$20 per month",
  visible_terms: "Renews monthly. Cancel before the next billing date.",
  blocker: "None",
  screenshot_urls: [
    "https://evidence.example/desktop.png",
    "https://evidence.example/mobile.png",
  ],
  terac_submission_id: "submission-private-123",
};

function tokenFrom(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
}

describe("Terac scout fallback", () => {
  it("creates one opaque expiring task with clear operator and end-user copy", async () => {
    const repository = new MemoryScoutTaskRepository();
    const created = await createScoutTaskForCaptureFailure(repository, {
      job_id: jobId,
      target_url: "https://example.com/pricing",
      signing_secret: secret,
      app_base_url: "https://paybench.example",
      now,
    });
    const token = tokenFrom(created.task_url);
    const view = await getScoutTaskView(repository, token, { signing_secret: secret, now });
    const reused = await getOperatorScoutTask(repository, jobId, {
      signing_secret: secret,
      app_base_url: "https://paybench.example",
      now,
    });

    expect(token).toMatch(/^pbs_[A-Za-z0-9_-]{32}$/);
    expect(created.copy).toContain("Open exactly: https://example.com/pricing");
    expect(created.copy).toContain("Do not create an account");
    expect(reused.task_url).toBe(created.task_url);
    expect(view).toMatchObject({
      target_url: "https://example.com/pricing",
      title: "Capture the public checkout page",
    });
    expect(view.steps.join(" ")).toContain("exact price");
    expect(view.steps.join(" ")).toContain("HTTPS screenshot links");
    expect(repository.tasks.size).toBe(1);
  });

  it("accepts complete evidence once, hashes private values, and queues a retry", async () => {
    const repository = new MemoryScoutTaskRepository();
    const created = await createScoutTaskForCaptureFailure(repository, {
      job_id: jobId,
      target_url: "https://example.com/pricing",
      signing_secret: secret,
      app_base_url: "https://paybench.example",
      now,
    });
    const token = tokenFrom(created.task_url);
    const first = await submitScoutTask(repository, token, submission, {
      signing_secret: secret,
      now: new Date("2026-08-15T20:10:00.000Z"),
    });
    const second = await submitScoutTask(repository, token, submission, {
      signing_secret: secret,
      now: new Date("2026-08-15T20:11:00.000Z"),
    });
    const stored = [...repository.tasks.values()][0]!;
    const evidence = await acceptedScoutEvidence(repository, jobId);

    expect(first).toMatchObject({ reused: false, retry_queued: true });
    expect(first.completion_code).toMatch(/^PB-SCOUT-[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(second).toEqual({ ...first, reused: true });
    expect(stored.quality_status).toBe("valid");
    expect(stored.confirmation_code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.terac_submission_hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(first.completion_code);
    expect(JSON.stringify(stored)).not.toContain(submission.terac_submission_id);
    expect(repository.queuedRetries).toEqual(new Set([`scout:${stored.id}:resume`]));
    expect(repository.captures).toHaveLength(1);
    expect(evidence).toMatchObject({
      source_url: submission.final_url,
      desktop_screenshot_path: submission.screenshot_urls[0],
      mobile_screenshot_path: submission.screenshot_urls[1],
      brand_tokens: { capture_source: "scout", evidence_count: 2 },
    });
  });

  it("rejects changed repeat submissions, expired tokens, and unsafe evidence URLs", async () => {
    const repository = new MemoryScoutTaskRepository();
    const created = await createScoutTaskForCaptureFailure(repository, {
      job_id: jobId,
      target_url: "https://example.com/pricing",
      signing_secret: secret,
      app_base_url: "https://paybench.example",
      now,
    });
    const token = tokenFrom(created.task_url);
    await submitScoutTask(repository, token, submission, { signing_secret: secret, now });
    await expect(submitScoutTask(repository, token, {
      ...submission,
      visible_price: "$99 per month",
    }, { signing_secret: secret, now })).rejects.toMatchObject({ code: "SCOUT_ALREADY_SUBMITTED", status: 409 });

    expect(() => normalizeScoutSubmission({
      ...submission,
      screenshot_urls: ["http://evidence.example/desktop.png"],
    })).toThrowError(ScoutError);

    const expiredRepository = new MemoryScoutTaskRepository();
    const expiring = await createScoutTaskForCaptureFailure(expiredRepository, {
      job_id: jobId,
      target_url: "https://example.com/pricing",
      signing_secret: secret,
      app_base_url: "https://paybench.example",
      now,
    });
    await expect(getScoutTaskView(expiredRepository, tokenFrom(expiring.task_url), {
      signing_secret: secret,
      now: new Date("2026-08-16T20:00:01.000Z"),
    })).rejects.toMatchObject({ code: "SCOUT_TASK_EXPIRED", status: 410 });
    await expect(getScoutTaskView(expiredRepository, `${tokenFrom(expiring.task_url).slice(0, -1)}x`, {
      signing_secret: secret,
      now,
    })).rejects.toMatchObject({ code: "SCOUT_TASK_NOT_FOUND", status: 404 });
  });
});
