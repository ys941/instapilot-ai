﻿/**
 * GET  /api/settings/prompts  -  return saved custom prompts + default hints
 * POST /api/settings/prompts  -  save one or more custom prompts
 *      Body: { prompts: Record<string, string> }
 *            A value of "" clears the custom override for that type.
 */
import { NextRequest, NextResponse } from "next/server";
import { readPreferencesForBrand, writePreferencesForBrand } from "@/lib/preferences";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";

/** Short description of what each type should include  -  shown as placeholder in UI */
const DEFAULT_PROMPT_HINTS: Record<string, string> = {
  EDUCATIONAL:      "Create an EDUCATIONAL post with a bold hook headline (6-10 words), 3-5 bullet points with concrete facts and sources, and an engaging question CTA. 200-300 words. No asterisks.",
  QUIZ:             "Create a QUIZ with a clear question on the card, A/B/C/D options labeled on each line, a 'Comment your answer!' CTA, and 2-3 lines of context. 150-200 words.",
  CAROUSEL:         "Create a CAROUSEL (9 slides): Slide 1 = bold cover headline + stat. Slides 2-7 = focused points with real data. Slide 8 = key takeaway. Slide 9 = Save CTA. Caption 100-180 words.",
  MYTH_FACT:        "Create a MYTH vs FACT post: bold myth statement on the card (12 words max), caption opens with 'MYTH:' then 'FACT:' with evidence, 2-3 supporting data points, share CTA. 150-250 words.",
  CLINICAL_PEARL:   "Create a PRO TIP: one high-yield, immediately actionable insight (bold on the card), caption gives the reasoning + supporting evidence + practical application. 150-200 words.",
  CASE_STUDY:       "Create a STORY / EXAMPLE: a real-world scenario on the card, caption walks through the situation, the approach taken, the outcome, and the key takeaway. 200-280 words.",
  ANGIOGRAPHY_QUIZ: "Create an IMAGE QUIZ: describe a visual finding on the card, A/B/C/D options, a correct-answer reveal, and a short explanation. 150-200 words.",
  ECG_QUIZ:         "Create a KNOWLEDGE QUIZ: pose a question on the card, 4 options A-D, a 'Drop your answer below!' CTA, and an explanation of the correct answer. 150-200 words.",
  PREVENTIVE:       "Create a HOW-TO / TIPS post: the headline highlights the main benefit, bullet points cover practical, actionable steps backed by numbers where possible, and a share CTA. 200-280 words.",
  CTA:              "Create a FOLLOW/CTA post: a compelling reason to follow the account, what content they will get, and a community CTA. 100-150 words, warm but authoritative.",
  REEL:             "Create a REEL SCRIPT: a hook line for the first 2 seconds, 5-7 punchy points each 8-12 words, and a strong close. Also write the caption with the same hook and a 'Watch till end!' prompt.",
};

export async function GET(request: NextRequest) {
  try {
    const brand = brandFromQuery(request);
    const prefs = await readPreferencesForBrand(brand);
    return NextResponse.json({
      success: true,
      data: {
        saved:    prefs.prompts ?? {},
        defaults: DEFAULT_PROMPT_HINTS,
        // Per-account default content prompts (empty string = use built-in default).
        igDefaultPrompt: prefs.igDefaultPrompt ?? "",
        ytDefaultPrompt: prefs.ytDefaultPrompt ?? "",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body     = await request.json();
    const brand    = brandFromBody(body, brandFromQuery(request));
    const incoming: Record<string, string> = body.prompts ?? {};

    const current = (await readPreferencesForBrand(brand)).prompts ?? {};
    const merged: Record<string, string> = { ...current };
    for (const [type, text] of Object.entries(incoming)) {
      if (text.trim() === "") {
        delete merged[type];
      } else {
        merged[type] = text.trim();
      }
    }

    // Persist the per-type prompt overrides plus the optional per-account default
    // content prompts (igDefaultPrompt / ytDefaultPrompt). Only write a default
    // prompt when the field is actually present in the body so an unrelated save
    // never clobbers an existing value.
    const patch: { prompts: Record<string, string>; igDefaultPrompt?: string; ytDefaultPrompt?: string } = {
      prompts: merged,
    };
    if (typeof body.igDefaultPrompt === "string") patch.igDefaultPrompt = body.igDefaultPrompt;
    if (typeof body.ytDefaultPrompt === "string") patch.ytDefaultPrompt = body.ytDefaultPrompt;

    const updated = await writePreferencesForBrand(brand, patch);
    return NextResponse.json({
      success: true,
      data: {
        saved:           merged,
        igDefaultPrompt: updated.igDefaultPrompt ?? "",
        ytDefaultPrompt: updated.ytDefaultPrompt ?? "",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

