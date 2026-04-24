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
- distinguish annual sponsored write entitlements from annual premium-read entitlements
- return stable JSON error responses with machine-readable error codes

## Private API Endpoint Model

### Path Rules

- public endpoints live under `/api/...`
- first-party endpoints live under `/api/private/...`
- webhook endpoints that are server-to-server only also live under `/api/private/...`

### V1 Endpoint Groups

- `/api/verify/...`
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

Base origin for first-party browser flows:

- production: `https://backend.omatrust.org`
- local development: `http://localhost:3000`

Canonical V1 browser login flow:

1. `POST https://backend.omatrust.org/api/private/session/wallet/challenge`
2. wallet signs returned SIWE message
3. `POST https://backend.omatrust.org/api/private/session/wallet/verify`
4. backend creates or loads account, wallet, credential, default subject, and free subscription state as needed
5. backend creates session and sets secure httpOnly cookie
6. browser calls authenticated endpoints such as:
   - `GET https://backend.omatrust.org/api/private/session/me`
   - `GET https://backend.omatrust.org/api/private/accounts/me`
   - `GET https://backend.omatrust.org/api/private/subscriptions/current`
7. delegated blockchain calls still require fresh EIP-712 signing by the wallet

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

### HTTP Contract Conventions

- authenticated browser endpoints use the session cookie set by `POST /api/private/session/wallet/verify`
- all responses are JSON
- successful `GET`/`POST` responses return body objects directly, without an outer `success` wrapper unless the endpoint itself defines one
- API errors return:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE"
}
```

- where persistence effects are listed below, they describe backend state changes, not literal Supabase query syntax

### Route Implementation And Test Mapping

V1 route files are intentionally thin wrappers. The expected layering is:

- `route.ts` parses HTTP input through `withRoute(...)`
- a route-level handler function in `src/lib/routes/...` performs endpoint orchestration
- deeper service functions in `src/lib/services/...` perform business logic and persistence

For unit testing:

- unit-test `withRoute(...)` as shared HTTP boundary infrastructure
- unit-test the route-level handler functions listed below as the primary endpoint test targets
- add a smaller number of integration tests against the Next route layer once dependencies are installed

Recommended `withRoute(...)` unit coverage:

- successful JSON request parsing with `bodySchema`
- validation failure for malformed JSON body -> `400 INVALID_INPUT`
- validation failure for malformed query or params -> `400 INVALID_INPUT`
- `auth: "none"` requests that do not load a session
- `auth: "session"` requests that require a valid session cookie
- pass-through behavior when a route handler returns a `Response`
- standard JSON wrapping when a route handler returns a plain object
- thrown `ApiError` mapping to stable JSON status/code output
- thrown unknown error mapping to `500 INTERNAL_ERROR`
- text body mode for webhook-style routes
- debug/error logging behavior when `OMATRUST_DEBUG` is enabled

#### `GET https://backend.omatrust.org/api/health`

Returns a lightweight health response for uptime checks and basic deployment verification.

Auth:

- no existing session required

Request parameter table:

- none

Response:

```json
{
  "ok": true
}
```

Behavior:

- returns a lightweight success payload
- does not read or mutate backend state

Persistence effects:

- none

Unit test targets:

- route wrapper: `GET src/app/api/health/route.ts`
- route handler: `getHealth` in `src/lib/routes/health.ts`
- shared wrapper: `withRoute` in `src/lib/routes/with-route.ts`

#### `POST https://backend.omatrust.org/api/private/session/wallet/challenge`

Creates a SIWE login challenge for a wallet.

Auth:

- no existing session required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `walletDid` | body | `string` | yes | Canonical or normalizable wallet DID, expected in `did:pkh` form |
| `chainId` | body | `number` | yes | Numeric EVM chain id used in the SIWE message |
| `domain` | body | `string` | yes | Browser origin hostname expected to verify the SIWE message |
| `uri` | body | `string` | yes | Full browser origin URI expected to verify the SIWE message |

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

Persistence effects:

- inserts one `siwe_challenges` row
- stores `wallet_did`, `nonce`, `domain`, `uri`, `chain_id`, `statement`, `expires_at`

Unit test targets:

- route wrapper: `POST src/app/api/private/session/wallet/challenge/route.ts`
- route handler: `postSessionChallenge` in `src/lib/routes/private/session/wallet/challenge.ts`
- core service: `createSiweChallenge` in `src/lib/services/session-service.ts`

