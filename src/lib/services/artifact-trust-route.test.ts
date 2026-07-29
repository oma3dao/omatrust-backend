import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "@/app/api/public/artifact-trust/route";

test("artifact trust route maps a missing artifactDid to INVALID_DID", async () => {
  const response = await GET(
    new Request("https://backend.example/api/public/artifact-trust"),
    { params: Promise.resolve({}) }
  );
  const body = await response.json() as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_DID");
});

test("artifact trust route maps a non-artifact DID to INVALID_DID", async () => {
  const response = await GET(
    new Request(
      "https://backend.example/api/public/artifact-trust?artifactDid=did%3Aweb%3Aexample.com"
    ),
    { params: Promise.resolve({}) }
  );
  const body = await response.json() as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_DID");
});
