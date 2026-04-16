# Delegated Execution Spec

Status: Draft
Released in: Unreleased

## Goal

Implement the V1 OMATrust backend needed to support:

- SaaS-style accounts and subscriptions
- SIWE-authenticated first-party browser access
- subscription-gated delegated execution for Phase 1 EAS flows
- free-tier onboarding for initial subject-scoped setup

This spec is derived from the delegated execution plan and is intended to be implementable.

## Scope

This spec covers the V1 backend behavior for:

- `rep-attestation-frontend`
- later reuse by `app-registry-frontend`

This spec does not cover:

- public API endpoints for third-party integrators
- Phase 2 app-registry delegated contract calls
- full enterprise RBAC/team management
- cached key-binding authorization tables
- OAuth 2.0 DCR implementation details
- x402 auth-hints enforcement for OAuth-protected schemes
- bootstrap voucher implementation

## Proposed V1 Decisions

These are the implementation defaults for the first draft of the backend:

- first-party browser APIs live under `/api/private/...`
- no public API endpoints are required for V1
- Stripe is the payment provider
- every account has exactly one subscription record, including free tier
- plan set is:
  - `free`
  - `paid`
- relay authorization for subject-scoped actions checks key-binding state directly onchain in V1
- browser authentication uses SIWE
- successful browser auth establishes a backend-issued session
- browser session transport is an httpOnly secure cookie
- delegated blockchain actions still require fresh wallet EIP-712 signatures
- V1 does not implement OAuth 2.0 DCR, OAuth access tokens, or x402 auth-hints enforcement
- a `client` abstraction exists in the data model in V1 even though browser users do not see it directly
- `client_type` is deferred from V1
- the first-party browser client is a global/static internal client record in V1
- EAS sponsorship policy is configurable rather than hard-coded
- signature verification must support EOAs and ERC-1271 contract wallets
- the free tier includes at least enough sponsored write usage to cover initial onboarding, including a first key binding

## Must-Do Behavior

- create and manage accounts, subscriptions, wallets, subjects, clients, and sessions
- support SIWE-based authentication for OMATrust first-party browser frontends
- create a default `did:pkh` subject automatically when a new account is created
- allow a signed-in account to add a non-default subject DID
- verify delegated execution requests for sponsored Phase 1 EAS flows
- allow initial onboarding transactions through the free tier
- distinguish read entitlements from sponsored blockchain write entitlements
- return stable JSON error responses with machine-readable error codes

## Private API Endpoint Model

### Path Rules

- public endpoints, when they exist later, will live under `/api/...`
- first-party endpoints live under `/api/private/...`
- webhook endpoints that are server-to-server only also live under `/api/private/...`

### V1 Endpoint Groups

- `/api/private/session/...`
- `/api/private/accounts/...`
- `/api/private/subjects/...`
- `/api/private/subscriptions/...`
- `/api/private/relay/eas/...`

## Authentication and Session Model

### Proposed V1 Decision

V1 authentication is browser-focused:

- browser clients authenticate with SIWE
- backend issues a session after successful SIWE verification
- browser transports that session using an httpOnly secure cookie
- blockchain writes still require fresh EIP-712 wallet signatures when delegated execution is used

This keeps browser UX simple while preserving wallet possession as the root of authentication.

### Conceptual Distinctions

The backend must keep these identities separate:

- `account_id` = SaaS/account/billing root entity
- `subject DID` = managed identity such as `did:pkh` or `did:web`
- `wallet` = cryptographic signer used in SIWE and EIP-712 flows
- `client_id` = software/client identity
- `session` = temporary authenticated state
- `subscription` = billing/entitlement state

Important rules:

- `client_id` is not the same as `account_id`
- `client_id` is not the same as a wallet
- `client_id` is stable for a registered client, while its credentials may rotate over time
- in V1, browser flows use a global/static first-party client record even though the user is never shown a client registration concept

### Browser Auth Flow

1. browser requests SIWE challenge
2. wallet signs SIWE message
3. backend verifies signature
4. backend creates or loads account, wallet, default subject, free subscription, and associates the request to the first-party browser client
5. backend creates session
6. backend returns session via secure httpOnly cookie
7. subsequent browser requests use the cookie-backed session
8. delegated blockchain calls still require fresh EIP-712 signing by the wallet

### Browser Signature Verification Rules

- if signer is an EOA, verify via standard ECDSA recovery
- if signer is a smart contract wallet, verify via ERC-1271

