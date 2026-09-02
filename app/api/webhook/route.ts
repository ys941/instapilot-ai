import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { PostCommentContext } from "@/lib/grok";
import { getAIClient } from "@/lib/ai-factory";
import { incrementWebhookCounter, notifEmitter, LiveNotif, markWebhookActive } from "@/lib/webhookCounter";
import { resolveQuizAnswer } from "@/lib/catchup";
import { claimCommentForReply, releaseCommentClaim, markCommentReplied } from "@/lib/commentClaim";
import { claimDMForReply, releaseDMClaim } from "@/lib/dmClaim";
import { notifyWebhookIssue, notifySystemError } from "@/lib/notifier";
import { getBrand } from "@/lib/preferences";

// Require the verify token from env — never embed a guessable default in source.
// If unset, verification will fail (handled in GET) and we log an error there.
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN ?? "";
const APP_SECRET    = process.env.FACEBOOK_APP_SECRET ?? "";
const GRAPH_BASE    = "https://graph.facebook.com/v25.0";
const PAGE_ID       = process.env.FACEBOOK_PAGE_ID ?? "";
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";

/**
 * Our own Instagram username (lowercase) -- used to skip self-generated comments
 * (prevents reply loops). Resolved from the active brand's handle, falling back to
 * the legacy INSTAGRAM_USERNAME env var. Cached briefly via getBrand().
 */
async function resolveOwnUsername(): Promise<string> {
  try {
    const brand = await getBrand();
    const handle = (brand.persona.handle || "").replace(/^@/, "").toLowerCase().trim();
    if (handle) return handle;
  } catch { /* fall through to env */ }
  return (process.env.INSTAGRAM_USERNAME ?? "").toLowerCase();
}

// -- Extract correct answer from quiz post content ----------------------------
function extractCorrectAnswer(content: string): { letter: string; text: string } | null {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  // Match "Answer: C - ..." or "Correct answer: B. ..."
  const answerLine = lines.find((l) => /^(answer|correct answer)\s*[:\-]/i.test(l));
  if (!answerLine) return null;
  const body = answerLine.replace(/^(answer|correct answer)\s*[:\-]\s*/i, "").replace(/\*\*/g, "").trim();
  // Extract letter: body starts with "C" or "C." or "C -" or "C:"
  const letterMatch = body.match(/^([A-D])[.\-:\s]/i);
  if (!letterMatch) return null;
  const letter = letterMatch[1].toUpperCase();
  const text   = body.replace(/^[A-D][.\-:\s]+/i, "").trim();
  return { letter, text };
}

// -- Build post comment context -- DB first, then live IG caption fallback ----
// This ensures AI replies are always contextual even when the DB was cleared.
async function getPostCommentContext(mediaId: string): Promise<PostCommentContext> {
  try {
    // -- 1. Try DB first (has richest context: type, hook, quiz answers) ------
    const post = await prisma.post.findFirst({
      where:  { instagramPostId: mediaId },
      select: { type: true, title: true, hook: true, content: true, reelScript: true },
    });
    if (post) {
      // Give quiz posts more content room so all A/B/C/D options are always visible
      const isQuizPost = ["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(post.type);
      const ctx: PostCommentContext = {
        postType:    post.type,
        postTitle:   post.title,
        postHook:    post.hook ?? undefined,
        postContent: post.content ? post.content.slice(0, isQuizPost ? 2000 : 1200) : undefined,
      };
      // Resolve quiz answer — prefer QUIZ_ANS: stored in reelScript (user-supplied),
      // fall back to AI-resolved answer via shared cache
      const isQuiz = ["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(post.type);
      if (isQuiz) {
        if (post.reelScript?.startsWith("QUIZ_ANS:")) {
          const parts = post.reelScript.slice(9).split("|");
          ctx.correctLetter = parts[0]?.trim().toUpperCase() || undefined;
          ctx.correctAnswer = parts[1]?.trim() || undefined;
          console.log(`[Webhook] Quiz answer (stored) for ${mediaId}: ${ctx.correctLetter} – ${ctx.correctAnswer?.slice(0, 60)}`);
        } else if (post.content) {
          const answer = await resolveQuizAnswer(mediaId, post.content);
          if (answer) {
            ctx.correctLetter = answer.correctLetter;
            ctx.correctAnswer = answer.correctAnswer;
            console.log(`[Webhook] Quiz answer (resolved) for ${mediaId}: ${answer.correctLetter} – ${answer.correctAnswer.slice(0, 60)}`);
          }
        }
      }
      return ctx;
    }

    // -- 2. Not in DB -- fetch caption directly from Instagram API ------------
    const token = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
    if (token && mediaId) {
      try {
        const res  = await fetch(
          `${GRAPH_BASE}/${mediaId}?fields=caption,media_type&access_token=${token}`
        );
        const data = await res.json();
        if (!data.error && (data.caption || data.media_type)) {
          const caption = (data.caption ?? "").trim();
          console.log(`[Webhook] Fetched IG caption for ${mediaId}: "${caption.slice(0, 60)}"`);

          // Resolve quiz answer from caption using shared cache
          const isQuizLike =
            /\bA[.)]\s*\w[\s\S]*?\bB[.)]\s*\w/i.test(caption) ||
            /\b(option|choice|quiz|mcq)\b/i.test(caption) ||
            /\bcomment\s+(a|b|c|d)\b|\bdrop.*answer/i.test(caption);

          let correctLetter: string | undefined;
          let correctAnswer: string | undefined;
          if (isQuizLike && caption) {
            const answer = await resolveQuizAnswer(mediaId, caption);
            if (answer) {
              correctLetter = answer.correctLetter;
              correctAnswer = answer.correctAnswer;
            }
          }

          return {
            postType:     data.media_type ?? "IMAGE",
            postTitle:    caption.slice(0, 300) || `Post on @${await resolveOwnUsername()}`,
            postContent:  caption || undefined,
            correctLetter,
            correctAnswer,
          };
        }
      } catch {
        // network error -- fall through to empty context
      }
    }
  } catch { /* ignore */ }

  return {};
}

