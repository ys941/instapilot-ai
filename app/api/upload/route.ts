import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveBrandId } from "@/lib/brands";
import { brandFromQuery } from "@/lib/brandRequest";

export const dynamic = "force-dynamic";

// Allowed MIME types
const ALLOWED: Record<string, string> = {
  "image/jpeg":  ".jpg",
  "image/jpg":   ".jpg",
  "image/png":   ".png",
  "image/webp":  ".webp",
  "image/gif":   ".gif",
  "video/mp4":   ".mp4",
  "video/quicktime": ".mov",
  "video/webm":  ".webm",
};

const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const formData    = await request.formData();
    const file        = formData.get("file") as File | null;
    const title       = (formData.get("title")        as string | null) ?? "";
    const caption     = (formData.get("caption")      as string | null) ?? "";
    const hashtags    = (formData.get("hashtags")     as string | null) ?? "";
    const postType    = (formData.get("postType")     as string | null) ?? "EDUCATIONAL";
    const scheduledForRaw = (formData.get("scheduledFor") as string | null) ?? "";
    // Optional: quiz answer provided by the user for QUIZ/ECG_QUIZ/ANGIOGRAPHY_QUIZ posts.
    // Stored in reelScript as "QUIZ_ANS:<letter>|<full answer text>" so the comment-reply
    // system can use the correct answer without it appearing in the Instagram caption.
    const quizAnswer  = (formData.get("quizAnswer")  as string | null) ?? "";  // e.g. "B|Atrial Fibrillation"
    // Target platform for this media item: "instagram" (default) | "youtube" | "both".
    const platformRaw = (formData.get("platform")    as string | null) ?? "instagram";
    const platform    = (["instagram", "youtube", "both"].includes(platformRaw)
      ? platformRaw
      : "instagram") as "instagram" | "youtube" | "both";

    // Multi-brand: brand from the `brand` form field OR ?brand= query.
    // Empty/omitted → primary brand. Primary posts keep brandId=null (legacy NULL==primary).
    const brandRaw = (formData.get("brand") as string | null)?.trim() || brandFromQuery(request);
    const resolvedBrandId = await resolveBrandId(brandRaw);
    const primaryId       = await resolveBrandId(null);
    const postBrandId     = resolvedBrandId === primaryId ? null : resolvedBrandId;

    if (!file) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
    }

    // Validate type
    const ext = ALLOWED[file.type];
    if (!ext) {
      return NextResponse.json(
        { success: false, error: `Unsupported file type: ${file.type}. Allowed: JPG, PNG, WebP, GIF, MP4, MOV, WebM` },
        { status: 400 }
      );
    }

    // Validate size
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 100 MB` },
        { status: 400 }
      );
    }

    const bytes      = await file.arrayBuffer();
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const isVideo    = file.type.startsWith("video/");
    const resourceType = isVideo ? "video" : "image";

    // Try Cloudinary first (stable CDN, persists across deploys, trusted by Instagram)
    const cloudName    = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
    let publicUrl: string | null = null;

    if (cloudName && uploadPreset) {
      try {
        const uploadForm = new FormData();
        const blob = new Blob([bytes], { type: file.type });
        uploadForm.append("file",          blob, uniqueName);
        uploadForm.append("upload_preset", uploadPreset);
        uploadForm.append("folder",        ((process.env.BRAND_NAME||"instapilot").toLowerCase().replace(/[^a-z0-9]/g,"")+"-uploads"));
        const r = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
          { method: "POST", body: uploadForm }
        );
        const d = await r.json();
        if (d.secure_url) {
          publicUrl = d.secure_url as string;
          console.log(`[Upload] Cloudinary ${resourceType} URL: ${publicUrl}`);
        } else {
          console.warn("[Upload] Cloudinary upload failed:", d.error?.message ?? JSON.stringify(d).slice(0, 200));
        }
      } catch (e: any) {
        console.warn("[Upload] Cloudinary error:", e?.message);
      }
    }

    // Fallback: local filesystem (dev only — ephemeral on Railway)
    if (!publicUrl) {
      const uploadsDir = join(process.cwd(), "public", "uploads");
      if (!existsSync(uploadsDir)) await mkdir(uploadsDir, { recursive: true });
      const filePath = join(uploadsDir, uniqueName);
      await writeFile(filePath, Buffer.from(bytes));
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      publicUrl = `${appUrl}/uploads/${uniqueName}`;
      console.log(`[Upload] Local fallback URL: ${publicUrl}`);
    }

    // Determine post type
    const resolvedType = (postType as any) in {
      EDUCATIONAL: 1, QUIZ: 1, CAROUSEL: 1, MYTH_FACT: 1, CLINICAL_PEARL: 1,
      CASE_STUDY: 1, ANGIOGRAPHY_QUIZ: 1, ECG_QUIZ: 1, PREVENTIVE: 1, CTA: 1, REEL: 1,
    } ? postType : (isVideo ? "REEL" : "EDUCATIONAL");

    // Parse hashtags
    const hashtagArray = hashtags
      .split(/[\s,]+/)
      .map((h: string) => h.trim().replace(/^#/, ""))
      .filter(Boolean)
      .map((h: string) => `#${h}`);

    // Parse optional scheduled time
    const scheduledFor  = scheduledForRaw ? new Date(scheduledForRaw) : null;
    const postStatus    = scheduledFor ? "SCHEDULED" : "DRAFT";

    // Encode quiz answer into reelScript so comment replies can use it
    // Format: "QUIZ_ANS:<letter>|<full answer text>"  e.g. "QUIZ_ANS:B|Atrial Fibrillation with RVR"
    // This never appears in the Instagram caption — it's internal metadata only.
    const isQuizType   = ["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(resolvedType);
    const reelScriptVal = (isQuizType && quizAnswer.trim())
      ? `QUIZ_ANS:${quizAnswer.trim()}`
      : undefined;

    // Create post in Content Library (DRAFT or SCHEDULED — original media URL preserved, no card generation)
    const post = await prisma.post.create({
      data: {
        userId:      session.user.id,
        type:        resolvedType as any,
        title:       title || file.name.replace(/\.[^.]+$/, ""),
        content:     caption || `Media uploaded on ${new Date().toLocaleDateString()}`,
        hashtags:    hashtagArray,
        mediaUrls:   [publicUrl!],
        platform,
        brandId:     postBrandId,
        status:      postStatus as any,
        scheduledFor: scheduledFor ?? undefined,
        viralScore:  (() => {
          let score = 0.5;
          if (caption && caption.length > 50) score += 0.1;
          if (hashtagArray && hashtagArray.length >= 10) score += 0.1;
          if (hashtagArray && hashtagArray.length >= 20) score += 0.1;
          return Math.min(score, 0.85);
        })(),
        reelScript:  reelScriptVal,
      },
    });

    // If scheduled, also create a ScheduledPost entry so the auto-scheduler picks it up
    if (scheduledFor) {
      try {
        await prisma.scheduledPost.create({
          data: {
            userId:       session.user.id,
            postId:       post.id,
            postType:     resolvedType,
            title:        post.title,
            content:      post.content,
            hashtags:     hashtagArray,
            mediaUrl:     publicUrl!,
            platform,
            brandId:      postBrandId,
            scheduledFor: scheduledFor,
            timezone:     "Asia/Kolkata",
            isRecurring:  false,
            status:       "PENDING",
          },
        });
      } catch (schedErr) {
        console.warn("[Upload] Could not create ScheduledPost entry:", schedErr);
      }
    }

    // Activity log
    try {
      await prisma.activityLog.create({
        data: {
          userId:   session.user.id,
          action:   "POST_CREATED",
          entity:   "Post",
          entityId: post.id,
          metadata: { source: "media-folder", fileName: file.name, fileType: file.type, publicUrl, scheduled: !!scheduledFor } as any,
        },
      });
    } catch {}

    return NextResponse.json({
      success: true,
      data: {
        post,
        file: {
          name:      file.name,
          size:      file.size,
          type:      file.type,
          url:       publicUrl,
          isVideo,
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Upload failed";
    console.error("[Upload] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

