/**
 * lib/catchup.ts
 *
 * Startup catch-up logic -- runs when the app boots.
 * Handles three things that may have been missed while the app was offline:
 *   1. Publish overdue scheduled posts
 *   2. Fetch and store new comments on ALL published posts (DB + Instagram API)
 *   3. Auto-reply to DMs that never got a response
 *
 * Token priority: env var always wins over DB -- the env var is manually kept
 * up-to-date while the DB may contain a stale token from a previous session.
 */

import { prisma } from "@/lib/prisma";
import { claimCommentForReply, releaseCommentClaim, markCommentReplied } from "@/lib/commentClaim";
import { PostCommentContext, getGrokClient, checkGrokHealth } from "@/lib/grok";
import { getAIClient, generateJSONResilient } from "@/lib/ai-factory";
// renderPostToJpeg and renderStoryToJpeg are imported dynamically at call sites
// to prevent Turbopack from bundling Node.js-only modules (satori/sharp) for the edge runtime.
import { uploadBufferToStableCdn, uploadVideoToStableCdn, deleteFromCloudinary, generateCarouselImages } from "@/lib/imageGenerator";
import { crossPostToFacebookPage } from "@/lib/facebook";
import { withRenderLock } from "@/lib/renderLock";
import { buildBeautifulCaption, capIgCaption } from "@/lib/captionBuilder";
import { readPreferences, readPreferencesForBrand, resolveDaySchedule, getBrand } from "@/lib/preferences";
import { atHandle, buildBrandSystemPrompt, type BrandConfig } from "@/lib/brandConfig";
import { listBrands, getBrandCredentials, getPrimaryBrandId, type BrandRecord, type BrandCredentials } from "@/lib/brands";
import { wallTimeToUTC } from "@/lib/utils";
import { notifEmitter, LiveNotif, isWebhookActive, secondsSinceLastWebhookComment } from "@/lib/webhookCounter";
import {
  notifyPostFailed,
  notifyRateLimit,
  notifyApiHealthDegraded,
  notifySystemError,
  notifyYouTubePublished,
  notifyYouTubeCommentReplied,
  notifyYouTubeFailed,
  logRateLimitEvent,
  logSystemErrorEvent,
  getRecentRateLimitEvents,
  getRecentSystemErrors,
  getRecentHealthChanges,
} from "@/lib/notifier";
import { buildConciseHashtags } from "@/lib/hashtagEnricher";
import {
  isYouTubeConfigured,
  uploadShort,
  getRecentVideos,
  listCommentThreads,
  listCommentReplies,
  replyToYouTubeComment,
  getOwnChannelInfo,
} from "@/lib/youtube";
import { renderCardsToShortMp4 } from "@/lib/videoGenerator";
import { publishPostToYouTubeShort, buildRichCaption } from "@/lib/youtubePublish";

const GRAPH_BASE   = "https://graph.facebook.com/v25.0";
const PAGE_ID      = process.env.FACEBOOK_PAGE_ID ?? "";
// Our own Instagram business account id -- the most reliable self-author signal
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";
// Our own Instagram handle -- used to skip AI-generated replies in comment lists
const OWN_USERNAME = (process.env.INSTAGRAM_USERNAME ?? process.env.BRAND_HANDLE ?? "").toLowerCase();

// Robust self-author check. A comment/reply is "ours" if its author id matches our
// IG business account id or the Facebook Page id, OR its username matches OWN_USERNAME.
// This catches the case where the IG account's actual handle differs from OWN_USERNAME
// (which otherwise causes the bot to reply to its own replies → reply loops).
function isOwnComment(c: { username?: string; from?: { id?: string; username?: string } }): boolean {
  const fromId = c.from?.id ?? "";
  if (fromId && ((IG_ACCOUNT_ID && fromId === IG_ACCOUNT_ID) || (PAGE_ID && fromId === PAGE_ID))) {
    return true;
  }
  const uname = (c.username ?? c.from?.username ?? "").toLowerCase();
  return uname === OWN_USERNAME;
}

const DM_AUTO_REPLY =
  process.env.DM_AUTO_REPLY ??
  "👋 Thanks for reaching out! We've received your message and will get back to you shortly.";

// -- Extract correct answer from quiz content ----------------------------------
function extractCorrectAnswer(content: string): { letter: string; text: string } | null {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const answerLine = lines.find((l) => /^(answer|correct answer)\s*[:\-]/i.test(l));
  if (!answerLine) return null;
  const body = answerLine.replace(/^(answer|correct answer)\s*[:\-]\s*/i, "").replace(/\*\*/g, "").trim();
  const letterMatch = body.match(/^([A-D])[.\-:\s]/i);
  if (!letterMatch) return null;
  const letter = letterMatch[1].toUpperCase();
  const text   = body.replace(/^[A-D][.\-:\s]+/i, "").trim();
  return { letter, text };
}

// -- Branded fallback replies (used only when Groq is unavailable) -------------
// Built per-brand so each white-label account falls back to its OWN handle/CTA.
function fallbackCommentReplies(brand?: BrandConfig | null): string[] {
  const handle = brand ? atHandle(brand) : (OWN_USERNAME ? `@${OWN_USERNAME}` : "this account");
  const cta    = brand?.commentCtaLine?.trim() || "Follow for more!";
  const niche  = brand?.niche?.trim() || "great";
  return [
    `Glad you are engaging! ${cta} ❤️`,
    `Thanks for stopping by! More ${niche} content coming soon ❤️`,
    `Appreciate the engagement! Follow ${handle} for daily updates! 🙏`,
    "Love seeing the community engage! More on the way 💙",
    `Great to have you here! ${cta} ✨`,
  ];
}

