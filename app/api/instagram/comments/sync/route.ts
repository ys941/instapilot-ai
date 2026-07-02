import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PostCommentContext } from "@/lib/grok";
import { getAIClient } from "@/lib/ai-factory";
import { notifySystemError } from "@/lib/notifier";
import { getBrand } from "@/lib/preferences";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

// Self-author identity — used to skip replying to our OWN comments (prevents loops).
const PAGE_ID       = process.env.FACEBOOK_PAGE_ID ?? "";
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";
const ENV_USERNAME  = (process.env.INSTAGRAM_USERNAME ?? "").toLowerCase();

export const dynamic = "force-dynamic";

// Extract correct quiz answer from post content
function extractCorrectAnswer(content: string): { letter: string; text: string } | null {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const answerLine = lines.find((l) => /^(answer|correct answer)\s*[:\-]/i.test(l));
  if (!answerLine) return null;
  const body = answerLine.replace(/^(answer|correct answer)\s*[:\-]\s*/i, "").replace(/\*\*/g, "").trim();
  const letterMatch = body.match(/^([A-D])[.\-:\s]/i);
  if (!letterMatch) return null;
  return { letter: letterMatch[1].toUpperCase(), text: body.replace(/^[A-D][.\-:\s]+/i, "").trim() };
}

// Returns null if AI is unavailable  -  never sends a predefined reply
async function generateAICommentReply(
  commentText: string,
  username: string,
  postContext: PostCommentContext
): Promise<string | null> {
  try {
    const ai = await getAIClient("reply");
    return await ai.generateCommentReply(commentText, username, postContext);
  } catch (err) {
    console.warn("[Comments/Sync] AI unavailable  -  skipping reply:", String(err));
    return null;
  }
}

