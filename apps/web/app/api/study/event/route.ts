import {
  PARTICIPANT_COOKIE,
  StudyError,
  getStudyRepository,
  readCookie,
  type StudyEventName,
} from "../../../../src/server/study";

const ALLOWED_EVENTS = new Set<StudyEventName>([
  "page_view",
  "plan_selected",
  "checkout_opened",
  "review_opened",
  "stop_selected",
  "simulated_purchase_completed",
  "survey_submitted",
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { event?: unknown };
    if (typeof body.event !== "string" || !ALLOWED_EVENTS.has(body.event as StudyEventName)) {
      throw new StudyError("EVENT_INVALID", 400);
    }
    const repository = await getStudyRepository();
    await repository.recordEvent(
      readCookie(request, PARTICIPANT_COOKIE),
      body.event as StudyEventName,
    );
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const studyError = error instanceof StudyError ? error : new StudyError("EVENT_UNAVAILABLE", 503);
    return Response.json({ ok: false, error: { code: studyError.code } }, { status: studyError.status });
  }
}
