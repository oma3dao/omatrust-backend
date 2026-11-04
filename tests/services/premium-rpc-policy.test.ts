import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { createAccountContext, createSubscriptionState } from "../helpers/fixtures.ts";
import { ApiError, toApiError } from "@/lib/errors";
import {
  forwardPremiumRpcRequest,
  type PremiumRpcRequest
} from "@/lib/services/premium-rpc-service";

const MAX_LOG_RANGE = 50_000;

applyTestEnv({ OMATRUST_PREMIUM_RPC_MAX_LOG_RANGE: String(MAX_LOG_RANGE) });

/**
 * The premium RPC endpoint proxies an authenticated caller onto paid
 * infrastructure, so the method allowlist and the log-range cap are the whole
 * defence against using it as an open relay or as a way to run unbounded,
 * expensive queries. Every case here is rejected before the upstream fetch.
 */

function hasCode(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof ApiError && error.code === code && error.statusCode === statusCode;
}

const ACTIVE_ACCOUNT = createAccountContext();

function forward(request: PremiumRpcRequest, accountContext = ACTIVE_ACCOUNT) {
  return forwardPremiumRpcRequest(accountContext, request);
}

function hex(value: number) {
  return `0x${value.toString(16)}`;
}

test("refuses an inactive subscription before inspecting the request", async () => {
  const inactive = createAccountContext({
    subscriptionState: createSubscriptionState({ status: "canceled" })
  });

  await assert.rejects(
    () => forward({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }, inactive),
    hasCode("SUBSCRIPTION_INACTIVE", 403)
  );
});

test("refuses methods outside the read allowlist", async () => {
  const blocked = [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "eth_accounts",
    "personal_sign",
    "eth_getBalance",
    "debug_traceTransaction"
  ];

  for (const method of blocked) {
    await assert.rejects(
      () => forward({ jsonrpc: "2.0", method, id: 1 }),
      hasCode("RPC_METHOD_NOT_ALLOWED", 403),
      `${method} must not be proxied`
    );
  }
});

test("refuses eth_call without a call object", async () => {
  await assert.rejects(
    () => forward({ jsonrpc: "2.0", method: "eth_call", params: [], id: 1 }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_call aimed at something that is not a contract address", async () => {
  await assert.rejects(
    () => forward({ jsonrpc: "2.0", method: "eth_call", params: [{ to: "not-an-address" }], id: 1 }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_getLogs with a malformed address filter", async () => {
  await assert.rejects(
    () =>
      forward({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{ address: "0xnot-an-address" }],
        id: 1
      }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_getLogs when any address in the filter array is malformed", async () => {
  await assert.rejects(
    () =>
      forward({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [
          {
            address: [`0x${"1".repeat(40)}`, "0xnot-an-address"]
          }
        ],
        id: 1
      }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_getLogs with an address filter that is neither string nor array", async () => {
  await assert.rejects(
    () =>
      forward({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{ address: 42 }],
        id: 1
      }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_getLogs without a filter object", async () => {
  await assert.rejects(
    () => forward({ jsonrpc: "2.0", method: "eth_getLogs", params: [], id: 1 }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_getLogs when the filter is an array instead of an object", async () => {
  await assert.rejects(
    () => forward({ jsonrpc: "2.0", method: "eth_getLogs", params: [[]], id: 1 }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_call when the call parameter is not an object", async () => {
  await assert.rejects(
    () => forward({ jsonrpc: "2.0", method: "eth_call", params: ["0xdeadbeef"], id: 1 }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_getLogs with an inverted block range", async () => {
  await assert.rejects(
    () =>
      forward({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{ fromBlock: hex(2_000), toBlock: hex(1_000) }],
        id: 1
      }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses eth_getLogs with a non-hex block tag", async () => {
  await assert.rejects(
    () =>
      forward({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{ fromBlock: "12345", toBlock: "latest" }],
        id: 1
      }),
    hasCode("INVALID_RPC_REQUEST", 400)
  );
});

test("refuses an eth_getLogs span wider than the configured cap", async () => {
  await assert.rejects(
    () =>
      forward({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{ fromBlock: hex(0), toBlock: hex(MAX_LOG_RANGE + 1) }],
        id: 1
      }),
    hasCode("RPC_RANGE_TOO_LARGE", 403)
  );
});

test("a malformed JSON-RPC envelope is reported as client input, not a server fault", async () => {
  let caught: unknown;
  try {
    await forward({ jsonrpc: "1.0", method: "eth_chainId" } as unknown as PremiumRpcRequest);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "expected the request to be rejected");
  assert.equal(toApiError(caught).statusCode, 400);
  assert.equal(toApiError(caught).code, "INVALID_INPUT");
});