#### `POST https://backend.omatrust.org/api/private/session/wallet/verify`

Verifies the signed SIWE challenge and creates a backend session.

Auth:

- no existing session required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `challengeId` | body | `string` | yes | Server-issued SIWE challenge id |
| `walletDid` | body | `string` | yes | Wallet DID that signed the SIWE message |
| `signature` | body | `string` | yes | Wallet signature over the SIWE message |
| `siweMessage` | body | `string` | yes | Exact SIWE message presented to the wallet |
| `walletProviderId` | body | `string` | no | Optional client-declared wallet provider identifier, for example `inApp`, `io.metamask`, or `walletConnect`; frontend clients should send it when available |
| `executionMode` | body | `"subscription" \| "native"` | no | Wallet-scoped execution mode. Required on first sign-in for non-`inApp` wallets. Ignored after wallet creation unless it conflicts with the persisted wallet mode |

Request:

```json
{
  "challengeId": "uuid",
  "walletDid": "did:pkh:eip155:6623:0xabc...",
  "signature": "0x...",
  "siweMessage": "example.com wants you to sign in with your Ethereum account: ...",
  "walletProviderId": "inApp",
  "executionMode": "subscription"
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

- if wallet is unknown, create account + wallet + credential + default subject + free subscription state
- if wallet is unknown and `walletProviderId === "inApp"`, force `executionMode = "subscription"`
- if wallet is unknown and `walletProviderId !== "inApp"`, require the frontend to provide either `subscription` or `native`
- if wallet already exists, treat `execution_mode` as persistent wallet metadata rather than a per-session override
- reject any attempt to assign `native` execution to an `inApp` wallet
- if wallet already belongs to an account, return that account
- persist client-declared wallet provider metadata on the wallet row
- associate session to the first-party browser client
- set session cookie in response

Persistence effects:

- reads and validates one existing `siwe_challenges` row
- if wallet is new:
  - inserts one `accounts` row
  - inserts one `wallets` row
  - inserts one `credentials` row for wallet-backed browser authentication
  - inserts one default `subjects` row using the wallet DID
  - inserts one free-tier `subscription_state` row
- inserts one `sessions` row linked to the account, credential, and first-party browser client
- updates `siwe_challenges.used_at`

Unit test targets:

- route wrapper: `POST src/app/api/private/session/wallet/verify/route.ts`
- route handler: `postSessionVerify` in `src/lib/routes/private/session/wallet/verify.ts`
- core services:
  - `verifySiweChallengeAndCreateSession` in `src/lib/services/session-service.ts`
  - `getOrCreateAccountForWallet` in `src/lib/services/account-service.ts`

Cookie guidance:

- use `httpOnly`
- use `secure`
- use `sameSite=lax` or stricter as deployment permits
- cookie is the default browser transport in V1

#### `POST https://backend.omatrust.org/api/private/session/logout`

Invalidates the current session.

Auth:

- current session cookie required if there is an active session to revoke

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| session cookie | cookie | `string` | yes | Backend-issued session token |

Persistence effects:

- updates current `sessions.revoked_at`

Unit test targets:

- route wrapper: `POST src/app/api/private/session/logout/route.ts`
- route handler: `postSessionLogout` in `src/lib/routes/private/session/logout.ts`
- core service: `revokeCurrentSession` in `src/lib/services/session-service.ts`

#### `GET https://backend.omatrust.org/api/private/session/me`

Returns the currently authenticated account context.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| session cookie | cookie | `string` | yes | Backend-issued session token |

Response:

