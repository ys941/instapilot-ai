/**
 * /api/webhooks/instagram
 *
 * Handles Instagram Graph API webhooks for real-time comment notifications.
 * When a comment arrives, we reply INSTANTLY instead of waiting for the polling loop.
 *
 * Setup (one-time):
 *   1. Set WEBHOOK_VERIFY_TOKEN in Railway env vars (any random string you choose)
 *   2. Go to Facebook Developers → your app → Webhooks → Instagram
 *   3. Callback URL: https://your-railway-domain.railway.app/api/webhooks/instagram
 *   4. Verify token: the same string as WEBHOOK_VERIFY_TOKEN
 *   5. Subscribe to: "comments" and "mentions"
 */

export const dynamic = "force-dynamic"; // never cache — webhook must always execute live

import { NextRequest, NextResponse } from "next/server";
import {
  replyToComment,
  resolveQuizAnswer,
  generateAICommentReply,
  generateAIDMReply,
  syncSinglePostInsights,
  getPageToken,
  _repliedCommentIds,
} from "@/lib/catchup";
import { prisma } from "@/lib/prisma";
import { markWebhookActive } from "@/lib/webhookCounter";
import { claimCommentForReply, releaseCommentClaim, markCommentReplied } from "@/lib/commentClaim";
import { claimDMForReply, releaseDMClaim } from "@/lib/dmClaim";
import { transcribeAudio, synthesizeVoiceUrl } from "@/lib/audioReply";
import crypto from "crypto";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

// Compute the expected HMAC signature for the RAW request bytes using the given
// algorithm. Meta signs the exact bytes it sent, so we must hash the Buffer — NOT
// a UTF-8 re-encoded string (that round-trip is what caused matched=false).
// Returns "<prefix>=<hex>" (e.g. "sha256=ab12…") or null if the secret is unset.
function computeSignature(rawBuffer: Buffer, algo: "sha256" | "sha1"): string | null {
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appSecret) return null;
  return `${algo}=` + crypto.createHmac(algo, appSecret).update(rawBuffer).digest("hex");
}