export async function GET() {
  try {
    const session = await getServerSession();
    const token   = session?.user?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN || "";
    const igId    = session?.user?.instagramAccountId || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "";

    if (!token || !igId) {
      return NextResponse.json({ success: false, error: "Instagram not configured", data: null }, { status: 422 });
    }

    // Our own usernames (handle + display name) — used to skip replying to our OWN
    // comments. Built from the active brand + the legacy env var for compatibility.
    const brand = await getBrand();
    const ownUsernames = new Set(
      [
        ENV_USERNAME,
        (brand.persona.handle || "").replace(/^@/, "").toLowerCase().trim(),
        (brand.persona.displayName || "").toLowerCase().trim(),
      ].filter(Boolean)
    );

    // Get last 20 published posts  -  include type, hook, content, reelScript for AI quiz context
    const posts = await prisma.post.findMany({
      where: { status: "PUBLISHED", instagramPostId: { not: null } },
      select: { id: true, instagramPostId: true, title: true, type: true, hook: true, content: true, reelScript: true },
      orderBy: { publishedAt: "desc" },
      take: 20,
    });

    let newCount     = 0;
    let repliedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const post of posts) {
      if (!post.instagramPostId) continue;

      // Build full post context for AI (prefers QUIZ_ANS: from reelScript, falls back to caption parse)
      const isQuiz = ["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(post.type);
      let correctLetter: string | undefined;
      let correctAnswer: string | undefined;
      if (isQuiz) {
        if ((post as any).reelScript?.startsWith("QUIZ_ANS:")) {
          const parts = (post as any).reelScript.slice(9).split("|");
          correctLetter = parts[0]?.trim().toUpperCase() || undefined;
          correctAnswer = parts[1]?.trim() || undefined;
        } else if (post.content) {
          const parsed = extractCorrectAnswer(post.content);
          correctLetter = parsed?.letter;
          correctAnswer = parsed?.text;
        }
      }
      const postCtx: PostCommentContext = {
        postType:      post.type,
        postTitle:     post.title,
        postHook:      post.hook ?? undefined,
        correctLetter,
        correctAnswer,
      };

      try {
        const res  = await fetch(
          `${GRAPH_BASE}/${post.instagramPostId}/comments?fields=id,text,username,timestamp,from{id,username}&limit=50&access_token=${token}`
        );
        const data = await res.json();
        if (data.error) { errors.push(`Post ${post.id}: ${data.error.message}`); continue; }

        for (const c of (data.data ?? [])) {
          // NEVER reply to our OWN comments/replies (prevents self-reply loops).
          // Match on IG business account id / Page id / our username.
          const fromId    = c.from?.id ?? "";
          const fromUname = (c.username ?? c.from?.username ?? "").toLowerCase().trim();
          const isOwn =
            (!!fromId && ((!!IG_ACCOUNT_ID && fromId === IG_ACCOUNT_ID) || (!!PAGE_ID && fromId === PAGE_ID))) ||
            (!!fromUname && ownUsernames.has(fromUname));
          if (isOwn) { skippedCount++; continue; }

          const existing = await prisma.comment.findUnique({ where: { instagramCommentId: c.id } });

          if (!existing) {
            // New comment  -  save to DB first
            await prisma.comment.create({
              data: {
                instagramCommentId: c.id,
                postId:    post.id,
                mediaId:   post.instagramPostId,
                username:  c.username ?? "unknown",
                text:      c.text     ?? "",
                timestamp: new Date(c.timestamp),
              },
            });
            newCount++;

            // Generate AI reply  -  full post context + quiz answer verification
            const aiReply = await generateAICommentReply(
              c.text    ?? "",
              c.username ?? "friend",
              postCtx
            );

            if (aiReply) {
              const params   = new URLSearchParams({ message: aiReply, access_token: token });
              const replyRes = await fetch(`${GRAPH_BASE}/${c.id}/replies`, { method: "POST", body: params });
              const replyData = await replyRes.json();
              if (!replyData.error) {
                await prisma.comment.updateMany({
                  where: { instagramCommentId: c.id },
                  data:  { replied: true, replyText: aiReply },
                });
                repliedCount++;
                console.log(`[Comments/Sync] AI reply sent to @${c.username}: "${aiReply.slice(0, 60)}..."`);
              } else {
                errors.push(`Reply to ${c.id}: ${replyData.error.message}`);
              }
            } else {
              skippedCount++;
              console.log(`[Comments/Sync] Skipped reply to @${c.username}  -  AI unavailable`);
            }

            // Activity log
            const userId = session?.user?.id;
            if (userId) {
              await prisma.activityLog.create({
                data: {
                  userId,
                  action:   "COMMENT_RECEIVED",
                  entity:   "Comment",
                  entityId: c.id,
                  metadata: {
                    commentId: c.id,
                    mediaId:   post.instagramPostId,
                    username:  c.username,
                    text:      c.text,
                    replied:   repliedCount > 0,
                  },
                },
              }).catch(() => {});
            }

          } else if (!existing.replied) {
            // Already in DB but no reply yet  -  try AI reply now
            const aiReply = await generateAICommentReply(
              existing.text     ?? "",
              existing.username ?? "friend",
              postCtx
            );

            if (aiReply) {
              const params    = new URLSearchParams({ message: aiReply, access_token: token });
              const replyRes  = await fetch(`${GRAPH_BASE}/${c.id}/replies`, { method: "POST", body: params });
              const replyData = await replyRes.json();
              if (!replyData.error) {
                await prisma.comment.updateMany({
                  where: { instagramCommentId: c.id },
                  data:  { replied: true, replyText: aiReply },
                });
                repliedCount++;
                console.log(`[Comments/Sync] AI reply (catch-up) sent to @${existing.username}`);
              }
            } else {
              skippedCount++;
            }
          }
        }
      } catch (err: any) {
        errors.push(`Post ${post.id}: ${err?.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { newComments: newCount, repliedCount, skippedCount, errors, syncedAt: new Date().toISOString() },
    });
  } catch (error: any) {
    const msg = error?.message ?? "Comments sync crashed";
    console.error("[Comments/Sync] Outer error:", msg);
    notifySystemError({ title: "Comments Sync Crashed", detail: msg, rateKey: "comments_sync_crash" }).catch(() => {});
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

