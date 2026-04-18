import { z } from "zod";
import { delegatedAttestBodySchema } from "@/lib/routes/private/relay/eas/delegated-attest-schema";
import type { AccountContext } from "@/lib/services/account-service";
import { submitDelegatedAttestation } from "@/lib/services/relay-eas-service";

export { delegatedAttestBodySchema };

export async function postRelayEasDelegatedAttest(
  accountContext: AccountContext,
  body: z.infer<typeof delegatedAttestBodySchema>
) {
  return submitDelegatedAttestation({
    accountContext,
    attester: body.attester,
    prepared: body.prepared,
    signature: body.signature
  });
}
