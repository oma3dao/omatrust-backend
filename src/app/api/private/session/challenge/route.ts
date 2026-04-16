import { createSiweChallenge } from "@/lib/services/session-service";
import { errorResponse, ok, parseJson } from "@/lib/http";

export const runtime = "nodejs";

interface ChallengeBody {
  walletDid: string;
  chainId: number;
  domain: string;
  uri: string;
}

export async function POST(request: Request) {
  try {
    const body = await parseJson<ChallengeBody>(request);
    const result = await createSiweChallenge(body);
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