// -- AI-powered comment reply generator ----------------------------------------
// Falls back to a branded generic reply when the AI provider is unavailable.
// Pass the active account's `brand` so the fallback resolves to that account's skin.
export async function generateAICommentReply(
  commentText: string,
  username: string,
  postContext: PostCommentContext,
  brand?: BrandConfig | null,
): Promise<string | null> {
  try {
    // Comment replies use GROK (llama-3.3-70b) directly — NOT the Gemini chain.
    // Gemini's flash models are thinking models that rate-limit and fall through to
    // Gemma (which dumps reasoning junk), producing truncated/poor replies. Grok 70B
    // is a clean, non-thinking model with sophisticated quiz handling → reliably
    // complete, accurate, human comment replies (same proven engine as DMs).
    const grok = getGrokClient();
    const reply = await grok.generateCommentReply(commentText, username, postContext);
    const clean = (reply ?? "").trim();
    if (clean) {
      console.log(`[Catchup] Comment reply generated via Grok (${clean.length} chars)`);
      return clean;
    }
    throw new Error("empty Grok comment reply");
  } catch (err) {
    console.warn("[Catchup] AI comment reply unavailable -- using fallback reply:", String(err));
    // Return a varied fallback so the comment still gets acknowledged
    const fallbacks = fallbackCommentReplies(brand);
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

// -- AI-powered DM reply generator ---------------------------------------------
// Chat / DM replies ALWAYS use Grok (not Gemini). Grok is a clean instruct model
// with a stable key, so DMs never get corrupted by Gemini "thinking" models or
// blocked by Gemini free-tier limits. Returns null if Grok is unavailable.
export async function generateAIDMReply(
  messages: Array<{ from: string; text: string; time: string }>,
  senderUsername: string
): Promise<string | null> {
  try {
    const grok = getGrokClient();
    const reply = await grok.generateDMReply(messages, senderUsername);
    const clean = (reply ?? "").trim();
    if (!clean) {
      console.warn("[Catchup] Grok DM reply came back EMPTY — will use DM_AUTO_REPLY fallback");
      return null;
    }
    console.log(`[Catchup] Grok DM reply generated (${clean.length} chars)`);
    return clean;
  } catch (err) {
    console.warn("[Catchup] Grok DM reply threw -- using fallback:", String(err));
    return null;
  }
}

// -- Fetch credentials -- env var always takes priority over DB ----------------
// The env var is manually updated to the latest token; the DB may lag behind
// (it only syncs when getServerSession() is called, i.e. after a page request).
export async function getCredentials(): Promise<{ igToken: string; igAcctId: string }> {
  // Prefer env vars -- they are always manually kept current
  const envToken   = process.env.INSTAGRAM_ACCESS_TOKEN         || "";
  const envAcctId  = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "";

  // Only fall back to DB values if env vars are missing
  if (envToken && envAcctId) {
    return { igToken: envToken, igAcctId: envAcctId };
  }

  try {
    const user = await prisma.user.findUnique({
      where:  { id: "local-user" },
      select: { instagramToken: true, instagramAccountId: true },
    });
    return {
      igToken:  envToken  || user?.instagramToken     || "",
      igAcctId: envAcctId || user?.instagramAccountId || "",
    };
  } catch {
    return { igToken: envToken, igAcctId: envAcctId };
  }
}

// ── Multi-brand context ───────────────────────────────────────────────────────
// Everything the per-brand pipeline needs, resolved ONCE per brand per cycle so the
// engine never reaches for module-level env consts. The primary brand's creds come
// from ENV (via getBrandCredentials), preserving the exact single-account behaviour.
export interface BrandContext {
  brandId:    string;            // resolved brand id (always a real id)
  isPrimary:  boolean;
  primaryId:  string;            // the primary brand id (for null==primary filtering)
  igToken:    string;
  igAcctId:   string;
  igUsername: string;            // lowercased own handle (own-comment detection)
  fbPageId:   string;
  ytCreds:    { clientId: string; clientSecret: string; refreshToken: string } | undefined;
  hasInstagram: boolean;
  hasYouTube:   boolean;
  // Lazily-read brand preferences (readPreferencesForBrand). Cached on the context
  // so each per-brand function doesn't re-read independently within a cycle.
  prefs: Awaited<ReturnType<typeof readPreferencesForBrand>>;
}

// YouTube creds for youtube.ts/youtubePublish.ts calls: undefined ⇒ env/primary.
function ytCredsFor(creds: BrandCredentials): BrandContext["ytCreds"] {
  if (creds.ytClientId && creds.ytClientSecret && creds.ytRefreshToken) {
    return { clientId: creds.ytClientId, clientSecret: creds.ytClientSecret, refreshToken: creds.ytRefreshToken };
  }
  return undefined;
}

/**
 * Build the full per-brand context for one brand. The primary brand resolves its
 * creds from ENV (getBrandCredentials), so passing undefined ytCreds there makes
 * the youtube.ts helpers fall back to env — i.e. byte-identical to today.
 */
async function buildBrandContext(brand: BrandRecord, primaryId: string): Promise<BrandContext> {
  const creds = await getBrandCredentials(brand.id);
  const prefs = await readPreferencesForBrand(brand.id);
  return {
    brandId:    brand.id,
    isPrimary:  brand.isPrimary,
    primaryId,
    igToken:    creds.igToken,
    igAcctId:   creds.igAcctId,
    igUsername: (creds.igUsername || OWN_USERNAME).toLowerCase(),
    fbPageId:   creds.fbPageId,
    ytCreds:    brand.isPrimary ? undefined : ytCredsFor(creds),
    hasInstagram: brand.hasInstagram || !!(creds.igToken && creds.igAcctId),
    hasYouTube:   brand.hasYouTube   || !!(creds.ytClientId && creds.ytRefreshToken) || (brand.isPrimary && isYouTubeConfigured()),
    prefs,
  };
}

// Build the primary brand's context on demand. Used by exported entry points
// (scheduleAutoStory / runAutoGeneratePosts / runAutoGenerateYouTube) when an
// external caller doesn't supply a context — preserves single-account behaviour.
async function getPrimaryBrandContext(): Promise<BrandContext> {
  const primaryId = await getPrimaryBrandId();
  const brands = await listBrands();
  const primary = brands.find((b) => b.isPrimary)
    ?? { id: primaryId, label: "Primary", isPrimary: true, active: true,
         igUsername: "", ytChannelTitle: "", hasInstagram: false, hasYouTube: false } as BrandRecord;
  return buildBrandContext(primary, primaryId);
}

// Normalise the dual call shapes of the per-brand functions. The new engine passes
// (ctx, errors); legacy API-route callers pass (errors, igToken, igAcctId) and mean
// "the primary brand". Returns a resolved { ctx, errors } either way.
async function normalizeBrandArgs(
  a: BrandContext | string[],
  b: string[] | string,
): Promise<{ ctx: BrandContext; errors: string[] }> {
  if (Array.isArray(a)) {
    // Legacy form: (errors, igToken, igAcctId). Build/return the primary context.
    return { ctx: await getPrimaryBrandContext(), errors: a };
  }
  return { ctx: a, errors: (b as string[]) ?? [] };
}

// ── null == primary DB filtering ──────────────────────────────────────────────
// Contract: a NULL brandId on Post/ScheduledPost/Comment/Analytics rows means
// "the primary brand". When operating AS the primary brand we must match rows where
// brandId IS NULL *or* brandId == primaryId. For a non-primary brand we match that
// brand's id exactly. Returns a Prisma where-fragment to spread into queries.
function brandFilter(ctx: BrandContext): Record<string, unknown> {
  if (ctx.isPrimary) {
    return { OR: [{ brandId: null }, { brandId: ctx.primaryId }] };
  }
  return { brandId: ctx.brandId };
}

// The brandId value to STAMP on rows this brand creates.
//   • PRIMARY brand → null. This keeps the primary path's DB writes byte-identical
//     to today (rows have always had brandId == NULL, and brandFilter matches NULL
//     OR primaryId for the primary brand, so reads are unaffected either way).
//   • NON-PRIMARY brand → its real id, so its rows are isolated from the primary.
function brandIdForWrite(ctx: BrandContext): string | null {
  return ctx.isPrimary ? null : ctx.brandId;
}

// Stamp brandId onto a Comment row created via claimCommentForReply (which can't
// take a brandId). No-op for the primary brand (rows stay NULL, exactly as today).
async function tagCommentBrand(ctx: BrandContext, instagramCommentId: string): Promise<void> {
  if (ctx.isPrimary) return;
  await prisma.comment.updateMany({
    where: { instagramCommentId },
    data:  { brandId: ctx.brandId } as any,
  }).catch(() => {});
}

// Per-brand own-comment check (Instagram). Mirrors the module-level isOwnComment but
// uses THIS brand's igAcctId / fbPageId / igUsername instead of env consts.
function isOwnCommentForBrand(
  ctx: BrandContext,
  c: { username?: string; from?: { id?: string; username?: string } },
): boolean {
  const fromId = c.from?.id ?? "";
  if (fromId && ((ctx.igAcctId && fromId === ctx.igAcctId) || (ctx.fbPageId && fromId === ctx.fbPageId))) {
    return true;
  }
  const uname = (c.username ?? c.from?.username ?? "").toLowerCase();
  return uname === ctx.igUsername;
}

// --- Get a real user ID for ActivityLog FK (falls back to skip logging) -------
let _systemUserId: string | null = null;
async function getSystemUserId(): Promise<string | null> {
  if (_systemUserId) return _systemUserId;
  try {
    const user = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
    _systemUserId = user?.id ?? null;
    return _systemUserId;
  } catch {
    return null;
  }
}

// Silent activity log -- never throws, never blocks the main operation
async function safeLog(data: {
  action: string; entity: string; entityId: string; metadata: object;
}) {
  try {
    const userId = await getSystemUserId();
    if (!userId) return; // no users in DB yet -- skip silently
    await prisma.activityLog.create({ data: { userId, ...data, metadata: data.metadata as any } });
  } catch {
    // swallow -- activity logging is best-effort
  }
}

// ── Topic rotation + auto-expansion ──────────────────────────────────────────
// Every topic ever used (for stories or posts) is recorded in ActivityLog as
// action "AUTO_TOPIC_USED" with entity = "story" | "post" and entityId = topic.
// This gives an EXACT, persistent list of used topics so nothing repeats.

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function getUsedTopics(kind: "story" | "post"): Promise<Set<string>> {
  try {
    const logs = await prisma.activityLog.findMany({
      where:  { action: "AUTO_TOPIC_USED", entity: kind },
      select: { entityId: true },
    });
    return new Set(logs.map((l) => norm(l.entityId ?? "")).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

async function logTopicUsed(kind: "story" | "post", topic: string): Promise<void> {
  await safeLog({ action: "AUTO_TOPIC_USED", entity: kind, entityId: topic, metadata: { topic } });
}

// Ask the AI for NEW topics in the same style as the configured ones, excluding
// everything already used. Returns a de-duplicated, unused list (may be empty).
async function generateSimilarTopics(
  baseTopics: string[],
  usedTopics: Set<string>,
  count = 12,
  brand?: BrandConfig | null,
): Promise<string[]> {
  try {
    const ai = await getAIClient();
    const usedList = [...usedTopics];
    const niche  = brand?.niche?.trim() || "this account's topic";
    const handle = brand ? atHandle(brand) : "this account";
    const prompt = `You manage a ${niche} Instagram account (${handle}).

EXISTING TOPIC STYLE (match this style, tone, and subject area):
${baseTopics.map((t) => `- ${t}`).join("\n")}

ALREADY USED — never repeat, rephrase, or closely paraphrase any of these:
${usedList.length ? usedList.map((t) => `- ${t}`).join("\n") : "- (none yet)"}

Generate ${count} BRAND-NEW ${niche} content topics in the same style and subject area as the existing ones. Each must be a genuinely DIFFERENT SUBJECT/THEME from every topic above — not a reworded angle on the same theme (e.g. if "morning routine" is used, do NOT return "the first hour of your day"). Each topic must also be distinct from the others you return.
Return ONLY a JSON array of plain topic strings. No numbering, no commentary.`;
    const raw = await ai.generateContent(
      prompt,
      `You are a ${niche} content strategist. Return ONLY a valid JSON array of topic strings.`,
      900,
    );
    const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    const match   = cleaned.match(/\[[\s\S]*\]/);
    const arr     = JSON.parse(match ? match[0] : cleaned) as unknown[];
    const baseSet = new Set(baseTopics.map(norm));
    const seen    = new Set<string>();
    const out: string[] = [];
    for (const item of arr) {
      const t = String(item ?? "").trim();
      const n = norm(t);
      if (!t || seen.has(n) || usedTopics.has(n) || baseSet.has(n)) continue;
      seen.add(n);
      out.push(t);
    }
    return out;
  } catch (err) {
    console.warn("[Topics] AI topic expansion failed:", String(err));
    return [];
  }
}

/**
 * Pick the next topic for a story/post run.
 * Order of preference:
 *   1. A configured topic that has NOT been used yet.
 *   2. If all configured topics are used → AI-generate fresh similar topics
 *      (excluding everything used) and pick one.
 *   3. Absolute last resort (AI unavailable): least-recently used configured topic.
 * `extraUsed` lets a single multi-post run avoid picking the same topic twice.
 * The chosen topic is logged as used (unless dryLog=true) so it never repeats.
 */
async function pickNextTopic(
  kind: "story" | "post",
  configured: string[],
  extraUsed: Set<string> = new Set(),
  brand?: BrandConfig | null,
): Promise<string | null> {
  if (!configured.length) return null;

  const used = await getUsedTopics(kind);
  for (const e of extraUsed) used.add(norm(e));

  // 1. Unused configured topic
  let pool = configured.filter((t) => !used.has(norm(t)));

  // 2. All configured used → generate fresh similar topics
  if (pool.length === 0) {
    console.log(`[Topics] All ${configured.length} configured ${kind} topics used — generating fresh similar topics`);
    const fresh = await generateSimilarTopics(configured, used, 12, brand);
    pool = fresh.filter((t) => !used.has(norm(t)));
    if (pool.length) {
      console.log(`[Topics] Generated ${pool.length} new ${kind} topics, e.g. "${pool[0]}"`);
    }
  }

  // 3. Last resort — AI unavailable and everything used: reuse configured
  //    (still avoid anything used this run) to never block content creation.
  if (pool.length === 0) {
    pool = configured.filter((t) => !extraUsed.has(norm(t)));
    if (pool.length === 0) pool = configured;
    console.warn(`[Topics] Falling back to configured ${kind} topic (could not generate new ones)`);
  }

  const topic = pool[Math.floor(Math.random() * pool.length)];
  await logTopicUsed(kind, topic);
  return topic;
}

// -- Fetch with one automatic retry on network failure ------------------------
async function fetchWithRetry(url: string, opts?: RequestInit, retries = 1): Promise<Response> {
  try {
    return await fetch(url, opts);
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000)); // wait 2 s then retry
      return fetchWithRetry(url, opts, retries - 1);
    }
    throw err;
  }
}

// --- Summary returned to caller -----------------------------------------------
export interface CatchupResult {
  scheduledPublished: number;
  scheduledFailed:    number;
  newComments:        number;
  commentsReplied:    number;  // actual replies sent (new + retried)
  dmsReplied:         number;
  youtubeCommentsReplied?: number; // Grok replies sent on YouTube videos
  errors:             string[];
  ranAt:              string;
}

// --- Helper: get Page Access Token --------------------------------------------
// Priority:
//   1. FACEBOOK_PAGE_ACCESS_TOKEN env var (long-lived, set once in .env.local)
//      — PRIMARY brand only. A non-primary brand must NOT borrow the primary's
//        env page token; it resolves its own from its igToken/page below.
//   2. /me/accounts exchange (works with Facebook User tokens)
//   3. /{PAGE_ID}?fields=access_token (legacy fallback)
//   4. igToken as-is (last resort)
//
// `fbPageId` defaults to the env FACEBOOK_PAGE_ID (the primary brand's page) so the
// single-account/legacy call site `getPageToken(igToken)` is byte-for-byte unchanged.
// `useEnvPageToken` gates the env FACEBOOK_PAGE_ACCESS_TOKEN shortcut — true for the
// primary brand (default), false for non-primary brands.
export async function getPageToken(
  igToken: string,
  fbPageId: string = PAGE_ID,
  useEnvPageToken = true,
): Promise<string> {
  // 1. Prefer explicit long-lived page token from env (PRIMARY brand only).
  if (useEnvPageToken && process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    return process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  }
  try {
    // 2. Try /me/accounts -- works when igToken is a Facebook User token
    const accountsRes  = await fetchWithRetry(`${GRAPH_BASE}/me/accounts?access_token=${igToken}`);
    const accountsData = await accountsRes.json();
    if (!accountsData.error && (accountsData.data ?? []).length > 0) {
      const page = (accountsData.data as Array<{ id: string; access_token: string }>)
        .find((p) => p.id === fbPageId) ?? accountsData.data[0];
      if (page?.access_token) return page.access_token;
    }
    // 3. Legacy: /{fbPageId}?fields=access_token
    const directRes  = await fetchWithRetry(`${GRAPH_BASE}/${fbPageId}?fields=access_token&access_token=${igToken}`);
    const directData = await directRes.json();
    if (!directData.error && directData.access_token) return directData.access_token;
  } catch (err) {
    console.warn("[Catchup] getPageToken error:", String(err));
  }
  // 4. Fall back to whatever token we have
  return igToken;
}

// --- Helper: poll container until FINISHED ------------------------------------
// Fix: when token can't query container status (auth error code 100/33),
// skip polling and wait a fixed delay before attempting publish.
// isVideo=true uses a longer fixed wait (60s) since videos take longer to process.
async function waitForContainer(containerId: string, igToken: string, isVideo = false): Promise<void> {
  const initialDelay = isVideo ? 15_000 : 8_000;  // videos need a head start
  const interval     = 6_000;
  const maxWaitMs    = isVideo ? 180_000 : 120_000; // 3 min for video, 2 min for image

  await new Promise((r) => setTimeout(r, initialDelay));

  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  let authErrorCount = 0;

  while (Date.now() < deadline) {
    attempt++;
    const res  = await fetchWithRetry(
      `${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${igToken}`
    );
    const data = await res.json();

    if (data.error) {
      const code = data.error.code;
      if (code === 100 || code === 10 || code === 190) {
        authErrorCount++;
        console.warn(`[Catchup] Container status blocked (code ${code}) — skipping poll`);
        if (authErrorCount >= 2) {
          // Videos need longer to process — wait 60s, images 30s
          const blindWait = isVideo ? 60_000 : 30_000;
          console.log(`[Catchup] Container ${containerId}: waiting ${blindWait / 1000}s blind (${isVideo ? "video" : "image"}) before publish`);
          await new Promise((r) => setTimeout(r, blindWait));
          return;
        }
      } else {
        throw new Error(`Container status error: ${data.error.message}`);
      }
    }

    const statusCode: string = data.status_code ?? "UNKNOWN";
    const statusMsg:  string = data.status      ?? "";
    console.log(`[Catchup] Container ${containerId} -- ${statusCode}${statusMsg ? ` (${statusMsg})` : ""} | attempt ${attempt}`);

    if (statusCode === "FINISHED") return;
    if (statusCode === "ERROR")    throw new Error(`Instagram rejected the media: ${statusMsg || "check video/image format and specs"}`);
    if (statusCode === "EXPIRED")  throw new Error(`Instagram container expired -- media URL unreachable by Meta servers`);

    await new Promise((r) => setTimeout(r, interval));
  }

  // Timed out — try publish anyway
  console.warn(`[Catchup] Container ${containerId} poll timed out — attempting publish anyway`);
}

// Detect video by URL extension or Cloudinary video path
function isVideoMediaUrl(url: string): boolean {
  return /\.(mp4|mov|webm|avi|m4v)(\?|#|$)/i.test(url) ||
    url.includes("/video/upload/"); // Cloudinary video URL format
}

// --- Helper: publish a single media container --------------------------------
// isStory=true -> uses media_type=STORIES (no caption, vertical 9:16 format)
async function igPublish(
  mediaUrl: string,
  caption: string,
  igToken: string,
  igAcctId: string,
  isStory = false,
): Promise<string> {
  caption = capIgCaption(caption);
  // Step 1 -- create container
  const isVideoMedia = isVideoMediaUrl(mediaUrl);
  let containerParams: Record<string, string>;

  if (isStory) {
    containerParams = { image_url: mediaUrl, media_type: "STORIES", access_token: igToken };
  } else if (isVideoMedia) {
    // Video reels: use video_url + REELS media_type
    containerParams = { video_url: mediaUrl, media_type: "REELS", caption, access_token: igToken };
  } else {
    containerParams = { image_url: mediaUrl, caption, access_token: igToken };
  }

  console.log(`[Catchup/igPublish] Creating ${isStory ? "STORY" : isVideoMedia ? "REEL" : "IMAGE"} container for ${mediaUrl.slice(-60)}`);
  const p1 = new URLSearchParams(containerParams);
  const r1 = await fetchWithRetry(`${GRAPH_BASE}/${igAcctId}/media?${p1}`, { method: "POST" });
  const d1 = await r1.json();
  if (d1.error) {
    // Log full IG error for diagnosis
    console.error(`[Catchup/igPublish] Container creation failed:`, JSON.stringify(d1.error));
    throw new Error(`IG container error (code ${d1.error.code ?? "?"}): ${d1.error.message}`);
  }
  console.log(`[Catchup/igPublish] Container created: ${d1.id}`);

  // Step 2 -- wait for Instagram to finish processing (videos need longer)
  await waitForContainer(d1.id, igToken, isVideoMedia);

  // Step 3 -- publish
  const p2 = new URLSearchParams({ creation_id: d1.id, access_token: igToken });
  const r2 = await fetchWithRetry(`${GRAPH_BASE}/${igAcctId}/media_publish?${p2}`, { method: "POST" });
  const d2 = await r2.json();
  if (d2.error) {
    console.error(`[Catchup/igPublish] Publish failed:`, JSON.stringify(d2.error));
    throw new Error(`IG publish error (code ${d2.error.code ?? "?"}): ${d2.error.message}`);
  }

  console.log(`[Catchup/igPublish] Published successfully: ${d2.id}`);
  return d2.id as string;
}

// --- Helper: publish a multi-image CAROUSEL ----------------------------------
// Creates one carousel-item container per slide image, then a CAROUSEL parent
// container with all children, then publishes it.
async function igPublishCarousel(
  slideUrls: string[],
  caption: string,
  igToken: string,
  igAcctId: string,
): Promise<string> {
  caption = capIgCaption(caption);
  // Instagram rejects duplicate images and caps carousels at 20 items
  const uniqueUrls = [...new Set(slideUrls)].slice(0, 20);
  if (uniqueUrls.length < 2) throw new Error(`Carousel needs ≥2 images, got ${uniqueUrls.length}`);

  // 1. Create item containers SERIALLY (parallel triggers IG rate-limit "Fatal" errors)
  const childIds: string[] = [];
  for (const url of uniqueUrls) {
    try {
      const p = new URLSearchParams({ image_url: url, is_carousel_item: "true", access_token: igToken });
      const r = await fetchWithRetry(`${GRAPH_BASE}/${igAcctId}/media?${p}`, { method: "POST" });
      const d = await r.json();
      if (d.error) { console.warn(`[Catchup/carousel] item failed (${url.slice(-18)}): ${d.error.message}`); continue; }
      childIds.push(d.id);
      await new Promise((res) => setTimeout(res, 1500));
    } catch (e: any) {
      console.warn(`[Catchup/carousel] item exception (${url.slice(-18)}): ${e?.message}`);
    }
  }
  // Completeness gate: don't publish a truncated carousel as "success". Require
  // essentially all requested slides to register — allow a small tolerance for the
  // odd IG hiccup: at least ceil(80% of requested) AND never fewer than 2. Falling
  // short THROWS so the post fails and is retried with the full slide set rather
  // than silently publishing a partial carousel.
  const minRequired = Math.max(2, Math.ceil(uniqueUrls.length * 0.8));
  if (childIds.length < minRequired) {
    throw new Error(`Only ${childIds.length}/${uniqueUrls.length} carousel items registered (need ≥${minRequired}) — failing to retry with the full set`);
  }

  // 2. Give Instagram a moment to register all item containers
  await new Promise((res) => setTimeout(res, 2000));

  // 3. Create the CAROUSEL parent container
  const pc = new URLSearchParams({ media_type: "CAROUSEL", children: childIds.join(","), caption, access_token: igToken });
  const rc = await fetchWithRetry(`${GRAPH_BASE}/${igAcctId}/media?${pc}`, { method: "POST" });
  const dc = await rc.json();
  if (dc.error) throw new Error(`IG carousel container error (code ${dc.error.code ?? "?"}): ${dc.error.message}`);
  console.log(`[Catchup/carousel] Container created with ${childIds.length} slides: ${dc.id}`);

  await waitForContainer(dc.id, igToken, false);

  // 4. Publish
  const pp = new URLSearchParams({ creation_id: dc.id, access_token: igToken });
  const rp = await fetchWithRetry(`${GRAPH_BASE}/${igAcctId}/media_publish?${pp}`, { method: "POST" });
  const dp = await rp.json();
  if (dp.error) throw new Error(`IG carousel publish error (code ${dp.error.code ?? "?"}): ${dp.error.message}`);
  console.log(`[Catchup/carousel] Published successfully: ${dp.id}`);
  return dp.id as string;
}

// --- Forced YouTube Short for platform="both" ---------------------------------
// Best-effort: publishes a Short regardless of the global mirror toggle (that's
// what "both" means). Logs + continues on throw; stores youtubeVideoId on success.
// Idempotent — skips if youtubeVideoId is already set.
async function forceYouTubeShort(args: {
  ctx:  BrandContext;
  sp:   { id: string; postId: string | null; title: string; content: string; hashtags: string[]; postType?: string | null; youtubeVideoId?: string | null };
  post: any | null;
}): Promise<void> {
  const { ctx, sp, post } = args;
  try {
    if (sp.youtubeVideoId) return;             // already mirrored (in-memory)
    if (!isYouTubeConfigured(ctx.ytCreds)) return; // no credentials → silently skip

    // Idempotency: re-read the freshest youtubeVideoId from the DB (not the stale
    // in-memory sp) so retries/races never produce a duplicate upload.
    const fresh = await prisma.scheduledPost.findUnique({
      where: { id: sp.id }, select: { youtubeVideoId: true },
    }).catch(() => null);
    if (fresh?.youtubeVideoId) return;

    const yt = ctx.prefs.youtube;
    const ytPost = post ?? {
      // Include the linked post id (when available) so buildRichCaption's cache key
      // matches the IG-side caption → byte-identical caption on both platforms.
      ...(sp.postId ? { id: sp.postId } : {}),
      type:     sp.postType || "EDUCATIONAL",
      title:    sp.title,
      content:  sp.content,
      hashtags: sp.hashtags ?? [],
    };
    const { videoId } = await publishPostToYouTubeShort(ytPost as any, {
      privacy:           yt?.privacy ?? "public",
      secondsPerImage:   yt?.secondsPerImage ?? 5,
      descriptionSuffix: yt?.descriptionSuffix ?? "",
      voiceover:         yt?.voiceover ?? false,
      voiceoverVoice:    yt?.voiceoverVoice ?? "daniel",
      burnCaptions:      yt?.burnCaptions ?? false,
    }, ctx.ytCreds);
    await prisma.scheduledPost.update({ where: { id: sp.id }, data: { youtubeVideoId: videoId } }).catch(() => {});
    if (sp.postId) {
      await prisma.post.updateMany({ where: { id: sp.postId }, data: { youtubeVideoId: videoId } }).catch(() => {});
    }
    await safeLog({ action: "YOUTUBE_PUBLISHED", entity: "ScheduledPost", entityId: sp.id,
      metadata: { youtubeVideoId: videoId, platform: "both", forced: true, catchup: true,
                  title: sp.title, url: `https://youtube.com/shorts/${videoId}` } });
    console.log(`[Catchup] (both) Mirrored SP ${sp.id} → https://youtube.com/shorts/${videoId}`);
    notifyYouTubePublished({ spId: sp.id, videoId, title: sp.title })
      .catch((e: any) => console.warn("[Catchup] (both) publish notify failed:", e?.message));
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.warn(`[Catchup] (both) Forced YouTube publish failed for SP ${args.sp.id}:`, msg);
    logSystemErrorEvent(`YouTube (both) publish failed: ${args.sp.title}`, msg);
    notifyYouTubeFailed({ spId: args.sp.id, title: args.sp.title, error: msg, context: "YouTube (both)" })
      .catch((e: any) => console.warn("[Catchup] (both) failure notify failed:", e?.message));
  }
}

// Given a list of "HH:MM" times and a timezone, return the UTC Date of the NEXT
// upcoming occurrence (today if a slot is still ahead, otherwise tomorrow's earliest
// slot). Used to schedule a deferred Instagram Reel at the configured reel time(s).
function nextUpcomingTimeUTC(times: string[], tz: string): Date {
  const now = new Date();
  // Today's calendar date in the target tz.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const pp: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") pp[p.type] = parseInt(p.value, 10);
  const y = pp["year"]!, mo = pp["month"]!, d = pp["day"]!;

  const sorted = [...times].sort();
  // Earliest slot today that is still in the future.
  for (const t of sorted) {
    const [hh, mm] = t.split(":").map(Number);
    const cand = wallTimeToUTC(y, mo, d, hh, mm, tz);
    if (cand.getTime() > now.getTime()) return cand;
  }
  // All of today's slots have passed → earliest slot tomorrow.
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  // Re-derive tomorrow's tz-local calendar date.
  const tParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(tomorrow);
  const tpp: Record<string, number> = {};
  for (const p of tParts) if (p.type !== "literal") tpp[p.type] = parseInt(p.value, 10);
  const [hh, mm] = sorted[0].split(":").map(Number);
  return wallTimeToUTC(tpp["year"]!, tpp["month"]!, tpp["day"]!, hh, mm, tz);
}

// Today's tz-local calendar info: the weekday (0=Sun..6=Sat) and the [start,end)
// UTC window bounding the tz-local day. Used to (a) pick the right dailySchedule
// entry for today and (b) count how many deferred Reels were already scheduled for
// today's tz-day so each Short maps to a distinct reel slot.
function tzDayInfo(tz: string): { weekday: number; startUTC: Date; endUTC: Date } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(now);
  const pp: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") pp[p.type] = p.value;
  const y = parseInt(pp["year"], 10), mo = parseInt(pp["month"], 10), d = parseInt(pp["day"], 10);
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = WD[pp["weekday"]] ?? now.getUTCDay();
  // 00:00 today (tz) and 00:00 tomorrow (tz), both as UTC instants.
  const startUTC = wallTimeToUTC(y, mo, d, 0, 0, tz);
  const endUTC   = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);
  return { weekday, startUTC, endUTC };
}

// Robust tz-local weekday (0=Sun..6=Sat) for an arbitrary instant, using the same
// Intl short-name → index mapping as tzDayInfo. Replaces the locale/engine-fragile
// `new Date(d.toLocaleString("en-US",{timeZone})).getDay()` pattern (which depends on
// the runtime being able to re-parse a localized date string).
function tzWeekday(date: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short" })
    .formatToParts(date)
    .find((p) => p.type === "weekday")?.value ?? "";
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return WD[wd] ?? date.getUTCDay();
}

// Resolve the UTC Date for a SPECIFIC "HH:MM" slot on today's tz-day. If that slot
// has already passed today, fall back to nextUpcomingTimeUTC over the full slot list
// (so the Reel still lands on a real upcoming time rather than in the past).
function slotTimeUTC(slot: string, allSlots: string[], tz: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const pp: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") pp[p.type] = parseInt(p.value, 10);
  const [hh, mm] = slot.split(":").map(Number);
  const cand = wallTimeToUTC(pp["year"]!, pp["month"]!, pp["day"]!, hh, mm, tz);
  if (cand.getTime() > now.getTime()) return cand;
  return nextUpcomingTimeUTC(allSlots.length ? allSlots : [slot], tz);
}

// --- Cross-post a YouTube-native Short to Instagram as a Reel ------------------
// Best-effort: NEVER throws into the YouTube publish flow. Reuses the EXACT Short
// MP4 already rendered for YouTube (no re-render), uploads it to a public CDN, and
// publishes it as an Instagram Reel via igPublish (which auto-detects video → REELS).
// Stores the IG media id on the SP/Post (instagramPostId) without touching youtubeVideoId.
async function crossPostYouTubeShortToInstagramReel(args: {
  ctx:      BrandContext;
  sp:       { id: string; postId: string | null; title: string; content: string; hashtags: string[] };
  post:     any | null;
  mp4:      Buffer;
}): Promise<void> {
  const { ctx, sp, post, mp4 } = args;
  const { igToken, igAcctId } = ctx;
  try {
    if (!igToken || !igAcctId) return;

    // Build the Reel caption = the SAME unified rich caption used on YouTube (identical
    // text on both platforms). buildRichCaption is cached by post.id, so this returns
    // the byte-identical caption already generated during the YouTube publish — no
    // second AI call. Falls back to the prose/content caption only if generation fails.
    const hashtags  = (post?.hashtags ?? sp.hashtags ?? []).filter(Boolean) as string[];
    let baseText: string;
    try {
      baseText = await buildRichCaption({
        id:         post?.id ?? sp.postId ?? undefined,
        type:       post?.type ?? "EDUCATIONAL",
        title:      post?.title ?? sp.title,
        hook:       post?.hook ?? null,
        content:    post?.content ?? sp.content ?? "",
        cta:        post?.cta ?? null,
        reelScript: post?.reelScript ?? null,
        hashtags,
      });
    } catch {
      const storedCaption = post?.reelScript?.startsWith("CAPTION:")
        ? post.reelScript.slice(8).trim()
        : null;
      baseText = storedCaption ?? post?.content ?? sp.content ?? "";
    }
    const caption   = [baseText, hashtags.join(" ")].map((s) => s.trim()).filter(Boolean).join("\n\n");

    // Upload the rendered MP4 to a public URL so Instagram can fetch it.
    const videoUrl = await uploadVideoToStableCdn(mp4);
    if (!videoUrl) {
      console.warn(`[Catchup] (yt→IG) SP ${sp.id}: video CDN upload failed — skipping Reel cross-post`);
      return;
    }

    // ── DEFERRED Reel timing (Feature 2) ──────────────────────────────────────
    // When youtube.reelPublishTimes is NON-EMPTY, the Short publishes on its own
    // schedule but the Instagram Reel is DEFERRED: instead of publishing now, create a
    // PENDING ScheduledPost (platform "instagram", postType "REEL", mediaUrl = the CDN
    // video) scheduled for the next upcoming configured reel time in the brand's tz.
    // publishOverdueScheduled's IG branch then publishes it as a Reel (igPublish auto-
    // detects video→REELS), reusing the stored mediaUrl (no re-render) and deleting the
    // CDN url only AFTER it publishes. When the list is empty we fall through to the
    // immediate cross-post below (current behaviour).
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
    const tz = ctx.prefs.autoPost?.timezone || "Asia/Kolkata";
    const { weekday, startUTC, endUTC } = tzDayInfo(tz);

    // PER-DAY reel times (Feature 3): when TODAY's weekday has a Custom dailySchedule
    // entry with non-empty reelTimes, use those slots; else fall back to the GLOBAL
    // youtube.reelPublishTimes. Empty in both → immediate cross-post (unchanged).
    const dayEntry = Array.isArray(ctx.prefs.youtube?.dailySchedule)
      ? ctx.prefs.youtube!.dailySchedule!.find((e) => e && Number(e.day) === weekday)
      : undefined;
    const perDayReelTimes = (dayEntry?.reelTimes ?? []).filter((t) => HHMM.test(t));
    const globalReelTimes = (ctx.prefs.youtube?.reelPublishTimes ?? []).filter((t) => HHMM.test(t));
    const usingPerDay = perDayReelTimes.length > 0;
    const reelTimes   = usingPerDay ? perDayReelTimes : globalReelTimes;

    if (reelTimes.length) {
      // MULTI-SHORT slot mapping: count deferred Reels already scheduled for this
      // brand within today's tz-day window, then pick reelTimes[count] (clamped to the
      // last slot when more Shorts than slots). This spreads multiple Shorts across
      // DISTINCT reel times instead of stacking them all on the first slot.
      let slotIndex = 0;
      try {
        const alreadyDeferred = await prisma.scheduledPost.count({
          where: {
            postType:     "REEL",
            platform:     "instagram",
            status:       { in: ["PENDING", "PUBLISHED"] },
            scheduledFor: { gte: startUTC, lt: endUTC },
            ...brandFilter(ctx),
          },
        });
        slotIndex = Math.min(alreadyDeferred, reelTimes.length - 1);
      } catch {
        slotIndex = 0;
      }
      const chosenSlot = reelTimes[slotIndex];
      // Map BOTH per-day and global reel times by slot index so multiple Shorts spread
      // across DISTINCT slots (e.g. 2 Shorts + ["09:00","18:00"] → 09:00 and 18:00)
      // instead of stacking on the earliest. slotTimeUTC handles the chosen slot for
      // today and, if it already passed, falls back to the next upcoming slot in the
      // list (keeps the Reel on a real future time).
      const scheduledFor = slotTimeUTC(chosenSlot, reelTimes, tz);
      const userId = await getSystemUserId();
      if (!userId) {
        console.warn(`[Catchup] (yt→IG) SP ${sp.id}: no system userId — cannot defer Reel, publishing now instead`);
      } else {
        // Stash the full caption (text + hashtags) in `content` so the standalone IG
        // publish path (no postId) uses it verbatim. postType "REEL" keeps it out of
        // the STORY branch and out of the IG-feed daily-cap count (which only counts
        // null/non-STORY feed posts — REEL is non-null and non-STORY, but it carries a
        // pre-rendered video mediaUrl so it never re-renders).
        const deferred = await prisma.scheduledPost.create({
          data: {
            userId,
            postId:      null,
            title:       sp.title,
            content:     caption,
            hashtags:    [],
            mediaUrl:    videoUrl,
            scheduledFor,
            timezone:    tz,
            isRecurring: false,
            status:      "PENDING",
            postType:    "REEL",
            platform:    "instagram",
            brandId:     brandIdForWrite(ctx),
          } as any,
        });
        await safeLog({ action: "POST_SCHEDULED", entity: "ScheduledPost", entityId: deferred.id,
          metadata: { deferredReel: true, crossPostedFrom: "youtube", scheduledFor: scheduledFor.toISOString(),
                      sourceSpId: sp.id, reelTimeSource: usingPerDay ? "per-day" : "global",
                      reelSlotIndex: usingPerDay ? slotIndex : undefined } });
        console.log(`[Catchup] (yt→IG) Deferred SP ${sp.id} Short → Instagram Reel scheduled ${scheduledFor.toISOString()} (SP ${deferred.id})`);
        // IMPORTANT: do NOT delete the CDN url here — the deferred publish needs it.
        return;
      }
    }

    // igPublish auto-detects the video URL → media_type=REELS.
    const igMediaId = await igPublish(videoUrl, caption, igToken, igAcctId, false);

    // Store the IG media id WITHOUT overwriting youtubeVideoId.
    await prisma.scheduledPost.update({ where: { id: sp.id }, data: { instagramPostId: igMediaId } }).catch(() => {});
    if (sp.postId) {
      await prisma.post.updateMany({ where: { id: sp.postId }, data: { instagramPostId: igMediaId } }).catch(() => {});
    }
    await safeLog({ action: "POST_PUBLISHED", entity: "ScheduledPost", entityId: sp.id,
      metadata: { instagramPostId: igMediaId, crossPostedFrom: "youtube", reel: true } });
    console.log(`[Catchup] (yt→IG) Cross-posted SP ${sp.id} Short to Instagram Reel → ${igMediaId}`);

    // Free CDN storage after IG has cached it (best-effort).
    void deleteFromCloudinary(videoUrl);
  } catch (err: any) {
    // A Reel failure must NEVER fail the YouTube publish — log + continue.
    const msg = err?.message ?? String(err);
    console.warn(`[Catchup] (yt→IG) Instagram Reel cross-post failed for SP ${args.sp.id}:`, msg);
    logSystemErrorEvent(`YouTube→IG Reel cross-post failed: ${args.sp.title}`, msg);
  }
}

// --- 1. Publish overdue scheduled posts ---------------------------------------
// Overloads: the multi-brand engine calls (ctx, errors); legacy callers (API routes
// owned by other agents) still call (errors, igToken, igAcctId) and operate as the
// primary brand. The legacy form builds the primary context from ENV internally.
export async function publishOverdueScheduled(ctx: BrandContext, errors: string[]): Promise<{ published: number; failed: number }>;
export async function publishOverdueScheduled(errors: string[], igToken: string, igAcctId: string): Promise<{ published: number; failed: number }>;
export async function publishOverdueScheduled(
  a: BrandContext | string[],
  b: string[] | string,
  _c?: string,
): Promise<{ published: number; failed: number }> {
  const { ctx, errors } = await normalizeBrandArgs(a, b);
  const { igToken, igAcctId } = ctx;
  const brand = ctx.prefs.brand;
  let published = 0, failed = 0;

  // Bounded retry for transiently-FAILED posts. retryCount is incremented on every
  // failure (see the catch blocks below); once it hits MAX the row stays FAILED
  // (terminal) so we never loop forever. A simple per-retry backoff (gated on time
  // since scheduledFor, since ScheduledPost has no updatedAt) keeps a row from being
  // retried on every 30s tick.
  const MAX_PUBLISH_RETRIES = 3;
  const RETRY_BACKOFF_MINUTES = 10;

  // NOTE: We no longer bail out when IG credentials are missing — youtube-only
  // scheduled posts must still publish. The Instagram publish branches below stay
  // gated on igToken/igAcctId; only the YouTube branch runs without them.
  const igConfigured = !!(igToken && igAcctId);

  // -- Self-heal: reap stuck "__CLAIMING__" locks ---------------------------------
  // The claim guard below flips PENDING→FAILED("__CLAIMING__:<ts>") to lock an entry
  // while it publishes. If the process restarts mid-publish, the row stays locked
  // forever and is never retried. Reset any such lock whose CLAIM is older than ~10
  // min back to PENDING. CRITICAL: we measure the CLAIM age (the <ts> embedded in the
  // sentinel), NOT the row's createdAt — keying on createdAt instantly reaped the
  // active claim of any post older than 10 min mid-publish, which re-queued it for a
  // concurrent sweep and produced DUPLICATE Instagram posts.
  const claimCutoffMs = Date.now() - 10 * 60 * 1000;
  const stuckClaims = await prisma.scheduledPost.findMany({
    where:  { status: "FAILED", error: { startsWith: "__CLAIMING__" }, ...brandFilter(ctx) },
    select: { id: true, error: true },
  }).catch((e: any) => {
    // Don't silently swallow — if this read fails, stuck claims go un-reaped and
    // those posts never publish, with no signal otherwise.
    console.warn("[Catchup] Claim-lock self-heal: stuck-claim read failed (stuck posts may not be reaped):", e?.message ?? e);
    return [] as { id: string; error: string | null }[];
  });
  const reapIds = stuckClaims
    .filter((s) => {
      const ts = Number(String(s.error ?? "").split(":")[1] ?? 0);
      // No embedded timestamp (legacy "__CLAIMING__") OR claimed >10 min ago → reap.
      return !ts || ts < claimCutoffMs;
    })
    .map((s) => s.id);
  if (reapIds.length > 0) {
    const reaped = await prisma.scheduledPost.updateMany({
      where: { id: { in: reapIds }, status: "FAILED", error: { startsWith: "__CLAIMING__" } },
      data:  { status: "PENDING", error: null },
    }).catch(() => ({ count: 0 }));
    if (reaped.count > 0) {
      console.log(`[Catchup] Claim-lock self-heal: reset ${reaped.count} stuck claim(s) (claimed >10min ago) to PENDING`);
    }
  }

  const now = new Date();
  const pending = await prisma.scheduledPost.findMany({
    where: {
      status:       "PENDING",
      scheduledFor: { lte: now },
      ...brandFilter(ctx),
    },
    orderBy: { scheduledFor: "asc" },
  });

  // ── Second pass: retry transiently-FAILED posts (bounded) ──────────────────────
  // A FAILED row is retried only while retryCount < MAX, it's due, and its error is
  // NOT the transient claim sentinel (those are owned by the claim/self-heal path
  // above). A per-retry backoff gates how often we re-attempt: since ScheduledPost
  // has no updatedAt, we require the row to be at least retryCount*BACKOFF minutes
  // past its scheduledFor before each retry — older failures back off progressively.
  const failedRetryable = await prisma.scheduledPost.findMany({
    where: {
      status:       "FAILED",
      scheduledFor: { lte: now },
      retryCount:   { lt: MAX_PUBLISH_RETRIES },
      NOT:          { error: { startsWith: "__CLAIMING__" } },
      ...brandFilter(ctx),
    },
    orderBy: { scheduledFor: "asc" },
  }).then((rows) =>
    rows.filter((r) => {
      // Backoff: wait retryCount*BACKOFF minutes (from scheduledFor) before each retry.
      const readyAt = r.scheduledFor.getTime() + r.retryCount * RETRY_BACKOFF_MINUTES * 60 * 1000;
      return now.getTime() >= readyAt;
    }),
  ).catch((e: any) => {
    console.warn("[Catchup] FAILED-retry read failed (failed posts may not be retried):", e?.message ?? e);
    return [] as typeof pending;
  });

  if (failedRetryable.length > 0) {
    console.log(`[Catchup] Retrying ${failedRetryable.length} transiently-FAILED post(s) (retryCount < ${MAX_PUBLISH_RETRIES})`);
  }

  const overdue = [...pending, ...failedRetryable];

  for (const sp of overdue) {
    try {
      // ── Guard 1: skip if the linked Post was already (or is being) published ──
      // When a user clicks "Publish Now" on a post, both the Post record and the
      // ScheduledPost record exist. The manual publish route marks Post as PUBLISHED.
      // The scheduler must not publish the same content again.
      //
      // BUG FIX (double-publish): the old guard only skipped when Post.status was
      // exactly "PUBLISHED". But the manual publish is SLOW (image render + IG/YT API
      // = 30-60s+), and it sets youtubeVideoId/instagramPostId on the Post as it goes.
      // If this scheduler run hit the window AFTER the manual route stamped a media id
      // but BEFORE it flipped status to PUBLISHED, the guard missed it and the
      // scheduler published a duplicate. We now ALSO skip when the linked Post already
      // carries an instagramPostId or youtubeVideoId — i.e. it has been (or is being)
      // published — and finalize this SP to that id instead of re-publishing.
      if (sp.postId) {
        const linkedPost = await prisma.post.findUnique({
          where:  { id: sp.postId },
          select: { status: true, instagramPostId: true, youtubeVideoId: true },
        });
        const alreadyPublished =
          linkedPost?.status === "PUBLISHED" ||
          !!linkedPost?.instagramPostId ||
          !!linkedPost?.youtubeVideoId;
        if (alreadyPublished) {
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  {
              status:          "PUBLISHED",
              instagramPostId: linkedPost?.instagramPostId ?? undefined,
              youtubeVideoId:  linkedPost?.youtubeVideoId ?? undefined,
              publishedAt:     new Date(),
            },
          }).catch(() => {});
          published++;
          console.log(`[Catchup] Skipping SP ${sp.id} — linked post already published/in-flight (ig:${linkedPost?.instagramPostId ?? "—"} yt:${linkedPost?.youtubeVideoId ?? "—"})`);
          continue;
        }
      }

      // ── Guard 2: atomic claim — prevents two concurrent scheduler calls ────
      // Both /api/scheduler/check (every 30 s) and runCatchup (every 5 min) call
      // publishOverdueScheduled. If they overlap, both could pick up the same
      // PENDING ScheduledPost and publish twice. We atomically flip the status to
      // FAILED with a sentinel error to "lock" this entry. Only the call that
      // gets count=1 proceeds; the other sees count=0 and skips.
      // On success the entry is reset to PUBLISHED; on real failure the catch
      // block overwrites the sentinel with the real error message.
      // The sentinel embeds the CLAIM time so the self-heal reaper can tell an
      // actively-publishing claim from a genuinely stuck one by CLAIM AGE — not by the
      // row's createdAt (which would instantly reap any post older than 10 min while
      // it's mid-publish, causing a re-claim and a DUPLICATE Instagram post).
      // PENDING rows claim from PENDING; FAILED-retry rows claim from their EXACT
      // failed snapshot (same retryCount + still NOT a claim sentinel) so the same
      // atomic guard applies — a concurrent run that already claimed/changed the row
      // gets count=0 and skips. Both paths converge on the FAILED("__CLAIMING__:<ts>")
      // lock used by the publish flow, the self-heal reaper, and the catch block.
      const claimWhere =
        sp.status === "FAILED"
          ? {
              id:         sp.id,
              status:     "FAILED" as const,
              retryCount: sp.retryCount,
              NOT:        { error: { startsWith: "__CLAIMING__" } },
            }
          : { id: sp.id, status: "PENDING" as const };
      const claimed = await prisma.scheduledPost.updateMany({
        where: claimWhere,
        data:  { status: "FAILED", error: `__CLAIMING__:${Date.now()}` },
      }).catch(() => ({ count: 0 }));
      if (claimed.count === 0) {
        console.log(`[Catchup] Skipping SP ${sp.id} — already claimed by a concurrent scheduler call`);
        continue;
      }

      // ── Platform routing ───────────────────────────────────────────────────
      // Determine the target platform for this entry. Default "instagram"; if the
      // ScheduledPost says "instagram" but its linked Post specifies something else,
      // prefer the linked Post's platform.
      let platform = (sp as any).platform || "instagram";
      let routedPost: any = null;
      if (sp.postId) {
        routedPost = await prisma.post.findUnique({ where: { id: sp.postId } }).catch(() => null);
        if (platform === "instagram" && routedPost?.platform && routedPost.platform !== "instagram") {
          platform = routedPost.platform;
        }
      }

      // ── YOUTUBE-only branch ────────────────────────────────────────────────
      // Publish a Short directly from the post content — never touch the IG flow.
      if (platform === "youtube") {
        if (!isYouTubeConfigured(ctx.ytCreds)) {
          console.warn(`[Catchup] SP ${sp.id} is youtube-only but YouTube is not configured — marking FAILED`);
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  { status: "FAILED", error: "YouTube not configured", retryCount: { increment: 1 } },
          }).catch(() => {});
          failed++;
          continue;
        }
        // Idempotency: re-read the freshest youtubeVideoId from the DB (not the
        // stale in-memory sp). If a video already exists (uploaded by a concurrent
        // run / earlier retry), just finalise instead of uploading a duplicate.
        const freshYt = await prisma.scheduledPost.findUnique({
          where: { id: sp.id }, select: { youtubeVideoId: true },
        }).catch(() => null);
        const existingVideoId = freshYt?.youtubeVideoId ?? sp.youtubeVideoId;
        if (existingVideoId) {
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  { status: "PUBLISHED", publishedAt: new Date(), youtubeVideoId: existingVideoId, error: null },
          }).catch(() => {});
          if (sp.postId) {
            await prisma.post.updateMany({
              where: { id: sp.postId },
              data:  { status: "PUBLISHED", youtubeVideoId: existingVideoId, publishedAt: new Date() },
            }).catch(() => {});
          }
          published++;
          continue;
        }
        try {
          const yt = ctx.prefs.youtube;
          const ytPost = routedPost ?? {
            type:       sp.postType || "EDUCATIONAL",
            title:      sp.title,
            content:    sp.content,
            hashtags:   sp.hashtags ?? [],
          };
          const { videoId, mp4 } = await publishPostToYouTubeShort(ytPost as any, {
            privacy:           yt?.privacy ?? "public",
            secondsPerImage:   yt?.secondsPerImage ?? 5,
            descriptionSuffix: yt?.descriptionSuffix ?? "",
            voiceover:         yt?.voiceover ?? false,
            voiceoverVoice:    yt?.voiceoverVoice ?? "daniel",
            burnCaptions:      yt?.burnCaptions ?? false,
          }, ctx.ytCreds);
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  { status: "PUBLISHED", publishedAt: new Date(), youtubeVideoId: videoId, error: null },
          });
          if (sp.postId) {
            await prisma.post.updateMany({
              where: { id: sp.postId },
              data:  { status: "PUBLISHED", youtubeVideoId: videoId, publishedAt: new Date() },
            });
          }
          await safeLog({ action: "YOUTUBE_PUBLISHED", entity: "ScheduledPost", entityId: sp.id,
            metadata: { youtubeVideoId: videoId, platform: "youtube", catchup: true,
                        title: sp.title, url: `https://youtube.com/shorts/${videoId}` } });
          published++;
          console.log(`[Catchup] Published YouTube Short: ${sp.id} → https://youtube.com/shorts/${videoId}`);
          notifyYouTubePublished({ spId: sp.id, videoId, title: sp.title })
            .catch((e: any) => console.warn("[Catchup] youtube-only publish notify failed:", e?.message));

          // ── Cross-post the SAME Short to Instagram as a Reel (req 4) ──────────
          // Only when youtube.publishToInstagram is on AND IG creds are present.
          // Reuses the already-rendered MP4 — no second render. Best-effort: a Reel
          // failure must NOT fail the (already successful) YouTube publish.
          if (yt?.publishToInstagram && igToken && igAcctId) {
            await crossPostYouTubeShortToInstagramReel({
              ctx,
              sp:       { id: sp.id, postId: sp.postId, title: sp.title, content: sp.content, hashtags: sp.hashtags ?? [] },
              post:     routedPost,
              mp4,
            });
          }
        } catch (ytErr: any) {
          const msg = `YouTube publish failed: ${ytErr?.message ?? ytErr}`;
          errors.push(`Schedule ${sp.id}: ${msg}`);
          failed++;
          await prisma.scheduledPost.update({
            where: { id: sp.id },
            data:  { status: "FAILED", error: msg, retryCount: { increment: 1 } },
          }).catch(() => {});
          console.error(`[Catchup] ${msg}`);
          logSystemErrorEvent(`YouTube Publish Failed: ${sp.title}`, msg);
          notifyYouTubeFailed({ spId: sp.id, title: sp.title, error: msg, context: "YouTube" })
            .catch((e: any) => console.warn("[Catchup] youtube-only failure notify failed:", e?.message));
        }
        continue;
      }

      // From here on we run the Instagram publish flow. If IG isn't configured we
      // can't proceed (instagram / both both need it) — reset to PENDING so a later
      // run with credentials can pick it up.
      if (!igConfigured) {
        await prisma.scheduledPost.update({
          where: { id: sp.id },
          data:  { status: "PENDING", error: null },
        }).catch(() => {});
        continue;
      }

      const isStory = sp.postType === "STORY";
      let resolvedMediaUrl = sp.mediaUrl ?? null;

      // ── CAROUSEL branch: render multiple slides + publish as a carousel ──────
      // Only when the linked Post is a CAROUSEL with stored slides and no single
      // mediaUrl was pre-rendered. Publishes then continues (skips single-image flow).
      if (sp.postId && !isStory && !resolvedMediaUrl) {
        const cPost = await prisma.post.findUnique({ where: { id: sp.postId } });
        const slides = (cPost?.carouselSlides as Array<{ slide: number; headline: string; body: string }> | null) ?? null;
        if (cPost && cPost.type === "CAROUSEL" && Array.isArray(slides) && slides.length >= 2) {
          try {
            console.log(`[Catchup] Carousel post ${sp.id} — rendering ${slides.length} slides...`);
            // Serialize against YouTube Short builds (same process-wide render lock) so a
            // carousel render + a Short render can't run concurrently and OOM the container.
            const slideUrls = await withRenderLock(() => generateCarouselImages(slides, cPost.imagePrompt ?? "", cPost.title));
            if (slideUrls.length < 2) throw new Error(`only ${slideUrls.length} slide image(s) rendered`);

            // Unified rich caption (identical on IG + YT, generated once & cached as
            // RICHCAP: on the post). Best-effort: fall back to the prior caption logic
            // if the rich-caption build throws so publishing is never blocked.
            let caption: string;
            try {
              const rich = await buildRichCaption({
                id:         cPost.id,
                type:       cPost.type,
                title:      cPost.title,
                hook:       cPost.hook,
                content:    cPost.content,
                cta:        cPost.cta,
                reelScript: cPost.reelScript,
                hashtags:   sp.hashtags ?? [],
              });
              caption = [rich, (sp.hashtags ?? []).filter(Boolean).join(" ")].filter(Boolean).join("\n\n");
            } catch (capErr: any) {
              console.warn(`[Catchup] Rich caption failed for carousel ${sp.id}, using fallback:`, capErr?.message ?? capErr);
              const storedCaption = cPost.reelScript?.startsWith("CAPTION:") ? cPost.reelScript.slice(8).trim() : null;
              caption = [storedCaption ?? cPost.content ?? "", (sp.hashtags ?? []).filter(Boolean).join(" ")]
                .filter(Boolean).join("\n\n");
            }

            // Idempotency: re-read the freshest instagramPostId from the DB (not the
            // stale in-memory sp) so a retry/race never posts to Instagram twice.
            // Mirrors the youtubeVideoId re-read guard in forceYouTubeShort.
            const freshIg = await prisma.scheduledPost.findUnique({
              where: { id: sp.id }, select: { instagramPostId: true },
            }).catch(() => null);
            const igPostId = freshIg?.instagramPostId
              ? freshIg.instagramPostId
              : await igPublishCarousel(slideUrls, caption, igToken, igAcctId);
            if (freshIg?.instagramPostId) {
              console.log(`[Catchup] Carousel SP ${sp.id} already has instagramPostId ${igPostId} — skipping IG publish, reusing it`);
            }

            await prisma.scheduledPost.update({
              where: { id: sp.id },
              data:  { status: "PUBLISHED", publishedAt: new Date(), instagramPostId: igPostId, error: null },
            });
            await prisma.post.updateMany({
              where: { id: sp.postId },
              data:  { status: "PUBLISHED", instagramPostId: igPostId, publishedAt: new Date() },
            });
            await safeLog({ action: "POST_PUBLISHED", entity: "ScheduledPost", entityId: sp.id,
              metadata: { igPostId, carousel: true, slides: slideUrls.length, catchup: true } });

            // YouTube cross-post ONLY when the post explicitly targets "both"
            // (driven by Auto-Post / Story → "Also publish to YouTube"). The old
            // global "mirror everything" behavior was removed in favor of those toggles.
            if (platform === "both") {
              await forceYouTubeShort({ ctx, sp, post: routedPost });
            }

            published++;
            console.log(`[Catchup] Published CAROUSEL ${sp.id} with ${slideUrls.length} slides → ${igPostId}`);
            continue;
          } catch (carErr: any) {
            const msg = `Carousel publish failed: ${carErr?.message ?? carErr}`;
            errors.push(`Schedule ${sp.id}: ${msg}`);
            failed++;
            await prisma.scheduledPost.update({
              where: { id: sp.id },
              data:  { status: "FAILED", error: msg, retryCount: { increment: 1 } },
            }).catch(() => {});
            console.error(`[Catchup] ${msg}`);
            continue;
          }
        }
      }

      // -- Generate image if missing ------------------------------------------
      if (!resolvedMediaUrl) {
        try {
          if (isStory) {
            // Generate story card from the scheduled content — premium health awareness layout.
            // Content format (set by scheduleAutoStory):
            //   line 0         = headline
            //   line 1         = body
            //   lines 2–7      = "TIP:<tip text>" entries
            //   optional last  = "TAGLINE:<tagline text>"
            const lines    = sp.content.split("\n").filter(Boolean);
            const headline = sp.title || lines[0] || `${brand.niche} tip of the day`;
            const body     = lines[1] || "1 small habit today pays off tomorrow.";

            // Parse TIP: and TAGLINE: prefixed lines
            const parsedTips = lines
              .filter((l: string) => l.startsWith("TIP:"))
              .map((l: string) => l.slice(4).trim())
              .filter(Boolean)
              .slice(0, 6);

            const parsedTagline = (lines.find((l: string) => l.startsWith("TAGLINE:")) ?? "")
              .replace(/^TAGLINE:/, "")
              .trim();

            // Fallback: also try unprefixed short lines (backwards compat with old records)
            const legacyTips = parsedTips.length < 3
              ? lines
                  .slice(2)
                  .filter((l: string) => !l.startsWith("TAGLINE:"))
                  .map((l: string) => l.replace(/^[\s\-•✔\d.]+/, "").trim())
                  .filter((l: string) => l.length > 3 && l.length < 80)
                  .slice(0, 6)
              : [];

            const resolvedTips = parsedTips.length >= 3 ? parsedTips : legacyTips;

            // Generic default tips — only used when the story has no tips stored.
            const defaultTips = [
              "Start small and stay consistent",
              "Make it a daily habit",
              "Track your progress",
              "Keep learning",
              "Share what works",
              "Review and adjust often",
            ];

            const finalTips    = resolvedTips.length >= 3 ? resolvedTips : defaultTips;
            const finalTagline = parsedTagline || (brand.tagline?.trim() || brand.commentCtaLine?.trim() || "Follow for more!");

            const { renderStoryToJpeg } = await import("@/lib/storyImageGenerator");
            const buf = await renderStoryToJpeg({
              headline,
              body,
              label:   (brand.niche || "TIPS").toUpperCase(),
              type:    "health_awareness",
              tips:    finalTips,
              tagline: finalTagline,
              cta:     "Save this story & share with someone who'd find it useful ✨",
            });
            if (buf) {
              resolvedMediaUrl = await uploadBufferToStableCdn(buf, ".jpg", `story-${sp.id}`);
              if (resolvedMediaUrl) {
                await prisma.scheduledPost.update({ where: { id: sp.id }, data: { mediaUrl: resolvedMediaUrl } });
                console.log(`[Catchup] Generated story image for ${sp.id}: ${resolvedMediaUrl}`);
              }
            }
          } else if (sp.postId) {
            const linkedPost = await prisma.post.findUnique({ where: { id: sp.postId } });
            if (linkedPost) {
              const { renderPostToJpeg } = await import("@/lib/postTypeImageGenerator");
              const buf = await renderPostToJpeg({
                postType:   linkedPost.type,
                title:      linkedPost.title,
                hook:       linkedPost.hook       ?? "",
                content:    linkedPost.content    ?? "",
                cta:        linkedPost.cta        ?? "",
                reelScript: linkedPost.reelScript ?? undefined,
              });
              if (buf) {
                resolvedMediaUrl = await uploadBufferToStableCdn(buf, ".jpg", `sched-${sp.id}`);
                if (resolvedMediaUrl) {
                  await prisma.scheduledPost.update({ where: { id: sp.id }, data: { mediaUrl: resolvedMediaUrl } });
                  console.log(`[Catchup] Generated image for scheduled post ${sp.id}: ${resolvedMediaUrl}`);
                }
              }
            }
          } else {
            // Standalone scheduled post (no postId) -- generate a generic card from title/content
            const lines    = sp.content.split("\n").filter(Boolean);
            const headline = sp.title || lines[0] || brand.niche;
            const body     = lines.slice(1).join(" ") || sp.content;
            const { renderPostToJpeg: renderPostToJpegStandalone } = await import("@/lib/postTypeImageGenerator");
            const buf = await renderPostToJpegStandalone({
              postType: "EDUCATIONAL",
              title:    headline,
              hook:     "",
              // No character cap — the card renderer auto-shrinks long text to fit.
              content:  body,
              cta:      "",
            });
            if (buf) {
              resolvedMediaUrl = await uploadBufferToStableCdn(buf, ".jpg", `sched-${sp.id}`);
              if (resolvedMediaUrl) {
                await prisma.scheduledPost.update({ where: { id: sp.id }, data: { mediaUrl: resolvedMediaUrl } });
                console.log(`[Catchup] Generated generic image for standalone scheduled post ${sp.id}: ${resolvedMediaUrl}`);
              }
            }
          }
        } catch (genErr: any) {
          console.warn(`[Catchup] Image generation failed for ${sp.id}:`, genErr?.message);
        }
      }

      if (!resolvedMediaUrl) {
        await prisma.scheduledPost.update({
          where: { id: sp.id },
          data: { status: "FAILED", error: "No media URL and image generation failed. Check that the canvas renderer (sharp/skia-canvas) is installed and working." },
        });
        failed++;
        continue;
      }

      // -- Build caption (stories don't use captions in the API) ----------------
      let caption = "";
      if (!isStory) {
        if (sp.postId) {
          try {
            const linkedPost = await prisma.post.findUnique({ where: { id: sp.postId } });
            if (linkedPost) {
              // Media-folder uploads have their own caption — detect by Cloudinary/CDN mediaUrl
              const isUploadedMedia = linkedPost.mediaUrls.some((url) => {
                try {
                  const h = new URL(url).hostname;
                  return h.includes("cloudinary.com") || h.includes("amazonaws.com") ||
                         h.includes("catbox.moe") || h.includes("cdninstagram.com");
                } catch { return false; }
              });

              const hashtagStr = (sp.hashtags ?? []).filter(Boolean).join(" ");

              if (isUploadedMedia) {
                // Media-folder uploads keep the user's own caption verbatim — never reformat.
                caption = [linkedPost.content ?? "", hashtagStr].filter(Boolean).join("\n\n");
              } else {
                // Auto-generated post → ONE unified rich caption (identical on IG + YT,
                // generated once & cached as RICHCAP: on the post). Best-effort: fall
                // back to the prior caption logic if the rich-caption build throws.
                try {
                  const rich = await buildRichCaption({
                    id:         linkedPost.id,
                    type:       linkedPost.type,
                    title:      linkedPost.title,
                    hook:       linkedPost.hook,
                    content:    linkedPost.content,
                    cta:        linkedPost.cta,
                    reelScript: linkedPost.reelScript,
                    hashtags:   sp.hashtags ?? [],
                  });
                  caption = [rich, hashtagStr].filter(Boolean).join("\n\n");
                } catch (capErr: any) {
                  console.warn(`[Catchup] Rich caption failed for ${sp.id}, using fallback:`, capErr?.message ?? capErr);
                  // If reelScript has a stored prose caption (CAPTION: prefix), use it directly
                  const storedCaption = linkedPost.reelScript?.startsWith("CAPTION:")
                    ? linkedPost.reelScript.slice(8).trim()
                    : null;
                  caption = storedCaption
                    ? [storedCaption, hashtagStr].filter(Boolean).join("\n\n")
                    : buildBeautifulCaption({
                        postType:   linkedPost.type,
                        title:      linkedPost.title,
                        hook:       linkedPost.hook       ?? null,
                        content:    linkedPost.content    ?? "",
                        cta:        linkedPost.cta        ?? null,
                        reelScript: linkedPost.reelScript ?? undefined,
                        hashtags:   sp.hashtags ?? [],
                      }, brand);
                }
              }
            } else {
              throw new Error("Post not found");
            }
          } catch {
            const hashtagStr = (sp.hashtags ?? []).join(" ");
            caption = `${sp.content}\n\n${hashtagStr}`.trim();
          }
        } else {
          const hashtagStr = (sp.hashtags ?? []).join(" ");
          caption = `${sp.content}\n\n${hashtagStr}`.trim();
        }
      }

      // Idempotency: re-read the freshest instagramPostId from the DB (not the stale
      // in-memory sp) so a retry/race never posts to Instagram twice. Mirrors the
      // youtubeVideoId re-read guard in forceYouTubeShort.
      const freshIg = await prisma.scheduledPost.findUnique({
        where: { id: sp.id }, select: { instagramPostId: true },
      }).catch(() => null);
      const igPostId = freshIg?.instagramPostId
        ? freshIg.instagramPostId
        : await igPublish(resolvedMediaUrl, caption, igToken, igAcctId, isStory);
      if (freshIg?.instagramPostId) {
        console.log(`[Catchup] SP ${sp.id} already has instagramPostId ${igPostId} — skipping IG publish, reusing it`);
      }

      await prisma.scheduledPost.update({
        where: { id: sp.id },
        data: { status: "PUBLISHED", publishedAt: new Date(), instagramPostId: igPostId, error: null },
      });

      if (sp.postId) {
        await prisma.post.updateMany({
          where: { id: sp.postId },
          data: { status: "PUBLISHED", instagramPostId: igPostId, publishedAt: new Date() },
        });
      }

      // YouTube cross-post ONLY when the post explicitly targets "both"
      // (driven by Auto-Post / Story → "Also publish to YouTube"). BEFORE Cloudinary cleanup.
      if (platform === "both") {
        await forceYouTubeShort({ ctx, sp, post: routedPost });
      }

      // Facebook Page cross-post — when Settings → "Also publish to Facebook Page" is on.
      // Reuses the SAME Cloudinary media (must run BEFORE the cleanup below). Stories are
      // skipped (no equivalent Page surface). Best-effort: never fails the IG publish.
      if (!isStory && ctx.prefs.autoPost?.publishToFacebook && ctx.fbPageId && igToken) {
        try {
          const pageToken = await getPageToken(igToken, ctx.fbPageId, ctx.isPrimary);
          if (pageToken) {
            const fbIsVideo = /\.(mp4|mov|webm)(\?|$)/i.test(resolvedMediaUrl) || sp.postType === "REEL";
            await crossPostToFacebookPage({ pageId: ctx.fbPageId, pageToken, mediaUrl: resolvedMediaUrl, isVideo: fbIsVideo, caption });
          }
        } catch (fbErr: any) {
          console.warn("[Catchup] Facebook cross-post failed:", fbErr?.message ?? fbErr);
        }
      }

      // Delete from Cloudinary after successful publish -- Instagram already cached it
      void deleteFromCloudinary(resolvedMediaUrl);

      await safeLog({
        action:   "POST_PUBLISHED",
        entity:   isStory ? "Story" : "ScheduledPost",
        entityId: sp.id,
        metadata: { igPostId, scheduledFor: sp.scheduledFor, isStory, catchup: true },
      });

      published++;
      console.log(`[Catchup] Published ${isStory ? "story" : "post"}: ${sp.id} (was due ${sp.scheduledFor})`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      errors.push(`Schedule ${sp.id}: ${msg}`);
      failed++;
      await prisma.scheduledPost.update({
        where: { id: sp.id },
        data: { status: "FAILED", error: msg, retryCount: { increment: 1 } },
      }).catch(() => {});
      console.error(`[Catchup] Failed to publish ${sp.id}:`, msg);
      // Log for daily digest
      logSystemErrorEvent(`Publish Failed: ${sp.title}`, msg);
      // Real-time alert
      notifyPostFailed({
        postId:   sp.id,
        postType: sp.postType ?? undefined,
        title:    sp.title,
        error:    msg,
        isStory:  sp.postType === "STORY",
      }).catch((emailErr: any) => {
        // Log — never silently swallow email errors (helps diagnose SMTP/Resend issues)
        console.warn("[Catchup] Publish failure email could not be sent:", emailErr?.message);
      });
    }
  }

  return { published, failed };
}