### Deferred V2+ Auth Model

Programmatic / API / enterprise clients are expected to use:

- OAuth 2.0 Dynamic Client Registration (DCR)
- OAuth access tokens
- optional x402 auth-hints where a payment scheme requires OAuth

This is intentionally deferred from V1 implementation.

### Session Endpoints

#### `POST /api/private/session/challenge`

Creates a SIWE login challenge for a wallet.

Request:

```json
{
  "walletDid": "did:pkh:eip155:6623:0xabc...",
  "chainId": 6623,
  "domain": "reputation.omatrust.org",
  "uri": "https://reputation.omatrust.org"
}
```

Response:

```json
{
  "challengeId": "uuid",
  "siweMessage": "example.com wants you to sign in with your Ethereum account: ...",
  "nonce": "random-nonce",
  "expiresAt": "2026-04-15T20:00:00.000Z"
}
```

Behavior:

- challenge is short-lived
- challenge is single-use
- challenge binds wallet, domain, URI, issued-at, expiration, and nonce
- message format follows SIWE semantics

#### `POST /api/private/session/verify`

Verifies the signed SIWE challenge and creates a backend session.

Request:

```json
{
  "challengeId": "uuid",
  "walletDid": "did:pkh:eip155:6623:0xabc...",
  "signature": "0x...",
  "siweMessage": "example.com wants you to sign in with your Ethereum account: ..."
}
```

Response:

```json
{
  "account": {
    "id": "uuid",
    "displayName": null
  },
  "client": {
    "clientId": "omatrust-browser"
  },
  "session": {
    "id": "uuid",
    "expiresAt": "2026-04-16T20:00:00.000Z"
  }
}
```

Behavior:

- if wallet is unknown, create account + wallet + default subject + free subscription
- if wallet already belongs to an account, return that account
- associate session to the first-party browser client
- set session cookie in response

Cookie guidance:

- use `httpOnly`
- use `secure`
- use `sameSite=lax` or stricter as deployment permits
- cookie is the default browser transport in V1

#### `POST /api/private/session/logout`

Invalidates the current session.

#### `GET /api/private/session/me`

Returns the currently authenticated account context.

Response:

```json
{
  "account": {
    "id": "uuid",
    "displayName": null
  },
  "wallet": {
    "did": "did:pkh:eip155:6623:0xabc..."
  },
  "subscription": {
    "plan": "free",
    "status": "active"
  },
  "client": {
    "clientId": "omatrust-browser",
    "authMode": "siwe_session"
  },
  "primarySubject": {
    "canonicalDid": "did:pkh:eip155:6623:0xabc...",
    "subjectDidHash": "0x..."
  }
}
```

## Account Creation Rules

Account creation is implicit on first successful SIWE login verification.

On first successful `POST /api/private/session/verify`:

1. create `account`
2. create `wallet`
3. derive default `did:pkh` subject from the wallet and create `subject`
4. create free-tier `subscription`
5. associate to the global/static first-party browser `client`
6. create `session`

If the wallet already exists:

- no new account is created
- existing account context is returned

V1 does not require the browser user to register a client. The `client` abstraction exists internally for model consistency only.

## Account and Subject Endpoints

#### `GET /api/private/accounts/me`

Returns the current account record and summary data.

#### `PATCH /api/private/accounts/me`

Updates mutable account fields such as display name.

Request:

```json
{
  "displayName": "OMA3"
}
```

#### `GET /api/private/subjects`

Returns all subjects for the current account.

#### `POST /api/private/subjects`

Adds a non-default subject to the current account.

Request:

```json
{
  "did": "did:web:example.com"
}
```

Response:

```json
{
  "subject": {
    "id": "uuid",
    "canonicalDid": "did:web:example.com",
    "subjectDidHash": "0x...",
    "isDefault": false
  }
}
```

Behavior:

- normalize DID using OMATrust SDK helpers
- compute and persist `subjectDidHash`
- reject duplicate subject on same account
- reject globally conflicting subject if already claimed by another account

#### `GET /api/private/subjects/:subjectId`

Returns one subject owned by the current account.

## Subscription and Payment Endpoints

### Stripe

Stripe is the V1 billing provider.

Stripe is authoritative for payment completion and subscription billing state.

#### `GET /api/private/subscriptions/current`

Returns the current account subscription.

Response:

