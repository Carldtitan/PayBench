import {
  accessKeyMatches,
  clearDashboardSessionCookie,
  dashboardSessionCookie,
  dashboardSessionToken,
  normalizeDashboardAccessKey,
} from "../../../../src/server/dashboard/auth";
import { jsonError, jsonOk } from "../../../../src/server/dashboard/http";

export const dynamic = "force-dynamic";

interface SessionRequestBody {
  /** The operator-only DASHBOARD_ACCESS_KEY. Never store this in client code. */
  access_key: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: SessionRequestBody;
  try {
    body = (await request.json()) as SessionRequestBody;
  } catch {
    return jsonError(400, "INVALID_REQUEST", "Enter the dashboard access key");
  }

  const normalizedAccessKey =
    typeof body.access_key === "string"
      ? normalizeDashboardAccessKey(body.access_key)
      : "";

  if (
    typeof body.access_key !== "string" ||
    body.access_key.length > 256 ||
    !(await accessKeyMatches(normalizedAccessKey))
  ) {
    return jsonError(401, "INVALID_ACCESS_KEY", "Access key not accepted");
  }

  const response = jsonOk({ authenticated: true });
  response.headers.set(
    "Set-Cookie",
    dashboardSessionCookie(await dashboardSessionToken(normalizedAccessKey)),
  );
  return response;
}

export async function DELETE(): Promise<Response> {
  const response = jsonOk({ authenticated: false });
  response.headers.set("Set-Cookie", clearDashboardSessionCookie());
  return response;
}
