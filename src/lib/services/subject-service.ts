import { normalizeDid, computeDidHash } from "@oma3/omatrust/identity";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type { SubjectRow } from "@/lib/db/types";
import { assertSupabase, isNoRowsError } from "@/lib/db/utils";
import { ApiError } from "@/lib/errors";

export async function listSubjects(accountId: string) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("subjects")
    .select("*")
    .eq("account_id", accountId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  return assertSupabase(result.data ?? [], result.error, "Failed to load subjects");
}

export async function getSubjectForAccount(accountId: string, subjectId: string) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("subjects")
    .select("*")
    .eq("account_id", accountId)
    .eq("id", subjectId)
    .maybeSingle();

  if (result.error && !isNoRowsError(result.error)) {
    assertSupabase(result.data, result.error, "Failed to load subject");
  }

  if (!result.data) {
    throw new ApiError("Subject not found", 404, "SUBJECT_NOT_FOUND");
  }

  return result.data;
}

export async function addSubjectToAccount(accountId: string, did: string, displayName?: string | null) {
  const supabase = getSupabaseAdmin();
  const canonicalDid = normalizeDid(did);
  const subjectDidHash = computeDidHash(canonicalDid);

  const existingForAccount = await supabase
    .from("subjects")
    .select("*")
    .eq("account_id", accountId)
    .eq("canonical_did", canonicalDid)
    .maybeSingle();

  if (existingForAccount.data) {
    throw new ApiError("Subject already exists", 409, "SUBJECT_ALREADY_EXISTS");
  }

  const existingGlobal = await supabase
    .from("subjects")
    .select("account_id")
    .eq("canonical_did", canonicalDid)
    .maybeSingle();

  if (existingGlobal.data && existingGlobal.data.account_id !== accountId) {
    throw new ApiError("Subject owned by another account", 409, "SUBJECT_OWNED_BY_ANOTHER_ACCOUNT");
  }

  if (existingGlobal.error && !isNoRowsError(existingGlobal.error)) {
    assertSupabase(existingGlobal.data, existingGlobal.error, "Failed to check subject ownership");
  }

  const insert = await supabase
    .from("subjects")
    .insert({
      account_id: accountId,
      canonical_did: canonicalDid,
      subject_did_hash: subjectDidHash,
      display_name: displayName ?? null,
      is_default: false
    })
    .select("*")
    .single();

  return assertSupabase(insert.data as SubjectRow | null, insert.error, "Failed to add subject");
}
