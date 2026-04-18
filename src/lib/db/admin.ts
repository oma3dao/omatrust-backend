import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/config/env";
import type { Database } from "@/lib/db/schema";

let client: SupabaseClient<Database> | null = null;

export function getSupabaseAdmin() {
  if (client) {
    return client;
  }

  const env = getEnv();

  client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return client;
}
