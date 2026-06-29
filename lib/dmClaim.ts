import { prisma } from "@/lib/prisma";

/**
 * Atomic DM claim keyed on the inbound message id (mid).
 *
 * There are NO migrations in this project and the ActivityLog table has no
 * unique constraint, so we cannot create a dedicated dedup table or rely on a
 * create-conflict on ActivityLog.entityId. Instead we reuse the ONE atomic
 * primitive the schema already gives us: Comment.instagramCommentId is @unique,
 * and `commentClaim` already proves the conditional-updateMany pattern on it.
 *
 * We store the DM claim as a Comment row whose instagramCommentId is namespaced
 * `dm:<mid>` so it can never collide with a real Instagram comment id. The
 * upsert+conditional-updateMany makes the claim genuinely atomic across the two
 * webhook routes AND across process restarts: exactly ONE caller flips
 * replied:false→true and is allowed to send a reply.
 */

const DM_CLAIM_PREFIX = "dm:";

/** Atomically claim a DM (by inbound mid) for reply. Returns true ONLY for the
 *  caller that wins the claim; every other path gets false and must skip the
 *  reply. If `mid` is missing we cannot dedup → return true (process once). */
export async function claimDMForReply(
  mid: string | null | undefined,
  seed: { senderId: string; username?: string; text?: string },
): Promise<boolean> {
  if (!mid) return true; // no message id → nothing to dedup on; allow processing
  const key = `${DM_CLAIM_PREFIX}${mid}`;
  try {
    await prisma.comment.upsert({
      where:  { instagramCommentId: key },
      create: {
        instagramCommentId: key,
        postId:    null,
        mediaId:   null,
        username:  seed.username ?? seed.senderId,
        text:      seed.text ?? "",
        timestamp: new Date(),
        replied:   false,
      },
      update: {},
    });
    const res = await prisma.comment.updateMany({
      where: { instagramCommentId: key, replied: false },
      data:  { replied: true },
    });
    return res.count === 1;
  } catch {
    // On DB error, fail OPEN (allow the reply) — a missed reply is worse than a
    // rare duplicate, and the in-memory Set in each route still suppresses the
    // common same-process retry case.
    return true;
  }
}

/** Release a DM claim (reset replied=false) when the reply ultimately FAILED to
 *  send, so a later redelivery can retry. */
export async function releaseDMClaim(mid: string | null | undefined): Promise<void> {
  if (!mid) return;
  const key = `${DM_CLAIM_PREFIX}${mid}`;
  await prisma.comment.updateMany({ where: { instagramCommentId: key }, data: { replied: false } }).catch(() => {});
}
