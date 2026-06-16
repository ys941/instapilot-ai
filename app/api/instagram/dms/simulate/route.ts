/**
 * POST /api/instagram/dms/simulate
 * Inserts a fake DM_RECEIVED entry into ActivityLog so the UI can be tested
 * without a real Meta Conversations API connection.
 * Only available in development or when ALLOW_DM_SIMULATE=true.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { incrementWebhookCounter } from "@/lib/webhookCounter";
import { getBrand } from "@/lib/preferences";
import { BrandConfig } from "@/lib/brandConfig";

const ADJECTIVES = ["curious", "excited", "grateful", "hopeful", "new"];

/** Generic, niche-aware sample DMs for the dev simulator. */
function sampleQuestions(brand: BrandConfig): string[] {
  const niche = brand.niche;
  return [
    `Hey! Just found your account — love your ${niche} content. Where should a beginner start?`,
    `Hi! Quick question about ${niche} — do you have a post that covers the basics?`,
    `Your last post was so helpful. Got any tips for someone just getting into ${niche}?`,
    `Can you recommend what to focus on first when it comes to ${niche}?`,
    `I keep seeing conflicting advice about ${niche} online. What's the real deal?`,
    `Loved your latest reel! What made you start sharing ${niche} content?`,
    `Do you take collab requests? I run a small page about ${niche} too.`,
    `Honestly your account is the best ${niche} resource I've found. Thank you!`,
  ];
}

export async function POST(request: NextRequest) {
  // Allow simulate in development OR when explicitly enabled
  const isDev    = process.env.NODE_ENV === "development";
  const allowed  = isDev || process.env.ALLOW_DM_SIMULATE === "true";
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: "DM simulation is only available in development mode" },
      { status: 403 }
    );
  }

  try {
    const body           = await request.json().catch(() => ({}));
    const brand          = await getBrand();
    const QUESTIONS      = sampleQuestions(brand);
    const adj            = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const senderUsername = (body.username as string | undefined) ?? `${adj}_follower_${Math.floor(Math.random() * 9999)}`;
    const text           = (body.text     as string | undefined) ?? QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    const senderId       = `sim_${Date.now()}`;

    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) {
      return NextResponse.json({ success: false, error: "No user in DB" }, { status: 500 });
    }

    const log = await prisma.activityLog.create({
      data: {
        userId:   user.id,
        action:   "DM_RECEIVED",
        entity:   "DirectMessage",
        entityId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        metadata: {
          senderId,
          username:   senderUsername,
          text,
          timestamp:  Date.now(),
          replied:    false,
          simulated:  true,
        },
      },
    });

    // Increment the webhook counter so the analytics page auto-refetches
    incrementWebhookCounter();

    return NextResponse.json({
      success: true,
      data: {
        id:       log.id,
        from:     senderUsername,
        message:  text,
        note:     "Simulated DM added to ActivityLog. Refresh the DMs panel to see it.",
      },
    });
  } catch (e: any) {
    console.error("[SimulateDM]", e?.message);
    return NextResponse.json({ success: false, error: e?.message ?? "Failed to simulate DM" }, { status: 500 });
  }
}
