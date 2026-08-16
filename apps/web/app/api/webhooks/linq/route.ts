import { after } from "next/server";
import { handleLinqWebhook } from "../../../../src/server/control/linq";
import { deliverReplyToHealthyLinqChat } from "../../../../src/server/control/linq-report";
import { getControlRepository } from "../../../../src/server/control/supabase-repository";
import { ControlError } from "../../../../src/server/control/types";
import { runPaidJob } from "../../../../src/server/orchestration/paid-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  try {
    const repository = await getControlRepository();
    const result = await handleLinqWebhook(
      rawBody,
      {
        id: request.headers.get("webhook-id"),
        timestamp: request.headers.get("webhook-timestamp"),
        signature: request.headers.get("webhook-signature"),
      },
      repository,
      {
        dispatchReply: async ({ chat_id, message }) => {
          const delivery = await deliverReplyToHealthyLinqChat(chat_id, message);
          if (delivery.status === "blocked") {
            // A health/reputation block is final for this inbound event. API
            // failures throw and leave the webhook retriable.
            return;
          }
        },
      },
    );
    if (result.start_job_id) {
      const jobId = result.start_job_id;
      after(async () => {
        await runPaidJob(jobId);
      });
    }
    return Response.json({
      received: true,
      duplicate: result.duplicate,
      phase: result.phase,
      reply_sent: Boolean(result.reply),
      ...(result.reply_blocked_reason
        ? { reply_blocked_reason: result.reply_blocked_reason }
        : {}),
    });
  } catch (error) {
    const status = error instanceof ControlError ? error.status : 500;
    const code = error instanceof ControlError ? error.code : "LINQ_WEBHOOK_FAILED";
    return Response.json({ received: false, error: { code } }, { status });
  }
}
