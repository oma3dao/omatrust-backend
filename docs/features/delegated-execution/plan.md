# Delegated Execution Backend

Status: Draft
Released in: Unreleased

Source: Adapted from `/Users/atom/Projects/oma3/Delegated_Execution_Design_v2.md`

---

# Delegated Execution Design for OMA3 / OMATrust

## Overview

This document outlines the design and implementation strategy for introducing delegated execution as a first-class pattern in OMATrust user flows.

Delegated execution allows users to authorize actions via signatures while a relay server submits transactions and pays gas in OMA.

The scope of this design covers:

- `rep-attestation-frontend`
- `app-registry-frontend`

This design does not propose delegated execution as the default for all contracts or all user interactions on OMAChain.

---

## Goals

- Remove requirement for users to hold OMA for basic actions
- Preserve wallet address as the signing identity
- Support EOAs, embedded wallets, MPC wallets, and smart contract wallets
- Enable subscription-based gating via backend
- Maintain direct onchain execution as an option
- Preserve cross-chain identity continuity without forcing users into chain-specific smart account deployments

"Preserve wallet address as the signing identity" does not mean the wallet becomes the billing or account root. In subject-scoped flows, the durable identity is the OMATrust subject (a canonical DID and its `subjectDidHash`), while wallets act as authorized keys for that subject. An account may manage multiple subject DIDs. For example, OMA3's account manages both `did:web:oma3.org` and `did:web:omatrust.org`.

Every account has at least one subject — a default `did:pkh` derived from the primary wallet. For accounts that only use this default subject, the wallet is effectively the primary identity and the account is a lightweight wrapper for billing and entitlement.

---

## User Flows

Four components participate in delegated execution:

1. **Wallet** — the signer. An EOA, embedded wallet, MPC wallet, or smart contract wallet that produces EIP-712 signatures.
2. **Subject** — the managed identity (a canonical DID). Optional. Only involved in subject-scoped actions like managing a `did:web` on behalf of an organization.
3. **Relay** — the gas payer. A backend service that verifies the wallet's signature and subscription entitlement, then submits the transaction to the smart contract.
4. **Smart contract** — the execution target. Verifies the signature onchain and executes the business logic with the wallet as the logical caller.

### Subscription Flow (relay pays gas)

```text
1. Wallet signs EIP-712 typed data (all parameters visible in wallet UI)
2. Frontend sends signed payload to relay (backend.omatrust.org)
3. Relay recovers signer from signature
4. Relay checks subscription entitlement for the signer's account
5. If subject-scoped: relay checks key-binding authorization onchain
6. Relay submits transaction to smart contract, paying gas in OMA
7. Smart contract verifies signature onchain and executes with wallet as the logical caller
```

### Crypto-Native Flow (wallet pays gas)

```text
1. Wallet signs and submits transaction directly to OMAChain RPC
2. Smart contract executes with msg.sender as the caller
3. Authorization (e.g., key-binding for subject-scoped actions) is checked onchain
   via OMATrust attestations (key bindings, linked identifiers)
```

Note: crypto-native wallets can still use the free delegated attestation server for user reviews and linked identifiers, just as they do today. The frontend routes to delegated or direct based on schema type. The distinction here is about who pays gas for non-subsidized actions.

Contracts must not rely solely on `msg.sender` for wallet identity in delegated flows. The relay must not rely solely on client-declared subject or wallet values — it must recover and verify the signer from the submitted signature.

### Privacy

- Wallet addresses go onchain (they are the signer in both flows)
- Subject DIDs go onchain only in subject-scoped flows (key bindings, linked identifiers)
- Account data (billing, subscription, team membership) never goes onchain — it exists only in the backend database

---

## Standard Pattern

### Internal Logic

```solidity
function _doThing(address actor, ...) internal {
    // core logic
}
```

### Direct Execution

```solidity
function doThing(...) external {
    _doThing(msg.sender, ...);
}
```

### Delegated Execution

```solidity
function doThingByDelegation(
    address actor,
    ...,
    DelegationAuth calldata auth
) external {
    _verifyDelegation(actor, ..., auth);
    _doThing(actor, ...);
}
```

