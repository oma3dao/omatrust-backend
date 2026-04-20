import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { applyCorsHeaders, corsPreflightResponse } from "@/lib/http/cors";

export function middleware(request: NextRequest) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }

  return applyCorsHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: ["/api/:path*"]
};
