import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/config/env";

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (client) {
    return client;
  }

  const env = getEnv();

  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return client;
}
