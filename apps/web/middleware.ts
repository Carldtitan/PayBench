import { NextResponse, type NextRequest } from "next/server";
import {
  DASHBOARD_SESSION_COOKIE,
  accessKeyMatches,
  dashboardSessionToken,
} from "./src/server/dashboard/auth";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (
    authorization?.startsWith("Bearer ") &&
    (await accessKeyMatches(authorization.slice(7)))
  ) {
    return true;
  }

  const accessKey = process.env.DASHBOARD_ACCESS_KEY;
  const session = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  if (!accessKey || !session) return false;
  return session === (await dashboardSessionToken(accessKey));
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/admin/session") {
    return NextResponse.next();
  }

  if (await isAuthorized(request)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Dashboard access required" },
      },
      { status: 401 },
    );
  }

  return new NextResponse("Dashboard access required", {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

