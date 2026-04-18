import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import { ApiError } from "@/lib/errors";

export interface SessionTokenClaims extends JWTPayload {
  sid: string;
  aid: string;
  cid: string;
  crid: string;
}

const sessionTokenClaimsSchema = z.object({
  sid: z.string().uuid(),
  aid: z.string().uuid(),
  cid: z.string().uuid(),
  crid: z.string().uuid()
});

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
    return sessionTokenClaimsSchema.parse(verified.payload);
  } catch {
    throw new ApiError("Session expired", 401, "SESSION_EXPIRED");
  }
}
