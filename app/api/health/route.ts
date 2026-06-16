import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readPreferences } from "@/lib/preferences";
import { checkGrokHealth } from "@/lib/grok";
import { isYouTubeConfigured } from "@/lib/youtube";

export const dynamic = "force-dynamic"; // never cache — health check must always be live

export async function GET() {
  // Read active AI provider from DB preferences
  const prefs    = await readPreferences().catch(() => null);
  const provider = (prefs?.ai as any)?.aiProvider ?? "grok";

  const checks = await Promise.allSettled([
    // 1. Database
    prisma.$queryRaw`SELECT 1`,

    // 2. AI provider — ping cheapest endpoint to verify key validity
    (async () => {
      if (provider === "gemini") {
        // Gemini: list models endpoint to verify key
        const key = process.env.GEMINI_API_KEY?.trim() || ((prefs?.ai as any)?.geminiApiKey?.trim() ?? "");
        if (!key) throw new Error("GEMINI_API_KEY not set");
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg  = body?.error?.message ?? `HTTP ${res.status}`;
          throw new Error(msg.includes("API_KEY_INVALID") ? "Invalid API key" : msg);
        }
        return true;
      } else {
        // Grok / Groq: ping models list
        const key = process.env.GROK_API_KEY;
        if (!key) throw new Error("GROK_API_KEY not set");
        const baseUrl = process.env.GROK_API_URL || "https://api.groq.com/openai/v1";
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          const msg  = body.includes("invalid_api_key") ? "Invalid API key" : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        return true;
      }
    })(),

    // 3. Instagram token configured
    Promise.resolve(
      !!process.env.INSTAGRAM_ACCESS_TOKEN &&
      !!process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
    ),

    // 4. Grok API (always used for DM replies, independent of content provider)
    checkGrokHealth(),
  ]);

  const [dbResult, aiResult, igResult, grokResult] = checks;

  const db        = dbResult.status  === "fulfilled";
  const ai        = aiResult.status  === "fulfilled" && aiResult.value === true;
  const instagram = igResult.status  === "fulfilled" && igResult.value === true;

  // Grok health (DM replies)
  const grokHealth = grokResult.status === "fulfilled"
    ? (grokResult.value as { ok: boolean; detail: string })
    : { ok: false, detail: grokResult.reason instanceof Error ? grokResult.reason.message : "Unknown error" };

  const aiLabel  = provider === "gemini" ? "Gemini AI ✨" : "Grok AI 🤖";
  const aiDetail = ai
    ? "API key valid"
    : aiResult.status === "rejected"
      ? (aiResult.reason instanceof Error ? aiResult.reason.message : "Unknown error")
      : `${provider === "gemini" ? "GEMINI" : "GROK"}_API_KEY missing`;

  const allOk = db && ai && instagram && grokHealth.ok;

  // YouTube is optional — report status but never fail overall health on it.
  const ytEnabled    = !!(prefs?.youtube as any)?.enabled;
  const ytConfigured = isYouTubeConfigured();
  const ytDetail     = !ytEnabled ? "Disabled" : ytConfigured ? "Credentials configured" : "Enabled but credentials missing";

  return NextResponse.json({
    success: true,
    data: {
      overall:  allOk ? "healthy" : "degraded",
      provider,
      services: {
        database:  { ok: db,        label: "PostgreSQL",        detail: db        ? "Connected"           : "Cannot reach database" },
        ai:        { ok: ai,        label: `${aiLabel} (content)`, detail: aiDetail },
        grok:      { ok: grokHealth.ok, label: "Grok AI 🤖 (DMs)", detail: grokHealth.detail },
        instagram: { ok: instagram, label: "Instagram API",     detail: instagram ? "Token configured"    : "Access token missing" },
        youtube:   { ok: !ytEnabled || ytConfigured, label: "YouTube API", detail: ytDetail },
        email:     { ok: !!process.env.RESEND_API_KEY, label: "Resend Email", detail: process.env.RESEND_API_KEY ? "API key configured" : "RESEND_API_KEY not set" },
      },
    },
  });
}