// --- Helper: reply to a comment -----------------------------------------------
export async function replyToComment(commentId: string, message: string, igToken: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ message, access_token: igToken });
    const res  = await fetchWithRetry(
      `${GRAPH_BASE}/${commentId}/replies`,
      { method: "POST", body: params }
    );
    const data = await res.json();
    if (data.error) {
      console.warn("[Catchup] Comment reply API error:", data.error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Catchup] Comment reply network error:", String(err));
    return false;
  }
}

// In-memory sets to avoid duplicate replies within the same server session.
// Resets on server restart -- first run after restart will re-check and reply if needed.
// These EXPORTED sets are the PRIMARY brand's sets — webhook handlers (which always
// operate as the primary brand) import and share them, so the primary path is
// byte-identical to today. Per-brand variants are stored in the Maps below and the
// primary brand maps back to these exact sets (see the *ForBrand accessors).
export const _repliedCommentIds     = new Set<string>(); // Instagram comment IDs
export const _repliedConversationIds = new Set<string>(); // Instagram conversation IDs
export const _repliedYouTubeCommentIds = new Set<string>(); // YouTube comment IDs

// Per-brand dedupe sets. One brand's replies must never suppress another's. The
// primary brand reuses the exported singletons above for full backward compat.
const _repliedCommentIdsByBrand     = new Map<string, Set<string>>();
const _repliedConversationIdsByBrand = new Map<string, Set<string>>();
const _repliedYouTubeCommentIdsByBrand = new Map<string, Set<string>>();

function repliedCommentSet(ctx: BrandContext): Set<string> {
  if (ctx.isPrimary) return _repliedCommentIds;
  let s = _repliedCommentIdsByBrand.get(ctx.brandId);
  if (!s) { s = new Set<string>(); _repliedCommentIdsByBrand.set(ctx.brandId, s); }
  return s;
}
function repliedConversationSet(ctx: BrandContext): Set<string> {
  if (ctx.isPrimary) return _repliedConversationIds;
  let s = _repliedConversationIdsByBrand.get(ctx.brandId);
  if (!s) { s = new Set<string>(); _repliedConversationIdsByBrand.set(ctx.brandId, s); }
  return s;
}
function repliedYouTubeCommentSet(ctx: BrandContext): Set<string> {
  if (ctx.isPrimary) return _repliedYouTubeCommentIds;
  let s = _repliedYouTubeCommentIdsByBrand.get(ctx.brandId);
  if (!s) { s = new Set<string>(); _repliedYouTubeCommentIdsByBrand.set(ctx.brandId, s); }
  return s;
}

