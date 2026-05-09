import { normalizeDid, computeDidHash } from "@oma3/omatrust/identity";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type { SubjectRow } from "@/lib/db/types";
import { assertSupabase, isNoRowsError } from "@/lib/db/utils";
import { ApiError } from "@/lib/errors";
import type { AccountContext } from "@/lib/services/account-service";
import { getAuthenticatedWalletFromContext } from "@/lib/services/wallet-execution-mode";
import {
  handleSubjectOwnershipVerification,
  type SubjectOwnershipVerificationResult
} from "@/lib/services/subject-ownership-service";

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

export async function assertSubjectOwnershipVerifiedForAccount(
  accountContext: AccountContext,
  did: string,
  deps: {
    verifyFn?: (params: {
      subjectDid: string;
      connectedWalletDid: string;
    }) => Promise<SubjectOwnershipVerificationResult>;
  } = {}
) {
  const authenticatedWallet = getAuthenticatedWalletFromContext({
    wallets: accountContext.wallets,
    credentialWalletId: accountContext.credential?.wallet_id ?? null
  });

  if (!authenticatedWallet) {
    throw new ApiError(
      "A wallet-authenticated session is required to add a subject",
      403,
      "WALLET_AUTH_REQUIRED",
      "Sign in with the wallet that controls this subject and try again."
    );
  }

  const verifyFn = deps.verifyFn ?? handleSubjectOwnershipVerification;
  const result = await verifyFn({
    subjectDid: did,
    connectedWalletDid: authenticatedWallet.did
  });

  if (!result.ok) {
    throw new ApiError(
      result.error ?? "Subject ownership verification failed",
      403,
      "SUBJECT_OWNERSHIP_VERIFICATION_FAILED",
      result.details ??
        "Confirm the subject points to your connected wallet using DNS TXT, did.json, or the supported ownership method and try again."
    );
  }

  return {
    verification: result,
    authenticatedWalletDid: authenticatedWallet.did
  };
}

export function shouldReplaceBootstrapWalletSubject(params: {
  accountContext: AccountContext;
  canonicalDid: string;
  authenticatedWalletDid: string;
}) {
  const { accountContext, canonicalDid, authenticatedWalletDid } = params;
  const normalizedWalletDid = normalizeDid(authenticatedWalletDid);

  if (canonicalDid === normalizedWalletDid) {
    return false;
  }

  if (accountContext.subjects.length !== 1) {
    return false;
  }

  const onlySubject = accountContext.subjects[0];
  return Boolean(onlySubject && onlySubject.is_default && onlySubject.canonical_did === normalizedWalletDid);
}

export async function addSubjectToAccount(accountContext: AccountContext, did: string, displayName?: string | null) {
  const supabase = getSupabaseAdmin();
  const { authenticatedWalletDid } = await assertSubjectOwnershipVerifiedForAccount(accountContext, did);

  const accountId = accountContext.account.id;
  const canonicalDid = normalizeDid(did);
  const subjectDidHash = computeDidHash(canonicalDid);
  const replaceBootstrapWalletSubject = shouldReplaceBootstrapWalletSubject({
    accountContext,
    canonicalDid,
    authenticatedWalletDid
  });

  const existingForAccount = await supabase
    .from("subjects")
    .select("*")
    .eq("account_id", accountId)
    .eq("canonical_did", canonicalDid)
    .maybeSingle();

  if (existingForAccount.data) {
    throw new ApiError("Subject already exists", 409, "SUBJECT_ALREADY_EXISTS");
  }


  const insert = await supabase
    .from("subjects")
    .insert({
      account_id: accountId,
      canonical_did: canonicalDid,
      subject_did_hash: subjectDidHash,
      display_name: displayName ?? null,
      is_default: replaceBootstrapWalletSubject
    })
    .select("*")
    .single();

  const insertedSubject = assertSupabase(insert.data as SubjectRow | null, insert.error, "Failed to add subject");

  if (replaceBootstrapWalletSubject) {
    const bootstrapSubject = accountContext.subjects[0];
    if (bootstrapSubject) {
      const removal = await supabase
        .from("subjects")
        .delete()
        .eq("id", bootstrapSubject.id)
        .eq("account_id", accountId);

      assertSupabase(true, removal.error, "Failed to replace bootstrap subject");
    }
  }

  return insertedSubject;
}
