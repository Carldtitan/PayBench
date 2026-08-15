import { createFounderJob } from "../../../src/server/control/jobs";
import { getControlRepository } from "../../../src/server/control/supabase-repository";
import { ControlError } from "../../../src/server/control/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: { website_url?: unknown; target_customer_description?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: { code: "INVALID_JSON", message: "Enter a website and target customer" } }, { status: 400 });
  }

  try {
    const data = await createFounderJob(body, await getControlRepository());
    return Response.json({ ok: true, data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ControlError ? error.status : 500;
    const code = error instanceof ControlError ? error.code : "JOB_CREATE_FAILED";
    return Response.json({ ok: false, error: { code, message: status >= 500 ? "PayBench is not ready yet" : "Check the website and target customer" } }, { status });
  }
}

