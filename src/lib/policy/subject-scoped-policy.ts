import { getEnv, parseCsv } from "@/lib/config/env";

/**
 * Subject-scoped schema UIDs — attestations for these schemas require
 * the attester to prove ownership of the subject DID before the backend
 * will submit the transaction.
 *
 * Configured via OMATRUST_SUBJECT_SCOPED_SCHEMA_UIDS environment variable.
 * Comma-separated list of schema UIDs (0x-prefixed hex).
 */

function parseSubjectScopedSchemaUids(): Set<string> {
  const env = getEnv();
  const raw = env.OMATRUST_SUBJECT_SCOPED_SCHEMA_UIDS ?? "";
  return new Set(parseCsv(raw).map((uid) => uid.toLowerCase()));
}

export function isSubjectScopedSchema(schemaUid: string): boolean {
  const uids = parseSubjectScopedSchemaUids();
  if (uids.size === 0) return false;
  return uids.has(schemaUid.toLowerCase());
}
