/**
 * lib/imageGenerator.ts
 *
 * Auto-generates a professional medical/cardiology image from a prompt.
 *
 * Image source: Picsum Photos (https://picsum.photos) - free, no API key needed.
 *   Uses topic-based seeds for consistent results per prompt.
 *   Images are downloaded and re-hosted on a stable CDN for Instagram.
 *
 * Upload priority:
 *   1. Cloudinary (unsigned upload - set CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET)
 *   2. catbox.moe (free CDN, no key needed - reliable Instagram-compatible URLs)
 *   3. Local public/uploads/ (only when NEXT_PUBLIC_APP_URL is a real domain)
 *
 * Note: Pollinations.ai removed their free tier (now returns HTTP 402).
 *
 * For AI-generated cardiology images, configure one of:
 *   - Stability AI: STABILITY_API_KEY (25 free credits/day)
 *   - OpenAI DALL-E: OPENAI_API_KEY
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import crypto from "crypto";

// -- Cloudinary delete - removes asset after Instagram publish to save storage --
/**
 * Deletes a Cloudinary asset (image OR video) by its URL.
 * Requires CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET in .env.local.
 * Safe to call even if those vars are missing - it just warns and skips.
 * Cloudinary namespaces destroy by resource type, so a video public_id sent to
 * /image/destroy just returns "not found" and the video lingers forever. The
 * resource type is sniffed from the delivery URL ("/video/upload/" vs image)
 * so existing call sites get the right endpoint automatically; pass
 * `resourceType` explicitly to override.
 */
export async function deleteFromCloudinary(url: string, resourceType?: "image" | "video"): Promise<void> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey    = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (!cloudName || !apiKey || !apiSecret) {
    console.warn("[Cloudinary] Delete skipped - CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET not set in .env.local");
    return;
  }
  if (!url.includes("res.cloudinary.com")) return; // not a Cloudinary URL - skip

  // Videos (uploaded via /video/upload, e.g. uploadVideoToStableCdn + voice
  // replies) must be destroyed via /video/destroy - default to image otherwise.
  const type = resourceType ?? (url.includes("/video/upload/") ? "video" : "image");

  try {
    // Extract public_id from URL
    // Handles all URL formats:
    //   Basic:     .../upload/v123456/folder/image.jpg
    //   Transform: .../upload/c_fill,w_1080/v123456/folder/image.jpg
    //   Multi-seg: .../upload/c_fill,w_1080,h_1080/q_auto/v123456/folder/image.jpg
    const uploadIndex = url.indexOf("/upload/");
    if (uploadIndex === -1) return;

    let path = url.slice(uploadIndex + 8); // everything after "/upload/"
    // Strip Cloudinary transformation segments (e.g. "c_fill,w_1080/" or "q_auto/")
    // A transformation segment contains at least one underscore-prefixed param (a_b or a_b,c_d)
    path = path.replace(/^([a-z]{1,2}_[^/]+\/)+/, "");
    // Strip version prefix "v1234567890/"
    path = path.replace(/^v\d+\//, "");
    // Strip file extension
    const dotIndex = path.lastIndexOf(".");
    const publicId = dotIndex !== -1 ? path.slice(0, dotIndex) : path;

    console.log("[Cloudinary] Attempting to delete " + type + " public_id: " + publicId);

    // Build signed request
    const timestamp = Math.round(Date.now() / 1000).toString();
    const paramsToSign = "public_id=" + publicId + "&timestamp=" + timestamp;
    const signature = crypto
      .createHash("sha1")
      .update(paramsToSign + apiSecret)
      .digest("hex");

    const body = new URLSearchParams({
      public_id: publicId,
      signature,
      api_key:   apiKey,
      timestamp,
    });

    const res  = await fetch("https://api.cloudinary.com/v1_1/" + cloudName + "/" + type + "/destroy", {
      method: "POST",
      body,
    });
    const data = await res.json();

    if (data.result === "ok") {
      console.log("[Cloudinary] Deleted: " + publicId);
    } else if (data.result === "not found") {
      console.log("[Cloudinary] Already deleted or not found: " + publicId + " (safe to ignore)");
    } else {
      console.warn("[Cloudinary] Delete failed for " + publicId + ":", data.result ?? data.error?.message, data);
    }
  } catch (err: any) {
    console.warn("[Cloudinary] Delete failed (non-critical):", err?.message);
  }
}

