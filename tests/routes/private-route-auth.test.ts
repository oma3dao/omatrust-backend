import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { GET as accountsMe, PATCH as patchAccountsMe } from "@/app/api/private/accounts/me/route";
import { POST as controllerWitness } from "@/app/api/private/controller-witness/route";
import { POST as delegatedAttest } from "@/app/api/private/relay/eas/delegated-attest/route";
import { GET as relayNonce } from "@/app/api/private/relay/eas/nonce/route";
import { POST as premiumRpc } from "@/app/api/private/rpc-premium/route";
import { GET as sessionMe } from "@/app/api/private/session/me/route";
import { GET as listSigningKeys, POST as upsertSigningKey } from "@/app/api/private/signing-keys/route";
import { GET as listSubjects, POST as createSubject } from "@/app/api/private/subjects/route";
import { GET as getSubject } from "@/app/api/private/subjects/[subjectId]/route";
import { POST as checkoutSession } from "@/app/api/private/subscriptions/checkout-session/route";
import { GET as currentSubscription } from "@/app/api/private/subscriptions/current/route";

/**
 * Every session-protected route must refuse an anonymous caller before it
 * touches account data. These cases send request bodies that satisfy each
 * route's schema, so a 401 here proves the auth gate fired rather than input
 * validation short-circuiting the request.
 */
applyTestEnv();

const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const SUBJECT_DID = `did:pkh:eip155:66238:${WALLET_ADDRESS}`;
const HEX32 = `0x${"1".repeat(64)}`;

const NO_PARAMS = { params: Promise.resolve({}) };
const SUBJECT_PARAMS = { params: Promise.resolve({ subjectId: "00000000-0000-4000-8000-000000000000" }) };

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>;

function get(path: string) {
  return new Request(`https://backend.example${path}`);
}

