import { z } from "zod";

const envSchema = z.object({
  OMATRUST_BACKEND_URL: z.string().url(),
  OMATRUST_SESSION_SECRET: z.string().min(32),
  OMATRUST_SESSION_TTL_HOURS: z.coerce.number().int().positive(),
  OMATRUST_SIWE_NONCE_TTL_MINUTES: z.coerce.number().int().positive(),
  OMATRUST_ALLOWED_SIWE_DOMAINS: z.string().default(""),
  OMATRUST_BROWSER_CLIENT_ID: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PAID_PRICE_ID: z.string().default(""),
  OMACHAIN_CHAIN_ID: z.coerce.number().int().positive(),
  OMACHAIN_CHAIN_NAME: z.string().min(1),
  OMACHAIN_RPC_URL: z.string().url(),
  OMACHAIN_EAS_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  OMATRUST_RELAY_PRIVATE_KEY: z.string().regex(/^$|^0x[a-fA-F0-9]{64}$/),
  OMATRUST_MAX_GAS_PER_TX: z.coerce.number().int().positive().default(800000),
  OMATRUST_FREE_MONTHLY_SPONSORED_WRITES: z.coerce.number().int().nonnegative(),
  OMATRUST_FREE_MONTHLY_API_READS: z.coerce.number().int().nonnegative(),
  OMATRUST_PAID_MONTHLY_SPONSORED_WRITES: z.coerce.number().int().nonnegative(),
  OMATRUST_PAID_MONTHLY_API_READS: z.coerce.number().int().nonnegative(),
  OMATRUST_FREE_ALLOWED_SCHEMA_UIDS: z.string().default(""),
  OMATRUST_PAID_ALLOWED_SCHEMA_UIDS: z.string().default("*")
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}

export function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function requireConfigured(value: string, name: string) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}
