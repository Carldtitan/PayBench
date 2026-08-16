export type ScoutQualityStatus =
  | "pending"
  | "valid"
  | "flagged"
  | "rejected"
  | "technical_failure";

export interface ScoutTaskRecord {
  id: string;
  job_id: string;
  task_token_hash: string;
  task_token_ciphertext: string;
  target_url: string;
  final_url?: string;
  click_steps: string[];
  visible_offer?: string;
  visible_price?: string;
  visible_terms?: string;
  screenshot_urls: string[];
  blocker?: string;
  confirmation_code_hash?: string;
  terac_submission_hmac?: string;
  submission_fingerprint_hash?: string;
  retry_request_id?: string;
  quality_status: ScoutQualityStatus;
  submitted_at?: string;
  expires_at: string;
  created_at: string;
}

export interface ScoutSubmission {
  final_url: string;
  click_steps: string[];
  visible_offer: string;
  visible_price: string;
  visible_terms: string;
  blocker: string;
  screenshot_urls: string[];
  terac_submission_id?: string;
}

export interface ScoutTaskView {
  target_url: string;
  expires_at: string;
  title: "Capture the public checkout page";
  steps: readonly string[];
  required_fields: readonly [
    "final_url",
    "click_steps",
    "visible_offer",
    "visible_price",
    "visible_terms",
    "blocker",
    "screenshot_urls",
  ];
}

export interface ScoutTaskRepository {
  createTask(input: ScoutTaskRecord): Promise<ScoutTaskRecord>;
  findLatestPendingForJob(jobId: string, now: string): Promise<ScoutTaskRecord | null>;
  findByTokenHash(tokenHash: string): Promise<ScoutTaskRecord | null>;
  findLatestAcceptedForJob(jobId: string): Promise<ScoutTaskRecord | null>;
  acceptSubmission(input: {
    task_id: string;
    now: string;
    submission: ScoutSubmission;
    submission_fingerprint_hash: string;
    confirmation_code_hash: string;
    terac_submission_hmac?: string;
    retry_request_id: string;
  }): Promise<{ accepted: boolean; task: ScoutTaskRecord }>;
  queueAcceptedEvidence(task: ScoutTaskRecord): Promise<void>;
}

export class ScoutError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
    this.name = "ScoutError";
  }
}
