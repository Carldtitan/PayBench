import { handleLinqWebhook } from "../../../../src/server/control/linq";
import { getControlRepository } from "../../../../src/server/control/supabase-repository";
import { ControlError } from "../../../../src/server/control/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  try {
    const result = await handleLinqWebhook(
      rawBody,
      {
        id: request.headers.get("webhook-id"),
        timestamp: request.headers.get("webhook-timestamp"),
        signature: request.headers.get("webhook-signature"),
      },
      await getControlRepository(),
    );
    // `reply` is a recorded outbound intent for a future dispatcher. This route
    // never calls Linq's send API.
    return Response.json({ received: true, ...result });
  } catch (error) {
    const status = error instanceof ControlError ? error.status : 500;
    const code = error instanceof ControlError ? error.code : "LINQ_WEBHOOK_FAILED";
    return Response.json({ received: false, error: { code } }, { status });
  }
}

