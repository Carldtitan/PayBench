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
  const repository = await getStudyRepository();
  try {
    const baseUrl = process.env.APP_BASE_URL ?? new URL(request.url).origin;
    const status = await repository.dashboardStatus(id, baseUrl);
    return jsonOk(status);
  } catch (error) {
    const code = error instanceof StudyError ? error.code : "STUDY_STATUS_UNAVAILABLE";
    return jsonError(503, code, "Study status unavailable");
  }
}
