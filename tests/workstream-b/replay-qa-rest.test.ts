import { describe, expect, it } from "vitest";

import { REPLAY_QA_MATRIX } from "../../apps/web/src/server/engine/replay";
import {
  ReplayQaRestAdapter,
  assertReplayParticipantTargets,
} from "../../apps/web/src/server/engine/replay-qa-rest";

const token = `lqa_${"a".repeat(32)}`;
const controlUrl = "https://a.preview.superserve.ai/workspace/control?signed=control";
const challengerUrl = "https://b.preview.superserve.ai/workspace/challenger?signed=challenger";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function replayApi(options: { missingJourney?: string; bugCount?: number } = {}) {
  const requests: Array<{ url: URL; init?: RequestInit; body?: Record<string, unknown> }> = [];
  const journeyIds = new Map<string, string>();
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ url, init, body });
    if (init?.method === "POST" && url.pathname.endsWith("/projects")) {
      return json({ project_id: "project-paybench", url: "https://qa.replay.io/projects/project-paybench" });
    }
    if (init?.method === "POST" && url.pathname.endsWith("/journeys")) {
      const name = String(body?.name);
      const id = `journey-${name}`;
      journeyIds.set(name, id);
      return json({ journey_id: id }, 201);
    }
    if (url.pathname.endsWith("/bugs")) {
      return json({ items: Array.from({ length: options.bugCount ?? 0 }, (_, index) => ({ id: `bug-${index}` })) });
    }
    if (url.pathname.endsWith("/test-runs")) {
      return json({
        items: [...journeyIds.entries()]
          .filter(([name]) => name !== options.missingJourney)
          .map(([, journeyId]) => ({
          journey_id: journeyId,
          status: "completed",
          recording_id: "11111111-1111-4111-8111-111111111111",
        })),
      });
    }
    return json({ error: "unexpected" }, 404);
  };
  return { fetcher, requests };
}

describe("Replay QA REST participant-page adapter", () => {
  it("rejects the PayBench homepage and an ambiguous neutral link", () => {
    expect(() => assertReplayParticipantTargets("https://paybench.vercel.app/", challengerUrl)).toThrowError(
      expect.objectContaining({ code: "REPLAY_PARTICIPANT_URL_INVALID" }),
    );
    const study = `https://paybench.vercel.app/s/pbx_${"a".repeat(32)}`;
    expect(() => assertReplayParticipantTargets(study, study)).toThrowError(
      expect.objectContaining({ code: "REPLAY_PARTICIPANT_TARGETS_AMBIGUOUS" }),
    );
  });

  it("creates one project and twelve agent-driven journeys against only signed A/B preview URLs", async () => {
    const api = replayApi();
    const adapter = new ReplayQaRestAdapter({
      token,
      fetcher: api.fetcher,
      timeoutMs: 0,
    });
    const result = await adapter.run({
      job_id: "02eb2619-c2ca-4a53-a27a-e401b141e50e",
      control_url: controlUrl,
      challenger_url: challengerUrl,
      journeys: REPLAY_QA_MATRIX,
    });

    expect(result).toMatchObject({
      status: "passed",
      blocking_findings: 0,
      provider: "replay_qa",
      project_id: "project-paybench",
    });
    const writes = api.requests.filter((request) => request.init?.method === "POST");
    expect(writes).toHaveLength(13);
    expect(writes[0]?.body?.target_url).toBe(controlUrl);
    const journeyWrites = writes.slice(1);
    expect(journeyWrites.map((request) => request.body?.name)).toEqual(REPLAY_QA_MATRIX);
    expect(journeyWrites.filter((request) => String(request.body?.name).startsWith("b_")).every((request) => request.body?.target_url === challengerUrl)).toBe(true);
    expect(journeyWrites.filter((request) => !String(request.body?.name).startsWith("b_")).every((request) => request.body?.target_url === controlUrl)).toBe(true);
    expect(api.requests.every((request) => request.url.hostname === "loop-qa.replay.io")).toBe(true);
    expect(api.requests.every((request) => request.url.hostname !== "terac.com")).toBe(true);
    expect(Object.values(result.evidence ?? {}).every((item) => item?.recording_url?.startsWith("https://app.replay.io/recording/"))).toBe(true);
  });

  it("fails closed when one required recording is missing or Replay reports a bug", async () => {
    const missingApi = replayApi({ missingJourney: "b_mobile_purchase" });
    const missingAdapter = new ReplayQaRestAdapter({ token, fetcher: missingApi.fetcher, timeoutMs: 0 });
    const missing = await missingAdapter.run({
      job_id: "02eb2619-c2ca-4a53-a27a-e401b141e50e",
      control_url: controlUrl,
      challenger_url: challengerUrl,
      journeys: REPLAY_QA_MATRIX,
    });
    expect(missing.status).toBe("missing");
    expect(missing.journeys.b_mobile_purchase).toBe("missing");

    const bugApi = replayApi({ bugCount: 1 });
    const bugAdapter = new ReplayQaRestAdapter({ token, fetcher: bugApi.fetcher, timeoutMs: 0 });
    const blocked = await bugAdapter.run({
      job_id: "02eb2619-c2ca-4a53-a27a-e401b141e50e",
      control_url: controlUrl,
      challenger_url: challengerUrl,
      journeys: REPLAY_QA_MATRIX,
    });
    expect(blocked).toMatchObject({ status: "failed", blocking_findings: 1 });
  });
});
