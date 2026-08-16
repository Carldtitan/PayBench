import {
  replayResumeError,
  resumeReplayQaJob,
  runtimeReplayResumeDependencies,
} from "../../../../src/server/engine/replay-resume";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function projectIdHint(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const direct = [row.project_id, row.projectId, row.id]
    .find((candidate): candidate is string => typeof candidate === "string");
  const nested = row.project && typeof row.project === "object" && !Array.isArray(row.project)
    ? (row.project as Record<string, unknown>).id
    : undefined;
  const id = direct ?? (typeof nested === "string" ? nested : undefined);
  return id && /^[A-Za-z0-9_-]{3,200}$/.test(id) ? id : undefined;
}

/**
 * Replay may call this URL when an exploration changes state. The payload is
 * deliberately treated only as a wake-up hint: PayBench ignores every claimed
 * status/bug/result field and pulls the project from Replay QA again.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const payload: unknown = await request.json();
    const projectId = projectIdHint(payload);
    if (!projectId) {
      return Response.json({ ok: false, error: { code: "REPLAY_WEBHOOK_PROJECT_MISSING" } }, { status: 400 });
    }
    const dependencies = await runtimeReplayResumeDependencies();
    const [gate] = await dependencies.transport.request("GET", "quality_gate_runs", {
      replay_run_id: `eq.${projectId}`,
      select: "job_id,artifact_bundle_hash",
      limit: "1",
    });
    if (!gate || typeof gate.job_id !== "string" || typeof gate.artifact_bundle_hash !== "string") {
      return Response.json({ ok: false, error: { code: "REPLAY_WEBHOOK_PROJECT_UNKNOWN" } }, { status: 404 });
    }
    const result = await resumeReplayQaJob({
      job_id: gate.job_id,
      artifact_bundle_hash: gate.artifact_bundle_hash,
      project_id: projectId,
    }, dependencies);
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
