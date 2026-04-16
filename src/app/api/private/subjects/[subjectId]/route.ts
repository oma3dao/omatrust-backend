import { errorResponse, ok } from "@/lib/http";
import { getAuthenticatedAccountContext } from "@/lib/services/session-service";
import { getSubjectForAccount } from "@/lib/services/subject-service";
import { assertApiReadAllowed, incrementApiReadUsage } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ subjectId: string }> }) {
  try {
    const accountContext = await getAuthenticatedAccountContext(_request);
    assertApiReadAllowed(accountContext.subscription);
    await incrementApiReadUsage(accountContext.subscription);
    const { subjectId } = await context.params;
    const subject = await getSubjectForAccount(accountContext.account.id, subjectId);

    return ok({
      subject: {
        id: subject.id,
        canonicalDid: subject.canonical_did,
        subjectDidHash: subject.subject_did_hash,
        isDefault: subject.is_default
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
