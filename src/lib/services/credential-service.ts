import { getSupabaseAdmin } from "@/lib/db/admin";
import type { CredentialRow } from "@/lib/db/types";
import { assertSupabase, isNoRowsError } from "@/lib/db/utils";

export async function getOrCreateWalletCredential(params: {
  accountId: string;
  clientId: string;
  walletId: string;
  walletDid: string;
}): Promise<CredentialRow> {
  const supabase = getSupabaseAdmin();

  const existing = await supabase
    .from("credentials")
    .select("*")
    .eq("account_id", params.accountId)
    .eq("client_id", params.clientId)
    .eq("credential_kind", "wallet_auth")
    .eq("credential_identifier", params.walletDid)
    .maybeSingle();

  if (existing.error && !isNoRowsError(existing.error)) {
    assertSupabase(existing.data, existing.error, "Failed to load credential");
  }

  if (existing.data) {
    return existing.data as CredentialRow;
  }

  const insert = await supabase
    .from("credentials")
    .insert({
      account_id: params.accountId,
      client_id: params.clientId,
      wallet_id: params.walletId,
      credential_kind: "wallet_auth",
      credential_identifier: params.walletDid
    })
    .select("*")
    .single();

  return assertSupabase(insert.data as CredentialRow | null, insert.error, "Failed to create credential");
}
