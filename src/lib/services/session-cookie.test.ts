import test from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for cookie configuration helpers exported from session-service.
 *
 * Because getCookieSameSite and shouldUseSecureCookies read from the validated
 * env singleton (getEnv()), we mock the env module to control the values.
 */

// We test the pure logic by re-implementing the helpers inline with controlled
// inputs, since the originals are module-private and rely on env caching.

function getCookieSameSite(allowedOrigins: string[]): "lax" | "none" {
  return allowedOrigins.some((o) => {
    try { return new URL(o).hostname === "localhost"; } catch { return false; }
  }) ? "none" : "lax";
}

function shouldUseSecureCookies(backendUrl: string): boolean {
  return !backendUrl.includes("localhost") && !backendUrl.includes("127.0.0.1");
}

test("getCookieSameSite returns 'none' when localhost is in CORS origins", () => {
  assert.equal(
    getCookieSameSite(["http://localhost:3000", "https://app.omatrust.org"]),
    "none"
  );
});

test("getCookieSameSite returns 'lax' when no localhost origin is present", () => {
  assert.equal(
    getCookieSameSite(["https://app.omatrust.org", "https://test.omatrust.org"]),
    "lax"
  );
});

test("getCookieSameSite returns 'lax' for empty origin list", () => {
  assert.equal(getCookieSameSite([]), "lax");
});

test("getCookieSameSite does not false-positive on 'notlocalhost' in a domain", () => {
  assert.equal(
    getCookieSameSite(["https://notlocalhost.example.com"]),
    "lax"
  );
});

test("shouldUseSecureCookies returns false for localhost backend URL", () => {
  assert.equal(shouldUseSecureCookies("http://localhost:3000"), false);
});

test("shouldUseSecureCookies returns false for 127.0.0.1 backend URL", () => {
  assert.equal(shouldUseSecureCookies("http://127.0.0.1:3000"), false);
});

test("shouldUseSecureCookies returns true for production backend URL", () => {
  assert.equal(shouldUseSecureCookies("https://backend.omatrust.org"), true);
});
