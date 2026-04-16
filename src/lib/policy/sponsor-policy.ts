import { getEnv, parseCsv } from "@/lib/config/env";
import type { Plan } from "@/lib/db/types";

function parseAllowlist(raw: string) {
  const entries = parseCsv(raw).map((value) => value.toLowerCase());
  return new Set(entries);
}

export function isSchemaAllowedForPlan(plan: Plan, schemaUid: string) {
  const env = getEnv();
  const normalizedUid = schemaUid.toLowerCase();
  const allowlist =
    plan === "paid"
      ? parseAllowlist(env.OMATRUST_PAID_ALLOWED_SCHEMA_UIDS)
      : parseAllowlist(env.OMATRUST_FREE_ALLOWED_SCHEMA_UIDS);

  if (allowlist.has("*")) {
    return true;
  }

  return allowlist.has(normalizedUid);
}
