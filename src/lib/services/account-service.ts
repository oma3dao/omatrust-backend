import { addYears } from "@/lib/utils/date";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type {
  AccountRow,
  ClientRow,
  CredentialRow,
  SessionRow,
  SubjectRow,
  SubscriptionStateRow,
  WalletExecutionMode,
  WalletRow
} from "@/lib/db/types";
import { assertSupabase, isNoRowsError } from "@/lib/db/utils";
import { computeDidHash } from "@oma3/omatrust/identity";
import { ApiError } from "@/lib/errors";
import { getPlanLimits } from "@/lib/services/subscription-service";
import {
  assertRequestedExecutionModeMatchesWallet,
  resolveInitialWalletExecutionMode
} from "@/lib/services/wallet-execution-mode";

export interface AccountContext {
  account: AccountRow;
  subscriptionState: SubscriptionStateRow;
  wallets: WalletRow[];
  subjects: SubjectRow[];
  primarySubject: SubjectRow | null;
  client: ClientRow | null;
  credential: CredentialRow | null;
  session: SessionRow | null;
}

export async function findWalletByDid(walletDid: string) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("wallets")
    .select("*")
    .eq("did", walletDid)
    .maybeSingle();

  if (result.error && !isNoRowsError(result.error)) {
    assertSupabase(result.data, result.error, "Failed to load wallet");
  }

  return result.data ?? null;
}

export async function getAccountContextByAccountId(accountId: string, sessionId?: string): Promise<AccountContext> {
  const supabase = getSupabaseAdmin();

  const [accountResult, subscriptionStateResult, walletsResult, subjectsResult, sessionResult] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", accountId).single(),
    supabase.from("subscription_state").select("*").eq("account_id", accountId).single(),
    supabase.from("wallets").select("*").eq("account_id", accountId).order("is_primary", { ascending: false }),
    supabase.from("subjects").select("*").eq("account_id", accountId).order("is_default", { ascending: false }),
    sessionId
      ? supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);

  const account = assertSupabase(accountResult.data as AccountRow | null, accountResult.error, "Account not found");
  const subscriptionState = assertSupabase(
    subscriptionStateResult.data as SubscriptionStateRow | null,
    subscriptionStateResult.error,
    "Subscription state not found"
  );
  const wallets = assertSupabase(walletsResult.data as WalletRow[] | null, walletsResult.error, "Failed to load wallets") ?? [];
  const subjects =
    assertSupabase(subjectsResult.data as SubjectRow[] | null, subjectsResult.error, "Failed to load subjects") ?? [];

  let client: ClientRow | null = null;
  let credential: CredentialRow | null = null;
  if (sessionResult.data?.client_id) {
    const clientLookup = await supabase
      .from("clients")
      .select("*")
      .eq("id", sessionResult.data.client_id)
      .maybeSingle();

    if (clientLookup.error && !isNoRowsError(clientLookup.error)) {
      assertSupabase(clientLookup.data, clientLookup.error, "Failed to load client");
    }

    client = (clientLookup.data as ClientRow | null) ?? null;
  }

  if (sessionResult.data?.credential_id) {
    const credentialLookup = await supabase
      .from("credentials")
      .select("*")
      .eq("id", sessionResult.data.credential_id)
      .maybeSingle();

    if (credentialLookup.error && !isNoRowsError(credentialLookup.error)) {
      assertSupabase(credentialLookup.data, credentialLookup.error, "Failed to load credential");
    }

    credential = (credentialLookup.data as CredentialRow | null) ?? null;
  }

  return {
    account,
    subscriptionState,
    wallets,
    subjects,
    primarySubject: subjects.find((subject) => subject.is_default) ?? subjects[0] ?? null,
    client,
    credential,
    session: sessionResult.data ?? null
  };
}

/**
 * Load an existing account for a wallet. Throws ACCOUNT_NOT_FOUND if the wallet
 * has no account. Used by the sign-in (verify) endpoint.
 */