```json
{
  "account": {
    "id": "uuid",
    "displayName": null
  },
  "wallet": {
    "did": "did:pkh:eip155:6623:0xabc...",
    "walletProviderId": "inApp",
    "executionMode": "subscription",
    "isManagedWallet": true
  },
  "credential": {
    "id": "uuid",
    "kind": "wallet_auth",
    "identifier": "did:pkh:eip155:6623:0xabc..."
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

Persistence effects:

- no state mutation
- loads current `accounts`, `wallets`, `subscriptions`, `subjects`, `sessions`, and `clients` context for the authenticated account

Unit test targets:

- route wrapper: `GET src/app/api/private/session/me/route.ts`
- route handler: `getSessionMe` in `src/lib/routes/private/session/me.ts`
- core service: `getAuthenticatedAccountContext` in `src/lib/services/session-service.ts`

## Account Creation Rules

Account creation is implicit on first successful SIWE login verification.

On first successful `POST /api/private/session/wallet/verify`:

1. create `account`
2. create `wallet`
   - assign wallet `execution_mode`
   - `inApp` wallets are always `subscription`
   - non-`inApp` wallets must choose `subscription` or `native` at first sign-in
3. derive default `did:pkh` subject from the wallet and create `subject`
4. create free-tier `subscription`
5. associate to the global/static first-party browser `client`
6. create `session`

If the wallet already exists:

- no new account is created
- existing account context is returned

V1 does not require the browser user to register a client. The `client` abstraction exists internally for model consistency only.

## Public Verification Endpoints

#### `POST https://backend.omatrust.org/api/verify/subject-ownership`

Verifies whether a wallet DID can currently be treated as the owner/controller of a subject DID.

Auth:

- no session required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `subjectDid` | body | `string` | yes | Subject DID to verify, currently `did:web` or EVM `did:pkh` |
| `connectedWalletDid` | body | `string` | yes | Wallet DID the caller is attempting to use as the controller |
| `txHash` | body | `string \| null` | no | Optional transfer-proof transaction hash for `did:pkh` ownership verification |

Request:

```json
{
  "subjectDid": "did:web:example.com",
  "connectedWalletDid": "did:pkh:eip155:66238:0xabc..."
}
```

Success response:

```json
{
  "ok": true,
  "status": "verified",
  "subjectDid": "did:web:example.com",
  "connectedWalletDid": "did:pkh:eip155:66238:0xabc...",
  "method": "dns",
  "details": "Verified via DNS TXT record at _controllers.example.com"
}
```

Failure response:

```json
{
  "ok": false,
  "status": "failed",
  "subjectDid": "did:web:example.com",
  "connectedWalletDid": "did:pkh:eip155:66238:0xdef...",
  "error": "DID ownership verification failed",
  "details": "DNS check: failed. DID document check: failed."
}
```

Behavior:

- for `did:web`, accept either proof path:
  - `_controllers.{domain}` DNS TXT record
  - `https://{domain}/.well-known/did.json`
- for `did:pkh`, support EVM `did:pkh` verification only in V1
- for contract-backed `did:pkh`, check:
  - `owner()`
  - `admin()`
  - `getOwner()`
  - EIP-1967 admin slot
- if `txHash` is supplied for `did:pkh`, verify the transfer-proof path instead of only direct ownership
- no attestation is written
- no backend database rows are created or mutated

V1 backend scope note:

- the backend copy currently resolves `did:pkh` verification against the configured active OMAChain RPC only
- the SDK helper is more general because it accepts an injected provider; the backend can be widened later after the shared SDK update is published and adopted

Persistence effects:

- none

Unit test targets:

- route wrapper: `POST src/app/api/verify/subject-ownership/route.ts`
- route handler: `postVerifySubjectOwnership` in `src/lib/routes/verify/subject-ownership.ts`
- core service: `verifySubjectOwnership` in `src/lib/services/subject-ownership-service.ts`

## Account and Subject Endpoints

#### `GET https://backend.omatrust.org/api/private/accounts/me`

Returns the current account record and summary data.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| session cookie | cookie | `string` | yes | Backend-issued session token |

Persistence effects:

- no state mutation
- loads current `accounts`, `subscriptions`, and primary `subjects` state for the authenticated account

Unit test targets:

- route wrapper: `GET src/app/api/private/accounts/me/route.ts`
- route handler: `getAccountsMe` in `src/lib/routes/private/accounts/me.ts`
- core service: `getAuthenticatedAccountContext` in `src/lib/services/session-service.ts`

#### `PATCH https://backend.omatrust.org/api/private/accounts/me`

Updates mutable account fields such as display name.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `displayName` | body | `string \| null` | yes | New display name; nullable clears the value |

Request:

```json
{
  "displayName": "OMA3"
}
```

Persistence effects:

- updates `accounts.display_name`

Unit test targets:

- route wrapper: `PATCH src/app/api/private/accounts/me/route.ts`
- route handler: `patchAccountsMe` in `src/lib/routes/private/accounts/me.ts`
- core service: `updateAccountDisplayName` in `src/lib/services/account-service.ts`

