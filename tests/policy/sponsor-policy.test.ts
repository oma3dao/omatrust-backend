import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { isSchemaAllowedForPlan } from "@/lib/policy/sponsor-policy";
import { isSubjectScopedSchema } from "@/lib/policy/subject-scoped-policy";

const FREE_SCHEMA_UPPER = `0x${"AB".repeat(32)}`;
const FREE_SCHEMA_LOWER = `0x${"cd".repeat(32)}`;
const UNLISTED_SCHEMA = `0x${"ef".repeat(32)}`;

applyTestEnv({
  OMATRUST_FREE_ALLOWED_SCHEMA_UIDS: `${FREE_SCHEMA_UPPER},${FREE_SCHEMA_LOWER}`,
  OMATRUST_PAID_ALLOWED_SCHEMA_UIDS: "*",
  OMATRUST_SUBJECT_SCOPED_SCHEMA_UIDS: ""
});

/**
 * Schema UIDs arrive from clients and are configured by operators, and the two
 * rarely agree on hex casing, so the allowlist has to compare case-insensitively
 * without letting the paid tier's wildcard widen the free tier.
 */

test("the free tier allows a schema on its allowlist whatever the casing", () => {
  assert.equal(isSchemaAllowedForPlan("free", FREE_SCHEMA_UPPER), true);
  assert.equal(isSchemaAllowedForPlan("free", FREE_SCHEMA_UPPER.toLowerCase()), true);
  assert.equal(isSchemaAllowedForPlan("free", FREE_SCHEMA_LOWER), true);
  assert.equal(isSchemaAllowedForPlan("free", FREE_SCHEMA_LOWER.toUpperCase()), true);
});

test("the free tier denies a schema that is not on its allowlist", () => {
  assert.equal(isSchemaAllowedForPlan("free", UNLISTED_SCHEMA), false);
});

test("the paid wildcard allows any schema", () => {
  assert.equal(isSchemaAllowedForPlan("paid", UNLISTED_SCHEMA), true);
  assert.equal(isSchemaAllowedForPlan("paid", FREE_SCHEMA_UPPER), true);
});

test("the paid wildcard does not widen the free tier", () => {
  assert.equal(isSchemaAllowedForPlan("paid", UNLISTED_SCHEMA), true);
  assert.equal(isSchemaAllowedForPlan("free", UNLISTED_SCHEMA), false);
});

test("no schema is subject-scoped when the list is unconfigured", () => {
  assert.equal(isSubjectScopedSchema(FREE_SCHEMA_UPPER), false);
  assert.equal(isSubjectScopedSchema(UNLISTED_SCHEMA), false);
});
