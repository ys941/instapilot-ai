import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveBrandId } from "@/lib/brands";
import { brandFromQuery } from "@/lib/brandRequest";
import { validateMediaUrl } from "@/lib/urlSafety";

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

// Cloudinary upload folder, derived from the configured brand name (niche-neutral).
const UPLOAD_FOLDER = ((process.env.BRAND_NAME || "instapilot").toLowerCase().replace(/[^a-z0-9]/g, "") + "-uploads");

// Server-side multipart cap. Large files should upload DIRECTLY to Cloudinary from
// the browser (see GET below + the media page), which bypasses this entirely — the
// server then only receives the resulting URL as JSON.
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

// ── GET /api/upload  → Cloudinary config for direct browser uploads ────────────
// Returns the cloud name + UNSIGNED upload preset so the browser can upload large
// media straight to Cloudinary (no server body-size / memory limit). The unsigned
// preset is safe to expose to the client by design.
export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    success: true,
    cloudName:    process.env.CLOUDINARY_CLOUD_NAME?.trim()    || null,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET?.trim() || null,
    folder:       UPLOAD_FOLDER,
  });
}

interface NormalizedUpload {
  publicUrl: string;
  isVideo:   boolean;
  fileName:  string;
  title:     string;
  caption:   string;
  hashtags:  string;
  postType:  string;
  scheduledForRaw: string;
  quizAnswer: string;
  platform:  "instagram" | "youtube" | "both";
  brandRaw:  string | null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";
    let n: NormalizedUpload;

