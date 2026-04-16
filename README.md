# omatrust-backend

Shared backend service for OMATrust.

This repository will host the SaaS-style backend logic for OMATrust frontends, including account management, subscriptions, relay authorization, and delegated execution workflows.

Planned deployment:

- `backend.omatrust.org` — first-party backend service for OMATrust frontends

## **License and Participation**

- Code is licensed under [MIT](./LICENSE)
- Contributor terms are defined in [CONTRIBUTING.md](./CONTRIBUTING.md)

**Licensing Notice**  
This initial version (v1) is released under MIT to maximize transparency and adoption.  

OMA3 may license future versions of this reference implementation under different terms (for example, the Business Source License, BSL) if forks or incompatible implementations threaten to fragment the ecosystem or undermine the sustainability of OMA3.  

OMA3 standards (such as specifications and schemas) will always remain open and are governed by [OMA3's IPR Policy](https://www.oma3.org/intellectual-property-rights-policy).

## Documentation

This repository follows the OMA3 feature-doc process:

```text
/docs/
  /features/
    /<feature-name>/
      plan.md
      spec.md
  features/README.md
```

Current documented feature:

- [Delegated Execution](./docs/features/delegated-execution/plan.md)

## Repository Scope

Expected responsibilities include:

- account and subscription management
- relay authorization and transaction submission
- bootstrap voucher logic
- first-party backend APIs for OMATrust frontends
- future shared backend workflows migrated out of frontend repositories

This repository does not contain:

- frontend UI code
- smart contract source code
- the public API gateway facade at `api.omatrust.org`

## Getting Started

1. Copy `.env.example` to `.env.local`
2. Install dependencies
3. Apply the SQL migration in [`supabase/migrations`](./supabase/migrations)
4. Run the backend with `npm run dev`

Current implementation scaffold includes:

- private Next.js route handlers under `src/app/api/private/...`
- SIWE challenge / verify / session handling
- account, subject, and subscription service modules
- EAS relay nonce + delegated attestation server routes
- versioned Supabase migration files

## Current Structure

```text
src/
  app/api/private/
  lib/auth/
  lib/config/
  lib/db/
  lib/policy/
  lib/services/
supabase/
  migrations/
docs/features/delegated-execution/
  plan.md
  spec.md
```

## Status

This repository now has a V1 backend scaffold aligned to the delegated execution spec, but it has not yet been connected to a live Supabase project or exercised against production Stripe / relay credentials.

## License and Participation

- Code is licensed under [MIT](./LICENSE)
- Contributor terms are defined in [CONTRIBUTING.md](./CONTRIBUTING.md)

**Licensing Notice**
This initial version (v1) is released under MIT to maximize transparency and adoption.

OMA3 may license future versions of this reference implementation under different terms (for example, the Business Source License, BSL) if forks or incompatible implementations threaten to fragment the ecosystem or undermine the sustainability of OMA3.

OMA3 standards (such as specifications and schemas) will always remain open and are governed by [OMA3's IPR Policy](https://www.oma3.org/intellectual-property-rights-policy).
