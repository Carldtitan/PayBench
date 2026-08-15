import { StudyError, getStudyRepository } from "../../../../../../../src/server/study";
import { jsonError, jsonOk, requireDashboardAccess } from "../../../../../../../src/server/dashboard/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const unauthorized = await requireDashboardAccess(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const repository = await getStudyRepository();
  try {
    return jsonOk(await repository.unlockMain(id));
  } catch (error) {
    const studyError = error instanceof StudyError ? error : new StudyError("PILOT_UNLOCK_FAILED", 503);
    return jsonError(studyError.status, studyError.code, "Pilot review is not ready");
  }
}
