import { isDashboardRequestAuthorized } from "./auth";

export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

export function jsonOk(data: unknown, init?: ResponseInit): Response {
  return Response.json(
    { ok: true, data },
    { ...init, headers: { ...PRIVATE_NO_STORE_HEADERS, ...init?.headers } },
  );
}

export function jsonError(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { ok: false, error: { code, message } },
    { status, headers: PRIVATE_NO_STORE_HEADERS },
  );
}

export async function requireDashboardAccess(
  request: Request,
): Promise<Response | null> {
  return (await isDashboardRequestAuthorized(request))
    ? null
    : jsonError(401, "UNAUTHORIZED", "Dashboard access required");
}

