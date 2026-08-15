import { getDashboardRepository } from "../../../../../src/server/dashboard/demo-repository";
import {
  jsonError,
  jsonOk,
  requireDashboardAccess,
} from "../../../../../src/server/dashboard/http";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const unauthorized = await requireDashboardAccess(request);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const run = await getDashboardRepository().getRun(id);
  return run
    ? jsonOk(run)
    : jsonError(404, "RUN_NOT_FOUND", "Run not found");
}

