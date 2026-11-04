import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { applyTestEnv } from "../helpers/env.ts";
import { middleware } from "@/middleware";

const ORIGIN = "https://app.omatrust.org";

// Deliberately invalid: the session secret is below the 32-character minimum,
// so the first getEnv() call inside the CORS helper throws.
applyTestEnv({
  OMATRUST_SESSION_SECRET: "too-short",
  OMATRUST_ALLOWED_CORS_ORIGINS: ORIGIN
});

/**
 * A bad environment variable in a deployed environment is the one failure the
 * middleware cannot report through the normal CORS path, because the CORS path
 * is what threw. Without the fallback headers the browser blocks the response
 * and the operator sees an opaque network error instead of the real cause.
 */

function requestFrom(origin: string | null, method = "GET") {
  return new NextRequest("https://backend.omatrust.test/api/private/session/me", {
    method,
    headers: origin ? { origin } : {}
  });
}

test("a misconfigured environment answers 500 CONFIG_ERROR instead of throwing", async () => {
  const response = middleware(requestFrom(ORIGIN));
  const body = (await response.json()) as { error: string; code: string; details: string };

  assert.equal(response.status, 500);
  assert.equal(body.code, "CONFIG_ERROR");
  assert.equal(
    body.error,
    "Something went wrong on our end. Please report this issue using the link at the top of the page."
  );
});

test("the configuration failure names the offending variable for the operator", async () => {
  const response = middleware(requestFrom(ORIGIN));
  const body = (await response.json()) as { details: string };

  assert.match(body.details, /Environment configuration is invalid/);
  assert.match(body.details, /OMATRUST_SESSION_SECRET/);
});

test("the error response still carries CORS headers so the browser can read it", () => {
  const response = middleware(requestFrom(ORIGIN));

  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("a request with no Origin passes through, because the config is never read", () => {
  // getAllowedCorsOrigin returns early when there is no Origin header, so the
  // invalid configuration is never parsed at this layer. The request proceeds
  // and fails later inside the route instead, which means a broken environment
  // shows up as a CORS-shaped 500 for browsers but as a route error for
  // server-to-server callers.
  const response = middleware(requestFrom(null));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("a preflight against a misconfigured backend also fails safely", () => {
  const response = middleware(requestFrom(ORIGIN, "OPTIONS"));

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
});