// Bounded add — caps each in-memory dedupe Set so it can't grow unbounded over a
// long-lived server session (slow memory creep). When the cap is exceeded we drop
// the oldest entries (Set preserves insertion order) to make room. ~5000 ids is
// far more than any realistic catch-up window needs.
const _REPLIED_SET_CAP = 5000;
function boundedAdd(set: Set<string>, id: string): void {
  if (!id) return;
  set.add(id);
  if (set.size > _REPLIED_SET_CAP) {
    const dropCount = set.size - _REPLIED_SET_CAP;
    const it = set.values();
    for (let i = 0; i < dropCount; i++) {
      const oldest = it.next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  }
}

// --- Grok auto-reply to YouTube comments --------------------------------------
// Mirrors fetchMissedComments() but for the channel's recent Shorts/videos.
// Best-effort: never throws. Returns the number of replies sent.
// Lightweight throttle so YouTube comments are checked at most ~every 2 min, even
// when runCatchup() is invoked more often (30s/2-min dashboard polls). This is a
// SEPARATE gate from the 5-min catchup comment debounce so YT replies aren't late.
// Per-brand throttle so one brand's YT comment check can't suppress another's.
const _lastYouTubeCommentCheckByBrand = new Map<string, number>();
const YT_COMMENT_CHECK_MS = 2 * 60 * 1000; // throttle floor; actually driven by the 5-min catchup loop

// Per-brand cache of the recent-videos list so we don't re-fetch it (and spend extra
// quota) on back-to-back checks. Refreshed every few minutes, keyed by brandId.
const _ytVideosCacheByBrand = new Map<string, Awaited<ReturnType<typeof getRecentVideos>>>();
const _ytVideosCacheAtByBrand = new Map<string, number>();
const YT_VIDEOS_CACHE_MS = 4 * 60 * 1000; // refresh the video list ~every 4 min

/**
 * Reply to new YouTube comments (and replies-to-replies) for ONE brand. Runs from
 * the 5-min catchup loop (YouTube has no comment webhook, so this is poll-based).
 * `maxVideos` caps how many recent videos are scanned per run. Uses the brand's
 * YouTube creds for every youtube.ts call and the brand's own-channel identity.
 */
export async function replyToYouTubeComments(ctx: BrandContext, maxVideos = 5): Promise<number> {
  if (!isYouTubeConfigured(ctx.ytCreds)) return 0;

  // Throttle: skip if we checked very recently (guards against overlapping calls).
  const lastCheck = _lastYouTubeCommentCheckByBrand.get(ctx.brandId) ?? 0;
  const sinceLast = Date.now() - lastCheck;
  if (lastCheck && sinceLast < YT_COMMENT_CHECK_MS) {
    return 0;
  }
  _lastYouTubeCommentCheckByBrand.set(ctx.brandId, Date.now());

  const yt = ctx.prefs?.youtube as any;
  if (!yt?.enabled) return 0;
  // Default ON when undefined — only skip when explicitly disabled.
  if (yt.replyToComments === false) return 0;

  const repliedSet = repliedYouTubeCommentSet(ctx);

  // Our own channel identity — used to skip replying to our own comments/replies
  // (prevents reply loops). Primary signal is the channel id; the channel TITLE and
  // @handle (fetched live from the API for THIS brand's creds) are robust fallbacks
  // for the case where the channel-id lookup transiently fails.
  const ownInfo = await getOwnChannelInfo(ctx.ytCreds).catch(() => ({ id: "", title: "", handle: "" }));
  const ownChannelId = ownInfo.id || "";
  // Normalise an author/handle for identity comparison: lowercase, drop leading
  // "@", remove spaces. This makes the channel TITLE (e.g. "My Channel") match the
  // comment author display name ("@MyChannel") and the @handle ("@mychannel").
  const norm = (s: string) => (s ?? "").toLowerCase().replace(/^@+/, "").replace(/\s+/g, "").trim();
  const ownAuthors = new Set(
    [ownInfo.title, ownInfo.handle,
      ctx.isPrimary ? process.env.YOUTUBE_CHANNEL_TITLE : "",
      ctx.igUsername]
      .filter(Boolean)
      .map((s) => norm(String(s))),
  );
  const isOwn = (authorChannelId: string, author: string): boolean => {
    if (ownChannelId && authorChannelId && authorChannelId === ownChannelId) return true;
    return ownAuthors.has(norm(author));
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let replied = 0;

  let videos: Awaited<ReturnType<typeof getRecentVideos>> = [];
  try {
    // Use the per-brand cached video list; refresh only every ~4 min to save quota.
    const cache   = _ytVideosCacheByBrand.get(ctx.brandId) ?? [];
    const cacheAt = _ytVideosCacheAtByBrand.get(ctx.brandId) ?? 0;
    if (cache.length === 0 || Date.now() - cacheAt > YT_VIDEOS_CACHE_MS) {
      const fresh = await getRecentVideos(5, ctx.ytCreds);
      _ytVideosCacheByBrand.set(ctx.brandId, fresh);
      _ytVideosCacheAtByBrand.set(ctx.brandId, Date.now());
      videos = fresh.slice(0, Math.max(1, maxVideos));
    } else {
      videos = cache.slice(0, Math.max(1, maxVideos));
    }
  } catch (err) {
    console.warn("[YouTube] Could not fetch recent videos:", String(err));
    return 0;
  }

  for (const video of videos) {
    try {
      const threads = await listCommentThreads(video.videoId, 20, ctx.ytCreds);
      await sleep(800);

      // Build a flat list of comments to consider: top-level comments AND all of
      // their replies (incl. users replying to the bot's own replies). Each entry
      // carries the TOP-LEVEL comment id of its thread — YouTube only supports one
      // level of nesting, so every reply is posted under the top-level comment.
      type FlatComment = {
        commentId:       string; // the comment we dedup on (top-level OR reply id)
        parentId:        string; // top-level comment id to reply under
        text:            string;
        author:          string;
        authorChannelId: string;
        publishedAt:     string;
        isReply:         boolean;
      };
      const flat: FlatComment[] = [];
      for (const t of threads) {
        if (!t.commentId) continue;
        flat.push({
          commentId:       t.commentId,
          parentId:        t.commentId,
          text:            t.text,
          author:          t.author,
          authorChannelId: t.authorChannelId,
          publishedAt:     t.publishedAt,
          isReply:         false,
        });
        // Fetch nested replies for this thread (cap kept sane via per-video reply cap below).
        const replies = await listCommentReplies(t.commentId, 50, ctx.ytCreds);
        await sleep(400);
        for (const r of replies) {
          if (!r.commentId) continue;
          flat.push({
            commentId:       r.commentId,
            parentId:        t.commentId,
            text:            r.text,
            author:          r.author,
            authorChannelId: r.authorChannelId,
            publishedAt:     r.publishedAt,
            isReply:         true,
          });
        }
      }

      // Cap replies sent per video to keep quota sane.
      let repliesThisVideo = 0;
      const MAX_REPLIES_PER_VIDEO = 20;

      for (const c of flat) {
        if (repliesThisVideo >= MAX_REPLIES_PER_VIDEO) break;
        const commentId = c.commentId;
        if (!commentId) continue;

        // NEVER reply to the channel's OWN comments/replies (prevents loops).
        if (isOwn(c.authorChannelId, c.author)) continue;
        if (repliedSet.has(commentId)) continue;

        // Atomic claim keyed by the YT comment id — same engine as IG. Ensures each
        // comment (top-level or reply) is answered exactly once across paths/restarts.
        const claimed = await claimCommentForReply(commentId, {
          mediaId:   video.videoId,
          username:  c.author ?? "unknown",
          text:      c.text   ?? "",
          timestamp: c.publishedAt ? new Date(c.publishedAt) : new Date(),
        });
        if (!claimed) {
          boundedAdd(repliedSet, commentId);
          continue;
        }

        // Normalize the author handle to EXACTLY one leading "@" (fixes the @@ bug).
        const handle = "@" + (c.author ?? "friend").replace(/^@+/, "");

        const reply = await generateAICommentReply(
          c.text ?? "",
          c.author ?? "friend",
          { postType: "YOUTUBE", postTitle: video.title },
          ctx.prefs.brand,
        );
        await sleep(800);
        if (!reply) {
          // No reply generated — release the claim so a later run can retry.
          await releaseCommentClaim(commentId);
          continue;
        }

        // For replies-to-replies, optionally prefix the user's handle, then post the
        // reply under the TOP-LEVEL comment id (YouTube supports one nesting level).
        const replyText = c.isReply ? `${handle} ${reply}` : reply;
        const sent = await replyToYouTubeComment(c.parentId, replyText, ctx.ytCreds);
        await sleep(800);
        if (sent) {
          replied++;
          repliesThisVideo++;
          boundedAdd(repliedSet, commentId);
          await markCommentReplied(commentId, replyText);
          await safeLog({
            action:   "YOUTUBE_COMMENT_REPLIED",
            entity:   "Comment",
            entityId: commentId,
            metadata: { commentId, videoId: video.videoId, title: video.title,
                        username: c.author, isReply: c.isReply, replyText },
          }).catch(() => {});
          notifyYouTubeCommentReplied({
            commentId, videoTitle: video.title, author: c.author ?? "viewer", replyText,
          });
          console.log(`[YouTube] Replied to ${handle} on "${video.title.slice(0, 40)}": "${reply.slice(0, 60)}"`);
        } else {
          // Send failed — release so a later run can retry.
          await releaseCommentClaim(commentId);
        }
      }
    } catch (err) {
      // One video failing must not abort the rest.
      console.warn(`[YouTube] Comment reply loop failed for video ${video.videoId}:`, String(err));
    }
  }

  if (replied > 0) console.log(`[YouTube] Sent ${replied} comment ${replied === 1 ? "reply" : "replies"}`);
  return replied;
}

// -- Per-post quiz answer cache ------------------------------------------------
// Stores the single correct answer per Instagram media ID so every commenter on
// the same post is evaluated against the same answer (not re-determined per comment).
// Prevents the AI from praising both "B" and "C" as correct on the same quiz.
export const _quizAnswerCache = new Map<string, { correctLetter: string; correctAnswer: string }>();

/** Resolve the correct answer for a quiz post -- cache-first, then Groq fallback. */
export async function resolveQuizAnswer(
  mediaId:  string,
  caption:  string,
): Promise<{ correctLetter: string; correctAnswer: string } | null> {
  // 1. Try explicit "Answer: B -- ..." line in caption
  const extracted = extractCorrectAnswer(caption);
  if (extracted) {
    _quizAnswerCache.set(mediaId, { correctLetter: extracted.letter, correctAnswer: extracted.text });
    return { correctLetter: extracted.letter, correctAnswer: extracted.text };
  }

  // 2. Return cached answer if already determined this session
  const cached = _quizAnswerCache.get(mediaId);
  if (cached) return cached;

  // 3. Ask AI provider to determine the correct answer once -- low temperature, deterministic
  try {
    const ai     = await getAIClient();
    const answer = await ai.determineQuizAnswer(caption);
    if (answer) {
      _quizAnswerCache.set(mediaId, answer);
      console.log(`[QuizCache] Determined answer for ${mediaId}: ${answer.correctLetter} -- ${answer.correctAnswer.slice(0, 60)}`);
      return answer;
    }
  } catch (err) {
    console.warn("[QuizCache] Could not determine quiz answer:", String(err));
  }
  return null;
}

// --- 2. Fetch missed comments + auto-reply ------------------------------------
// Checks ALL recent Instagram media (not just DB-tracked posts) so comments on
// pre-existing posts are also auto-replied to.
async function fetchMissedComments(
  ctx: BrandContext,
  errors: string[],
): Promise<{ newComments: number; repliedCount: number }> {
  const { igToken, igAcctId } = ctx;
  const repliedSet = repliedCommentSet(ctx);
  let newComments = 0;
  let repliedCount = 0;
  if (!igToken || !igAcctId) return { newComments, repliedCount };

  // -- Step 1: get all recent Instagram media IDs from the IG API --------------
  let igMediaIds: string[] = [];
  try {
    const mediaRes = await fetchWithRetry(
      `${GRAPH_BASE}/${igAcctId}/media?fields=id,timestamp&limit=50&access_token=${igToken}`
    );
    const mediaData = await mediaRes.json();

    if (mediaData.error) {
      errors.push(`IG media fetch: ${mediaData.error.message}`);
      console.error("[Catchup] Failed to fetch IG media:", mediaData.error.message);
    } else {
      igMediaIds = (mediaData.data ?? []).map((m: { id: string }) => m.id);
      console.log(`[Catchup] Found ${igMediaIds.length} posts on Instagram to check for comments`);
    }
  } catch (err) {
    errors.push(`IG media fetch: ${String(err)}`);
    console.error("[Catchup] Network error fetching IG media:", String(err));
  }

  // -- Step 2: also add any DB-tracked posts not in the IG list ----------------
  // Exclude Stories -- they don't support the /comments endpoint
  const dbPosts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      instagramPostId: { not: null },
      type: { not: "STORY" },
      ...brandFilter(ctx),
    },
    select: { id: true, instagramPostId: true, title: true, type: true, hook: true, content: true, reelScript: true },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  // Build a map of igMediaId -> full context for AI replies
  const igIdToCtx = new Map<string, PostCommentContext & { dbId: string }>(
    dbPosts
      .filter((p) => p.instagramPostId)
      .map((p) => {
        const isQuiz = ["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(p.type);
        // Priority 1: user-provided answer stored in reelScript as "QUIZ_ANS:<letter>|<text>"
        let correctLetter: string | undefined;
        let correctAnswer: string | undefined;
        if (isQuiz && p.reelScript?.startsWith("QUIZ_ANS:")) {
          const parts = p.reelScript.slice(9).split("|");
          correctLetter = parts[0]?.trim().toUpperCase() || undefined;
          correctAnswer = parts[1]?.trim() || undefined;
        }
        // Priority 2: "Answer: B — ..." in post content
        if (!correctLetter && isQuiz && p.content) {
          const parsed = extractCorrectAnswer(p.content);
          correctLetter = parsed?.letter;
          correctAnswer = parsed?.text;
        }
        return [
          p.instagramPostId as string,
          {
            dbId:          p.id,
            postType:      p.type,
            postTitle:     p.title,
            postHook:      p.hook ?? undefined,
            postContent:   p.content ? p.content.slice(0, 1200) : undefined,
            correctLetter,
            correctAnswer,
          },
        ];
      })
  );

  const igIdToDbId  = new Map<string, string>([...igIdToCtx.entries()].map(([k, v]) => [k, v.dbId]));

  // Merge: IG API media + DB media (deduplicated)
  // Cap at 6 per run -- Meta rate limit is strict, stay well under it.
  // Posts rotate naturally across runs (newest first from IG API).
  const allMediaIds = Array.from(new Set([...igMediaIds, ...igIdToDbId.keys()])).slice(0, 6);
  console.log(`[Catchup] Checking comments on ${allMediaIds.length} media items (capped at 6/run)`);

  // -- Step 3: check comments on each media item --------------------------------
  for (const mediaId of allMediaIds) {
    const dbPostId  = igIdToDbId.get(mediaId) ?? null;
    const postCtx   = igIdToCtx.get(mediaId) ?? {};

    // Throttle: 750ms between each API call -- stays well under Meta rate limits
    await new Promise((r) => setTimeout(r, 750));

    try {
      const res = await fetchWithRetry(
        `${GRAPH_BASE}/${mediaId}/comments?fields=id,text,username,timestamp,from{id,username}&limit=50&access_token=${igToken}`
      );
      const data = await res.json();

      if (data.error) {
        const code = data.error.code;
        if (code === 4 || code === 32 || code === 613) {
          // App rate limit hit -- stop ALL comment fetching for this run and back off 1 hour
          markRateLimited();
          console.warn(`[Catchup] Rate limit hit (code ${code}) -- stopping comment sync for this run`);
          break; // exit the loop immediately, no more API calls
        }
        if (code === 100) {
          // Permission/hidden media -- skip silently
          console.warn(`[Catchup] Skipping media ${mediaId}: permission denied (code 100)`);
        } else {
          errors.push(`Comments for media ${mediaId}: ${data.error.message}`);
        }
        continue;
      }

      const igComments: Array<{ id: string; text: string; username: string; timestamp: string; from?: { id?: string; username?: string } }> =
        data.data ?? [];

      // Collect replies to ALL top-level comments (including our own replies)
      // This catches: user replies to our replies (reply-to-reply threads)
      const allComments: typeof igComments = [...igComments];
      for (const c of igComments) {
        try {
          const rRes = await fetchWithRetry(
            `${GRAPH_BASE}/${c.id}/replies?fields=id,text,username,timestamp,from{id,username}&limit=50&access_token=${igToken}`
          );
          const rData = await rRes.json();
          if (!rData.error && Array.isArray(rData.data)) {
            // Add all replies that are NOT from our own account (id- AND username-based)
            const userReplies = rData.data.filter(
              (r: { username?: string; from?: { id?: string; username?: string } }) => !isOwnCommentForBrand(ctx, r)
            );
            allComments.push(...userReplies);
          }
        } catch { /* best-effort -- don't block the main loop */ }
      }

      for (const c of allComments) {
        // Skip comments made by our own account -- prevents self-reply loops
        if (isOwnCommentForBrand(ctx, c)) continue;

        // Check DB for this comment (regardless of whether we have a DB post)
        const existing = await prisma.comment
          .findUnique({ where: { instagramCommentId: c.id } })
          .catch(() => null);

        if (!existing) {
          // Cheap in-memory pre-filter; the DB claim below is authoritative.
          if (repliedSet.has(c.id)) continue;

          // Atomic cross-path claim — ensures the row exists (replied=false) then
          // flips it to true. Only the winner replies; all other paths skip.
          const claimed = await claimCommentForReply(c.id, {
            postId:    dbPostId ?? null,
            mediaId:   mediaId,
            username:  c.username ?? "unknown",
            text:      c.text     ?? "",
            timestamp: new Date(c.timestamp),
          });
          if (!claimed) {
            // Another path already handled (or is handling) this comment.
            boundedAdd(repliedSet, c.id);
            continue;
          }
          await tagCommentBrand(ctx, c.id);

          // -- Generate personalised AI reply with full post context -----------
          const aiReply = await generateAICommentReply(
            c.text     ?? "",
            c.username ?? "friend",
            postCtx,
            ctx.prefs.brand,
          );

          let replied = false;
          if (aiReply) {
            replied = await replyToComment(c.id, aiReply, igToken);
            if (replied) {
              boundedAdd(repliedSet, c.id);
              repliedCount++;
              await markCommentReplied(c.id, aiReply);
            } else {
              // Send failed — release the claim so a later run can retry.
              await releaseCommentClaim(c.id);
            }
            console.log(`[Catchup] New comment from @${c.username} -- reply sent: ${replied}`);
            console.log(`[Catchup]   Comment: "${(c.text ?? "").slice(0, 60)}"`);
            console.log(`[Catchup]   Reply:   "${aiReply.slice(0, 80)}"`);
          } else {
            // No reply generated — release the claim so a later run can retry.
            await releaseCommentClaim(c.id);
          }

          await safeLog({
            action:   "COMMENT_RECEIVED",
            entity:   "Comment",
            entityId: c.id,
            metadata: {
              commentId: c.id,
              mediaId,
              text:      c.text,
              username:  c.username,
              replied,
              replyText: replied ? aiReply : null,
              catchup:   true,
            },
          });

          newComments++;

        } else if (!existing.replied) {
          // Already in DB but not yet replied to -- generate fresh reply
          if (repliedSet.has(c.id)) continue;

          // Atomic cross-path claim before doing any work.
          const claimed = await claimCommentForReply(c.id, {
            postId:    dbPostId ?? null,
            mediaId:   mediaId,
            username:  existing.username ?? "unknown",
            text:      existing.text     ?? "",
            timestamp: new Date(c.timestamp),
          });
          if (!claimed) {
            boundedAdd(repliedSet, c.id);
            continue;
          }
          await tagCommentBrand(ctx, c.id);

          const aiReply = await generateAICommentReply(
            existing.text     ?? "",
            existing.username ?? "friend",
            postCtx,
            ctx.prefs.brand,
          );

          if (aiReply) {
            const replied = await replyToComment(c.id, aiReply, igToken);
            if (replied) {
              boundedAdd(repliedSet, c.id);
              repliedCount++;
              await markCommentReplied(c.id, aiReply);
              console.log(`[Catchup] Replied to missed comment from @${existing.username}: "${aiReply.slice(0, 60)}"`);
            } else {
              // Send failed — release so a later run can retry.
              await releaseCommentClaim(c.id);
            }
          } else {
            // No reply generated — release so a later run can retry.
            await releaseCommentClaim(c.id);
            console.log(`[Catchup] No reply generated for @${existing.username} -- skipping`);
          }
        } else {
          // Already replied -- add to in-memory cache to skip future API calls
          boundedAdd(repliedSet, c.id);
        }
      }
    } catch (err) {
      const msg = String(err);
      errors.push(`Comments for media ${mediaId}: ${msg}`);
      console.error(`[Catchup] Error checking comments on media ${mediaId}:`, msg);
    }
  }

  return { newComments, repliedCount };
}

// A DM send error that will NEVER succeed on retry — so we mark the message handled
// instead of re-attempting it every cycle (which spammed the logs/digest). The big
// one is Meta #10 "This message is sent outside of allowed window" (the 24-hour
// messaging window has closed); #551 = user not reachable.
function isPermanentDmError(err: { code?: number; error_subcode?: number; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  return err.code === 10
      || err.code === 551
      || err.error_subcode === 2534022
      || /outside of allowed window|outside the allowed window/i.test(msg);
}

// --- 3. Auto-reply to missed DMs (AI-powered) ---------------------------------
// Overloads mirror publishOverdueScheduled: new engine → (ctx, errors); legacy API
// routes → (errors, igToken, igAcctId), operating as the primary brand.
export async function replyMissedDMs(ctx: BrandContext, errors: string[]): Promise<number>;
export async function replyMissedDMs(errors: string[], igToken: string, igAcctId: string): Promise<number>;
export async function replyMissedDMs(
  a: BrandContext | string[],
  b: string[] | string,
  _c?: string,
): Promise<number> {
  const { ctx, errors } = await normalizeBrandArgs(a, b);
  const { igToken, igAcctId } = ctx;
  const PAGE_ID = ctx.fbPageId;
  const repliedConversationSetForBrand = repliedConversationSet(ctx);
  // This brand's own handle, "@"-prefixed, for labelling outgoing turns in the
  // AI conversation thread (per-brand; was hardcoded to a single handle).
  const ownHandleTag = "@" + (ctx.igUsername || "").replace(/^@+/, "");
  // Per-brand DM auto-reply fallback (used only when the AI is unavailable).
  const dmAutoReply = ctx.prefs.brand.dmAutoReply?.trim() || DM_AUTO_REPLY;
  if (!PAGE_ID) {
    console.warn("[Catchup] DMs: FACEBOOK_PAGE_ID not set — skipping DM fetch");
    return 0;
  }

  let replied = 0;

  try {
    // Primary brand keeps the exact legacy resolution (env page token allowed,
    // env PAGE_ID default). Non-primary brands resolve their OWN page token from
    // their igToken/fbPageId and must NOT borrow the primary's env page token.
    const pageToken = await getPageToken(igToken, PAGE_ID, ctx.isPrimary);
    const ourIds    = new Set([PAGE_ID, igAcctId].filter(Boolean));

    // -- Attempt 1: Page-scoped conversations API ------------------------------
    // Requires Meta app in Live mode + instagram_manage_messages permission.
    // Error code 3 = app in Development mode (blocked regardless of token scopes).
    type ConvoItem = {
      id: string;
      participants: { data: Array<{ id: string; username?: string; name?: string }> };
      messages:     { data: Array<{ id: string; from: { id: string; name?: string }; message: string; created_time: string }> };
    };

    let conversations: ConvoItem[] = [];
    let apiBlocked = false;

    try {
      const res1  = await fetchWithRetry(
        `${GRAPH_BASE}/${PAGE_ID}/conversations?platform=instagram` +
        `&fields=id,participants,messages{id,from,message,created_time}` +
        `&limit=20&access_token=${pageToken}`
      );
      const data1 = await res1.json();

      if (!data1.error) {
        conversations = data1.data ?? [];
        console.log(`[Catchup] DMs: fetched ${conversations.length} conversations via Page-scoped API` +
          (conversations.length === 0 ? ` (raw paging: ${JSON.stringify(data1.paging ?? {})})` : ""));
      } else {
        console.warn(`[Catchup] DMs: Page-scoped API failed (code ${data1.error.code}): ${data1.error.message}` +
          ` [type: ${data1.error.type ?? "unknown"}, subcode: ${data1.error.error_subcode ?? "none"}]`);

        // -- Attempt 2: IG account-scoped conversations API --------------------
        if (igAcctId) {
          try {
            const res2  = await fetchWithRetry(
              `${GRAPH_BASE}/${igAcctId}/conversations?platform=instagram` +
              `&fields=id,participants,messages{id,from,message,created_time}` +
              `&limit=20&access_token=${igToken}`
            );
            const data2 = await res2.json();

            if (!data2.error) {
              conversations = data2.data ?? [];
              console.log(`[Catchup] DMs: fetched ${conversations.length} conversations via IG account-scoped API`);
            } else {
              console.warn(`[Catchup] DMs: IG account-scoped API also failed (code ${data2.error.code}): ${data2.error.message}`);
              apiBlocked = true;
              errors.push(`DM fetch API error: ${data1.error.message} (code ${data1.error.code})`);
            }
          } catch (err2) {
            apiBlocked = true;
            errors.push(`DM fetch (IG-scoped) network error: ${String(err2)}`);
            console.error("[Catchup] DMs: IG account-scoped fetch failed (network):", String(err2));
          }
        } else {
          apiBlocked = true;
          errors.push(`DM fetch API error: ${data1.error.message} (code ${data1.error.code})`);
        }
      }
    } catch (err1) {
      apiBlocked = true;
      errors.push(`DM fetch network error: ${String(err1)}`);
      console.error("[Catchup] DMs: Page-scoped fetch failed (network):", String(err1));
    }

    // -- Fallback: replay unreplied webhook-delivered DMs from ActivityLog -----
    // When the Conversations API is blocked (app in Development mode, error 3),
    // look for DM_RECEIVED entries logged by the webhook handler and reply to
    // any that don't yet have a corresponding DM_AUTO_REPLIED entry.
    if (apiBlocked && conversations.length === 0) {
      console.log("[Catchup] DMs: Conversations API blocked -- scanning ActivityLog for unreplied webhook DMs");
      try {
        const user = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
        if (user) {
          const dmLogs = await prisma.activityLog.findMany({
            where: { userId: user.id, action: "DM_RECEIVED" },
            orderBy: { createdAt: "desc" },
            take: 20,
          });

          // Collect all entityIds that already have a DM_AUTO_REPLIED log
          const repliedEntityIds = new Set<string>(
            (await prisma.activityLog.findMany({
              where:  { userId: user.id, action: "DM_AUTO_REPLIED" },
              select: { entityId: true },
            })).map((l) => l.entityId ?? "")
          );

          for (const log of dmLogs) {
            if (repliedEntityIds.has(log.entityId ?? "")) continue;
            if (repliedConversationSetForBrand.has(log.entityId ?? "")) continue;

            const meta = (log.metadata ?? {}) as any;
            const senderId       = meta.senderId;
            const text           = meta.text ?? "";
            const senderUsername = meta.username ?? senderId;
            if (!senderId || !text) continue;

            // Only reply to messages received in the last 48 hours
            if (Date.now() - log.createdAt.getTime() > 48 * 60 * 60 * 1000) continue;

            const thread  = [{ from: `@${senderUsername}`, text, time: log.createdAt.toISOString() }];
            const aiReply = (await generateAIDMReply(thread, senderUsername)) ?? dmAutoReply ?? null;

            if (!aiReply) {
              console.log(`[Catchup] DMs: No reply for @${senderUsername} -- AI unavailable and no fallback`);
              continue;
            }

            try {
              const replyRes  = await fetchWithRetry(`${GRAPH_BASE}/${PAGE_ID}/messages`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  recipient:    { id: senderId },
                  message:      { text: aiReply },
                  access_token: pageToken,
                }),
              });
              const replyData = await replyRes.json();

              if (replyData.error) {
                if (isPermanentDmError(replyData.error)) {
                  // Non-retryable (e.g. #10 outside the 24h window). Mark handled so
                  // the dedup set + DM_AUTO_REPLIED query skip it next cycle.
                  await safeLog({
                    action:   "DM_AUTO_REPLIED",
                    entity:   "DirectMessage",
                    entityId: log.entityId ?? senderId,
                    metadata: { recipientId: senderId, username: senderUsername, skipped: true, skipReason: `${replyData.error.message} (code ${replyData.error.code})`, catchup: true },
                  });
                  boundedAdd(repliedConversationSetForBrand, log.entityId ?? senderId);
                  console.warn(`[Catchup] DMs: @${senderUsername} not repliable (${replyData.error.message}) — marked handled, won't retry`);
                  continue;
                }
                errors.push(`DM reply to ${senderUsername}: ${replyData.error.message} (code ${replyData.error.code})`);
                console.error("[Catchup] DMs: ActivityLog-based reply error:", replyData.error);
                continue;
              }

              await safeLog({
                action:   "DM_AUTO_REPLIED",
                entity:   "DirectMessage",
                entityId: log.entityId ?? senderId,
                metadata: { recipientId: senderId, username: senderUsername, messageId: replyData.message_id, replyText: aiReply, catchup: true },
              });

              boundedAdd(repliedConversationSetForBrand, log.entityId ?? senderId);
              replied++;
              console.log(`[Catchup] DMs: Replied to @${senderUsername} via ActivityLog fallback`);
              console.log(`[Catchup]   Their message: "${text.slice(0, 60)}"`);
              console.log(`[Catchup]   AI reply:      "${aiReply.slice(0, 80)}"`);
            } catch (err) {
              errors.push(`DM reply (fallback) ${senderUsername}: ${String(err)}`);
              console.error("[Catchup] DMs: ActivityLog-based reply exception:", String(err));
            }
          }
        }
      } catch (dbErr) {
        errors.push(`DM ActivityLog fallback: ${String(dbErr)}`);
        console.error("[Catchup] DMs: ActivityLog fallback error:", String(dbErr));
      }

      return replied;
    }

    // -- Process conversations fetched from the API ----------------------------
    for (const convo of conversations) {
      const messages = convo.messages?.data ?? [];
      if (messages.length === 0) continue;

      const latest = messages[0]; // API returns newest-first

      // Skip if the latest message is from us (already replied).
      // This is the PRIMARY dedup: once we reply, our message becomes newest, so
      // this conversation is naturally skipped until the user sends a NEW message.
      const isFromUs = latest.from?.id ? ourIds.has(latest.from.id) : false;
      if (isFromUs) continue;

      // Skip if we ALREADY replied to this exact incoming message (webhook may have
      // handled it instantly). Keyed by the latest message id so future messages in
      // the same conversation are still answered.
      const alreadyAnswered = await prisma.activityLog.findFirst({
        where: { action: "DM_AUTO_REPLIED", entityId: latest.id },
        select: { id: true },
      }).catch(() => null);
      if (alreadyAnswered) continue;

      // Only reply to messages received in the last 48 hours
      const latestTime = new Date(latest.created_time).getTime();
      if (Date.now() - latestTime > 48 * 60 * 60 * 1000) continue;

      const sender = convo.participants?.data?.find((p) => !ourIds.has(p.id));
      if (!sender) continue;

      const senderUsername = sender.username ?? sender.name ?? sender.id;

      // Build conversation thread for AI context
      const thread = messages.map((m) => ({
        from: ourIds.has(m.from?.id) ? ownHandleTag : `@${senderUsername}`,
        text: m.message,
        time: m.created_time,
      }));

      try {
        // Generate AI-powered DM reply (fall back to the brand's DM auto-reply)
        const aiReply = (await generateAIDMReply(thread, senderUsername)) ?? dmAutoReply ?? null;

        if (!aiReply) {
          console.log(`[Catchup] DMs: Skipping DM to @${senderUsername} -- AI unavailable and no fallback`);
          continue;
        }

        const replyRes  = await fetchWithRetry(`${GRAPH_BASE}/${PAGE_ID}/messages`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient:    { id: sender.id },
            message:      { text: aiReply },
            access_token: pageToken,
          }),
        });
        const replyData = await replyRes.json();

        if (replyData.error) {
          if (isPermanentDmError(replyData.error)) {
            // Non-retryable (e.g. #10 outside the 24h window). Mark the message
            // handled (skipped, NOT counted as a reply) so we don't retry this
            // stale DM every cycle and spam the logs/digest.
            await safeLog({
              action:   "DM_AUTO_REPLIED",
              entity:   "DirectMessage",
              entityId: latest.id,
              metadata: { conversationId: convo.id, recipientId: sender.id, username: senderUsername, skipped: true, skipReason: `${replyData.error.message} (code ${replyData.error.code})`, catchup: true },
            });
            console.warn(`[Catchup] DMs: @${senderUsername} not repliable (${replyData.error.message}) — marked handled, won't retry`);
            continue;
          }
          errors.push(`DM reply to ${senderUsername}: ${replyData.error.message} (code ${replyData.error.code})`);
          console.error("[Catchup] DMs: Reply error:", replyData.error);
          continue;
        }

        // Key DM_AUTO_REPLIED on the INCOMING message id (latest.id) so the dedup
        // check above recognises this specific message as answered, while future
        // messages in the same conversation can still be replied to.
        await safeLog({
          action:   "DM_AUTO_REPLIED",
          entity:   "DirectMessage",
          entityId: latest.id,
          metadata: { conversationId: convo.id, recipientId: sender.id, username: senderUsername, messageId: replyData.message_id, replyText: aiReply, catchup: true },
        });
        await safeLog({
          action:   "DM_RECEIVED",
          entity:   "DirectMessage",
          entityId: latest.id,
          metadata: { senderId: sender.id, username: senderUsername, text: latest.message, timestamp: latest.created_time, catchup: true },
        });

        replied++;
        console.log(`[Catchup] DMs: AI replied to @${senderUsername}`);
        console.log(`[Catchup]   Their message: "${latest.message.slice(0, 60)}"`);
        console.log(`[Catchup]   AI reply:      "${aiReply.slice(0, 80)}"`);
      } catch (err) {
        errors.push(`DM reply ${senderUsername}: ${String(err)}`);
        console.error("[Catchup] DMs: Reply exception:", String(err));
      }
    }
  } catch (err) {
    const msg = String(err);
    errors.push(`DM catchup: ${msg}`);
    console.error("[Catchup] DM catchup unexpected error:", msg);
  }

  return replied;
}

