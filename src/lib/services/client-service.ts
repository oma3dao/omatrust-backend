import { getEnv } from "@/lib/config/env";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type { ClientRow } from "@/lib/db/types";
import { assertSupabase, isNoRowsError } from "@/lib/db/utils";

export async function ensureBrowserClient(): Promise<ClientRow> {
  const defaultBrowserClientDisplayName = "OMATrust Browser";
  const env = getEnv();
  const supabase = getSupabaseAdmin();

  const existing = await supabase
    .from("clients")
    .select("*")
    .eq("client_id", env.OMATRUST_BROWSER_CLIENT_ID)
    .maybeSingle();

  if (existing.data) {
    return existing.data;
  }

  if (existing.error && !isNoRowsError(existing.error)) {
    assertSupabase(existing.data, existing.error, "Failed to load browser client");
  }

  const inserted = await supabase
    .from("clients")
    .insert({
      account_id: null,
      client_id: env.OMATRUST_BROWSER_CLIENT_ID,
      auth_mode: "siwe_session",
      display_name: defaultBrowserClientDisplayName,
      did: null
    })
    .select("*")
    .single();

  return assertSupabase(inserted.data as ClientRow | null, inserted.error, "Failed to create browser client");
}