#### `GET https://backend.omatrust.org/api/private/subjects`

Returns all subjects for the current account.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| session cookie | cookie | `string` | yes | Backend-issued session token |

Persistence effects:

- no state mutation
- loads `subjects` for the authenticated account ordered by default-first

Unit test targets:

- route wrapper: `GET src/app/api/private/subjects/route.ts`
- route handler: `getSubjects` in `src/lib/routes/private/subjects/subjects.ts`
- core service: `listSubjects` in `src/lib/services/subject-service.ts`

#### `POST https://backend.omatrust.org/api/private/subjects`

Adds a subject to the current account.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `did` | body | `string` | yes | DID to normalize and attach to the authenticated account |

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
    "isDefault": true
  }
}
```

Behavior:

- normalize DID using OMATrust SDK helpers
- compute and persist `subjectDidHash`
- verify ownership server-side using the authenticated session wallet before insertion
- reject duplicate subject on same account
- reject globally conflicting subject if already claimed by another account
- if the account only has the bootstrap wallet `did:pkh` subject and the new subject is the first meaningful subject, replace the bootstrap subject and make the new subject default

Persistence effects:

- inserts one `subjects` row on success
- may delete the bootstrap wallet subject when replacing the initial default subject
- does not create key bindings or other onchain authorization records by itself

Unit test targets:

- route wrapper: `POST src/app/api/private/subjects/route.ts`
- route handler: `postSubjects` in `src/lib/routes/private/subjects/subjects.ts`
- core service: `addSubjectToAccount` in `src/lib/services/subject-service.ts`

#### `GET https://backend.omatrust.org/api/private/subjects/:subjectId`

Returns one subject owned by the current account.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `subjectId` | path | `string` | yes | Subject id owned by the authenticated account |

Persistence effects:

- no state mutation

Unit test targets:

- route wrapper: `GET src/app/api/private/subjects/[subjectId]/route.ts`
- route handler: `getSubjectById` in `src/lib/routes/private/subjects/subject-id.ts`
- core service: `getSubjectForAccount` in `src/lib/services/subject-service.ts`

## Subscription and Payment Endpoints

### Stripe

Stripe is the V1 billing provider.

Stripe is authoritative for payment completion and subscription billing state.

#### `GET https://backend.omatrust.org/api/private/subscriptions/current`

Returns the current account subscription.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| session cookie | cookie | `string` | yes | Backend-issued session token |

Response:

```json
{
  "subscription": {
    "plan": "free",
    "status": "active",
    "annualSponsoredWriteLimit": 10,
    "annualPremiumReadLimit": 100,
    "entitlementPeriodStart": "2026-01-01T00:00:00.000Z",
    "entitlementPeriodEnd": "2027-01-01T00:00:00.000Z"
  }
}
```

Persistence effects:

- no state mutation
- loads current `subscriptions` state for the authenticated account

Unit test targets:

- route wrapper: `GET src/app/api/private/subscriptions/current/route.ts`
- route handler: `getSubscriptionsCurrent` in `src/lib/routes/private/subscriptions/current.ts`
- core service: `getAuthenticatedAccountContext` in `src/lib/services/session-service.ts`

#### `POST https://backend.omatrust.org/api/private/subscriptions/checkout-session`

Creates a Stripe Checkout Session for upgrading to `paid`.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `plan` | body | `"paid"` | yes | V1 only supports paid upgrades |
| `successUrl` | body | `string` | yes | Browser redirect target after successful Stripe checkout |
| `cancelUrl` | body | `string` | yes | Browser redirect target after canceled Stripe checkout |

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

Persistence effects:

- may insert or update `accounts.stripe_customer_id`
- does not update local subscription entitlements immediately; Stripe webhook remains authoritative

Unit test targets:

- route wrapper: `POST src/app/api/private/subscriptions/checkout-session/route.ts`
- route handler: `postCheckoutSession` in `src/lib/routes/private/subscriptions/checkout-session.ts`
- core service: `createPaidCheckoutSession` in `src/lib/services/subscription-service.ts`

#### `POST https://backend.omatrust.org/api/private/subscriptions/stripe-webhook`

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

Persistence effects:

- updates `subscriptions.plan`
- updates `subscriptions.status`
- updates annual entitlement fields and entitlement period
- updates `stripe_subscription_id` and `stripe_price_id`

Unit test targets:

- route wrapper: `POST src/app/api/private/subscriptions/stripe-webhook/route.ts`
- route handler: `postStripeWebhook` in `src/lib/routes/private/subscriptions/stripe-webhook.ts`
- core service: `handleStripeWebhook` in `src/lib/services/subscription-service.ts`

## Relay Endpoints

### Phase 1 Rule

Phase 1 relay support is for EAS delegated attestation submission.

The existing frontend-hosted flow for currently subsidized schemas can remain in place during migration. This backend path is the new subscription-gated path and eventually the replacement path.

V1 migration boundary:

- existing subsidized schemas such as `user-review` and `linked-identifier` may continue to use the legacy frontend-hosted delegated-attest server during Phase 1
- new subscription-gated delegated attestation flows should use `omatrust-backend`
- V1 does not require `omatrust-backend` to proxy requests to the legacy delegated-attest server
- frontends may temporarily route between legacy delegated-attest, new backend delegated-attest, and direct execution depending on sponsorship policy

This keeps the Phase 1 backend focused on new subscription-gated flows while preserving compatibility with the already-working subsidized flow.

### Proposed Endpoint Shape

#### `GET https://backend.omatrust.org/api/private/relay/eas/nonce?attester=0x...`

Returns the authoritative EAS nonce and chain metadata needed to build typed data.

V1 decision:

- accept raw EVM address at the relay boundary
- even though wallet identity is stored canonically as `did:pkh`, EAS nonce lookups are address-based and should remain address-based for compatibility

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `attester` | query | `0x...` EVM address | yes | Raw attester address used in the onchain EAS nonce lookup |

Response:

```json
{
  "nonce": "0",
  "chainId": 66238,
  "easAddress": "0x...",
  "chain": "OMAchain Testnet"
}
```

Persistence effects:

- increments `subscriptions.premium_reads_used_current_year` on successful premium nonce lookup
- performs onchain read against EAS `getNonce(address)`
- rejects wallets whose persisted `execution_mode` is `native`

Unit test targets:

- route wrapper: `GET src/app/api/private/relay/eas/nonce/route.ts`
- route handler: `getRelayEasNonce` in `src/lib/routes/private/relay/eas/nonce.ts`
- core service: `getRelayNonce` in `src/lib/services/relay-eas-service.ts`

#### `POST https://backend.omatrust.org/api/private/rpc-premium`

Proxies an allowlisted JSON-RPC read request to the premium RPC endpoint.

Auth:

- current session cookie required

V1 purpose:

- provide a metered premium RPC path for frontend reads that would otherwise hit the whitelisted premium RPC endpoint directly
- keep premium RPC credentials off the client
- allow frontend fallback to the public rate-limited RPC endpoint when premium entitlement is exhausted

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `jsonrpc` | body | `"2.0"` | yes | Standard JSON-RPC version |
| `method` | body | `string` | yes | Allowlisted JSON-RPC read method |
| `params` | body | `array \| object` | no | JSON-RPC params for the requested read |
| `id` | body | `string \| number \| null` | no | JSON-RPC request id |

Allowed V1 methods:

- `eth_blockNumber`
- `eth_call`
- `eth_chainId`
- `eth_getBlockByNumber`
- `eth_getLogs`
- `eth_getTransactionByHash`
- `eth_getTransactionReceipt`

V1 policy filters:

- `eth_call` requires a valid `to` address
- `eth_getLogs` requires a bounded block range
- disallowed methods return `403 RPC_METHOD_NOT_ALLOWED`
- overly broad log range returns `403 RPC_RANGE_TOO_LARGE`

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "eth_getLogs",
  "params": [
    {
      "address": "0x8835AF90f1537777F52E482C8630cE4e947eCa32",
      "fromBlock": "0x10",
      "toBlock": "0x20",
      "topics": []
    }
  ]
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": []
}
```

Persistence effects:

- increments `subscriptions.premium_reads_used_current_year` on successful forwarded premium RPC requests
- does not mutate any other backend state
- forwards the request to the premium RPC origin configured for `OMATRUST_PREMIUM_RPC_URL`

Frontend behavior:

- when this endpoint returns `403 PREMIUM_READ_LIMIT_EXCEEDED`, the frontend should fall back to the public rate-limited RPC endpoint where possible
- when this endpoint returns `403 RPC_METHOD_NOT_ALLOWED`, the frontend should not retry the same request against the premium backend without code changes

Unit test targets:

- route wrapper: `POST src/app/api/private/rpc-premium/route.ts`
- route handler: `postPremiumRpc` in `src/lib/routes/private/rpc-premium.ts`
- core service: `forwardPremiumRpcRequest` in `src/lib/services/premium-rpc-service.ts`

#### `POST https://backend.omatrust.org/api/private/relay/eas/delegated-attest`

