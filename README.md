# omatrust-backend

First-party backend service for OMATrust frontends.

This repository hosts the backend APIs and persistence layer for:

- wallet-based browser login
- account and subject management
- annual subscription entitlements
- premium RPC read proxying
- delegated EAS submission

The intended deployment target is `backend.omatrust.org`.

## What This Service Does

At a high level, the backend sits between OMATrust frontends, database services (Supabase), payment processors (Stripe), and OMAChain infrastructure:

- verifies wallet-based login sessions
- creates and loads OMATrust accounts
- stores wallet metadata and auth credentials separately
- tracks annual free/paid entitlement usage
- proxies premium RPC reads for subscribed users
- submits delegated EAS writes with a managed server wallet or private-key fallback

This repository does not contain:

- frontend UI code
- smart contracts
- the public anonymous RPC endpoint
- the legacy frontend-hosted delegated-attest server used by older subsidized flows

## Local Development

1. Copy `.env.example` to `.env.local`.
2. Fill in the required values.
3. Apply the initial database schema to the database.
4. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

5. Start the backend to develop locally:

   ```bash
   npm run dev
   ```

6. Open the app through whichever frontend is pointing at `OMATRUST_BACKEND_URL`.

## Deployment Setup

> **Environment variable values and Vercel environment configuration** are documented in the [Deployment Guide](https://github.com/oma3dao/omatrust-docs/blob/main/operations/deployment-rep-attestation.md) (Section 6). This section covers the project setup steps and variable semantics.

### 1. Create the Supabase Project

Create a new Supabase project for this backend. Then collect:

- **API URL** — found in Integrations → Data API (the `https://<project-ref>.supabase.co` URL)
- **Secret key** — found in Settings → API Keys → Secret Keys (create one if none exist; this replaces the legacy `service_role` key)

Apply the initial schema in:

- `supabase/migrations/202604150001_initial_schema.sql`

You can do that in either of these ways:

- paste the SQL into the Supabase SQL editor and run it
- apply it with your preferred database migration workflow against the new project

This backend currently assumes a fresh project initialized from that schema file.

### 2. Configure Vercel

Create a Vercel project pointing at this repository and set the root directory to:

- `omatrust-backend`

Add the environment variables from [`.env.example`](./.env.example). The file is grouped and commented with usage notes for each variable. For per-environment values (domains, keys, chain settings), see the [Deployment Guide](https://github.com/oma3dao/omatrust-docs/blob/main/operations/deployment-rep-attestation.md) (Section 6).

Configure custom domains for each Vercel environment as described in the [Deployment Guide](https://github.com/oma3dao/omatrust-docs/blob/main/operations/deployment-rep-attestation.md) (Sections 4 and 6). Add the appropriate DNS CNAME records pointing to `cname.vercel-dns.com`.

### 3. Chain Presets

The backend derives chain metadata from `src/lib/config/chains.ts`.

Current presets:

- `omachain-testnet`
- `omachain-mainnet`
- `omachain-devnet`

Each preset supplies:

- chain id
- display name
- public RPC URL
- explorer URL
- EAS contract address

### 4. Stripe Webhook

After the backend is deployed, create a Stripe webhook that points to:

- `https://<your-backend-domain>/api/private/subscriptions/stripe-webhook`

Subscribe to these events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Use the webhook signing secret as:

- `STRIPE_WEBHOOK_SECRET`

### 5. Sanity Check the Deployment

After deploying, verify the backend is running. Replace the domain based on the environment:
- **Mainnet:** `backend.omatrust.org`
- **Testnet:** `test.backend.omatrust.org`
- **Devnet:** `dev.backend.omatrust.org`

```bash
# Health check — expect 200 with {"ok":true}
curl -i https://<domain>/api/health

# Trust anchors — expect 200 with chain and issuer data
curl https://<domain>/api/public/trust-anchors

# Verified artifact evidence — expect 200 with complete evidence groups
curl --get https://<domain>/api/public/artifact-trust \
  --data-urlencode 'artifactDid=did:artifact:bafk...'

# SIWE challenge — expect 200 with nonce and message
curl -X POST https://<domain>/api/private/session/wallet/challenge \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0x0000000000000000000000000000000000000000","chainId":6623}'
```

The remaining endpoints (verify, session, relay, rpc-premium) require an authenticated session and are best tested through the frontend.

### Public Artifact Trust Lookup

`GET /api/public/artifact-trust?artifactDid=<did:artifact>` returns the
verified OMATrust evidence associated with one artifact. The endpoint requires
no session and uses the public RPC endpoint for the chain selected by
`OMATRUST_ACTIVE_CHAIN`.

Successful responses contain `responsibilityClaims`, `securityAssessments`,
`certifications`, and `otherAttestations`. Every returned item has
`verification.valid: true`. Responsibility claims have a dedicated group so
consumers can prominently identify who accepts responsibility for the
artifact. The artifact DID is the claim subject and does not authorize the
attester; the separate `responsibleParty` DID identifies the accountable
entity whose controller relationship is verified. `securityAssessments`
contains cybersecurity assessments from approved issuers.
`otherAttestations` is the extensible group for recognized evidence such as
linked identifiers; consumers display and interpret those identifiers rather
than assuming they establish trust in a particular target. User reviews are
not returned because their schema cannot prove a `did:artifact` binding.
Controller witnesses may support verification of another claim but are not
returned as artifact evidence.

A complete lookup with no qualifying evidence returns `200`, empty evidence
arrays, and:

```json
{
  "summary": {
    "totalQueried": 0,
    "totalVerified": 0,
    "totalExcluded": 0,
    "complete": true
  }
}
```

RPC or EAS failures return an error rather than a partial or misleadingly empty
success response.

Operators can independently inspect the same artifact at
https://app.omatrust.org/verify using the response `artifactDid`.

## Architecture

This backend deliberately separates authentication, blockchain signer identity, and subscription state.

The main model is:

- `account` is the customer container
- `wallet` is the blockchain signer identity
- `credential` is the authentication identity used to create sessions
- `session` is the active authenticated browser session
- `subject` is the managed reputation identity
- `subscription_state` is the live entitlement state for one account

### Why Wallets And Credentials Are Separate

A browser user currently signs in with a wallet, but that one act produces two records:

- a `wallet` record for blockchain-facing identity
- a `credential` record for auth/session provenance

That split lets the backend evolve toward future non-wallet credentials, such as:

- JWT/HSM credentials
- OAuth DCR client credentials
- server wallet credentials

without collapsing blockchain identity and auth identity into the same table forever.

## Table Architecture

### `accounts`

Represents the OMATrust customer container.

Key fields:

- `display_name`
- `stripe_customer_id`

One account currently owns:

- one live `subscription_state`
- one or more `wallets`
- one or more `credentials`
- one or more `subjects`
- one or more `sessions`

### `subscription_state`

Represents the current plan and entitlement state for exactly one account.

Key fields:

- `plan`
- `status`
- `annual_sponsored_write_limit`
- `sponsored_writes_used_current_year`
- `annual_premium_read_limit`
- `premium_reads_used_current_year`
- `entitlement_period_start`
- `entitlement_period_end`
- `stripe_subscription_id`
- `stripe_price_id`

This is not just a catalog of subscription plans. It is the live mutable state for one account’s subscription and annual usage window.

### `wallets`

Represents blockchain signer identities attached to an account.

Key fields:

- `did`
- `wallet_address`
- `wallet_provider_id`
- `is_primary`

Current uses of the wallet table:

- bootstrap account lookup during wallet-based login
- delegated attestation attester ownership checks
- future subject authorization via key bindings and linked identifiers
- recording wallet provider metadata such as Thirdweb `inApp`

### `credentials`

Represents authentication identities used to create sessions.

Key fields:

- `client_id`
- `wallet_id`
- `credential_kind`
- `credential_identifier`
- `revoked_at`

In V1 browser login:

- `credential_kind = wallet_auth`
- `credential_identifier = wallet DID`
- `wallet_id` points to the associated signer

Later credential types can include:

- `jwt`
- `server_wallet`

### `sessions`

Represents authenticated backend sessions.

Key fields:

- `account_id`
- `client_id`
- `credential_id`
- `expires_at`
- `revoked_at`

Sessions are credential-backed, not wallet-backed.

That means session validation trusts:

- the session row
- the linked credential
- the linked client
- the linked account

The wallet is still checked later when an onchain or delegated-signing action needs a specific attester.

### `subjects`

Represents the managed reputation identity or identities for an account.

Key fields:

- `canonical_did`
- `subject_did_hash`
- `display_name`
- `is_default`

A subject can represent things like:

- an organization
- a project
- an application
- another reputation-bearing DID

`display_name` is optional because the DID/hash remain canonical, while the human-readable label is helpful for UI and management.

### `clients`

Represents software-client identity.

In V1 this is mostly a backend abstraction used to record the first-party browser client.

Longer term this is where OAuth DCR style clients can grow.

### `siwe_challenges`

Temporary SIWE challenge records used during wallet login.

These store:

- wallet DID
- nonce
- domain
- URI
- chain id
- expiry
- usage state

## How The Tables Work Together

### Wallet Login Flow

1. The frontend requests a SIWE challenge from:
   - `POST /api/private/session/wallet/challenge`
2. The user signs the challenge with their wallet.
3. The frontend verifies with:
   - `POST /api/private/session/wallet/verify`
4. The backend:
   - resolves or creates the `account`
   - resolves or creates the `wallet`
   - resolves or creates the `credential`
   - ensures the default `subject`
   - ensures the initial `subscription_state`
   - creates the `session`

### Premium Read Flow

1. The frontend calls:
   - `POST /api/private/rpc-premium`
2. The backend checks:
   - session
   - account
   - active subscription
   - remaining premium read entitlement
   - allowed JSON-RPC method/request shape
3. The backend forwards the request to the premium RPC endpoint.
4. If entitlement is exhausted, the frontend should fall back to the public rate-limited RPC endpoint.

### Delegated Write Flow

1. The frontend prepares a delegated EAS request.
2. The backend validates:
   - authenticated account session
   - attester belongs to one of the account’s wallets
   - active subscription
   - remaining sponsored writes
   - schema eligibility
3. The backend submits the transaction using:
   - Thirdweb server wallet when configured
   - otherwise private-key fallback
4. On success, the backend increments sponsored write usage in `subscription_state`.

## Route Surface

Current main routes:

- `GET /api/health`
- `POST /api/private/session/wallet/challenge`
- `POST /api/private/session/wallet/verify`
- `POST /api/private/session/logout`
- `GET /api/private/session/me`
- `GET /api/private/accounts/me`
- `PATCH /api/private/accounts/me`
- `GET /api/private/subjects`
- `POST /api/private/subjects`
- `GET /api/private/subjects/[subjectId]`
- `GET /api/private/subscriptions/current`
- `POST /api/private/subscriptions/checkout-session`
- `POST /api/private/subscriptions/stripe-webhook`
- `GET /api/private/relay/eas/nonce`
- `POST /api/private/relay/eas/delegated-attest`
- `POST /api/private/rpc-premium`

## Repository Layout

```text
src/
  app/api/                     Next.js route handlers
  lib/auth/                    session token helpers
  lib/config/                  env parsing, chain presets, RPC config
  lib/db/                      Supabase client and database types
  lib/policy/                  sponsor policy rules
  lib/routes/                  route-level handlers and schemas
  lib/services/                business logic
  lib/types/                   ambient declarations
supabase/
  migrations/                  initial database schema
docs/features/
  delegated-execution/         plan + contract spec
```

## Documentation

Feature documentation lives under:

- `docs/features/delegated-execution/plan.md`
- `docs/features/delegated-execution/spec.md`

## License and Participation

- Code is licensed under [MIT](./LICENSE)
- Contributor terms are defined in [CONTRIBUTING.md](./CONTRIBUTING.md)

This initial version is MIT-licensed to maximize transparency and adoption. OMA3 standards and schemas remain governed by [OMA3's IPR Policy](https://www.oma3.org/intellectual-property-rights-policy).
