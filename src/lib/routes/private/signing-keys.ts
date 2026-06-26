import { z } from "zod";
import type { AccountContext } from "@/lib/services/account-service";
import { upsertKeyMetadata, listKeyMetadata } from "@/lib/services/signing-keys-service";

export const upsertSigningKeyBodySchema = z.object({
  keyDid: z.string().trim().min(1),
  keyType: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  tags: z.array(z.string()).optional().default([]),
  notes: z.string().nullable().optional()
});

export const listSigningKeysQuerySchema = z.object({
  keyType: z.string().optional(),
  tag: z.string().optional()
});

export async function postSigningKey(accountContext: AccountContext, body: z.infer<typeof upsertSigningKeyBodySchema>) {
  const result = await upsertKeyMetadata({
    accountId: accountContext.account.id,
    keyDid: body.keyDid,
    keyType: body.keyType,
    displayName: body.displayName,
    tags: body.tags,
    notes: body.notes ?? null
  });

  return {
    id: result.id,
    accountId: result.account_id,
    keyDid: result.key_did,
    keyType: result.key_type,
    displayName: result.display_name,
    tags: result.tags,
    notes: result.notes,
    created: result.created,
    createdAt: result.created_at,
    updatedAt: result.updated_at
  };
}

export async function getSigningKeys(
  accountContext: AccountContext,
  query: z.infer<typeof listSigningKeysQuerySchema>
) {
  const rows = await listKeyMetadata({
    accountId: accountContext.account.id,
    keyType: query.keyType,
    tag: query.tag
  });

  return {
    keys: rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      keyDid: row.key_did,
      keyType: row.key_type,
      displayName: row.display_name,
      tags: row.tags,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  };
}