// -- AI reply helpers -- returns null if Groq unavailable (no predefined fallback)
async function generateAICommentReply(
  commentText: string,
  username: string,
  postContext: PostCommentContext
): Promise<string | null> {
  try {
    const ai = await getAIClient("reply");
    return await ai.generateCommentReply(commentText, username, postContext);
  } catch (err) {
    console.warn("[Webhook] AI comment reply unavailable -- skipping reply:", String(err));
    return null;
  }
}

async function generateAIDMReply(
  messages: Array<{ from: string; text: string; time: string }>,
  senderUsername: string
): Promise<string | null> {
  try {
    const ai = await getAIClient("reply");
    return await ai.generateDMReply(messages, senderUsername);
  } catch (err) {
    console.warn("[Webhook] AI DM reply unavailable -- skipping reply:", String(err));
    return null;
  }
}

// --- GET: Webhook verification -----------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // Never log the token value — only presence/length + whether it matched.
  console.log(`[Webhook GET] mode: ${mode} | tokenPresent: ${!!token} | tokenLen: ${token?.length ?? 0} | tokenMatches: ${!!WEBHOOK_VERIFY_TOKEN && token === WEBHOOK_VERIFY_TOKEN}`);

  if (!WEBHOOK_VERIFY_TOKEN) {
    console.error("[Webhook GET] WEBHOOK_VERIFY_TOKEN is not set — cannot verify webhook. Set it in env.");
    return NextResponse.json({ success: false, error: "Verification not configured" }, { status: 403 });
  }

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ success: false, error: "Verification failed" }, { status: 403 });
}

// --- Helper: real userId for FK ----------------------------------------------
async function getSystemUserId(): Promise<string | null> {
  try {
    const u = await prisma.user.findFirst({ select: { id: true } });
    return u?.id ?? null;
  } catch { return null; }
}

// --- Helper: safe activity log -----------------------------------------------
async function safeLog(data: { action: string; entity: string; entityId: string; metadata: object }) {
  try {
    const userId = await getSystemUserId();
    if (!userId) return;
    await prisma.activityLog.create({ data: { userId, ...data, metadata: data.metadata as any } });
  } catch { /* best-effort */ }
}