// --- 4. Auto-schedule one Story per day ---------------------------------------
// Runs once per catchup cycle. Checks if a story is already scheduled for today.
// Respects StorySettings from preferences (enabled, postTime, scheduleDays, topics).
// When `force` is true (manual "Post a Story Now"), the daily guards and the
// enabled/scheduled-day checks are bypassed and the story is scheduled for NOW.
// Returns the new story's id (or null if none was created).
export async function scheduleAutoStory(force = false, ctxArg?: BrandContext): Promise<string | null> {
  try {
    // Resolve a brand context. External callers (manual "Post a Story Now") omit it →
    // primary brand, preserving the exact single-account behaviour.
    const ctx = ctxArg ?? await getPrimaryBrandContext();

    // -- Read story preferences (this brand's) ---------------------------------
    const prefs = ctx.prefs;
    const storyCfg = prefs.stories;

    // Respect the enabled toggle (skipped on manual force)
    if (!storyCfg.enabled && !force) {
      console.log("[Catchup] Auto-story disabled in settings -- skipping");
      return null;
    }

    // Check if today is a scheduled day — use IST day, not UTC day.
    // IST is UTC+5:30, so the IST date can differ from the UTC date by ±1.
    const IST_TZ       = "Asia/Kolkata";
    const nowInIST     = new Date().toLocaleString("en-US", { timeZone: IST_TZ });
    const todayDow     = new Date(nowInIST).getDay();  // 0=Sun … 6=Sat in IST
    if (!storyCfg.scheduleDays.includes(todayDow) && !force) {
      console.log(`[Catchup] Auto-story not scheduled for IST day ${todayDow} -- skipping`);
      return null;
    }

    // Check if a story was already CREATED today (in IST) — use createdAt, not scheduledFor.
    // Using createdAt is more reliable: scheduledFor can be set to any time and may match
    // across multiple IST days (e.g. if the story was never published and its scheduledFor
    // was "now + 10 min" from a prior day that happens to fall in today's UTC range).
    // createdAt is set once at DB record creation and unambiguously identifies when the
    // record was created — one story per IST calendar day.
    const nowUtcForCheck = new Date();
    // Parse the IST "today" calendar date
    const istParts   = new Intl.DateTimeFormat("en-US", {
      timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(nowUtcForCheck);
    const pp: Record<string, number> = {};
    for (const p of istParts) if (p.type !== "literal") pp[p.type] = parseInt(p.value, 10);
    const istYear  = pp["year"]!;
    const istMonth = pp["month"]!;   // 1-based
    const istDay   = pp["day"]!;

    // IST midnight boundaries (UTC). todayEnd is the EXCLUSIVE next-midnight instant
    // (matches tzDayInfo); the old lte:23:59 boundary left a 60-second hole
    // (23:59:01–23:59:59) where a story created/scheduled in that window wasn't seen
    // by the once-per-day guards. Paired with `lt: todayEnd` below.
    const todayStart = wallTimeToUTC(istYear, istMonth, istDay,  0,  0, IST_TZ);
    const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // -- Self-heal: clear stuck stories ----------------------------------------
    // A story that has been PENDING for more than 24h never published (image-gen
    // or publish failure). Such a story would otherwise satisfy the guards below
    // forever and block a fresh story from ever being created. Mark it FAILED so
    // today's generation can proceed.
    const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const healed = await prisma.scheduledPost.updateMany({
      where:  { postType: "STORY", status: "PENDING", createdAt: { lt: staleCutoff }, ...brandFilter(ctx) },
      data:   { status: "FAILED", error: "Auto-expired: story stuck PENDING >24h, cleared so a fresh story can generate" },
    }).catch(() => ({ count: 0 }));
    if (healed.count > 0) {
      console.log(`[Catchup] Auto-story self-heal: cleared ${healed.count} stuck PENDING story(ies) older than 24h`);
    }

    // Primary guard: was a story CREATED today (in IST)? (bypassed on manual force)
    // Status filter is `notIn: [CANCELLED]` (NOT `in: [PENDING, PUBLISHED]`) on purpose:
    // while a story is publishing, publishOverdueScheduled briefly flips its status to
    // FAILED ("__CLAIMING__" lock). If we only matched PENDING/PUBLISHED, a concurrent
    // run during that ~15s window wouldn't see it and would create a DUPLICATE story
    // (the exact 2-stories-per-day bug). Counting every non-cancelled story created
    // today closes that race.
    const existingCreatedToday = force ? null : await prisma.scheduledPost.findFirst({
      where: {
        postType:  "STORY",
        createdAt: { gte: todayStart, lt: todayEnd },
        status:    { notIn: ["CANCELLED"] },
        ...brandFilter(ctx),
      },
    });

    if (existingCreatedToday) {
      console.log(`[Catchup] Auto-story already created today in IST (${existingCreatedToday.id}, status ${existingCreatedToday.status}) -- skipping`);
      return null;
    }

    // Secondary guard: also skip if a story is already scheduled for today's IST window
    // (catches stories created in UTC today but IST yesterday edge cases). (bypassed on force)
    const existingScheduledToday = force ? null : await prisma.scheduledPost.findFirst({
      where: {
        postType:    "STORY",
        scheduledFor: { gte: todayStart, lt: todayEnd },
        status:      { notIn: ["CANCELLED"] },
        // Only match stories created today or yesterday — prevents stale old stories from blocking
        createdAt:   { gte: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000) },
        ...brandFilter(ctx),
      },
    });

    if (existingScheduledToday) {
      console.log(`[Catchup] Auto-story already scheduled for today (${existingScheduledToday.id}) -- skipping`);
      return null;
    }

    // -- Build Grok prompt from preferences ------------------------------------
    const brand = ctx.prefs.brand;
    // Default topic pool: the story topics, else the brand's configured topics,
    // else (no topics anywhere) a single entry for the brand's niche.
    const defaultTopics = storyCfg.topics.length
      ? storyCfg.topics
      : (brand.topics.length ? brand.topics : [brand.niche]);

    const extraInstructions = storyCfg.customPromptExtra
      ? `\n\nAdditional instructions: ${storyCfg.customPromptExtra}`
      : "";

    // Pick a random topic from the list so each day's story is on a different subject
    const topicsArray = defaultTopics;
    // -- Anti-repetition: look at recent stories to avoid repeating ------------
    // Pull the last 10 story titles (headlines) so we can (a) skip topics whose
    // headline was recently used and (b) tell the AI which angles to avoid.
    const recentStories = await prisma.scheduledPost.findMany({
      where:   { postType: "STORY", ...brandFilter(ctx) },
      orderBy: { createdAt: "desc" },
      take:    10,
      select:  { title: true, content: true },
    }).catch(() => [] as { title: string; content: string }[]);
    const recentHeadlines = recentStories.map((s) => s.title).filter(Boolean);

    // Pick the next topic: an unused configured topic, or — once all configured
    // topics are exhausted — a fresh AI-generated topic similar to them. Never
    // repeats a topic that has been used before. (logTopicUsed runs inside.)
    const todayTopic = (await pickNextTopic("story", topicsArray, new Set(), ctx.prefs.brand)) ?? topicsArray[0];

    const avoidBlock = recentHeadlines.length
      ? `\n\nDO NOT repeat or closely paraphrase any of these recent story headlines (use a fresh angle and fresh wording):\n${recentHeadlines.map((h) => `- ${h}`).join("\n")}`
      : "";

    // Generate a fresh unique story via AI provider — headline, body, 6 topic-specific tips, tagline.
    // generateJSONResilient walks the SELECTED provider's JSON chain THEN falls back to the
    // OTHER provider's JSON when the first is exhausted (429/quota=0), so the story never
    // silently degrades to canned filler when the free Gemini quota is gone.
    const raw = await generateJSONResilient(
      `Generate content for an Instagram Story card for ${atHandle(brand)} (a ${brand.niche} account).

TODAY'S TOPIC: ${todayTopic}${avoidBlock}

Return a JSON object with EXACTLY these fields:
{
  "headline": "Short punchy title about today's topic (max 9 words, no hashtags)",
  "body": "1-2 sentences of practical advice about today's topic (max 160 characters, plain text, no hashtags)",
  "tips": [
    "Tip 1 specific to today's topic (3-7 words)",
    "Tip 2 specific to today's topic (3-7 words)",
    "Tip 3 specific to today's topic (3-7 words)",
    "Tip 4 specific to today's topic (3-7 words)",
    "Tip 5 specific to today's topic (3-7 words)",
    "Tip 6 specific to today's topic (3-7 words)"
  ],
  "tagline": "Short motivational quote related to today's topic (max 12 words, no hashtags)"
}

RULES:
- All 6 tips must be SPECIFIC to today's topic — NOT generic ("stay hydrated", "sleep 8 hours")
- Each tip must be different; no repetition
- Write for a general audience, not experts — simple language
- All text plain (no asterisks, no hashtags, no markdown)
${extraInstructions}`,
      `You are an expert ${brand.niche} educator creating content for a general audience. Return ONLY valid JSON, no markdown, no code blocks.`,
      1800,
      ctx.brandId,
    );

    let headline = `${brand.niche} tip of the day`;
    let body     = `Small daily habits add up. ${brand.commentCtaLine?.trim() || "Follow for more!"}`;
    let tips: string[]  = [];
    let tagline: string = "";

    try {
      const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
      const parsed  = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);
      headline = parsed.headline ?? headline;
      body     = parsed.body     ?? body;
      tips     = Array.isArray(parsed.tips)
        ? (parsed.tips as string[]).filter(Boolean).map((t: string) => t.trim()).slice(0, 6)
        : [];
      tagline  = (typeof parsed.tagline === "string" && parsed.tagline.trim())
        ? parsed.tagline.trim()
        : "";
    } catch {
      console.warn("[Catchup] Could not parse story tip JSON -- using fallback content");
    }

    // -- Compute scheduled time from preferences --------------------------------
    // IMPORTANT: storyCfg.postTime is a wall-clock time in the user's timezone
    // (e.g. "09:00 Asia/Kolkata" = 03:30 UTC).  We must NOT use setUTCHours()
    // directly — that would treat the HH:MM as UTC and be 5 h 30 min off for IST.
    // Also: use the IST calendar date (already resolved above as istYear/istMonth/istDay),
    // NOT the UTC date. When it is e.g. 12:00 AM IST (= 18:30 UTC prev day), the UTC
    // date is yesterday — using it would compute 9 AM IST for yesterday, which is already
    // past, causing the story to be published immediately instead of at 9 AM IST today.
    const [hh, mm] = (storyCfg.postTime ?? "09:00").split(":").map(Number);
    const storyTz  = (storyCfg as any).timezone ?? "Asia/Kolkata";

    // Compute the UTC timestamp for HH:MM on today's IST date
    const todayUTC   = wallTimeToUTC(istYear, istMonth, istDay, hh, mm, storyTz);
    const targetPast = todayUTC.getTime() <= Date.now();
    console.log(`[Catchup] Story scheduling: IST date ${istYear}-${istMonth}-${istDay}, target ${hh}:${String(mm).padStart(2,"0")} ${storyTz} → UTC ${todayUTC.toISOString()}, past=${targetPast}`);

    let scheduledFor: Date;
    if (force) {
      // Manual "Post a Story Now" → schedule for NOW so it publishes this cycle
      scheduledFor = new Date(Date.now() - 1000);
    } else if (!targetPast) {
      // Still before the target time today → schedule for today at the correct UTC moment
      scheduledFor = todayUTC;
    } else {
      // Past today's target time → schedule 10 min from now (publish ASAP this cycle)
      scheduledFor = new Date(Date.now() + 10 * 60 * 1000);
    }

    const userId = await getSystemUserId();
    if (!userId) {
      console.warn("[Catchup] No userId found -- cannot create auto story");
      return null;
    }

    // Encode tips + tagline into content so image generation can pick them up.
    // Format: line 0 = headline, line 1 = body, lines 2-7 = tips (prefixed "TIP:"),
    //         last line = tagline (prefixed "TAGLINE:") if present.
    const tipLines    = tips.map((t) => `TIP:${t}`);
    const taglineLine = tagline ? `TAGLINE:${tagline}` : "";
    const contentStr  = [headline, body, ...tipLines, taglineLine]
      .filter(Boolean)
      .join("\n");

    // When stories.publishToYouTube is on (and YouTube is configured), create the
    // story with platform="both" so the scheduler publishes the IG story AND a
    // forced YouTube Short (forceYouTubeShort builds a STORY-type Short from the
    // story's title/content — there is no linked Post). Otherwise plain "instagram".
    const storyPlatform = (storyCfg.publishToYouTube && isYouTubeConfigured(ctx.ytCreds)) ? "both" : "instagram";

    const story = await prisma.scheduledPost.create({
      data: {
        userId,
        postType:    "STORY",
        title:       headline,
        content:     contentStr,
        hashtags:    [],
        scheduledFor,
        timezone:    "Asia/Kolkata",
        status:      "PENDING",
        isRecurring: false,
        platform:    storyPlatform,
        brandId:     brandIdForWrite(ctx),
      } as any,
    });

    await safeLog({
      action:   "POST_SCHEDULED",
      entity:   "Story",
      entityId: story.id,
      metadata: { headline, topic: todayTopic, tipsCount: tips.length, autoScheduled: true, scheduledFor, postTime: storyCfg.postTime },
    });

    console.log(`[Catchup] Auto-story ${force ? "FORCE-" : ""}scheduled: "${headline}" (topic: ${todayTopic}, ${tips.length} tips) at ${scheduledFor.toISOString()}`);
    return story.id;
  } catch (err) {
    // Best-effort -- never block the main catchup loop
    console.warn("[Catchup] Auto-story scheduling failed:", String(err));
    return null;
  }
}

// --- Fallback comment check (2-minute cycle) ----------------------------------
// Webhooks are the primary real-time path. This polling is the FALLBACK for when
// Meta cannot deliver webhooks (app in Development mode, tunnel URL changed, etc.).
// BUDGET: 5 posts × 1 API call each = 5 calls/run × 30 runs/hr = 150 calls/hr.
// Stays well within Instagram's rate limit (4,800 calls/hr for business accounts).
let _lastCommentCheckAt: Date | null = null;
// Webhook handles real-time comments — fast-check is just a fallback.
// Without webhook: 2 min. With webhook: 30 min (just to catch any missed events).
const COMMENT_CHECK_INTERVAL_MS = process.env.WEBHOOK_VERIFY_TOKEN ? 30 * 60 * 1000 : 120_000;

export interface FastCommentResult {
  newComments:     number;
  commentsReplied: number;
  errors:          string[];
  ranAt:           string;
  skippedReason?:  string; // set when the run was skipped (e.g. "webhook_active")
}

export async function runCommentCheck(): Promise<FastCommentResult> {
  const now = new Date();

  if (isRateLimited()) {
    return { newComments: 0, commentsReplied: 0, errors: ["Rate limited"], ranAt: now.toISOString() };
  }

  // ── Webhook-active guard ──────────────────────────────────────────────────
  // If the Meta webhook delivered a comment within the last 10 minutes,
  // the webhook is healthy and we do NOT need to poll the Instagram API.
  // This saves all API quota (0 gr:get:ShadowIGMedia/comments calls).
  // The guard resets automatically when 10 min pass without a webhook event,
  // so we fall back to polling if the webhook goes down.
  if (isWebhookActive()) {
    const ago = secondsSinceLastWebhookComment();
    console.log(`[FastCheck] Skipped  -  webhook is active (last event ${ago}s ago). API polling suppressed.`);
    return {
      newComments:    0,
      commentsReplied: 0,
      errors:         [],
      ranAt:          now.toISOString(),
      skippedReason:  `webhook_active (last event ${ago}s ago)`,
    } as FastCommentResult;
  }

  if (_lastCommentCheckAt && now.getTime() - _lastCommentCheckAt.getTime() < COMMENT_CHECK_INTERVAL_MS) {
    const waited = Math.round((now.getTime() - _lastCommentCheckAt.getTime()) / 1000);
    console.log(`[FastCheck] Skipped -- ran ${waited}s ago (min: ${COMMENT_CHECK_INTERVAL_MS / 1000}s)`);
    return { newComments: 0, commentsReplied: 0, errors: [], ranAt: (_lastCommentCheckAt ?? now).toISOString() };
  }
  _lastCommentCheckAt = now;

  const { igToken, igAcctId } = await getCredentials();
  if (!igToken || !igAcctId) {
    return { newComments: 0, commentsReplied: 0, errors: ["No Instagram credentials"], ranAt: now.toISOString() };
  }

  // This fast path is the PRIMARY account only — resolve its brand skin for the
  // comment-reply fallback (when the AI provider is unavailable).
  const brand = await getBrand();

  const errors: string[] = [];
  let newComments = 0;
  let repliedCount = 0;

  // -- Step 1: Fetch the 5 most-recently-published NON-STORY posts from DB -----
  // Cap at 5 to keep API usage low: 5 posts × 1 comment call each = 5 API calls/run.
  // The full runCatchup() (every 5 min) sweeps all 20 posts for thorough coverage.
  // Stories don't support the /comments endpoint -- must be excluded.
  const dbPosts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      instagramPostId: { not: null },
      type: { not: "STORY" },
    },
    select: { id: true, instagramPostId: true, title: true, type: true, hook: true, content: true, reelScript: true },
    orderBy: { publishedAt: "desc" },
    take: 5, // was 20  -  reduced to keep IG API calls low (5 calls/run × 30 runs/hr = 150/hr)
  });

  // Build context map from DB posts
  const igIdToCtx = new Map<string, PostCommentContext & { dbId?: string }>(
    dbPosts.filter((p) => p.instagramPostId).map((p) => {
      const isQuiz = ["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(p.type);
      // Priority 1: user-provided answer in reelScript as "QUIZ_ANS:<letter>|<text>"
      let correctLetter: string | undefined;
      let correctAnswer: string | undefined;
      if (isQuiz && p.reelScript?.startsWith("QUIZ_ANS:")) {
        const parts = p.reelScript.slice(9).split("|");
        correctLetter = parts[0]?.trim().toUpperCase() || undefined;
        correctAnswer = parts[1]?.trim() || undefined;
      }
      // Priority 2: "Answer: B — ..." in content
      if (!correctLetter && isQuiz && p.content) {
        const parsed = extractCorrectAnswer(p.content);
        correctLetter = parsed?.letter;
        correctAnswer = parsed?.text;
      }
      return [p.instagramPostId as string, {
        dbId:          p.id,
        postType:      p.type,
        postTitle:     p.title,
        postHook:      p.hook ?? undefined,
        postContent:   p.content ? p.content.slice(0, 1200) : undefined,
        correctLetter,
        correctAnswer,
      }];
    })
  );

  // -- Step 2: Use only DB posts for the quick check ---------------------------
  // REMOVED: IG media API supplement (was gr:get:ShadowIGMedia  -  1 extra call/run).
  // The full runCatchup() still fetches the IG media list; the quick check stays cheap.
  let mediaIds = Array.from(igIdToCtx.keys());
  console.log(`[FastCheck] Checking comments on ${mediaIds.length} most-recent posts (DB only, no IG API call)`);

  for (const mediaId of mediaIds) {
    const dbCtx = igIdToCtx.get(mediaId) ?? {};
    let { dbId: _dbId, ...postCtx } = dbCtx as PostCommentContext & { dbId?: string };
    const dbPostId = (dbCtx as any).dbId ?? null;

    // -- Pre-resolve quiz answer for this post ---------------------------------
    // Do this BEFORE processing any comment so all commenters on the same post
    // are evaluated against the same correct answer (not re-determined per reply).
    if (!postCtx.correctLetter && (postCtx.postContent || postCtx.postTitle)) {
      const caption = postCtx.postContent ?? postCtx.postTitle ?? "";
      const isQuizLike =
        ["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(postCtx.postType ?? "") ||
        /\bA[.)]\s*\w[\s\S]*?\bB[.)]\s*\w/i.test(caption) ||
        /\b(option|choice|quiz|mcq)\b/i.test(caption) ||
        /\bcomment\s+(a|b|c|d)\b|\bdrop.*answer|\b(a|b|c|d)\s+below/i.test(caption);

      if (isQuizLike) {
        const answer = await resolveQuizAnswer(mediaId, caption);
        if (answer) {
          postCtx = { ...postCtx, correctLetter: answer.correctLetter, correctAnswer: answer.correctAnswer };
        }
      }
    }

    // Throttle: 500ms between posts
    await new Promise((r) => setTimeout(r, 500));

    try {
      const res = await fetchWithRetry(
        `${GRAPH_BASE}/${mediaId}/comments?fields=id,text,username,timestamp,from{id,username}&limit=25&access_token=${igToken}`
      );
      const data = await res.json();

      if (data.error) {
        const code = data.error.code;
        if (code === 4 || code === 32 || code === 613) { markRateLimited(); break; }
        if (code === 100) {
          // Permission / unsupported media (deleted post, story, hidden) -- skip silently
          console.warn(`[FastCheck] Skipping media ${mediaId}: unsupported or no permission (code 100)`);
          continue;
        }
        errors.push(`FastCheck ${mediaId}: ${data.error.message}`);
        continue;
      }

      const igComments: Array<{ id: string; text: string; username: string; timestamp: string; from?: { id?: string; username?: string } }> =
        data.data ?? [];

      for (const c of igComments) {
        if (isOwnComment(c)) continue;
        if (_repliedCommentIds.has(c.id)) continue;

        const existing = await prisma.comment
          .findUnique({ where: { instagramCommentId: c.id } })
          .catch(() => null);

        if (!existing) {
          try {
            await prisma.comment.create({
              data: {
                instagramCommentId: c.id,
                postId:    dbPostId ?? null,
                mediaId,
                username:  c.username ?? "unknown",
                text:      c.text     ?? "",
                timestamp: new Date(c.timestamp),
              },
            });
          } catch { /* already exists -- continue to reply */ }

          // ── Log + notify IMMEDIATELY (before AI so the UI shows the comment NOW) ──
          // safeLog creates an ActivityLog the SSE DB-poll picks up within 2 s,
          // causing the notification panel and activity feed to update instantly.
          await safeLog({
            action:   "COMMENT_RECEIVED",
            entity:   "Comment",
            entityId: c.id,
            metadata: { commentId: c.id, mediaId, text: c.text, username: c.username,
                        replied: false, catchup: true },
          });
          notifEmitter.emit("notif", {
            id:        c.id,
            type:      "comment",
            message:   "🗨️ New comment on your post",
            detail:    `@${c.username ?? "friend"}: "${(c.text ?? "").slice(0, 80)}"`,
            entityId:  c.id,
            action:    "COMMENT_RECEIVED",
            createdAt: new Date().toISOString(),
            read:      false,
          } as LiveNotif);

          // Atomic cross-path claim — only the winner replies; all other paths skip.
          const claimed = await claimCommentForReply(c.id, {
            postId:    dbPostId ?? null,
            mediaId,
            username:  c.username ?? "unknown",
            text:      c.text     ?? "",
            timestamp: new Date(c.timestamp),
          });
          if (claimed) {
            const aiReply = await generateAICommentReply(c.text ?? "", c.username ?? "friend", postCtx, brand);
            if (aiReply) {
              const sent = await replyToComment(c.id, aiReply, igToken);
              if (sent) {
                boundedAdd(_repliedCommentIds, c.id);
                repliedCount++;
                await markCommentReplied(c.id, aiReply);
                // Update the activity log to mark as replied
                await safeLog({
                  action:   "COMMENT_REPLIED",
                  entity:   "Comment",
                  entityId: c.id,
                  metadata: { commentId: c.id, mediaId, username: c.username,
                              replyText: aiReply, catchup: true },
                }).catch(() => {});
                console.log(`[FastCheck] Replied to @${c.username}: "${aiReply.slice(0, 60)}"`);
              } else {
                // Send failed — release so a later run can retry.
                await releaseCommentClaim(c.id);
              }
            } else {
              // No reply generated — release so a later run can retry.
              await releaseCommentClaim(c.id);
            }
          } else {
            boundedAdd(_repliedCommentIds, c.id);
          }
          newComments++;

        } else if (!existing.replied) {
          const claimed = await claimCommentForReply(c.id, {
            postId:    dbPostId ?? null,
            mediaId,
            username:  existing.username ?? "unknown",
            text:      existing.text     ?? "",
            timestamp: new Date(c.timestamp),
          });
          if (!claimed) {
            boundedAdd(_repliedCommentIds, c.id);
            continue;
          }
          const aiReply = await generateAICommentReply(
            existing.text ?? "", existing.username ?? "friend", postCtx, brand
          );
          if (aiReply) {
            const sent = await replyToComment(c.id, aiReply, igToken);
            if (sent) {
              boundedAdd(_repliedCommentIds, c.id);
              repliedCount++;
              await markCommentReplied(c.id, aiReply);
            } else {
              await releaseCommentClaim(c.id);
            }
          } else {
            await releaseCommentClaim(c.id);
          }
        } else {
          boundedAdd(_repliedCommentIds, c.id);
        }
      }

      // NOTE: Reply-thread checking (nested replies) has been moved to the full
      // runCatchup() / fetchMissedComments() which runs every 5 minutes.
      // Doing it here would add 3 extra API calls per post per 2-minute cycle  - 
      // that pushes us above rate limits. The webhook handles reply-to-reply in real-time.

    } catch (err) {
      errors.push(`FastCheck ${mediaId}: ${String(err)}`);
      console.error(`[FastCheck] Error on media ${mediaId}:`, String(err));
    }
  }

  const result = { newComments, commentsReplied: repliedCount, errors, ranAt: now.toISOString() };
  console.log("[FastCheck] Done:", result);
  return result;
}