export async function getExistingAccountForWallet(params: {
  walletDid: string;
}): Promise<AccountContext> {
  const existingWallet = await findWalletByDid(params.walletDid);
  if (!existingWallet) {
    throw new ApiError(
      "No account found for this wallet. Please create an account first.",
      404,
      "ACCOUNT_NOT_FOUND"
    );
  }

  return getAccountContextByAccountId(existingWallet.account_id);
}

/**
 * Create a new account for a wallet. Throws ACCOUNT_ALREADY_EXISTS if the wallet
 * already has an account. Used by the register endpoint.
 */
export async function createAccountForNewWallet(params: {
  walletDid: string;
  walletAddress: string;
  walletProviderId?: string | null;
  executionMode?: WalletExecutionMode | null;
}): Promise<AccountContext> {
  const existingWallet = await findWalletByDid(params.walletDid);
  if (existingWallet) {
    throw new ApiError(
      "This wallet already has an account. Please sign in instead.",
      409,
      "ACCOUNT_ALREADY_EXISTS"
    );
  }

  const supabase = getSupabaseAdmin();
  const freeLimits = getPlanLimits("free");

  const executionMode = resolveInitialWalletExecutionMode({
    walletProviderId: params.walletProviderId ?? null,
    requestedExecutionMode: params.executionMode ?? null
  });

  const accountInsert = await supabase.from("accounts").insert({}).select("*").single();
  const account = assertSupabase(accountInsert.data as AccountRow | null, accountInsert.error, "Failed to create account");

  const walletInsert = await supabase
    .from("wallets")
    .insert({
      account_id: account.id,
      did: params.walletDid,
      wallet_address: params.walletAddress,
      wallet_provider_id: params.walletProviderId ?? null,
      execution_mode: executionMode,
      is_primary: true
    })
    .select("*")
    .single();

  if (walletInsert.error) {
    const recoveredWallet = await findWalletByDid(params.walletDid);
    if (recoveredWallet) {
      return getAccountContextByAccountId(recoveredWallet.account_id);
    }
    assertSupabase(walletInsert.data, walletInsert.error, "Failed to create wallet");
  }

  const now = new Date();
  const subjectInsert = await supabase
    .from("subjects")
    .insert({
      account_id: account.id,
      canonical_did: params.walletDid,
      subject_did_hash: computeDidHash(params.walletDid),
      display_name: null,
      is_default: true
    })
    .select("*")
    .single();

  assertSupabase(subjectInsert.data as SubjectRow | null, subjectInsert.error, "Failed to create default subject");

  const subscriptionInsert = await supabase
    .from("subscription_state")
    .insert({
      account_id: account.id,
      plan: "free",
      status: "active",
      annual_sponsored_write_limit: freeLimits.annualSponsoredWriteLimit,
      sponsored_writes_used_current_year: 0,
      annual_premium_read_limit: freeLimits.annualPremiumReadLimit,
      premium_reads_used_current_year: 0,
      entitlement_period_start: now.toISOString(),
      entitlement_period_end: addYears(now, 1).toISOString()
    })
    .select("*")
    .single();

  assertSupabase(
    subscriptionInsert.data as SubscriptionStateRow | null,
    subscriptionInsert.error,
    "Failed to create free subscription state"
  );

  return getAccountContextByAccountId(account.id);
}

export async function updateAccountDisplayName(accountId: string, displayName: string | null) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("accounts")
    .update({ display_name: displayName })
    .eq("id", accountId)
    .select("*")
    .single();

  return assertSupabase(result.data as AccountRow | null, result.error, "Failed to update account");
}

export function assertSubscriptionActive(subscriptionState: SubscriptionStateRow) {
  if (subscriptionState.status !== "active" && subscriptionState.status !== "trialing") {
    throw new ApiError("Subscription inactive", 403, "SUBSCRIPTION_INACTIVE");
  }
}
