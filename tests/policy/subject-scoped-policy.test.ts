import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { isSubjectScopedSchema } from "@/lib/policy/subject-scoped-policy";

const KEY_BINDING = "0x807b38ce9aa23fdde4457de01db9c5e8d6ec7c8feebee242e52be70847b7b966";
const LINKED_IDENTIFIER = "0x56d1e74383cbcfb89e23b25f444a081951a5d2fa7876b159da082b8cbd967af8";
const UNRELATED = `0x${"11".repeat(32)}`;

applyTestEnv({
  // Spacing around the separator is what an operator-edited env var tends to
  // look like, and parseCsv is expected to tolerate it.
  OMATRUST_SUBJECT_SCOPED_SCHEMA_UIDS: `${KEY_BINDING}, ${LINKED_IDENTIFIER}`
});

/**
 * A schema listed here forces the relay to prove the attester controls the
 * subject DID before it will submit. A UID that silently fails to match
 * skips that proof, so matching must survive casing and whitespace.
 */

test("configured schemas are recognised as subject-scoped", () => {
  assert.equal(isSubjectScopedSchema(KEY_BINDING), true);
  assert.equal(isSubjectScopedSchema(LINKED_IDENTIFIER), true);
});

test("matching is case-insensitive", () => {
  assert.equal(isSubjectScopedSchema(KEY_BINDING.toUpperCase().replace("0X", "0x")), true);
});

test("an unrelated schema is not subject-scoped", () => {
  assert.equal(isSubjectScopedSchema(UNRELATED), false);
});
