import { randomUUID } from "node:crypto";

import {
  SupabaseControlTransport,
  resolveSupabaseServerKey,
} from "../control/supabase-repository";
import type {
  ScoutSubmission,
  ScoutTaskRecord,
  ScoutTaskRepository,
} from "./types";
import { ScoutError } from "./types";

type Row = Record<string, unknown>;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function taskFromRow(row: Row): ScoutTaskRecord {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    task_token_hash: String(row.task_token_hash),
    task_token_ciphertext: String(row.task_token_ciphertext),
    target_url: String(row.target_url),
    final_url: typeof row.final_url === "string" ? row.final_url : undefined,
    click_steps: strings(row.click_path_json),
    visible_offer: typeof row.visible_offer_text === "string" ? row.visible_offer_text : undefined,
    visible_price: typeof row.visible_price_text === "string" ? row.visible_price_text : undefined,
    visible_terms: typeof row.visible_terms_text === "string" ? row.visible_terms_text : undefined,
    screenshot_urls: strings(row.artifact_paths),
    blocker: typeof row.blocker_text === "string" ? row.blocker_text : undefined,
    confirmation_code_hash: typeof row.confirmation_code_hash === "string" ? row.confirmation_code_hash : undefined,
    terac_submission_hmac: typeof row.terac_submission_hmac === "string" ? row.terac_submission_hmac : undefined,
    submission_fingerprint_hash: typeof row.submission_fingerprint_hash === "string" ? row.submission_fingerprint_hash : undefined,
    retry_request_id: typeof row.retry_request_id === "string" ? row.retry_request_id : undefined,
    quality_status: row.quality_status as ScoutTaskRecord["quality_status"],
    submitted_at: typeof row.submitted_at === "string" ? row.submitted_at : undefined,
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
  };
}

const SELECT = "id,job_id,task_token_hash,task_token_ciphertext,target_url,final_url,click_path_json,visible_offer_text,visible_price_text,visible_terms_text,artifact_paths,blocker_text,confirmation_code_hash,terac_submission_hmac,submission_fingerprint_hash,retry_request_id,quality_status,submitted_at,expires_at,created_at";

export class SupabaseScoutTaskRepository implements ScoutTaskRepository {
  constructor(private readonly transport: SupabaseControlTransport) {}

  async createTask(input: ScoutTaskRecord): Promise<ScoutTaskRecord> {
    const [row] = await this.transport.request("POST", "scout_tasks", {}, {
      id: input.id,
      job_id: input.job_id,
      task_token_hash: input.task_token_hash,
      task_token_ciphertext: input.task_token_ciphertext,
      target_url: input.target_url,
      quality_status: "pending",
      expires_at: input.expires_at,
      created_at: input.created_at,
    }, "return=representation");
    if (!row) throw new ScoutError("SCOUT_TASK_CREATE_FAILED", 503);
    return taskFromRow(row);
  }

