import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { GET } from "@/app/api/public/artifact-trust/route";

applyTestEnv();

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

test("artifact trust route ignores client-supplied verification-weakening parameters", async () => {
  const response = await GET(
    new Request(
      "https://backend.example/api/public/artifact-trust?artifactDid=did%3Aweb%3Aexample.com&includeInvalid=true&limit=1000&schemas=*"
    ),
    { params: Promise.resolve({}) }
  );
  const body = await response.json() as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_DID");
});

test("artifact trust route requires no session cookie to reach the service", async () => {
  const withoutCookie = await GET(
    new Request("https://backend.example/api/public/artifact-trust?artifactDid=nope"),
    { params: Promise.resolve({}) }
  );
  const withCookie = await GET(
    new Request("https://backend.example/api/public/artifact-trust?artifactDid=nope", {
      headers: { cookie: "omatrust_session=not-a-real-token" }
    }),
    { params: Promise.resolve({}) }
  );

  assert.equal(withoutCookie.status, 400);
  assert.equal(withCookie.status, 400);
  assert.deepEqual(await withoutCookie.json(), await withCookie.json());
});
