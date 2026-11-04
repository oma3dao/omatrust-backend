import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { parseCookie } from "@/lib/utils/http";
import { addMonths, addYears } from "@/lib/utils/date";

/**
 * parseCookie is the first step of every authenticated request. It hand-rolls
 * cookie parsing, so name matching and value decoding are worth pinning down.
 */

test("no cookie header means no session", () => {
  assert.equal(parseCookie(null, SESSION_COOKIE_NAME), null);
  assert.equal(parseCookie("", SESSION_COOKIE_NAME), null);
});

test("the session cookie is found among others regardless of position", () => {
  assert.equal(parseCookie(`${SESSION_COOKIE_NAME}=token-a; theme=dark`, SESSION_COOKIE_NAME), "token-a");
  assert.equal(parseCookie(`theme=dark; ${SESSION_COOKIE_NAME}=token-b`, SESSION_COOKIE_NAME), "token-b");
  assert.equal(
    parseCookie(`a=1;${SESSION_COOKIE_NAME}=token-c;b=2`, SESSION_COOKIE_NAME),
    "token-c"
  );
});

test("a cookie whose name merely ends with the session name is not accepted", () => {
  assert.equal(parseCookie(`not_${SESSION_COOKIE_NAME}=attacker`, SESSION_COOKIE_NAME), null);
  assert.equal(parseCookie(`x${SESSION_COOKIE_NAME}=attacker`, SESSION_COOKIE_NAME), null);
});

test("a missing cookie returns null rather than a neighbouring value", () => {
  assert.equal(parseCookie("theme=dark; locale=en", SESSION_COOKIE_NAME), null);
});

test("percent-encoded values are decoded", () => {
  assert.equal(parseCookie(`${SESSION_COOKIE_NAME}=a%20b%2Fc`, SESSION_COOKIE_NAME), "a b/c");
});

test("a JWT value containing padding characters survives intact", () => {
  const token = "header.payload.signature==";

  assert.equal(parseCookie(`${SESSION_COOKIE_NAME}=${token}`, SESSION_COOKIE_NAME), token);
});

test("an empty cookie value is returned as an empty string", () => {
  // The caller treats this as unauthenticated because "" is falsy.
  assert.equal(parseCookie(`${SESSION_COOKIE_NAME}=`, SESSION_COOKIE_NAME), "");
});

/**
 * Entitlement periods are a year long, so the date helpers decide when a
 * subscription's allowance resets.
 */

test("addYears advances the year", () => {
  const result = addYears(new Date(2026, 0, 15), 1);

  assert.equal(result.getFullYear(), 2027);
  assert.equal(result.getMonth(), 0);
  assert.equal(result.getDate(), 15);
});

test("addYears does not mutate its input", () => {
  const input = new Date(2026, 0, 15);
  addYears(input, 1);

  assert.equal(input.getFullYear(), 2026);
});

test("addYears rolls a leap day forward into March", () => {
  // 29 Feb 2024 + 1 year has no exact counterpart, so it lands on 1 Mar 2025.
  const result = addYears(new Date(2024, 1, 29), 1);

  assert.equal(result.getFullYear(), 2025);
  assert.equal(result.getMonth(), 2);
  assert.equal(result.getDate(), 1);
});

test("addMonths overflows a short month into the next one", () => {
  // 31 Jan 2026 + 1 month lands on 3 Mar 2026, since February has 28 days.
  const result = addMonths(new Date(2026, 0, 31), 1);

  assert.equal(result.getMonth(), 2);
  assert.equal(result.getDate(), 3);
});

test("addMonths does not mutate its input", () => {
  const input = new Date(2026, 0, 31);
  addMonths(input, 1);

  assert.equal(input.getMonth(), 0);
  assert.equal(input.getDate(), 31);
});
