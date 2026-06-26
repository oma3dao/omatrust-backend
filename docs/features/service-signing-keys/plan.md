# Service Signing Keys — Backend Plan

Status: Draft
Released in: Unreleased

## Implementation Goal

Add a `key_metadata` table and upsert+list API so the frontend can store key type, display names, tags, and notes for service signing keys. The backend does not manage onchain trust records in this feature — those continue to flow through the existing key-binding and controller-witness endpoints.

The product behavior is defined in `spec.md`.

## Acceptance Criteria

### AC-1: Migration creates `key_metadata` table

- The migration creates the `key_metadata` table with all columns defined in the spec.
- The unique constraint on `(account_id, key_did)` is enforced.
- RLS is enabled with no policies (backend uses service role key).
- The `set_updated_at` trigger fires on updates.

### AC-2: POST upserts key metadata

- A signed-in user can create a key metadata record.
- If the account already has a record for the same `keyDid`, the POST overwrites `displayName`, `tags`, and `notes` (upsert).
- The response includes a `created` boolean (`true` for insert, `false` for update).
- The response includes all fields with server-generated `id`, `createdAt`, `updatedAt`.
- `keyDid` is validated against supported DID formats (`did:pkh`, `did:key`, `did:jwk`, `did:ethr`).
- `keyType` is validated as `attestation` or `service-signing`.
- Every element in `tags` is validated for format (non-empty string, max 50 chars). Max 10 tags total. Tag vocabulary is controlled by the frontend.
- `displayName` must be non-empty and at most 200 characters.
- `notes` must be at most 1000 characters if provided.
- Cross-account: another account registering the same `keyDid` is allowed.
- Unauthenticated requests return 401 `UNAUTHENTICATED`.

### AC-3: GET lists key metadata

- Returns all `key_metadata` rows for the current account, ordered by `created_at` descending.
- Optional `keyType` query parameter filters results.
- Optional `tag` query parameter filters to keys containing that tag.
- Returns an empty array if no records exist.
- Unauthenticated requests return 401.

### AC-4: No separate update or remove endpoints

- There is no PATCH or DELETE/remove endpoint.
- Updates are handled by re-POSTing with the same `keyDid` (upsert overwrites metadata).
- Key metadata records are not deletable. Key lifecycle is managed onchain (revocation via key-binding attestation).

### AC-6: DID canonicalization

- `keyDid` is canonicalized before storage using the same normalization logic used elsewhere in the backend (lowercase, consistent formatting).
- Lookups and uniqueness checks use canonical forms.

### AC-7: No private key exposure

- The API never accepts or returns private key material.
- No field named `privateKey`, `secret`, or similar exists in the request or response schemas.

## Test Cases

### Unit Tests: Service Layer (`signing-keys-service.ts`)

| ID | Test | Expected Result |
|---|---|---|
| S-1 | `upsertKeyMetadata` with valid inputs (new key) | Row inserted, returned with generated id, `created: true` |
| S-2 | `upsertKeyMetadata` with same `keyDid` again | Row updated (displayName/tags/notes overwritten), `created: false`, `id` and `createdAt` preserved |
| S-3 | `upsertKeyMetadata` with invalid `keyDid` format | Throws error with `INVALID_INPUT` code |
| S-4 | `upsertKeyMetadata` with tag > 50 chars | Throws error with `INVALID_INPUT` code |
| S-4b | `upsertKeyMetadata` with invalid `keyType` | Throws error with `INVALID_INPUT` code |
| S-4c | `upsertKeyMetadata` with > 10 tags | Throws error with `INVALID_INPUT` code |
| S-5 | `upsertKeyMetadata` with empty `displayName` | Throws error with `INVALID_INPUT` code |
| S-6 | `upsertKeyMetadata` with `displayName` > 200 chars | Throws error with `INVALID_INPUT` code |
| S-7 | `upsertKeyMetadata` with `notes` > 1000 chars | Throws error with `INVALID_INPUT` code |
| S-8 | `listKeyMetadata` for account with 3 records | Returns 3 records ordered by `created_at` desc |
| S-9 | `listKeyMetadata` with `keyType` filter | Returns only matching records |
| S-10 | `listKeyMetadata` with `tag` filter | Returns only records whose `tags` contain the value |
| S-10b | `upsertKeyMetadata` with multiple tags `["x402", "mcp"]` | Row inserted with both tags |
| S-11 | `listKeyMetadata` for account with no records | Returns empty array |
| S-12 | `upsertKeyMetadata` preserves `created_at` on update | `created_at` unchanged, `updated_at` refreshed |
| S-13 | Cross-account: two accounts register same `keyDid` | Both succeed independently, separate rows |

### Unit Tests: Route Handlers (`signing-keys.ts`)

| ID | Test | Expected Result |
|---|---|---|
| R-1 | POST with valid session and body (new key) | 200, created record with `created: true` |
| R-2 | POST without session | 401 `UNAUTHENTICATED` |
| R-3 | POST with missing required field | 400 `INVALID_INPUT` |
| R-4 | POST with same `keyDid` again | 200, updated record with `created: false` |
| R-5 | GET with valid session | 200, array of records |
| R-6 | GET without session | 401 `UNAUTHENTICATED` |
| R-7 | GET with keyType filter | 200, filtered results |
| R-7b | GET with tag filter | 200, filtered results |

### Integration Tests: Route Layer

| ID | Test | Expected Result |
|---|---|---|
| I-1 | Create then re-POST lifecycle | POST creates, second POST with same keyDid updates, GET returns one record |
| I-2 | Cross-account isolation | Account A cannot read Account B's records |
| I-3 | Cross-account key sharing | Account A and Account B can both register the same `keyDid` |
| I-4 | DID canonicalization | Two DIDs differing only in case map to same canonical form (upsert, not duplicate) |

### Migration Tests

| ID | Test | Expected Result |
|---|---|---|
| M-1 | Migration applies cleanly on empty database | Table created with all constraints |
| M-2 | Migration is idempotent | Running twice does not error (uses `if not exists`) |
| M-3 | `set_updated_at` trigger fires | Updating a row changes `updated_at` |
| M-4 | Unique constraint on `(account_id, key_did)` | Raw SQL insert of same pair uses ON CONFLICT for upsert |
| M-5 | Tags column accepts arbitrary string values | Insert with any `tags` array succeeds (validation is application-layer) |
| M-5b | Key type check constraint rejects invalid values | Insert with `key_type = 'invalid'` fails |
| M-6 | Foreign key cascade | Deleting an account cascades to `key_metadata` rows |
