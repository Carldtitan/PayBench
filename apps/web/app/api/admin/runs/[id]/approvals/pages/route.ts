import { StudyError, getStudyRepository } from "../../../../../../../src/server/study";
import { jsonError, jsonOk, requireDashboardAccess } from "../../../../../../../src/server/dashboard/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const unauthorized = await requireDashboardAccess(request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const repository = getStudyRepository();
  if (repository.dashboardStatus().job_id !== id) return jsonError(404, "RUN_NOT_FOUND", "Run not found");
  try {
    const body = (await request.json()) as { artifact_bundle_hash?: unknown };
    if (typeof body.artifact_bundle_hash !== "string") throw new StudyError("APPROVAL_HASH_REQUIRED", 400);
    return jsonOk(repository.approve("pages", body.artifact_bundle_hash));
  } catch (error) {
    const studyError = error instanceof StudyError ? error : new StudyError("APPROVAL_FAILED", 503);
    return jsonError(studyError.status, studyError.code, "Page approval failed");
  }
}