// -- Shared upload helper (exported for use by publish route) ---------------------
export async function uploadBufferToStableCdn(
  buf: Buffer,
  ext: string,
  filename: string
): Promise<string | null> {
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
  const cloudName    = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
  const appUrl       = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const isPublicDomain =
    appUrl &&
    !appUrl.includes("localhost") &&
    !appUrl.includes("127.0.0.1") &&
    !appUrl.includes("PASTE_YOUR_NGROK_URL_HERE");

  // 1. Cloudinary (when configured)
  if (cloudName && uploadPreset) {
    try {
      const form = new FormData();
      form.append("file", "data:" + mimeType + ";base64," + buf.toString("base64"));
      form.append("upload_preset", uploadPreset);
      form.append("folder", (process.env.BRAND_NAME||"instapilot").toLowerCase().replace(/[^a-z0-9]/g,"")||"uploads");
      const r = await fetch("https://api.cloudinary.com/v1_1/" + cloudName + "/image/upload", {
        method: "POST",
        body: form,
      });
      const d = await r.json();
      if (d.secure_url) {
        console.log("[ImageGen] Cloudinary URL:", d.secure_url);
        return d.secure_url as string;
      }
      console.warn("[ImageGen] Cloudinary upload failed:", d.error?.message ?? JSON.stringify(d));
    } catch (e: any) {
      console.warn("[ImageGen] Cloudinary error:", e?.message);
    }
  }

  // 2. catbox.moe (free, no key, stable permanent URLs)
  try {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append(
      "fileToUpload",
      new Blob([buf as unknown as ArrayBuffer], { type: mimeType }),
      filename + ext
    );
    const r = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
    if (r.ok) {
      const url = (await r.text()).trim();
      if (url.startsWith("https://files.catbox.moe/")) {
        console.log("[ImageGen] catbox.moe URL:", url);
        return url;
      }
      console.warn("[ImageGen] catbox.moe unexpected response:", url.slice(0, 100));
    } else {
      console.warn("[ImageGen] catbox.moe HTTP error:", r.status);
    }
  } catch (e: any) {
    console.warn("[ImageGen] catbox.moe upload failed:", e?.message);
  }

  // 3. Local public folder (when served on a real domain)
  if (isPublicDomain) {
    try {
      const uploadsDir = join(process.cwd(), "public", "uploads");
      if (!existsSync(uploadsDir)) await mkdir(uploadsDir, { recursive: true });
      const localFilename = filename + "-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
      await writeFile(join(uploadsDir, localFilename), buf);
      const url = appUrl + "/uploads/" + localFilename;
      console.log("[ImageGen] Saved locally:", url);
      return url;
    } catch (saveErr: any) {
      console.warn("[ImageGen] Local save failed:", saveErr?.message);
    }
  }

  return null;
}

// -- Shared VIDEO upload helper -------------------------------------------------
/**
 * Uploads an MP4 buffer to a public CDN and returns a stable https URL (or null).
 * Mirrors uploadBufferToStableCdn but for video — needed so a rendered Short MP4
 * can be handed to Instagram (Reels require a public video_url, not raw bytes).
 *
 * Priority: Cloudinary (resource_type=video) → catbox.moe → local public folder.
 */