Where relevant, app-layer parameters should also include subject identity material such as canonical DID or `subjectDidHash`, and the signed payload must bind those values.

---

## DelegationAuth Structure

```solidity
struct DelegationAuth {
    uint256 nonce;
    uint256 deadline;
    bytes signature;
}
```

The signature MUST bind the following at the typed-data layer:

- wallet address (recovered from signature)
- chainId (via EIP-712 domain separator)
- contract address (via EIP-712 domain separator)
- all function parameters individually (not as an opaque blob)
- subject identifier when the action is subject-scoped
- deadline
- nonce

All function parameters must be enumerated individually in the EIP-712 typehash, not hashed as a single opaque blob. This is critical for wallet UX: EIP-712's purpose is to let signers see exactly what they are signing. An opaque parameter hash defeats this — the wallet would show an unreadable bytes32 value instead of named, typed fields.

Each delegated function gets its own EIP-712 typehash (e.g., `MintByDelegation(...)`, `UpdateAppByDelegation(...)`). The type name and all field names are displayed in the wallet's signing prompt, so the signer can verify exactly which function and parameters they are authorizing.

This matches the approach used by EAS, where the `Attest` typehash enumerates `schema`, `recipient`, `expirationTime`, `revocable`, `refUID`, `data`, `value`, `nonce`, and `deadline` as individual fields.

The security of the system depends on the signed payload including correct domain separation and parameter binding regardless of what the onchain struct contains.

---

## Required Protections

Onchain protections:

- Nonce tracking (prevent replay)
- Deadline/expiry
- ChainId binding
- Contract address binding
- Function-specific typehash (each delegated function gets its own EIP-712 typehash, displayed in the wallet signing prompt, preventing cross-function replay)
- Individual parameter binding in typed data
- Domain separation (EIP-712)

### Nonce Model

New delegated functions MUST use sequential nonces: a single `uint256` counter per account, incremented on each use. This is the model used by EAS (`_nonces[attester]++`).

EAS is the high-volume path in this system (user reviews, linked identifiers, reputation attestations). The relay already needs nonce-management logic for sequential EAS nonces. Using the same model for app registry delegated functions keeps the relay simple — one nonce strategy, not two.

Sequential nonces also use less gas (~5k for a warm SSTORE vs ~20k for a cold SSTORE per new arbitrary nonce slot) and do not grow storage unboundedly.

The tradeoff is that sequential nonces serialize submissions per-user. In practice this is not a concern for app registry operations (mint, update, prepareRegister), which are inherently low-frequency per-user actions.

Note: `OMA3ResolverWithStore` uses arbitrary nonces (`mapping(address => mapping(uint256 => bool))`) for its existing `upsertDelegated` and `revokeDelegated` functions. This is a historical choice in an already-deployed contract and does not need to change. New delegated functions should follow the sequential model for consistency with EAS.

Operational protections for the sponsored path:

- Canonical DID normalization before any `subjectDidHash` computation
- Relay-side signature recovery rather than trusting JSON-supplied actor fields
- Explicit allowlist of sponsor-eligible functions and schemas
- Rate limits and spend limits
- Idempotency / replay protection at the relay layer
- Bootstrap-only authorization for first-bind flows
- ERC-1271 verification support for smart contract wallets

---

## Attribution

- **Wallet = signer**
- **Subject = managed identity / DID (optional)**
- **Relay = gas payer**

Contracts must emit events capturing:

- wallet (signer)
- relay (gas payer)
- action details

When a function is subject-scoped, the subject or `subjectDidHash` should also be emitted when practical.

---

## ERC721 Example

Delegated minting must:

- verify user signature
- call `_safeMint(to, tokenId)`
- never mint to `msg.sender` in delegated flow

Optional event:

```solidity
event MintedByDelegation(
    address indexed authorizer,
    address indexed relayer,
    address indexed recipient,
    uint256 tokenId
);
```

The same principle applies to OMATrust registry and attestation writes: delegated execution must preserve the user as the logical actor, not the relay.

---

## When to Use Delegation

Use for:

- user reviews
- attestations
- key bindings
- profile updates
- user-generated content

