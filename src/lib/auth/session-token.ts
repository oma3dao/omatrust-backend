import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/config/env";
import { ApiError } from "@/lib/errors";

export interface SessionTokenClaims {
  sid: string;
  aid: string;
  cid: string;
  wid?: string;
}

function getSessionSecret() {
  return new TextEncoder().encode(getEnv().OMATRUST_SESSION_SECRET);
}

export async function signSessionToken(claims: SessionTokenClaims, expiresAt: Date) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string): Promise<SessionTokenClaims> {
  try {
    const verified = await jwtVerify(token, getSessionSecret());
    return verified.payload as unknown as SessionTokenClaims;
  } catch {
    throw new ApiError("Session expired", 401, "SESSION_EXPIRED");
  }
}
