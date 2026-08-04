import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import {
  createAccountContext,
  createSubscriptionState,
  createWallet
} from "../helpers/fixtures.ts";
import { ApiError } from "@/lib/errors";
import { submitControllerWitness } from "@/lib/services/controller-witness-service";

const CONTROLLER_WITNESS_SCHEMA_UID =
  "0xc81419f828755c0be2c49091dcad0887b5ca7342316dfffb4314aadbf8205090";

/**
 * Every case here must be refused before the service reaches endpoint
 * discovery or the server wallet, because each of those steps costs a
 * sponsored write or a network round trip.
 */
applyTestEnv({
  OMATRUST_FREE_ALLOWED_SCHEMA_UIDS: "",
  OMATRUST_PAID_ALLOWED_SCHEMA_UIDS: CONTROLLER_WITNESS_SCHEMA_UID
});

const SUBJECT_DID = "did:web:example.com";
const CONTROLLER_DID = "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111";

function hasCode(code: string, statusCode: number) {
  return (error: unknown) =>
    error instanceof ApiError && error.code === code && error.statusCode === statusCode;
}

function submit(accountContext = createAccountContext(), overrides: {
  subjectDid?: string;
  controllerDid?: string;
} = {}) {
  return submitControllerWitness({
    accountContext,
    subjectDid: overrides.subjectDid ?? SUBJECT_DID,
    controllerDid: overrides.controllerDid ?? CONTROLLER_DID
  });
}

test("controller witness refuses an inactive subscription", async () => {
  await assert.rejects(
    () =>
      submit(
        createAccountContext({
          subscriptionState: createSubscriptionState({ status: "canceled" })
        })
      ),
    hasCode("SUBSCRIPTION_INACTIVE", 403)
  );
});

test("controller witness refuses an account that has spent its sponsored writes", async () => {
  await assert.rejects(
    () =>
      submit(
        createAccountContext({
          subscriptionState: createSubscriptionState({
            annual_sponsored_write_limit: 5,
            sponsored_writes_used_current_year: 5
          })
        })
      ),
    hasCode("SPONSORED_WRITE_LIMIT_EXCEEDED", 403)
  );
});

test("controller witness refuses an account one write over its limit", async () => {
  await assert.rejects(
    () =>
      submit(
        createAccountContext({
          subscriptionState: createSubscriptionState({
            annual_sponsored_write_limit: 5,
            sponsored_writes_used_current_year: 6
          })
        })
      ),
    hasCode("SPONSORED_WRITE_LIMIT_EXCEEDED", 403)
  );
});

test("controller witness refuses wallets that opted into native execution", async () => {
  await assert.rejects(
    () =>
      submit(
        createAccountContext({
          wallets: [createWallet({ execution_mode: "native" })]
        })
      ),
    hasCode("EXECUTION_MODE_NATIVE", 403)
  );
});

test("controller witness refuses a plan that is not entitled to the schema", async () => {
  await assert.rejects(() => submit(), hasCode("SCHEMA_NOT_ELIGIBLE", 403));
});

test("controller witness refuses subjects that cannot carry endpoint evidence", async () => {
  const entitled = createAccountContext({
    subscriptionState: createSubscriptionState({ plan: "paid" })
  });

  await assert.rejects(
    () => submit(entitled, { subjectDid: CONTROLLER_DID }),
    hasCode("UNSUPPORTED_SUBJECT_TYPE", 400)
  );
});

function entitledAccount() {
  return createAccountContext({
    subscriptionState: createSubscriptionState({ plan: "paid" })
  });
}

test("controller witness refuses an empty subject DID before discovery", async () => {
  await assert.rejects(
    () => submit(entitledAccount(), { subjectDid: "" }),
    hasCode("INVALID_DID", 400)
  );
});

test("controller witness refuses a malformed subject DID before discovery", async () => {
  await assert.rejects(
    () => submit(entitledAccount(), { subjectDid: "did:web:" }),
    hasCode("INVALID_DID", 400)
  );
});

test("controller witness refuses a malformed controller DID before discovery", async () => {
  await assert.rejects(
    () => submit(entitledAccount(), { controllerDid: "did:pkh:broken" }),
    hasCode("INVALID_DID", 400)
  );
});

test("controller witness refuses an empty controller DID before discovery", async () => {
  await assert.rejects(
    () => submit(entitledAccount(), { controllerDid: "" }),
    hasCode("INVALID_DID", 400)
  );
});
