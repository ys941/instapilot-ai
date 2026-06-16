/**
 * lib/youtube.ts
 *
 * YouTube Data API v3 client — uploads content to YouTube as Shorts.
 *
 * Auth model: OAuth2 with a stored long-lived REFRESH TOKEN (no interactive
 * login at runtime — mirrors how Instagram uses a long-lived token). The
 * googleapis client transparently exchanges the refresh token for a short-lived
 * access token on each call.
 *
 * Required env vars:
 *   YOUTUBE_CLIENT_ID       OAuth client ID (Google Cloud → Credentials)
 *   YOUTUBE_CLIENT_SECRET   OAuth client secret
 *   YOUTUBE_REFRESH_TOKEN   Refresh token for the target channel (offline access)
 *   YOUTUBE_CHANNEL_ID      (optional) channel ID — for health/info display only
 *
 * Scope needed when generating the refresh token:
 *   https://www.googleapis.com/auth/youtube.upload
 */

import { Readable } from "stream";
import { google, type youtube_v3 } from "googleapis";

export interface YouTubeUploadMeta {
  title:        string;
  description:  string;
  tags?:        string[];
  /** "public" | "unlisted" | "private". Default "public". */
  privacy?:     "public" | "unlisted" | "private";
  /**
   * ISO timestamp. When set, the video is uploaded as `private` and YouTube
   * makes it public natively at this time (native scheduling). privacy is
   * forced to "private" by the API when publishAt is present.
   */
  publishAt?:   string | null;
  /** YouTube category. 27 = Education (default for educational content). */
  categoryId?:  string;
}

export interface YouTubeUploadResult {
  videoId: string;
  url:     string;
}

function getEnv() {
  return {
    clientId:     process.env.YOUTUBE_CLIENT_ID?.trim()     ?? "",
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET?.trim() ?? "",
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN?.trim() ?? "",
    channelId:    process.env.YOUTUBE_CHANNEL_ID?.trim()    ?? "",
  };
}

/** Per-brand OAuth credentials for building a YouTube client. */
export interface YouTubeCreds {
  clientId:     string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * True when all credentials needed to upload are present.
 *
 * - No args: checks the ENV credentials (current behaviour, unchanged).
 * - With `creds`: reports configured when that brand's three creds are present.
 */
export function isYouTubeConfigured(creds?: YouTubeCreds): boolean {
  if (creds) {
    return Boolean(creds.clientId && creds.clientSecret && creds.refreshToken);
  }
  const { clientId, clientSecret, refreshToken } = getEnv();
  return Boolean(clientId && clientSecret && refreshToken);
}

// Cached client for the ENV (default / primary) credentials only. Per-brand
// clients are built on demand and NOT cached here (they're keyed by creds).
let _client: youtube_v3.Youtube | null = null;

/**
 * Build a YouTube Data API client.
 *
 * - Called with NO args: uses ENV credentials (current behaviour) and caches the
 *   client across calls — unchanged for every existing caller.
 * - Called with `creds`: builds a one-off client for that specific brand's
 *   credentials (not cached).
 */
function getYouTubeClient(creds?: YouTubeCreds): youtube_v3.Youtube {
  if (creds) {
    const { clientId, clientSecret, refreshToken } = creds;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "YouTube not configured for this brand — missing clientId, clientSecret or refreshToken"
      );
    }
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return google.youtube({ version: "v3", auth: oauth2 });
  }

  if (_client) return _client;
  const { clientId, clientSecret, refreshToken } = getEnv();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "YouTube not configured — set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN"
    );
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  _client = google.youtube({ version: "v3", auth: oauth2 });
  return _client;
}

// YouTube hard limits
const TITLE_MAX = 100;
const DESC_MAX  = 4900; // API allows 5000; leave headroom for the #Shorts tag

/** Trim a title to YouTube's 100-char limit (titles cannot contain < or >). */
function sanitizeTitle(raw: string): string {
  const clean = (raw || "Short").replace(/[<>]/g, "").trim();
  return clean.length > TITLE_MAX ? clean.slice(0, TITLE_MAX - 1).trim() + "…" : clean;
}

/**
 * Build the description. Always appends "#Shorts" so YouTube classifies the
 * vertical video as a Short. Strips angle brackets (rejected by the API).
 */
