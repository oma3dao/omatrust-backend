import { z } from "zod";
import { createSiweChallenge } from "@/lib/services/session-service";

export const sessionChallengeBodySchema = z.object({
  walletDid: z.string().min(1),
  chainId: z.number().int().positive(),
  domain: z.string().min(1),
  uri: z.string().min(1)
});

export async function postSessionChallenge(body: z.infer<typeof sessionChallengeBodySchema>) {
  return createSiweChallenge(body);
}
