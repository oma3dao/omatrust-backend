# omatrust-backend

Shared backend service for OMATrust.

This repository will host the SaaS-style backend logic for OMATrust frontends, including account management, subscriptions, relay authorization, and delegated execution workflows.

Planned deployment:

- `backend.omatrust.org` — first-party backend service for OMATrust frontends

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

## Status

This repository is currently in initial scaffolding.

## License and Participation

- Code is licensed under [MIT](./LICENSE)
- Contributor terms are defined in [CONTRIBUTING.md](./CONTRIBUTING.md)

**Licensing Notice**
This initial version (v1) is released under MIT to maximize transparency and adoption.

OMA3 may license future versions of this reference implementation under different terms (for example, the Business Source License, BSL) if forks or incompatible implementations threaten to fragment the ecosystem or undermine the sustainability of OMA3.

OMA3 standards (such as specifications and schemas) will always remain open and are governed by [OMA3's IPR Policy](https://www.oma3.org/intellectual-property-rights-policy).