/**
 * Convert any tag/phrase into a SINGLE valid hashtag token. A hashtag cannot
 * contain spaces — "heart attack symptoms" must become "#HeartAttackSymptoms",
 * never "#heart attack symptoms" (which renders as a broken #heart + plain text).
 * Multi-word phrases are PascalCased; single words are kept as-is.
 */
function toHashtag(raw: string): string | null {
  const words = raw.replace(/^#+/, "").replace(/[^a-zA-Z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const token = words.length === 1
    ? words[0]
    : words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return token.length >= 2 ? "#" + token : null;
}

function buildDescription(raw: string, tags: string[]): string {
  const base = (raw || "").replace(/[<>]/g, "").trim();
  // Render the tags as CLEAN single-token hashtags (no spaces), deduped, max 10.
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const t of tags) {
    const h = toHashtag(t);
    if (h && !seen.has(h.toLowerCase())) {
      seen.add(h.toLowerCase());
      hashtags.push(h);
    }
    if (hashtags.length >= 10) break;
  }
  const tagLine = hashtags.length ? "\n\n" + hashtags.join(" ") : "";
  let desc = `${base}${tagLine}`.trim();
  if (!/#shorts\b/i.test(desc)) desc = `${desc}\n\n#Shorts`.trim();
  return desc.length > DESC_MAX ? desc.slice(0, DESC_MAX) : desc;
}

/**
 * Upload an MP4 buffer to YouTube as a Short.
 * Returns { videoId, url } on success, or throws with the API error message.
 */
export async function uploadShort(
  videoBuffer: Buffer,
  meta: YouTubeUploadMeta,
  creds?: YouTubeCreds,
): Promise<YouTubeUploadResult> {
  const yt = getYouTubeClient(creds);

  // Tags must each be ≤ 30 chars-ish and the whole list ≤ 500 chars; cap to 15.
  const tags = (meta.tags ?? [])
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 15);

  // publishAt forces privacy=private (YouTube publishes natively at that time).
  const privacyStatus = meta.publishAt ? "private" : (meta.privacy ?? "public");

  const requestBody: youtube_v3.Schema$Video = {
    snippet: {
      title:       sanitizeTitle(meta.title),
      description: buildDescription(meta.description, meta.tags ?? []),
      tags,
      categoryId:  meta.categoryId ?? "27", // 27 = Education
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
      ...(meta.publishAt ? { publishAt: meta.publishAt } : {}),
    },
  };

  console.log(
    `[YouTube] Uploading Short "${requestBody.snippet?.title}" ` +
    `(${Math.round(videoBuffer.length / 1024)} KB, privacy=${privacyStatus}` +
    `${meta.publishAt ? `, publishAt=${meta.publishAt}` : ""})`
  );

  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody,
    media: {
      mimeType: "video/mp4",
      body:     Readable.from(videoBuffer),
    },
  });

  const videoId = res.data.id;
  if (!videoId) {
    throw new Error("YouTube upload returned no video ID");
  }
  const url = `https://youtube.com/shorts/${videoId}`;
  console.log(`[YouTube] Published: ${url}`);
  return { videoId, url };
}

/**
 * Set a custom thumbnail on an uploaded video. Best-effort: returns true on
 * success, false on ANY error — custom thumbnails require the channel to have
 * the feature enabled (verified phone / good standing), so this MUST NOT throw
 * and never blocks a successful publish.
 */