// --- Helper: Page Access Token -----------------------------------------------
// Priority: env var -> /me/accounts exchange -> direct page lookup -> IG token as-is
// /me/accounts works with Facebook User tokens; /{PAGE_ID}?fields=access_token often fails.
async function getPageToken(): Promise<string> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";

  // 1. Prefer explicit long-lived page token from env
  if (process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    return process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  }

  try {
    // 2. Try /me/accounts -- works when token is a Facebook User token
    const accountsRes  = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${token}`);
    const accountsData = await accountsRes.json();
    if (!accountsData.error && (accountsData.data ?? []).length > 0) {
      const page = (accountsData.data as Array<{ id: string; access_token: string }>)
        .find((p) => p.id === PAGE_ID) ?? accountsData.data[0];
      if (page?.access_token) return page.access_token;
    }
    // 3. Legacy fallback: /{PAGE_ID}?fields=access_token
    const directRes  = await fetch(`${GRAPH_BASE}/${PAGE_ID}?fields=access_token&access_token=${token}`);
    const directData = await directRes.json();
    if (!directData.error && directData.access_token) return directData.access_token;
  } catch { /* network error */ }

  // 4. Use whatever token we have
  return token;
}

// --- Helper: like a comment via Instagram Graph API --------------------------
async function likeComment(commentId: string): Promise<boolean> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
  try {
    const params = new URLSearchParams({ access_token: token });
    const res  = await fetch(`${GRAPH_BASE}/${commentId}/likes`, {
      method: "POST",
      body:   params,
    });
    const data = await res.json();
    if (data.error) {
      console.warn("[Webhook] Like comment error:", data.error.message);
      return false;
    }
    console.log("[Webhook] Liked comment:", commentId);
    return true;
  } catch (err) {
    console.warn("[Webhook] likeComment exception:", err);
    return false;
  }
}

// --- Helper: decide whether we should like a comment -------------------------
// Likes genuine, positive, or engaged comments. Skips spam and negativity.
function shouldLikeComment(text: string): boolean {
  const t = text.toLowerCase().trim();

  // Skip if too short / single char (just "A" "B" or emoji-only quiz guesses)
  if (t.length < 3) return false;

  // Skip obvious spam / promotional patterns
  const spamPatterns = /follow (me|back|for follow)|dm me|check (my|out my)|f4f|l4l|visit my|link in bio|buy (followers|likes)|promo|advertisement/i;
  if (spamPatterns.test(text)) return false;

  // Skip purely negative / hateful sentiment
  const negativePatterns = /\b(hate|terrible|worst|useless|fake|scam|spam|stupid|idiot|garbage|nonsense)\b/i;
  if (negativePatterns.test(text)) return false;

  // Always like: positive/engaged comments (word patterns + common reaction emojis)
  // Emojis: ❤ = heart, \u{1F525} = fire, \u{1F4AF} = 100, \u{1F44D} = thumbs up,
  //         \u{1F60D} = heart eyes, \u{1F64C} = raising hands, \u{1F4AA} = muscle
  const positivePatterns = new RegExp(
    "(love|amazing|great|awesome|helpful|thank|appreciate|brilliant|excellent|" +
    "wow|congrat|well done|impressive|insightful|informative|learned|useful|" +
    "keep (it|going|up)|more (of this|please)|need more|saved|sharing|" +
    "❤|\u{1F525}|\u{1F4AF}|\u{1F44D}|\u{1F60D}|\u{1F64C}|\u{1F4AA})",
    "iu"
  );
  if (positivePatterns.test(text)) return true;

  // Like: genuine educational engagement (questions, guesses, opinions)
  const engagedPatterns = /\b(what|why|how|when|which|who|is it|i think|i believe|my answer|option|because|since|based on)/i;
  if (engagedPatterns.test(text)) return true;

  // Like any reasonably long comment (genuine engagement, even if neutral)
  if (t.length > 40) return true;

  // Default: like short-medium comments that passed all spam/negative checks
  return true;
}

// --- Helper: reply to a comment -- returns the new reply's Instagram comment ID
async function replyToComment(commentId: string, message: string): Promise<string | null> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
  try {
    const params = new URLSearchParams({ message, access_token: token });
    const res  = await fetch(`${GRAPH_BASE}/${commentId}/replies`, {
      method: "POST",
      body:   params,
    });
    const data = await res.json();
    if (data.error) {
      console.error("[Webhook] Comment reply error:", data.error.message);
      return null;
    }
    console.log("[Webhook] Comment replied:", commentId, "-> reply id:", data.id);
    return data.id as string ?? null;
  } catch (err) {
    console.error("[Webhook] replyToComment exception:", err);
    return null;
  }
}

// --- Helper: send a DM -------------------------------------------------------
async function sendDmReply(recipientIgsid: string, text: string): Promise<boolean> {
  try {
    const pageToken = await getPageToken();
    const res = await fetch(`${GRAPH_BASE}/${PAGE_ID}/messages`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient:    { id: recipientIgsid },
        message:      { text },
        access_token: pageToken,
      }),
    });
    const data = await res.json();
    if (data.error) {
      console.error("[Webhook] DM reply error:", data.error.message);
      return false;
    }
    console.log("[Webhook] DM auto-reply sent to:", recipientIgsid);
    return true;
  } catch (err) {
    console.error("[Webhook] sendDmReply exception:", err);
    return false;
  }
}

// --- Phase 1: Fast synchronous log + SSE push (runs BEFORE 200 is returned) --
// Saves the comment/DM to DB and emits SSE notification immediately.
// This ensures the notification panel and activity feed update within 2 s,
// even before the AI reply is generated (which happens in processWebhookEvent).
async function quickLogWebhookEvent(body: any): Promise<void> {
  try {
    if (body.object !== "instagram" && body.object !== "page") return;
    const OWN_USERNAME = await resolveOwnUsername();

    for (const e of body.entry ?? []) {
      // -- Comments ----------------------------------------------------------
      for (const change of e.changes ?? []) {
        const { field, value } = change;
        if (field !== "comments" || !value?.comment_id) continue;

        const username    = value.from?.username ?? "friend";
        const commentText = value.text ?? "";
        const isOwnComment =
          (value.from?.id && (value.from.id === PAGE_ID || value.from.id === IG_ACCOUNT_ID)) ||
          username.toLowerCase() === OWN_USERNAME;
        if (isOwnComment) continue;

        // Save comment to DB immediately
        try {
          await prisma.comment.upsert({
            where:  { instagramCommentId: value.comment_id },
            update: {},
            create: {
              instagramCommentId: value.comment_id,
              postId:    null,
              mediaId:   value.media_id ?? null,
              username,
              text:      commentText,
              timestamp: value.timestamp ? new Date(value.timestamp * 1000) : new Date(),
            },
          });
        } catch { /* already exists */ }

        // Mark webhook as active  -  suppresses API polling in runCommentCheck()
        markWebhookActive();

        // Create ActivityLog so SSE DB poll picks it up within 2 s
        await safeLog({
          action:   "COMMENT_RECEIVED",
          entity:   "Comment",
          entityId: value.comment_id,
          metadata: { commentId: value.comment_id, mediaId: value.media_id,
                      text: commentText, username, replied: false },
        });

        // Instant SSE push (works in single-process local dev)
        notifEmitter.emit("notif", {
          id:        value.comment_id,
          type:      "comment",
          message:   "🗨️ New comment on your post",
          detail:    `@${username}: "${commentText.slice(0, 80)}"`,
          entityId:  value.comment_id,
          action:    "COMMENT_RECEIVED",
          createdAt: new Date().toISOString(),
          read:      false,
        } as LiveNotif);
      }

      // -- DMs ---------------------------------------------------------------
      for (const msg of e.messaging ?? []) {
        if (!msg.message?.text) continue;
        const senderId = msg.sender?.id;
        if (senderId === PAGE_ID || senderId === IG_ACCOUNT_ID) continue;

        const payloadUsername = msg.sender?.username ?? msg.sender?.name ?? null;
        const senderUsername  = payloadUsername ?? `user_${String(senderId).slice(-6)}`;
        const text = msg.message.text;

        // Create ActivityLog immediately
        await safeLog({
          action:   "DM_RECEIVED",
          entity:   "DirectMessage",
          entityId: msg.message.mid ?? senderId,
          metadata: { senderId, username: senderUsername, text,
                      timestamp: msg.timestamp, replied: false },
        });

        // Instant SSE push
        notifEmitter.emit("notif", {
          id:        msg.message.mid ?? senderId,
          type:      "dm",
          message:   "💬 New DM received",
          detail:    `@${senderUsername}: "${text.slice(0, 80)}"`,
          entityId:  msg.message.mid ?? senderId,
          action:    "DM_RECEIVED",
          createdAt: new Date().toISOString(),
          read:      false,
        } as LiveNotif);
      }
    }
  } catch (err) {
    // best-effort  -  never block the 200 response
    console.error("[Webhook] quickLog error:", err);
  }
}

// --- Background processor -- runs AFTER 200 is returned to Meta --------------
async function processWebhookEvent(body: {
  object: string;
  entry: Array<{
    id: string;
    time: number;
    changes?: Array<{
      field: string;
      value: {
        media_id?:   string;
        comment_id?: string;
        text?:       string;
        from?:       { id: string; username: string };
        parent_id?:  string;
        timestamp?:  number;
      };
    }>;
    messaging?: Array<{
      sender:    { id: string };
      recipient: { id: string };
      timestamp: number;
      message?:  { mid: string; text: string };
    }>;
  }>;
}): Promise<void> {
  const { object, entry } = body;
  const OWN_USERNAME = await resolveOwnUsername();
  // Accept both "instagram" (IG-specific webhook subscription) and "page"
  // (page-scoped subscription -- Meta sometimes delivers IG messaging events
  // under object="page" when the webhook is configured on a Page subscription).
  if (object !== "instagram" && object !== "page") {
    console.log(`[Webhook] Ignoring unknown object type: ${object}`);
    return;
  }
  console.log(`[Webhook] Processing object="${object}" with ${entry?.length ?? 0} entries`);

  for (const e of entry ?? []) {

    // -- Comments & Mentions --------------------------------------------------
    for (const change of e.changes ?? []) {
      const { field, value } = change;

      if (field === "comments" && value.comment_id) {
        const username    = value.from?.username ?? "friend";
        const commentText = value.text ?? "";

        // Skip our own AI replies -- prevents infinite reply loops
        const isOwnComment =
          (value.from?.id && (value.from.id === PAGE_ID || value.from.id === IG_ACCOUNT_ID)) ||
          username.toLowerCase() === OWN_USERNAME;

        if (isOwnComment) {
          console.log(`[Webhook] Skipping self-comment from @${username}`);
          continue;
        }

        console.log(`[Webhook] Processing comment from @${username}: "${commentText.slice(0, 60)}"`);

        // 1. Save comment to DB
        try {
          await prisma.comment.upsert({
            where:  { instagramCommentId: value.comment_id },
            update: {},
            create: {
              instagramCommentId: value.comment_id,
              postId:    null,
              mediaId:   value.media_id ?? null,
              username,
              text:      commentText,
              timestamp: value.timestamp ? new Date(value.timestamp * 1000) : new Date(),
            },
          });
        } catch { /* already exists -- ok */ }

        // 2. Like the comment (non-blocking)
        if (shouldLikeComment(commentText)) {
          likeComment(value.comment_id).catch(() => {});
        }

        // 2b. Atomic cross-path claim — only ONE path replies. If we don't win the
        // claim, another path (other webhook handler / polling) already handled the
        // reply, so skip reply generation/sending entirely. (Liking still happens.)
        const claimed = await claimCommentForReply(value.comment_id, {
          mediaId:   value.media_id ?? null,
          username,
          text:      commentText,
          timestamp: value.timestamp ? new Date(value.timestamp * 1000) : new Date(),
        });
        if (!claimed) {
          console.log(`[Webhook] Comment ${value.comment_id} already claimed by another path — skipping reply`);
          incrementWebhookCounter();
          continue;
        }

        // 3. Fetch post context (type, hook, quiz answer, etc.)
        const postCtx: PostCommentContext = value.media_id
          ? await getPostCommentContext(value.media_id)
          : {};

        // 4. Build thread history for reply-to-reply chains
        if (value.parent_id) {
          try {
            const parent = await prisma.comment.findUnique({
              where:  { instagramCommentId: value.parent_id },
              select: { username: true, text: true, replyText: true, replied: true },
            });
            if (parent) {
              const threadHistory: Array<{ username: string; text: string; fromUs: boolean }> = [];
              const fromUs = parent.username.toLowerCase() === OWN_USERNAME;
              threadHistory.push({ username: parent.username, text: parent.text, fromUs });
              if (!fromUs && parent.replied && parent.replyText) {
                threadHistory.push({ username: OWN_USERNAME, text: parent.replyText, fromUs: true });
              }
              if (threadHistory.length > 0) postCtx.threadHistory = threadHistory;
            }
          } catch { /* best-effort */ }
        }

        // 5. Generate AI reply
        const aiReply = await generateAICommentReply(commentText, username, postCtx);

        let replied = false;
        if (aiReply) {
          console.log(`[Webhook] AI reply for @${username}: "${aiReply.slice(0, 80)}"`);

          // 6. Post reply to Instagram
          // Instagram only supports 2 levels of nesting. If this is a reply to a reply
          // (parent_id is set), we must post to the parent comment ID and @mention the user.
          // Posting to a level-2 comment ID directly will fail or be ignored by the API.
          const isReplyToReply = Boolean(value.parent_id);
          const targetCommentId = isReplyToReply ? value.parent_id! : value.comment_id;
          const replyText = isReplyToReply ? `@${username} ${aiReply}` : aiReply;

          const replyIgId = await replyToComment(targetCommentId, replyText);
          replied = replyIgId !== null;

          if (replied) {
            // 7. Persist the reply text (claim already set replied=true)
            await markCommentReplied(value.comment_id, aiReply);

            // 8. Store our reply row for thread context
            if (replyIgId) {
              await prisma.comment.upsert({
                where:  { instagramCommentId: replyIgId },
                update: {},
                create: {
                  instagramCommentId: replyIgId,
                  postId:    null,
                  mediaId:   value.media_id ?? null,
                  username:  OWN_USERNAME,
                  text:      aiReply,
                  timestamp: new Date(),
                  replied:   true,
                  replyText: aiReply,
                },
              }).catch(() => {});
            }
          } else {
            // Send failed — release the claim so a later run can retry.
            await releaseCommentClaim(value.comment_id);
          }
        } else {
          // No AI reply produced — release the claim so a later run can retry.
          await releaseCommentClaim(value.comment_id);
        }

        // quickLogWebhookEvent already created the COMMENT_RECEIVED ActivityLog and emitted SSE.
        // Only log a separate COMMENT_REPLIED entry here if the AI reply was actually sent.
        if (replied && aiReply) {
          safeLog({
            action:   "COMMENT_REPLIED",
            entity:   "Comment",
            entityId: value.comment_id,
            metadata: { commentId: value.comment_id, mediaId: value.media_id,
                        username, replyText: aiReply },
          }).catch(() => {});
        }

        // Signal the frontend that new engagement data is available
        incrementWebhookCounter();
      }

      // -- @Mentions in comments or captions -----------------------------------
      if (field === "mentions" && value.media_id) {
        console.log(`[Webhook] @mention received on media: ${value.media_id}`);

        // Fetch the comment that contains the mention so we can reply
        if (value.comment_id) {
          const token = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
          try {
            const res  = await fetch(`${GRAPH_BASE}/${value.comment_id}?fields=text,from,timestamp&access_token=${token}`);
            const data = await res.json();
            if (!data.error && data.text) {
              const mentionUsername = data.from?.username ?? "there";

              // Atomic cross-path claim — a comment that ALSO triggers a `comments`
              // webhook (or polling) is replied to by exactly ONE path. Without this
              // gate the mentions branch would send a SECOND reply to the same comment.
              const claimed = await claimCommentForReply(value.comment_id, {
                mediaId:  value.media_id ?? null,
                username: mentionUsername,
                text:     data.text,
              });
              if (!claimed) {
                console.log(`[Webhook] Mention comment ${value.comment_id} already claimed by another path — skipping reply`);
              } else {
                const mentionCtx = await getPostCommentContext(value.media_id);
                const aiReply    = await generateAICommentReply(data.text, mentionUsername, mentionCtx);
                if (aiReply) {
                  const replyId = await replyToComment(value.comment_id, aiReply);
                  if (replyId) {
                    await markCommentReplied(value.comment_id, aiReply);
                    console.log(`[Webhook] Replied to @mention comment: ${value.comment_id} -> ${replyId}`);
                  } else {
                    // Send failed — release the claim so a later path can retry.
                    await releaseCommentClaim(value.comment_id);
                  }
                } else {
                  // No AI reply produced — release the claim so a later path can retry.
                  await releaseCommentClaim(value.comment_id);
                }
              }
            }
          } catch (err) {
            console.warn("[Webhook] Mention reply error:", err);
          }
        }

        safeLog({
          action: "MENTION_RECEIVED", entity: "Mention",
          entityId: value.media_id, metadata: value as any,
        }).catch(() => {});
      }

      // -- Story insights (fires when story expires after 24h) ----------------
      if (field === "story_insights" && value.media_id) {
        console.log(`[Webhook] Story insights received for media: ${value.media_id}`);
        safeLog({
          action:   "STORY_INSIGHTS",
          entity:   "Story",
          entityId: value.media_id,
          metadata: value as any,
        }).catch(() => {});
      }
    }

    // -- Direct Messages -------------------------------------------------------
    for (const msg of e.messaging ?? []) {
      // -- Message reactions (emoji reacts on DMs) -- just log ----------------
      if ((msg as any).reaction) {
        const reaction = (msg as any).reaction;
        console.log(`[Webhook] DM reaction from ${msg.sender.id}: ${reaction.emoji} (${reaction.action})`);
        safeLog({
          action: "DM_REACTION", entity: "DirectMessage",
          entityId: reaction.mid ?? msg.sender.id,
          metadata: { senderId: msg.sender.id, emoji: reaction.emoji, action: reaction.action },
        }).catch(() => {});
        continue;
      }

      if (!msg.message?.text) continue;
      const senderId = msg.sender.id;
      const text     = msg.message.text;

      // Skip messages sent by our own Page/IG account (echo events)
      if (senderId === PAGE_ID || senderId === IG_ACCOUNT_ID) {
        console.log(`[Webhook] Skipping echo DM from our own account: ${senderId}`);
        continue;
      }

      // Use username from webhook payload first (Meta includes it directly),
      // fall back to Graph API lookup, then a short friendly label
      const payloadUsername = (msg.sender as any).username ?? (msg.sender as any).name ?? null;
      let senderUsername: string = payloadUsername ?? senderId;
      if (!payloadUsername) {
        try {
          const igToken = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
          if (igToken) {
            const userRes  = await fetch(`${GRAPH_BASE}/${senderId}?fields=username,name&access_token=${igToken}`);
            const userData = await userRes.json();
            if (!userData.error && (userData.username || userData.name)) {
              senderUsername = userData.username ?? userData.name ?? senderId;
            }
          }
        } catch { /* non-fatal */ }
        if (/^\d+$/.test(senderUsername)) {
          senderUsername = `user_${senderUsername.slice(-6)}`;
        }
      }
      console.log(`[Webhook] DM from @${senderUsername} (${senderId}): "${text.slice(0, 60)}"`);

      // quickLogWebhookEvent already created the DM_RECEIVED ActivityLog and emitted SSE.
      // Skip redundant safeLog/emit here to avoid duplicates.
      console.log(`[Webhook] DM from @${senderUsername} (${senderId}): "${text.slice(0, 60)}"`);

      // ATOMIC dedup keyed on the inbound mid — without this, a Meta retry of the
      // same delivery would forward to Make.com (or direct-reply) a SECOND time.
      // Exactly ONE caller wins the claim; the rest skip. Survives restarts.
      const dmMid    = msg.message.mid ?? null;
      const dmClaimed = await claimDMForReply(dmMid, { senderId, username: senderUsername, text });
      if (!dmClaimed) {
        console.log(`[Webhook] DM mid ${dmMid} already claimed by another path — skipping reply`);
        incrementWebhookCounter();
        continue;
      }

      // -- Forward to Make.com webhook for AI reply (no API credit cost) --------
      const makeWebhookUrl = process.env.MAKE_DM_WEBHOOK_URL ?? "";
      if (makeWebhookUrl) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
        fetch(makeWebhookUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderId,
            username:    senderUsername,
            text,
            messageId:   msg.message.mid ?? senderId,
            timestamp:   msg.timestamp,
            // Make.com calls this URL back after replying so we can log DM_AUTO_REPLIED
            callbackUrl: `${appUrl}/api/instagram/dms/callback`,
          }),
        }).catch((err) => {
          console.warn("[Webhook] Make.com forward failed:", err);
          // Forward failed — release the claim so a redelivery can retry.
          releaseDMClaim(dmMid).catch(() => {});
        });
        console.log(`[Webhook] DM forwarded to Make.com for @${senderUsername}`);
      } else {
        // -- Fallback: direct Grok reply if Make.com not configured ------------
        const thread    = [{ from: `@${senderUsername}`, text, time: new Date(msg.timestamp).toISOString() }];
        const aiDmReply = await generateAIDMReply(thread, senderUsername);
        const replyText = aiDmReply ?? (process.env.DM_AUTO_REPLY ?? null);
        if (replyText) {
          const replied = await sendDmReply(senderId, replyText);
          if (replied) {
            console.log(`[Webhook] Direct auto-replied to @${senderUsername}: "${replyText.slice(0, 60)}"`);
            safeLog({
              action: "DM_AUTO_REPLIED", entity: "DirectMessage",
              entityId: msg.message.mid ?? senderId,
              metadata: { recipientId: senderId, username: senderUsername, replyText, aiGenerated: !!aiDmReply },
            }).catch(() => {});
          } else {
            console.warn(`[Webhook] Direct DM reply failed to @${senderUsername}`);
            // Send failed — release the claim so a redelivery can retry.
            await releaseDMClaim(dmMid);
          }
        } else {
          // No reply produced — release the claim so a redelivery can retry.
          await releaseDMClaim(dmMid);
        }
      }

      // Signal the frontend that new engagement data is available
      incrementWebhookCounter();
    }
  }
}

// WEBHOOK_DISABLE_SIGNATURE_CHECK=true bypasses HMAC verification.
// Use ONLY during local dev when you cannot get the correct App Secret.
// NEVER set this in production -- it allows anyone to spoof events.
// Only honoured OUTSIDE production — a bypass flag must never weaken a live deploy.
const DISABLE_SIG_CHECK =
  process.env.WEBHOOK_DISABLE_SIGNATURE_CHECK === "true" &&
  process.env.NODE_ENV !== "production";
if (DISABLE_SIG_CHECK) {
  console.warn("[Webhook] ⚠️  WEBHOOK_DISABLE_SIGNATURE_CHECK=true is ACTIVE — HMAC verification is bypassed for ALL events. This is UNSAFE for production (anyone can spoof events). Unset it as soon as the App Secret is fixed.");
}

// --- POST: Receive events -- acknowledge Meta INSTANTLY, process in background
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Read raw body as ArrayBuffer first so HMAC is computed on the exact bytes
    // Meta received -- avoids any string encoding round-trip issues.
    const arrayBuffer = await request.arrayBuffer();
    const rawBodyBuffer = Buffer.from(arrayBuffer);
    const rawBody = rawBodyBuffer.toString("utf-8"); // for JSON parsing

    // -- X-Hub-Signature-256 verification -------------------------------------
    if (DISABLE_SIG_CHECK) {
      console.warn("[Webhook] ⚠️  Signature check DISABLED (WEBHOOK_DISABLE_SIGNATURE_CHECK=true) -- NOT safe for production");
    } else if (APP_SECRET) {
      const sigHeader = request.headers.get("x-hub-signature-256") ?? "";
      // Compute HMAC on raw bytes (Buffer), not re-encoded string
      const expected = "sha256=" + crypto
        .createHmac("sha256", APP_SECRET)
        .update(rawBodyBuffer)
        .digest("hex");

      let signaturesMatch = false;
      try {
        signaturesMatch = sigHeader.length === expected.length &&
          crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
      } catch { signaturesMatch = false; }

      if (!signaturesMatch) {
        console.error(
          "[Webhook] Signature MISMATCH -- event dropped\n" +
          "  received : " + sigHeader + "\n" +
          "  expected : " + expected + "\n" +
          "  APP_SECRET (last 4): ..." + APP_SECRET.slice(-4) + "  len=" + APP_SECRET.length + "\n" +
          "  Body size: " + rawBodyBuffer.length + " bytes\n" +
          "  FIX: go to Meta App Dashboard -> App Settings -> Basic -> App Secret -> Show\n" +
          "       Copy the EXACT value into .env as FACEBOOK_APP_SECRET=<value>\n" +
          "       OR set WEBHOOK_DISABLE_SIGNATURE_CHECK=true in .env to bypass (dev only)"
        );
        // Alert once per 10 min so we don't spam on every bad ping
        notifyWebhookIssue(
          "Instagram webhook signature verification failed. Incoming events are being dropped. " +
          "Check that FACEBOOK_APP_SECRET in Railway matches your Meta App Dashboard exactly."
        ).catch(() => {});
        return NextResponse.json({ received: true }, { status: 200 });
      }
      console.log("[Webhook] Signature verified -- processing event");
    } else {
      // No secret → we cannot verify ANY payload. Fail CLOSED (mirrors the sibling
      // /api/webhooks/instagram route): never process unverified events, since
      // anyone could forge them. Ack 200 so Meta doesn't enter a retry storm.
      console.warn("[Webhook] ⚠️  FACEBOOK_APP_SECRET NOT SET -- signature CANNOT be verified; REJECTING event (fail-closed). Set FACEBOOK_APP_SECRET to restore webhook processing.");
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const body = JSON.parse(rawBody);
    console.log(`[Webhook] 📨 Event received: object=${body.object} entries=${body.entry?.length ?? 0}`);

    // ── PHASE 1: Instant ops  -  DB save + SSE notification (runs BEFORE 200 is returned)
    // This guarantees the notification panel and activity feed update within 2 s
    // even if the AI processing in Phase 2 takes longer or gets interrupted.
    await quickLogWebhookEvent(body);

    // ── PHASE 2: Slow ops  -  AI reply generation + Instagram API (background, fire-and-forget)
    // Must return 200 to Meta within 5 s; heavy work is deferred.
    void processWebhookEvent(body).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Webhook] Background processing error:", msg);
      notifySystemError({
        title:   "Webhook Processing Crashed",
        detail:  msg,
        rateKey: "webhook_processing_crash",
      }).catch(() => {});
    });

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Webhook error";
    console.error("[Webhook POST] Parse error:", message);
    return NextResponse.json({ received: true }, { status: 200 }); // always 200 to Meta
  }
}
