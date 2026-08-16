import {
  ingestReplayResult,
  ReplayIngestionError,
  runtimeReplayTransport,
} from "../../../../src/server/engine/replay-ingestion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  try {
    const result = await ingestReplayResult(
      rawBody,
      {
        eventId: request.headers.get("x-paybench-event-id"),
        timestamp: request.headers.get("x-paybench-timestamp"),
        signature: request.headers.get("x-paybench-signature"),
      },
      await runtimeReplayTransport(),
    );
    return Response.json({ received: true, ...result });
  } catch (error) {
    const status = error instanceof ReplayIngestionError ? error.status : 500;
    const code = error instanceof ReplayIngestionError ? error.code : "REPLAY_RESULT_FAILED";
    return Response.json({ received: false, error: { code } }, { status });
  }
}
