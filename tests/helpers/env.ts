/**
 * Test environment harness.
 *
 * `getEnv()` validates the whole environment on first call and caches the
 * result for the life of the process, so a test file gets exactly one
 * configuration. The test runner gives each file its own process, so a file
 * that needs a different configuration (mainnet vs testnet, a populated
 * allowlist vs an empty one) must be its own file.
 *
 * Call `applyTestEnv()` at the top of the module body, before any test runs.
 */

const BASE_ENV: Record<string, string> = {
  OMATRUST_BACKEND_URL: "https://backend.omatrust.test",
  OMATRUST_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
  OMATRUST_SESSION_TTL_HOURS: "24",
  OMATRUST_SIWE_NONCE_TTL_MINUTES: "10",
  OMATRUST_ALLOWED_SIWE_DOMAINS: "",
  OMATRUST_ALLOWED_CORS_ORIGINS: "",
  OMATRUST_BROWSER_CLIENT_ID: "omatrust-browser",
  OMATRUST_ACTIVE_CHAIN: "omachain-testnet",
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_SECRET_KEY: "test-supabase-secret-key",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  STRIPE_PAID_PRICE_ID: "",
  OMATRUST_PREMIUM_RPC_URL: "https://premium-rpc.omatrust.test/",
  OMATRUST_PREMIUM_RPC_MAX_LOG_RANGE: "50000",
  OMATRUST_MAX_GAS_PER_TX: "800000",
  OMATRUST_FREE_ANNUAL_SPONSORED_WRITES: "10",
  OMATRUST_FREE_ANNUAL_PREMIUM_READS: "100",
  OMATRUST_PAID_ANNUAL_SPONSORED_WRITES: "100",
  OMATRUST_PAID_ANNUAL_PREMIUM_READS: "1000",
  OMATRUST_FREE_ALLOWED_SCHEMA_UIDS: "",
  OMATRUST_PAID_ALLOWED_SCHEMA_UIDS: "*",
  OMATRUST_SUBJECT_SCOPED_SCHEMA_UIDS: ""
};

/**
 * Overwrites rather than defaults, so a developer's local shell environment
 * cannot change what the tests assert.
 */
export function applyTestEnv(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    process.env[key] = value;
  }
}
