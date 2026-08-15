import {
  StudyError,
  getStudyRepository,
} from "../../../../../../src/server/study";
import {
  jsonError,
  jsonOk,
  requireDashboardAccess,
} from "../../../../../../src/server/dashboard/http";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const unauthorized = await requireDashboardAccess(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const repository = getStudyRepository();
  try {
    const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
    const status = repository.dashboardStatus(baseUrl);
    return status.job_id === id ? jsonOk(status) : jsonError(404, "RUN_NOT_FOUND", "Run not found");
  } catch (error) {
    const code = error instanceof StudyError ? error.code : "STUDY_STATUS_UNAVAILABLE";
    return jsonError(503, code, "Study status unavailable");
  }
}
