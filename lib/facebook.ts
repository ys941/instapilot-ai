/**
 * lib/facebook.ts
 *
 * Cross-post already-published media to a Facebook PAGE feed.
 *
 * The Instagram account is linked to a Facebook Page (required by the IG Graph API).
 * When the "Also publish to Facebook" toggle is on, we reuse that Page + its access
 * token to publish the SAME media (a public Cloudinary URL) to the Page feed:
 *   • image → POST /{page-id}/photos   (url + caption)
 *   • video → POST /{page-id}/videos   (file_url + description)
 *
 * Best-effort: this must NEVER break the (already successful) Instagram/YouTube
 * publish. Any failure is logged and swallowed — returns the FB post id or null.
 */

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

export interface FacebookCrossPostInput {
  pageId:    string;   // Facebook Page id
  pageToken: string;   // Page access token (from getPageToken)
  mediaUrl:  string;   // public media URL (Cloudinary) — must be reachable by Facebook
  isVideo:   boolean;
  caption:   string;
}

export async function crossPostToFacebookPage(
  input: FacebookCrossPostInput,
): Promise<string | null> {
  const { pageId, pageToken, mediaUrl, isVideo, caption } = input;
  if (!pageId || !pageToken || !mediaUrl) {
    console.warn("[Facebook] Cross-post skipped — missing pageId/pageToken/mediaUrl");
    return null;
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