// --- Rate-limit tracker -------------------------------------------------------
// When Meta returns code 4 (app rate limit), we back off for 1 hour
let rateLimitedUntil: Date | null = null;

export function markRateLimited(): void {
  rateLimitedUntil = new Date(Date.now() + 60 * 60 * 1000); // back off 1 hour
  console.warn(`[Catchup] Meta rate limit hit -- pausing all API calls until ${rateLimitedUntil.toISOString()}`);
  // Log for daily digest
  logRateLimitEvent("Instagram (Meta API)", "Rate limit hit — comment syncing paused for 1 hour");
  // Real-time alert
  notifyRateLimit({ service: "Instagram", detail: "Meta API rate limit hit. Comment syncing paused for 1 hour." }).catch((e: any) => {
    console.warn("[Catchup] Rate-limit email failed:", e?.message);
  });
}

export function isRateLimited(): boolean {
  if (!rateLimitedUntil) return false;
  if (Date.now() > rateLimitedUntil.getTime()) { rateLimitedUntil = null; return false; }
  return true;
}

// --- 5. Background auto-generate (no browser session needed) ------------------
// Reads autoPost preferences and generates+schedules posts for today.
// Gated to run once per calendar day (IST). Called from the 9 AM daily trigger.

// Per-brand once-per-IST-day guards and in-flight locks, keyed by brandId, so one
// brand's daily generation can never suppress or race another brand's.
const _lastAutoGenerateDateByBrand   = new Map<string, string>();
const _lastYouTubeGenerateDateByBrand = new Map<string, string>();
const _autoGenInFlightByBrand   = new Map<string, boolean>();
const _ytAutoGenInFlightByBrand = new Map<string, boolean>();

// Per-type IMAGE-CARD spec — defines what the on-image text must contain for each
// post type. Without this, every type got the generic "6 facts" card (wrong for
// quizzes, myth/fact, case studies, etc.). Niche-agnostic: the wording is neutral
// so it applies to ANY brand, and the CTA resolves to the active brand's handle.
function cardSpecFor(brand: BrandConfig): Record<string, string> {
  return {
  EDUCATIONAL:
    "7 numbered points (1.–7.), each on its own line. Each point is a COMPLETE, self-contained factual statement: a SPECIFIC number/stat/detail/percentage, PLUS why it matters (what it means AND why it's significant) — write the FULL, detailed informative line with no length limit (the card auto-fits; do NOT abbreviate or truncate). No vague steps.",
  CLINICAL_PEARL:
    "ONE high-value key insight as a bold 1-2 line takeaway, then 5 numbered supporting points (1.–5.). Each supporting point is a COMPLETE, self-contained factual statement with a specific number/detail/criterion PLUS why it matters — write the FULL, detailed informative line with no length limit (the card auto-fits; do NOT abbreviate or truncate).",
  PREVENTIVE:
    "7 numbered points (1.–7.), each on its own line. Each is a COMPLETE, self-contained actionable statement with a real number, target value, or concrete detail PLUS brief context explaining the action AND its benefit — write the FULL, detailed informative line with no length limit (the card auto-fits; do NOT abbreviate or truncate).",
  QUIZ:
    "Format the card content EXACTLY with these labelled sections (each on its own line):\nSCENARIO: <the relevant setup/context>\nQUESTION: <the question>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nDo NOT reveal or mark the correct answer anywhere. No asterisks.",
  ECG_QUIZ:
    "Format the card content EXACTLY with these labelled sections (each on its own line):\nSCENARIO: <the relevant setup/context>\nKEY DETAILS:\n- <detail 1>\n- <detail 2>\n- <detail 3>\nQUESTION: <the question>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nDo NOT reveal or mark the correct answer anywhere. No asterisks.",
  ANGIOGRAPHY_QUIZ:
    "Format the card content EXACTLY with these labelled sections (each on its own line):\nSCENARIO: <the relevant setup/context>\nKEY DETAILS:\n- <detail 1>\n- <detail 2 if relevant>\nQUESTION: <the specific decision>\nA) <option>\nB) <option>\nC) <option>\nD) <option>\nDo NOT reveal or mark the correct answer anywhere. No asterisks.",
  MYTH_FACT:
    "Line 1: 'MYTH: <common misconception>'. Line 2: 'FACT: <the evidence-based truth>'. Then 4 numbered supporting facts (1.–4.), each a full, detailed informative line with real data AND why it matters — no length limit (the card auto-fits).",
  CASE_STUDY:
    "A real-world example or scenario (4-5 lines setting up the context and key details), then 3 lines giving the outcome, the key takeaway, and the take-home lesson. Concise lines, no prose.",
  CAROUSEL:
    "6 numbered key points (1.–6.) for a single summary card. Each is a COMPLETE, self-contained factual statement with a specific number/stat/detail PLUS why it matters — write the FULL, detailed informative line with no length limit (the card auto-fits; do NOT abbreviate or truncate).",
  CTA:
    `3-4 short punchy lines: why to follow ${atHandle(brand)} and what content they'll get. Warm but authoritative.`,
  };
}

// Quiz-family types keep their question + A/B/C/D options on the card.
const QUIZ_TYPES = ["QUIZ", "ECG_QUIZ", "ANGIOGRAPHY_QUIZ"];

// Is this line quiz/option/answer/CTA noise that must NOT appear on a
// non-quiz (educational/preventive/pearl/carousel) card or its caption?
function isQuizOrCtaLine(l: string): boolean {
  return (
    /^[A-D][).:]\s/.test(l) ||                                   // A)/B)/C)/D) options
    /^(quiz|question)\s*[:\-]/i.test(l) ||                       // "Quiz:"/"Question:"
    /answer\s+(in\s+(the\s+)?comments?|tomorrow|below|later)/i.test(l) || // answer-reveal
    /^[(\[]?\s*answer\b/i.test(l)                                // "(Answer …)"
  );
}

/**
 * Ensure the image-card `content` is consistent with the `caption` and free of
 * quiz/CTA noise for NON-quiz post types.
 *   1. Strip any quiz/option/answer/CTA lines the AI leaked into an educational card.
 *   2. If that leaves too few real facts (the AI mislabeled a quiz as educational),
 *      rebuild the card facts from the caption's ①②③ key-point lines so the card
 *      MATCHES the caption instead of rendering empty.
 * Quiz-family types are returned unchanged (their cards need the Q + options).
 */
function deriveCardContent(type: string, content: string, caption: string): string {
  if (QUIZ_TYPES.includes(type)) return content;

  const clean = (s: string) =>
    s.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !isQuizOrCtaLine(l));

  let lines = clean(content);

  if (lines.length < 2 && caption) {
    // Caption key points are emitted as "① …", "② …" etc. Pull those as the facts.
    const keyPts = caption
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[①-⑨]/.test(l)) // ①..⑨
      .map((l) => l.replace(/^[①-⑨]\s*/, "").replace(/\*\*/g, "").trim())
      .filter(Boolean);
    if (keyPts.length >= 2) lines = keyPts.slice(0, 7);
  }

  // Never return empty — fall back to the original (filtered) content.
  return (lines.length ? lines : clean(content)).join("\n");
}

interface GeneratedPostSummary { type: string; title: string; scheduledFor: Date }