Avoid for:

- admin functions (onlyOwner setters, issuer management, policy configuration)
- treasury
- high-value transfers

Delegated execution should be the default sponsored path for `rep-attestation-frontend` and `app-registry-frontend`. Direct execution must remain available for crypto-native users. Admin functions in `app-registry-evm-solidity` (e.g., `onlyOwner` setters, issuer management, policy configuration) are explicitly out of scope for sponsored delegation. OMA3 does not use upgradeable proxy contracts, but admin operations should always require the admin to pay their own gas and sign directly.

---

## Economic Model

### 1. Crypto-Native Path

- User buys OMA on mainnet
- User bridges OMA to OMAChain
- User submits transactions directly and pays gas themselves

### 2. Sponsored Path

- User signs in with a wallet
- User purchases a subscription
- Subscription entitlement is associated with a subject identity
- Relay verifies eligibility and pays gas in OMA on the user's behalf

In the sponsored path, the relay may source OMA from secondary markets and maintain operational inventory for gas payments.

No end-user API key is required for browser flows. The relay authorizes sponsored execution based on:

- recovered wallet signer
- account subscription entitlement
- key-binding authorization (onchain check in V1, for subject-scoped actions)
- function/schema eligibility

---

## Architecture

### Sponsored Flow

```text
Frontend → backend.omatrust.org (verify signer + entitlement + policy) → submit tx → Contract executes
```

### Direct Flow

```text
User signs and sends transaction directly → Contract executes
```

Delegated execution is a transport and sponsorship pattern, not the only way to use the protocol.

### Service Topology

```text
┌─────────────────────────┐     ┌─────────────────────────┐
│ rep-attestation-frontend│     │ app-registry-frontend   │
│ (Vercel)                │     │ (Vercel)                │
└───────────┬─────────────┘     └───────────┬─────────────┘
            │                               │
            └───────────┬───────────────────┘
                        │
                        ▼
          ┌─────────────────────────┐
          │ backend.omatrust.org    │
          │ (omatrust-backend repo) │
          │ Vercel                  │
          ├─────────────────────────┤
          │ - subscription mgmt     │
          │ - relay authorization   │
          │ - tx submission         │
          │ - account mgmt          │
          │ - session + subject state│
          └───────────┬─────────────┘
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
   ┌─────────────┐      ┌──────────────┐
   │ Supabase    │      │ OMAChain RPC │
   │ (Postgres)  │      │              │
   └─────────────┘      └──────────────┘
```

`api.omatrust.org` remains the canonical public API facade via the existing `omatrust-api-gateway` repository. Long-term, `api.omatrust.org` will point directly at the backend service once existing APIs are migrated. The immediate subscription and relay flows call `backend.omatrust.org` directly from the frontends.

---

## Backend Service Repository

A new repository (`omatrust-backend`) hosts the shared backend logic. This is a Vercel-deployed service at `backend.omatrust.org`.

### Responsibilities

- SaaS-style account management (individuals, organizations)
- Subscription and entitlement management
- Relay authorization and transaction submission
- Bootstrap authorization / sponsorship voucher logic
- Onchain key-binding checks for subject authorization (direct RPC in V1)
- Nonce management for delegated execution

### What does NOT live here

- Smart contract source code (stays in `app-registry-evm-solidity`)
- Frontend UI code (stays in respective frontend repos)
- Public API gateway routing (stays in `omatrust-api-gateway`)

### Visibility and secrets

The repo can be public on GitHub. Secrets (private keys, Supabase service role keys, Thirdweb credentials) remain in Vercel environment variables and are never committed.

Protocol truth still lives in wallets, DIDs, key bindings, and onchain state. The backend is an overlay for managed UX, billing, relay policy, and account management.

### Proposed repo structure

