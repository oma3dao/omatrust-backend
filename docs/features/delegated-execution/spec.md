# Delegated Execution Spec

Status: Draft
Released in: Unreleased

## Goal

Implement the V1 OMATrust backend needed to support:

- SaaS-style accounts and subscriptions
- wallet-authenticated first-party frontend access
- subscription-gated delegated execution for Phase 1 EAS flows
- bootstrap authorization for non-default subject onboarding

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
- wallet auth uses an EIP-712 challenge signed by the wallet
- signature verification must support EOAs and ERC-1271 contract wallets
- successful auth establishes a backend session so every request does not need a fresh login signature

## Must-Do Behavior

- create and manage accounts, subscriptions, wallets, and subjects
- support wallet-based authentication for OMATrust first-party frontends
- create a default `did:pkh` subject automatically when a new account is created
- allow a signed-in account to add a non-default subject DID
- issue and validate bootstrap vouchers for initial subject-scoped setup
- verify delegated execution requests for sponsored Phase 1 EAS flows
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
- `/api/private/bootstrap/...`
- `/api/private/relay/eas/...`

## Authentication and Session Model

### Proposed V1 Decision

Use a wallet-signed EIP-712 challenge for login, then issue a short-lived backend session.

This gives a better UX than forcing every account/subscription request to carry a one-off login signature, while still keeping wallet possession as the source of auth.

Signature verification rules:

- if signer is an EOA, verify via standard ECDSA recovery
- if signer is a smart contract wallet, verify via ERC-1271

### Session Endpoints

#### `POST /api/private/session/challenge`

Creates a login challenge for a wallet.

Request:

```json
{
  "wallet": "eip155:6623:0xabc...",
  "chainId": 6623
}
```

Response:

```json
{
  "challengeId": "uuid",
  "typedData": {
    "domain": {},
    "types": {},
    "message": {}
  },
  "expiresAt": "2026-04-15T20:00:00.000Z"
}
```

Behavior:

- challenge is short-lived
- challenge message is single-use
- challenge binds backend origin, wallet, issued-at, expiration, and nonce

#### `POST /api/private/session/verify`

Verifies the signed challenge and creates a backend session.

Request:

```json
{
  "challengeId": "uuid",
  "wallet": "eip155:6623:0xabc...",
  "signature": "0x..."
}
```

Response:

```json
{
  "account": {
    "id": "uuid",
    "displayName": null
  },
  "session": {
    "expiresAt": "2026-04-16T20:00:00.000Z"
  }
}
```

Behavior:

