import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { applyTestEnv } from "../helpers/env.ts";
import { ApiError } from "@/lib/errors";
import { signSessionToken, verifySessionToken } from "@/lib/auth/session-token";

const SESSION_SECRET = "test-session-secret-with-at-least-32-characters";

applyTestEnv({ OMATRUST_SESSION_SECRET: SESSION_SECRET });

/**
 * The session token is the only thing standing between an anonymous request and
 * an authenticated account context, so every rejection path matters. All of
 * them surface as 401 SESSION_EXPIRED — the service deliberately does not tell
 * a caller which check failed.
 */

const CLAIMS = {
  sid: randomUUID(),
  aid: randomUUID(),
  cid: randomUUID(),
  crid: randomUUID()
};

function inOneHour() {
  return new Date(Date.now() + 60 * 60 * 1000);
}

function isSessionExpired(error: unknown) {
  return error instanceof ApiError && error.statusCode === 401 && error.code === "SESSION_EXPIRED";
}

async function signWith(
  secret: string,
  claims: Record<string, unknown>,
  expiresAt: Date
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));
}

test("round-trips the session claims", async () => {
  const token = await signSessionToken(CLAIMS, inOneHour());
  const verified = await verifySessionToken(token);

  assert.equal(verified.sid, CLAIMS.sid);
  assert.equal(verified.aid, CLAIMS.aid);
  assert.equal(verified.cid, CLAIMS.cid);
  assert.equal(verified.crid, CLAIMS.crid);
});

test("rejects a token signed with a different secret", async () => {
  const token = await signWith(
    "a-completely-different-secret-of-sufficient-length",
    CLAIMS,
    inOneHour()
  );

  await assert.rejects(() => verifySessionToken(token), isSessionExpired);
});

test("rejects a token whose payload was tampered with", async () => {
  const token = await signSessionToken(CLAIMS, inOneHour());
  const [header, payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
  decoded.aid = randomUUID();
  const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");

  await assert.rejects(
    () => verifySessionToken(`${header}.${forgedPayload}.${signature}`),
    isSessionExpired
  );
});

test("rejects an expired token", async () => {
  const token = await signSessionToken(CLAIMS, new Date(Date.now() - 1000));

  await assert.rejects(() => verifySessionToken(token), isSessionExpired);
});

test("rejects a correctly signed token that is missing a required claim", async () => {
  const { crid, ...withoutCredential } = CLAIMS;
  const token = await signWith(SESSION_SECRET, withoutCredential, inOneHour());

  await assert.rejects(() => verifySessionToken(token), isSessionExpired);
});

test("rejects a correctly signed token whose claims are not uuids", async () => {
  const token = await signWith(
    SESSION_SECRET,
    { ...CLAIMS, sid: "session-1" },
    inOneHour()
  );

  await assert.rejects(() => verifySessionToken(token), isSessionExpired);
});

test("rejects a value that is not a token at all", async () => {
  await assert.rejects(() => verifySessionToken(""), isSessionExpired);
  await assert.rejects(() => verifySessionToken("not.a.token"), isSessionExpired);
});