    // ── Path A: pre-uploaded media (browser → Cloudinary direct) → JSON body ──────
    // The big win: the file never passes through this server, so a 125 MB video no
    // longer crashes `request.formData()` with "Failed to parse body as FormData".
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => null);
      const publicUrl = (body?.mediaUrl ?? "").toString().trim();
      if (!publicUrl) {
        return NextResponse.json({ success: false, error: "No mediaUrl provided" }, { status: 400 });
      }
      // SSRF guard: the server later fetches this URL at publish time. Only accept
      // URLs on the media host-allowlist; reject private/link-local targets.
      const urlCheck = validateMediaUrl(publicUrl);
      if (!urlCheck.ok) {
        return NextResponse.json({ success: false, error: `Rejected mediaUrl: ${urlCheck.reason}` }, { status: 400 });
      }
      const fileType = (body?.fileType ?? "").toString();
      const isVideo  = fileType.startsWith("video/") || /\.(mp4|mov|webm)(\?|$)/i.test(publicUrl);
      const platformRaw = (body?.platform ?? "instagram").toString();
      n = {
        publicUrl,
        isVideo,
        fileName:  (body?.fileName ?? "media").toString(),
        title:     (body?.title ?? "").toString(),
        caption:   (body?.caption ?? "").toString(),
        hashtags:  (body?.hashtags ?? "").toString(),
        postType:  (body?.postType ?? (isVideo ? "REEL" : "EDUCATIONAL")).toString(),
        scheduledForRaw: (body?.scheduledFor ?? "").toString(),
        quizAnswer: (body?.quizAnswer ?? "").toString(),
        platform:  (["instagram", "youtube", "both"].includes(platformRaw) ? platformRaw : "instagram") as NormalizedUpload["platform"],
        brandRaw:  (body?.brand ?? "").toString().trim() || brandFromQuery(request),
      };
    } else {
      // ── Path B: legacy multipart upload (small files / no Cloudinary config) ────
      const formData    = await request.formData();
      const file        = formData.get("file") as File | null;
      const platformRaw = (formData.get("platform") as string | null) ?? "instagram";

      if (!file) {
        return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
      }
      const ext = ALLOWED[file.type];
      if (!ext) {
        return NextResponse.json(
          { success: false, error: `Unsupported file type: ${file.type}. Allowed: JPG, PNG, WebP, GIF, MP4, MOV, WebM` },
          { status: 400 }
        );
      }
      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { success: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max for direct server upload is 100 MB — larger files upload straight to the cloud from your browser.` },
          { status: 413 }
        );
      }

      const bytes        = await file.arrayBuffer();
      const uniqueName   = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const isVideo      = file.type.startsWith("video/");
      const resourceType = isVideo ? "video" : "image";
      const cloudName    = process.env.CLOUDINARY_CLOUD_NAME?.trim();
      const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
      let publicUrl: string | null = null;

      if (cloudName && uploadPreset) {
        try {
          const uploadForm = new FormData();
          uploadForm.append("file",          new Blob([bytes], { type: file.type }), uniqueName);
          uploadForm.append("upload_preset", uploadPreset);
          uploadForm.append("folder",        UPLOAD_FOLDER);
          const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, { method: "POST", body: uploadForm });
          const d = await r.json();
          if (d.secure_url) { publicUrl = d.secure_url as string; console.log(`[Upload] Cloudinary ${resourceType} URL: ${publicUrl}`); }
          else console.warn("[Upload] Cloudinary upload failed:", d.error?.message ?? JSON.stringify(d).slice(0, 200));
        } catch (e: any) { console.warn("[Upload] Cloudinary error:", e?.message); }
      }
      if (!publicUrl) {
        const uploadsDir = join(process.cwd(), "public", "uploads");
        if (!existsSync(uploadsDir)) await mkdir(uploadsDir, { recursive: true });
        await writeFile(join(uploadsDir, uniqueName), Buffer.from(bytes));
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        publicUrl = `${appUrl}/uploads/${uniqueName}`;
        console.log(`[Upload] Local fallback URL: ${publicUrl}`);
      }

      n = {
        publicUrl: publicUrl!, isVideo, fileName: file.name,
        title:     (formData.get("title")        as string | null) ?? "",
        caption:   (formData.get("caption")      as string | null) ?? "",
        hashtags:  (formData.get("hashtags")     as string | null) ?? "",
        postType:  (formData.get("postType")     as string | null) ?? "EDUCATIONAL",
        scheduledForRaw: (formData.get("scheduledFor") as string | null) ?? "",
        quizAnswer: (formData.get("quizAnswer")  as string | null) ?? "",
        platform:  (["instagram", "youtube", "both"].includes(platformRaw) ? platformRaw : "instagram") as NormalizedUpload["platform"],
        brandRaw:  (formData.get("brand") as string | null)?.trim() || brandFromQuery(request),
      };
    }

    // ── Shared: resolve brand, build the Content-Library post (+ schedule) ─────────
    const resolvedBrandId = await resolveBrandId(n.brandRaw);
    const primaryId       = await resolveBrandId(null);
    const postBrandId     = resolvedBrandId === primaryId ? null : resolvedBrandId;

    const resolvedType = (n.postType as any) in {
      EDUCATIONAL: 1, QUIZ: 1, CAROUSEL: 1, MYTH_FACT: 1, CLINICAL_PEARL: 1,
      CASE_STUDY: 1, ANGIOGRAPHY_QUIZ: 1, ECG_QUIZ: 1, PREVENTIVE: 1, CTA: 1, REEL: 1,
    } ? n.postType : (n.isVideo ? "REEL" : "EDUCATIONAL");

    const hashtagArray = n.hashtags
      .split(/[\s,]+/)
      .map((h) => h.trim().replace(/^#/, ""))
      .filter(Boolean)
      .map((h) => `#${h}`);

    const scheduledFor = n.scheduledForRaw ? new Date(n.scheduledForRaw) : null;
    const postStatus   = scheduledFor ? "SCHEDULED" : "DRAFT";

    const isQuizType    = ["QUIZ", "ECG_QUIZ", "ANGIOGRAPHY_QUIZ"].includes(resolvedType);
    const reelScriptVal = (isQuizType && n.quizAnswer.trim()) ? `QUIZ_ANS:${n.quizAnswer.trim()}` : undefined;

    const post = await prisma.post.create({
      data: {
        userId:      session.user.id,
        type:        resolvedType as any,
        title:       n.title || n.fileName.replace(/\.[^.]+$/, ""),
        content:     n.caption || `Media uploaded on ${new Date().toLocaleDateString()}`,
        hashtags:    hashtagArray,
        mediaUrls:   [n.publicUrl],
        platform:    n.platform,
        brandId:     postBrandId,
        status:      postStatus as any,
        scheduledFor: scheduledFor ?? undefined,
        viralScore:  (() => {
          let score = 0.5;
          if (n.caption && n.caption.length > 50) score += 0.1;
          if (hashtagArray.length >= 10) score += 0.1;
          if (hashtagArray.length >= 20) score += 0.1;
          return Math.min(score, 0.85);
        })(),
        reelScript:  reelScriptVal,
      },
    });

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
            mediaUrl:     n.publicUrl,
            platform:     n.platform,
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

    try {
      await prisma.activityLog.create({
        data: {
          userId:   session.user.id,
          action:   "POST_CREATED",
          entity:   "Post",
          entityId: post.id,
          metadata: { source: "media-folder", fileName: n.fileName, publicUrl: n.publicUrl, scheduled: !!scheduledFor } as any,
        },
      });
    } catch {}

    return NextResponse.json({
      success: true,
      data: {
        post,
        file: { name: n.fileName, url: n.publicUrl, isVideo: n.isVideo },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Upload failed";
    console.error("[Upload] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
