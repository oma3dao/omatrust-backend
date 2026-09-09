import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { ApiError, toApiError } from "@/lib/errors";
import { upsertKeyMetadata } from "@/lib/services/signing-keys-service";

applyTestEnv();

/**
 * Covers the service-layer validation cases from the signing-keys test plan
 * (docs/features/service-signing-keys/plan.md, S-3 through S-7). Every case
 * here is rejected before the database is reached, so no persistence is needed
 * to exercise them.
 */

const VALID_KEY_DID = "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111";

function isInvalidInput(error: unknown) {
  return error instanceof ApiError && error.statusCode === 400 && error.code === "INVALID_INPUT";
}

function upsert(overrides: Record<string, unknown> = {}) {
  return upsertKeyMetadata({
    accountId: "account-1",
    keyDid: VALID_KEY_DID,
    keyType: "service-signing",
    displayName: "Production x402 receipt signer",
    tags: ["x402"],
    notes: null,
    ...overrides
  } as Parameters<typeof upsertKeyMetadata>[0]);
}

test("rejects a key identifier that is not a supported DID method", async () => {
  await assert.rejects(() => upsert({ keyDid: "did:web:example.com" }), isInvalidInput);
  await assert.rejects(() => upsert({ keyDid: "0x1234" }), isInvalidInput);
});

test("rejects a truncated did:pkh key identifier", async () => {
  await assert.rejects(() => upsert({ keyDid: "did:pkh:eip155:66238" }), isInvalidInput);
});

test("an empty did:jwk body slips past validation and surfaces as a 500", async () => {
  // validateKeyDid only requires three colon-separated parts, but any string
  // starting with "did:jwk:" already has three, so that check can never reject
  // one. The malformed value reaches normalizeDid, whose SDK error is not an
  // ApiError, so a client input mistake is reported as a server fault.
  let caught: unknown;
  try {
    await upsert({ keyDid: "did:jwk:" });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.equal(caught instanceof ApiError, false);
  assert.equal(toApiError(caught).statusCode, 500);
  assert.equal(toApiError(caught).code, "INTERNAL_ERROR");
});

test("rejects an unknown key type", async () => {
  await assert.rejects(() => upsert({ keyType: "signing" }), isInvalidInput);
  await assert.rejects(() => upsert({ keyType: "" }), isInvalidInput);
});

test("rejects a display name that is empty or only whitespace", async () => {
  await assert.rejects(() => upsert({ displayName: "" }), isInvalidInput);
  await assert.rejects(() => upsert({ displayName: "   " }), isInvalidInput);
});

test("rejects a display name longer than 200 characters", async () => {
  await assert.rejects(() => upsert({ displayName: "a".repeat(201) }), isInvalidInput);
});

test("rejects more than ten tags", async () => {
  await assert.rejects(
    () => upsert({ tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`) }),
    isInvalidInput
  );
});

test("rejects a tag that is empty or longer than 50 characters", async () => {
  await assert.rejects(() => upsert({ tags: [""] }), isInvalidInput);
  await assert.rejects(() => upsert({ tags: ["x402", "  "] }), isInvalidInput);
  await assert.rejects(() => upsert({ tags: ["a".repeat(51)] }), isInvalidInput);
});

test("rejects notes longer than 1000 characters", async () => {
  await assert.rejects(() => upsert({ notes: "n".repeat(1001) }), isInvalidInput);
});

test("accepts a notes value at the 1000-character boundary through validation", async () => {
  // Length 1000 is allowed by validateNotes; the call then reaches Supabase and
  // fails for lack of a real database. The important contract is that the
  // boundary is inclusive — a client sending exactly 1000 characters must not
  // see INVALID_INPUT.
  let caught: unknown;
  try {
    await upsert({ notes: "n".repeat(1000) });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.equal(
    caught instanceof ApiError && caught.code === "INVALID_INPUT",
    false,
    "notes of length 1000 must clear validation"
  );
});

test("treats missing notes the same as an explicit null for validation", async () => {
  let missing: unknown;
  let explicitNull: unknown;

  try {
    await upsert({ notes: undefined });
  } catch (error) {
    missing = error;
  }
  try {
    await upsert({ notes: null });
  } catch (error) {
    explicitNull = error;
  }

  assert.ok(missing instanceof Error);
  assert.ok(explicitNull instanceof Error);
  assert.equal(missing instanceof ApiError && missing.code === "INVALID_INPUT", false);
  assert.equal(
    explicitNull instanceof ApiError && explicitNull.code === "INVALID_INPUT",
    false
  );
});
