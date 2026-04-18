import { z } from "zod";
import { created } from "@/lib/http";
import { addSubjectToAccount, listSubjects } from "@/lib/services/subject-service";

export const createSubjectBodySchema = z.object({
  did: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(100).nullable().optional()
});

export async function getSubjects(accountId: string) {
  const subjects = await listSubjects(accountId);

  return {
    subjects: subjects.map((subject) => ({
      id: subject.id,
      canonicalDid: subject.canonical_did,
      subjectDidHash: subject.subject_did_hash,
      displayName: subject.display_name,
      isDefault: subject.is_default
    }))
  };
}

export async function postSubjects(accountId: string, body: z.infer<typeof createSubjectBodySchema>) {
  const subject = await addSubjectToAccount(accountId, body.did, body.displayName ?? null);

  return created({
    subject: {
      id: subject.id,
      canonicalDid: subject.canonical_did,
      subjectDidHash: subject.subject_did_hash,
      displayName: subject.display_name,
      isDefault: subject.is_default
    }
  });
}
