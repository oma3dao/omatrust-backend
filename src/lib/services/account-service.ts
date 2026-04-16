import { addMonths } from "@/lib/utils/date";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type { AccountRow, ClientRow, SessionRow, SubjectRow, SubscriptionRow, WalletRow } from "@/lib/db/types";
import { assertSupabase, isNoRowsError } from "@/lib/db/utils";
import { getEnv } from "@/lib/config/env";
import { computeDidHash } from "@oma3/omatrust/identity";
import { ApiError } from "@/lib/errors";

export interface AccountContext {
  account: AccountRow;
  subscription: SubscriptionRow;
  wallets: WalletRow[];
  subjects: SubjectRow[];
  primarySubject: SubjectRow | null;
  client: ClientRow | null;
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

  const [accountResult, subscriptionResult, walletsResult, subjectsResult, sessionResult, clientResult] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", accountId).single(),
    supabase.from("subscriptions").select("*").eq("account_id", accountId).single(),
    supabase.from("wallets").select("*").eq("account_id", accountId).order("is_primary", { ascending: false }),
    supabase.from("subjects").select("*").eq("account_id", accountId).order("is_default", { ascending: false }),
    sessionId
      ? supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sessionId
      ? supabase
          .from("sessions")
          .select("client_id")
          .eq("id", sessionId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);

  const account = assertSupabase(accountResult.data as AccountRow | null, accountResult.error, "Account not found");
  const subscription = assertSupabase(
    subscriptionResult.data as SubscriptionRow | null,
    subscriptionResult.error,
    "Subscription not found"
  );
  const wallets = assertSupabase(walletsResult.data as WalletRow[] | null, walletsResult.error, "Failed to load wallets") ?? [];
  const subjects =
    assertSupabase(subjectsResult.data as SubjectRow[] | null, subjectsResult.error, "Failed to load subjects") ?? [];

  let client: ClientRow | null = null;
  if (clientResult.data?.client_id) {
    const clientLookup = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientResult.data.client_id)
      .maybeSingle();

    client = assertSupabase(clientLookup.data as ClientRow | null, clientLookup.error, "Failed to load client");
  }

  return {
    account,
    subscription,
    wallets,
    subjects,
    primarySubject: subjects.find((subject) => subject.is_default) ?? subjects[0] ?? null,
    client,
    session: sessionResult.data ?? null
  };
}

export async function createAccountForWallet(params: {
  walletDid: string;
  walletAddress: string;
  caip2ChainId: string;
}): Promise<AccountContext> {
  const supabase = getSupabaseAdmin();
  const env = getEnv();

  const existingWallet = await findWalletByDid(params.walletDid);
  if (existingWallet) {
    return getAccountContextByAccountId(existingWallet.account_id);
  }

  const accountInsert = await supabase.from("accounts").insert({}).select("*").single();
  const account = assertSupabase(accountInsert.data as AccountRow | null, accountInsert.error, "Failed to create account");

  const walletInsert = await supabase
    .from("wallets")
    .insert({
      account_id: account.id,
      did: params.walletDid,
      wallet_address: params.walletAddress,
      caip2_chain_id: params.caip2ChainId,
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
      is_default: true
    })
    .select("*")
    .single();

  assertSupabase(subjectInsert.data as SubjectRow | null, subjectInsert.error, "Failed to create default subject");

  const subscriptionInsert = await supabase
    .from("subscriptions")
    .insert({
      account_id: account.id,
      plan: "free",
      status: "active",
      monthly_sponsored_write_limit: env.OMATRUST_FREE_MONTHLY_SPONSORED_WRITES,
      sponsored_writes_used_current_period: 0,
      monthly_api_read_limit: env.OMATRUST_FREE_MONTHLY_API_READS,
      api_reads_used_current_period: 0,
      current_period_start: now.toISOString(),
      current_period_end: addMonths(now, 1).toISOString()
    })
    .select("*")
    .single();

  assertSupabase(
    subscriptionInsert.data as SubscriptionRow | null,
    subscriptionInsert.error,
    "Failed to create free subscription"
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

export function assertSubscriptionActive(subscription: SubscriptionRow) {
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    throw new ApiError("Subscription inactive", 403, "SUBSCRIPTION_INACTIVE");
  }
}