```text
omatrust-backend/
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── health/             # Health + readiness
│   │       └── private/            # First-party API routes (called by OMATrust frontends)
│   │           ├── accounts/
│   │           ├── relay/
│   │           ├── session/
│   │           ├── subjects/
│   │           └── subscriptions/
│   ├── lib/                        # Shared business logic
│   │   ├── auth/                   # SIWE, session tokens, cookies
│   │   ├── config/                 # Environment variable validation + RPC selection
│   │   ├── db/                     # Supabase access + row types
│   │   ├── policy/                 # Sponsor-eligible functions/schemas
│   │   ├── services/               # Account/session/subscription/relay services
│   │   ├── utils/                  # Shared helpers
│   │   └── validation/             # Request schemas
├── supabase/
│   └── migrations/                 # Versioned schema changes
├── docs/
│   └── features/
│       └── delegated-execution/
│           ├── plan.md
│           └── spec.md
├── test/                           # Optional tests / fixtures
├── package.json
├── tsconfig.json
└── README.md
```

### API migration note

Some existing backend APIs currently live in the frontend repositories (e.g., `delegated-attest`, `nonce`, `controller-witness` in `rep-attestation-frontend`). These will migrate to `omatrust-backend` over time. That migration is a separate sequencing concern and is not a prerequisite for Phase 1 — Phase 1 can build new endpoints in the backend repo while existing frontend APIs continue to function.

During Phase 1, the recommended coexistence strategy is frontend routing rather than backend proxying:

- existing subsidized delegated-attest flows (for example `user-review` and `linked-identifier`) may continue to call the legacy frontend-hosted delegated-attest server
- new subscription-gated delegated-attest flows should call `omatrust-backend`
- non-sponsored actions continue to use direct execution

This means frontends may temporarily maintain multiple execution paths during migration:

- legacy delegated-attest server for existing subsidized schemas
- `omatrust-backend` for new subscription-gated delegated execution
- direct execution for crypto-native/non-sponsored flows

This is preferred to adding proxy logic from `omatrust-backend` to the legacy delegated-attest server in V1. The proxy approach would add transitional complexity to the new backend for little near-term benefit. Once migration is complete, the legacy delegated-attest server functionality should be absorbed into `omatrust-backend`, and OMATrust frontends and widget clients should converge on the new backend as the shared delegated execution surface.

---

## Backend Data Model

This is a V1 model for launch, not the final enterprise SaaS model. It is intentionally simple.

### V1 Assumptions

- one account owns exactly one subscription (including free tier — every account has a subscription)
- one account has one or more wallets, but the V1 UI only exposes one wallet per account
- every account has at least one subject (a default `did:pkh` derived from the primary wallet), but the V1 UI only exposes one subject
- additional subject-scoped flows (e.g., `did:web` management) are optional
- RBAC / roles are deferred
- key-binding cache is deferred — V1 checks key-binding authorization directly onchain
- an account is a generic entity — the data model does not distinguish between individuals and organizations

### V1 Components

**account**
- internal database identity (UUID or similar)
- root SaaS entity for billing and entitlement
- a generic entity — could be a person, a company, or any other customer
- has a display name (optional in V1, used for UI labeling)
- owns the subscription
- linked to one or more wallets (V1 UI exposes one)
- has at least one subject — a default `did:pkh` subject is auto-created from the wallet at account creation
- may have additional subjects added later (V1 UI exposes one)
- created when a wallet first signs in

**subscription**
- belongs to an account (FK → account)
- every account has exactly one subscription, including a free tier
- represents plan / entitlement for sponsored execution
- determines what the relay will sponsor for this account (e.g., N sponsored writes per year on free, a much larger annual write allotment on paid)
- determines annual premium-read access to the premium RPC endpoint
- includes plan type, status (active/expired/cancelled), entitlement period, payment provider reference
- created automatically with the account (free tier by default, upgraded after payment)

**wallet**
- linked to an account (FK → account)
- stored canonically as `did:pkh` in V1, with chain/address metadata retained for interoperability
- the signer used for authentication and delegated execution signatures
- persists a wallet-scoped `execution_mode` of `subscription` or `native`
- `inApp` wallets are always assigned `subscription`
- one wallet per account in V1 UI (schema supports many)
- the wallet that created the account is the primary wallet

