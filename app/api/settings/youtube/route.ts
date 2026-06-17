/**
 * GET  /api/settings/youtube  -  return YouTube mirroring settings + live status
 * POST /api/settings/youtube  -  save YouTube mirroring settings
 */
import { NextRequest, NextResponse } from "next/server";
import { readPreferencesForBrand, writePreferencesForBrand, sanitizeDailySchedule, sanitizeTimeList } from "@/lib/preferences";
import { checkYouTubeHealth } from "@/lib/youtube";
import { getBrandCredentials } from "@/lib/brands";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";

export async function GET(request: NextRequest) {
  try {
    const brand  = brandFromQuery(request);
    const prefs  = await readPreferencesForBrand(brand);
    // Primary/no-brand → env creds (pass none, identical to legacy).
    // Non-primary brand → that brand's stored YouTube OAuth creds.
    const c = brand ? await getBrandCredentials(brand) : null;
    const health = c
      ? await checkYouTubeHealth({ clientId: c.ytClientId, clientSecret: c.ytClientSecret, refreshToken: c.ytRefreshToken })
      : await checkYouTubeHealth();
    return NextResponse.json({ success: true, data: prefs.youtube, status: health });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const brand = brandFromBody(body, brandFromQuery(request));
    const allowedPrivacy = ["public", "unlisted", "private"];
    const secs = Number(body.secondsPerImage);
    const ppd  = Number(body.postsPerDay);

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    const postTimes = Array.isArray(body.postTimes)
      ? Array.from(new Set(body.postTimes.filter((t: unknown) => typeof t === "string" && timeRe.test(t)))).sort() as string[]
      : ["19:00"];
    const scheduleDays = Array.isArray(body.scheduleDays)
      ? Array.from(new Set(body.scheduleDays.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))).sort((a, b) => (a as number) - (b as number)) as number[]
      : [0, 1, 2, 3, 4, 5, 6];
    const topics = Array.isArray(body.topics)
      ? body.topics.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim()) as string[]
      : [];

    const KNOWN_POST_TYPES = [
      "EDUCATIONAL", "QUIZ", "CAROUSEL", "MYTH_FACT", "CLINICAL_PEARL",
      "CASE_STUDY", "ANGIOGRAPHY_QUIZ", "ECG_QUIZ", "PREVENTIVE", "CTA", "REEL",
    ];
    const DEFAULT_POST_TYPES = ["EDUCATIONAL", "CLINICAL_PEARL", "PREVENTIVE"];
    const postTypes = Array.isArray(body.postTypes)
      ? Array.from(new Set(body.postTypes.filter((t: unknown) => typeof t === "string" && KNOWN_POST_TYPES.includes(t as string)))) as string[]
      : [];

    const updated = await writePreferencesForBrand(brand, {
      youtube: {
        enabled:           typeof body.enabled        === "boolean" ? body.enabled        : false,
        privacy:           allowedPrivacy.includes(body.privacy)    ? body.privacy        : "public",
        secondsPerImage:   Number.isFinite(secs) ? Math.min(15, Math.max(2, Math.round(secs))) : 5,
        postsPerDay:       Number.isFinite(ppd) ? Math.min(5, Math.max(1, Math.round(ppd))) : 1,
        descriptionSuffix: typeof body.descriptionSuffix === "string" ? body.descriptionSuffix : "",
        replyToComments:   typeof body.replyToComments === "boolean" ? body.replyToComments : true,
        topics,
        postTypes:         postTypes.length ? postTypes : DEFAULT_POST_TYPES,
        customPromptExtra: typeof body.customPromptExtra === "string" ? body.customPromptExtra : "",
        postTimes:         postTimes.length ? postTimes : ["19:00"],
        scheduleDays,
        publishToInstagram: typeof body.publishToInstagram === "boolean" ? body.publishToInstagram : false,
        // AI voiceover + word-by-word captions (beta, opt-in). Default OFF.
        voiceover:         typeof body.voiceover === "boolean" ? body.voiceover : false,
        // Narration voice (Orpheus). Validate against the known voice list; default male "daniel".
        voiceoverVoice:    ["autumn", "diana", "hannah", "austin", "daniel", "troy"].includes(body.voiceoverVoice) ? body.voiceoverVoice : "daniel",
        // Burn captions into the video. Default OFF → YouTube auto-captions + auto-translate per viewer.
        burnCaptions:      typeof body.burnCaptions === "boolean" ? body.burnCaptions : false,
        // Per-day timing/post-count overrides (validated: day 0-6, postsPerDay 1-5, HH:MM times).
        // withReelTimes:true carries each Custom day's per-day Instagram-Reel slots
        // through (YouTube section only) for the deferred YT→IG cross-post.
        dailySchedule:     sanitizeDailySchedule(body.dailySchedule, { withReelTimes: true }),
        // Master toggle: only post on custom days (ignore global Publishing Days/Times for days with no custom entry).
        customScheduleOnly: typeof body.customScheduleOnly === "boolean" ? body.customScheduleOnly : false,
        // Separate Instagram-Reel publish time(s) for YT→IG cross-posts (HH:MM list).
        reelPublishTimes:  sanitizeTimeList(body.reelPublishTimes),
      },
    });
    return NextResponse.json({ success: true, data: updated.youtube });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}