export async function setVideoThumbnail(videoId: string, jpeg: Buffer, creds?: YouTubeCreds): Promise<boolean> {
  try {
    if (!videoId || !jpeg || jpeg.length === 0) return false;
    const yt = getYouTubeClient(creds);
    await yt.thumbnails.set({
      videoId,
      media: { mimeType: "image/jpeg", body: Readable.from(jpeg) },
    });
    console.log(`[YouTube] Custom thumbnail set for ${videoId} (${Math.round(jpeg.length / 1024)} KB)`);
    return true;
  } catch (err: any) {
    console.warn("[YouTube] setVideoThumbnail failed (non-fatal):", err?.message ?? String(err));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read / analytics helpers (require youtube.readonly + force-ssl scopes).
// Every function is defensive: try/catch with a safe fallback, never throws.
// ---------------------------------------------------------------------------

export interface YouTubeChannelStats {
  subscribers:  number;
  views:        number;
  videos:       number;
  channelTitle: string;
  thumbnail:    string;
}

export interface YouTubeVideo {
  videoId:     string;
  title:       string;
  publishedAt: string;
  thumbnail:   string;
  views:       number;
  likes:       number;
  comments:    number;
  url:         string;
}

export interface YouTubeVideoStats {
  views:    number;
  likes:    number;
  comments: number;
}

export interface YouTubeCommentThread {
  commentId:       string;
  text:            string;
  author:          string;
  authorChannelId: string;
  publishedAt:     string;
}

export interface YouTubeCommentReply {
  commentId:       string;
  text:            string;
  author:          string;
  authorChannelId: string;
  publishedAt:     string;
}

function toInt(v: string | null | undefined): number {
  const n = parseInt(v ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

/** Channel-level stats. Returns zeroed fallback on any error. */
export async function getChannelStats(creds?: YouTubeCreds): Promise<YouTubeChannelStats> {
  const fallback: YouTubeChannelStats = {
    subscribers: 0, views: 0, videos: 0, channelTitle: "", thumbnail: "",
  };
  try {
    const yt = getYouTubeClient(creds);
    const res = await yt.channels.list({ part: ["snippet", "statistics"], mine: true });
    const item = res.data.items?.[0];
    if (!item) return fallback;
    const stats = item.statistics ?? {};
    const snippet = item.snippet ?? {};
    return {
      subscribers:  toInt(stats.subscriberCount),
      views:        toInt(stats.viewCount),
      videos:       toInt(stats.videoCount),
      channelTitle: snippet.title ?? "",
      thumbnail:    snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? "",
    };
  } catch (err: any) {
    console.error("[YouTube] getChannelStats failed:", err?.message ?? String(err));
    return fallback;
  }
}

/** Recent uploads with per-video stats. Returns [] on any error. */
export async function getRecentVideos(limit = 10, creds?: YouTubeCreds): Promise<YouTubeVideo[]> {
  try {
    const yt = getYouTubeClient(creds);

    // 1. Find the uploads playlist for the authenticated channel.
    const chan = await yt.channels.list({ part: ["contentDetails"], mine: true });
    const uploadsId = chan.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) return [];

    // 2. List the most recent items in that playlist.
    const playlist = await yt.playlistItems.list({
      part:       ["contentDetails"],
      playlistId: uploadsId,
      maxResults: Math.min(Math.max(limit, 1), 50),
    });
    const videoIds = (playlist.data.items ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id));
    if (videoIds.length === 0) return [];

    // 3. Fetch snippet + statistics for those videos.
    const videos = await yt.videos.list({ part: ["snippet", "statistics"], id: videoIds });
    return (videos.data.items ?? []).map((v) => {
      const id = v.id ?? "";
      const snippet = v.snippet ?? {};
      const stats = v.statistics ?? {};
      return {
        videoId:     id,
        title:       snippet.title ?? "",
        publishedAt: snippet.publishedAt ?? "",
        thumbnail:   snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? "",
        views:       toInt(stats.viewCount),
        likes:       toInt(stats.likeCount),
        comments:    toInt(stats.commentCount),
        url:         `https://youtube.com/shorts/${id}`,
      };
    });
  } catch (err: any) {
    console.error("[YouTube] getRecentVideos failed:", err?.message ?? String(err));
    return [];
  }
}

/** Stats for a single video. Returns zeroed fallback on any error. */
export async function getVideoStats(videoId: string, creds?: YouTubeCreds): Promise<YouTubeVideoStats> {
  const fallback: YouTubeVideoStats = { views: 0, likes: 0, comments: 0 };
  try {
    const yt = getYouTubeClient(creds);
    const res = await yt.videos.list({ part: ["statistics"], id: [videoId] });
    const stats = res.data.items?.[0]?.statistics;
    if (!stats) return fallback;
    return {
      views:    toInt(stats.viewCount),
      likes:    toInt(stats.likeCount),
      comments: toInt(stats.commentCount),
    };
  } catch (err: any) {
    console.error("[YouTube] getVideoStats failed:", err?.message ?? String(err));
    return fallback;
  }
}

/** Top-level comment threads for a video. Returns [] (incl. when comments disabled). */
export async function listCommentThreads(videoId: string, max = 50, creds?: YouTubeCreds): Promise<YouTubeCommentThread[]> {
  try {
    const yt = getYouTubeClient(creds);
    const res = await yt.commentThreads.list({
      part:       ["snippet"],
      videoId,
      maxResults: Math.min(Math.max(max, 1), 100),
    });
    return (res.data.items ?? []).map((t) => {
      const top = t.snippet?.topLevelComment?.snippet ?? {};
      return {
        commentId:       t.snippet?.topLevelComment?.id ?? t.id ?? "",
        text:            top.textDisplay ?? top.textOriginal ?? "",
        author:          top.authorDisplayName ?? "",
        authorChannelId: top.authorChannelId?.value ?? "",
        publishedAt:     top.publishedAt ?? "",
      };
    });
  } catch (err: any) {
    // Comments disabled / forbidden → empty list, never throw.
    console.error("[YouTube] listCommentThreads failed:", err?.message ?? String(err));
    return [];
  }
}

/**
 * Replies to a single top-level comment (nested comments). Returns [] on any
 * error (e.g. a thread with no replies or insufficient scope), never throws.
 */
export async function listCommentReplies(parentCommentId: string, max = 50, creds?: YouTubeCreds): Promise<YouTubeCommentReply[]> {
  try {
    const yt = getYouTubeClient(creds);
    const res = await yt.comments.list({
      part:       ["snippet"],
      parentId:   parentCommentId,
      maxResults: Math.min(Math.max(max, 1), 100),
    });
    return (res.data.items ?? []).map((c) => {
      const s = c.snippet ?? {};
      return {
        commentId:       c.id ?? "",
        text:            s.textDisplay ?? s.textOriginal ?? "",
        author:          s.authorDisplayName ?? "",
        authorChannelId: s.authorChannelId?.value ?? "",
        publishedAt:     s.publishedAt ?? "",
      };
    });
  } catch (err: any) {
    console.error("[YouTube] listCommentReplies failed:", err?.message ?? String(err));
    return [];
  }
}

/**
 * The authenticated channel's own channel id (channels.list mine:true → items[0].id).
 * Used to detect — and skip — the channel's OWN comments/replies so the bot never
 * replies to itself (which would cause reply loops). Cached after the first call.
 * Returns "" on any error (caller falls back to author-name matching).
 */
// Identity of the channel we post as: id, title and @handle. Cached ONLY once a
// non-empty value is fetched — a transient API failure must NOT poison the cache
// (the old code cached "" forever after one hiccup, which silently disabled own-
// comment detection and made the bot reply to its own comments).
interface OwnChannelInfo { id: string; title: string; handle: string }
// ENV (no-creds) cache — unchanged behaviour: cache only a successful (non-empty
// id) fetch so a transient failure stays retryable.
let _ownChannelInfo: OwnChannelInfo | null = null;
// Per-brand cache, keyed by refreshToken, so a brand's identity is cached
// independently and never reads/poisons the shared ENV cache.
const _ownChannelInfoByCreds = new Map<string, OwnChannelInfo>();

export async function getOwnChannelInfo(creds?: YouTubeCreds): Promise<OwnChannelInfo> {
  // Per-brand path: use a creds-keyed cache; never touch the ENV cache.
  if (creds) {
    const key = creds.refreshToken;
    const cached = _ownChannelInfoByCreds.get(key);
    if (cached && cached.id) return cached;
    try {
      const yt = getYouTubeClient(creds);
      const res = await yt.channels.list({ part: ["id", "snippet"], mine: true });
      const item = res.data.items?.[0];
      const id     = item?.id ?? "";
      const title  = item?.snippet?.title ?? "";
      const raw    = (item?.snippet as any)?.customUrl ?? "";
      const handle = raw ? (raw.startsWith("@") ? raw : "@" + raw) : "";
      const info = { id, title, handle };
      // Only cache a SUCCESSFUL fetch (non-empty id) so failures stay retryable.
      if (id) _ownChannelInfoByCreds.set(key, info);
      return info;
    } catch (err: any) {
      console.error("[YouTube] getOwnChannelInfo failed:", err?.message ?? String(err));
      return _ownChannelInfoByCreds.get(key) ?? { id: "", title: "", handle: "" };
    }
  }

  if (_ownChannelInfo && _ownChannelInfo.id) return _ownChannelInfo;
  try {
    const yt = getYouTubeClient();
    const res = await yt.channels.list({ part: ["id", "snippet"], mine: true });
    const item = res.data.items?.[0];
    const id     = item?.id ?? "";
    const title  = item?.snippet?.title ?? "";
    // customUrl is the channel @handle (e.g. "@yourchannel"); normalise to "@..".
    const raw    = (item?.snippet as any)?.customUrl ?? "";
    const handle = raw ? (raw.startsWith("@") ? raw : "@" + raw) : "";
    const info = { id, title, handle };
    // Only cache a SUCCESSFUL fetch (non-empty id) so failures stay retryable.
    if (id) _ownChannelInfo = info;
    return info;
  } catch (err: any) {
    console.error("[YouTube] getOwnChannelInfo failed:", err?.message ?? String(err));
    return _ownChannelInfo ?? { id: "", title: "", handle: "" };
  }
}

export async function getOwnChannelId(creds?: YouTubeCreds): Promise<string> {
  return (await getOwnChannelInfo(creds)).id;
}

/** Post a reply to a comment. Returns true on success, false on any error. */
export async function replyToYouTubeComment(parentCommentId: string, text: string, creds?: YouTubeCreds): Promise<boolean> {
  try {
    const yt = getYouTubeClient(creds);
    await yt.comments.insert({
      part:        ["snippet"],
      requestBody: { snippet: { parentId: parentCommentId, textOriginal: text } },
    });
    return true;
  } catch (err: any) {
    console.error("[YouTube] replyToYouTubeComment failed:", err?.message ?? String(err));
    return false;
  }
}

/**
 * Post a TOP-LEVEL comment from the channel on one of its own videos — used to
 * "seed" an engagement question on each new upload so viewers reply (comment
 * velocity is a strong Shorts reach signal). Returns the new comment id or null.
 * NOTE: the YouTube Data API has NO endpoint to PIN a comment, so the seed comment
 * is posted but cannot be auto-pinned (pin it manually in Studio for max effect).
 * Best-effort: never throws.
 */
export async function postVideoComment(videoId: string, text: string, creds?: YouTubeCreds): Promise<string | null> {
  try {
    const yt = getYouTubeClient(creds);
    const res = await yt.commentThreads.insert({
      part:        ["snippet"],
      requestBody: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } },
    });
    return res.data.id ?? null;
  } catch (err: any) {
    console.warn("[YouTube] postVideoComment (seed) failed:", err?.message ?? String(err));
    return null;
  }
}