```json
{
  "subscription": {
    "plan": "free",
    "status": "active",
    "monthlySponsoredWriteLimit": 1,
    "monthlyApiReadLimit": 100,
    "currentPeriodStart": "2026-04-01T00:00:00.000Z",
    "currentPeriodEnd": "2026-05-01T00:00:00.000Z"
  }
}
```

#### `POST /api/private/subscriptions/checkout-session`

Creates a Stripe Checkout Session for upgrading to `paid`.

Request:

```json
{
  "plan": "paid",
  "successUrl": "https://reputation.omatrust.org/billing/success",
  "cancelUrl": "https://reputation.omatrust.org/billing/cancel"
}
```

Response:

```json
{
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

Behavior:

- current session required
- account must already exist
- create or reuse Stripe customer for the account

#### `POST /api/private/subscriptions/stripe-webhook`

Server-to-server Stripe webhook endpoint.

Expected event types:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Behavior:

- verify Stripe signature
- update local subscription state
- do not trust browser redirects as payment proof

## Relay Endpoints

### Phase 1 Rule

Phase 1 relay support is for EAS delegated attestation submission.

The existing frontend-hosted flow for currently subsidized schemas can remain in place during migration. This backend path is the new subscription-gated path and eventually the replacement path.

### Proposed Endpoint Shape

#### `GET /api/private/relay/eas/nonce?attester=0x...`

Returns the authoritative EAS nonce and chain metadata needed to build typed data.

V1 decision:

- accept raw EVM address at the relay boundary
- even though wallet identity is stored canonically as `did:pkh`, EAS nonce lookups are address-based and should remain address-based for compatibility

Response:

```json
{
  "nonce": "0",
  "chainId": 66238,
  "easAddress": "0x...",
  "chain": "OMAchain Testnet"
}
```

#### `POST /api/private/relay/eas/delegated-attest`

Accepts a signed delegated EAS attestation request and submits it if validation passes.

Request:

```json
{
  "attester": "0xabc...",
  "prepared": {
    "delegatedRequest": {},
    "typedData": {
      "domain": {},
      "types": {},
      "message": {}
    }
  },
  "signature": "0x..."
}
```

Response:

```json
{
  "success": true,
  "txHash": "0x...",
  "uid": "0x...",
  "blockNumber": 12345,
  "chain": "OMAchain Testnet"
}
```

Behavior:

- mirror the successful parts of the existing `rep-attestation-frontend` EAS route
- use OMATrust SDK EAS delegated helpers where appropriate
- server fetches authoritative nonce from chain
- server rebuilds typed data and verifies signature
- server checks entitlement and sponsor eligibility
- if validation passes, server submits tx
- if validation fails, server returns stable error code

Session/auth rule:

- browser caller must have an authenticated session
- delegated blockchain submission still requires a fresh wallet EIP-712 signature for the specific action

### Sponsor Eligibility

V1 sponsor decision checks:

- authenticated account exists
- authenticated browser session is valid
- attester matches authenticated wallet or explicitly selected account wallet
- subscription status is active
- monthly sponsored write allowance not exhausted
- if subject-scoped, key-binding authorization exists onchain
- schema/function is eligible under current sponsor policy

### Sponsor Policy Configuration

V1 schema sponsorship must be configurable.

Behavior:

- backend supports EAS delegated submission generically
- sponsor policy determines which schemas are eligible for free vs paid plans
- this matches the existing pattern used by the current delegated attestation server
- current free-sponsored examples include `user-review` and `linked-identifier`

This avoids hard-coding universal sponsorship into the backend while keeping policy flexible.

### Onboarding Through Free Tier

V1 does not use a separate bootstrap voucher/token flow.

Instead:

- the free tier includes enough sponsored write usage to support initial onboarding
- the first key binding can be submitted as a normal sponsored delegated write
- once key binding exists, normal subject authorization rules apply

This keeps onboarding simpler for V1 and avoids a separate bootstrap token contract in the browser.

## Error Model

All API errors return JSON:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE"
}
```

Suggested V1 error codes:

### Auth / Session

- `UNAUTHENTICATED`
- `INVALID_CHALLENGE`
- `CHALLENGE_EXPIRED`
- `INVALID_SIGNATURE`
- `SESSION_EXPIRED`
- `SESSION_REVOKED`
- `CLIENT_NOT_ALLOWED`

### Account / Subject

