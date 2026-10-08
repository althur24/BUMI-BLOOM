import { NextResponse, type NextRequest } from "next/server";

// Fase 1: lightweight edge gate.
// Enforces presence of an Authorization header on protected API routes.
// Deep JWT + role verification happens inside each Route Handler via
// lib/auth.requireAdmin() (which needs Prisma → Node runtime, not edge).
//
// Page-level session enforcement + login redirect land in Fase 3, when the
// Supabase Auth login UI ships and the Import tab is built.
export function middleware(request: NextRequest) {
  if (!request.headers.get("authorization")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/imports/:path*", "/api/analytics/:path*"],
};
