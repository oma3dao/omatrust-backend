# Service Signing Keys — Backend Spec

Status: Draft
Released in: Unreleased

## Goal

Add backend support for service signing key metadata. Service providers register external signing keys (x402 receipt signers, MCP server keys, etc.) and OMATrust stores the metadata that associates those keys with services. Trust records (key bindings, controller witnesses) continue to live onchain. OMATrust never holds private keys and never signs artifacts on behalf of the user.

This spec covers:

- a new `key_metadata` table for storing key type, display names, tags, and notes
- CRUD API endpoints for managing key metadata
- integration points with existing key-binding and controller-witness flows

## Scope

### In Scope

- `key_metadata` table schema and migration
- TypeScript schema types mirroring the migration
- Session-authenticated CRUD endpoints under `/api/private/signing-keys`
- Validation rules for key identifiers, key types, and tags

### Out of Scope

- new onchain attestation schemas (existing key-binding and controller-witness schemas are reused)
- key rotation workflows (deferred to V2)
- cached key-binding authorization tables
- signing or custody of private keys
- x402 receipt/offer signing functionality

## Conceptual Distinction

The backend manages two kinds of keys for different purposes:

- **Attestation / account key**: the wallet used to sign into the portal and submit delegated OMATrust attestations. Stored in the `wallets` table. Used for SIWE authentication and EIP-712 delegated execution.
- **Service signing key**: an external key used by the service to sign artifacts outside OMATrust, such as x402 offers and receipts. Stored in the `key_metadata` table with `key_type = 'service-signing'`. OMATrust publishes the trust records that tell agents and verifiers which keys are authorized for a service — it does not hold the private key.

## Data Model

### New Table: `key_metadata`

This is a general-purpose metadata table. It is not limited to signing keys — any key can have metadata attached. The `key_type` field distinguishes attestation keys from service signing keys. The `tags` array captures use-case labels. The frontend filters by `key_type` to decide which dashboard section displays a key.

The table does not include `subject_did`. The key-to-subject relationship is an onchain concern (key-binding attestations bind a key to a subject). A single signing key may be authorized to sign for multiple subjects, so pinning a subject in the metadata table would either force duplicate rows or misrepresent the relationship.

#### Column Reference

| Column         | Type           | Required | Default               | Description                                                                                                    |
|----------------|----------------|----------|-----------------------|----------------------------------------------------------------------------------------------------------------|
| `id`           | `uuid`         | yes      | `gen_random_uuid()`   | Primary key. Auto-generated unique identifier for each metadata record.                                        |
| `account_id`   | `uuid`         | yes      | —                     | Foreign key to `accounts.id`. Cascades on delete. Scopes the record to the owning OMATrust account.            |
| `key_did`      | `text`         | yes      | —                     | The public key identifier in DID format, e.g. `did:pkh:eip155:1:0xabc...`. Canonicalized before storage.      |
| `key_type`     | `text`         | yes      | —                     | Top-level key classification. Check-constrained to: `attestation`, `service-signing`.                          |
| `display_name` | `text`         | yes      | —                     | Human-readable label for the key, e.g. "Production x402 receipt signer". Max 200 characters.                   |
| `tags`         | `text[]`       | yes      | `'{}'`                | Use-case tags. A key may have multiple tags (e.g. `{x402, mcp}`). Allowed values controlled by the frontend.   |
| `notes`        | `text`         | no       | `null`                | Freeform notes, e.g. "Stored in AWS KMS" or "Rotated monthly". Max 1000 characters. Nullable.                  |
| `created_at`   | `timestamptz`  | yes      | `now()`               | Timestamp when the record was created.                                                                         |
| `updated_at`   | `timestamptz`  | yes      | `now()`               | Timestamp of last update. Automatically refreshed by the `set_updated_at` trigger.                             |

#### Constraints

