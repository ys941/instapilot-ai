/**
 * POST /api/auto-generate
 * Reads auto-post config, generates N posts using AI, and schedules them.
 * Body: { count?: number }    -  override postsPerDay for a manual trigger
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readPreferences } from "@/lib/preferences";
import { wallTimeToUTC } from "@/lib/utils";
import { notifySystemError } from "@/lib/notifier";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body      = await request.json().catch(() => ({}));
    const prefs     = await readPreferences();
    const cfg       = prefs.autoPost;

    if (!cfg.postTypes.length) {
      return NextResponse.json({ success: false, error: "No post types configured for auto-generation" }, { status: 400 });
    }
    if (!cfg.topics.length) {
      return NextResponse.json({ success: false, error: "No topics configured for auto-generation" }, { status: 400 });
    }

    const count = typeof body.count === "number" ? Math.min(body.count, 5) : cfg.postsPerDay;

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    const generated: any[] = [];
    const scheduled: any[] = [];

    for (let i = 0; i < count; i++) {
      // Rotate through post types and topics
      const type  = cfg.postTypes[i % cfg.postTypes.length];
      const topic = cfg.topics[Math.floor(Math.random() * cfg.topics.length)];

      // Generate content via the AI route (re-use existing logic)
      const genRes = await fetch(`${origin}/api/ai/generate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Cookie: request.headers.get("cookie") ?? "" },
        body:    JSON.stringify({ type, tone: "professional", topic }),
      });
      const genData = await genRes.json();
      if (!genData.success) {
        generated.push({ type, topic, error: genData.error });
        continue;
      }

      const content = genData.data;

      // Save as post (draft or scheduled depending on autoPublish)
      const post = await prisma.post.create({
        data: {
          userId,
          type:       type as any,
          title:      content.title || `Auto: ${topic}`,
          content:    content.content,
          hook:       content.hook,
          cta:        content.cta,
          hashtags:   content.hashtags ?? [],
          imagePrompt:content.imagePrompt,
          viralScore: content.viralScore,
          status:     "DRAFT",
        },
      });

      // Schedule it: pick the next available slot
      const now       = new Date();
      const slotIndex = i % cfg.scheduleTimes.length;
      const timeStr   = cfg.scheduleTimes[slotIndex] ?? "08:00";
      const [hh, mm]  = timeStr.split(":").map(Number);
      const tz        = cfg.timezone || "Asia/Kolkata";

      // Start from tomorrow (UTC date)
      const baseDate = new Date(now);
      baseDate.setUTCDate(baseDate.getUTCDate() + 1 + i);

      // Convert HH:MM in the user's timezone (e.g. Asia/Kolkata) to a real UTC Date.
      // IMPORTANT: must NOT use setHours() here — that uses server local time (UTC on Railway)
      // which would create a 5 h 30 min offset for IST users.
      let scheduledFor = wallTimeToUTC(
        baseDate.getUTCFullYear(),
        baseDate.getUTCMonth() + 1,
        baseDate.getUTCDate(),
        hh, mm,
        tz,
      );

      // Skip to a scheduleDays-approved day.
      // Compare weekdays in the user's timezone (not the server's UTC date).
      if (cfg.scheduleDays.length) {
        for (let attempts = 0; attempts < 7; attempts++) {
          // getDay() on a locale string parsed by the server (UTC) gives the correct
          // day-of-week for the wall-clock date seen in the user's timezone.
          const localDateStr  = scheduledFor.toLocaleString("en-US", { timeZone: tz });
          const numericDay    = new Date(localDateStr).getDay(); // 0=Sun…6=Sat
          if (cfg.scheduleDays.includes(numericDay)) break;

          // Advance one calendar day in UTC and recompute the correct UTC timestamp
          baseDate.setUTCDate(baseDate.getUTCDate() + 1);
          scheduledFor = wallTimeToUTC(
            baseDate.getUTCFullYear(),
            baseDate.getUTCMonth() + 1,
            baseDate.getUTCDate(),
            hh, mm,
            tz,
          );
        }
      }

      const scheduledEntry = await prisma.scheduledPost.create({
        data: {
          userId,
          postId:      post.id,
          title:       post.title,
          content:     post.content,
          hashtags:    post.hashtags,
          scheduledFor,
          timezone:    cfg.timezone,
          isRecurring: false,
          status:      "PENDING",
        },
      });

      await prisma.post.update({
        where: { id: post.id },
        data:  { status: "SCHEDULED", scheduledFor },
      });

      generated.push({ type, topic, postId: post.id, title: post.title });
      scheduled.push({ id: scheduledEntry.id, scheduledFor, title: post.title });
    }

    await prisma.activityLog.create({
      data: {
        userId,
        action:   "AUTO_GENERATE",
        entity:   "Post",
        entityId: "bulk",
        metadata: { count, generated: generated.length },
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, data: { generated, scheduled } });
  } catch (e: any) {
    const msg = e?.message ?? "Auto-generate failed";
    console.error("[Auto-Generate]", msg);
    notifySystemError({ title: "Auto-Generate Crashed", detail: msg, rateKey: "auto_generate_crash" }).catch(() => {});
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