- `ACCOUNT_NOT_FOUND`
- `WALLET_ALREADY_LINKED`
- `SUBJECT_ALREADY_EXISTS`
- `SUBJECT_OWNED_BY_ANOTHER_ACCOUNT`
- `INVALID_DID`

### Billing / Subscription

- `SUBSCRIPTION_REQUIRED`
- `SUBSCRIPTION_INACTIVE`
- `SPONSORED_WRITE_LIMIT_EXCEEDED`
- `API_READ_LIMIT_EXCEEDED`
- `STRIPE_ERROR`
- `INVALID_PLAN`

### Relay

- `ATTESTER_MISMATCH`
- `NONCE_LOOKUP_FAILED`
- `SIGNATURE_EXPIRED`
- `SCHEMA_NOT_ELIGIBLE`
- `SUBJECT_NOT_AUTHORIZED`
- `RATE_LIMITED`
- `RELAY_SUBMISSION_FAILED`

## Data Model

### Unified Internal Model

The backend models:

- accounts
- wallets
- subjects
- subscriptions
- clients
- sessions

Browser users do not need to see or manage the `client` abstraction directly, but the backend uses it so browser and future OAuth clients can share a consistent internal model.

### account

Purpose:

- SaaS root entity for billing and entitlement

Required fields:

- `id`
- `display_name`
- `created_at`
- `updated_at`
- `stripe_customer_id` nullable

### subscription

Purpose:

- current plan and billing state for an account

Required fields:

- `id`
- `account_id`
- `plan` enum: `free | paid`
- `status` enum: `active | canceled | past_due | incomplete | trialing`
- `monthly_sponsored_write_limit`
- `sponsored_writes_used_current_period`
- `monthly_api_read_limit`
- `api_reads_used_current_period`
- `current_period_start`
- `current_period_end`
- `stripe_subscription_id` nullable
- `stripe_price_id` nullable
- `created_at`
- `updated_at`

Constraints:

- one active subscription row per account in V1

### wallet

Purpose:

- wallet credentials associated with an account

Required fields:

- `id`
- `account_id`
- `did` unique
- `wallet_address`
- `caip2_chain_id`
- `is_primary`
- `created_at`

Terminology rules:

- CAIP-2 refers to the chain identifier
- CAIP-10 refers to the wallet/account identifier
- `did:pkh` is the canonical wallet-linked identity stored in V1
- do not refer to a wallet as “CAIP-2”

### subject

Purpose:

- managed identity for an account

Required fields:

- `id`
- `account_id`
- `canonical_did`
- `subject_did_hash`
- `is_default`
- `created_at`

Constraints:

- `canonical_did` unique across accounts
- `subject_did_hash` unique across accounts
- each account has at least one subject

### client

Purpose:

- software/client identity associated with an account

Required fields:

- `id`
- `account_id` nullable
- `client_id`
- `auth_mode` enum: `siwe_session | oauth_dcr`
- `display_name`
- `did` nullable
- `created_at`
- `revoked_at` nullable

V1 guidance:

- browser-authenticated accounts associate to a global/static first-party browser client such as `omatrust-browser`
- the global/static browser client may have `account_id = null`
- browser users do not need to manage this abstraction directly
- `client_type` is deferred to V2+
- OAuth DCR clients are deferred to V2+

Future guidance:

- a stable `client_id` may later have multiple credentials/keys over time
- credential rotation should not require changing `client_id`

### session

Purpose:

- temporary authenticated state after successful browser login

Required fields:

- `id`
- `account_id`
- `client_id`
- `wallet_id` nullable
- `expires_at`
- `revoked_at` nullable
- `created_at`

V1 guidance:

- browser sessions are transported via secure httpOnly cookie by default
- non-browser bearer transport is deferred to V2+

### V1 Relationships

```text
account  1 ────  1    subscription
account  1 ────  1*   wallet          (* many supported in schema, one exposed in V1 UI)
account  1 ────  1..* subject         (* at least one default did:pkh, many supported, one exposed in V1 UI)
account  1 ────  N    session
client   1 ────  N    session
```

- wallet signs actions on behalf of the account
- subscription determines what the relay will sponsor
- sponsored write limits and API read limits are tracked separately
- every account has at least one subject (default `did:pkh` from wallet); additional subjects are for subject-scoped flows
- client identifies software/client identity and is not the same as the account or wallet; the first-party browser client may be global rather than account-owned
- session represents temporary authenticated state and is associated with both account and client

### Authorization Source of Truth