export async function uploadVideoToStableCdn(buf: Buffer): Promise<string | null> {
  const mimeType     = "video/mp4";
  const ext          = ".mp4";
  const filename     = "short-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const cloudName    = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
  const appUrl       = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const isPublicDomain =
    appUrl &&
    !appUrl.includes("localhost") &&
    !appUrl.includes("127.0.0.1") &&
    !appUrl.includes("PASTE_YOUR_NGROK_URL_HERE");

  // 1. Cloudinary (when configured) — video endpoint + resource_type video
  if (cloudName && uploadPreset) {
    try {
      const form = new FormData();
      form.append("file", "data:" + mimeType + ";base64," + buf.toString("base64"));
      form.append("upload_preset", uploadPreset);
      form.append("folder", (process.env.BRAND_NAME||"instapilot").toLowerCase().replace(/[^a-z0-9]/g,"")||"uploads");
      const r = await fetch("https://api.cloudinary.com/v1_1/" + cloudName + "/video/upload", {
        method: "POST",
        body: form,
      });
      const d = await r.json();
      if (d.secure_url) {
        console.log("[ImageGen] Cloudinary video URL:", d.secure_url);
        return d.secure_url as string;
      }
      console.warn("[ImageGen] Cloudinary video upload failed:", d.error?.message ?? JSON.stringify(d));
    } catch (e: any) {
      console.warn("[ImageGen] Cloudinary video error:", e?.message);
    }
  }

  // 2. catbox.moe (free, no key, stable permanent URLs)
  try {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append(
      "fileToUpload",
      new Blob([buf as unknown as ArrayBuffer], { type: mimeType }),
      filename + ext
    );
    const r = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
    if (r.ok) {
      const url = (await r.text()).trim();
      if (url.startsWith("https://files.catbox.moe/")) {
        console.log("[ImageGen] catbox.moe video URL:", url);
        return url;
      }
      console.warn("[ImageGen] catbox.moe video unexpected response:", url.slice(0, 100));
    } else {
      console.warn("[ImageGen] catbox.moe video HTTP error:", r.status);
    }
  } catch (e: any) {
    console.warn("[ImageGen] catbox.moe video upload failed:", e?.message);
  }

  // 3. Local public folder (when served on a real domain)
  if (isPublicDomain) {
    try {
      const uploadsDir = join(process.cwd(), "public", "uploads");
      if (!existsSync(uploadsDir)) await mkdir(uploadsDir, { recursive: true });
      const localFilename = filename + ext;
      await writeFile(join(uploadsDir, localFilename), buf);
      const url = appUrl + "/uploads/" + localFilename;
      console.log("[ImageGen] Saved video locally:", url);
      return url;
    } catch (saveErr: any) {
      console.warn("[ImageGen] Local video save failed:", saveErr?.message);
    }
  }

  return null;
}

/**
 * Generates one image per carousel slide (up to 10 slides).
 * Returns an array of publicly accessible URLs - one per slide.
 * Used by the publish route when type === CAROUSEL.
 */
export async function generateCarouselImages(
  slides: Array<{ slide: number; headline: string; body: string }>,
  baseImagePrompt: string,
  coverTitle?: string
): Promise<string[]> {
  const urls: string[] = [];
  // Instagram carousel supports up to 20 items — respect that limit, don't cap at 10
  const limited = slides.slice(0, 20);

  // -- Try branded slide rendering (Satori + Sharp) --
  try {
    const { generateAllSlideBuffers } = await import("@/lib/slideImageGenerator");
    const buffers = await generateAllSlideBuffers(limited, coverTitle);

    if (buffers.length >= 2) {
      for (let i = 0; i < buffers.length; i++) {
        const slide    = limited[i];
        const uploaded = await uploadBufferToStableCdn(buffers[i], ".jpg", "slide-s" + slide.slide);
        if (uploaded) {
          console.log("[ImageGen] Branded slide " + slide.slide + " -> " + uploaded);
          urls.push(uploaded);
        }
      }
      if (urls.length >= 2) {
        console.log("[ImageGen] Generated " + urls.length + "/" + limited.length + " branded slides");
        return urls;
      }
    }
  } catch (err: any) {
    console.warn("[ImageGen] Branded slide gen failed, using Picsum fallback:", err?.message);
  }

  // No Picsum stock-photo fallback — do not publish random stock photos to Instagram
  console.warn("[ImageGen] Branded slide generation failed and no stock photo fallback is configured. Returning empty URL list.");

  console.log("[ImageGen] Generated " + urls.length + "/" + limited.length + " carousel images");
  return urls;
}