**subject**
- linked to an account (FK → account)
- every account has at least one subject: a default `did:pkh` derived from the primary wallet at account creation
- additional subjects can be added for subject-scoped actions (e.g., managing a `did:web` on behalf of an organization)
- stored as canonical DID string and `subjectDidHash` (derived via `computeDidHash(normalizeDid(did))`)
- one subject exposed in V1 UI (schema supports many)

### V1 Relationships

```text
account  1 ────  1    subscription
account  1 ────  1*   wallet          (* many supported in schema, one exposed in V1 UI)
account  1 ────  1..*  subject        (* at least one default did:pkh, many supported, one exposed in V1 UI)
```

- wallet signs actions on behalf of the account
- subscription determines what the relay will sponsor (free tier included)
- every account has at least one subject (default `did:pkh` from wallet); additional subjects are for subject-scoped flows

### Authorization Source of Truth

- the database stores SaaS state: account, subscription, wallet, subject
- onchain attestations and key bindings remain the source of truth for subject authorization
- in V1, the relay checks key-binding authorization directly onchain rather than relying on a database cache
- caching key-binding authorization is a later optimization, not a V1 requirement

### Deferred for Later

- multi-wallet accounts in the UI
- multiple subjects per account in the UI
- team membership and member management
- RBAC / roles
- cached key-binding authorization tables
- bootstrap voucher / bootstrap authorization flow
- relay request logs and idempotency records (may be added during V1 if needed)

---

## Identity and Subscription Model

A thin SaaS identity layer supports managed UX, billing, and relay sponsorship. See Backend Data Model above for the V1 entity definitions.

This layer is additive, not foundational. Pure crypto-native users must be able to use direct execution without depending on it.

### Design principles

- an account is a generic entity — no distinction between individuals and organizations at the data model level
- every account has a subscription (free tier by default), so the relay always has a consistent entitlement check
- every account has at least one subject (default `did:pkh` from wallet)
- wallets are authorized signers for the account
- additional subject DIDs are optional and only relevant for subject-scoped actions (e.g., `did:web` management)
- protocol truth remains reconstructable from wallets, DIDs, and key bindings even if the SaaS layer is not used

---

## Canonicalization Requirements

All subject-scoped entitlement and authorization checks MUST use canonical DID normalization before hashing. These requirements only apply when a subject DID is involved — individual wallet-only flows do not require DID canonicalization.

The OMATrust SDK provides the relevant canonicalization and hashing helpers:

- `normalizeDid(...)`
- `computeDidHash(...)`

Operational rules:

- Never hash raw user input directly if it has not been canonicalized
- Persist the canonical DID form alongside `subjectDidHash`
- Use canonical DID form consistently in subscription, subject, and relay policy records
- If billing, policy, and authorization records disagree on canonical DID, reject the request rather than guessing

---

## Relay Authorization Policy

For sponsored writes, the relay must verify all of the following before submission:

- recovered signer from the submitted EIP-712 signature
- active subscription entitlement for the signer's account
- if the action is subject-scoped: canonical subject DID or `subjectDidHash`, and signer is currently authorized for that subject (checked directly onchain in V1)
- requested function or schema is sponsor-eligible
- nonce, deadline, and replay protections are valid
- request satisfies rate-limit and spend-limit policy

In V1, key-binding authorization for subject-scoped actions is checked directly onchain via RPC rather than cached in the database. Caching is a later optimization for when request volume makes per-request RPC calls impractical.

For non-subject-scoped actions (e.g., an account holder writing a review), the relay only needs to verify the signer's subscription entitlement — no subject or key-binding check is required.

The relay must not trust:

- wallet address supplied only as JSON
- subject DID supplied only as raw user input
- subscription entitlement without signature verification
- signature verification without subject authorization

---

## Deferred Bootstrap Authorization

V1 does not require a separate bootstrap voucher flow.

The free tier includes enough annual sponsored writes to cover initial onboarding, including a first key binding when needed. That keeps the browser flow simpler and avoids introducing another token class before it is clearly necessary.

If onboarding later needs tighter pre-binding control, a future bootstrap design could add:

- DID ownership verification for non-default subjects such as `did:web`
- a short-lived server-signed JWS for first-bind flows
- single-use `jti` tracking in the database
- narrow action scoping limited to initial setup writes