| Constraint                              | Type        | Description                                                                                       |
|-----------------------------------------|-------------|---------------------------------------------------------------------------------------------------|
| `key_metadata_pkey`                     | Primary key | On `id`.                                                                                          |
| `key_metadata_account_id_fkey`          | Foreign key | `account_id` references `accounts(id)`, cascade on delete.                                        |
| `key_metadata_account_key_did`          | Unique      | On `(account_id, key_did)`. Used as the upsert target — POST with an existing key overwrites metadata. Does not prevent cross-account registration of the same key. |
| `key_metadata_key_type_check`           | Check       | `key_type in ('attestation', 'service-signing')`.                                                 |
| (none for tags)                        | —           | Tag vocabulary is controlled by the frontend, not by a DB constraint. Backend validates format only (non-empty strings, max 50 chars each, max 10 tags). |

#### Migration SQL

```sql
create table if not exists public.key_metadata (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  key_did text not null,
  key_type text not null check (key_type in ('attestation', 'service-signing')),
  display_name text not null,
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint key_metadata_account_key_did unique (account_id, key_did)
);

create index if not exists key_metadata_account_id_idx on public.key_metadata(account_id);

alter table public.key_metadata enable row level security;

drop trigger if exists key_metadata_set_updated_at on public.key_metadata;
create trigger key_metadata_set_updated_at
before update on public.key_metadata
for each row execute function public.set_updated_at();
```

### Status Derivation

There is no `status` column. Key state is derived by the frontend from onchain attestation data. Since a key can have key-binding attestations for multiple subjects, the frontend computes status per subject:

- **Registered** = `key_metadata` row exists, no onchain key-binding attestation found for this key+subject pair
- **Active** = key-binding attestation exists for this key+subject pair and is not revoked
- **Revoked** = key-binding attestation exists for this key+subject pair and has been revoked onchain

### Trust Level Derivation

Trust level is also derived from onchain state per key+subject pair (same as existing Key Authorizations):

- **Basic** = DNS TXT or did.json confirms controller relationship
- **Intermediate** = controller-witness attestation exists
- **Advanced** = both key-binding and controller-witness attestations exist

### Key Types

| Value              | Description                                                                                          |
|--------------------|------------------------------------------------------------------------------------------------------|
| `attestation`      | Wallet used for SIWE sign-in and delegated OMATrust attestations. Already tracked in `wallets` table; `key_metadata` allows attaching display names and notes. Reserved for future use. |
| `service-signing`  | External key used by the service to sign artifacts outside OMATrust (x402 receipts, MCP responses, etc.). Primary use case for MVP. |

### Tags

Tags describe what a key is used for. A key may have multiple tags (e.g., a server wallet used for both x402 and MCP signing).

| Value              | Label                     | Description                                                  |
|--------------------|---------------------------|--------------------------------------------------------------|
| `x402`             | x402 Offers & Receipts    | Keys used to sign x402 payment offers and receipts           |
| `mcp`              | MCP Server Artifacts      | Keys used to sign MCP server responses                       |
| `software-release` | Software Release Proofs   | Keys used to sign software builds or release manifests       |
| `generic-signing`  | Generic Service Signing   | General-purpose service signing keys                         |
| `other`            | Other                     | Custom use case not covered above                            |

The allowed tag vocabulary is controlled by the frontend, not by a DB constraint. The backend validates format only (non-empty strings, max 50 characters each, max 10 tags). This allows the frontend to add or rename tags without a backend migration.

### TypeScript Schema

Add to `src/lib/db/schema.ts`:

```typescript
type KeyMetadataTag = "x402" | "mcp" | "software-release" | "generic-signing" | "other";

key_metadata: {
  Row: {
    id: string;
    account_id: string;
    key_did: string;
    key_type: "attestation" | "service-signing";
    display_name: string;
    tags: KeyMetadataTag[];
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    account_id: string;
    key_did: string;
    key_type: "attestation" | "service-signing";
    display_name: string;
    tags?: KeyMetadataTag[];
    notes?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    account_id?: string;
    key_did?: string;
    key_type?: "attestation" | "service-signing";
    display_name?: string;
    tags?: KeyMetadataTag[];
    notes?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [];
};
```

## API Endpoints

### HTTP Contract Conventions