export async function runAutoGeneratePosts(ctxArg?: BrandContext): Promise<GeneratedPostSummary[]> {
  const generated: GeneratedPostSummary[] = [];
  const ctx = ctxArg ?? await getPrimaryBrandContext();
  if (_autoGenInFlightByBrand.get(ctx.brandId)) {
    console.log("[AutoGen] Already running — skipping concurrent invocation");
    return [];
  }
  _autoGenInFlightByBrand.set(ctx.brandId, true);
  try {
    const prefs = ctx.prefs;
    const cfg   = prefs.autoPost;
    // Per-post-type custom prompts the user configured in Settings → AI Prompts.
    // These were previously ONLY honoured by the manual /api/ai/generate route —
    // now the automated daily generator respects them too.
    const savedPrompts: Record<string, string> = (prefs.prompts ?? {}) as any;

    if (!cfg.enabled) {
      console.log("[AutoGen] Auto-post disabled in settings — skipping");
      return [];
    }
    if (!cfg.postTypes.length || !cfg.topics.length) {
      console.log("[AutoGen] No post types or topics configured — skipping");
      return [];
    }

    // Only run once per calendar day (IST)
    const IST_TZ   = "Asia/Kolkata";
    const nowInIST = new Date().toLocaleString("en-US", { timeZone: IST_TZ });
    const todayIST = new Date(nowInIST).toDateString();
    if (_lastAutoGenerateDateByBrand.get(ctx.brandId) === todayIST) {
      console.log("[AutoGen] Already ran today — skipping");
      return [];
    }

    // Check if today is a scheduled day.
    // PER-DAY (Feature 1): when a `dailySchedule` entry exists for today's weekday it
    // supersedes the global postsPerDay/scheduleTimes/scheduleDays. resolveDaySchedule
    // returns null when that day is explicitly disabled, the global values when no
    // custom entry exists (→ identical to before), or the day's overrides otherwise.
    const todayDow = new Date(nowInIST).getDay(); // 0=Sun...6=Sat
    const hasDayEntry = Array.isArray(cfg.dailySchedule)
      && cfg.dailySchedule.some((e) => e && Number(e.day) === todayDow);
    const daySched = resolveDaySchedule(
      todayDow, cfg.dailySchedule, cfg.postsPerDay, cfg.scheduleTimes,
      ctx.prefs.autoPost?.customScheduleOnly ?? false,
    );
    if (daySched === null) {
      console.log(`[AutoGen] Day ${todayDow} disabled in dailySchedule (or no custom entry under customScheduleOnly) — skipping`);
      _lastAutoGenerateDateByBrand.set(ctx.brandId, todayIST);
      return [];
    }
    // Only honour the GLOBAL scheduleDays gate when there is NO per-day entry for today
    // (a custom entry's own enabled flag governs the day instead).
    if (!hasDayEntry && cfg.scheduleDays.length && !cfg.scheduleDays.includes(todayDow)) {
      console.log(`[AutoGen] Day ${todayDow} not in scheduleDays — skipping`);
      return [];
    }
    const effectivePostsPerDay = daySched.postsPerDay;
    const effectiveTimes       = daySched.times.length ? daySched.times : cfg.scheduleTimes;

    // Parse today's IST calendar date for time calculations
    const nowUtc = new Date();
    const istParts = new Intl.DateTimeFormat("en-US", {
      timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(nowUtc);
    const pp: Record<string, number> = {};
    for (const p of istParts) if (p.type !== "literal") pp[p.type] = parseInt(p.value, 10);
    const istYear = pp["year"]!, istMonth = pp["month"]!, istDay = pp["day"]!;

    const todayStart = wallTimeToUTC(istYear, istMonth, istDay,  0,  0, IST_TZ);
    // Exclusive next-midnight boundary (matches tzDayInfo). Using lte:23:59 left a
    // 60-second hole (23:59:01–23:59:59) where posts weren't counted by the cap.
    const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // How many Instagram FEED posts are already scheduled/pending for today?
    // NOTE: exclude STORIES, but a post's postType can be NULL (older auto-posts
    // didn't stamp it). In SQL `postType != 'STORY'` does NOT match NULL, which made
    // this count silently return 0 → the generator re-created the day's posts on
    // every restart. Use a NULL-safe "not a story" filter and scope to IG feed
    // platforms so YouTube-only posts don't skew the Instagram daily cap.
    const existingCount = await prisma.scheduledPost.count({
      where: {
        platform: { in: ["instagram", "both"] },
        status: { in: ["PENDING", "PUBLISHED"] },
        scheduledFor: { gte: todayStart, lt: todayEnd },
        AND: [
          // NULL-safe: stories excluded, untyped feed posts counted. Deferred YT→IG
          // Reels (postType "REEL") are a separate content stream and must NOT skew
          // the Instagram feed daily cap.
          { OR: [{ postType: null }, { postType: { notIn: ["STORY", "REEL"] } }] },
          brandFilter(ctx),
        ],
      } as any,
    });

    const toGenerate = Math.max(0, effectivePostsPerDay - existingCount);
    if (toGenerate === 0) {
      console.log(`[AutoGen] ${existingCount}/${effectivePostsPerDay} posts already scheduled today — skipping`);
      _lastAutoGenerateDateByBrand.set(ctx.brandId, todayIST);
      return [];
    }

    const userId = await getSystemUserId();
    if (!userId) {
      console.warn("[AutoGen] No userId found in DB — cannot create auto posts");
      return [];
    }

    const brand = ctx.prefs.brand;
    const tz  = cfg.timezone || "Asia/Kolkata";

    // ── AI preference defaults (#7) ─────────────────────────────────────────
    // Honour Settings → AI defaults when the auto-gen prompt doesn't already
    // specify them. Optional-chained so missing ai prefs never crash.
    const aiPrefs        = (ctx.prefs.ai ?? {}) as any;
    const defaultTone    = (aiPrefs.defaultTone ?? "").trim();
    const aiLanguage     = (aiPrefs.language ?? "").trim();
    const toneDirective  = defaultTone
      ? `\n\nTONE: write in a ${defaultTone} tone.`
      : "";
    // Only force a language when set and not English (default content is English).
    const languageDirective = (aiLanguage && !/^english$/i.test(aiLanguage))
      ? `\n\nWrite the content in ${aiLanguage}.`
      : "";

    // ── Cross-post target ───────────────────────────────────────────────────
    // IG auto-posts are ALWAYS "instagram" — never "both" — regardless of
    // autoPost.publishToYouTube. YouTube can't accept image/community posts via
    // its API, so Instagram feed posts are not cross-posted to YouTube; dedicated
    // YouTube Shorts come from the independent YouTube auto-poster (prefs.youtube).
    const igPlatform = "instagram";

    console.log(`[AutoGen] Generating ${toGenerate} post(s) for today (${todayIST}) — platform=${igPlatform}`);

    // -- Anti-repetition: load recent posts so we never repeat topics/content --
    // Pull the last 30 days of post titles + hooks. We (a) avoid topics whose
    // title/hook was recently used and (b) tell the AI which posts to avoid.
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentPosts = await prisma.post.findMany({
      where:   { createdAt: { gte: since30d }, ...brandFilter(ctx) },
      orderBy: { createdAt: "desc" },
      take:    40,
      select:  { title: true, hook: true },
    }).catch(() => [] as { title: string; hook: string | null }[]);
    const recentAvoidList = recentPosts
      .map((p) => p.title)
      .filter(Boolean)
      .slice(0, 25);

    // Track topics chosen within THIS run so two posts today don't collide
    const usedThisRun = new Set<string>();

    // ── Post-type strategy ──────────────────────────────────────────────────
    // Desired mix per day:
    //   • Post 1  → EDUCATIONAL or CLINICAL_PEARL (alternates day to day)
    //   • Post 2+ → one of the OTHER 7 types, rotating through them across days
    //     so every non-core type gets used over time.
    // (Previously `i % length` always picked the first `postsPerDay` types every
    //  single day, so the other types were never generated.)
    const dayNumber = Math.floor(Date.now() / 86_400_000);
    const CORE = ["EDUCATIONAL", "CLINICAL_PEARL"];
    const coreGroup  = cfg.postTypes.filter((t) => CORE.includes(t));
    const otherGroup = cfg.postTypes.filter((t) => !CORE.includes(t));

    const pickType = (i: number): string => {
      if (i === 0) {
        // First post: a core type (Educational / Clinical Pearl), alternating daily
        if (coreGroup.length) return coreGroup[dayNumber % coreGroup.length];
        if (otherGroup.length) return otherGroup[dayNumber % otherGroup.length];
      } else {
        // Subsequent posts: rotate through the other 7 types across days
        if (otherGroup.length) return otherGroup[(dayNumber * Math.max(1, toGenerate - 1) + (i - 1)) % otherGroup.length];
        if (coreGroup.length)  return coreGroup[(dayNumber + i) % coreGroup.length];
      }
      // Fallback (config has types but neither group matched). When even that is
      // empty, fall back to the user's AI defaultType (#7), normalised to the enum
      // form (e.g. "Clinical Pearl" → "CLINICAL_PEARL"), else EDUCATIONAL.
      if (cfg.postTypes.length) return cfg.postTypes[(dayNumber + i) % cfg.postTypes.length];
      const dt = ((ctx.prefs.ai as any)?.defaultType ?? "").trim();
      return dt ? dt.toUpperCase().replace(/\s+/g, "_") : "EDUCATIONAL";
    };

    for (let i = 0; i < toGenerate; i++) {
      const type  = pickType(i);
      // Pick the next topic: an unused configured topic, or — once all configured
      // topics are exhausted — a fresh AI-generated topic similar to them. Never
      // repeats a previously-used topic. (logTopicUsed runs inside pickNextTopic.)
      const topic = (await pickNextTopic("post", cfg.topics, usedThisRun, ctx.prefs.brand))
        ?? cfg.topics[i % cfg.topics.length];
      usedThisRun.add(topic);

      const avoidBlock = recentAvoidList.length
        ? `\n\nANTI-REPETITION (critical for reach — platforms suppress repetitive uploads): do NOT cover the same SUBJECT/THEME as any recent post below, not just the same wording. If a theme already appears here, pick a genuinely DIFFERENT ${brand.niche} subject — do not make another post on that same theme with fresh words. Use a fresh subject, fresh angle, and fresh facts:\n${recentAvoidList.map((t) => `- ${t}`).join("\n")}`
        : "";

      // Honour the user's custom prompt for this post type (Settings → AI Prompts).
      const userTypePrompt = (savedPrompts[type] ?? "").trim();
      const customTypePrompt = userTypePrompt
        ? `\n\nADDITIONAL CREATOR INSTRUCTIONS for this ${type.replace(/_/g, " ")} post (follow these closely while keeping the JSON structure above):\n${userTypePrompt}`
        : "";

      // Type-specific spec for what the IMAGE CARD ("content") must contain.
      // Without this every type got the same "6 facts" card — wrong for quizzes,
      // myth/fact, case studies, etc.
      const cardSpec = cardSpecFor(brand)[type] ?? cardSpecFor(brand).EDUCATIONAL;

      try {
        // ── Generate content via AI ──────────────────────────────────────────
        const typeLabel = type.replace(/_/g, " ").toLowerCase();
        const prompt = `Generate a ${typeLabel} ${brand.niche} Instagram post about: "${topic}".

You are ${atHandle(brand)} — ${brand.persona.role}. Create high-impact ${brand.niche} content that gets saved and shared.

AUDIENCE: ${brand.audience}.
- Be accurate, specific, and genuinely useful — back claims with real numbers, facts, or examples.
- Frame the topic around what your audience actually cares about and can act on.
- Stay credible and evidence-based at all times.

IMAGE-CARD REQUIREMENT for this ${typeLabel} (this is what goes in the "content" field — the text rendered ON the image):
${cardSpec}

Return ONLY a valid JSON object with EXACTLY these fields:
{
  "title": "SEO title under 60 chars",
  "hook": "Card headline — bold 6-9 words, no asterisks, no punctuation at end",
  "content": "The IMAGE-CARD text. Follow the IMAGE-CARD REQUIREMENT above EXACTLY. Each item on its OWN LINE separated by \\n. Plain lines only — NO prose paragraphs, NO markdown, NO asterisks.",
  "caption": "Instagram caption (prose, DIFFERENT from and RICHER than the card). Make it LONG, detailed and substantial — aim for 380-550 words. Format like this (real \\n line breaks):\\n🚨 [Strong scroll-stopping hook — 1 sentence]\\n\\n[3-5 sentences of context that set up why this matters, with specifics and real-world framing]\\n\\n[6-8 key points, each on its own line starting with ① ② ③ ④ ⑤ ⑥ ⑦ ⑧ — each EXPANDED to a full, complete 1-2 sentence explanation with a real number/stat/detail AND its significance, NOT a fragment]\\n\\n💡 Why it matters: [2-3 full sentences on the real-world impact for your audience]\\n\\n💾 Save this for later →\\n\\nWhat's your experience? Drop it below 👇\\n\\nFollow ${atHandle(brand)} for more",
  "cta": "Short call to action fitting the post type",
  "hashtags": ["exactly 3 topic-specific hashtags, lowercase, no # prefix"]
}

RULES:
- "content" = ONLY the image-card text, following the IMAGE-CARD REQUIREMENT above. Plain lines, no prose.
- "caption" = ONLY Instagram text (prose with emojis). Must be DIFFERENT from the card content.
- For QUIZ-type posts the card MUST contain the question + options A) B) C) D); the caption must NOT reveal the answer (tease it).
- hashtags: EXACTLY 3. Mix 1 high-volume (>500k) + 1 medium (50k-500k) + 1 niche (<50k).${toneDirective}${customTypePrompt}${avoidBlock}${languageDirective}`;

        // generateJSONResilient walks the SELECTED provider's JSON chain then falls back
        // to the OTHER provider's JSON when the first is exhausted (429/quota=0) — this
        // prevents parse failures (and quota dead-ends) that dumped raw "{...}" text into
        // BOTH the image card and the caption (making them identical and broken).
        const raw   = await generateJSONResilient(prompt,
          buildBrandSystemPrompt(brand) + " Return ONLY valid JSON — no markdown, no preamble. Every post you write must be distinct from previous ones — never repeat the same facts, angle, or wording." + languageDirective,
          2500, ctx.brandId);

        // Parse AI response
        let parsed: any = {};
        try {
          const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
          parsed = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);
        } catch {
          // Last-resort fallback — NEVER dump raw JSON braces into content/caption.
          console.warn(`[AutoGen] JSON parse failed for ${type} post even after model chain — skipping this post`);
          continue; // skip creating a broken post rather than showing "{...}" on the card
        }

        // Use "caption" for the Instagram post text (prose), "content" for the image card (bullet points).
        // Fall back: if the AI didn't return a separate caption, use content as caption.
        if (!parsed.caption && parsed.content) parsed.caption = parsed.content;

        // Keep the image card consistent with the caption and free of quiz/CTA noise
        // for non-quiz types (fixes EDUCATIONAL cards that leaked quiz Q/options/answer).
        parsed.content = deriveCardContent(type, parsed.content || "", parsed.caption || "");

        // ── CAROUSEL: generate the 9 slides so the daily auto-poster can publish
        //    a real multi-slide carousel (not just a single summary card). ─────────
        let carouselSlides: Array<{ slide: number; headline: string; body: string }> | null = null;
        if (type === "CAROUSEL") {
          try {
            const slideRaw = await generateJSONResilient(
              `Create a 9-slide Instagram carousel for ${atHandle(brand)} about: "${topic}".
Return ONLY a JSON array of 9 objects: [{"slide":1,"headline":"...","body":"..."}, ...]
- Slide 1 = COVER: punchy title + a hook stat or question.
- Slides 2-8 = ONE focused point each (headline 3-6 words; body 1-2 sentences with a SPECIFIC number/detail/criterion).
- Slide 9 = "Save & Follow ${atHandle(brand)}" CTA slide.
- headline ≤ 6 words; body ≤ 220 chars; plain text, no markdown, no asterisks.`,
              "Return ONLY a valid JSON array of 9 slide objects. No other text.",
              2000, ctx.brandId);
            const cl  = slideRaw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
            const arr = JSON.parse(cl.match(/\[[\s\S]*\]/)?.[0] ?? cl);
            if (Array.isArray(arr)) {
              carouselSlides = arr
                .map((s: any, idx: number) => ({
                  slide:    Number(s.slide) || idx + 1,
                  headline: String(s.headline ?? "").trim(),
                  body:     String(s.body ?? "").trim(),
                }))
                .filter((s) => s.headline || s.body)
                .slice(0, 20);
            }
          } catch (e: any) {
            console.warn(`[AutoGen] Carousel slide generation failed for "${topic}": ${e?.message}`);
          }
          if (!carouselSlides || carouselSlides.length < 2) {
            console.warn(`[AutoGen] Carousel "${topic}" produced <2 slides — skipping this post`);
            continue;
          }
          console.log(`[AutoGen] Carousel "${topic}" — generated ${carouselSlides.length} slides`);
        }

        // Base hashtags from AI — normalise to #tag format
        const baseHashtags = ((parsed.hashtags ?? []) as string[])
          .map((h: string) => h.startsWith("#") ? h.toLowerCase() : `#${h.toLowerCase()}`);

        // Enrich with 2 viral hashtags sourced from THIS brand's own top posts
        const igTok = ctx.igToken, igAcc = ctx.igAcctId;
        // AI-generated posts: tight 5-tag pack (3 topic-specific + 2 live viral)
        const hashtags = igTok && igAcc
          ? await buildConciseHashtags(baseHashtags, topic, igTok, igAcc)
              .catch(() => baseHashtags.slice(0, 5))
          : baseHashtags.slice(0, 5);

        console.log(`[AutoGen] Hashtags for "${topic}" (${hashtags.length}): ${hashtags.join(" ")}`);

        // ── Save post to DB ─────────────────────────────────────────────────
        // content = bullet points for the image card (newline-separated)
        // caption (stored in reelScript temporarily) = prose Instagram caption
        // Both are used: content → image generator, caption → Instagram post text
        const post = await prisma.post.create({
          data: {
            userId,
            type:        type as any,
            title:       parsed.title   || `Auto: ${topic}`,
            content:     parsed.content || "",    // bullet points → image card
            hook:        parsed.hook    || "",
            cta:         parsed.cta     || "Save this post!",
            // Store the prose caption in reelScript with prefix so captionBuilder can use it
            reelScript:  parsed.caption ? `CAPTION:${parsed.caption}` : undefined,
            hashtags,
            imagePrompt: "",
            // For carousels, store the slides so the scheduler renders a real multi-slide carousel
            carouselSlides: (carouselSlides ?? undefined) as any,
            viralScore:  Math.round((0.75 + Math.random() * 0.15) * 100) / 100,
            status:      "DRAFT",
            platform:    igPlatform,
            brandId:     brandIdForWrite(ctx),
          } as any,
        });

        // ── Atomic claim (#9) + slot index ──────────────────────────────────
        // Count this brand's IG feed posts already scheduled today BEFORE assigning
        // this post's slot: it both caps double-generation (break when the target is
        // met) and yields the post's TRUE day-position, so an interrupted+resumed run
        // continues from the next free slot instead of restarting the in-run counter
        // `i` at 0 (which would reuse the first time slot). Excludes STORY/REEL.
        const liveCount = await prisma.scheduledPost.count({
          where: {
            platform: { in: ["instagram", "both"] },
            status: { in: ["PENDING", "PUBLISHED"] },
            scheduledFor: { gte: todayStart, lt: todayEnd },
            AND: [
              { OR: [{ postType: null }, { postType: { notIn: ["STORY", "REEL"] } }] },
              brandFilter(ctx),
            ],
          } as any,
        }).catch(() => existingCount + i);
        if (liveCount >= effectivePostsPerDay) {
          console.log(`[AutoGen] Daily cap reached mid-run (${liveCount}/${effectivePostsPerDay}) — another generator beat us; stopping`);
          break;
        }

        // ── Compute schedule slot ───────────────────────────────────────────
        // Source the time list from today's effective schedule (per-day override or
        // global fallback — see resolveDaySchedule above). Slot by ABSOLUTE day
        // position (liveCount), NOT the in-run loop counter `i`, so split/resumed
        // runs spread across the configured times instead of reusing slot 0.
        const slotIndex = effectiveTimes.length ? (liveCount % effectiveTimes.length) : 0;
        const timeStr   = effectiveTimes[slotIndex] ?? "09:00";
        const [hh, mm]  = timeStr.split(":").map(Number);

        let scheduledFor = wallTimeToUTC(istYear, istMonth, istDay, hh, mm, tz);

        // If the slot already passed today, publish promptly TODAY instead of pushing
        // to tomorrow. Pushing dated the post tomorrow, which let it escape today's
        // generation cap (which counts posts scheduledFor today) → repeated over-
        // generation across restarts, all colliding on the same pushed slot. Keeping
        // it on today means the cap counts it and no duplicates pile up.
        if (scheduledFor.getTime() <= Date.now()) {
          scheduledFor = new Date();
        }

        // Honour scheduleDays — advance until a permitted weekday.
        // Skipped when today has an explicit per-day entry: that entry already
        // authorised today (resolveDaySchedule), so the global scheduleDays gate
        // must not push the post onto a different weekday.
        if (!hasDayEntry && cfg.scheduleDays.length) {
          for (let attempt = 0; attempt < 7; attempt++) {
            const dow = tzWeekday(scheduledFor, tz);
            if (cfg.scheduleDays.includes(dow)) break;
            const base = new Date(scheduledFor);
            base.setUTCDate(base.getUTCDate() + 1);
            scheduledFor = wallTimeToUTC(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hh, mm, tz);
          }
        }

        // ── autoPublish: auto-publish at the SCHEDULED slot, NOT at generation time ──
        // Previously `if (cfg.autoPublish) scheduledFor = new Date()` forced every
        // generated post to publish on the generation cycle. The daily generator runs
        // right after IST-midnight, so this made the feed post go out at ~00:00 instead
        // of the configured time (e.g. 19:00 IST). We now KEEP the computed slot — the
        // catchup publisher auto-publishes the PENDING post at that slot. The earlier
        // passed-slot guard still publishes promptly when the slot has already passed,
        // so a genuinely-missed slot isn't skipped. (autoPublish no longer overrides
        // the slot; it never gated auto-publishing, which the catchup does regardless.)

        // ── Create scheduled post ───────────────────────────────────────────
        const sp = await prisma.scheduledPost.create({
          data: {
            userId,
            postId:      post.id,
            title:       post.title,
            content:     post.content,
            hashtags,
            scheduledFor,
            timezone:    tz,
            isRecurring: false,
            status:      "PENDING",
            postType:    type as any,   // stamp the type so the dedupe count sees it
            platform:    igPlatform,
            brandId:     brandIdForWrite(ctx),
          } as any,
        });

        await prisma.post.update({
          where: { id: post.id },
          data:  { status: "SCHEDULED", scheduledFor },
        });

        generated.push({ type, title: post.title, scheduledFor });
        console.log(`[AutoGen] Created: "${post.title}" (${type}) → ${scheduledFor.toISOString()}`);

      } catch (err: any) {
        console.error(`[AutoGen] Failed to generate ${type} post:`, err?.message);
      }
    }

    // Partial-failure (#6): only seal the in-memory "done today" marker when the
    // FULL target was generated. If some posts failed (per-post catch continues),
    // leave it unset so the next cycle retries the remainder — the DB existingCount
    // prevents over-generation. (The early-return branches above, where nothing
    // needed generating, still set the marker since there's nothing to retry.)
    if (generated.length >= toGenerate) {
      _lastAutoGenerateDateByBrand.set(ctx.brandId, todayIST);
    } else {
      console.log(`[AutoGen] Only ${generated.length}/${toGenerate} generated — NOT sealing today; next cycle will retry the remainder`);
    }
    console.log(`[AutoGen] Done — generated ${generated.length} post(s) today`);
  } catch (err: any) {
    console.warn("[AutoGen] Unexpected error:", String(err));
  } finally {
    _autoGenInFlightByBrand.set(ctx.brandId, false);
  }
  return generated;
}

// --- 4b. Independent YouTube auto-poster --------------------------------------
// Mirrors runAutoGeneratePosts() but driven entirely by prefs.youtube. Generates
// YouTube-platform Posts + ScheduledPosts (one per configured postTime) so the
// scheduler's youtube branch publishes them as Shorts. Runs once per IST day.
// ── YouTube title de-dup (#2) + hook-quality gate (#3) ───────────────────────
// Generic/structural words that don't define a video's THEME — ignored when
// comparing two titles for topic overlap (so two titles that merely share a
// niche-generic word don't falsely collide). Two titles "collide" when they
// still share a DISTINCTIVE keyword (the actual subject of the video).
const YT_THEME_STOP = new Set([
  "the","a","an","and","or","to","of","for","that","this","with","into","from","at","by","as",
  "it","its","on","in","your","you","my","our","is","are","was","be","being","how","why","what",
  "which","when","who","does","do","can","will","could","should","would","may","might","most",
  "people","ignore","really","actually","silently","quietly","secretly","hidden","reveal","reveals",
  "reverse","hiding","saves","saving","save","truth","real","reason","difference","matters","need",
  "know","about","more","every","everyday","daily","things","ways","stop","keep","make","makes",
  // generic ACTION verbs / adjectives — describe what happens, not the SUBJECT, so they
  // must not trigger a false collision.
  "hurt","harm","harmful","protect","raise","raising","spike","spiking","cause","causing","predict",
  "predicting","lower","lowering","boost","boosting","improve","improving","increase","reduce","reducing",
  "prevent","preventing","affect","affecting","trigger","triggering","damage","damaging","kill","killing",
  "harden","hardening","age","aging","ageing","worse","better","good","bad","best","worst","common","simple",
  "easy","quick","fast","slow","new","old","big","small","warning","warn","hour","year","help","helps",
]);
function ytThemeKeywords(title: string): Set<string> {
  return new Set(
    (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .map((w) => w.replace(/(es|s|ing|ed)$/, "")) // light stemming so plurals match
      .filter((w) => w.length >= 3 && !YT_THEME_STOP.has(w)),
  );
}
/** Reject malformed / too-thin / vague-abstract titles that flop. */
function ytIsWeakTitle(title: string): boolean {
  const t = (title || "").trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 3) return true;                    // e.g. "Eye Strain"
  if (/_/.test(t)) return true;                         // raw filename leaked as title
  if (/^\d{1,2}\s+\w+\s+\d{4}$/.test(t)) return true;   // "23 June 2026" date fallback
  if (/^(auto|untitled|test)\b/i.test(t)) return true;
  // Vague abstractions with no concrete picture (these flop):
  return [
    /^stop\s+\w+\s+from\s+/i,
    /\bsilent(ly)?\b[^.]*\bdamage\b/i,
  ].some((re) => re.test(t));
}

export async function runAutoGenerateYouTube(ctxArg?: BrandContext): Promise<GeneratedPostSummary[]> {
  const generated: GeneratedPostSummary[] = [];
  const ctx = ctxArg ?? await getPrimaryBrandContext();
  if (_ytAutoGenInFlightByBrand.get(ctx.brandId)) {
    console.log("[YT-AutoGen] Already running — skipping concurrent invocation");
    return [];
  }
  _ytAutoGenInFlightByBrand.set(ctx.brandId, true);
  try {
    const prefs = ctx.prefs;
    const yt    = prefs.youtube;

    // ── Gates ──────────────────────────────────────────────────────────────
    // The independent YouTube auto-poster ALWAYS runs per its own prefs.youtube
    // settings. It no longer conflicts with IG auto-posts because IG feed posts are
    // never cross-posted to YouTube (YouTube has no API for image/community posts).
    if (!yt?.enabled) {
      console.log("[YT-AutoGen] YouTube disabled in settings — skipping");
      return [];
    }
    if (!isYouTubeConfigured(ctx.ytCreds)) {
      console.log("[YT-AutoGen] YouTube not configured — skipping");
      return [];
    }
    if (!yt.topics?.length) {
      console.log("[YT-AutoGen] No YouTube topics configured — skipping");
      return [];
    }
    if (!yt.postTimes?.length) {
      console.log("[YT-AutoGen] No YouTube postTimes configured — skipping");
      return [];
    }

    // Only run once per calendar day (IST)
    const IST_TZ   = "Asia/Kolkata";
    const nowInIST = new Date().toLocaleString("en-US", { timeZone: IST_TZ });
    const todayIST = new Date(nowInIST).toDateString();
    if (_lastYouTubeGenerateDateByBrand.get(ctx.brandId) === todayIST) {
      console.log("[YT-AutoGen] Already ran today — skipping");
      return [];
    }

    // Check if today is a scheduled day (0=Sun..6=Sat, IST).
    // PER-DAY (Feature 1): a `dailySchedule` entry for today's weekday supersedes the
    // global postsPerDay/postTimes/scheduleDays (same semantics as the IG auto-poster).
    const todayDow = new Date(nowInIST).getDay();
    const hasDayEntry = Array.isArray(yt.dailySchedule)
      && yt.dailySchedule.some((e) => e && Number(e.day) === todayDow);
    const daySched = resolveDaySchedule(
      todayDow, yt.dailySchedule, Number(yt.postsPerDay) || 1, yt.postTimes ?? [],
      ctx.prefs.youtube?.customScheduleOnly ?? false,
    );
    if (daySched === null) {
      console.log(`[YT-AutoGen] Day ${todayDow} disabled in dailySchedule (or no custom entry under customScheduleOnly) — skipping`);
      _lastYouTubeGenerateDateByBrand.set(ctx.brandId, todayIST);
      return [];
    }
    if (!hasDayEntry && yt.scheduleDays?.length && !yt.scheduleDays.includes(todayDow)) {
      console.log(`[YT-AutoGen] Day ${todayDow} not in scheduleDays — skipping`);
      return [];
    }
    const effectiveTimes = daySched.times.length ? daySched.times : (yt.postTimes ?? []);

    // Parse today's IST calendar date for time calculations
    const nowUtc = new Date();
    const istParts = new Intl.DateTimeFormat("en-US", {
      timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(nowUtc);
    const pp: Record<string, number> = {};
    for (const p of istParts) if (p.type !== "literal") pp[p.type] = parseInt(p.value, 10);
    const istYear = pp["year"]!, istMonth = pp["month"]!, istDay = pp["day"]!;

    const todayStart = wallTimeToUTC(istYear, istMonth, istDay,  0,  0, IST_TZ);
    // Exclusive next-midnight boundary (matches tzDayInfo); lte:23:59 left a 60-second
    // hole (23:59:01–23:59:59) where posts weren't counted by the daily cap.
    const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // How many youtube-platform posts are already scheduled for today?
    const existingCount = await prisma.scheduledPost.count({
      where: {
        platform:     "youtube",
        status:       { in: ["PENDING", "PUBLISHED"] },
        scheduledFor: { gte: todayStart, lt: todayEnd },
        ...brandFilter(ctx),
      } as any,
    }).catch(() => 0);

    // Target number of YouTube posts per day comes from today's effective schedule —
    // the per-day override (daySched.postsPerDay) when present, else the global
    // yt.postsPerDay (1–5). Posts are distributed across effectiveTimes below.
    const targetPerDay = daySched.postsPerDay;

    const toGenerate = Math.max(0, targetPerDay - existingCount);
    if (toGenerate === 0) {
      console.log(`[YT-AutoGen] ${existingCount}/${targetPerDay} YouTube posts already scheduled today — skipping`);
      _lastYouTubeGenerateDateByBrand.set(ctx.brandId, todayIST);
      return [];
    }

    const userId = await getSystemUserId();
    if (!userId) {
      console.warn("[YT-AutoGen] No userId found in DB — cannot create auto posts");
      return [];
    }

    const brand = ctx.prefs.brand;
    console.log(`[YT-AutoGen] Generating ${toGenerate} YouTube Short post(s) for today (${todayIST})`);

    // ── AI preference defaults (#7) ─────────────────────────────────────────
    const aiPrefs        = (ctx.prefs.ai ?? {}) as any;
    const defaultTone    = (aiPrefs.defaultTone ?? "").trim();
    const aiLanguage     = (aiPrefs.language ?? "").trim();
    const toneDirective  = defaultTone
      ? `\n\nTONE: write in a ${defaultTone} tone.`
      : "";
    const languageDirective = (aiLanguage && !/^english$/i.test(aiLanguage))
      ? `\n\nWrite the content in ${aiLanguage}.`
      : "";

    // Anti-repetition: avoid recently used titles
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentPosts = await prisma.post.findMany({
      where:   { createdAt: { gte: since30d }, ...brandFilter(ctx) },
      orderBy: { createdAt: "desc" },
      take:    40,
      select:  { title: true },
    }).catch(() => [] as { title: string }[]);
    const recentAvoidList = recentPosts.map((p) => p.title).filter(Boolean).slice(0, 40);
    // #2: precompute the distinctive theme keywords of every recent title once.
    const recentThemeKw = recentAvoidList.map(ytThemeKeywords);

    const usedThisRun = new Set<string>();
    // #2: theme-keyword signatures generated THIS run, so two posts in one run can't
    // cover the same subject even before they hit the DB recent-list.
    const usedThemeKw: Set<string>[] = [];

    // Rotate among the configured YouTube post types (Settings → YouTube).
    // Falls back to the proven content-friendly default set when none configured.
    // When no YouTube post types are configured, fall back to the user's AI
    // defaultType (#7, normalised to enum form) seeded into the proven default set,
    // else the default set alone.
    const ytDefaultType = (((ctx.prefs.ai as any)?.defaultType ?? "").trim())
      ? ((ctx.prefs.ai as any).defaultType as string).toUpperCase().replace(/\s+/g, "_")
      : "";
    const YT_TYPES = (Array.isArray(yt.postTypes) && yt.postTypes.length)
      ? yt.postTypes
      : (ytDefaultType
          ? [ytDefaultType, "EDUCATIONAL", "CLINICAL_PEARL", "PREVENTIVE"]
          : ["EDUCATIONAL", "CLINICAL_PEARL", "PREVENTIVE"]);
    const dayNumber = Math.floor(Date.now() / 86_400_000);

    const customExtra = (yt.customPromptExtra ?? "").trim();

    for (let i = 0; i < toGenerate; i++) {
      const type  = YT_TYPES[(dayNumber + i) % YT_TYPES.length];
      const topic = (await pickNextTopic("post", yt.topics, usedThisRun, ctx.prefs.brand))
        ?? yt.topics[i % yt.topics.length];
      usedThisRun.add(topic);

      const avoidBlock = recentAvoidList.length
        ? `\n\nANTI-REPETITION (critical for reach — platforms suppress repetitive uploads): do NOT cover the same SUBJECT/THEME as any recent post below, not just the same wording. If a theme already appears here, pick a genuinely DIFFERENT ${brand.niche} subject — do not make another post on that same theme with fresh words. Use a fresh subject, fresh angle, and fresh facts:\n${recentAvoidList.map((t) => `- ${t}`).join("\n")}`
        : "";

      const ytExtra = customExtra
        ? `\n\nADDITIONAL CREATOR INSTRUCTIONS for this YouTube Short (follow these closely while keeping the JSON structure above):\n${customExtra}`
        : "";

      // ── Accessible-angle 80/20 content bias ────────────────────────────────
      // Channel insight: accessible, everyday-language content earns far more views
      // than dense, expert-level content. Most viewers are the general public, not
      // specialists. So bias ~80-90% of YouTube posts toward a plain-language,
      // accessible angle, leaving ~10-20% for in-depth expert credibility.
      // Deterministic split reuses the same per-post counter (dayNumber + i) that
      // drives type rotation: 1 in every 10 posts is in-depth, the rest accessible.
      const isExpertAngle = (dayNumber + i) % 10 === 0;
      const angleBlock = isExpertAngle
        ? `\n\nCONTENT ANGLE — IN-DEPTH (this is one of the ~10% expert-level posts): you MAY use precise terminology and educational depth here. Name specific facts/criteria/details and write at a level that respects experts while still being understandable. Do not dumb it down — this slot exists to showcase credibility. TITLE RULE: even here, the "title" must still be a plain-language CURIOSITY hook a layperson would click (you may add the technical term AFTER a plain hook).`
        : `\n\nCONTENT ANGLE — ACCESSIBLE (this is one of the ~90% accessible posts, framed for the general public, NOT specialists): frame the topic in plain, relatable, everyday language. Focus entirely on what it means for the VIEWER's daily life — practical, actionable advice they can use today. Lead with the personal "what does this mean for me" angle. AVOID heavy jargon and insider terminology; if a technical term is unavoidable, explain it in one plain phrase. Keep it warm, accessible, and motivating for an everyday viewer.\nTITLE RULE: the "title" MUST be a plain-language CURIOSITY hook the average person would click — NEVER jargon. Follow the WINNING PATTERN: a concrete everyday noun + a specific curiosity or benefit (a number ONLY if it is truthful — NEVER invent a statistic). GOOD: concrete, specific, names the actual thing. BANNED (these flop — abstract, vague, no concrete picture): generic "...your <thing>" patterns, "How X causes silent Y", "Why X is killing your <thing>", with no specific noun or number. Make the viewer NEED to know the answer.`;

      const cardSpec = cardSpecFor(brand)[type] ?? cardSpecFor(brand).EDUCATIONAL;

      try {
        const typeLabel = type.replace(/_/g, " ").toLowerCase();
        const basePrompt = `Generate a ${typeLabel} ${brand.niche} YouTube Short post about: "${topic}".

You are ${atHandle(brand)} — ${brand.persona.role}. This is for a YouTube channel. Create high-impact ${brand.niche} content that gets watched, saved, and shared.

AUDIENCE: ${brand.audience}.
- Be accurate, specific, and genuinely useful — back claims with real numbers, facts, or examples.
- Frame the topic around what your audience actually cares about and can act on.
- Stay credible and evidence-based at all times.

HOOK — the hook must stop the scroll in the first 1-2 seconds, speak to a real curiosity or concern your audience has, yet stay credible.

IMAGE-CARD REQUIREMENT for this ${typeLabel} (this is what goes in the "content" field — the text rendered ON the image):
${cardSpec}

Return ONLY a valid JSON object with EXACTLY these fields:
{
  "title": "SEO title under 60 chars, searchable YouTube phrasing. Obey the TITLE RULE: concrete everyday noun + specific curiosity/benefit (a number only if truthful); NEVER abstract/jargon or the banned vague patterns.",
  "hook": "Card headline — bold 6-9 words, no asterisks, no punctuation at end.",
  "content": "The IMAGE-CARD text. Follow the IMAGE-CARD REQUIREMENT above EXACTLY. Each item on its OWN LINE separated by \\n. Plain lines only — NO prose paragraphs, NO markdown, NO asterisks.",
  "caption": "Caption (prose, DIFFERENT from and RICHER than the card). Make it detailed and substantial: a strong scroll-stopping hook, then 2-4 sentences of context with specifics, then 5 key points each starting with ① ② ③ ④ ⑤ and each EXPANDED to a full, complete sentence with a real number/stat/detail AND its significance (NOT a fragment), then a 'Why it matters:' line (one full sentence), then a short QUESTION that invites the viewer to comment their experience/opinion, then a SUBSCRIBE call-to-action (this is a YouTube Short — drive subscribes): 'Subscribe to ${atHandle(brand)} for a fresh tip every day.'",
  "cta": "Short call to action fitting the post type",
  "hashtags": ["exactly 3 topic-specific hashtags, lowercase, no # prefix"]
}

RULES:
- "content" = ONLY the image-card text, following the IMAGE-CARD REQUIREMENT above. Plain lines, no prose.
- "caption" = ONLY prose with emojis. Must be DIFFERENT from the card content.
- hashtags: EXACTLY 3. Mix 1 high-volume (>500k) + 1 medium (50k-500k) + 1 niche (<50k).${toneDirective}${angleBlock}${ytExtra}${avoidBlock}${languageDirective}`;

        const ytSystem =
          buildBrandSystemPrompt(brand) + " This is for a YouTube channel — optimize hooks to grab a broad audience. Return ONLY valid JSON — no markdown, no preamble. Every post you write must be distinct from previous ones — never repeat the same facts, angle, or wording." + languageDirective;

        // ── #2 de-dup + #3 hook-quality gate ──────────────────────────────────
        // Generate, then HARD-validate the title: reject if it's weak/malformed (#3)
        // or repeats the SUBJECT of a recent / same-run post (#2), and regenerate
        // with targeted feedback (up to 3 tries). The recentAvoidList prompt hint is
        // soft (models ignore it) — this is the enforcement.
        const collidesAny = (ttl: string): boolean => {
          const k = ytThemeKeywords(ttl);
          for (const rk of recentThemeKw) for (const w of k) if (rk.has(w)) return true;
          for (const rk of usedThemeKw)   for (const w of k) if (rk.has(w)) return true;
          return false;
        };
        let parsed: any = null;
        let banFeedback = "";
        for (let attempt = 1; attempt <= 3; attempt++) {
          const raw = await generateJSONResilient(basePrompt + banFeedback, ytSystem, 2500, ctx.brandId);
          let p: any;
          try {
            const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
            p = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);
          } catch {
            console.warn(`[YT-AutoGen] attempt ${attempt}: JSON parse failed for ${type}`);
            continue;
          }
          parsed = p; // keep the latest parse as a best-effort fallback
          const ttl  = String(p.title || "").trim();
          const weak = ytIsWeakTitle(ttl);
          const dup  = collidesAny(ttl);
          if (!weak && !dup) break; // accepted
          console.warn(`[YT-AutoGen] attempt ${attempt} rejected (weak=${weak} dup=${dup}): "${ttl}"`);
          const reasons: string[] = [];
          if (weak) reasons.push(`the title "${ttl}" is malformed, too short, or a vague/abstract pattern that flops — write a CONCRETE curiosity hook built on a specific everyday noun (use a number only if it is truthful)`);
          if (dup)  reasons.push(`the SUBJECT of "${ttl}" repeats a recent video — choose a COMPLETELY different ${brand.niche} subject that shares NO keywords with the recent list above`);
          banFeedback = `\n\nREGENERATE — the previous attempt was rejected because ${reasons.join("; and ")}. Return fresh JSON (all fields) with a distinct, strong, concrete title and matching content.`;
        }
        if (!parsed) {
          console.warn(`[YT-AutoGen] No parseable AI output for ${type} after retries — skipping this post`);
          continue;
        }
        // Record this post's theme so later posts in the same run avoid it (#2).
        usedThemeKw.push(ytThemeKeywords(String(parsed.title || "")));

        if (!parsed.caption && parsed.content) parsed.caption = parsed.content;
        parsed.content = deriveCardContent(type, parsed.content || "", parsed.caption || "");

        // Simple AI hashtags — no IG-live enrichment needed for YouTube.
        const hashtags = ((parsed.hashtags ?? []) as string[])
          .map((h: string) => h.startsWith("#") ? h.toLowerCase() : `#${h.toLowerCase()}`)
          .slice(0, 5);

        const post = await prisma.post.create({
          data: {
            userId,
            type:        type as any,
            title:       parsed.title   || `Auto: ${topic}`,
            content:     parsed.content || "",
            hook:        parsed.hook    || "",
            cta:         parsed.cta     || "Save this post!",
            reelScript:  parsed.caption ? `CAPTION:${parsed.caption}` : undefined,
            hashtags,
            imagePrompt: "",
            viralScore:  Math.round((0.75 + Math.random() * 0.15) * 100) / 100,
            status:      "DRAFT",
            platform:    "youtube",
            brandId:     brandIdForWrite(ctx),
          } as any,
        });

        // ── Atomic claim (#9) + slot index: count posts already scheduled today
        // (PENDING/PUBLISHED) BEFORE assigning this post's slot. This both stops
        // double-generation (break when the cap is met) AND yields the post's TRUE
        // day-position, so an interrupted+resumed run (e.g. a deploy split one
        // generation into two) continues from the next free slot instead of
        // restarting the in-run counter `i` at 0 — which previously made both
        // Shorts of a split run reuse slot 0 (the same time).
        const liveCount = await prisma.scheduledPost.count({
          where: {
            platform:     "youtube",
            status:       { in: ["PENDING", "PUBLISHED"] },
            scheduledFor: { gte: todayStart, lt: todayEnd },
            ...brandFilter(ctx),
          } as any,
        }).catch(() => existingCount + i);
        if (liveCount >= targetPerDay) {
          console.log(`[YT-AutoGen] Daily cap reached mid-run (${liveCount}/${targetPerDay}) — another generator beat us; stopping`);
          break;
        }

        // Distribute the N posts across the configured postTimes by ABSOLUTE day
        // position (liveCount), NOT the in-run loop counter `i`:
        //   • fewer times than posts → cycle through them (reuse), staggering
        //     each reuse by +N hours so duplicates don't collide on one minute;
        //   • more times than posts → the first N times are used naturally.
        const slotIdx   = liveCount; // 0-based position among today's already-scheduled posts
        const slotTimes = effectiveTimes.length ? effectiveTimes : (yt.postTimes ?? ["19:00"]);
        const timeStr  = slotTimes[slotIdx % slotTimes.length] ?? "19:00";
        const [hh, mm] = timeStr.split(":").map(Number);
        // How many full cycles past the first pass this slot is on → hour offset.
        const reuseCycle = Math.floor(slotIdx / slotTimes.length);
        const hhStaggered = ((hh || 0) + reuseCycle) % 24;

        let scheduledFor = wallTimeToUTC(istYear, istMonth, istDay, hhStaggered, mm, IST_TZ);
        // If the slot already passed today, publish promptly TODAY instead of pushing
        // to tomorrow — pushing dated the Short tomorrow, escaping today's generation
        // cap (counted by scheduledFor-today) → over-generation + multiple Shorts all
        // landing on the same pushed slot (the "4 at 9:30 PM" pile-up). Keeping it on
        // today makes the cap count it and prevents the collision.
        if (scheduledFor.getTime() <= Date.now()) {
          scheduledFor = new Date();
        }

        await prisma.scheduledPost.create({
          data: {
            userId,
            postId:      post.id,
            title:       post.title,
            content:     post.content,
            hashtags,
            scheduledFor,
            timezone:    IST_TZ,
            isRecurring: false,
            status:      "PENDING",
            platform:    "youtube",
            brandId:     brandIdForWrite(ctx),
          } as any,
        });

        await prisma.post.update({
          where: { id: post.id },
          data:  { status: "SCHEDULED", scheduledFor },
        });

        generated.push({ type, title: post.title, scheduledFor });
        console.log(`[YT-AutoGen] Created: "${post.title}" (${type}) → ${scheduledFor.toISOString()}`);
      } catch (err: any) {
        console.error(`[YT-AutoGen] Failed to generate ${type} post:`, err?.message);
      }
    }

    // Partial-failure (#6): only seal the in-memory "done today" marker when the
    // FULL target was generated; otherwise leave it so the next cycle retries the
    // remainder (the DB existingCount prevents over-generation).
    if (generated.length >= toGenerate) {
      _lastYouTubeGenerateDateByBrand.set(ctx.brandId, todayIST);
    } else {
      console.log(`[YT-AutoGen] Only ${generated.length}/${toGenerate} generated — NOT sealing today; next cycle will retry the remainder`);
    }
    await safeLog({
      action:   "YOUTUBE_AUTOGEN",
      entity:   "YouTube",
      entityId: todayIST,
      metadata: { generated: generated.length },
    }).catch(() => {});
    console.log(`[YT-AutoGen] Done — generated ${generated.length} YouTube post(s) today`);
  } catch (err: any) {
    console.warn("[YT-AutoGen] Unexpected error:", String(err));
  } finally {
    _ytAutoGenInFlightByBrand.set(ctx.brandId, false);
  }
  return generated;
}

// --- 5b. Background Instagram insights sync (populates Analytics table) --------
// Runs silently in catchup — fetches real Instagram metrics for all published posts
// and upserts them into the Analytics table so the overview page shows real numbers.

// Per-brand throttle so each brand syncs on its own 6-hour cadence. The primary
// brand uses the same key as before (its real brand id), so its throttle is
// unchanged. Legacy callers that pass no ctx resolve to the primary brand.
const _lastInsightSyncAtByBrand = new Map<string, number>();
const INSIGHT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export async function syncInstagramInsights(ctxArg?: BrandContext): Promise<void> {
  // Resolve the brand context. No ctx ⇒ primary brand (env creds + null brandId),
  // preserving the exact single-account behaviour.
  const ctx = ctxArg ?? await getPrimaryBrandContext();

  const lastAt = _lastInsightSyncAtByBrand.get(ctx.brandId) ?? 0;
  if (Date.now() - lastAt < INSIGHT_SYNC_INTERVAL_MS) return;
  _lastInsightSyncAtByBrand.set(ctx.brandId, Date.now());

  // Primary brand → env creds (identical to getCredentials), null brandId on writes.
  const igToken  = ctx.igToken;
  const igAcctId = ctx.igAcctId;
  if (!igToken || !igAcctId) return;

  try {
    // Fetch last 20 published media IDs from Instagram (ground truth)
    let igMediaIds: Set<string> = new Set();
    try {
      const igMediaRes = await fetch(
        `${GRAPH_BASE}/${igAcctId}/media?fields=id&limit=50&access_token=${igToken}`,
        { signal: AbortSignal.timeout(8000) },
      );
      const igMediaData = await igMediaRes.json();
      if (!igMediaData.error && Array.isArray(igMediaData.data)) {
        for (const m of igMediaData.data) {
          if (m.id) igMediaIds.add(m.id as string);
        }
        console.log(`[InsightSync] Instagram has ${igMediaIds.size} live media items`);
      } else if (igMediaData.error) {
        console.warn(`[InsightSync] Could not fetch IG media list: ${igMediaData.error.message}`);
      }
    } catch (e: any) {
      console.warn("[InsightSync] Failed to fetch IG media list:", e?.message);
    }

    // Fetch last 20 published posts from DB — scoped to THIS brand. For the primary
    // brand brandFilter matches brandId NULL OR primaryId, i.e. the same rows as
    // the legacy unfiltered query in a single-account deployment.
    const dbPosts = await prisma.post.findMany({
      where:   { status: "PUBLISHED", instagramPostId: { not: null }, ...brandFilter(ctx) },
      select:  { id: true, instagramPostId: true, brandId: true },
      orderBy: { publishedAt: "desc" },
      take:    20,
    });
    if (dbPosts.length === 0) return;

    // Detect DB posts whose Instagram post was deleted
    // Only mark as deleted if we successfully fetched the IG media list (igMediaIds.size > 0)
    if (igMediaIds.size > 0) {
      const deletedPosts = dbPosts.filter(
        (p) => p.instagramPostId && !igMediaIds.has(p.instagramPostId!)
      );

      for (const deleted of deletedPosts) {
        console.log(`[InsightSync] Post ${deleted.id} (IG: ${deleted.instagramPostId}) no longer exists on Instagram — marking deleted`);
        // Delete the Analytics row so it doesn't skew totals
        await prisma.analytics.deleteMany({ where: { postId: deleted.id } }).catch(() => {});
        // Mark the post as FAILED with a clear deleted marker in metrics JSON
        await prisma.post.update({
          where: { id: deleted.id },
          data:  {
            status:         "FAILED",
            instagramPostId: null,
            metrics:         { deleted: true, deletedAt: new Date().toISOString() },
          },
        }).catch(() => {});
      }

      if (deletedPosts.length > 0) {
        console.log(`[InsightSync] Cleaned up ${deletedPosts.length} deleted Instagram post(s) from DB`);
      }
    }

    // Only sync insights for posts that actually exist on Instagram
    const livePosts = igMediaIds.size > 0
      ? dbPosts.filter((p) => p.instagramPostId && igMediaIds.has(p.instagramPostId!))
      : dbPosts; // if we couldn't fetch IG list, attempt all (degraded mode)

    let synced = 0;
    for (const post of livePosts) {
      try {
        const igId = post.instagramPostId!;

        // Basic media stats
        const mediaRes  = await fetch(
          `${GRAPH_BASE}/${igId}?fields=like_count,comments_count,media_type&access_token=${igToken}`,
          { signal: AbortSignal.timeout(8000) },
        );
        const media = await mediaRes.json();
        if (media.error) continue;

        const likes    = media.like_count     ?? 0;
        const comments = media.comments_count ?? 0;

        // Per-post insights
        let reach = 0, impressions = 0, saves = 0;
        const isReel = media.media_type === "REELS" || media.media_type === "VIDEO";
        const metrics = isReel ? "reach,saved,plays" : "impressions,reach,saved";
        const insRes  = await fetch(
          `${GRAPH_BASE}/${igId}/insights?metric=${metrics}&period=lifetime&access_token=${igToken}`,
          { signal: AbortSignal.timeout(8000) },
        );
        const insData = await insRes.json();
        if (!insData.error && insData.data) {
          for (const m of insData.data) {
            const val = typeof m.value === "number" ? m.value : (m.values?.[0]?.value ?? 0);
            if (m.name === "reach")       reach       = val;
            if (m.name === "impressions") impressions = val;
            if (m.name === "plays")       impressions = val;
            if (m.name === "saved")       saves       = val;
          }
        }

        const engagementRate = reach > 0 ? Math.round(((likes + comments + saves) / reach) * 10000) / 100 : 0;

        // Stamp brandId from the linked post (NULL for primary — unchanged).
        await prisma.analytics.upsert({
          where:  { postId: post.id },
          create: { postId: post.id, likes, comments, saves, reach, impressions, engagementRate, brandId: post.brandId } as any,
          update: { likes, comments, saves, reach, impressions, engagementRate, brandId: post.brandId } as any,
        });
        synced++;
      } catch {
        // Skip individual failures — don't break the loop
      }
    }
    if (synced > 0) console.log(`[InsightSync] Synced ${synced}/${livePosts.length} posts to Analytics table`);
  } catch (err: any) {
    console.warn("[InsightSync] Failed:", err?.message);
  }
}

/**
 * Sync insights for ONE specific Instagram post immediately — no throttle.
 * Called by the webhook feed handler for real-time analytics updates.
 */
export async function syncSinglePostInsights(igPostId: string): Promise<void> {
  const { igToken } = await getCredentials().catch(() => ({ igToken: "", igAcctId: "" }));
  if (!igToken || !igPostId) return;

  try {
    const mediaRes = await fetch(
      `${GRAPH_BASE}/${igPostId}?fields=like_count,comments_count,media_type&access_token=${igToken}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const media = await mediaRes.json();
    if (media.error) { console.warn(`[InsightSync] Single sync error for ${igPostId}: ${media.error.message}`); return; }

    const likes    = media.like_count     ?? 0;
    const comments = media.comments_count ?? 0;

    let reach = 0, impressions = 0, saves = 0;
    const isReel  = media.media_type === "REELS" || media.media_type === "VIDEO";
    const metrics = isReel ? "reach,saved,plays" : "impressions,reach,saved";
    const insRes  = await fetch(
      `${GRAPH_BASE}/${igPostId}/insights?metric=${metrics}&period=lifetime&access_token=${igToken}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const insData = await insRes.json();
    if (!insData.error && insData.data) {
      for (const m of insData.data) {
        const val = typeof m.value === "number" ? m.value : (m.values?.[0]?.value ?? 0);
        if (m.name === "reach")       reach       = val;
        if (m.name === "impressions") impressions = val;
        if (m.name === "plays")       impressions = val;
        if (m.name === "saved")       saves       = val;
      }
    }

    const engagementRate = reach > 0 ? Math.round(((likes + comments + saves) / reach) * 10000) / 100 : 0;

    // Find DB post by IG ID and upsert analytics
    const dbPost = await prisma.post.findFirst({
      where:  { instagramPostId: igPostId },
      select: { id: true, brandId: true },
    });
    if (dbPost) {
      // Stamp brandId from the linked post (NULL for primary — unchanged).
      await prisma.analytics.upsert({
        where:  { postId: dbPost.id },
        create: { postId: dbPost.id, likes, comments, saves, reach, impressions, engagementRate, brandId: (dbPost as any).brandId } as any,
        update: { likes, comments, saves, reach, impressions, engagementRate, brandId: (dbPost as any).brandId } as any,
      });
      console.log(`[InsightSync] ✅ Real-time sync for ${igPostId}: ${likes} likes, ${reach} reach, ${saves} saves`);
    }
  } catch (err: any) {
    console.warn(`[InsightSync] Single post sync failed for ${igPostId}:`, err?.message);
  }
}

// --- 6. Daily health report + auto-generate (fires once at ~9 AM IST) ---------
// Returns true if the daily report was sent (so caller can avoid duplicate sends).

let _lastHealthReportDate: string | null = null;

export async function runDailyHealthCheck(): Promise<boolean> {
  // Sync Instagram insights in the background so Analytics table stays current
  syncInstagramInsights().catch(() => {});

  const IST_TZ   = "Asia/Kolkata";
  const nowInIST = new Date().toLocaleString("en-US", { timeZone: IST_TZ });
  const todayIST = new Date(nowInIST).toDateString();

  // Only send once per calendar day
  if (_lastHealthReportDate === todayIST) return false;

  // Check current IST hour: send between 09:00 and 09:59 IST
  const istHour = new Date(nowInIST).getHours();
  if (istHour < 9 || istHour >= 10) return false;

  _lastHealthReportDate = todayIST;
  console.log("[DailyHealth] Sending 9 AM health report…");

  try {
    // ── 1. Auto-generate posts for today ──────────────────────────────────
    const generatedPosts = await runAutoGeneratePosts();

    // ── 1b. Independent YouTube auto-poster (best-effort, never blocks IG) ──
    runAutoGenerateYouTube().catch((e: any) =>
      console.warn("[YT-AutoGen] runAutoGenerateYouTube failed:", e?.message ?? String(e)));

    // ── 2. Collect health status ──────────────────────────────────────────
    const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

    const prefs      = await readPreferences().catch(() => null);
    const aiProvider = (prefs?.ai as any)?.aiProvider ?? "grok";
    let aiOk = false;
    let aiError = "";
    try {
      if (aiProvider === "gemini") {
        const key = process.env.GEMINI_API_KEY?.trim() || ((prefs?.ai as any)?.geminiApiKey?.trim() ?? "");
        if (key) {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: AbortSignal.timeout(8000) });
          aiOk = r.ok;
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            aiError = body?.error?.message ?? `HTTP ${r.status}`;
          }
        } else {
          aiError = "GEMINI_API_KEY not configured";
        }
      } else {
        const key = process.env.GROK_API_KEY;
        if (key) {
          const baseUrl = process.env.GROK_API_URL || "https://api.groq.com/openai/v1";
          const r = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
          aiOk = r.ok;
          if (!r.ok) aiError = `HTTP ${r.status}`;
        } else {
          aiError = "GROK_API_KEY not configured";
        }
      }
    } catch (e: any) {
      aiOk = false;
      aiError = e?.message ?? "Unknown error";
    }

    const igOk = !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID);

    // Grok health — always used for DM replies, independent of content provider
    const grokHealth = await checkGrokHealth();

    // ── 3. Real-time health alerts if something is down ───────────────────
    if (!dbOk) {
      notifyApiHealthDegraded({ service: "PostgreSQL Database", detail: "Cannot reach database — DB queries are failing" }).catch(() => {});
    }
    if (!aiOk) {
      notifyApiHealthDegraded({ service: `${aiProvider === "gemini" ? "Gemini" : "Grok"} AI API`, detail: aiError || "AI API not responding", action: "Check API key and quota in Railway environment variables." }).catch(() => {});
    }
    if (!grokHealth.ok) {
      notifyApiHealthDegraded({ service: "Grok AI API (DM replies)", detail: grokHealth.detail || "Grok API not responding", action: "Check GROK_API_KEY and quota in Railway environment variables." }).catch(() => {});
    }
    if (!igOk) {
      notifyApiHealthDegraded({ service: "Instagram API", detail: "INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_BUSINESS_ACCOUNT_ID not set", action: "Add the environment variables in Railway settings." }).catch(() => {});
    }

    // ── 4. Collect 24-hour activity stats from DB ─────────────────────────
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const publishedCount24h = await prisma.scheduledPost.count({
      where: { status: "PUBLISHED", publishedAt: { gte: since24h } },
    }).catch(() => 0);

    const failedRaw24h = await prisma.scheduledPost.findMany({
      where: {
        status: "FAILED",
        createdAt: { gte: since24h },
        error: { not: null },
      },
      select: { title: true, error: true, createdAt: true, postType: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }).catch(() => []);

    const failedPosts24h = failedRaw24h
      .filter((p) => p.error && !p.error.startsWith("__CLAIMING__"))
      .map((p) => ({
        title:    p.title,
        error:    p.error!,
        failedAt: p.createdAt,
        postType: p.postType ?? undefined,
      }));

    // 24h comment + DM stats from ActivityLog
    const commentsReplied24h = await prisma.activityLog.count({
      where: { action: "COMMENT_REPLIED", createdAt: { gte: since24h } },
    }).catch(() => 0);

    const dmsReplied24h = await prisma.activityLog.count({
      where: { action: "DM_AUTO_REPLIED", createdAt: { gte: since24h } },
    }).catch(() => 0);

    // ── 5. Collect upcoming scheduled posts ───────────────────────────────
    const upcomingPosts = await prisma.scheduledPost.findMany({
      where:   { status: "PENDING", scheduledFor: { gte: new Date() } },
      orderBy: { scheduledFor: "asc" },
      take:    8,
      select:  { title: true, scheduledFor: true, status: true, postType: true },
    }).catch(() => []);

    // ── 6. Pull in-memory event logs accumulated since last restart ───────
    const rateLimitEvents = getRecentRateLimitEvents();
    const systemErrors    = getRecentSystemErrors();
    const healthChanges   = getRecentHealthChanges();

    // ── 6b. Today's auto-story status (for the email) ─────────────────────
    let storyStatus: { title: string; status: string; scheduledFor: Date | null; publishedAt: Date | null } | null = null;
    try {
      const since = new Date(Date.now() - 26 * 60 * 60 * 1000); // last ~26h covers today's story
      const todayStory = await prisma.scheduledPost.findFirst({
        where:   { postType: "STORY", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select:  { title: true, status: true, scheduledFor: true, publishedAt: true },
      });
      if (todayStory) {
        storyStatus = {
          title:        todayStory.title,
          status:       todayStory.status,
          scheduledFor: todayStory.scheduledFor ?? null,
          publishedAt:  todayStory.publishedAt ?? null,
        };
      }
    } catch { /* best-effort */ }

    // ── 6c. Instagram webhook status (Feature 3) ──────────────────────────
    // READ-ONLY use of webhookCounter signals (we don't touch webhook files):
    //   • subscription "configured" ⇒ WEBHOOK_VERIFY_TOKEN is set
    //   • active ⇒ a webhook comment event arrived within the last 10 min
    //   • lastEventSecondsAgo ⇒ seconds since the last webhook comment (or null)
    const webhookStatus = {
      configured:          !!process.env.WEBHOOK_VERIFY_TOKEN,
      active:              isWebhookActive(),
      lastEventSecondsAgo: secondsSinceLastWebhookComment(),
    };

    // ── 6d. Today's YouTube posts (Feature 3) ─────────────────────────────
    // Shorts published today (IST) — query published ScheduledPosts that carry a
    // youtubeVideoId, mirroring the story/auto-generated sections.
    const ytTodayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const youtubePostsRaw = await prisma.scheduledPost.findMany({
      where:   { youtubeVideoId: { not: null }, status: "PUBLISHED", publishedAt: { gte: ytTodayStart } },
      orderBy: { publishedAt: "desc" },
      take:    15,
      select:  { title: true, youtubeVideoId: true, publishedAt: true },
    }).catch(() => [] as { title: string; youtubeVideoId: string | null; publishedAt: Date | null }[]);
    const youtubePosts24h = youtubePostsRaw
      .filter((p) => p.youtubeVideoId)
      .map((p) => ({
        title:       p.title,
        videoId:     p.youtubeVideoId!,
        url:         `https://youtube.com/shorts/${p.youtubeVideoId}`,
        publishedAt: p.publishedAt ?? null,
      }));

    // ── 7. (Daily health-report email removed — a651ff9) ──────────────────
    // The Morning Digest is now the single once-a-day summary email. The health
    // checks above still run so a real-time "service down" alert fires if something
    // actually breaks; we just no longer send a second, duplicate summary email.
    void publishedCount24h; void failedPosts24h; void commentsReplied24h; void dmsReplied24h;
    void upcomingPosts; void rateLimitEvents; void systemErrors; void healthChanges;
    void storyStatus; void webhookStatus; void youtubePosts24h; void generatedPosts;
    console.log(`[DailyJob] Done — db:${dbOk ? "ok" : "DOWN"} ai:${aiOk ? "ok" : "DOWN"} grok:${grokHealth.ok ? "ok" : "DOWN"}. Morning summary delivered by the Morning Digest.`);
    return true;
  } catch (err: any) {
    console.error("[DailyHealth] Failed:", err?.message);
    return false;
  }
}

// --- Main export --------------------------------------------------------------
let lastRanAt: Date | null = null;
// Full loop (publishing + DMs) always runs every 5 min so DMs are never delayed.
// Comments have their own gate — see COMMENT_POLL_*_MS below.
// Exported so instrumentation.ts can drive its catch-up setInterval at the SAME
// cadence — otherwise the timer fires far more often than this debounce allows and
// most ticks are wasted no-ops.
export const MIN_INTERVAL_MS = 300_000; // always 5 min — keeps DM polling responsive

// Comment-specific rate gate for runCatchup. We throttle the API poll to hourly ONLY
// when the webhook is GENUINELY delivering (a real comment event arrived in the last
// 10 min, per isWebhookActive()); otherwise we poll every 5 min so comments are never
// missed. Gating on real events — NOT merely "is WEBHOOK_VERIFY_TOKEN set" — means a
// configured-but-silent webhook can no longer mask an outage by suppressing the poll.
// Per-brand so one brand's comment poll can't suppress another's.
const _lastCatchupCommentAtByBrand = new Map<string, number>();
const COMMENT_POLL_WEBHOOK_MS  = 60 * 60 * 1000; // webhook live  → hourly fallback poll
const COMMENT_POLL_FALLBACK_MS = 300_000;        // webhook silent → poll every 5 min

export async function runCatchup(): Promise<CatchupResult> {
  const now = new Date();

  // If Meta rate-limited us, skip entirely until the backoff expires
  if (isRateLimited()) {
    const remaining = Math.ceil((rateLimitedUntil!.getTime() - Date.now()) / 60_000);
    console.log(`[Catchup] Skipped -- Meta rate limit active, ${remaining} min remaining`);
    return {
      scheduledPublished: 0,
      scheduledFailed:    0,
      newComments:        0,
      commentsReplied:    0,
      dmsReplied:         0,
      errors:             [`Meta API rate limited -- resuming in ~${remaining} min`],
      ranAt:              now.toISOString(),
    };
  }

  // Debounce -- avoid running too frequently
  if (lastRanAt && now.getTime() - lastRanAt.getTime() < MIN_INTERVAL_MS) {
    const waited = Math.round((now.getTime() - lastRanAt.getTime()) / 1000);
    console.log(`[Catchup] Skipped -- ran ${waited}s ago (min interval: ${MIN_INTERVAL_MS / 1000}s)`);
    return {
      scheduledPublished: 0,
      scheduledFailed:    0,
      newComments:        0,
      commentsReplied:    0,
      dmsReplied:         0,
      errors:             [],
      ranAt:              lastRanAt.toISOString(),
    };
  }
  lastRanAt = now;

  // Fetch fresh PRIMARY credentials -- env var always wins (see getCredentials).
  // Preserve the legacy gate: if the PRIMARY brand has no IG credentials, skip the
  // whole run exactly as before. (Non-primary brands are only reached once the
  // primary is configured, which matches the single-account deployment baseline.)
  const { igToken, igAcctId } = await getCredentials();

  if (!igToken || !igAcctId) {
    console.warn("[Catchup] No Instagram credentials found -- skipping");
    return {
      scheduledPublished: 0,
      scheduledFailed:    0,
      newComments:        0,
      commentsReplied:    0,
      dmsReplied:         0,
      errors:             ["No Instagram credentials configured"],
      ranAt:              now.toISOString(),
    };
  }

  const errors: string[] = [];

  // ── Resolve all active brands and run the pipeline INDEPENDENTLY for each ──────
  // listBrands() returns primary first; with only the primary brand present this is a
  // single iteration whose creds resolve from ENV → behaviour identical to today.
  let brands: BrandRecord[] = [];
  let primaryId = "";
  try {
    [brands, primaryId] = await Promise.all([listBrands(), getPrimaryBrandId()]);
  } catch (e: any) {
    console.warn("[Catchup] Could not list brands — falling back to primary only:", e?.message ?? String(e));
    primaryId = await getPrimaryBrandId().catch(() => "");
    brands = [];
  }
  // Safety net: never run zero brands when the primary is configured.
  if (brands.length === 0 && primaryId) {
    brands = [{ id: primaryId, label: "Primary", isPrimary: true, active: true,
                igUsername: "", ytChannelTitle: "", hasInstagram: true, hasYouTube: isYouTubeConfigured() }];
  }

  // Aggregate counters across all brands.
  let published = 0, failed = 0, newComments = 0, repliedCount = 0, dms = 0, youtubeCommentsReplied = 0;

  for (const brand of brands) {
    if (!brand.active) continue;
    let ctx: BrandContext;
    try {
      ctx = await buildBrandContext(brand, primaryId);
    } catch (e: any) {
      console.warn(`[Catchup] Could not build context for brand ${brand.id} (${brand.label}):`, e?.message ?? String(e));
      errors.push(`Brand ${brand.label}: context build failed`);
      continue;
    }

    console.log(`[Catchup] Brand "${brand.label}" (${ctx.isPrimary ? "primary" : ctx.brandId})` +
      ` -- ig:${ctx.hasInstagram ? `…${(ctx.igToken || "").slice(-8)}` : "—"} yt:${ctx.hasYouTube ? "on" : "—"}`);

    // 1. Auto-schedule today's story (no-op if already scheduled today for this brand).
    //    Skips IG work for brands with no IG creds (scheduleAutoStory only creates a
    //    DB row; the publish step below gates on creds).
    void scheduleAutoStory(false, ctx).catch((e: any) =>
      console.warn("[Catchup] scheduleAutoStory failed:", e?.message ?? String(e)));

    // 1b. Auto-generate today's IG posts + (independent) YouTube Shorts for this brand.
    // Each self-gates per brand (date guard + DB de-dupe + in-flight guard), so calling
    // every cycle never double-generates. Fire-and-forget.
    // When Auto-Post → "Auto-Publish" is ON, generated IG posts are dated NOW; chain
    // a publish right after generation FINISHES so they go out in this same logical
    // cycle instead of waiting for the next tick. This runs inside the background
    // (fire-and-forget) task, so it never blocks the awaited comment/DM handling
    // below. publishOverdueScheduled is atomically-claimed, so it can safely overlap
    // the awaited publish at step 2 without double-posting.
    void runAutoGeneratePosts(ctx)
      .then(async () => {
        if (ctx.prefs.autoPost?.autoPublish) {
          try { await publishOverdueScheduled(ctx, errors); }
          catch (e: any) { console.warn("[AutoGen] post-generate publish failed:", e?.message ?? String(e)); }
        }
      })
      .catch((e: any) => console.warn("[AutoGen] background run failed:", e?.message ?? String(e)));
    void runAutoGenerateYouTube(ctx).catch((e: any) =>
      console.warn("[YT-AutoGen] background run failed:", e?.message ?? String(e)));

    // 2. Publish overdue scheduled posts (includes stories). Internally skips IG
    //    branches without IG creds and the YouTube branch without YT creds.
    try {
      const pr = await publishOverdueScheduled(ctx, errors);
      published += pr.published;
      failed    += pr.failed;
    } catch (e: any) {
      console.warn(`[Catchup] publishOverdueScheduled failed for ${brand.label}:`, e?.message ?? String(e));
      errors.push(`Brand ${brand.label}: publish failed`);
    }

    // 3. Fetch missed comments + auto-reply (per-brand poll gate). IG-only.
    if (ctx.hasInstagram) {
      // Only throttle to hourly when the webhook is ACTUALLY delivering events right
      // now; if it's silent (down, unbound, or simply no recent events) fall back to
      // the responsive 5-min poll so comments are never missed.
      const webhookLive = isWebhookActive();
      const effPollMs   = webhookLive ? COMMENT_POLL_WEBHOOK_MS : COMMENT_POLL_FALLBACK_MS;
      const lastCommentAt = _lastCatchupCommentAtByBrand.get(ctx.brandId) ?? 0;
      if (Date.now() - lastCommentAt >= effPollMs) {
        _lastCatchupCommentAtByBrand.set(ctx.brandId, Date.now());
        try {
          const cr = await fetchMissedComments(ctx, errors);
          newComments  += cr.newComments;
          repliedCount += cr.repliedCount;
        } catch (e: any) {
          console.warn(`[Catchup] fetchMissedComments failed for ${brand.label}:`, e?.message ?? String(e));
        }
      } else if (webhookLive) {
        console.log(`[Catchup] Comment poll skipped (${brand.label}) — webhook live (event ${secondsSinceLastWebhookComment()}s ago), next fallback in ${Math.round((effPollMs - (Date.now() - lastCommentAt)) / 60_000)}m`);
      }
    }

    // 3b. Sync Instagram insights for THIS brand in background (throttled to every
    //     6 h per brand). Uses the brand's IG creds and stamps brandId on Analytics
    //     rows (NULL for primary). For the primary brand this is identical to the
    //     previous single global call (env creds, primary's posts, null brandId).
    if (ctx.hasInstagram) {
      void syncInstagramInsights(ctx).catch(() => {});
    }

    // 4. Auto-reply to missed DMs. IG-only (needs igToken + fbPageId).
    if (ctx.hasInstagram) {
      try {
        dms += await replyMissedDMs(ctx, errors);
      } catch (e: any) {
        console.warn(`[Catchup] replyMissedDMs failed for ${brand.label}:`, e?.message ?? String(e));
      }
    }

    // 5. Grok auto-reply to comments on this brand's YouTube videos. YT-only.
    if (ctx.hasYouTube) {
      try {
        const ytReplies = await replyToYouTubeComments(ctx);
        youtubeCommentsReplied += ytReplies;
        if (ytReplies > 0) {
          await safeLog({
            action:   "YOUTUBE_COMMENTS_REPLIED",
            entity:   "YouTube",
            entityId: "comments",
            metadata: { count: ytReplies, brandId: ctx.brandId },
          });
        }
      } catch (err) {
        console.warn("[YouTube] replyToYouTubeComments failed:", String(err));
      }
    }
  }

  const result: CatchupResult = {
    scheduledPublished: published,
    scheduledFailed:    failed,
    newComments,
    commentsReplied:    repliedCount, // actual replies sent (new + retried unreplied comments)
    dmsReplied:         dms,
    youtubeCommentsReplied,
    errors,
    ranAt:              now.toISOString(),
  };

  console.log("[Catchup] Done:", result);
  return result;
}
