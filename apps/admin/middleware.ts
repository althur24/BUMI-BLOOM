import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Page-level auth gate. API routes are excluded from the matcher — they are
// gated inside each route handler via requireAdmin() (which reads the same
// cookie session). This middleware:
//   1) refreshes the Supabase session cookie on every page load, and
//   2) redirects unauthenticated visitors to /login (and /login → /import
//      when already signed in).
const PUBLIC_PAGES = ["/login"];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response; // not configured → no gating (dev)

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
          request.cookies.set(name, value);
        });
      },
    },
  });

  // Refresh the session (rotates cookie on the response) + read the user.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && !PUBLIC_PAGES.includes(path)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }
  if (user && path === "/login") {
    const importUrl = request.nextUrl.clone();
    importUrl.pathname = "/import";
    return NextResponse.redirect(importUrl);
  }
  return response;
}

// Match everything except API routes, static assets, and Next internals.
// API routes are gated by requireAdmin() in their handlers.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
