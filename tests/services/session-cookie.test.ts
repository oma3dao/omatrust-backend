import test from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { applyTestEnv } from "../helpers/env.ts";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { clearSessionCookie, setSessionCookie } from "@/lib/services/session-service";

applyTestEnv({ OMATRUST_BACKEND_URL: "https://backend.omatrust.org" });

/**
 * Cookie attributes are the session's transport security: HttpOnly keeps the
 * token away from scripts, Secure keeps it off plaintext connections, and
 * SameSite decides which sites can ride on it. This asserts the real helpers
 * against a deployed-style backend URL; the localhost counterpart lives in
 * session-cookie-localhost.test.ts.
 */

const TOKEN = "header.payload.signature";
const EXPIRES_AT = "2026-12-31T23:59:59.000Z";

function setCookieHeader(apply: (response: NextResponse) => void) {
  const response = NextResponse.json({ ok: true });
  apply(response);
  return response.headers.get("set-cookie") ?? "";
}

test("the session cookie is scoped, http-only and secure on a deployed backend", () => {
  const header = setCookieHeader((response) => setSessionCookie(response, TOKEN, EXPIRES_AT));

  assert.match(header, new RegExp(`${SESSION_COOKIE_NAME}=${TOKEN}`));
  assert.match(header, /HttpOnly/i);
  assert.match(header, /Secure/i);
  assert.match(header, /SameSite=lax/i);
  assert.match(header, /Path=\//i);
});

test("the session cookie carries the session expiry", () => {
  const header = setCookieHeader((response) => setSessionCookie(response, TOKEN, EXPIRES_AT));

  assert.match(header, /Expires=/i);
  assert.ok(
    header.includes(new Date(EXPIRES_AT).toUTCString()),
    `expected the cookie to expire at ${EXPIRES_AT}, got: ${header}`
  );
});

test("logging out clears the value and expires the cookie immediately", () => {
  const header = setCookieHeader((response) => clearSessionCookie(response));

  assert.match(header, new RegExp(`${SESSION_COOKIE_NAME}=(;|$)`));
  assert.match(header, /Max-Age=0/i);
});

test("the cleared cookie keeps the same security attributes", () => {
  // A cleared cookie that drops HttpOnly or Secure would be a downgrade the
  // browser accepts, so the attributes have to match the cookie being replaced.
  const header = setCookieHeader((response) => clearSessionCookie(response));

  assert.match(header, /HttpOnly/i);
  assert.match(header, /Secure/i);
  assert.match(header, /SameSite=lax/i);
  assert.match(header, /Path=\//i);
});
