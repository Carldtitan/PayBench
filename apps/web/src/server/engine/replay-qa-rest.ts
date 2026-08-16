import "./server-only";

import {
  REPLAY_QA_MATRIX,
  ReplayGateError,
  type ReplayExecutionAdapter,
  type ReplayExecutionResult,
  type ReplayJourneyEvidence,
  type ReplayJourneyId,
} from "./replay";

type JsonRecord = Record<string, unknown>;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_BASE_URL = "https://loop-qa.replay.io/api/v1";
const SUCCESS_STATUSES = new Set(["passed", "complete", "completed", "success", "succeeded"]);
const FAILURE_STATUSES = new Set(["failed", "error", "blocked", "cancelled", "canceled"]);

const JOURNEY_INSTRUCTIONS: Record<ReplayJourneyId, string> = {
  a_desktop_purchase: "At 1440x960, select a plan on participant page A, use only the shown fake values, review the order, complete the simulated purchase, and submit the final survey. Confirm no card number, CVV, expiry, or real payment field appears.",
  b_desktop_purchase: "At 1440x960, select a plan on participant page B, use only the shown fake values, review the order, complete the simulated purchase, and submit the final survey. Confirm no card number, CVV, expiry, or real payment field appears.",
  a_mobile_purchase: "At 390x844, complete participant page A through plan selection, fake checkout, order review, simulated purchase, and final survey.",
  b_mobile_purchase: "At 390x844, complete participant page B through plan selection, fake checkout, order review, simulated purchase, and final survey.",
  a_desktop_stop: "On participant page A at desktop size, choose I would stop here and submit the same required final survey. Stopping must work without a purchase.",
  b_desktop_stop: "On participant page B at desktop size, choose I would stop here and submit the same required final survey. Stopping must work without a purchase.",
  a_form_validation: "On participant page A, try to continue with required fake checkout fields empty. Verify clear validation, then use only the preset fake data and continue.",
  b_form_validation: "On participant page B, try to continue with required fake checkout fields empty. Verify clear validation, then use only the preset fake data and continue.",
  a_survey_submission: "Reach participant page A's final survey after either decision. Verify an empty survey is rejected, then enter valid feedback and submit once.",
  b_survey_submission: "Reach participant page B's final survey after either decision. Verify an empty survey is rejected, then enter valid feedback and submit once.",
  assignment_refresh_persistence: "Open the assigned participant page, note the rendered offer, refresh before deciding, and verify the same assignment and progress remain. The URL must not reveal A, B, variant, assignment, or a study ID.",
  mocked_terac_redirect: "Complete the simulated participant journey and verify the final redirect stays inside PayBench's mock completion route. Never open Terac or make a Terac API request.",
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function rows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(record);
  const object = record(value);
  for (const key of ["items", "data", "projects", "journeys", "test_runs", "bugs"]) {
    if (Array.isArray(object[key])) return (object[key] as unknown[]).map(record);
  }
  return [];
}

function textField(value: unknown, names: readonly string[]): string | undefined {
  const object = record(value);
  for (const name of names) {
    if (typeof object[name] === "string" && object[name]) return object[name] as string;
  }
  return undefined;
}

function findStringDeep(value: unknown, names: ReadonlySet<string>): string | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findStringDeep(child, names);
      if (found) return found;
    }
    return undefined;
  }
  const object = record(value);
  for (const [key, child] of Object.entries(object)) {
    if (names.has(key) && typeof child === "string" && child) return child;
    const found = findStringDeep(child, names);
    if (found) return found;
  }
  return undefined;
}

function recordingUrl(value: unknown): string | undefined {
  const direct = findStringDeep(value, new Set(["recording_url", "replay_url", "recordingUrl", "replayUrl"]));
  if (direct) {
    try {
      const url = new URL(direct);
      if (url.protocol === "https:" && url.hostname === "app.replay.io" && url.pathname.startsWith("/recording/")) {
        return url.toString();
      }
    } catch {
      return undefined;
    }
  }
  const id = findStringDeep(value, new Set(["recording_id", "recordingId", "replay_recording_id"]));
  return id && /^[0-9a-f-]{36}$/i.test(id) ? `https://app.replay.io/recording/${id}` : undefined;
}

