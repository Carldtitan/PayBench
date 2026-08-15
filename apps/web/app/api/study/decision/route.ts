import {
  PARTICIPANT_COOKIE,
  StudyError,
  getStudyRepository,
  readCookie,
  type ParticipantDecisionInput,
} from "../../../../src/server/study";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ParticipantDecisionInput;
    if (body.decision !== "complete_simulated_purchase" && body.decision !== "stop") {
      throw new StudyError("DECISION_INVALID", 400);
    }
    const repository = await getStudyRepository();
    const completion = await repository.completeDecision(
      readCookie(request, PARTICIPANT_COOKIE),
      body,
    );
    return Response.json(
      { ok: true, data: completion },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const studyError = error instanceof StudyError ? error : new StudyError("DECISION_UNAVAILABLE", 503);
    return Response.json(
      { ok: false, error: { code: studyError.code } },
      { status: studyError.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
