import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveIdentities,
  resolveIdentity
} from "@/lib/services/identity-resolver-service";

const ADDRESS = "0x1111111111111111111111111111111111111111";

test("identity resolver reports blank input as unknown rather than throwing", () => {
  const result = resolveIdentity("   ");

  assert.equal(result.type, "unknown");
  assert.equal(result.source, "raw");
  assert.equal(result.canonical, "");
});

test("identity resolver recognizes a bare EVM address", () => {
  const result = resolveIdentity(ADDRESS);

  assert.equal(result.type, "address");
  assert.equal(result.source, "address");
  assert.equal(result.canonical.toLowerCase(), ADDRESS);
});

test("identity resolver trims surrounding whitespace before resolving", () => {
  const result = resolveIdentity(`  ${ADDRESS}  `);

  assert.equal(result.type, "address");
  assert.equal(result.input, ADDRESS);
});

test("identity resolver upgrades a CAIP-10 account to did:pkh", () => {
  const result = resolveIdentity(`eip155:66238:${ADDRESS}`);

  assert.equal(result.type, "did-pkh");
  assert.equal(result.source, "caip10");
  assert.ok(result.canonical.startsWith("did:pkh:eip155:66238:"));
});

test("identity resolver canonicalizes a did:pkh identifier", () => {
  const result = resolveIdentity(`did:pkh:eip155:66238:${ADDRESS}`);

  assert.equal(result.type, "did-pkh");
  assert.equal(result.source, "did-pkh");
  assert.equal(result.canonical, `did:pkh:eip155:66238:${ADDRESS}`);
});

test("identity resolver labels a did:web by its domain", () => {
  const result = resolveIdentity("did:web:example.com");

  assert.equal(result.type, "did-web");
  assert.equal(result.source, "did-web");
  assert.equal(result.label, "example.com");
});

test("identity resolver labels a did:handle with its platform", () => {
  const result = resolveIdentity("did:handle:github:octocat");

  assert.equal(result.type, "did-handle");
  assert.equal(result.label, "octocat (github)");
});

test("identity resolver truncates long did:key values for display", () => {
  const did = `did:key:z${"6".repeat(60)}`;
  const result = resolveIdentity(did);

  assert.equal(result.type, "did-key");
  assert.ok(result.label.includes("..."));
  assert.ok(result.label.length < did.length);
});

test("identity resolver recognizes did:ethr identifiers", () => {
  const result = resolveIdentity(`did:ethr:${ADDRESS}`);

  assert.equal(result.type, "did-ethr");
  assert.equal(result.source, "did-ethr");
});

test("identity resolver falls back to raw for an unrecognized DID method", () => {
  const result = resolveIdentity("did:example:something-unusual");

  assert.equal(result.type, "unknown");
  assert.equal(result.source, "raw");
});

test("identity resolver never throws on hostile input", () => {
  const inputs = [
    "not a did at all",
    "did:",
    "did:pkh:",
    "eip155::",
    "0xshort",
    "::::",
    "did:web:",
    "\u0000\u0001"
  ];

  for (const input of inputs) {
    const result = resolveIdentity(input);
    assert.equal(typeof result.canonical, "string", `${input} must resolve to a string`);
    assert.ok(result.label.length > 0 || result.canonical === "", `${input} must produce a label`);
  }
});

test("identity resolver always echoes the caller's input", () => {
  const result = resolveIdentity("did:web:example.com");

  assert.equal(result.input, "did:web:example.com");
});

test("identity resolver treats a bare unqualified string as a did:web host", () => {
  const result = resolveIdentity("garbage");

  assert.equal(result.type, "did-web");
  assert.equal(result.canonical, "did:web:garbage");
  assert.equal(result.input, "garbage");
});

test("identity resolver preserves order and arity when resolving a batch", () => {
  const { identities } = resolveIdentities([
    ADDRESS,
    "did:web:example.com",
    "did:example:something-unusual"
  ]);

  assert.equal(identities.length, 3);
  assert.deepEqual(
    identities.map((entry) => entry.type),
    ["address", "did-web", "unknown"]
  );
});

test("identity resolver returns an empty batch for an empty request", () => {
  assert.deepEqual(resolveIdentities([]), { identities: [] });
});
