import { NextResponse } from "next/server";
import { errorResponse, parseJson } from "@/lib/http";
import { setSessionCookie, verifySiweChallengeAndCreateSession } from "@/lib/services/session-service";

export const runtime = "nodejs";

interface VerifyBody {
  challengeId: string;
  walletDid: string;
  signature: string;
  siweMessage: string;
}

export async function POST(request: Request) {
  try {
    const body = await parseJson<VerifyBody>(request);
    const result = await verifySiweChallengeAndCreateSession(body);

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
  } catch (error) {
    return errorResponse(error);
  }
}
