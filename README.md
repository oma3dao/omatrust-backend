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
4. Install dependencies:

   ```bash
   npm install
   ```

5. Start the backend:

   ```bash
   npm run dev
   ```

6. Open the app through whichever frontend is pointing at `OMATRUST_BACKEND_URL`.

## Deployment Setup

### 1. Create the Supabase Project

Create a new Supabase project for this backend. Then collect:

- project URL
- service role key

Apply the initial schema in:

- `supabase/migrations/202604150001_initial_schema.sql`

You can do that in either of these ways:

- paste the SQL into the Supabase SQL editor and run it
- apply it with your preferred database migration workflow against the new project

This backend currently assumes a fresh project initialized from that schema file.

### 2. Configure Vercel

Create a Vercel project pointing at this repository and set the root directory to:

- `omatrust-backend`

Add the environment variables from `.env.example`.

The important groups are:

- backend origin and debug
- session + SIWE
- Supabase
- Stripe
- delegated EAS signing
- chain + premium RPC
- sponsor policy

### 3. Required Environment Variables

These are the main required runtime values:

```bash
# Backend origin
OMATRUST_BACKEND_URL=
OMATRUST_DEBUG=false

# Session + SIWE
OMATRUST_SESSION_SECRET=
OMATRUST_SESSION_TTL_HOURS=24
OMATRUST_SIWE_NONCE_TTL_MINUTES=10
OMATRUST_ALLOWED_SIWE_DOMAINS=
OMATRUST_BROWSER_CLIENT_ID=omatrust-browser

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PAID_PRICE_ID=

# Delegated EAS signing
THIRDWEB_SECRET_KEY=
THIRDWEB_SERVER_WALLET_ADDRESS=
EAS_DELEGATE_PRIVATE_KEY=

# Chain + premium RPC
OMATRUST_ACTIVE_CHAIN=omachain-testnet
OMATRUST_PREMIUM_RPC_URL=
OMATRUST_PREMIUM_RPC_MAX_LOG_RANGE=50000
OMATRUST_MAX_GAS_PER_TX=800000

# Sponsor policy
OMATRUST_FREE_ANNUAL_SPONSORED_WRITES=10
OMATRUST_FREE_ANNUAL_PREMIUM_READS=100
OMATRUST_PAID_ANNUAL_SPONSORED_WRITES=1000
OMATRUST_PAID_ANNUAL_PREMIUM_READS=100000
OMATRUST_FREE_ALLOWED_SCHEMA_UIDS=0xreplace_with_free_onboarding_schema_uid
OMATRUST_PAID_ALLOWED_SCHEMA_UIDS=*
```

Notes:

- `OMATRUST_ACTIVE_CHAIN` selects a preset from `src/lib/config/chains.ts`.
- `OMATRUST_PREMIUM_RPC_URL` is separate from chain presets because it is infrastructure-specific.
- Mainnet and testnet are intended to use the Thirdweb server wallet path.
- Devnet can use `EAS_DELEGATE_PRIVATE_KEY` as the delegated-signing fallback.
- `OMATRUST_FREE_ALLOWED_SCHEMA_UIDS` must include at least the schema UID(s) needed for free-tier onboarding, or the free sponsored write allowance will exist in the database but remain unusable in practice.

### 4. Chain Presets

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

### 5. Stripe Webhook

After the backend is deployed, create a Stripe webhook that points to:

- `https://<your-backend-domain>/api/private/subscriptions/stripe-webhook`

Use the webhook signing secret as:

- `STRIPE_WEBHOOK_SECRET`

### 6. Sanity Check the Deployment

After deploying:

1. Confirm the backend boots in Vercel.
2. Hit `GET /api/health`.
3. Test wallet login:
   - `POST /api/private/session/wallet/challenge`
   - `POST /api/private/session/wallet/verify`
4. Confirm `GET /api/private/session/me` returns account/session state.
5. Confirm `GET /api/private/relay/eas/nonce` works for an active subscription.
6. Confirm `POST /api/private/rpc-premium` can proxy allowed JSON-RPC reads.

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
