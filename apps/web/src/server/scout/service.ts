import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { isIP } from "node:net";

import type { CapturedPageEvidence } from "../engine/anthropic";
import { newScoutTaskId } from "./repository";
import type {
  ScoutSubmission,
  ScoutTaskRecord,
  ScoutTaskRepository,
  ScoutTaskView,
} from "./types";
import { ScoutError } from "./types";

const TOKEN_PATTERN = /^pbs_[A-Za-z0-9_-]{32}$/;
const TASK_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export const SCOUT_TASK_STEPS = Object.freeze([
  "Open the exact target URL in a normal browser. Act as a first-time end-user.",
  "Click only what is needed to reach the public pricing, paywall, or checkout page.",
  "Stop before creating an account, starting a trial, placing an order, or entering payment details.",
  "Copy the final URL and list every click in order.",
  "Copy the visible offer, exact price, and billing, renewal, cancellation, and trial terms. Write Not visible for any item the page does not show.",
  "State the blocker, or write None. Add HTTPS screenshot links that show the full page.",
  "Remove personal, account, and payment information from every screenshot.",
]);

export interface OperatorScoutTask {
  task_url: string;
  target_url: string;
  expires_at: string;
  copy: string;
}

function secretOrThrow(secret?: string): string {
  if (!secret || secret.length < 24) throw new ScoutError("SCOUT_SIGNING_SECRET_MISSING", 503);
  return secret;
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function encrypt(secret: string, value: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(secret: string, value: string): string {
  try {
    const [iv, tag, encrypted] = value.split(".");
    if (!iv || !tag || !encrypted) throw new Error("invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ScoutError("SCOUT_TASK_TOKEN_INVALID", 503);
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function boundedText(value: unknown, field: string, minimum = 2, maximum = 2_000): string {
  if (typeof value !== "string") throw new ScoutError(`SCOUT_${field.toUpperCase()}_REQUIRED`, 400);
  const normalized = value.trim().replace(/\r\n/g, "\n");
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ScoutError(`SCOUT_${field.toUpperCase()}_INVALID`, 400);
  }
  return normalized;
}

function safeHttpsUrl(value: unknown, field: string): string {
  const raw = boundedText(value, field, 8, 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScoutError(`SCOUT_${field.toUpperCase()}_INVALID`, 400);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isIP(host) !== 0
  ) {
    throw new ScoutError(`SCOUT_${field.toUpperCase()}_INVALID`, 400);
  }
  return url.toString();
}

function taskUrl(baseUrl: string, token: string): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new ScoutError("APP_BASE_URL_INVALID", 503);
  }
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  if ((!local && base.protocol !== "https:") || (local && !["http:", "https:"].includes(base.protocol))) {
    throw new ScoutError("APP_BASE_URL_INVALID", 503);
  }
  return new URL(`/scout/${encodeURIComponent(token)}`, base).toString();
}

function view(task: ScoutTaskRecord): ScoutTaskView {
  return {
    target_url: task.target_url,
    expires_at: task.expires_at,
    title: "Capture the public checkout page",
    steps: SCOUT_TASK_STEPS,
    required_fields: [
      "final_url",
      "click_steps",
      "visible_offer",
      "visible_price",
      "visible_terms",
      "blocker",
      "screenshot_urls",
    ],
  };
}

function operatorTask(task: ScoutTaskRecord, token: string, baseUrl: string): OperatorScoutTask {
  const url = taskUrl(baseUrl, token);
  return {
    task_url: url,
    target_url: task.target_url,
    expires_at: task.expires_at,
    copy: [
      "Capture this public checkout page as a first-time end-user.",
      `Open exactly: ${task.target_url}`,
      "Follow the task at the link below. Do not create an account, start a trial, place an order, or enter payment details.",
      `Task link: ${url}`,
    ].join("\n\n"),
  };
}

export function normalizeScoutSubmission(value: unknown): ScoutSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScoutError("SCOUT_SUBMISSION_INVALID", 400);
  }
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.click_steps) || row.click_steps.length < 1 || row.click_steps.length > 20) {
    throw new ScoutError("SCOUT_CLICK_STEPS_INVALID", 400);
  }
  if (!Array.isArray(row.screenshot_urls) || row.screenshot_urls.length < 1 || row.screenshot_urls.length > 6) {
    throw new ScoutError("SCOUT_SCREENSHOTS_INVALID", 400);
  }
  const clickSteps = row.click_steps.map((step) => boundedText(step, "click_step", 2, 240));
  const screenshotUrls = [...new Set(row.screenshot_urls.map((url) => safeHttpsUrl(url, "screenshot_url")))];
  const teracSubmissionId = typeof row.terac_submission_id === "string"
    ? boundedText(row.terac_submission_id, "terac_submission", 1, 200)
    : undefined;
  return {
    final_url: safeHttpsUrl(row.final_url, "final_url"),
    click_steps: clickSteps,
    visible_offer: boundedText(row.visible_offer, "visible_offer"),
    visible_price: boundedText(row.visible_price, "visible_price"),
    visible_terms: boundedText(row.visible_terms, "visible_terms"),
    blocker: boundedText(row.blocker, "blocker", 2, 1_000),
    screenshot_urls: screenshotUrls,
    terac_submission_id: teracSubmissionId,
  };
}