- the database stores SaaS state: account, subscription, wallet, subject, client, session
- onchain attestations and key bindings remain the source of truth for subject authorization
- in V1, the relay checks key-binding authorization directly onchain rather than relying on a database cache
- caching key-binding authorization is a later optimization, not a V1 requirement

## Onchain Key-Binding Lookup Rules

V1 uses direct onchain lookups via RPC.

Backend behavior:

- use OMATrust SDK and documentation at `docs.omatrust.org` as the source of truth
- do not invent a parallel authorization model in the database
- for subject-scoped requests, verify the signer is authorized for the subject via current OMATrust key-binding / related attestation rules

Implementation guidance:

- reuse SDK helpers wherever they already exist
- mirror existing frontend attestation submission patterns where needed
- prefer one backend verification module so frontend and backend logic do not drift

## Session Transport Guidance

V1 transport rules:

- browser sessions use secure httpOnly cookies by default
- delegated blockchain actions still require explicit wallet signatures

Future transport rules:

- non-browser clients may use bearer token transport
- this is a transport difference, not a different account model
- browser login remains SIWE, not OAuth DCR

## Signing Key Guidance

The system uses multiple distinct key types:

- relay transaction signer
  - used to submit OMAChain transactions
  - separate from auth/session signing
- backend token / signing key
  - used for backend-issued signed objects if needed in the future
  - for V1 this may be a dedicated application signing key stored in server secrets
- OAuth client credentials/keys
  - associated with registered OAuth clients in V2+
  - credentials may rotate while `client_id` remains stable
- wallet keys
  - used by end users for SIWE and EIP-712 delegated action signing

V1 guidance:

- do not use the relay transaction signer as the general-purpose backend token signing key
- do not imply a Thirdweb server wallet is the preferred root key for backend-issued auth/session artifacts
- HSM/KMS integration is a future hardening step, not a V1 requirement

## Smart Contract Wallet Support

Smart contract wallet support requires ERC-1271-compatible signature verification.

Smart contracts do not have private keys and cannot produce ECDSA signatures. ERC-1271 defines a standard `isValidSignature(bytes32, bytes)` interface that allows contracts to implement their own signature validation logic (multisig thresholds, session keys, etc.).

The delegation verifier should implement a two-path check:

1. Try `ecrecover` — if the recovered address matches the claimed signer, it's an EOA.
2. If the signer address is a contract (`address.code.length > 0`), call `isValidSignature` on it per ERC-1271.

OpenZeppelin's `SignatureChecker.isValidSignatureNow()` wraps both paths and is a recommended dependency.

## Potential Future Implementation: Bootstrap

Bootstrap is deferred from V1, but may be reintroduced later if onboarding needs more pre-binding control.

A future bootstrap model could include:

- backend verification of subject DID ownership before first key binding
- short-lived backend-issued authorization artifact
- single-use onboarding exception for first subject-scoped writes

If introduced later, bootstrap should remain:

- narrowly scoped
- short-lived
- separate from normal long-lived session semantics

## Acceptance Criteria

- browser SIWE session flow is documented and implementable
- V1 private API endpoints are enumerated with request/response contracts
- Stripe integration points are specified
- relay validation rules are specified
- V1 data model is explicit enough to implement migrations
- `client` and `session` entities are included without overengineering OAuth into V1
- bootstrap is deferred from V1
- `client_type` is deferred from V1
- read and write entitlements are distinguished
- static browser client decision is reflected in the data model
- raw EVM address nonce boundary is reflected in the relay contract
- configurable schema sponsorship is reflected in sponsor policy
- error codes are defined for expected failure modes
- unresolved items are called out instead of hidden

## Open Questions

- exact free-tier monthly sponsored write allowance
- exact free-tier monthly API read allowance
- exact paid-tier monthly sponsored write allowance
- exact paid-tier monthly API read allowance
- exact session lifetime and refresh behavior
- exact SIWE message fields to require across all frontends
- whether the initial V1 backend should support all EAS schemas immediately or a policy-configured subset by default configuration

## Deferred V2+ Topics

- OAuth 2.0 Dynamic Client Registration
- OAuth access tokens for programmatic and enterprise clients
- x402 auth-hints for OAuth-protected payment schemes
- bearer or DPoP token transport for non-browser clients
- bootstrap voucher/token model if onboarding hardening becomes necessary
- `client_type` and richer client metadata
- explicit `client_credential` / `client_key` model for client credential rotation
