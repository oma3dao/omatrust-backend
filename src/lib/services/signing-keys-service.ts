import { normalizeDid } from "@oma3/omatrust/identity";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type { KeyMetadataRow } from "@/lib/db/types";
import { assertSupabase } from "@/lib/db/utils";
import { ApiError } from "@/lib/errors";

const SUPPORTED_DID_PREFIXES = ["did:pkh:", "did:jwk:"] as const;

function validateKeyDid(keyDid: string): void {
  const matched = SUPPORTED_DID_PREFIXES.some((prefix) => keyDid.startsWith(prefix));
  if (!matched) {
    throw new ApiError(
      "Key identifier must use a supported DID format (did:pkh or did:jwk)",
      400,
      "INVALID_INPUT"
    );
  }

  const parts = keyDid.split(":");
  if (keyDid.startsWith("did:pkh:") && parts.length < 5) {
    throw new ApiError("did:pkh key identifier must have at least 5 colon-separated parts", 400, "INVALID_INPUT");
  }
  if (keyDid.startsWith("did:jwk:") && parts.length < 3) {
    throw new ApiError("Key identifier must have at least 3 colon-separated parts", 400, "INVALID_INPUT");
  }
}

function validateKeyType(keyType: string): asserts keyType is "attestation" | "service-signing" {
  if (keyType !== "attestation" && keyType !== "service-signing") {
    throw new ApiError("keyType must be 'attestation' or 'service-signing'", 400, "INVALID_INPUT");
  }
}

function validateDisplayName(displayName: string): void {
  if (!displayName || displayName.trim().length === 0) {
    throw new ApiError("displayName must be non-empty", 400, "INVALID_INPUT");
  }
  if (displayName.length > 200) {
    throw new ApiError("displayName must be at most 200 characters", 400, "INVALID_INPUT");
  }
}

function validateTags(tags: string[]): void {
  if (tags.length > 10) {
    throw new ApiError("At most 10 tags are allowed", 400, "INVALID_INPUT");
  }
  for (const tag of tags) {
    if (!tag || tag.trim().length === 0) {
      throw new ApiError("Each tag must be a non-empty string", 400, "INVALID_INPUT");
    }
    if (tag.length > 50) {
      throw new ApiError("Each tag must be at most 50 characters", 400, "INVALID_INPUT");
    }
  }
}

function validateNotes(notes: string | undefined | null): void {
  if (notes && notes.length > 1000) {
    throw new ApiError("notes must be at most 1000 characters", 400, "INVALID_INPUT");
  }
}

export interface UpsertKeyMetadataParams {
  accountId: string;
  keyDid: string;
  keyType: string;
  displayName: string;
  tags?: string[];
  notes?: string | null;
}

export interface UpsertKeyMetadataResult extends KeyMetadataRow {
  created: boolean;
}

export async function upsertKeyMetadata(params: UpsertKeyMetadataParams): Promise<UpsertKeyMetadataResult> {
  const { accountId, keyDid, keyType, displayName, tags = [], notes = null } = params;

  validateKeyDid(keyDid);
  validateKeyType(keyType);
  validateDisplayName(displayName);
  validateTags(tags);
  validateNotes(notes);

  const canonicalKeyDid = normalizeDid(keyDid);
  const supabase = getSupabaseAdmin();

  // Check if a record already exists for this account+key pair
  const existing = await supabase
    .from("key_metadata")
    .select("id, created_at")
    .eq("account_id", accountId)
    .eq("key_did", canonicalKeyDid)
    .maybeSingle();

  const isUpdate = !!existing.data;

  const result = await supabase
    .from("key_metadata")
    .upsert(
      {
        account_id: accountId,
        key_did: canonicalKeyDid,
        key_type: keyType,
        display_name: displayName,
        tags,
        notes
      },
      { onConflict: "account_id,key_did" }
    )
    .select("*")
    .single();

  const row = assertSupabase(result.data as KeyMetadataRow | null, result.error, "Failed to upsert key metadata");

  return {
    ...row,
    created: !isUpdate
  };
}

export interface ListKeyMetadataParams {
  accountId: string;
  keyType?: string;
  tag?: string;
}

export async function listKeyMetadata(params: ListKeyMetadataParams): Promise<KeyMetadataRow[]> {
  const { accountId, keyType, tag } = params;
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("key_metadata")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  if (keyType) {
    query = query.eq("key_type", keyType as "attestation" | "service-signing");
  }

  if (tag) {
    query = query.contains("tags", [tag]);
  }

  const result = await query;

  return assertSupabase(result.data ?? [], result.error, "Failed to list key metadata");
}