export async function createScoutTaskForCaptureFailure(
  repository: ScoutTaskRepository,
  input: {
    job_id: string;
    target_url: string;
    signing_secret?: string;
    app_base_url?: string;
    now?: Date;
  },
): Promise<OperatorScoutTask> {
  const secret = secretOrThrow(input.signing_secret ?? process.env.APP_SIGNING_SECRET);
  const now = input.now ?? new Date();
  const existing = await repository.findLatestPendingForJob(input.job_id, now.toISOString());
  if (existing) {
    return operatorTask(existing, decrypt(secret, existing.task_token_ciphertext), input.app_base_url ?? process.env.APP_BASE_URL ?? "http://localhost:3000");
  }
  const targetUrl = safeHttpsUrl(input.target_url, "target_url");
  const token = `pbs_${randomBytes(24).toString("base64url")}`;
  const task = await repository.createTask({
    id: newScoutTaskId(),
    job_id: input.job_id,
    task_token_hash: hmac(secret, `scout-token:${token}`),
    task_token_ciphertext: encrypt(secret, token),
    target_url: targetUrl,
    click_steps: [],
    screenshot_urls: [],
    quality_status: "pending",
    expires_at: new Date(now.getTime() + TASK_LIFETIME_MS).toISOString(),
    created_at: now.toISOString(),
  });
  return operatorTask(task, token, input.app_base_url ?? process.env.APP_BASE_URL ?? "http://localhost:3000");
}

async function taskForToken(
  repository: ScoutTaskRepository,
  token: string,
  secret: string,
): Promise<ScoutTaskRecord> {
  if (!TOKEN_PATTERN.test(token)) throw new ScoutError("SCOUT_TASK_NOT_FOUND", 404);
  const task = await repository.findByTokenHash(hmac(secret, `scout-token:${token}`));
  if (!task) throw new ScoutError("SCOUT_TASK_NOT_FOUND", 404);
  return task;
}

export async function getScoutTaskView(
  repository: ScoutTaskRepository,
  token: string,
  options: { signing_secret?: string; now?: Date } = {},
): Promise<ScoutTaskView> {
  const task = await taskForToken(repository, token, secretOrThrow(options.signing_secret ?? process.env.APP_SIGNING_SECRET));
  if (task.quality_status === "valid") throw new ScoutError("SCOUT_TASK_COMPLETE", 409);
  if (task.quality_status !== "pending" || task.expires_at <= (options.now ?? new Date()).toISOString()) {
    throw new ScoutError("SCOUT_TASK_EXPIRED", 410);
  }
  return view(task);
}

