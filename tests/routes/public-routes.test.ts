import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { GET as health } from "@/app/api/health/route";
import { GET as controllerConfirm } from "@/app/api/public/controller-confirm/route";
import { GET as controllerEndpointConfirm } from "@/app/api/public/controller-endpoint-confirm/route";
import { POST as identityResolve } from "@/app/api/public/identity-resolve/route";
import { GET as trustAnchors } from "@/app/api/public/trust-anchors/route";
import { POST as verifySubjectOwnership } from "@/app/api/verify/subject-ownership/route";

/**
 * These routes are unauthenticated and internet-facing. Every case uses a
 * key-based subject DID so no case reaches DNS, HTTP, or RPC.
 */
applyTestEnv();

const SUBJECT_DID = "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111";
const OTHER_WALLET_DID = "did:pkh:eip155:66238:0x2222222222222222222222222222222222222222";

const ROUTE_CONTEXT = { params: Promise.resolve({}) };

function get(url: string) {
  return new Request(url);
}

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("health route reports readiness without touching configuration", async () => {
  const response = await health(get("https://backend.example/api/health"), ROUTE_CONTEXT);
  const body = (await response.json()) as { ok: boolean; service: string };

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, service: "omatrust-backend" });
});

test("health route discloses nothing about the deployment", async () => {
  const response = await health(get("https://backend.example/api/health"), ROUTE_CONTEXT);
  const raw = await response.text();

  for (const secret of ["supabase", "stripe", "secret", "rpc", "key"]) {
    assert.equal(raw.toLowerCase().includes(secret), false, `health must not mention ${secret}`);
  }
});

test("trust anchors route serves the registry without a session", async () => {
  const response = await trustAnchors(get("https://backend.example/api/public/trust-anchors"), ROUTE_CONTEXT);
  const body = (await response.json()) as {
    version: number;
    chains: Record<string, unknown>;
    registries: unknown[];
  };

  assert.equal(response.status, 200);
  assert.equal(typeof body.version, "number");
  assert.ok(Object.keys(body.chains).length > 0);
  assert.ok(body.registries.length > 0);
});

test("trust anchors route ignores caller-supplied query parameters", async () => {
  const plain = await trustAnchors(get("https://backend.example/api/public/trust-anchors"), ROUTE_CONTEXT);
  const tampered = await trustAnchors(
    get("https://backend.example/api/public/trust-anchors?chain=eip155%3A1&includeTestIssuers=true"),
    ROUTE_CONTEXT
  );

  assert.equal(tampered.status, 200);
  assert.deepEqual(await tampered.json(), await plain.json());
});

test("identity resolve route resolves a batch of identifiers", async () => {
  const response = await identityResolve(
    post("https://backend.example/api/public/identity-resolve", {
      identifiers: [SUBJECT_DID, "did:web:example.com"]
    }),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as { identities: Array<{ type: string }> };

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.identities.map((identity) => identity.type),
    ["did-pkh", "did-web"]
  );
});

test("identity resolve route rejects a batch beyond the published cap", async () => {
  const response = await identityResolve(
    post("https://backend.example/api/public/identity-resolve", {
      identifiers: new Array(101).fill(SUBJECT_DID)
    }),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_INPUT");
});

test("identity resolve route rejects empty and malformed payloads", async () => {
  const missingField = await identityResolve(
    post("https://backend.example/api/public/identity-resolve", {}),
    ROUTE_CONTEXT
  );
  const emptyIdentifier = await identityResolve(
    post("https://backend.example/api/public/identity-resolve", { identifiers: [""] }),
    ROUTE_CONTEXT
  );

  assert.equal(missingField.status, 400);
  assert.equal(emptyIdentifier.status, 400);
});

test("identity resolve route rejects a body that is not JSON", async () => {
  const response = await identityResolve(
    new Request("https://backend.example/api/public/identity-resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json"
    }),
    ROUTE_CONTEXT
  );

  assert.equal(response.status, 400);
});

test("controller confirm route summarizes a subject without leaking an issuer verdict it was not asked for", async () => {
  const response = await controllerConfirm(
    get(
      `https://backend.example/api/public/controller-confirm?subjectDid=${encodeURIComponent(SUBJECT_DID)}&walletDid=${encodeURIComponent(OTHER_WALLET_DID)}`
    ),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as {
    domain: string | null;
    approvedIssuer: { status: string };
    controllerKeys: Array<{ canonicalId: string }>;
  };

  assert.equal(response.status, 200);
  assert.equal(body.domain, null);
  assert.equal(body.approvedIssuer.status, "not-approved");
  assert.deepEqual(
    body.controllerKeys.map((key) => key.canonicalId),
    [OTHER_WALLET_DID]
  );
});

test("controller confirm route requires a subject DID", async () => {
  const response = await controllerConfirm(
    get("https://backend.example/api/public/controller-confirm"),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_INPUT");
});

test("controller endpoint confirm route withholds the approved-issuer verdict", async () => {
  const response = await controllerEndpointConfirm(
    get(
      `https://backend.example/api/public/controller-endpoint-confirm?subjectDid=${encodeURIComponent(SUBJECT_DID)}`
    ),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal("approvedIssuer" in body, false);
  assert.ok(Array.isArray(body.evidence));
});

test("controller endpoint confirm route ignores a wallet the caller tries to smuggle in", async () => {
  const response = await controllerEndpointConfirm(
    get(
      `https://backend.example/api/public/controller-endpoint-confirm?subjectDid=${encodeURIComponent(SUBJECT_DID)}&walletDid=${encodeURIComponent(OTHER_WALLET_DID)}`
    ),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as { controllerKeys: unknown[] };

  assert.equal(response.status, 200);
  assert.deepEqual(body.controllerKeys, []);
});

test("subject ownership route answers 403 with a structured failure, not a 500", async () => {
  const response = await verifySubjectOwnership(
    post("https://backend.example/api/verify/subject-ownership", {
      subjectDid: SUBJECT_DID,
      connectedWalletDid: OTHER_WALLET_DID
    }),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as { ok: boolean; status: string; error?: string };

  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.status, "failed");
  assert.ok(body.error);
});

test("subject ownership route rejects a subject on a chain the backend does not serve", async () => {
  const response = await verifySubjectOwnership(
    post("https://backend.example/api/verify/subject-ownership", {
      subjectDid: "did:pkh:eip155:1:0x1111111111111111111111111111111111111111",
      connectedWalletDid: OTHER_WALLET_DID
    }),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "UNSUPPORTED_CHAIN");
});

test("subject ownership route requires both identifiers", async () => {
  const response = await verifySubjectOwnership(
    post("https://backend.example/api/verify/subject-ownership", { subjectDid: SUBJECT_DID }),
    ROUTE_CONTEXT
  );
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_INPUT");
});
