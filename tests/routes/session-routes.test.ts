import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { POST as logout } from "@/app/api/private/session/logout/route";
import { POST as challenge } from "@/app/api/private/session/wallet/challenge/route";
import { POST as register } from "@/app/api/private/session/wallet/register/route";
import { POST as verify } from "@/app/api/private/session/wallet/verify/route";
import { POST as stripeWebhook } from "@/app/api/private/subscriptions/stripe-webhook/route";

/**
 * The sign-in routes are unauthenticated by necessity, so their input
 * validation is the only thing standing in front of the session store. Every
 * case here is rejected before a challenge row or session row is written.
 */
applyTestEnv({
  // Configured so the webhook cases reach signature verification instead of
  // stopping at "STRIPE_SECRET_KEY is not configured".
  STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
  STRIPE_WEBHOOK_SECRET: "whsec_not_a_real_secret"
});

const WALLET_DID = "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111";
const NO_PARAMS = { params: Promise.resolve({}) };

function post(path: string, body: unknown) {
  return new Request(`https://backend.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function challengeBody(overrides: Record<string, unknown> = {}) {
  return {
    walletDid: WALLET_DID,
    chainId: 66238,
    domain: "app.example",
    uri: "https://app.example",
    ...overrides
  };
}

test("logout without a session still clears the cookie and reports success", async () => {
  const response = await logout(post("/api/private/session/logout", {}), NO_PARAMS);
  const setCookie = response.headers.get("set-cookie") ?? "";

  assert.equal(response.status, 200);
  assert.match(setCookie, /omatrust_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
});

test("logout refuses to act on a session token it cannot verify", async () => {
  const response = await logout(
    new Request("https://backend.example/api/private/session/logout", {
      method: "POST",
      headers: { cookie: "omatrust_session=forged.session.token" }
    }),
    NO_PARAMS
  );

  assert.equal(response.status, 401);
});

test("challenge route refuses a wallet DID on a different chain than requested", async () => {
  const response = await challenge(
    post("/api/private/session/wallet/challenge", challengeBody({ chainId: 1 })),
    NO_PARAMS
  );
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_DID");
});

test("challenge route refuses a wallet identifier that is not a did:pkh", async () => {
  const response = await challenge(
    post("/api/private/session/wallet/challenge", challengeBody({ walletDid: "did:web:example.com" })),
    NO_PARAMS
  );

  assert.equal(response.status, 400);
});

test("challenge route requires every binding field", async () => {
  for (const missing of ["walletDid", "chainId", "domain", "uri"]) {
    const body = challengeBody() as Record<string, unknown>;
    delete body[missing];

    const response = await challenge(post("/api/private/session/wallet/challenge", body), NO_PARAMS);
    const parsed = (await response.json()) as { code: string };

    assert.equal(response.status, 400, `${missing} must be required`);
    assert.equal(parsed.code, "INVALID_INPUT");
  }
});

test("challenge route rejects a non-positive chain id", async () => {
  for (const chainId of [0, -1, 1.5]) {
    const response = await challenge(
      post("/api/private/session/wallet/challenge", challengeBody({ chainId })),
      NO_PARAMS
    );

    assert.equal(response.status, 400, `chainId ${chainId} must be rejected`);
  }
});

test("verify route requires the full challenge response", async () => {
  const complete = {
    challengeId: "challenge-1",
    walletDid: WALLET_DID,
    signature: "0xsignature",
    siweMessage: "app.example wants you to sign in"
  };

  for (const missing of Object.keys(complete)) {
    const body = { ...complete } as Record<string, unknown>;
    delete body[missing];

    const response = await verify(post("/api/private/session/wallet/verify", body), NO_PARAMS);
    const parsed = (await response.json()) as { code: string };

    assert.equal(response.status, 400, `${missing} must be required`);
    assert.equal(parsed.code, "INVALID_INPUT");
  }
});

test("verify route only accepts the two supported execution modes", async () => {
  const response = await verify(
    post("/api/private/session/wallet/verify", {
      challengeId: "challenge-1",
      walletDid: WALLET_DID,
      signature: "0xsignature",
      siweMessage: "app.example wants you to sign in",
      executionMode: "sponsored"
    }),
    NO_PARAMS
  );

  assert.equal(response.status, 400);
});

test("register route rejects an oversized wallet provider identifier", async () => {
  const response = await register(
    post("/api/private/session/wallet/register", {
      challengeId: "challenge-1",
      walletDid: WALLET_DID,
      signature: "0xsignature",
      siweMessage: "app.example wants you to sign in",
      walletProviderId: "p".repeat(101)
    }),
    NO_PARAMS
  );

  assert.equal(response.status, 400);
});

test("register route rejects empty credentials", async () => {
  const response = await register(
    post("/api/private/session/wallet/register", {
      challengeId: "",
      walletDid: "",
      signature: "",
      siweMessage: ""
    }),
    NO_PARAMS
  );

  assert.equal(response.status, 400);
});

test("stripe webhook route refuses an unsigned payload", async () => {
  const response = await stripeWebhook(
    new Request("https://backend.example/api/private/subscriptions/stripe-webhook", {
      method: "POST",
      body: JSON.stringify({ id: "evt_test", type: "customer.subscription.updated" })
    }),
    NO_PARAMS
  );
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "STRIPE_ERROR");
});

/**
 * A forged signature is refused, but Stripe's own verification error is not
 * mapped to an ApiError, so the caller sees 500 INTERNAL_ERROR instead of 400.
 * Stripe treats 5xx as retryable, so forged deliveries are retried and show up
 * as server errors in monitoring. These tests pin the current behavior; they
 * will fail if the error mapping is ever corrected.
 */
test("stripe webhook route refuses a forged signature header, reporting 500", async () => {
  const response = await stripeWebhook(
    new Request("https://backend.example/api/private/subscriptions/stripe-webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify({ id: "evt_test", type: "customer.subscription.updated" })
    }),
    NO_PARAMS
  );
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 500);
  assert.equal(body.code, "INTERNAL_ERROR");
});

test("stripe webhook route refuses a payload whose body was altered after signing", async () => {
  const response = await stripeWebhook(
    new Request("https://backend.example/api/private/subscriptions/stripe-webhook", {
      method: "POST",
      headers: {
        "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`
      },
      body: JSON.stringify({ id: "evt_test", type: "customer.subscription.deleted" })
    }),
    NO_PARAMS
  );

  assert.equal(response.status, 500);
});