- if wallet is unknown, create account + wallet + default subject + free subscription
- if wallet already belongs to an account, return that account
- set session cookie or return session token depending on deployment approach

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
    "caip10": "eip155:6623:0xabc..."
  },
  "subscription": {
    "plan": "free",
    "status": "active"
  },
  "primarySubject": {
    "canonicalDid": "did:pkh:eip155:6623:0xabc...",
    "subjectDidHash": "0x..."
  }
}
```

## Account Creation Rules

Account creation is implicit on first successful wallet login.

On first successful `POST /api/private/session/verify`:

1. create `account`
2. create `wallet`
3. derive default `did:pkh` subject from the wallet and create `subject`
4. create free-tier `subscription`

If the wallet already exists:

- no new account is created
- existing account context is returned

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
    "monthlyCallLimit": 100,
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

## Bootstrap Endpoints

#### `POST /api/private/bootstrap/verify-did`

Begins or performs DID ownership verification for a subject.

Request:

```json
{
  "subjectId": "uuid",
  "method": "dns-txt"
}
```

Response:

```json
{
  "verification": {
    "method": "dns-txt",
    "challenge": "omatrust-challenge-value",
    "status": "pending"
  }
}
```

Behavior:

- supported V1 methods:
  - `dns-txt`
  - `did-json`
- for wallet-based DID methods, backend may support signature-based verification later

#### `POST /api/private/bootstrap/voucher`

Issues a bootstrap voucher once DID ownership verification succeeds.

Request:

```json
{
  "subjectId": "uuid",
  "allowedActions": ["key-binding:create"]
}
```

Response:

```json
{
  "voucher": "eyJ...",
  "expiresAt": "2026-04-15T20:00:00.000Z"
}
```

Behavior:

- voucher is JWS
- voucher is short-lived
- voucher is single-use via `jti`
- voucher is only valid for bootstrap-scoped actions

## Relay Endpoints

### Phase 1 Rule

Phase 1 relay support is for EAS delegated attestation submission.

The existing frontend-hosted flow for currently subsidized schemas can remain in place during migration. This backend path is the new subscription-gated path and eventually the replacement path.

### Proposed Endpoint Shape

#### `GET /api/private/relay/eas/nonce?attester=<caip10-or-address>`

Returns the authoritative EAS nonce and chain metadata needed to build typed data.

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

### Sponsor Eligibility

V1 sponsor decision checks:

- authenticated account exists
- attester matches authenticated wallet or explicitly selected account wallet
- subscription status is active
- monthly plan allowance not exhausted
- if subject-scoped, key-binding authorization exists onchain
- schema/function is eligible under current sponsor policy

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

### Account / Subject

- `ACCOUNT_NOT_FOUND`
- `WALLET_ALREADY_LINKED`
- `SUBJECT_ALREADY_EXISTS`
- `SUBJECT_OWNED_BY_ANOTHER_ACCOUNT`
- `INVALID_DID`

### Billing / Subscription

- `SUBSCRIPTION_REQUIRED`
- `SUBSCRIPTION_INACTIVE`
- `PLAN_LIMIT_EXCEEDED`
- `STRIPE_ERROR`
- `INVALID_PLAN`

### Bootstrap

- `DID_VERIFICATION_REQUIRED`
- `DID_VERIFICATION_FAILED`
- `BOOTSTRAP_VOUCHER_EXPIRED`
- `BOOTSTRAP_VOUCHER_ALREADY_USED`
- `BOOTSTRAP_VOUCHER_INVALID`

### Relay

- `ATTESTER_MISMATCH`
- `NONCE_LOOKUP_FAILED`
- `SIGNATURE_EXPIRED`
- `SCHEMA_NOT_ELIGIBLE`
- `SUBJECT_NOT_AUTHORIZED`
- `RATE_LIMITED`
- `RELAY_SUBMISSION_FAILED`

## Data Model

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
- `monthly_call_limit`
- `calls_used_current_period`
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
- `caip10` unique
- `wallet_address`
- `namespace`
- `reference`
- `is_primary`
- `created_at`

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

### bootstrap_voucher

Purpose:

- single-use bootstrap authorization tracking

Required fields:

- `id`
- `account_id`
- `wallet_id`
- `subject_id`
- `jti` unique
- `allowed_actions`
- `issued_at`
- `expires_at`
- `consumed_at` nullable
- `status` enum: `issued | consumed | expired | revoked`

## Voucher Contract

### Format

JWS signed by backend-controlled key.

### Required Claims

- `iss` = backend issuer
- `aud` = `backend.omatrust.org`
- `sub` = account id
- `jti`
- `iat`
- `exp`
- `wallet`
- `subjectDid` and/or `subjectDidHash`
- `allowedActions`
- `plan` optional

### Validation Rules

- signature valid
- not expired
- not already consumed
- wallet matches request wallet
- subject matches request subject
- requested action is in `allowedActions`

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

## Acceptance Criteria

- backend session flow is documented and implementable
- V1 private API endpoints are enumerated with request/response contracts
- Stripe integration points are specified
- relay validation rules are specified
- V1 data model is explicit enough to implement migrations
- error codes are defined for expected failure modes
- unresolved items are called out instead of hidden

## Open Questions

- exact free-tier monthly call allowance
- exact paid-tier monthly call allowance
- session transport:
  - httpOnly cookie
  - bearer token
  - both
- whether `GET /api/private/relay/eas/nonce` should accept CAIP-10 or only raw EVM address
- whether the initial V1 backend should support all EAS schemas immediately or a policy-configured subset
