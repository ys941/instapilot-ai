/**
 * POST /api/instagram/dms/callback
 *
 * Called by Make.com after it successfully sends an AI DM reply.
 * Logs DM_AUTO_REPLIED to ActivityLog so the dashboard shows the reply.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { senderId, replyText, messageId, success } = body;

    if (!success || !senderId || !replyText) {
      return NextResponse.json({ ok: false, reason: "missing fields" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) return NextResponse.json({ ok: false, reason: "no user" }, { status: 500 });

    await prisma.activityLog.create({
      data: {
        userId:   user.id,
        action:   "DM_AUTO_REPLIED",
        entity:   "DirectMessage",
        entityId: messageId ?? senderId,
        metadata: {
          recipientId: senderId,
          replyText,
          source:      "make",
          aiGenerated: true,
        } as any,
      },
    });

    console.log(`[DM Callback] Logged Make.com reply to ${senderId}: "${replyText.slice(0, 60)}"`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DM Callback] Error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
