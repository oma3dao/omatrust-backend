import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { applyCorsHeaders, corsPreflightResponse } from "@/lib/http/cors";

export function middleware(request: NextRequest) {
  try {
    if (request.method === "OPTIONS") {
      return corsPreflightResponse(request);
    }

    return applyCorsHeaders(NextResponse.next(), request);
  } catch (error: unknown) {
    // If CORS/env validation throws (e.g. bad env vars), we still need to
    // return a proper response with CORS headers so the browser can read it.
    const message =
      error instanceof Error ? error.message : "Internal server configuration error";

    const response = NextResponse.json(
      {
        error: "Something went wrong on our end. Please report this issue using the link at the top of the page.",
        code: "CONFIG_ERROR",
        details: message
      },
      { status: 500 }
    );

    // Apply permissive CORS headers so the browser can actually read the error.
    // We can't call the normal CORS logic since that's what may have thrown.
    const origin = request.headers.get("origin");
    if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
      response.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "content-type");
    }

    return response;
  }
}

export const config = {
  matcher: ["/api/:path*"]
};
