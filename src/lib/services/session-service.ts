import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type { SessionRow, SiweChallengeRow } from "@/lib/db/types";
import { assertSupabase, isNoRowsError } from "@/lib/db/utils";
import { ApiError } from "@/lib/errors";
import { createNonce, buildSiweChallengeMessage, normalizeWalletDid, verifySiweMessage } from "@/lib/auth/siwe";
import { getEnv } from "@/lib/config/env";
import { ensureBrowserClient } from "@/lib/services/client-service";
import { createAccountForWallet, getAccountContextByAccountId, type AccountContext } from "@/lib/services/account-service";
import { signSessionToken, verifySessionToken } from "@/lib/auth/session-token";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { parseCookie } from "@/lib/utils/http";
import { NextResponse } from "next/server";

function shouldUseSecureCookies() {
  const origin = getEnv().OMATRUST_BACKEND_URL;
  return !origin.includes("localhost") && !origin.includes("127.0.0.1");
}

export async function createSiweChallenge(input: {
  walletDid: string;
  chainId: number;
  domain: string;
  uri: string;
}) {
  const supabase = getSupabaseAdmin();
  const env = getEnv();
  const expiresAt = new Date(Date.now() + env.OMATRUST_SIWE_NONCE_TTL_MINUTES * 60 * 1000);
  const nonce = createNonce();
  const message = buildSiweChallengeMessage(input, nonce, expiresAt);

  const insert = await supabase
    .from("siwe_challenges")
    .insert({
      id: randomUUID(),
      wallet_did: message.walletDid,
      nonce,
      domain: input.domain,
      uri: input.uri,
      chain_id: input.chainId,
      statement: "Sign in to OMATrust",
      expires_at: expiresAt.toISOString()
    })
    .select("*")
    .single();

  const challenge = assertSupabase(insert.data as SiweChallengeRow | null, insert.error, "Failed to create SIWE challenge");

  return {
    challengeId: challenge.id,
    siweMessage: message.siweMessage,
    nonce,
    expiresAt: expiresAt.toISOString()
  };
}

async function loadChallenge(challengeId: string) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("siwe_challenges")
    .select("*")
    .eq("id", challengeId)
    .maybeSingle();

  if (result.error && !isNoRowsError(result.error)) {
    assertSupabase(result.data, result.error, "Failed to load challenge");
  }

  if (!result.data) {
    throw new ApiError("Invalid challenge", 400, "INVALID_CHALLENGE");
  }

  if (result.data.used_at) {
    throw new ApiError("Invalid challenge", 400, "INVALID_CHALLENGE");
  }

  if (new Date(result.data.expires_at) < new Date()) {
    throw new ApiError("Challenge expired", 400, "CHALLENGE_EXPIRED");
  }

  return result.data;
}

export async function verifySiweChallengeAndCreateSession(params: {
  challengeId: string;
  walletDid: string;
  signature: string;
  siweMessage: string;
}) {
  const challenge = await loadChallenge(params.challengeId);
  const normalizedWallet = normalizeWalletDid(params.walletDid);

  if (normalizedWallet.walletDid !== challenge.wallet_did) {
    throw new ApiError("Invalid challenge", 400, "INVALID_CHALLENGE");
  }

  await verifySiweMessage({
    walletDid: params.walletDid,
    expectedDomain: challenge.domain,
    expectedUri: challenge.uri,
    expectedNonce: challenge.nonce,
    expectedChainId: Number(challenge.chain_id),
    signature: params.signature,
    siweMessage: params.siweMessage
  });

  const browserClient = await ensureBrowserClient();
  const accountContext = await createAccountForWallet({
    walletDid: normalizedWallet.walletDid,
    walletAddress: normalizedWallet.walletAddress,
    caip2ChainId: `eip155:${normalizedWallet.chainId}`
  });

  const primaryWallet = accountContext.wallets.find((wallet) => wallet.is_primary) ?? accountContext.wallets[0];
  if (!primaryWallet) {
    throw new ApiError("Wallet not found", 404, "ACCOUNT_NOT_FOUND");
  }

  const sessionExpiresAt = new Date(Date.now() + getEnv().OMATRUST_SESSION_TTL_HOURS * 60 * 60 * 1000);
  const supabase = getSupabaseAdmin();
  const sessionInsert = await supabase
    .from("sessions")
    .insert({
      account_id: accountContext.account.id,
      client_id: browserClient.id,
      wallet_id: primaryWallet.id,
      expires_at: sessionExpiresAt.toISOString()
    })
    .select("*")
    .single();

  const session = assertSupabase(sessionInsert.data as SessionRow | null, sessionInsert.error, "Failed to create session");

  const challengeUpdate = await supabase
    .from("siwe_challenges")
    .update({ used_at: new Date().toISOString() })
    .eq("id", challenge.id);
  assertSupabase(true, challengeUpdate.error, "Failed to finalize challenge");

  const token = await signSessionToken(
    {
      sid: session.id,
      aid: session.account_id,
      cid: browserClient.id,
      wid: primaryWallet.id
    },
    sessionExpiresAt
  );

  return {
    accountContext: await getAccountContextByAccountId(accountContext.account.id, session.id),
    session,
    token
  };
}

export async function getAuthenticatedAccountContext(request: Request): Promise<AccountContext> {
  const cookieValue = parseCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!cookieValue) {
    throw new ApiError("Unauthenticated", 401, "UNAUTHENTICATED");
  }

  const claims = await verifySessionToken(cookieValue);
  const accountContext = await getAccountContextByAccountId(claims.aid, claims.sid);

  if (!accountContext.session) {
    throw new ApiError("Session revoked", 401, "SESSION_REVOKED");
  }

  if (accountContext.session.revoked_at) {
    throw new ApiError("Session revoked", 401, "SESSION_REVOKED");
  }

  if (new Date(accountContext.session.expires_at) < new Date()) {
    throw new ApiError("Session expired", 401, "SESSION_EXPIRED");
  }

  return accountContext;
}

export async function revokeCurrentSession(request: Request) {
  const cookieValue = parseCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!cookieValue) {
    return;
  }

  const claims = await verifySessionToken(cookieValue);
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", claims.sid);

  assertSupabase(true, result.error, "Failed to revoke session");
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: string) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt)
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}
