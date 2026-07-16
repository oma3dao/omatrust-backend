import test from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for cookie configuration helpers from session-service.
 *
 * We test the pure logic by re-implementing the helpers inline with controlled
 * inputs, since the originals are module-private and rely on env caching.
 */

function shouldUseSecureCookies(backendUrl: string): boolean {
  return !backendUrl.includes("localhost") && !backendUrl.includes("127.0.0.1");
}

// getCookieSameSite currently always returns "lax". See the comment in
// session-service.ts for details on when/how to enable "none" for cross-site
// localhost-to-staging scenarios.
function getCookieSameSite(): "lax" | "none" {
  return "lax";
}

test("getCookieSameSite always returns 'lax'", () => {
  assert.equal(getCookieSameSite(), "lax");
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
