import { z } from "zod";
import { NextResponse } from "next/server";
import { setSessionCookie, verifySiweChallengeAndRegister } from "@/lib/services/session-service";

export const sessionRegisterBodySchema = z.object({
  challengeId: z.string().min(1),
  walletDid: z.string().min(1),
  signature: z.string().min(1),
  siweMessage: z.string().min(1),
  walletProviderId: z.string().min(1).max(100).optional().nullable(),
  executionMode: z.enum(["subscription", "native"]).optional().nullable()
});

export async function postSessionRegister(body: z.infer<typeof sessionRegisterBodySchema>) {
  const result = await verifySiweChallengeAndRegister(body);

  const response = NextResponse.json({
    account: {
      id: result.accountContext.account.id,
      displayName: result.accountContext.account.display_name
    },
    client: {
      clientId: result.accountContext.client?.client_id ?? null
    },
    session: {
      id: result.session.id,
      expiresAt: result.session.expires_at
    }
  });

  setSessionCookie(response, result.token, result.session.expires_at);
  return response;
}
