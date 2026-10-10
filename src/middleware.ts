import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifySession } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  if (await verifySession(req.cookies.get(COOKIE)?.value, process.env.AUTH_SECRET)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

// Webhook, cron and login are public (they have their own auth).
export const config = { matcher: ["/((?!api/webhooks|api/cron|login|_next|favicon.ico).*)"] };