function post(path: string, body: unknown, method = "POST") {
  return new Request(`https://backend.example${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

const preparedAttestation = {
  delegatedRequest: {
    schema: HEX32,
    attester: WALLET_ADDRESS,
    easContractAddress: "0x8835AF90f1537777F52E482C8630cE4e947eCa32",
    chainId: 66238,
    recipient: WALLET_ADDRESS,
    expirationTime: "0",
    revocable: true,
    refUID: `0x${"0".repeat(64)}`,
    data: "0xdeadbeef",
    value: "0",
    nonce: "0",
    deadline: "0"
  },
  typedData: {
    domain: {
      name: "EAS",
      version: "1.2.0",
      chainId: 66238,
      verifyingContract: "0x8835AF90f1537777F52E482C8630cE4e947eCa32"
    },
    types: { Attest: [{ name: "attester", type: "address" }] },
    message: {
      attester: WALLET_ADDRESS,
      schema: HEX32,
      recipient: WALLET_ADDRESS,
      expirationTime: "0",
      revocable: true,
      refUID: `0x${"0".repeat(64)}`,
      data: "0xdeadbeef",
      value: "0",
      nonce: "0",
      deadline: "0"
    }
  }
};

/** Each entry sends a schema-valid request so the only thing left to reject is the missing session. */
const PROTECTED_ROUTES: ReadonlyArray<{
  name: string;
  handler: RouteHandler;
  request: () => Request;
  context?: { params: Promise<Record<string, string>> };
}> = [
  { name: "GET /private/accounts/me", handler: accountsMe, request: () => get("/api/private/accounts/me") },
  {
    name: "PATCH /private/accounts/me",
    handler: patchAccountsMe,
    request: () => post("/api/private/accounts/me", { displayName: "Anon" }, "PATCH")
  },
  {
    name: "POST /private/controller-witness",
    handler: controllerWitness,
    request: () =>
      post("/api/private/controller-witness", {
        subjectDid: "did:web:example.com",
        controllerDid: SUBJECT_DID
      })
  },
  {
    name: "POST /private/relay/eas/delegated-attest",
    handler: delegatedAttest,
    request: () =>
      post("/api/private/relay/eas/delegated-attest", {
        attester: WALLET_ADDRESS,
        prepared: preparedAttestation,
        signature: "0xabcdef"
      })
  },
  {
    name: "GET /private/relay/eas/nonce",
    handler: relayNonce,
    request: () => get(`/api/private/relay/eas/nonce?attester=${WALLET_ADDRESS}`)
  },
  {
    name: "POST /private/rpc-premium",
    handler: premiumRpc,
    request: () => post("/api/private/rpc-premium", { jsonrpc: "2.0", method: "eth_blockNumber", id: 1 })
  },
  { name: "GET /private/session/me", handler: sessionMe, request: () => get("/api/private/session/me") },
  {
    name: "GET /private/signing-keys",
    handler: listSigningKeys,
    request: () => get("/api/private/signing-keys")
  },
  {
    name: "POST /private/signing-keys",
    handler: upsertSigningKey,
    request: () =>
      post("/api/private/signing-keys", {
        keyDid: "did:key:z6MkfakeKeyForAuthTest",
        keyType: "ed25519",
        displayName: "Anon key"
      })
  },
  { name: "GET /private/subjects", handler: listSubjects, request: () => get("/api/private/subjects") },
  {
    name: "POST /private/subjects",
    handler: createSubject,
    request: () => post("/api/private/subjects", { did: "did:web:example.com" })
  },
  {
    name: "GET /private/subjects/[subjectId]",
    handler: getSubject,
    request: () => get("/api/private/subjects/00000000-0000-4000-8000-000000000000"),
    context: SUBJECT_PARAMS
  },
  {
    name: "POST /private/subscriptions/checkout-session",
    handler: checkoutSession,
    request: () =>
      post("/api/private/subscriptions/checkout-session", {
        plan: "paid",
        successUrl: "https://app.example/success",
        cancelUrl: "https://app.example/cancel"
      })
  },
  {
    name: "GET /private/subscriptions/current",
    handler: currentSubscription,
    request: () => get("/api/private/subscriptions/current")
  }
];

test("every session-protected route refuses a request with no session cookie", async () => {
  for (const route of PROTECTED_ROUTES) {
    const response = await route.handler(route.request(), route.context ?? NO_PARAMS);
    const body = (await response.json()) as { code: string };

    assert.equal(response.status, 401, `${route.name} must answer 401`);
    assert.equal(body.code, "UNAUTHENTICATED", `${route.name} must report UNAUTHENTICATED`);
  }
});

test("every session-protected route refuses a forged session cookie", async () => {
  for (const route of PROTECTED_ROUTES) {
    const request = new Request(route.request(), {
      headers: { cookie: "omatrust_session=forged.session.token" }
    });
    const response = await route.handler(request, route.context ?? NO_PARAMS);
    const body = (await response.json()) as { code: string };

    // An unverifiable token is reported as SESSION_EXPIRED rather than a
    // distinct "bad signature" code, so a caller cannot tell the two apart.
    assert.equal(response.status, 401, `${route.name} must answer 401 for a forged cookie`);
    assert.equal(body.code, "SESSION_EXPIRED", `${route.name} must reject the token`);
  }
});

test("an unrelated cookie does not satisfy the session gate", async () => {
  const response = await sessionMe(
    new Request("https://backend.example/api/private/session/me", {
      headers: { cookie: "omatrust_session_other=x; session=y; omatrust=z" }
    }),
    NO_PARAMS
  );
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 401);
  assert.equal(body.code, "UNAUTHENTICATED");
});

test("anonymous rejections never leak account data in the response body", async () => {
  for (const route of PROTECTED_ROUTES) {
    const response = await route.handler(route.request(), route.context ?? NO_PARAMS);
    const raw = await response.text();

    assert.equal(raw.includes("account"), false, `${route.name} must not mention an account`);
    assert.equal(raw.includes("subscription"), false, `${route.name} must not mention a subscription`);
  }
});

test("input validation runs before authentication on protected write routes", async () => {
  const response = await createSubject(post("/api/private/subjects", { did: "" }), NO_PARAMS);
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_INPUT");
});