export interface ReplayQaTarget {
  url: URL;
  kind: "participant" | "superserve_preview";
}

export function assertReplayGeneratedUrl(
  candidate: string,
  label: "control" | "challenger",
  allowedPreviewHosts: readonly string[] = [],
): ReplayQaTarget {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ReplayGateError("REPLAY_PARTICIPANT_URL_INVALID", `Replay ${label} participant URL is invalid`);
  }
  const participant =
    /^\/s\/[A-Za-z0-9_-]{24,100}$/.test(url.pathname) &&
    url.search.length === 0 &&
    url.hash.length === 0;
  const allowedHost = allowedPreviewHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  const superserve =
    url.hostname === "superserve.ai" ||
    url.hostname.endsWith(".superserve.ai") ||
    allowedHost;
  if (url.protocol !== "https:" || (!participant && !superserve)) {
    throw new ReplayGateError(
      "REPLAY_PARTICIPANT_URL_INVALID",
      `Replay ${label} target must be a generated PayBench /s/<opaque-token> page or an allow-listed signed Superserve preview`,
    );
  }
  return { url, kind: participant ? "participant" : "superserve_preview" };
}

export function assertReplayParticipantTargets(controlUrl: string, challengerUrl: string): {
  control: ReplayQaTarget;
  challenger: ReplayQaTarget;
};
export function assertReplayParticipantTargets(
  controlUrl: string,
  challengerUrl: string,
  allowedPreviewHosts?: readonly string[],
): { control: ReplayQaTarget; challenger: ReplayQaTarget };
export function assertReplayParticipantTargets(
  controlUrl: string,
  challengerUrl: string,
  allowedPreviewHosts: readonly string[] = [],
): { control: ReplayQaTarget; challenger: ReplayQaTarget } {
  const control = assertReplayGeneratedUrl(controlUrl, "control", allowedPreviewHosts);
  const challenger = assertReplayGeneratedUrl(challengerUrl, "challenger", allowedPreviewHosts);
  if (control.url.origin !== challenger.url.origin && control.kind === "participant" && challenger.kind === "participant") {
    throw new ReplayGateError("REPLAY_PARTICIPANT_ORIGIN_MISMATCH", "Replay A and B participant pages must use the same PayBench origin");
  }
  if (control.url.toString() === challenger.url.toString()) {
    throw new ReplayGateError(
      "REPLAY_PARTICIPANT_TARGETS_AMBIGUOUS",
      "Replay needs separate opaque QA participant links bound to A and B; one neutral link cannot prove both variants",
    );
  }
  return { control, challenger };
}

