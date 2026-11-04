import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ApiError, isApiError, toApiError } from "@/lib/errors";

/**
 * toApiError decides the status code for anything thrown anywhere in a route,
 * so it is what separates "the caller sent something wrong" (4xx) from "we
 * broke" (5xx).
 */

test("an ApiError is passed through unchanged", () => {
  const original = new ApiError("Attester mismatch", 403, "ATTESTER_MISMATCH", "wallet-1");

  assert.equal(toApiError(original), original);
});

test("a schema failure becomes a 400 carrying the first issue message", () => {
  const result = z
    .object({ walletDid: z.string().min(1, "walletDid is required") })
    .safeParse({ walletDid: "" });

  assert.equal(result.success, false);
  const apiError = toApiError(result.error);

  assert.equal(apiError.statusCode, 400);
  assert.equal(apiError.code, "INVALID_INPUT");
  assert.equal(apiError.message, "walletDid is required");
});

test("an unexpected Error becomes a 500 that keeps its message for the logs", () => {
  const apiError = toApiError(new Error("supabase unreachable"));

  assert.equal(apiError.statusCode, 500);
  assert.equal(apiError.code, "INTERNAL_ERROR");
  assert.equal(apiError.message, "supabase unreachable");
});

test("a thrown non-Error becomes a generic 500", () => {
  const apiError = toApiError("something odd");

  assert.equal(apiError.statusCode, 500);
  assert.equal(apiError.code, "INTERNAL_ERROR");
  assert.equal(apiError.message, "Internal error");
});

test("ApiError defaults to a 500 internal error", () => {
  const apiError = new ApiError("boom");

  assert.equal(apiError.statusCode, 500);
  assert.equal(apiError.code, "INTERNAL_ERROR");
  assert.equal(apiError.name, "ApiError");
});

test("isApiError distinguishes ApiError from other throwables", () => {
  assert.equal(isApiError(new ApiError("x", 400, "BAD")), true);
  assert.equal(isApiError(new Error("x")), false);
  assert.equal(isApiError("x"), false);
  assert.equal(isApiError(null), false);
});
