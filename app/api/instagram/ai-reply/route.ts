﻿/**
 * POST /api/instagram/ai-reply
 *
 * Generates an AI-powered reply suggestion for a comment or DM.
 * Called by the analytics dashboard "AI Suggest" button before the user sends.
 *
 * Body (comment):
 *   { type: "comment", commentText: string, username: string, mediaId?: string, postTitle?: string }
 *
 * Body (DM):
 *   { type: "dm", messages: Array<{from,text,time}>, senderUsername: string }
 *
 * Returns: { success: true, data: { reply: string } }
 */

import { NextRequest, NextResponse } from "next/server";
import { PostCommentContext } from "@/lib/grok";
import { getAIClient } from "@/lib/ai-factory";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// -- Extract correct quiz answer from content ----------------------------------
function extractCorrectAnswer(content: string): { letter: string; text: string } | null {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const answerLine = lines.find((l) => /^(answer|correct answer)\s*[:\-]/i.test(l));
  if (!answerLine) return null;
  const body = answerLine
    .replace(/^(answer|correct answer)\s*[:\-]\s*/i, "")
    .replace(/\*\*/g, "")
    .trim();
  const letterMatch = body.match(/^([A-D])[.\-:\s]/i);
  if (!letterMatch) return null;
  return {
    letter: letterMatch[1].toUpperCase(),
    text:   body.replace(/^[A-D][.\-:\s]+/i, "").trim(),
  };
}

// -- Build full PostCommentContext from DB using Instagram media ID ------------
async function buildPostContext(
  mediaId?: string,
  postTitle?: string
): Promise<PostCommentContext> {
  // If no mediaId, fall back to just the title string
  if (!mediaId) return postTitle ? { postTitle } : {};

  try {
    const post = await prisma.post.findFirst({
      where:  { instagramPostId: mediaId },
      select: { type: true, title: true, hook: true, content: true, reelScript: true },
    });

    if (!post) return postTitle ? { postTitle } : {};

    const isQuiz = ["QUIZ", "ECG_QUIZ", "ANGIOGRAPHY_QUIZ"].includes(post.type);
    let correctLetter: string | undefined;
    let correctAnswer: string | undefined;

    if (isQuiz) {
      // Prefer user-supplied answer stored in reelScript as "QUIZ_ANS:B|Atrial Fibrillation"
      if (post.reelScript?.startsWith("QUIZ_ANS:")) {
        const parts = post.reelScript.slice(9).split("|");
        correctLetter = parts[0]?.trim().toUpperCase() || undefined;
        correctAnswer = parts[1]?.trim() || undefined;
      } else if (post.content) {
        // Fallback: parse inline answer from caption
        const parsed = extractCorrectAnswer(post.content);
        correctLetter = parsed?.letter;
        correctAnswer = parsed?.text;
      }
    }

    return {
      postType:      post.type,
      postTitle:     post.title,
      postHook:      post.hook ?? undefined,
      correctLetter,
      correctAnswer,
    };
  } catch {
    return postTitle ? { postTitle } : {};
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { type } = body as { type: "comment" | "dm" };

    if (!type || !["comment", "dm"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "type must be 'comment' or 'dm'", data: null },
        { status: 400 }
      );
    }

    const ai = await getAIClient("reply");
    let reply = "";

    if (type === "comment") {
      const { commentText, username, mediaId, postTitle } = body as {
        commentText: string;
        username:    string;
        mediaId?:    string;
        postTitle?:  string;
      };

      if (!commentText || !username) {
        return NextResponse.json(
          { success: false, error: "commentText and username are required", data: null },
          { status: 400 }
        );
      }

      // Fetch full post context (type, hook, quiz answer) from DB via mediaId
      const postCtx: PostCommentContext = await buildPostContext(mediaId, postTitle);

      console.log(`[AI Reply] Comment from @${username} on post ${mediaId ?? "unknown"}  -  type: ${postCtx.postType ?? "unknown"}, quiz: ${!!postCtx.correctLetter}`);

      reply = await ai.generateCommentReply(commentText, username, postCtx);
    } else {
      // DM
      const { messages, senderUsername } = body as {
        messages:       Array<{ from: string; text: string; time: string }>;
        senderUsername: string;
      };

      if (!messages?.length || !senderUsername) {
        return NextResponse.json(
          { success: false, error: "messages and senderUsername are required", data: null },
          { status: 400 }
        );
      }

      reply = await ai.generateDMReply(messages, senderUsername);
    }

    return NextResponse.json({ success: true, error: null, data: { reply } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "AI reply generation failed";
    console.error("[AI Reply] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

