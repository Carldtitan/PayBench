import { getDashboardRepository } from "../../../../../../src/server/dashboard/demo-repository";
import {
  jsonError,
  requireDashboardAccess,
} from "../../../../../../src/server/dashboard/http";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const encoder = new TextEncoder();

function encodeEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const unauthorized = await requireDashboardAccess(request);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const events = await getDashboardRepository().listEvents(id);
  if (!events) return jsonError(404, "RUN_NOT_FOUND", "Run not found");

  // Demo data is finite. Send the known event ledger, mark the boundary, and
  // close instead of pretending that a live provider connection exists.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("retry: 15000\n\n"));
      for (const event of events) {
        controller.enqueue(encodeEvent("run_event", event));
      }
      controller.enqueue(
        encodeEvent("stream_end", { reason: "demo_complete" }),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

