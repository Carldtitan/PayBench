import {
  replayResumeError,
  resumeReplayQaJob,
  runtimeReplayResumeDependencies,
  verifyReplayResumeAuthorization,
} from "../../../../src/server/engine/replay-resume";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    verifyReplayResumeAuthorization(request.headers.get("authorization"), process.env.WORKER_CALLBACK_SECRET);
    const body: unknown = await request.json();
    const result = await resumeReplayQaJob(body, await runtimeReplayResumeDependencies());
    return Response.json({ ok: true, ...result }, {
      status: result.status === "qa_pending" ? 202 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (cause) {
    const error = replayResumeError(cause);
    return Response.json({ ok: false, error: { code: error.code } }, {
      status: error.status,
      headers: { "cache-control": "no-store" },
    });
  }
}

