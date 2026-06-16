/**
 * POST /api/media/generate-caption
 *
 * Generates a viral Instagram caption.
 *
 * Vision path (preferred): when aiProvider=gemini AND imageBase64+mimeType are
 * provided, Gemini actually LOOKS at the image/video and writes a caption
 * describing the real content.
 *
 * Text fallback: when no media data is present, or provider=grok, generates
 * a caption from the title/topic only.
 *
 * Body: { postType, title, topic?, imageBase64?, mimeType? }
 *   imageBase64 — raw base64 string (no "data:..." prefix)
 *   mimeType    — e.g. "image/jpeg", "video/mp4"
 */
import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/ai-factory";
import { readPreferences, getBrand } from "@/lib/preferences";
import { atHandle, typeLabel } from "@/lib/brandConfig";

const TYPE_INSTRUCTIONS: Record<string, string> = {
  EDUCATIONAL:      "Write an educational caption with a bold hook, 3-4 bullet points of insight, and a save/share CTA. 150-220 words.",
  QUIZ:             "Write a quiz caption: pose the question in the first line, prompt followers to 'Drop your answer below!', then tease the reveal. 80-120 words. No answer in caption.",
  CAROUSEL:         "Write a carousel caption with a powerful hook that makes followers swipe. End with 'Save this for later'. 100-150 words.",
  MYTH_FACT:        "Write a myth vs fact caption. Open with 'MYTH:' statement, then 'FACT:' rebuttal with evidence. CTA to share. 120-180 words.",
  CLINICAL_PEARL:   "Write a pro-tip caption: one high-value actionable insight in the first 2 lines, then supporting context. 100-150 words.",
  CASE_STUDY:       "Write a story/example caption: brief scenario hook, then key details and takeaway. An engaging CTA. 150-200 words.",
  ANGIOGRAPHY_QUIZ: "Write an image quiz caption describing what's shown and asking followers to identify it. 80-120 words.",
  ECG_QUIZ:         "Write a knowledge quiz caption describing the scenario and asking 'What's the answer?'. 80-120 words.",
  PREVENTIVE:       "Write a how-to/tips caption with a shocking statistic hook, actionable tips, and share CTA. 150-200 words.",
  CTA:              "Write a warm, authentic CTA caption explaining why following this account is valuable. 80-120 words.",
  REEL:             "Write a reel caption with a punchy hook (first line gets cut off), key takeaway, and 'Watch till end!' prompt. 80-100 words.",
  STORY:            "Write a story caption — very short, punchy, encouraging engagement. 30-50 words.",
};

export async function POST(request: NextRequest) {
  try {
    const body         = await request.json();
    const postType     = (body.postType    as string) ?? "EDUCATIONAL";
    const title        = (body.title       as string) ?? "";
    const topic        = (body.topic       as string) ?? title;
    const imageBase64  = (body.imageBase64 as string) ?? "";   // raw base64 — no data: prefix
    const mimeType     = (body.mimeType    as string) ?? "";   // e.g. "image/jpeg"

    const brand       = await getBrand();
    const label       = typeLabel(brand, postType);
    const instruction = TYPE_INSTRUCTIONS[postType] ?? TYPE_INSTRUCTIONS["EDUCATIONAL"];

    // ── Try Gemini vision first if client sent base64 media data ─────────────
    if (imageBase64 && mimeType) {
      try {
        const prefs     = await readPreferences();
        const provider  = (prefs.ai as any).aiProvider ?? "grok";
        const geminiKey = (process.env.GEMINI_API_KEY?.trim()) || ((prefs.ai as any).geminiApiKey?.trim() ?? "");

        if (provider === "gemini" && geminiKey) {
          const { GeminiClient } = await import("@/lib/gemini");
          const gemini  = new GeminiClient(geminiKey);
          const result  = await gemini.analyzeMediaInline(imageBase64, mimeType, postType);
          if (result?.caption) {
            console.log(`[GenerateCaption] Gemini vision (inline) caption generated for ${postType} — ${mimeType}`);
            return NextResponse.json({
              success: true,
              data: {
                caption:  result.caption,
                hashtags: result.hashtags ?? [],
                source:   "gemini-vision",
              },
            });
          }
        }
      } catch (visionErr: any) {
        console.warn("[GenerateCaption] Gemini inline vision failed, falling back to text:", visionErr?.message);
      }
    }

    // ── Text-based generation (Grok or Gemini text) ──────────────────────────
    const ai = await getAIClient();

    const ctaInstruction = postType === "CTA"
      ? `Write a warm, authentic CTA caption explaining why following ${atHandle(brand)} is valuable. 80-120 words.`
      : instruction;

    const prompt = `Generate a viral Instagram caption for a ${label} ${brand.niche} post.

Post title / topic: "${topic || brand.niche}"

Instructions:
${ctaInstruction}

Rules:
- Write for this account's audience: ${brand.audience}
- Start with a HOOK line that stops the scroll (question, shocking stat, or bold claim)
- Use line breaks (\\n) between sections for readability on Instagram
- NO hashtags in the caption — they will be added separately
- Do NOT include asterisks or markdown formatting
- Make it engaging, accurate, and shareable
- End with a strong CTA (save, share, comment, or follow)

Return ONLY the caption text. No JSON. No meta-commentary.`;

    const caption = await ai.generateContent(
      prompt,
      `You are a world-class ${brand.niche} Instagram content creator. Write captions that go viral by combining authority with genuine human connection. Return only the caption text — no JSON, no formatting symbols.`,
      1200,
    );

    const cleaned = caption
      .replace(/^["']|["']$/g, "")
      .replace(/^```[\s\S]*?```$/gm, "")
      .trim();

    return NextResponse.json({ success: true, data: { caption: cleaned, source: "text" } });
  } catch (e: any) {
    console.error("[GenerateCaption]", e?.message);
    return NextResponse.json({ success: false, error: e?.message ?? "Caption generation failed" }, { status: 500 });
  }
}