All endpoints follow the same conventions as the existing private API:

- authenticated browser endpoints use the session cookie
- all responses are JSON
- errors return `{ "error": "...", "code": "MACHINE_CODE" }`

### Route Implementation and Test Mapping

Route files follow the existing thin-wrapper pattern:

- `route.ts` parses HTTP input through `withRoute(...)`
- `src/lib/routes/private/signing-keys.ts` handles endpoint orchestration (POST upsert + GET list)
- `src/lib/services/signing-keys-service.ts` performs business logic and persistence (`upsertKeyMetadata`, `listKeyMetadata`)

### `POST https://backend.omatrust.org/api/private/signing-keys`

Creates or updates a key metadata record for the current account (upsert).

If the account already has a `key_metadata` record for the given `keyDid`, the existing record's `displayName`, `tags`, and `notes` are overwritten with the new values. The `id` and `createdAt` are preserved. This eliminates the need for a separate update endpoint.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `keyDid` | body | `string` | yes | Key identifier in DID format: `did:pkh:...`, `did:key:...`, `did:jwk:...`, or `did:ethr:...` |
| `keyType` | body | `string` | yes | One of: `attestation`, `service-signing` |
| `displayName` | body | `string` | yes | Human-readable label, e.g. "Production x402 receipt signer" |
| `tags` | body | `string[]` | no | Use-case tags, e.g. `["x402"]` or `["x402", "mcp"]`. Defaults to `[]` |
| `notes` | body | `string` | no | Freeform notes, e.g. "Stored in AWS KMS" |

Request:

```json
{
  "keyDid": "did:pkh:eip155:1:0xabc123...",
  "keyType": "service-signing",
  "displayName": "Production x402 receipt signer",
  "tags": ["x402"],
  "notes": "Stored in AWS KMS, rotated monthly"
}
```

Response:

```json
{
  "id": "uuid",
  "accountId": "uuid",
  "keyDid": "did:pkh:eip155:1:0xabc123...",
  "keyType": "service-signing",
  "displayName": "Production x402 receipt signer",
  "tags": ["x402"],
  "notes": "Stored in AWS KMS, rotated monthly",
  "created": true,
  "createdAt": "2026-06-24T18:00:00.000Z",
  "updatedAt": "2026-06-24T18:00:00.000Z"
}
```

The `created` field is `true` if a new row was inserted, `false` if an existing row was updated. This lets the frontend distinguish creates from updates for UI feedback.

Behavior:

- validates `keyDid` is a supported DID format (`did:pkh`, `did:key`, `did:jwk`, `did:ethr`)
- validates `keyType` is one of: `attestation`, `service-signing`
- validates every element in `tags` is a non-empty string of at most 50 characters, and at most 10 tags total
- validates `displayName` is non-empty and at most 200 characters
- validates `notes` is at most 1000 characters if provided
- canonicalizes `keyDid` before storage
- if a record already exists for `(account_id, key_did)`: updates `display_name`, `tags`, `notes`, and `updated_at`; preserves `id`, `created_at`, `key_type`
- if no record exists: inserts a new row
- cross-account: another account registering the same `keyDid` is allowed (no cross-account uniqueness)

Persistence effects:

- inserts one `key_metadata` row, or updates `display_name`, `tags`, `notes` on an existing row (`ON CONFLICT (account_id, key_did) DO UPDATE`)

Error codes:

| Code | Status | Condition |
|---|---:|---|
| `UNAUTHENTICATED` | 401 | No valid session |
| `INVALID_INPUT` | 400 | Missing required fields, invalid DID format, invalid key type, tag format violations, or field length exceeded |

Unit test targets:

- route wrapper: `POST src/app/api/private/signing-keys/route.ts`
- route handler: `postSigningKey` in `src/lib/routes/private/signing-keys.ts`
- core service: `upsertKeyMetadata` in `src/lib/services/signing-keys-service.ts`

### `GET https://backend.omatrust.org/api/private/signing-keys`

Lists all key metadata records for the current account.

Auth:

- current session cookie required

