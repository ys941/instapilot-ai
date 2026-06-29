/**
 * GET  /api/settings/ai  — return current AI config preferences
 * POST /api/settings/ai  — save AI config preferences (including aiProvider)
 */
import { NextRequest, NextResponse } from "next/server";
import { readPreferencesForBrand, writePreferencesForBrand } from "@/lib/preferences";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";

export async function GET(request: NextRequest) {
  try {
    // No brand (or unknown) → primary brand, identical to legacy behaviour.
    const brand = brandFromQuery(request);
    const prefs = await readPreferencesForBrand(brand);
    return NextResponse.json({ success: true, data: prefs.ai });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
    const brand = brandFromBody(body, brandFromQuery(request));

    // Whitelist the provider; fall back to "grok" on anything unrecognised.
    const aiProvider = ["grok", "gemini"].includes(body.aiProvider) ? body.aiProvider : "grok";

    const updated = await writePreferencesForBrand(brand, {
      ai: {
        defaultTone:  body.defaultTone  ?? "Professional",
        defaultType:  body.defaultType  ?? "Educational",
        language:     body.language     ?? "English",
        aiProvider,
        geminiApiKey: body.geminiApiKey ?? "",
      },
    });

    // If a Gemini API key was provided, also set it in a way the factory can pick up at runtime
    // (env vars can't be changed at runtime, so we rely on the DB value via getAIClient())
    if (body.geminiApiKey) {
      // Make it available to the singleton immediately by resetting the instance
      try {
        const mod = await import("@/lib/gemini");
        // Reset singleton so next call re-creates with new key
        (mod as any).geminiInstance = null;
      } catch { /* ignore — will pick up on next server restart */ }
    }

    return NextResponse.json({ success: true, data: updated.ai });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}