Accepts a signed delegated EAS attestation request and submits it if validation passes.

Auth:

- current session cookie required

Top-level request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `attester` | body | `0x...` EVM address | yes | Address expected to own the signature and match an account wallet |
| `prepared` | body | `object` | yes | SDK-generated delegated attestation payload |
| `signature` | body | `0x...` hex string | yes | Wallet signature over the typed data |

`prepared.delegatedRequest` fields:

| Field | Type | Required | Description |
|---|---:|---:|---|
| `schema` | `0x...` hex | yes | EAS schema UID |
| `attester` | `0x...` address | yes | Attester address |
| `easContractAddress` | `0x...` address | yes | Target EAS contract |
| `chainId` | `number` | yes | OMAChain chain id used for typed data |
| `recipient` | `0x...` address | yes | EAS attestation recipient |
| `expirationTime` | `string \| number` | yes | Expiration time as integer-compatible value |
| `revocable` | `boolean` | yes | Revocability flag |
| `refUID` | `0x...` hex | yes | EAS reference UID |
| `data` | `0x...` hex | yes | ABI-encoded attestation payload |
| `value` | `string \| number` | yes | Payable value field |
| `nonce` | `string \| number` | yes | Nonce embedded by the client-side preparation step |
| `deadline` | `string \| number` | yes | Signature deadline |

`prepared.typedData` fields:

| Field | Type | Required | Description |
|---|---:|---:|---|
| `domain.name` | `string` | yes | Typed-data domain name |
| `domain.version` | `string` | yes | Typed-data domain version |
| `domain.chainId` | `number` | yes | Typed-data chain id |
| `domain.verifyingContract` | `0x...` address | yes | EAS verifying contract |
| `types.Attest` | `array` | yes | Typed-data type definition |
| `message` | `object` | yes | Attestation message fields used to rebuild typed data on the server |

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
- server checks wallet `execution_mode`, entitlement, and sponsor eligibility
- if validation passes, server submits tx
- if validation fails, server returns stable error code

Session/auth rule:

- browser caller must have an authenticated session
- delegated blockchain submission still requires a fresh wallet EIP-712 signature for the specific action
- wallets in `native` execution mode do not use this relay path for normal submission routing
- a `subscription` wallet with exhausted entitlement should be prompted to upgrade or buy more entitlement, not switched to `native` automatically

Persistence effects:

- reads current `subscriptions`, `wallets`, and authenticated session context
- performs onchain nonce lookup against EAS
- submits one onchain `attestByDelegation(...)` transaction if validation passes
- increments `subscriptions.sponsored_writes_used_current_year`

Unit test targets:

- route wrapper: `POST src/app/api/private/relay/eas/delegated-attest/route.ts`
- route handler: `postRelayEasDelegatedAttest` in `src/lib/routes/private/relay/eas/delegated-attest.ts`
- core service: `submitDelegatedAttestation` in `src/lib/services/relay-eas-service.ts`

### Sponsor Eligibility

V1 sponsor decision checks:

- authenticated account exists
- authenticated browser session is valid
- attester matches authenticated wallet or explicitly selected account wallet
- subscription status is active
- annual sponsored write allowance not exhausted
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
- `PREMIUM_READ_LIMIT_EXCEEDED`
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

### subscription_state

Purpose:

- current plan and billing state for an account

Required fields:

- `id`
- `account_id`
- `plan` enum: `free | paid`
- `status` enum: `active | canceled | past_due | incomplete | trialing`
- `annual_sponsored_write_limit`
- `sponsored_writes_used_current_year`
- `annual_premium_read_limit`
- `premium_reads_used_current_year`
- `entitlement_period_start`
- `entitlement_period_end`
- `stripe_subscription_id` nullable
- `stripe_price_id` nullable
- `created_at`
- `updated_at`

