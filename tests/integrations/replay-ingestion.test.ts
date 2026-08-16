import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { REPLAY_QA_MATRIX, type ReplayJourneyId } from "../../apps/web/src/server/engine/replay";
import {
  ingestReplayResult,
  ReplayIngestionError,
  type ReplayResultTransport,
} from "../../apps/web/src/server/engine/replay-ingestion";

const secret = "test-worker-callback-secret-with-enough-entropy";
const now = 1_787_000_000;
const jobId = "02eb2619-c2ca-4a53-a27a-e401b141e50e";
const artifactHash = "a".repeat(64);

class MemoryTransport implements ReplayResultTransport {
  readonly webhooks = new Map<string, Record<string, unknown>>();
  readonly job: Record<string, unknown> = {
    id: jobId,
    artifact_bundle_hash: artifactHash,
    payment_status: "paid",
    status: "qa_replay",
  };
  readonly gate: Record<string, unknown> = {
    id: "gate-id",
    checks_json: {
      control_matches_source: true,
      challenger_has_exactly_one_change: true,
      locked_facts_match: true,
      pages_approved: false,
      quote_approved: false,
      founder_payment_confirmed: true,
      terac_credit_funding_confirmed: false,
    },
    gate_open: false,
  };

  async request(
    method: "GET" | "POST" | "PATCH",
    table: string,
    query: Readonly<Record<string, string>> = {},
    body?: unknown,
  ): Promise<readonly Record<string, unknown>[]> {
    const patch = body as Record<string, unknown> | undefined;
    if (table === "webhook_events") {
      const eventId = String(patch?.external_event_id ?? query.external_event_id?.replace(/^eq\./, ""));
      if (method === "POST") {
        if (this.webhooks.has(eventId)) throw new Error("duplicate");
        this.webhooks.set(eventId, { ...patch });
        return [];
      }
      if (method === "GET") return this.webhooks.has(eventId) ? [this.webhooks.get(eventId)!] : [];
      Object.assign(this.webhooks.get(eventId) ?? {}, patch);
      return [];
    }
    if (table === "jobs") {
      if (method === "GET") return query.id === `eq.${jobId}` ? [this.job] : [];
      Object.assign(this.job, patch);
      return [];
    }
    if (table === "quality_gate_runs") {
      if (method === "GET") return [this.gate];
      Object.assign(this.gate, patch);
      return [];
    }
    throw new Error(`unexpected ${table}`);
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  const journeys = Object.fromEntries(
    REPLAY_QA_MATRIX.map((id) => [id, "passed"]),
  ) as Record<ReplayJourneyId, "passed">;
  return JSON.stringify({
    job_id: jobId,
    artifact_bundle_hash: artifactHash,
    status: "passed",
    run_url: "https://app.replay.io/recording/paybench-demo",
    blocking_findings: 0,
    journeys,
    ...overrides,
  });
}

function headers(body: string, eventId = "replay-run-1") {
  const timestamp = String(now);
  const signature = createHmac("sha256", secret)
    .update(`${eventId}.${timestamp}.${body}`)
    .digest("hex");
  return { eventId, timestamp, signature: `sha256=${signature}` };
}

describe("signed Replay result ingestion", () => {
  it("records all twelve passed journeys but keeps the hard gate closed for approvals and credits", async () => {
    const transport = new MemoryTransport();
    const body = payload();
    await expect(ingestReplayResult(body, headers(body), transport, { secret, nowSeconds: now })).resolves.toEqual({
      duplicate: false,
      replay_passed: true,
      gate_open: false,
    });
    expect(transport.gate).toMatchObject({
      replay_run_url: "https://app.replay.io/recording/paybench-demo",
      replay_blocking_findings: 0,
      gate_open: false,
    });
    expect(transport.job).toMatchObject({ status: "awaiting_approvals", failure_code: null });
  });

  it("fails closed for one missing journey or any blocking finding", async () => {
    const transport = new MemoryTransport();
    const missing = Object.fromEntries(REPLAY_QA_MATRIX.map((id) => [id, id === "mocked_terac_redirect" ? "missing" : "passed"]));
    const body = payload({ journeys: missing, blocking_findings: 1 });
    const result = await ingestReplayResult(body, headers(body), transport, { secret, nowSeconds: now });
    expect(result.replay_passed).toBe(false);
    expect(transport.gate.gate_open).toBe(false);
    expect(transport.job).toMatchObject({ status: "qa_replay", failure_code: "REPLAY_QA_BLOCKED" });
  });

  it("rejects bad signatures, stale artifact hashes, and duplicate delivery", async () => {
    const transport = new MemoryTransport();
    const body = payload();
    await expect(ingestReplayResult(body, { ...headers(body), signature: "sha256=" + "0".repeat(64) }, transport, { secret, nowSeconds: now })).rejects.toMatchObject<Partial<ReplayIngestionError>>({ code: "REPLAY_RESULT_SIGNATURE_INVALID" });

    const staleBody = payload({ artifact_bundle_hash: "b".repeat(64) });
    await expect(ingestReplayResult(staleBody, headers(staleBody, "stale-run"), transport, { secret, nowSeconds: now })).rejects.toMatchObject<Partial<ReplayIngestionError>>({ code: "REPLAY_ARTIFACT_STALE" });

    await ingestReplayResult(body, headers(body, "once"), transport, { secret, nowSeconds: now });
    await expect(ingestReplayResult(body, headers(body, "once"), transport, { secret, nowSeconds: now })).resolves.toMatchObject({ duplicate: true });
  });
});