export interface YouTubeHealth {
  configured: boolean;
  ok:         boolean;
  channel?:   string;
  error?:     string;
}

/**
 * Lightweight health check — verifies the refresh token can mint an access token.
 *
 * We intentionally do NOT call channels.list here: the upload-only scope
 * (youtube.upload) is write-scoped and returns "Insufficient Permission" for
 * read calls. A successful token refresh is sufficient proof the credentials
 * are valid and uploads will work. If a youtube.readonly scope is also present,
 * we opportunistically fetch the channel name for display.
 */
export async function checkYouTubeHealth(creds?: YouTubeCreds): Promise<YouTubeHealth> {
  if (!isYouTubeConfigured(creds)) {
    return { configured: false, ok: false, error: "Missing YouTube credentials" };
  }
  // ENV path uses getEnv() (incl. the optional channelId for display); the
  // per-brand path uses the supplied creds (no channelId in YouTubeCreds).
  const { clientId, clientSecret, refreshToken, channelId } = creds
    ? { ...creds, channelId: "" }
    : getEnv();
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const { token } = await oauth2.getAccessToken();
    if (!token) throw new Error("Could not obtain access token from refresh token");

    // Best-effort channel name (only works if a readonly scope was granted).
    let channel = channelId || undefined;
    try {
      const yt = google.youtube({ version: "v3", auth: oauth2 });
      const res = await yt.channels.list({ part: ["snippet"], mine: true });
      channel = res.data.items?.[0]?.snippet?.title ?? channel;
    } catch { /* upload-only scope — no read access, that's fine */ }

    return { configured: true, ok: true, channel };
  } catch (err: any) {
    return { configured: true, ok: false, error: err?.message ?? String(err) };
  }
}
