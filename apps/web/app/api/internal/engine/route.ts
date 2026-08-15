import { timingSafeEqual } from "node:crypto";
import { buildPaywallVariants, PaywallValidationError } from "../../../../../../packages/paywall/src";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.WORKER_CALLBACK_SECRET;
  const candidate = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !candidate) return false;
  const left = Buffer.from(secret);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Internal engine access required" } }, { status: 401 });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 1_000_000) {
    return Response.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Engine payload is too large" } }, { status: 413 });
  }
  try {
    const raw = await request.text();
    if (raw.length > 1_000_000) {
      return Response.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Engine payload is too large" } }, { status: 413 });
    }
    const body = JSON.parse(raw) as { action?: unknown; spec?: unknown; change_plan?: unknown };
    if (body.action !== "build_variants") {
      return Response.json({ ok: false, error: { code: "ACTION_INVALID", message: "Unknown engine action" } }, { status: 400 });
    }
    const result = buildPaywallVariants(body.spec, body.change_plan);
    return Response.json({ ok: true, data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof PaywallValidationError ? error.code : "ENGINE_REQUEST_INVALID";
    return Response.json({ ok: false, error: { code, message: "Engine request failed validation" } }, { status: 400 });
  }
}