// Constant-time compare of a received header against a computed signature.
function signaturesMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── GET: Facebook webhook verification handshake ─────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    console.warn("[Webhook] WEBHOOK_VERIFY_TOKEN not set — verification will fail");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Never log the actual tokens in plaintext — log only presence/length + match.
  console.log(`[Webhook] Verify attempt — mode: ${mode}, tokenPresent: ${!!token}, tokenLen: ${token?.length ?? 0}, tokenMatches: ${token === verifyToken}, challengePresent: ${!!challenge}`);

  if (mode === "subscribe" && token === verifyToken && challenge) {
    console.log("[Webhook] Instagram webhook verified ✅");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn(`[Webhook] Verification failed — tokenPresent: ${!!token}, tokenMatches: ${token === verifyToken}, mode: ${mode}`);
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ── POST: Real-time event handler ─────────────────────────────────────────────
//
// FAIL-CLOSED HMAC POSTURE (with a misconfig escape hatch)
// --------------------------------------------------------
// When FACEBOOK_APP_SECRET is set we trust ONLY signed-and-matching payloads:
//   • signature present + matches  → process normally.
//   • signature present + mismatch → DO NOT process; ack 200 (to avoid Meta
//     retry storms) and log the rejection.
//   • signature missing            → DO NOT process; reject.
// If FACEBOOK_APP_SECRET is NOT set we cannot verify at all — rather than brick
// production replies we PROCESS with a LOUD warning (misconfig escape hatch).
// We always return 200 on a signed-but-bad payload so Meta doesn't hammer us.
export async function POST(request: NextRequest) {
  try {
    // Read the RAW bytes (needed for byte-accurate HMAC) before parsing.
    const rawBuffer = Buffer.from(await request.arrayBuffer());
    const rawBody   = rawBuffer.toString("utf-8"); // for JSON parsing only

    // Meta sends SHA-256 in `x-hub-signature-256`; some integrations/legacy
    // paths use SHA-1 in `x-hub-signature`. Accept either.
    const sig256 = request.headers.get("x-hub-signature-256");
    const sig1   = request.headers.get("x-hub-signature");
    const headerPresent = !!(sig256 || sig1);

    const appSecretSet = !!process.env.FACEBOOK_APP_SECRET;
    const expected256 = computeSignature(rawBuffer, "sha256");
    const expected1   = computeSignature(rawBuffer, "sha1");

    const matched =
      (!!sig256 && !!expected256 && signaturesMatch(sig256, expected256)) ||
      (!!sig1   && !!expected1   && signaturesMatch(sig1,   expected1));

    // One-line diagnostic so the NEXT real event tells us WHY verification fails.
    // Never logs the secret or the full signature — only lengths + booleans.
    console.log(
      `[Webhook] sig-check secretSet=${appSecretSet} headerPresent=${headerPresent} ` +
      `alg=${sig256 ? "sha256" : sig1 ? "sha1" : "none"} ` +
      `recvLen=${(sig256 ?? sig1 ?? "").length} ` +
      `computedLen=${(sig256 ? expected256 : sig1 ? expected1 : "")?.length ?? 0} ` +
      `matched=${matched}`
    );

    if (appSecretSet) {
      // Secret configured → fail closed. Only signed-and-matching payloads pass.
      if (!headerPresent) {
        // No signature at all → almost certainly a scanner/bot, not Meta. Reject.
        console.warn("[Webhook] Rejected POST — FACEBOOK_APP_SECRET set but no X-Hub-Signature header present; skipping processing");
        return NextResponse.json({ error: "Missing signature" }, { status: 401 });
      }
      if (!matched) {
        // Signed but mismatched → spoofed or wrong secret. Skip processing.
        // Ack 200 (not 4xx) so Meta does not enter a retry storm against us.
        console.warn(
          "[Webhook] X-Hub-Signature present but did NOT match FACEBOOK_APP_SECRET — " +
          "skipping processing (fail-closed). Check the sig-check diagnostic above."
        );
        return NextResponse.json({ received: true }, { status: 200 });
      }
    } else {
      // Misconfig escape hatch: can't verify without the secret. Process anyway
      // so production replies don't break, but warn LOUDLY on every event.
      console.warn("[Webhook] ⚠️  FACEBOOK_APP_SECRET NOT SET — signature CANNOT be verified; processing UNVERIFIED payload. Set FACEBOOK_APP_SECRET to enable fail-closed verification.");
    }

    const body = JSON.parse(rawBody);

    // Always respond 200 immediately — Facebook retries if we don't.
    // Process async after responding.
    processWebhookEvent(body).catch((err) =>
      console.error("[Webhook] Background processing error:", err?.message)
    );

    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    return NextResponse.json({ received: true }, { status: 200 });
  }
}

// ── Process webhook event asynchronously ─────────────────────────────────────
async function processWebhookEvent(body: any) {
  if (body.object !== "instagram") return;

  const igToken  = process.env.INSTAGRAM_ACCESS_TOKEN         ?? "";
  const igAcctId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";
  if (!igToken || !igAcctId) return;

  for (const entry of body.entry ?? []) {
    // ── DMs come via entry.messaging[], NOT entry.changes[] ──────────────────
    if (entry.messaging?.length) {
      console.log(`[Webhook] Entry has ${entry.messaging.length} messaging event(s) — entry.id: ${entry.id}`);
    }
    for (const msg of entry.messaging ?? []) {
      await handleDMEvent(msg, igToken, igAcctId);
    }

    // ── Comments, feed, mentions come via entry.changes[] ────────────────────
    for (const change of entry.changes ?? []) {
      if (change.field === "comments") {
        await handleCommentEvent(change.value, igToken, igAcctId);
      } else if (change.field === "story_insights") {
        // Instagram fires this when story/post insights are updated
        const mediaId = change.value?.media_id ?? change.value?.id ?? null;
        console.log(`[Webhook] Story/post insights updated${mediaId ? ` for ${mediaId}` : ""}`);
        if (mediaId) {
          syncSinglePostInsights(mediaId).catch((err: Error) =>
            console.error("[Webhook] Insight sync error:", err?.message)
          );
        }
      } else if (change.field === "mentions") {
        await handleMentionEvent(change.value, igToken, igAcctId);
      } else {
        // Log all fields so we can see exactly what Instagram is sending
        console.log(`[Webhook] Received field: "${change.field}" value:`, JSON.stringify(change.value ?? {}).slice(0, 200));
      }
    }
  }
}

// ── Fetch recent conversation history for a sender (for context-aware replies) ─
// Returns up to ~8 recent messages, newest-first, as { from, text, time }.
async function fetchDMThread(
  senderId: string,
  senderUsername: string,
  pageToken: string,
  igAcctId: string,
): Promise<Array<{ from: string; text: string; time: string }>> {
  try {
    // The `user_id` filter isn't supported here — fetch recent conversations and
    // match the one that includes this sender (same approach as the polling loop).
    const url = `${GRAPH_BASE}/me/conversations?platform=instagram` +
      `&fields=id,participants,messages.limit(12){id,from,message,created_time}` +
      `&limit=25&access_token=${encodeURIComponent(pageToken)}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const data = await res.json();
    if (data.error) {
      console.warn(`[Webhook DM] Could not fetch thread context: ${data.error.message}`);
      return [];
    }
    const convos: any[] = data?.data ?? [];
    const convo = convos.find((c) =>
      (c?.participants?.data ?? []).some((p: any) => p?.id === senderId)
    );
    const msgs: any[] = convo?.messages?.data ?? [];
    return msgs
      .map((m) => ({
        from: m?.from?.id === igAcctId ? `@${process.env.INSTAGRAM_USERNAME ?? "me"}` : senderUsername,
        text: (m?.message ?? "").trim(),
        time: m?.created_time ?? "",
      }))
      .filter((m) => m.text);
  } catch (err: any) {
    console.warn("[Webhook DM] Thread context fetch failed:", err?.message);
    return [];
  }
}

// ── Handle DM via messaging webhook ──────────────────────────────────────────
const _repliedMsgIds = new Set<string>();

async function handleDMEvent(msg: any, igToken: string, igAcctId: string) {
  const senderId    = msg?.sender?.id;
  const recipientId = msg?.recipient?.id;
  const msgId       = msg?.message?.mid;
  let   text        = msg?.message?.text ?? "";

  // Detect a voice note (audio attachment). IG sends DM media as
  // message.attachments[] with type "audio" and payload.url.
  const attachments: any[] = msg?.message?.attachments ?? [];
  const audioAtt   = attachments.find((a) => a?.type === "audio");
  const audioUrl   = audioAtt?.payload?.url ?? null;
  const isVoiceNote = !!audioUrl;

  // Log every DM event so we can see what's arriving
  console.log(`[Webhook DM] sender=${senderId} recipient=${recipientId} mid=${msgId} text="${text.slice(0, 80)}" voice=${isVoiceNote} igAcctId=${igAcctId}`);

  // Accept the message if it has text OR a voice note
  if (!senderId || (!text.trim() && !isVoiceNote)) {
    console.log(`[Webhook DM] Skipping — no senderId, or empty text and no voice note`);
    return;
  }

  // Skip our own outbound messages (echo suppression). Multi-signal, like the
  // comment path: an echo can carry our IG business account id, our Facebook
  // Page id, or our own handle as the sender (incl. voice-note echoes). We do
  // NOT compare against recipientId — that's our own IGSID on inbound DMs and
  // would incorrectly block real users.
  const PAGE_ID      = process.env.FACEBOOK_PAGE_ID ?? "";
  const OWN_USERNAME = (process.env.INSTAGRAM_USERNAME ?? "").toLowerCase();
  const senderUname  = (msg?.sender?.username ?? "").toLowerCase().trim();
  const isOwnDM =
    (!!senderId && ((!!igAcctId && senderId === igAcctId) || (!!PAGE_ID && senderId === PAGE_ID))) ||
    (!!senderUname && !!OWN_USERNAME && senderUname === OWN_USERNAME);
  if (isOwnDM) {
    console.log(`[Webhook DM] Skipping — echo of our own message`);
    return;
  }

  // Genuine inbound (non-self) DM → mark the webhook live so the polling loop
  // can throttle its Instagram API calls.
  markWebhookActive();

  // Dedup by message ID — in-memory fast-path first (cheap same-process filter).
  if (msgId && _repliedMsgIds.has(msgId)) {
    console.log(`[Webhook DM] Skipping — already processed msgId ${msgId}`);
    return;
  }

  // Authoritative ATOMIC claim keyed on the inbound mid. Unlike the previous
  // check-then-act (findFirst across an await), this flips a unique row's
  // replied:false→true in one statement, so on Meta retries / concurrent
  // deliveries exactly ONE caller wins and sends a reply. Survives restarts.
  const claimed = await claimDMForReply(msgId, { senderId, text });
  if (!claimed) {
    console.log(`[Webhook DM] Skipping — msgId ${msgId} already claimed by another path`);
    if (msgId) _repliedMsgIds.add(msgId);
    return;
  }
  if (msgId) _repliedMsgIds.add(msgId);
  setTimeout(() => msgId && _repliedMsgIds.delete(msgId), 24 * 60 * 60 * 1000);

  // NOTE: We intentionally do NOT block per-conversation. Dedup is per-MESSAGE
  // (via _repliedMsgIds above) so every NEW message in an ongoing conversation
  // gets a reply. A permanent per-sender block would reply only once per person
  // and then go silent — which is the bug we are fixing here.

  console.log(`[Webhook DM] ✉️ New DM from ${senderId}: "${text.slice(0, 80)}"${isVoiceNote ? " [voice note]" : ""}`);

  try {
    // Voice note → transcribe it to text so the AI can understand & reply
    if (isVoiceNote && audioUrl) {
      const transcript = await transcribeAudio(audioUrl);
      if (transcript) {
        text = transcript;
      } else if (!text.trim()) {
        // Could not transcribe and no text — reply with a friendly fallback
        text = "(sent a voice message I couldn't quite hear)";
      }
    }

    // Get sender username for context
    let senderUsername = senderId;
    try {
      const profileRes = await fetch(
        `${GRAPH_BASE}/${senderId}?fields=username&access_token=${igToken}`,
        { signal: AbortSignal.timeout(4000) }
      );
      const profile = await profileRes.json();
      if (profile.username) senderUsername = profile.username;
    } catch { /* ignore */ }

    // Instagram Messaging API requires the Facebook PAGE token, not the IG user token
    const pageToken = await getPageToken(igToken);

    // Fetch recent conversation history so the AI replies WITH CONTEXT, not in a
    // vacuum. Newest-first. We then make sure the current (possibly transcribed)
    // message is the latest turn.
    const history = await fetchDMThread(senderId, senderUsername, pageToken, igAcctId);
    const messages = [
      { from: senderUsername, text, time: new Date().toISOString() },
      ...history.filter((m) => m.text?.trim() && m.text.trim() !== text.trim()),
    ].slice(0, 10);
    console.log(`[Webhook DM] Replying with ${messages.length} message(s) of context`);

    const reply = await generateAIDMReply(messages, senderUsername);
    if (!reply) {
      // No reply produced — release the claim so a redelivery can retry.
      await releaseDMClaim(msgId);
      if (msgId) _repliedMsgIds.delete(msgId);
      return;
    }

    // If they sent a VOICE note, reply with a VOICE note too (fall back to text).
    let voiceUrl: string | null = null;
    if (isVoiceNote) {
      voiceUrl = await synthesizeVoiceUrl(reply);
      if (voiceUrl) console.log(`[Webhook DM] Replying with voice note to ${senderUsername}`);
      else console.log(`[Webhook DM] Voice synthesis failed — falling back to text reply`);
    }

    const messageBody = voiceUrl
      ? { attachment: { type: "audio", payload: { url: voiceUrl, is_reusable: false } } }
      : { text: reply };

    const sendRes = await fetch(
      `${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          recipient: { id: senderId },
          message:   messageBody,
        }),
        signal: AbortSignal.timeout(12000),
      }
    );
    let sendData = await sendRes.json();

    // If sending the voice attachment failed, fall back to a text reply
    if (sendData.error && voiceUrl) {
      console.warn(`[Webhook DM] Voice send failed (${sendData.error.message}) — retrying as text`);
      const textRes = await fetch(
        `${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageToken)}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ recipient: { id: senderId }, message: { text: reply } }),
          signal:  AbortSignal.timeout(8000),
        }
      );
      sendData = await textRes.json();
    }

    if (sendData.error) {
      console.warn(`[Webhook] DM send failed: ${sendData.error.message} (code ${sendData.error.code}) — sender: ${senderUsername}`);
      // Send failed — release the claim so a redelivery can retry this mid.
      await releaseDMClaim(msgId);
      if (msgId) _repliedMsgIds.delete(msgId);
    } else {
      console.log(`[Webhook] ✅ Instant DM reply sent to ${senderUsername} (msgId: ${sendData.message_id ?? "?"})`);

      // Log to ActivityLog per INCOMING message (entityId = incoming mid) so the
      // polling loop can tell this specific message was already answered, while
      // still allowing replies to future messages in the same conversation.
      try {
        const user = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
        if (user) {
          await prisma.activityLog.create({
            data: {
              userId:   user.id,
              action:   "DM_AUTO_REPLIED",
              entity:   "DirectMessage",
              entityId: msgId ?? `dm_${senderId}_${Date.now()}`,
              metadata: {
                recipientId:  senderId,
                username:     senderUsername,
                incomingMid:  msgId ?? null,
                messageId:    sendData.message_id ?? null,
                replyText:    reply,
                webhook:      true,
              } as any,
            },
          });
        }
      } catch (logErr: any) {
        console.warn(`[Webhook] ActivityLog write failed (non-fatal): ${logErr?.message}`);
      }
    }
  } catch (err: any) {
    console.error(`[Webhook] DM reply error for ${senderId}:`, err?.message);
    // Unexpected error — release the claim so the mid isn't permanently blocked.
    await releaseDMClaim(msgId);
    if (msgId) _repliedMsgIds.delete(msgId);
  }
}

// ── Handle a single comment event ────────────────────────────────────────────
const _repliedIds = new Set<string>(); // in-memory dedup (resets on restart)

async function handleCommentEvent(value: any, igToken: string, igAcctId: string) {
  const commentId = value?.id;
  const mediaId   = value?.media?.id;
  const fromId    = value?.from?.id;
  const text      = value?.text ?? "";

  if (!commentId || !text.trim()) return;

  // Skip our OWN comments/replies (avoid reply loops). Use the SAME multi-signal
  // check as the polling path — matching on id alone is fragile (the webhook's
  // from.id may be absent or a different id form for our own replies), which would
  // make the bot reply to itself. Match on: IG business account id OR Facebook Page
  // id OR username === our handle.
  const PAGE_ID      = process.env.FACEBOOK_PAGE_ID ?? "";
  const OWN_USERNAME = (process.env.INSTAGRAM_USERNAME ?? "").toLowerCase();
  const fromUname    = (value?.from?.username ?? "").toLowerCase().trim();
  const isOwn =
    (!!fromId && ((!!igAcctId && fromId === igAcctId) || (!!PAGE_ID && fromId === PAGE_ID))) ||
    (!!fromUname && fromUname === OWN_USERNAME);
  if (isOwn) return;

  // Genuine inbound (non-self) comment → mark the webhook live so the polling
  // loop can throttle its Instagram API calls.
  markWebhookActive();

  // Cheap in-memory pre-filter — may fire twice in rare cases. The DB claim below
  // is authoritative; this just avoids redundant work in this process.
  if (_repliedIds.has(commentId)) return;
  _repliedIds.add(commentId);
  // Evict after 24h to prevent unbounded growth
  setTimeout(() => _repliedIds.delete(commentId), 24 * 60 * 60 * 1000);

  // Atomic cross-path claim: only ONE path (webhook/webhook2/polling) wins and
  // actually replies. If we lose the claim, another path already handled it.
  const fromUsername = value?.from?.username ?? "there";
  const claimed = await claimCommentForReply(commentId, {
    mediaId: mediaId ?? null,
    username: fromUsername,
    text,
  });
  if (!claimed) {
    console.log(`[Webhook] Comment ${commentId} already claimed by another path — skipping`);
    return;
  }

  console.log(`[Webhook] New comment on media ${mediaId}: "${text.slice(0, 80)}"`);

  try {
    // Fetch the post caption from IG API + full post context from DB
    let caption = "";
    let postType = "EDUCATIONAL";
    let postTitle: string | undefined;
    let postHook: string | undefined;
    let postContent: string | undefined;

    try {
      // Fetch live caption from Instagram
      const mediaRes  = await fetch(
        `${GRAPH_BASE}/${mediaId}?fields=caption&access_token=${igToken}`,
        { signal: AbortSignal.timeout(5000) },
      );
      const mediaData = await mediaRes.json();
      caption = mediaData.caption ?? "";
    } catch { /* ignore */ }

    try {
      // Fetch full post context from DB (title, hook, content, type)
      const dbPost = await prisma.post.findFirst({
        where:  { instagramPostId: mediaId },
        select: { type: true, title: true, hook: true, content: true, reelScript: true },
      });
      if (dbPost) {
        postType    = dbPost.type ?? postType;
        postTitle   = dbPost.title ?? undefined;
        postHook    = dbPost.hook  ?? undefined;
        postContent = dbPost.content ?? undefined;
        // Extract caption from reelScript if not yet set (stored as "CAPTION: ..." prefix)
        if (!caption && dbPost.reelScript) {
          const capMatch = dbPost.reelScript.match(/^CAPTION:\s*([\s\S]*)/i);
          caption = capMatch ? capMatch[1].trim() : "";
        }
      }
    } catch { /* ignore — reply generically */ }

    // Build context for the AI reply
    const isQuizLike = ["QUIZ", "ECG_QUIZ", "ANGIOGRAPHY_QUIZ"].includes(postType);
    const postCtx: any = {
      postType,
      postTitle,
      postHook,
      postContent: postContent ? postContent.slice(0, 800) : undefined,
      caption,
      mediaId,
    };

    if (isQuizLike) {
      const answer = await resolveQuizAnswer(mediaId, caption);
      if (answer) {
        postCtx.correctLetter  = answer.correctLetter;
        postCtx.correctAnswer  = answer.correctAnswer;
      }
    }

    // Generate AI reply
    const reply = await generateAICommentReply(text, fromUsername, postCtx);
    if (!reply) {
      // No reply to send — release the claim so a later run can retry.
      await releaseCommentClaim(commentId);
      return;
    }

    // Reply instantly
    const ok = await replyToComment(commentId, reply, igToken);
    if (ok) {
      console.log(`[Webhook] ✅ Instant reply sent to comment ${commentId} on media ${mediaId}`);

      // Add to the SHARED polling dedup set so catchup loop won't reply again
      _repliedCommentIds.add(commentId);

      // Persist the reply text (claim already set replied=true).
      await markCommentReplied(commentId, reply);
    } else {
      // Send failed — release the claim so it can be retried later.
      await releaseCommentClaim(commentId);
    }
  } catch (err: any) {
    console.error(`[Webhook] Reply failed for comment ${commentId}:`, err?.message);
    // Release on unexpected error so the comment isn't permanently marked replied.
    await releaseCommentClaim(commentId);
  }
}

// ── Handle an @mention event (comment/caption mention) ───────────────────────
// Ported from app/api/webhook/route.ts: fetch the mentioning comment's text →
// claim it (shared cross-path gate) → generate an AI reply → post it. Reuses the
// same claim/self-filter/reply helpers as handleCommentEvent so a comment that
// fires BOTH a `comments` and a `mentions` webhook is replied to exactly once.
async function handleMentionEvent(value: any, igToken: string, igAcctId: string) {
  const mediaId   = value?.media_id   ?? null;
  const commentId = value?.comment_id ?? null;
  console.log(`[Webhook] Account mentioned — mediaId: ${mediaId ?? "n/a"}, commentId: ${commentId ?? "n/a"}`);

  // We can only reply when the mention is inside a comment we can fetch + reply to.
  if (!commentId) return;

  try {
    // Fetch the comment text + author so we can generate a contextual reply.
    const res  = await fetch(
      `${GRAPH_BASE}/${commentId}?fields=text,from,timestamp&access_token=${igToken}`,
      { signal: AbortSignal.timeout(5000) },
    );
    const data = await res.json();
    if (data.error || !data.text) {
      console.warn(`[Webhook] Could not fetch mention comment ${commentId}: ${data.error?.message ?? "no text"}`);
      return;
    }

    const text = data.text as string;

    // Skip our OWN comments (avoid reply loops) — same multi-signal check as the
    // comment path.
    const PAGE_ID      = process.env.FACEBOOK_PAGE_ID ?? "";
    const OWN_USERNAME = (process.env.INSTAGRAM_USERNAME ?? "").toLowerCase();
    const fromId       = data?.from?.id;
    const fromUname    = (data?.from?.username ?? "").toLowerCase().trim();
    const isOwn =
      (!!fromId && ((!!igAcctId && fromId === igAcctId) || (!!PAGE_ID && fromId === PAGE_ID))) ||
      (!!fromUname && fromUname === OWN_USERNAME);
    if (isOwn) return;

    // Genuine inbound (non-self, fetchable) mention → mark the webhook live.
    // Placed AFTER the self-filter so our own activity never flips the liveness
    // signal (which would suppress the comment poll + skew the digest).
    markWebhookActive();

    const mentionUsername = data?.from?.username ?? "there";

    // Atomic cross-path claim: a comment that ALSO triggers a `comments` webhook
    // (or polling) is replied to by exactly ONE path.
    const claimed = await claimCommentForReply(commentId, {
      mediaId:  mediaId ?? null,
      username: mentionUsername,
      text,
    });
    if (!claimed) {
      console.log(`[Webhook] Mention comment ${commentId} already claimed by another path — skipping`);
      return;
    }

    // Build a light post context (same shape the comment path uses).
    let caption  = "";
    let postType = "EDUCATIONAL";
    let postTitle: string | undefined;
    let postHook: string | undefined;
    let postContent: string | undefined;

    if (mediaId) {
      try {
        const mediaRes  = await fetch(
          `${GRAPH_BASE}/${mediaId}?fields=caption&access_token=${igToken}`,
          { signal: AbortSignal.timeout(5000) },
        );
        const mediaData = await mediaRes.json();
        caption = mediaData.caption ?? "";
      } catch { /* ignore */ }

      try {
        const dbPost = await prisma.post.findFirst({
          where:  { instagramPostId: mediaId },
          select: { type: true, title: true, hook: true, content: true },
        });
        if (dbPost) {
          postType    = dbPost.type ?? postType;
          postTitle   = dbPost.title ?? undefined;
          postHook    = dbPost.hook  ?? undefined;
          postContent = dbPost.content ?? undefined;
        }
      } catch { /* ignore — reply generically */ }
    }

    const postCtx: any = {
      postType,
      postTitle,
      postHook,
      postContent: postContent ? postContent.slice(0, 800) : undefined,
      caption,
      mediaId,
    };

    const reply = await generateAICommentReply(text, mentionUsername, postCtx);
    if (!reply) {
      await releaseCommentClaim(commentId);
      return;
    }

    const ok = await replyToComment(commentId, reply, igToken);
    if (ok) {
      console.log(`[Webhook] ✅ Replied to @mention comment ${commentId} on media ${mediaId}`);
      _repliedCommentIds.add(commentId);
      await markCommentReplied(commentId, reply);
    } else {
      await releaseCommentClaim(commentId);
    }
  } catch (err: any) {
    console.error(`[Webhook] Mention reply error for comment ${commentId}:`, err?.message);
    await releaseCommentClaim(commentId);
  }
}