Request parameter table:

| Field | Location | Type | Required | Description |
|---|---|---:|---:|---|
| `keyType` | query | `string` | no | Filter by key type (`attestation` or `service-signing`) |
| `tag` | query | `string` | no | Filter to keys that include this tag |

Response:

```json
{
  "keys": [
    {
      "id": "uuid",
      "accountId": "uuid",
      "keyDid": "did:pkh:eip155:1:0xabc123...",
      "keyType": "service-signing",
      "displayName": "Production x402 receipt signer",
      "tags": ["x402"],
      "notes": "Stored in AWS KMS, rotated monthly",
      "createdAt": "2026-06-24T18:00:00.000Z",
      "updatedAt": "2026-06-24T18:00:00.000Z"
    }
  ]
}
```

Behavior:

- returns all `key_metadata` rows for the current account
- optional `keyType` filter narrows to a specific key type
- optional `tag` filter narrows to keys whose `tags` array contains the value (`WHERE tags @> array[?]`)
- results ordered by `created_at` descending

Persistence effects:

- none (read-only)

Error codes:

| Code | Status | Condition |
|---|---:|---|
| `UNAUTHENTICATED` | 401 | No valid session |

Unit test targets:

- route wrapper: `GET src/app/api/private/signing-keys/route.ts`
- route handler: `getSigningKeys` in `src/lib/routes/private/signing-keys.ts`
- core service: `listKeyMetadata` in `src/lib/services/signing-keys-service.ts`

## Files to Create or Modify

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/YYYYMMDDNNNN_add_key_metadata.sql` | create | Migration for `key_metadata` table |
| `src/lib/db/schema.ts` | modify | Add `key_metadata` table types |
| `src/app/api/private/signing-keys/route.ts` | create | POST (upsert) + GET route handler |
| `src/lib/routes/private/signing-keys.ts` | create | Endpoint orchestration |
| `src/lib/services/signing-keys-service.ts` | create | Business logic and persistence |

## Key Identifier Validation

Accepted `keyDid` formats:

| Prefix | Example | Notes |
|---|---|---|
| `did:pkh:` | `did:pkh:eip155:1:0xabc...` | EVM signer, must have >= 5 colon-separated parts |
| `did:ethr:` | `did:ethr:0x1:0xabc...` | Ethereum DID, must have >= 4 parts |
| `did:key:` | `did:key:z6Mk...` | Multicodec public key, must have >= 3 parts |
| `did:jwk:` | `did:jwk:eyJ...` | JWK public key, must have >= 3 parts |

These rules match the validation in the existing frontend `buildServiceKeys()` function (`PRIVATE_KEY_DID_PREFIXES` + length checks).

## Open Questions

1. Should `attestation`-type keys have their own tag vocabulary (e.g., `portal-auth`, `delegated-attestation`), or should attestation keys use `tags = '{}'` until a need arises? For MVP, attestation keys are not stored in `key_metadata` — they live in `wallets`. The attestation tag vocabulary is deferred.

## Deferred (V2)

- **Key rotation**: accept a new `keyDid`, revoke the old key-binding attestation, create a new one, and update the `key_metadata` row. Requires coordinating onchain revocation with metadata update.
- **Retire state**: soft deactivation without onchain revocation. Would require adding a `status` column to `key_metadata`.
- **Deletion endpoint**: if needed in the future, `POST /api/private/signing-keys/:id/remove` can be added. For MVP, keys are not deletable — lifecycle is managed onchain.
- **Bulk operations**: batch create/update for accounts managing many keys.
- **Audit log**: track changes to key metadata for compliance.

## Risk List

- **User confusion about signing**: users may think OMATrust signs x402 receipts. Mitigated by API response never including private key fields and by frontend UX copy.
- **Stale metadata**: metadata may describe a key whose onchain attestation has been revoked. Acceptable — the frontend derives status from onchain state, not metadata.
- **Tag drift**: `keyPurpose` in onchain key-binding schema and `tags` in `key_metadata` could diverge. MVP treats them independently; V2 could sync them.
