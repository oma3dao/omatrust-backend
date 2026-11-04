import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { applyTestEnv } from "../helpers/env.ts";
import {
  applyCorsHeaders,
  corsPreflightResponse,
  getAllowedCorsOrigin
} from "@/lib/http/cors";
import { middleware } from "@/middleware";

const ALLOWED_ORIGIN = "https://app.omatrust.org";
const LOCAL_ORIGIN = "http://localhost:3000";

applyTestEnv({
  OMATRUST_ALLOWED_CORS_ORIGINS: `${ALLOWED_ORIGIN},${LOCAL_ORIGIN}`
});

/**
 * The session cookie is sent with credentials: "include", so the CORS
 * allowlist is what decides which sites can make authenticated calls on a
 * signed-in user's behalf. Matching must stay exact.
 */

function requestFrom(origin: string | null, method = "GET") {
  return new Request("https://backend.omatrust.test/api/private/session/me", {
    method,
    headers: origin ? { origin } : {}
  });
}

test("no Origin header means no cross-origin grant", () => {
  assert.equal(getAllowedCorsOrigin(requestFrom(null)), null);
});

test("an allowlisted origin is echoed back", () => {
  assert.equal(getAllowedCorsOrigin(requestFrom(ALLOWED_ORIGIN)), ALLOWED_ORIGIN);
  assert.equal(getAllowedCorsOrigin(requestFrom(LOCAL_ORIGIN)), LOCAL_ORIGIN);
});

test("an unknown origin is not granted", () => {
  assert.equal(getAllowedCorsOrigin(requestFrom("https://evil.example.com")), null);
});

test("near-miss origins are not granted", () => {
  const nearMisses = [
    `${ALLOWED_ORIGIN}/`,
    "http://app.omatrust.org",
    "https://app.omatrust.org:8443",
    "https://app.omatrust.org.evil.example.com",
    "https://APP.omatrust.org"
  ];

  for (const origin of nearMisses) {
    assert.equal(
      getAllowedCorsOrigin(requestFrom(origin)),
      null,
      `${origin} must not be treated as allowlisted`
    );
  }
});

test("responses always vary on Origin so caches cannot serve a cross-origin hit", () => {
  const allowed = applyCorsHeaders(NextResponse.next(), requestFrom(ALLOWED_ORIGIN));
  const denied = applyCorsHeaders(NextResponse.next(), requestFrom("https://evil.example.com"));

  assert.match(allowed.headers.get("vary") ?? "", /Origin/);
  assert.match(denied.headers.get("vary") ?? "", /Origin/);
});

test("an allowlisted origin receives the credentialed CORS grant", () => {
  const response = applyCorsHeaders(NextResponse.next(), requestFrom(ALLOWED_ORIGIN));

  assert.equal(response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET,POST,PATCH,OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "content-type");
});

test("a denied origin receives no CORS grant at all", () => {
  const response = applyCorsHeaders(NextResponse.next(), requestFrom("https://evil.example.com"));

  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
});

test("preflight answers 204 and only grants allowlisted origins", () => {
  const allowed = corsPreflightResponse(requestFrom(ALLOWED_ORIGIN, "OPTIONS"));
  const denied = corsPreflightResponse(requestFrom("https://evil.example.com", "OPTIONS"));

  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.equal(denied.status, 204);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("middleware short-circuits OPTIONS into a preflight response", () => {
  const response = middleware(
    new NextRequest("https://backend.omatrust.test/api/private/session/me", {
      method: "OPTIONS",
      headers: { origin: ALLOWED_ORIGIN }
    })
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
});

test("middleware decorates a normal request without blocking it", () => {
  const response = middleware(
    new NextRequest("https://backend.omatrust.test/api/private/session/me", {
      method: "GET",
      headers: { origin: ALLOWED_ORIGIN }
    })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});
