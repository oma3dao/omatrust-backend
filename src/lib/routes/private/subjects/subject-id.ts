import { z } from "zod";
import { getSubjectForAccount } from "@/lib/services/subject-service";

export const subjectIdParamsSchema = z.object({
  subjectId: z.string().min(1)
});

export async function getSubjectById(accountId: string, params: z.infer<typeof subjectIdParamsSchema>) {
  const subject = await getSubjectForAccount(accountId, params.subjectId);

  return {
    subject: {
      id: subject.id,
      canonicalDid: subject.canonical_did,
      subjectDidHash: subject.subject_did_hash,
      displayName: subject.display_name,
      isDefault: subject.is_default
    }
  };
}
