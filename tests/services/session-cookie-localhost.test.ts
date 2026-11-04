import test from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { applyTestEnv } from "../helpers/env.ts";
import { clearSessionCookie, setSessionCookie } from "@/lib/services/session-service";

applyTestEnv({ OMATRUST_BACKEND_URL: "http://localhost:3000" });

/**
 * Counterpart to session-cookie.test.ts. Local development runs over plain
 * HTTP, where a Secure cookie would simply never be stored and sign-in would
 * fail, so Secure has to drop off for a localhost backend and only there.
 */

const TOKEN = "header.payload.signature";
const EXPIRES_AT = "2026-12-31T23:59:59.000Z";

function setCookieHeader(apply: (response: NextResponse) => void) {
  const response = NextResponse.json({ ok: true });
  apply(response);
  return response.headers.get("set-cookie") ?? "";
}

test("a localhost backend issues a non-secure cookie", () => {
  const header = setCookieHeader((response) => setSessionCookie(response, TOKEN, EXPIRES_AT));

  assert.doesNotMatch(header, /Secure/i);
});

test("dropping Secure does not drop the other protections", () => {
  const header = setCookieHeader((response) => setSessionCookie(response, TOKEN, EXPIRES_AT));

  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=lax/i);
  assert.match(header, /Path=\//i);
});

test("clearing the cookie locally is also non-secure", () => {
  const header = setCookieHeader((response) => clearSessionCookie(response));

  assert.doesNotMatch(header, /Secure/i);
  assert.match(header, /Max-Age=0/i);
});