export interface ReplayQaRestOptions {
  token: string;
  baseUrl?: string;
  fetcher?: Fetcher;
  pollIntervalMs?: number;
  timeoutMs?: number;
  budget?: number;
  finishedWebhookUrl?: string;
  allowedPreviewHosts?: readonly string[];
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ReplayQaProject {
  id: string;
  url: string;
  journeys: Partial<Record<ReplayJourneyId, string>>;
  targets: {
    control: { url: string; kind: ReplayQaTarget["kind"] };
    challenger: { url: string; kind: ReplayQaTarget["kind"] };
  };
}

export class ReplayQaRestAdapter implements ReplayExecutionAdapter {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly budget: number;
  private readonly finishedWebhookUrl?: string;
  private readonly allowedPreviewHosts: readonly string[];
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: ReplayQaRestOptions) {
    if (!/^lqa_[A-Za-z0-9_-]{20,}$/.test(options.token)) {
      throw new ReplayGateError("REPLAY_QA_TOKEN_INVALID", "Replay QA requires the lqa_ API token from qa.replay.io");
    }
    const baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    if (baseUrl.protocol !== "https:" || !["loop-qa.replay.io", "qa.replay.io"].includes(baseUrl.hostname)) {
      throw new ReplayGateError("REPLAY_QA_BASE_URL_INVALID", "Replay QA API base URL is invalid");
    }
    this.token = options.token;
    this.baseUrl = baseUrl.toString().replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.timeoutMs = options.timeoutMs ?? 12 * 60_000;
    this.budget = options.budget ?? 20;
    this.finishedWebhookUrl = options.finishedWebhookUrl;
    this.allowedPreviewHosts = options.allowedPreviewHosts ?? [];
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ReplayGateError("REPLAY_QA_UNAVAILABLE", "Replay QA API could not be reached");
    }
    const raw = await response.text();
    let payload: unknown = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new ReplayGateError("REPLAY_QA_RESPONSE_INVALID", "Replay QA returned invalid JSON");
      }
    }
    if (!response.ok) {
      throw new ReplayGateError(`REPLAY_QA_HTTP_${response.status}`, `Replay QA request failed with HTTP ${response.status}`);
    }
    return payload;
  }

  async createParticipantProject(input: {
    job_id: string;
    control_url: string;
    challenger_url: string;
  }): Promise<ReplayQaProject> {
    const targets = assertReplayParticipantTargets(input.control_url, input.challenger_url, this.allowedPreviewHosts);
    const created = await this.request("POST", "/projects", {
      name: `PayBench ${input.job_id.slice(0, 8)} generated paywalls`,
      target_url: targets.control.url.toString(),
      instructions: "Test the generated PayBench participant paywalls, not the PayBench homepage. Use simulated values only. Exercise both continuing and stopping. Never enter real payment data and never contact Terac.",
      design_document: "Two generated paywalls must preserve locked product facts. A and B are separate opaque participant QA links. Required flows: plan selection, fake checkout validation, order review, simulated purchase, stop, required survey, refresh persistence, and internal mock completion redirect. No real payment fields are permitted.",
      enabled_polish_passes: ["network-performance", "react-rendering", "layout-shift", "accessibility", "glitches", "user-experience", "ui-details"],
      budget: this.budget,
      ...(this.finishedWebhookUrl ? { finished_webhook_url: this.finishedWebhookUrl } : {}),
    });
    const projectId = textField(created, ["id", "project_id"]);
    if (!projectId) throw new ReplayGateError("REPLAY_QA_PROJECT_INVALID", "Replay QA did not return a project ID");
    const projectUrl = textField(created, ["url", "project_url"]) ?? `https://qa.replay.io/projects/${encodeURIComponent(projectId)}`;
    const journeys: ReplayQaProject["journeys"] = {};
    for (const journey of REPLAY_QA_MATRIX) {
      const target = journey.startsWith("b_") ? targets.challenger : targets.control;
      const createdJourney = await this.request("POST", `/projects/${encodeURIComponent(projectId)}/journeys`, {
        name: journey,
        description: JOURNEY_INSTRUCTIONS[journey],
        instructions: "Drive this flow autonomously with Playwright and capture a Replay recording. Treat any broken interaction, validation failure, console error, or unexpected network failure as a bug. Never use real payment information and never contact Terac.",
        target_url: target.url.toString(),
        polish: true,
      });
      const journeyId = textField(createdJourney, ["id", "journey_id"]);
      if (!journeyId) throw new ReplayGateError("REPLAY_QA_JOURNEY_INVALID", `Replay QA did not create ${journey}`);
      journeys[journey] = journeyId;
    }
    return {
      id: projectId,
      url: projectUrl,
      journeys,
      targets: {
        control: { url: targets.control.url.toString(), kind: targets.control.kind },
        challenger: { url: targets.challenger.url.toString(), kind: targets.challenger.kind },
      },
    };
  }

  private async readEvidence(project: ReplayQaProject): Promise<ReplayExecutionResult> {
    const bugPayload = await this.request("GET", `/projects/${encodeURIComponent(project.id)}/bugs?status=open&page=1&page_size=100`);
    const openBugs = rows(bugPayload);
    const evidence: Partial<Record<ReplayJourneyId, ReplayJourneyEvidence>> = {};
    const journeys: ReplayExecutionResult["journeys"] = {};
    const recordings: string[] = [];

    for (const journey of REPLAY_QA_MATRIX) {
      const providerJourneyId = project.journeys[journey];
      const target = journey.startsWith("b_") ? project.targets.challenger : project.targets.control;
      const participantUrl = target.url;
      if (!providerJourneyId) {
        journeys[journey] = "missing";
        evidence[journey] = { participant_url: participantUrl, target_kind: target.kind, status: "missing" };
        continue;
      }
      const runPayload = await this.request("GET", `/projects/${encodeURIComponent(project.id)}/test-runs?journey_id=${encodeURIComponent(providerJourneyId)}&page=1&page_size=20`);
      const runs = rows(runPayload);
      const latest = runs[0];
      const statusText = textField(latest, ["status", "state", "result"])?.toLowerCase();
      const replay = recordingUrl(latest);
      if (replay) recordings.push(replay);
      const status = !latest
        ? "missing"
        : statusText && FAILURE_STATUSES.has(statusText)
          ? "failed"
          : statusText && SUCCESS_STATUSES.has(statusText) && replay
            ? "passed"
            : "missing";
      journeys[journey] = status;
      evidence[journey] = {
        participant_url: participantUrl,
        target_kind: target.kind,
        ...(replay ? { recording_url: replay } : {}),
        provider_journey_id: providerJourneyId,
        status,
      };
    }

    const allPassed = REPLAY_QA_MATRIX.every((journey) => journeys[journey] === "passed");
    return {
      status: openBugs.length > 0 || Object.values(journeys).includes("failed") ? "failed" : allPassed ? "passed" : "missing",
      run_url: recordings[0] ?? project.url,
      blocking_findings: openBugs.length,
      journeys,
      evidence,
      provider: "replay_qa",
      project_id: project.id,
    };
  }

  async waitForParticipantProject(project: ReplayQaProject): Promise<ReplayExecutionResult> {
    const deadline = Date.now() + this.timeoutMs;
    let last = await this.readEvidence(project);
    while (Date.now() < deadline && last.status === "missing") {
      await this.sleep(this.pollIntervalMs);
      last = await this.readEvidence(project);
    }
    return last;
  }

  async run(input: {
    job_id: string;
    control_url: string;
    challenger_url: string;
    journeys: readonly ReplayJourneyId[];
  }): Promise<ReplayExecutionResult> {
    if (input.journeys.length !== REPLAY_QA_MATRIX.length || REPLAY_QA_MATRIX.some((journey) => !input.journeys.includes(journey))) {
      throw new ReplayGateError("REPLAY_QA_MATRIX_INVALID", "Replay QA requires the complete participant journey matrix");
    }
    const project = await this.createParticipantProject(input);
    return this.waitForParticipantProject(project);
  }
}

export function runtimeReplayQaRestAdapter(env: NodeJS.ProcessEnv = process.env): ReplayQaRestAdapter {
  const token = env.REPLAY_QA_API_TOKEN;
  if (!token) throw new ReplayGateError("REPLAY_QA_TOKEN_MISSING", "REPLAY_QA_API_TOKEN is required");
  return new ReplayQaRestAdapter({
    token,
    baseUrl: env.REPLAY_QA_BASE_URL,
    pollIntervalMs: env.REPLAY_QA_POLL_INTERVAL_MS ? Number(env.REPLAY_QA_POLL_INTERVAL_MS) : undefined,
    timeoutMs: env.REPLAY_QA_TIMEOUT_SECONDS ? Number(env.REPLAY_QA_TIMEOUT_SECONDS) * 1_000 : undefined,
    budget: env.REPLAY_QA_CREDIT_BUDGET ? Number(env.REPLAY_QA_CREDIT_BUDGET) : undefined,
    finishedWebhookUrl: env.REPLAY_QA_FINISHED_WEBHOOK_URL,
    allowedPreviewHosts: env.REPLAY_QA_ALLOWED_PREVIEW_HOSTS
      ?.split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  });
}
