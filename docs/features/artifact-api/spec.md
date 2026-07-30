# Artifact Trust Public API — Backend Spec

**Status:** Implemented  
**Issue:** [#16](https://github.com/oma3dao/omatrust-backend/issues/16)  
**Scope:** unauthenticated, read-only trust lookup for `did:artifact` subjects

## Goal

Provide MPAS credential adapters and other verifiers one authoritative API for
the verified OMATrust information associated with a plugin's `did:artifact`.
The API is an evidence lookup, not a policy verdict: clients decide how the
returned verified evidence affects their own trust decision.

The service MUST return only attestations that pass every applicable
verification rule. A valid artifact DID with no qualifying evidence is a
successful lookup with all evidence groups empty.

## Scope

### In scope

- `GET /api/public/artifact-trust?artifactDid=did:artifact:...` with no
  authentication, session, premium-read requirement, or caller-selected chain.
- Discovery and verification of artifact attestations using the active chain's
  EAS contract and **public** RPC provider.
- Recognized schema, payload/proof, timestamp, issuer, and controller
  authorization checks before an attestation is exposed.
- A stable JSON response that is safe for browser and CLI clients; all bigint
  values are decimal strings.
- Complete-result semantics: success never silently represents a partial EAS
  scan as a complete answer.

### Out of scope

- Loading or hashing `plugin.json`; MPAS continues to verify that locally.
- A backend-generated `trusted` / `untrusted` verdict or configurable client
  policy.
- Returning unverified attestations, diagnostics for excluded attestations, or
  a query parameter that weakens verification.
- Generic lookup for all DID methods. The service should be structured so it
  can be generalized later, but V1 accepts only `did:artifact`.

## Public endpoint

### Request

```http
GET /api/public/artifact-trust?artifactDid=did%3Aartifact%3Abafk...
Accept: application/json
```

`artifactDid` is required and MUST pass the SDK's `parseArtifactDid()`
validation. The returned DID is the canonical value produced by that parser;
the service must not use a loosely normalized string for an on-chain lookup.

V1 has no `chain` parameter. It queries the chain selected by the backend
environment's `OMATRUST_ACTIVE_CHAIN` value and its corresponding public RPC
endpoint. Therefore testnet and production deployments can return evidence
from different configured chains. The response always identifies the actual
chain and EAS contract used. A future multi-chain API can add an allowlisted
chain selector, but MUST not accept a caller-supplied RPC URL.

The endpoint is registered through `withRoute()` with `auth: "none"`, using:

- `src/app/api/public/artifact-trust/route.ts`
- `src/lib/routes/public/artifact-trust.ts`
- `src/lib/services/artifact-trust-service.ts`

It MUST use `getPublicRpcProvider()` only. It MUST NOT use
`getPremiumRpcProvider()`, proxy arbitrary JSON-RPC methods, or consume a
subscriber's premium-read quota.

### Successful response

```json
{
  "artifactDid": "did:artifact:bafk...",
  "chain": {
    "chainId": 6623,
    "caip2": "eip155:6623",
    "easContract": "0x..."
  },
  "trustAnchorsVersion": 1,
  "responsibilityClaims": [],
  "securityAssessments": [
    {
      "attestation": {
        "uid": "0x...",
        "schema": "0x...",
        "schemaName": "security-assessment",
        "attester": "0x...",
        "attesterLabel": "OMA3 Security Lab",
        "recipient": "0x...",
        "time": "1784822400",
        "expirationTime": "0",
        "revocationTime": "0",
        "data": {}
      },
      "verification": {
        "valid": true,
        "basis": ["approved-issuer"]
      }
    }
  ],
  "certifications": [],
  "otherAttestations": [],
  "summary": {
    "totalQueried": 4,
    "totalVerified": 1,
    "totalExcluded": 3,
    "complete": true
  }
}
```

The four evidence arrays deliberately mirror the SDK's
`GetVerifiedArtifactAttestationsResult` shape:

- `responsibilityClaims`
- `securityAssessments`
- `certifications`
- `otherAttestations`

`otherAttestations` is the flexible catch-all for recognized artifact-evidence
schemas that do not have one of the three dedicated groups. It can contain,
for example, linked-identifier attestations. Consumers should display linked
identifiers and decide their contextual relevance rather than assuming a
target match establishes trust. User reviews are not queried or returned
because their schema cannot establish a provable `did:artifact` binding.
Responsibility claims remain in their dedicated group so consumers can
prioritize the verified responsible party. Controller-witness attestations are
supporting authorization evidence, not direct claims about an artifact, and
are never returned in any evidence group. The `attestation.schema` and
additive `attestation.schemaName` identify each record's schema without
requiring a new top-level response field.

Each group is sorted by `attestation.time` descending, then UID ascending for
a deterministic result. `totalQueried` counts candidate attestations retrieved
from the completed EAS scan before filtering; `totalExcluded` is the
difference between that count and `totalVerified`. The response deliberately
does not identify or expose excluded records.

Every returned record has `verification.valid: true`. The `verification`
object keeps the SDK's attestation/verification nesting while giving clients a
concise explanation of the material trust mechanism that qualified this
record. `basis` is not a list of every passed validation and MUST NOT include
redundant boolean checks. Its V1 values are:

- `approved-issuer` — a trusted-attester schema was issued by an active,
  schema-authorized issuer.
- `proof` — a schema-specific proof was required and verified.
- `controller-authorization` — the relevant controller was authorized.
- `authorization-window` — the attestation was issued in that controller's
  valid authorization window.

Generic requirements—on-chain retrieval, anchor-recognized schema, exact
artifact binding, non-revocation, non-expiry, and valid payload—are fixed
endpoint invariants. They are not echoed as tautological response booleans.
Future basis values may be added; clients must not use `basis` to re-evaluate
validity or relax the endpoint's verification policy.

`attestation.data` is the decoded, public on-chain schema payload after
validation. It contains no server-only verification diagnostics. Recursive
serialization converts every `bigint` in `data` and the surrounding record to
a base-10 string. `expirationTime: "0"` means no EAS-level expiry.

An artifact with no candidates, or candidates that all fail verification,
returns the same success shape with all four evidence arrays empty,
`totalVerified: 0`, and `complete: true`.

## Verification model

The service obtains the active chain from `getActiveChain()` and the matching
`eip155:<chainId>` trust-anchor entry from `getPublicTrustAnchors()`. Schema
UIDs, EAS contract address, CAIP-2 identifier, issuer registry, and anchor
version are derived from those sources; they are never supplied by the caller
or hardcoded into the service.

The server maintains a small schema-policy catalog keyed by trust-anchor
schema name. It selects the appropriate SDK verification path and states
whether the schema uses the trusted-attester model or is direct artifact
evidence. It MUST NOT duplicate schema UIDs or EAS schema strings. For every
active policy, the service derives the UID from the active trust anchors,
resolves the schema-registry address from the configured EAS contract's
`getSchemaRegistry()` call, and uses the SDK's `getSchemaDetails()` to obtain
the schema string. It then uses `decodeAttestationData()` and
`validateAttestationData()` for payload decoding and structural validation.

This keeps the policy decision local to the backend while making schema
identity and field definitions chain-derived and verifiable on-chain.

V1 supports the artifact-relevant recognized schemas below. A trust-anchor
entry that has no artifact validation catalog entry is not queried or exposed
until that validator exists.

| Trust-anchor schema       | API treatment                        | Response group         | SDK validation and backend policy                                                                                                                                                                                                                                                                           | Why this treatment applies                                                                                                                                                     |
| ------------------------- | ------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `responsibility-claim`    | Primary artifact evidence            | `responsibilityClaims` | Require `subject` to equal the requested artifact DID. Treat `responsibleParty` as the separate entity accepting responsibility. Call `verifyResponsibilityClaim()` for the attesting controller's relationship to that responsible-party identity and the issuance authorization window. Do not require `proofs[]` / `verifyAttestation()` — that field is reserved/unused for this schema. | The artifact DID cannot authorize an attester; it identifies the artifact. The responsible-party DID identifies the accountable entity.                                        |
| `security-assessment`     | Primary artifact evidence            | `securityAssessments`  | Resolve the schema from the registry; decode and structurally validate its payload; require an active issuer approved for this schema. The schema has no proof array, so approved-issuer policy is its material trust mechanism.                                                                            | It is an explicit third-party cybersecurity assessment of the artifact.                                                                                                        |
| `linked-identifier`       | Secondary artifact evidence          | `otherAttestations`    | Resolve/decode/validate with SDK; require `verifyLinkedIdentifierProofs()` and all applicable controller-relationship and authorization-window checks.                                                                                                                                                      | It presents a verified association for consumers to display and interpret; the endpoint does not decide whether that association is trustworthy or relevant to an MPAS target. |
| `certification`           | Informational artifact evidence      | `certifications`       | Resolve/decode/validate with SDK and require an active issuer approved for this schema.                                                                                                                                                                                                                     | It remains SDK-compatible evidence but does not satisfy either primary MPAS trust check.                                                                                       |
| `user-review`             | Unsupported for artifact trust in V1 | Not returned           | Do not query or expose it from this endpoint.                                                                                                                                                                                                                                                               | Its schema cannot establish a provable binding to the requested `did:artifact`.                                                                                                |
| `controller-witness`      | Supporting controller evidence       | Not returned           | Used only by `getControllerAuthorization()` while verifying a responsibility claim or linked identifier. It is not queried as a direct artifact candidate and never appears in the public response.                                                                                                         | It helps establish a controller relationship for another claim; it is not itself a claim about the artifact.                                                                   |
| Any other anchored schema | Unsupported in V1                    | Not returned           | It has no active artifact-trust policy and is neither queried nor exposed until its semantics are explicitly defined.                                                                                                                                                                                       | Anchor recognition alone must not make a new schema public artifact evidence.                                                                                                  |

For each candidate, the service MUST verify all applicable conditions:

1. It was fetched from the configured EAS contract through public RPC and its
   on-chain attestation is present.
2. Its schema UID is recognized in the active chain's trust anchors and has an
   active direct-artifact policy.
3. Its subject is exactly the requested canonical `did:artifact` (including
   the decoded payload subject where the schema includes one).
4. EAS revocation time is zero and EAS expiration is zero or in the future.
5. The schema payload is well-formed; its own effective and expiration times
   are currently valid.
6. Required proofs validate.
7. For a trusted-attester schema, the attester matches an active approved
   issuer whose allowed-schema list includes the schema. The issuer must have
   been effective when the attestation was issued and must not be revoked.
8. For responsibility claims, `subject` equals the artifact DID and
   `responsibleParty` identifies the separate entity accepting responsibility.
   The artifact DID does not authorize the attester. The SDK verifies the
   attesting controller's relationship to the responsible-party identity and
   the issuance authorization window. Responsibility-claim `proofs[]` is
   unused and MUST NOT be required. For linked identifiers, their applicable
   authorization-proof and controller checks also validate. Those checks may
   consult controller-witness attestations as supporting evidence, but the
   witnesses are not returned.

The service relies on SDK primitives rather than reimplementing EAS handling:
`parseArtifactDid()`, `getSchemaDetails()`, `decodeAttestationData()`,
`validateAttestationData()`, `verifyAttestation()`,
`verifyLinkedIdentifierProofs()`, `verifyResponsibilityClaim()`, and
`getControllerAuthorization()`. `getVerifiedArtifactAttestations()` may be
used for candidate grouping, but MUST NOT be returned as-is: its current
result may include invalid standard attestations or an undefined verification
result. The backend MUST apply its strict policy, filter on
`verification.valid === true`, and exclude controller witnesses before
serialization. Any SDK result that cannot be decoded or fully verified is
excluded, never promoted to a successful response.

## Completeness and failure behavior

The service must not use a caller-controlled `limit`, block range, schema
list, `includeInvalid`, or verification-bypass option. It must scan all
artifact candidates in the supported schema set over the configured complete
query range. If the underlying SDK's default block window or result limit
would truncate results, the service must page/chunk internally or fail rather
than report an incomplete answer as complete.

Any RPC, EAS, event-query, decoding, or required authorization-query failure
fails the entire request. The endpoint does not return a mixture of verified
records and a successful `complete: true` summary when one part of the
verification could not be performed.

| Condition                                                                                                   | HTTP status / code      | Response rule and caller meaning                                                               |
| ----------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| Missing, malformed, or non-`did:artifact` `artifactDid`                                                     | `400 INVALID_DID`       | No lookup occurs; the caller must correct the artifact identifier.                             |
| Active chain has no usable trust-anchor entry, EAS contract, EAS schema registry, or required schema policy | `400 UNSUPPORTED_CHAIN` | No evidence is returned; deployment configuration cannot support this verification request.    |
| Public RPC or EAS read/query failure; a full result cannot be produced                                      | `502 NETWORK_ERROR`     | No partial body is returned; clients treat trust information as unavailable rather than empty. |
| Unexpected server failure                                                                                   | `500 INTERNAL_ERROR`    | Public response omits implementation details; operators inspect server logs.                   |

The route maps SDK DID parsing errors to `INVALID_DID` and infrastructure
errors to `NETWORK_ERROR`; raw SDK or provider exception details are logged,
not included in the public response.

## Implementation boundaries

The service has four separable responsibilities:

1. Resolve the configured default-chain anchors and construct the immutable
   server-side verification configuration.
2. Retrieve every candidate from the active EAS contract with the public RPC
   provider.
3. Apply the schema-specific validators, issuer policy, and controller checks,
   retaining only verified records.
4. Map the result into the public contract, recursively serialize bigints, and
   calculate a complete summary.

Its dependencies should be injectable so route/service tests never require a
live RPC endpoint. The public route remains a thin Zod-validated adapter and
does not contain attestation or issuer policy.

README documentation is part of implementation: add the endpoint contract and
a `curl` example alongside the existing public trust-anchor sanity check.

## Acceptance criteria

- Valid artifact DID requests return only fully verified attestations.
- Empty verified results return `200` with all four evidence arrays empty and
  `complete: true`.
- Invalid, revoked, expired, malformed, unauthorized, incorrectly bound, or
  unapproved-issuer candidates are excluded.
- Responsibility claims bind the artifact `subject` to a separate
  `responsibleParty` and verify the attesting controller's relationship to that
  responsible party at issuance time. The artifact DID never acts as an
  authorizer. Linked identifiers enforce their relevant authorization-proof
  and controller checks. Controller-witness attestations support those checks
  but are never returned as artifact evidence.
- User reviews are neither queried nor returned because they cannot prove a
  `did:artifact` binding.
- Clients cannot change schema selection, scan range, or verification policy.
- The configured public RPC endpoint is the only chain transport used.
- RPC or verification failures do not yield misleading partial success.
- All bigint output is a decimal string.
- Unit, route, and integration tests cover every inclusion and exclusion rule.
