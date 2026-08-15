import { getControlRepository } from "../../../../src/server/control/supabase-repository";
import { handleStripeWebhook } from "../../../../src/server/control/stripe";
import { ControlError } from "../../../../src/server/control/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  try {
    const result = await handleStripeWebhook(
      rawBody,
      request.headers.get("stripe-signature"),
      await getControlRepository(),
    );
    return Response.json({ received: true, duplicate: result.duplicate, action: result.action });
  } catch (error) {
    const status = error instanceof ControlError ? error.status : 500;
    const code = error instanceof ControlError ? error.code : "STRIPE_WEBHOOK_FAILED";
    return Response.json({ received: false, error: { code } }, { status });
  }
}

