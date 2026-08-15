import {
  PARTICIPANT_COOKIE,
  StudyError,
  getStudyRepository,
  participantCookieHeader,
  readCookie,
} from "../../../../src/server/study";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown): Response {
  const studyError = error instanceof StudyError ? error : new StudyError("STUDY_UNAVAILABLE", 503);
  return Response.json(
    { ok: false, error: { code: studyError.code } },
    { status: studyError.status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { token?: unknown; teracSubmissionId?: unknown };
    if (typeof body.token !== "string") throw new StudyError("STUDY_NOT_FOUND", 404);
    const result = getStudyRepository().claimSession({
      token: body.token,
      cookie_value: readCookie(request, PARTICIPANT_COOKIE),
      terac_submission_id: typeof body.teracSubmissionId === "string" ? body.teracSubmissionId : undefined,
    });
    return Response.json(
      { ok: true, data: result.view },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Set-Cookie": participantCookieHeader(result.cookie_value),
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