Constraints:

- one active subscription row per account in V1

### wallet

Purpose:

- blockchain signer identity associated with an account

Required fields:

- `id`
- `account_id`
- `did` unique
- `wallet_address`
- `wallet_provider_id` nullable
- `execution_mode` enum: `subscription | native`
- `is_primary`
- `created_at`

Terminology rules:

- `did:pkh` is the canonical wallet-linked identity stored in V1
- `wallet_provider_id` is client-declared metadata such as `inApp`, `io.metamask`, or `walletConnect`
- `wallet_provider_id` is written when the wallet row is first created and treated as stable metadata afterward
- `execution_mode` is wallet-scoped and persistent once the wallet row is created
- `inApp` wallets must use `execution_mode = subscription`
- do not model an EOA wallet row as chain-specific in V1 unless a later use case requires it

### subject

Purpose:

- managed identity for an account

Required fields:

- `id`
- `account_id`
- `canonical_did`
- `subject_did_hash`
- `display_name` nullable
- `is_default`
- `created_at`

Constraints:

- `canonical_did` unique across accounts
- `subject_did_hash` unique across accounts
- each account has at least one subject

### client

Purpose:

- software/client identity used by the backend to model which application surface created a session or request

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
- in V1, the browser client is not account-owned; it is a shared first-party client record

### credential

Purpose:

- authentication credential used to establish and track how an account authenticated

Required fields:

- `id`
- `account_id`
- `client_id`
- `wallet_id` nullable
- `credential_kind` enum: `wallet_auth | jwt | server_wallet`
- `credential_identifier`
- `created_at`
- `revoked_at` nullable

V1 guidance:

- wallet-based browser login creates both a `wallet` row and a `credential` row
- authentication/session provenance is tied to the `credential`
- delegated execution and attester checks continue to use the `wallet`
- the session is the link between the authenticated account and the client used to create that session
- `client_type` is deferred to V2+
- OAuth DCR clients are deferred to V2+

Future guidance:

- in V2+, accounts may own or register additional clients
- a stable `client_id` may later have multiple credentials/keys over time
- credential rotation should not require changing `client_id`

### session

Purpose:

- temporary authenticated state after successful browser login

Required fields:

- `id`
- `account_id`
- `client_id`
- `credential_id`
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
- annual sponsored write limits and annual premium-read limits are tracked separately
- every account has at least one subject (default `did:pkh` from wallet); additional subjects are for subject-scoped flows
- client identifies software/client identity and is not the same as the account or wallet; the first-party browser client may be global rather than account-owned
- session represents temporary authenticated state and is associated with both account and client
- in V1, there is no required `account -> client` ownership relationship for the first-party browser client; that relationship becomes relevant when account-owned OAuth/DCR clients are introduced later

## Read Endpoint Tiers

The system distinguishes between two RPC-backed read tiers:

- public rate-limited endpoint
  - available to all users
  - not entitlement-limited by the OMATrust subscription system
  - quality of service is controlled by infrastructure-level rate limiting rather than per-account quotas
- premium endpoint
  - higher-quality endpoint for subscribers and OMATrust-managed flows
  - access is limited by annual premium-read entitlement
  - proxied in V1 through `POST /api/private/rpc-premium` for browser-facing premium reads

V1 guidance:

- ordinary backend account/session/subject reads are not treated as premium reads
- annual premium-read entitlement applies to premium RPC-backed reads
- `GET /api/private/relay/eas/nonce` is treated as a premium RPC-backed read
- `POST /api/private/rpc-premium` is the generic browser-facing premium RPC read path
- when premium-read entitlement is exhausted, clients should fall back to the public rate-limited endpoint where appropriate rather than being blocked entirely

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
- annual write and premium-read entitlements are distinguished
- static browser client decision is reflected in the data model
- raw EVM address nonce boundary is reflected in the relay contract
- configurable schema sponsorship is reflected in sponsor policy
- public vs premium RPC endpoint roles are documented
- error codes are defined for expected failure modes
- unresolved items are called out instead of hidden

## Open Questions

- exact free-tier annual sponsored write allowance
- exact free-tier annual premium-read allowance
- exact paid-tier annual sponsored write allowance
- exact paid-tier annual premium-read allowance
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
