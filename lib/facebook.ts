/**
 * lib/facebook.ts
 *
 * Cross-post already-published media to a Facebook PAGE.
 *
 * The Instagram account is linked to a Facebook Page (required by the IG Graph API).
 * When the "Also publish to Facebook" toggle is on, we reuse that Page + its access
 * token to publish the SAME media (a public Cloudinary URL) to the Page:
 *   • image → POST /{page-id}/photos       (url + caption)
 *   • video → publish as a real Facebook REEL via the resumable /{page-id}/video_reels
 *             flow (hosted upload by file_url); falls back to /{page-id}/videos if the
 *             Reels API is unavailable, so an IG Reel ALWAYS lands on the Page.
 *
 * Best-effort: this must NEVER break the (already successful) Instagram/YouTube
 * publish. Any failure is logged and swallowed — returns the FB post/reel id or null.
 */

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

export interface FacebookCrossPostInput {
  pageId:    string;   // Facebook Page id
  pageToken: string;   // Page access token (from getPageToken)
  mediaUrl:  string;   // public media URL (Cloudinary) — must be reachable by Facebook
  isVideo:   boolean;
  caption:   string;
}

/**
 * Publish a video to the Facebook Page as a proper REEL using the resumable
 * `video_reels` API with a hosted (file_url) upload:
 *   1. start  → returns { video_id, upload_url }
 *   2. upload → POST upload_url with `file_url` header (Facebook fetches the file)
 *   3. finish → publish (video_state=PUBLISHED) with the description
 * Returns the reel/video id on success, or null so the caller can fall back.
 */
async function publishFacebookReel(
  pageId: string, pageToken: string, videoUrl: string, caption: string,
): Promise<string | null> {
  try {
    // 1. START — initialize an upload session.
    const startRes = await fetch(`${GRAPH_BASE}/${pageId}/video_reels`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({ upload_phase: "start", access_token: pageToken }),
      signal:  AbortSignal.timeout(30_000),
    });
    const start = await startRes.json();
    const videoId   = start?.video_id as string | undefined;
    const uploadUrl = start?.upload_url as string | undefined;
    if (!videoId || !uploadUrl) {
      console.warn("[Facebook] Reel start failed:", start?.error?.message ?? JSON.stringify(start).slice(0, 200));
      return null;
    }

    // 2. UPLOAD — hosted: Facebook pulls the file from our public URL.
    const upRes = await fetch(uploadUrl, {
      method:  "POST",
      headers: { Authorization: `OAuth ${pageToken}`, file_url: videoUrl },
      signal:  AbortSignal.timeout(120_000),
    });
    const up = await upRes.json().catch(() => ({} as any));
    if (up && up.success === false) {
      console.warn("[Facebook] Reel hosted upload failed:", JSON.stringify(up).slice(0, 200));
      return null;
    }

    // 3. FINISH — publish the reel with its caption.
    const finRes = await fetch(`${GRAPH_BASE}/${pageId}/video_reels`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        access_token: pageToken,
        video_id:     videoId,
        upload_phase: "finish",
        video_state:  "PUBLISHED",
        description:  caption ?? "",
      }),
      signal:  AbortSignal.timeout(60_000),
    });
    const fin = await finRes.json();
    if (fin?.success || fin?.id || fin?.post_id) {
      console.log(`[Facebook] Published IG Reel to Page ${pageId} as a Facebook Reel → ${videoId}`);
      return videoId;
    }
    console.warn("[Facebook] Reel finish failed:", fin?.error?.message ?? JSON.stringify(fin).slice(0, 200));
    return null;
  } catch (err: any) {
    console.warn("[Facebook] Reel publish error:", err?.message ?? err);
    return null;
  }
}

export async function crossPostToFacebookPage(
  input: FacebookCrossPostInput,
): Promise<string | null> {
  const { pageId, pageToken, mediaUrl, isVideo, caption } = input;
  if (!pageId || !pageToken || !mediaUrl) {
    console.warn("[Facebook] Cross-post skipped — missing pageId/pageToken/mediaUrl");
    return null;
  }

  // Video (IG Reel) → publish as a real Facebook Reel first; only fall back to a
  // plain Page video if the Reels API path fails.
  if (isVideo) {
    const reelId = await publishFacebookReel(pageId, pageToken, mediaUrl, caption);
    if (reelId) return reelId;
    console.warn("[Facebook] Reels API failed — falling back to a standard Page video (/videos)");
  }

  try {
    const endpoint = isVideo
      ? `${GRAPH_BASE}/${pageId}/videos`
      : `${GRAPH_BASE}/${pageId}/photos`;

    const body = new URLSearchParams();
    if (isVideo) {
      body.set("file_url", mediaUrl);
      body.set("description", caption ?? "");
    } else {
      body.set("url", mediaUrl);
      body.set("caption", caption ?? "");
    }
    body.set("access_token", pageToken);

    const res  = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal:  AbortSignal.timeout(60_000), // video processing can be slow
    });
    const data = await res.json();

    if (data?.id || data?.post_id) {
      const id = (data.post_id ?? data.id) as string;
      console.log(`[Facebook] Cross-posted ${isVideo ? "video" : "photo"} to Page ${pageId} → ${id}`);
      return id;
    }
    console.warn("[Facebook] Cross-post failed:", data?.error?.message ?? JSON.stringify(data).slice(0, 200));
    return null;
  } catch (err: any) {
    console.warn("[Facebook] Cross-post error:", err?.message ?? err);
    return null;
  }
}
