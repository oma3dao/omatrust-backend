import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/errors";
import { created, errorResponse, ok, parseJson } from "@/lib/http";

const GENERIC_MESSAGE =
  "Something went wrong on our end. Please report this issue using the link at the top of the page.";

async function readBody(response: Response) {
  return (await response.json()) as { error: string; code: string; details?: string };
}

test("a client error is reported verbatim", async () => {
  const response = errorResponse(
    new ApiError("Sponsored write limit exceeded", 403, "SPONSORED_WRITE_LIMIT_EXCEEDED", "Upgrade to continue.")
  );
  const body = await readBody(response);

  assert.equal(response.status, 403);
  assert.equal(body.error, "Sponsored write limit exceeded");
  assert.equal(body.code, "SPONSORED_WRITE_LIMIT_EXCEEDED");
  assert.equal(body.details, "Upgrade to continue.");
});

test("a server error replaces the message with a generic one", async () => {
  const response = errorResponse(new Error("password authentication failed for user 'admin'"));
  const body = await readBody(response);

  assert.equal(response.status, 500);
  assert.equal(body.error, GENERIC_MESSAGE);
  assert.equal(body.code, "INTERNAL_ERROR");
});

test("a server error still returns the underlying message in details", async () => {
  // Asserted deliberately: details is the debugging escape hatch, so anything
  // put into a 5xx ApiError message does reach the client. Narrowing this is a
  // product decision, not an accident to discover in production.
  const response = errorResponse(new Error("password authentication failed for user 'admin'"));
  const body = await readBody(response);

  assert.equal(body.details, "password authentication failed for user 'admin'");
});

test("the 5xx boundary is at 500, not above it", async () => {
  const gateway = await readBody(errorResponse(new ApiError("Nonce lookup failed", 502, "NONCE_LOOKUP_FAILED")));
  const conflict = await readBody(errorResponse(new ApiError("Duplicate submission", 409, "DUPLICATE")));

  assert.equal(gateway.error, GENERIC_MESSAGE);
  assert.equal(conflict.error, "Duplicate submission");
});

test("ok and created set the expected statuses", async () => {
  const okResponse = ok({ value: 1 });
  const createdResponse = created({ value: 2 });

  assert.equal(okResponse.status, 200);
  assert.deepEqual(await okResponse.json(), { value: 1 });
  assert.equal(createdResponse.status, 201);
  assert.deepEqual(await createdResponse.json(), { value: 2 });
});

test("parseJson returns the decoded body", async () => {
  const request = new Request("https://backend.omatrust.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attester: "0xabc" })
  });

  assert.deepEqual(await parseJson(request), { attester: "0xabc" });
});

test("parseJson turns a malformed body into a 400 INVALID_JSON", async () => {
  const request = new Request("https://backend.omatrust.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops"
  });

  await assert.rejects(
    () => parseJson(request),
    (error: unknown) =>
      error instanceof ApiError && error.statusCode === 400 && error.code === "INVALID_JSON"
  );
});