---

## Smart Contract Wallet Support

Smart contract wallet support requires ERC-1271-compatible signature verification.

Smart contracts do not have private keys and cannot produce ECDSA signatures. ERC-1271 defines a standard `isValidSignature(bytes32, bytes)` interface that allows contracts to implement their own signature validation logic (multisig thresholds, session keys, etc.).

The delegation verifier should implement a two-path check:

1. Try `ecrecover` — if the recovered address matches the claimed signer, it's an EOA.
2. If the signer address is a contract (`address.code.length > 0`), call `isValidSignature` on it per ERC-1271.

OpenZeppelin's `SignatureChecker.isValidSignatureNow()` wraps both paths and is a recommended dependency.

---

## Cross-Chain Rationale

Delegated execution is preferred over making ERC-4337 the default for OMATrust.

Primary reasons:

- OMATrust identity continuity benefits from portable wallet signers across chains
- many OMATrust-related actions and contracts are cross-chain in nature
- ERC-4337 accounts are typically chain-specific deployments and introduce additional per-chain operational state
- requiring users to maintain separate smart accounts across multiple chains creates avoidable complexity

This does not make ERC-4337 invalid. It means ERC-4337 solves a different problem set than the one prioritized here.

Delegated execution preserves:

- cross-chain signer continuity
- wallet familiarity
- compatibility with embedded and crypto-native user flows
- gas abstraction without forcing a wallet abstraction model

---

## Wizard UX

The onboarding flow is a single wizard with branches depending on whether the wallet holder has a subject DID and how the wallet's persistent execution mode is established at first sign-in.

### Unified Flow

1. **Sign in** — wallet connects via Thirdweb (supports social wallets, hardware wallets, WalletConnect, and any compatible wallet provider)
2. **Account creation** — account is created automatically with a free-tier subscription. A default `did:pkh` subject is derived from the wallet.
3. **Optional: add a subject DID** — if the wallet holder manages an organization or domain identity, they can enter a subject DID (e.g., `did:web:example.com`). This is optional — skipping it means the account uses only the default `did:pkh` subject.
4. **Initial setup writes** — the free tier includes enough annual sponsored writes to cover setup actions such as a first key binding or linked identifier when needed.
5. **Establish wallet execution mode:**
   - **Managed `inApp` wallet:** backend automatically persists `execution_mode = subscription`
   - **Non-`inApp` wallet:** frontend asks the user to choose one persistent mode on first sign-in
     - **Subscription (relay pays gas):** wallet holder stays on free tier for limited annual sponsored writes or upgrades to paid for a much larger annual sponsored-write allotment. Delegated writes go through the relay.
     - **Crypto-native (wallet pays gas):** wallet holder submits transactions directly to OMAChain RPC. No relay involvement for normal submission routing. Authorization for subject-scoped actions is checked onchain via OMATrust attestations.
6. **Proceed** — wallet holder creates attestations, registers apps, or performs other actions using the wallet's persisted execution mode.

In V2, the frontend may add an explicit execution-mode management UI if OMATrust decides to support changing a wallet's persisted mode after onboarding.

### RPC Endpoint Tiers

OMA3 will maintain two types of RPC endpoints:

- A public, rate-limited endpoint available to all users
- A premium endpoint that scales and is reserved for paying subscribers and OMA3 internal use

Design guidance:

- the public rate-limited endpoint does not have subscription entitlement limits
- the premium endpoint is entitlement-limited
- free and paid subscriptions should be modeled with annual premium-read allotments for the premium endpoint
- when premium-read entitlement is exhausted, clients should be able to fall back to the public rate-limited endpoint rather than being fully blocked from reads

This model keeps the public endpoint open while still tying premium infrastructure access to subscription value.

---

## Implementation Strategy

### Phase 1 (EAS path — no new contracts)

