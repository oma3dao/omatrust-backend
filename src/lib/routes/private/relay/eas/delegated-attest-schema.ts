import { z } from "zod";
import type { PrepareDelegatedAttestationResult } from "@oma3/omatrust/reputation";

const hexStringSchema = z.string().regex(/^0x[a-fA-F0-9]+$/, "Expected 0x-prefixed hex string");
const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Expected EVM address");
const numericStringSchema = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]);

const typedDataFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1)
});

const delegatedTypedDataMessageSchema = z.object({
  attester: evmAddressSchema,
  schema: hexStringSchema,
  recipient: evmAddressSchema,
  expirationTime: numericStringSchema,
  revocable: z.boolean(),
  refUID: hexStringSchema,
  data: hexStringSchema,
  value: numericStringSchema,
  nonce: numericStringSchema,
  deadline: numericStringSchema
});

const delegatedRequestSchema = z.object({
  schema: hexStringSchema,
  attester: evmAddressSchema,
  easContractAddress: evmAddressSchema,
  chainId: z.number().int().positive(),
  recipient: evmAddressSchema,
  expirationTime: numericStringSchema,
  revocable: z.boolean(),
  refUID: hexStringSchema,
  data: hexStringSchema,
  value: numericStringSchema,
  nonce: numericStringSchema,
  deadline: numericStringSchema
});

const typedDataSchema = z.object({
  domain: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    chainId: z.number().int().positive(),
    verifyingContract: evmAddressSchema
  }),
  types: z.object({
    Attest: z.array(typedDataFieldSchema).min(1)
  }),
  message: delegatedTypedDataMessageSchema
});

export const delegatedPreparedAttestationSchema: z.ZodType<PrepareDelegatedAttestationResult> = z.object({
  delegatedRequest: delegatedRequestSchema,
  typedData: typedDataSchema
});

export const delegatedAttestBodySchema = z.object({
  attester: evmAddressSchema,
  prepared: delegatedPreparedAttestationSchema,
  signature: hexStringSchema,
  subjectDid: z.string().min(1).optional()
});

export type DelegatedAttestBody = z.infer<typeof delegatedAttestBodySchema>;
export type DelegatedTypedDataMessage = z.infer<typeof delegatedTypedDataMessageSchema>;
