import { prisma } from "@/lib/prisma";

/** Atomically claim a comment for reply. Returns true ONLY for the caller that
 *  wins the claim (flips replied false→true); all other paths get false and must skip.
 *  Ensures the Comment row exists first (replied=false), then does a conditional updateMany. */
export async function claimCommentForReply(
  instagramCommentId: string,
  seed: { postId?: string | null; mediaId?: string | null; username: string; text: string; timestamp?: Date },
): Promise<boolean> {
  try {
    await prisma.comment.upsert({
      where:  { instagramCommentId },
      create: { instagramCommentId, postId: seed.postId ?? null, mediaId: seed.mediaId ?? null,
                username: seed.username, text: seed.text, timestamp: seed.timestamp ?? new Date(), replied: false },
      update: {},
    });
    const res = await prisma.comment.updateMany({
      where: { instagramCommentId, replied: false },
      data:  { replied: true },
    });
    return res.count === 1;
  } catch { return false; }
}

/** Release a claim (reset replied=false) when the reply ultimately FAILED to send,
 *  so a later run can retry. */
export async function releaseCommentClaim(instagramCommentId: string): Promise<void> {
  await prisma.comment.updateMany({ where: { instagramCommentId }, data: { replied: false } }).catch(() => {});
}

/** Persist the reply text after a successful send (keeps replied=true). */
export async function markCommentReplied(instagramCommentId: string, replyText: string): Promise<void> {
  await prisma.comment.updateMany({ where: { instagramCommentId }, data: { replied: true, replyText } }).catch(() => {});
}
