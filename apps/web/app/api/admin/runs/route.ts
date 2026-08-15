import { getDashboardRepository } from "../../../../src/server/dashboard/demo-repository";
import {
  jsonOk,
  requireDashboardAccess,
} from "../../../../src/server/dashboard/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireDashboardAccess(request);
  if (unauthorized) return unauthorized;

  return jsonOk(await getDashboardRepository().listRuns());
}

