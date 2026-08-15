export const DASHBOARD_SESSION_COOKIE = "paybench_dashboard_session";

const encoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

export async function dashboardSessionToken(accessKey: string): Promise<string> {
  return sha256(`paybench-dashboard-session:${accessKey}`);
}

export async function accessKeyMatches(candidate: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_ACCESS_KEY;
  if (!expected || !candidate) return false;
  const [candidateDigest, expectedDigest] = await Promise.all([
    sha256(`paybench-dashboard-access:${candidate}`),
    sha256(`paybench-dashboard-access:${expected}`),
  ]);
  return constantTimeEqual(candidateDigest, expectedDigest);
}

export async function isDashboardRequestAuthorized(
  request: Request,
): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    if (await accessKeyMatches(authorization.slice(7))) return true;
  }

  const expected = process.env.DASHBOARD_ACCESS_KEY;
  const session = readCookie(request, DASHBOARD_SESSION_COOKIE);
  if (!expected || !session) return false;
  return constantTimeEqual(session, await dashboardSessionToken(expected));
}

export function dashboardSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`;
}

export function clearDashboardSessionCookie(): string {
  return `${DASHBOARD_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

