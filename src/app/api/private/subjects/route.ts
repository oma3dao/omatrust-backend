import { z } from "zod";
import { created, errorResponse, ok, parseJson } from "@/lib/http";
import { getAuthenticatedAccountContext } from "@/lib/services/session-service";
import { addSubjectToAccount, listSubjects } from "@/lib/services/subject-service";
import { assertApiReadAllowed, incrementApiReadUsage } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

const createSubjectSchema = z.object({
  did: z.string().trim().min(1)
});

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedAccountContext(request);
    assertApiReadAllowed(context.subscription);
    await incrementApiReadUsage(context.subscription);
    const subjects = await listSubjects(context.account.id);

    return ok({
      subjects: subjects.map((subject) => ({
        id: subject.id,
        canonicalDid: subject.canonical_did,
        subjectDidHash: subject.subject_did_hash,
        isDefault: subject.is_default
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedAccountContext(request);
    const body = createSubjectSchema.parse(await parseJson(request));
    const subject = await addSubjectToAccount(context.account.id, body.did);

    return created({
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
