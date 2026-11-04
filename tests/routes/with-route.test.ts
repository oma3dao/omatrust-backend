import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { applyTestEnv } from "../helpers/env.ts";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { ApiError } from "@/lib/errors";
import { withRoute } from "@/lib/routes/with-route";

applyTestEnv();

/**
 * withRoute is the single entry point every API route goes through, so its
 * behaviour is the de facto HTTP contract for the whole backend: what a
 * validation failure looks like, which errors reach the client verbatim, and
 * whether an unauthenticated caller can ever reach a handler.
 */

const URL_BASE = "https://backend.omatrust.test/api/test";
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };

function postRequest(body: string) {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
}

async function readBody(response: Response) {
  return (await response.json()) as {
    error: string;
    code: string;
    details?: string;
  };
}

test("returns a plain handler result as a 200 JSON body", async () => {
  const route = withRoute({
    debugName: "test.ok",
    handler: () => ({ hello: "world" })
  });

  const response = await route(new Request(URL_BASE), NO_PARAMS);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hello: "world" });
});

test("passes a handler-supplied Response through untouched", async () => {
  const route = withRoute({
    debugName: "test.raw-response",
    handler: () => new Response("raw-body", { status: 201 })
  });

  const response = await route(new Request(URL_BASE), NO_PARAMS);

  assert.equal(response.status, 201);
  assert.equal(await response.text(), "raw-body");
});

test("surfaces the failing schema message as 400 INVALID_INPUT", async () => {
  const route = withRoute({
    debugName: "test.body-schema",
    bodySchema: z.object({
      walletDid: z.string().min(1, "walletDid is required")
    }),
    handler: () => ({ reached: true })
  });

  const response = await route(postRequest(JSON.stringify({ walletDid: "" })), NO_PARAMS);
  const body = await readBody(response);

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_INPUT");
  assert.equal(body.error, "walletDid is required");
});

test("rejects a malformed JSON body with 400 INVALID_JSON", async () => {
  let handlerCalls = 0;
  const route = withRoute({
    debugName: "test.bad-json",
    bodySchema: z.object({ ok: z.boolean() }),
    handler: () => {
      handlerCalls += 1;
      return {};
    }
  });

  const response = await route(postRequest("{not-json"), NO_PARAMS);
  const body = await readBody(response);

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_JSON");
  assert.equal(handlerCalls, 0);
});

test("validates query parameters before the handler runs", async () => {
  let handlerCalls = 0;
  const route = withRoute({
    debugName: "test.query-schema",
    querySchema: z.object({
      attester: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Expected EVM address")
    }),
    handler: () => {
      handlerCalls += 1;
      return {};
    }
  });

  const response = await route(new Request(`${URL_BASE}?attester=nope`), NO_PARAMS);
  const body = await readBody(response);

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_INPUT");
  assert.equal(body.error, "Expected EVM address");
  assert.equal(handlerCalls, 0);
});

test("validates dynamic route params", async () => {
  const route = withRoute({
    debugName: "test.params-schema",
    paramsSchema: z.object({ subjectId: z.string().uuid("subjectId must be a uuid") }),
    handler: ({ params }) => params
  });

  const response = await route(new Request(URL_BASE), {
    params: Promise.resolve({ subjectId: "not-a-uuid" })
  });
  const body = await readBody(response);

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_INPUT");
  assert.equal(body.error, "subjectId must be a uuid");
});

test("preserves the status, code and details of an ApiError thrown by the handler", async () => {
  const route = withRoute({
    debugName: "test.api-error",
    handler: () => {
      throw new ApiError(
        "Subscription inactive",
        403,
        "SUBSCRIPTION_INACTIVE",
        "Renew your plan to continue."
      );
    }
  });

  const response = await route(new Request(URL_BASE), NO_PARAMS);
  const body = await readBody(response);

  assert.equal(response.status, 403);
  assert.equal(body.code, "SUBSCRIPTION_INACTIVE");
  assert.equal(body.error, "Subscription inactive");
  assert.equal(body.details, "Renew your plan to continue.");
});

test("does not show an unexpected failure message to the client", async () => {
  const route = withRoute({
    debugName: "test.unexpected",
    handler: () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    }
  });

  const response = await route(new Request(URL_BASE), NO_PARAMS);
  const body = await readBody(response);

  assert.equal(response.status, 500);
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.equal(
    body.error,
    "Something went wrong on our end. Please report this issue using the link at the top of the page."
  );
});

test("rejects a session route with no cookie before the handler runs", async () => {
  let handlerCalls = 0;
  const route = withRoute({
    auth: "session",
    debugName: "test.session-required",
    handler: () => {
      handlerCalls += 1;
      return {};
    }
  });

  const response = await route(new Request(URL_BASE), NO_PARAMS);
  const body = await readBody(response);

  assert.equal(response.status, 401);
  assert.equal(body.code, "UNAUTHENTICATED");
  assert.equal(handlerCalls, 0);
});

test("rejects a session route carrying an unverifiable token before the handler runs", async () => {
  let handlerCalls = 0;
  const route = withRoute({
    auth: "session",
    debugName: "test.session-forged",
    handler: () => {
      handlerCalls += 1;
      return {};
    }
  });

  const response = await route(
    new Request(URL_BASE, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=forged.token.value` }
    }),
    NO_PARAMS
  );
  const body = await readBody(response);

  assert.equal(response.status, 401);
  assert.equal(body.code, "SESSION_EXPIRED");
  assert.equal(handlerCalls, 0);
});

test("leaves accountContext null on a public route even when a cookie is present", async () => {
  let seenAccountContext: unknown = "unset";
  const route = withRoute({
    auth: "none",
    debugName: "test.public",
    handler: ({ accountContext }) => {
      seenAccountContext = accountContext;
      return { ok: true };
    }
  });

  const response = await route(
    new Request(URL_BASE, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=forged.token.value` }
    }),
    NO_PARAMS
  );

  assert.equal(response.status, 200);
  assert.equal(seenAccountContext, null);
});
