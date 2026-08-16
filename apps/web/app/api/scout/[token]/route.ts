import {
  ScoutError,
  getScoutTaskRepository,
  submitScoutTask,
} from "../../../../src/server/scout";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

function errorResponse(error: unknown): Response {
  const known = error instanceof ScoutError ? error : new ScoutError("SCOUT_SUBMISSION_FAILED", 503);
  return Response.json(
    { ok: false, error: { code: known.code } },
    { status: known.status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 100_000) throw new ScoutError("SCOUT_SUBMISSION_TOO_LARGE", 413);
    const raw = await request.text();
    if (raw.length > 100_000) throw new ScoutError("SCOUT_SUBMISSION_TOO_LARGE", 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ScoutError("SCOUT_SUBMISSION_INVALID", 400);
    }
    const { token } = await context.params;
    const result = await submitScoutTask(await getScoutTaskRepository(), token, body);
    return Response.json(
      { ok: true, data: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
