import { NextResponse } from "next/server";
import { getEnv, parseCsv } from "@/lib/config/env";

const ALLOW_METHODS = "GET,POST,PATCH,OPTIONS";
const ALLOW_HEADERS = "content-type";

export function getAllowedCorsOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return null;
  }

  const allowedOrigins = parseCsv(getEnv().OMATRUST_ALLOWED_CORS_ORIGINS);

  return allowedOrigins.includes(origin) ? origin : null;
}

export function applyCorsHeaders(response: NextResponse, request: Request) {
  const allowedOrigin = getAllowedCorsOrigin(request);

  response.headers.append("Vary", "Origin");

  if (!allowedOrigin) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);

  return response;
}

export function corsPreflightResponse(request: Request) {
  return applyCorsHeaders(new NextResponse(null, { status: 204 }), request);
}
