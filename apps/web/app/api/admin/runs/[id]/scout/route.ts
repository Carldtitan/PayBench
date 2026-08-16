import {
  jsonError,
  jsonOk,
  requireDashboardAccess,
} from "../../../../../../src/server/dashboard/http";
import {
  ScoutError,
  getOperatorScoutTask,
  getScoutTaskRepository,
} from "../../../../../../src/server/scout";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const unauthorized = await requireDashboardAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    return jsonOk(await getOperatorScoutTask(await getScoutTaskRepository(), id));
  } catch (error) {
    const known = error instanceof ScoutError ? error : new ScoutError("SCOUT_TASK_UNAVAILABLE", 503);
    return jsonError(known.status, known.code, "Scout task unavailable");
  }
}