1. Create `omatrust-backend` repository, deploy to Vercel at `backend.omatrust.org`
2. Build identity and subscription model (individual wallet-keyed, organization accounts) in Supabase
3. Integrate payment (credit card → subscription entitlement)
4. Implement relay authorization policy in backend (signer recovery, entitlement check, annual write limits, idempotency)
5. Implement EAS delegated attestation submission in backend — subscription-gated, supports any EAS schema. The existing delegated-attest flow in `rep-attestation-frontend` remains in place for currently subsidized schemas (`user-review`, `linked-identifier`) until the new backend is proven and ready to take over. Migrating the existing flow into `omatrust-backend` is a separate step, not a Phase 1 prerequisite.
6. Implement canonical DID and `subjectDidHash` handling for subject-scoped flows
7. Update `rep-attestation-frontend` to call `backend.omatrust.org` for delegated attestations
8. Add tests for:
   - subscription entitlement gating
   - signer recovery and validation
   - rate limiting
   - subject canonicalization
   - key-binding authorization

Note: bootstrap voucher (JWS) flow is deferred from Phase 1. The free tier includes enough sponsored write allowance to cover initial onboarding, including a first key binding. Bootstrap vouchers may be reintroduced later if onboarding needs tighter pre-binding control.

### Phase 2 (App Registry delegation — new contracts)

1. Create `DelegationVerifier` library with sequential nonce management
2. Add delegated entry points to `OMA3AppRegistry` (`mintByDelegation`, `updateAppControlledByDelegation`)
3. Add delegated entry point to `OMA3ResolverWithStore` (`prepareRegisterByDelegation`)
4. Keep direct functions intact
5. Extend `omatrust-backend` relay to support app registry delegated functions
6. Update `app-registry-frontend` to call `backend.omatrust.org` for delegated operations
7. Add tests for:
   - EIP-712 signature validation
   - replay protection
   - expiry
   - correct attribution
   - ERC-1271 smart contract wallet support

---

## Best Practices

- Reuse delegation logic across contracts
- Keep business logic separate from authorization
- Avoid generic unrestricted delegation routers
- Prefer explicit per-function delegation
- Keep direct execution permanently available
- Keep sponsor eligibility explicit and narrow
- Treat the SaaS layer as an overlay, not the protocol itself
- Bind sponsorship policy to canonical subject identity, not just wallet address

---

## Rollout Scope

### Phase 1: EAS Reputation Path (no new smart contracts)

The first implementation is the EAS delegated attestation path for `rep-attestation-frontend`. EAS already supports `attestByDelegation`, so no new smart contract work is required.

The current delegated-attest server only subsidizes `user-review` and `linked-identifier` schemas via a hardcoded allowlist. Phase 1 replaces this with the subscription-based SaaS model: a user puts down a credit card, gets a subscription, and can submit any attestation on EAS via the relay — not just the two currently subsidized schemas.

This requires:

- the identity and subscription model (individual wallet-keyed subscriptions, organization accounts for subject-scoped flows)
- relay authorization policy (subscription entitlement check instead of schema allowlist)
- payment integration (credit card → subscription)
- removing the hardcoded schema allowlist in favor of subscription-gated access

Phase 1 does not require new Solidity contracts, a `DelegationVerifier` library, or changes to `app-registry-evm-solidity`.

### Phase 2: App Registry Delegation

Phase 2 adds delegated entry points to `app-registry-evm-solidity` contracts (`mintByDelegation`, `updateAppControlledByDelegation`, `prepareRegisterByDelegation`) and extends the relay to support `app-registry-frontend`.

### Scope boundaries

Out of scope for sponsored delegated execution in any phase:

- arbitrary chain-wide contract writes
- privileged admin operations (onlyOwner setters, issuer management, policy configuration)
- treasury and asset-moving flows

The narrow scope is a feature, not a limitation. It keeps the sponsorship system aligned to low-risk, high-UX user actions first.

---

## Conclusion

Delegated execution provides the best balance of:

- UX (no gas requirement for sponsored users)
- flexibility (works with direct and sponsored flows)
- identity continuity (wallet remains the signer)
- cross-chain usability (does not force chain-specific smart account deployments)

For OMATrust, delegated execution should be the default sponsored pattern for user-facing writes in `rep-attestation-frontend` and `app-registry-frontend`.

It should not replace direct execution, and it should not be treated as a blanket rule for all OMAChain contracts.