  async findLatestPendingForJob(jobId: string, now: string): Promise<ScoutTaskRecord | null> {
    const [row] = await this.transport.request("GET", "scout_tasks", {
      select: SELECT,
      job_id: `eq.${jobId}`,
      quality_status: "eq.pending",
      expires_at: `gt.${now}`,
      order: "created_at.desc",
      limit: "1",
    });
    return row ? taskFromRow(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<ScoutTaskRecord | null> {
    const [row] = await this.transport.request("GET", "scout_tasks", {
      select: SELECT,
      task_token_hash: `eq.${tokenHash}`,
      limit: "1",
    });
    return row ? taskFromRow(row) : null;
  }

  async findLatestAcceptedForJob(jobId: string): Promise<ScoutTaskRecord | null> {
    const [row] = await this.transport.request("GET", "scout_tasks", {
      select: SELECT,
      job_id: `eq.${jobId}`,
      quality_status: "eq.valid",
      order: "submitted_at.desc",
      limit: "1",
    });
    return row ? taskFromRow(row) : null;
  }

  async acceptSubmission(input: {
    task_id: string;
    now: string;
    submission: ScoutSubmission;
    submission_fingerprint_hash: string;
    confirmation_code_hash: string;
    terac_submission_hmac?: string;
    retry_request_id: string;
  }): Promise<{ accepted: boolean; task: ScoutTaskRecord }> {
    const [updated] = await this.transport.request("PATCH", "scout_tasks", {
      id: `eq.${input.task_id}`,
      quality_status: "eq.pending",
      submitted_at: "is.null",
      expires_at: `gt.${input.now}`,
      select: SELECT,
    }, {
      final_url: input.submission.final_url,
      click_path_json: input.submission.click_steps,
      visible_offer_text: input.submission.visible_offer,
      visible_price_text: input.submission.visible_price,
      visible_terms_text: input.submission.visible_terms,
      artifact_paths: input.submission.screenshot_urls,
      blocker_text: input.submission.blocker,
      confirmation_code_hash: input.confirmation_code_hash,
      terac_submission_hmac: input.terac_submission_hmac,
      submission_fingerprint_hash: input.submission_fingerprint_hash,
      retry_request_id: input.retry_request_id,
      quality_status: "valid",
      submitted_at: input.now,
    }, "return=representation");
    if (updated) return { accepted: true, task: taskFromRow(updated) };
    const [existing] = await this.transport.request("GET", "scout_tasks", {
      select: SELECT,
      id: `eq.${input.task_id}`,
      limit: "1",
    });
    if (!existing) throw new ScoutError("SCOUT_TASK_NOT_FOUND", 404);
    return { accepted: false, task: taskFromRow(existing) };
  }

  async queueAcceptedEvidence(task: ScoutTaskRecord): Promise<void> {
    if (!task.submission_fingerprint_hash || !task.final_url || task.screenshot_urls.length === 0) {
      throw new ScoutError("SCOUT_EVIDENCE_INCOMPLETE", 409);
    }
    const [existingCapture] = await this.transport.request("GET", "website_captures", {
      select: "id",
      job_id: `eq.${task.job_id}`,
      checksum: `eq.${task.submission_fingerprint_hash}`,
      limit: "1",
    });
    if (!existingCapture) {
      await this.transport.request("POST", "website_captures", {}, {
        job_id: task.job_id,
        final_url: task.final_url,
        captured_at: task.submitted_at,
        desktop_screenshot_path: task.screenshot_urls[0],
        mobile_screenshot_path: task.screenshot_urls[1] ?? task.screenshot_urls[0],
        dom_path: null,
        console_log_path: null,
        checksum: task.submission_fingerprint_hash,
      }, "return=minimal");
    }
    try {
      await this.transport.request("POST", "agent_runs", {}, {
        job_id: task.job_id,
        request_id: task.retry_request_id,
        command_type: "resume_from_scout",
        stage: "capture",
        status: "queued",
        safe_progress_json: { status: "queued", task: "Scout evidence accepted" },
      }, "return=minimal");
    } catch {
      const [existing] = await this.transport.request("GET", "agent_runs", {
        select: "id",
        request_id: `eq.${task.retry_request_id}`,
        limit: "1",
      });
      if (!existing) throw new ScoutError("SCOUT_RETRY_QUEUE_FAILED", 503);
    }
    await this.transport.request("PATCH", "jobs", { id: `eq.${task.job_id}` }, {
      status: "capturing",
      capture_confidence: 0.75,
      failure_code: null,
      updated_at: new Date().toISOString(),
    }, "return=minimal");
  }
}

export class MemoryScoutTaskRepository implements ScoutTaskRepository {
  readonly tasks = new Map<string, ScoutTaskRecord>();
  readonly queuedRetries = new Set<string>();
  readonly captures: ScoutTaskRecord[] = [];

  async createTask(input: ScoutTaskRecord): Promise<ScoutTaskRecord> {
    this.tasks.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async findLatestPendingForJob(jobId: string, now: string): Promise<ScoutTaskRecord | null> {
    return [...this.tasks.values()]
      .filter((task) => task.job_id === jobId && task.quality_status === "pending" && task.expires_at > now)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((task) => structuredClone(task))[0] ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<ScoutTaskRecord | null> {
    const task = [...this.tasks.values()].find((row) => row.task_token_hash === tokenHash);
    return task ? structuredClone(task) : null;
  }

  async findLatestAcceptedForJob(jobId: string): Promise<ScoutTaskRecord | null> {
    return [...this.tasks.values()]
      .filter((task) => task.job_id === jobId && task.quality_status === "valid")
      .sort((left, right) => String(right.submitted_at).localeCompare(String(left.submitted_at)))
      .map((task) => structuredClone(task))[0] ?? null;
  }

  async acceptSubmission(input: {
    task_id: string;
    now: string;
    submission: ScoutSubmission;
    submission_fingerprint_hash: string;
    confirmation_code_hash: string;
    terac_submission_hmac?: string;
    retry_request_id: string;
  }): Promise<{ accepted: boolean; task: ScoutTaskRecord }> {
    const task = this.tasks.get(input.task_id);
    if (!task) throw new ScoutError("SCOUT_TASK_NOT_FOUND", 404);
    if (task.quality_status !== "pending" || task.submitted_at || task.expires_at <= input.now) {
      return { accepted: false, task: structuredClone(task) };
    }
    const accepted: ScoutTaskRecord = {
      ...task,
      final_url: input.submission.final_url,
      click_steps: [...input.submission.click_steps],
      visible_offer: input.submission.visible_offer,
      visible_price: input.submission.visible_price,
      visible_terms: input.submission.visible_terms,
      screenshot_urls: [...input.submission.screenshot_urls],
      blocker: input.submission.blocker,
      confirmation_code_hash: input.confirmation_code_hash,
      terac_submission_hmac: input.terac_submission_hmac,
      submission_fingerprint_hash: input.submission_fingerprint_hash,
      retry_request_id: input.retry_request_id,
      quality_status: "valid",
      submitted_at: input.now,
    };
    this.tasks.set(task.id, accepted);
    return { accepted: true, task: structuredClone(accepted) };
  }

  async queueAcceptedEvidence(task: ScoutTaskRecord): Promise<void> {
    if (task.retry_request_id) this.queuedRetries.add(task.retry_request_id);
    if (!this.captures.some((capture) => capture.submission_fingerprint_hash === task.submission_fingerprint_hash)) {
      this.captures.push(structuredClone(task));
    }
  }
}

let liveRepository: Promise<ScoutTaskRepository> | undefined;

export function getScoutTaskRepository(): Promise<ScoutTaskRepository> {
  liveRepository ??= (async () => {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!baseUrl) throw new ScoutError("SCOUT_STORAGE_NOT_CONFIGURED", 503);
    const serverKey = await resolveSupabaseServerKey(process.env);
    return new SupabaseScoutTaskRepository(new SupabaseControlTransport(baseUrl, serverKey));
  })();
  return liveRepository;
}

export function newScoutTaskId(): string {
  return randomUUID();
}