export async function submitScoutTask(
  repository: ScoutTaskRepository,
  token: string,
  rawSubmission: unknown,
  options: { signing_secret?: string; now?: Date } = {},
): Promise<{ completion_code: string; reused: boolean; retry_queued: true }> {
  const secret = secretOrThrow(options.signing_secret ?? process.env.APP_SIGNING_SECRET);
  const now = options.now ?? new Date();
  const task = await taskForToken(repository, token, secret);
  const submission = normalizeScoutSubmission(rawSubmission);
  const submissionFingerprint = fingerprint(submission);
  const completionCode = `PB-SCOUT-${hmac(secret, `scout-code:${task.id}`).slice(0, 4).toUpperCase()}-${hmac(secret, `scout-code:${task.id}`).slice(4, 8).toUpperCase()}`;

  if (task.quality_status === "valid") {
    if (task.submission_fingerprint_hash !== submissionFingerprint) {
      throw new ScoutError("SCOUT_ALREADY_SUBMITTED", 409);
    }
    await repository.queueAcceptedEvidence(task);
    return { completion_code: completionCode, reused: true, retry_queued: true };
  }
  if (task.quality_status !== "pending" || task.expires_at <= now.toISOString()) {
    throw new ScoutError("SCOUT_TASK_EXPIRED", 410);
  }

  const accepted = await repository.acceptSubmission({
    task_id: task.id,
    now: now.toISOString(),
    submission,
    submission_fingerprint_hash: submissionFingerprint,
    confirmation_code_hash: hmac(secret, `confirmation:${completionCode}`),
    terac_submission_hmac: submission.terac_submission_id
      ? hmac(secret, `terac-submission:${submission.terac_submission_id}`)
      : undefined,
    retry_request_id: `scout:${task.id}:resume`,
  });
  if (!accepted.accepted) {
    if (accepted.task.quality_status === "valid" && accepted.task.submission_fingerprint_hash === submissionFingerprint) {
      await repository.queueAcceptedEvidence(accepted.task);
      return { completion_code: completionCode, reused: true, retry_queued: true };
    }
    throw new ScoutError("SCOUT_ALREADY_SUBMITTED", 409);
  }
  await repository.queueAcceptedEvidence(accepted.task);
  return { completion_code: completionCode, reused: false, retry_queued: true };
}

export async function getOperatorScoutTask(
  repository: ScoutTaskRepository,
  jobId: string,
  options: { signing_secret?: string; app_base_url?: string; now?: Date } = {},
): Promise<OperatorScoutTask> {
  const secret = secretOrThrow(options.signing_secret ?? process.env.APP_SIGNING_SECRET);
  const task = await repository.findLatestPendingForJob(jobId, (options.now ?? new Date()).toISOString());
  if (!task) throw new ScoutError("SCOUT_TASK_NOT_FOUND", 404);
  return operatorTask(task, decrypt(secret, task.task_token_ciphertext), options.app_base_url ?? process.env.APP_BASE_URL ?? "http://localhost:3000");
}

export async function acceptedScoutEvidence(
  repository: ScoutTaskRepository,
  jobId: string,
): Promise<CapturedPageEvidence | null> {
  const task = await repository.findLatestAcceptedForJob(jobId);
  if (!task?.final_url || !task.submission_fingerprint_hash || task.screenshot_urls.length === 0) return null;
  const visibleText = [
    `Offer: ${task.visible_offer ?? ""}`,
    `Price: ${task.visible_price ?? ""}`,
    `Terms: ${task.visible_terms ?? ""}`,
    `Click path: ${task.click_steps.join(" -> ")}`,
    `Blocker: ${task.blocker ?? "None"}`,
  ].join("\n");
  return {
    source_url: task.final_url,
    source_hash: task.submission_fingerprint_hash,
    desktop_screenshot_path: task.screenshot_urls[0]!,
    mobile_screenshot_path: task.screenshot_urls[1] ?? task.screenshot_urls[0]!,
    reduced_dom: "",
    visible_text: visibleText,
    brand_tokens: { capture_source: "scout", evidence_count: task.screenshot_urls.length },
  };
}
