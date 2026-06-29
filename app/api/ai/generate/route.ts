import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readPreferencesForBrand } from "@/lib/preferences";
import { getAIClient } from "@/lib/ai-factory";
import { DEFAULT_GROK_MODEL } from "@/lib/grok";
import { resolveBrandId } from "@/lib/brands";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";
import { getBrand } from "@/lib/preferences";
import { BrandConfig, atHandle, typeLabel } from "@/lib/brandConfig";

// --- VALIDATION -------------------------------------------------------------------

const GenerateSchema = z.object({
  type: z.enum([
    "EDUCATIONAL",
    "QUIZ",
    "CAROUSEL",
    "MYTH_FACT",
    "CLINICAL_PEARL",
    "CASE_STUDY",
    "ANGIOGRAPHY_QUIZ",
    "ECG_QUIZ",
    "PREVENTIVE",
    "CTA",
    "REEL",
  ]),
  tone: z.enum(["professional", "educational", "engaging", "conversational", "authoritative"]).default("professional"),
  topic: z.string().min(3).max(300),
  customPrompt: z.string().max(1000).optional(),
  // Platform targeting (backward compatible — defaults to Instagram when absent)
  platform: z.enum(["instagram", "youtube", "both"]).optional().default("instagram"),
  youtubeMode: z.boolean().optional().default(false),
});

// --- AI-DEFAULTS MAPPING ----------------------------------------------------------
// The AI Settings tab stores human-readable labels (e.g. "Professional", "Clinical
// Pearl"). Map them onto this route's strict enums so `prefs.ai.defaultTone` /
// `defaultType` can act as fallbacks when the request omits tone/type. Unknown /
// absent values return null → caller leaves the field untouched (no crash).

const TONE_MAP: Record<string, "professional" | "educational" | "engaging" | "conversational" | "authoritative"> = {
  professional:   "professional",
  educational:    "educational",
  engaging:       "engaging",
  conversational: "conversational",
  casual:         "conversational",
  authoritative:  "authoritative",
  urgent:         "authoritative",
};

const TYPE_MAP: Record<string, string> = {
  educational:       "EDUCATIONAL",
  quiz:              "QUIZ",
  carousel:          "CAROUSEL",
  "myth-fact":       "MYTH_FACT",
  "myth fact":       "MYTH_FACT",
  myth_fact:         "MYTH_FACT",
  "clinical pearl":  "CLINICAL_PEARL",
  clinical_pearl:    "CLINICAL_PEARL",
  "case study":      "CASE_STUDY",
  case_study:        "CASE_STUDY",
  "angiography quiz":"ANGIOGRAPHY_QUIZ",
  angiography_quiz:  "ANGIOGRAPHY_QUIZ",
  "ecg quiz":        "ECG_QUIZ",
  ecg_quiz:          "ECG_QUIZ",
  preventive:        "PREVENTIVE",
  cta:               "CTA",
  reel:              "REEL",
};

function mapDefaultTone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return TONE_MAP[raw.trim().toLowerCase()] ?? null;
}

function mapDefaultType(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return TYPE_MAP[raw.trim().toLowerCase()] ?? null;
}

// --- TYPES ------------------------------------------------------------------------

interface ContentResult {
  title: string;
  content: string;
  hook: string;
  cta: string;
  hashtags: string[];
  imagePrompt: string;
  reelScript?: string;
  viralScore: number;
  carouselSlides?: Array<{ slide: number; headline: string; body: string }>;
}

interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// --- SYSTEM PROMPTS ---------------------------------------------------------------

// Parse a requested slide count from free-text (e.g. "I need 13 carousels", "make 7 slides")
function parseSlideCount(text: string): number | null {
  if (!text) return null;
  // Match patterns like "13 carousel", "13 slides", "13 cards", "13-slide", just "13"
  const m = text.match(/(\d+)\s*(?:carousel|slide|card|panel|frame|page)s?/i)
         ?? text.match(/(?:make|create|generate|need|want|give me)\s+(\d+)/i)
         ?? text.match(/\b(\d+)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // Clamp: Instagram carousel max is 20, min is 2; enforce sensible range
  if (n < 2 || n > 20) return null;
  return n;
}

// Build dynamic carousel slide templates for a given slide count
function buildCarouselSlides(count: number, brand: BrandConfig): string {
  const handle = atHandle(brand);
  const slides: string[] = [];
  for (let i = 1; i <= count; i++) {
    if (i === 1) {
      slides.push(
        `    { "slide": 1, "headline": "4-7 word cover headline, no asterisks", "body": "Hook stat or shocking fact that makes people swipe. 1-2 sentences with real data." }`
      );
    } else if (i === count) {
      // Last slide always CTA
      slides.push(
        `    { "slide": ${i}, "headline": "Save This Post", "body": "Follow ${handle} for more. Share with someone who needs to see this." }`
      );
    } else if (i === count - 1) {
      slides.push(
        `    { "slide": ${i}, "headline": "Pro Tip", "body": "The single most important actionable takeaway from this topic." }`
      );
    } else {
      slides.push(
        `    { "slide": ${i}, "headline": "Point ${i - 1} headline 3-5 words", "body": "2-3 sentences. Real data, specific numbers or a credible reference. Evidence-based. Practical application." }`
      );
    }
  }
  return slides.join(",\n");
}

function buildSystemPrompt(
  type: string,
  tone: string,
  topic: string,
  brand: BrandConfig,
  customPrompt?: string,
  savedTypePrompt?: string | null,
  targetsYouTube?: boolean,
): string {
  const handle = atHandle(brand);
  const niche  = brand.niche;
  const toneDescriptor =
    tone === "professional"
      ? "authoritative, credible, and precise"
      : tone === "educational"
      ? "clear, approachable, and educational"
      : tone === "engaging"
      ? "engaging, dynamic, and scroll-stopping"
      : tone === "conversational"
      ? "conversational, warm, and accessible"
      : "authoritative and commanding";

  const baseContext = `You are the content brain behind ${handle} -- ${brand.persona.role || `the creator behind this ${niche} account`}, building the most engaging ${niche} account on Instagram. ${brand.purpose} Your content is accurate, visually structured, and engineered for saves and shares.

ACCOUNT VOICE: ${brand.persona.voice || "Direct. Confident. Sharp."} You make ${niche} instantly clear -- no waffle, no vague generalities. Every sentence earns its place.
AUDIENCE: ${brand.audience}
TONE: ${toneDescriptor}.

TOPIC: ${topic}
${customPrompt ? `ADDITIONAL CONTEXT: ${customPrompt}` : ""}

CAPTION WRITING RULES -- follow exactly:
1. HOOK LINE: First 1-2 lines must stop the scroll. Use a shocking stat, bold claim, or a question. Never start with "In this post..." or "Today we..."
2. BODY: Short punchy paragraphs (2-3 lines max each). Bullet points with the bullet character for lists. Include real numbers or credible references. Teach something specific.
3. CTA: End with ONE clear action -- a question that begs answering, or "Save this for later."
4. FORMATTING: Use emojis naturally (3-6 per post, not every sentence). Do NOT use **bold** markdown -- write without asterisks or markdown formatting.
5. LENGTH: 150-300 words for standard posts. Carousel captions 100-180 words.

CONTENT STANDARD: Every claim must be accurate. Real numbers only. Write like a knowledgeable expert teaching a peer -- rigorous but human.

HASHTAG RULES (the "hashtags" array) -- follow exactly:
${
    targetsYouTube
      ? `- This content targets YOUTUBE SHORTS. Shorts discovery is keyword/search/suggested-driven, NOT hashtag-flooded.
- Return a SMALL set of 3-5 searchable, content-specific keyword tags (NOT 25-30), and ALWAYS include #shorts.
- Base each keyword on the SPECIFIC subject of this topic (the actual terms and concepts) -- what a viewer would type into YouTube to find THIS subject.
- No Instagram-style tag dumps, no generic padding, no engagement-bait/banned tags.`
      : `- These are INSTAGRAM hashtags. Under the 2025 algorithm, relevance ranks the post into the right topic -- raw volume does not boost reach.
- Derive EVERY tag from the SPECIFIC subject of this post (the actual terms and concepts) -- never generic or off-topic.
- Use a deliberate reach-tier MIX of ~12-18 tags: 1-2 broad-but-on-topic (umbrella ${niche} tag) + 5-7 mid-niche (the specific subtopic an engaged audience follows) + 4-6 highly-specific long-tail.
- NO engagement-bait, banned, or spammy tags (#fyp #viral #likeforlike #followme #saveforlater #didyouknow #learnontiktok). Output tags WITHOUT the # symbol as instructed in the JSON shape.`
  }

You MUST respond with a valid JSON object only. No markdown code blocks. No preamble.${
    targetsYouTube
      ? `

YOUTUBE SHORTS MODE — this content will ALSO be published as a vertical YouTube Short (9:16, under 60s):
- The HOOK must grab attention in the FIRST 2 SECONDS for Shorts retention — a bold visual claim, shocking stat, or open-loop question. No slow intros.
- Write the "title" as a YouTube-friendly, searchable, click-worthy title (front-load the key keyword/topic; keep it natural, not clickbait spam).
- Structure "content" so it doubles as a strong YouTube Short description: lead with a searchable summary line containing the main keyword, then the value, then the CTA.
- Optimize pacing for vertical video retention (tight, punchy, no filler).`
      : ""
  }`;

  const prompts: Record<string, string> = {

    EDUCATIONAL: `${baseContext}

Create a beautifully written EDUCATIONAL Instagram post.

The "hook" field is the VISUAL CARD HEADLINE -- bold, 6-10 words, impossible to ignore. This appears large on the card.

The "content" field is the full Instagram CAPTION written exactly like ${handle}:
- Open with the hook restated or expanded (1-2 punchy lines)
- 3-5 bullet points with real data, numbers, and credible references
- End with a question that invites comments
- 200-300 words. No filler. No asterisks.

Respond with this exact JSON structure:
{
  "title": "Short SEO title under 60 chars",
  "hook": "Card headline -- 6-10 bold words. No asterisks.",
  "content": "Full Instagram caption. ${handle} voice. Hook, bullets with real data, engaging question. 200-300 words. No asterisks or markdown.",
  "cta": "Save this post! Share with someone who needs to know this",
  "hashtags": ["25-30 relevant hashtags without the hash symbol -- mix broad and niche ${niche} tags"],
  "imagePrompt": "Clean on-brand background, bold graphic relevant to the topic, educational infographic, 1080x1080",
  "viralScore": 0.87,
  "carouselSlides": null
}`,

    QUIZ: `${baseContext}

Create a QUIZ post styled exactly like ${handle}.

The "hook" field is the QUIZ QUESTION shown large on the card -- precise, 1-2 sentences.

The "content" field is the Instagram caption in this exact format:
Line 1: "QUIZ #[number]"
Line 2: Restate the question
Lines 3-6: A. option  B. option  C. option  D. option (each on own line, NO correct-answer markers, NO asterisks, NO tick marks, NO (correct) labels, NO arrows)
Blank line
"Comment your answer before seeing the next post!"
1 line of context about WHY this topic matters (do NOT state or hint at the correct answer)
"Want more challenges? Let me know!"

CRITICAL: Do NOT mark the correct option in any way. Do NOT include any answer, explanation, or hint toward the correct answer anywhere in the content field. The answer will be revealed separately in the comments.

Respond with this exact JSON structure:
{
  "title": "QUIZ -- [topic]",
  "hook": "The quiz question for the card -- precise. No asterisks.",
  "content": "Caption in QUIZ format as described. All 4 options labeled A-D, no answer markers. 150-200 words total. No asterisks.",
  "cta": "Comment your answer below! Tag someone to test them!",
  "hashtags": ["25-30 hashtags -- ${niche} and quiz focused"],
  "imagePrompt": "On-brand background, clean quiz card aesthetic",
  "viralScore": 0.89,
  "carouselSlides": null
}`,

    CAROUSEL: (() => {
      // Detect custom slide count from user's additional context (e.g. "I need 13 carousels")
      const requestedCount = customPrompt ? parseSlideCount(customPrompt) : null;
      const slideCount = requestedCount ?? 9; // default 9
      const middleRange = slideCount <= 3
        ? `Slide 2`
        : `Slides 2-${slideCount - 2}`;
      const slidesJson = buildCarouselSlides(slideCount, brand);

      return `${baseContext}

Create a CAROUSEL post with EXACTLY ${slideCount} slides styled exactly like ${handle} carousel posts.
CRITICAL: You MUST generate exactly ${slideCount} slides in the carouselSlides array — no more, no fewer.

SLIDE RULES:
- Slide 1: Cover headline (4-7 words max, no asterisks) + one shocking stat or question body
- ${middleRange}: Each one focused point. Headline 3-5 words. Body: 2-3 crisp sentences with REAL data and numbers.
- Slide ${slideCount - 1}: Common mistake or pro tip
- Slide ${slideCount} (LAST): ALWAYS a CTA — "Save this post / Follow ${handle}" style

CAPTION: Short and punchy, 100-180 words. Swipe prompt. Save and share CTA. ${handle} voice.

Respond with this exact JSON structure (carouselSlides MUST have exactly ${slideCount} objects):
{
  "title": "Carousel SEO title",
  "hook": "First slide headline -- 4-7 bold words, makes people stop and swipe. No asterisks.",
  "content": "Instagram caption -- ${handle} style. 100-180 words. Swipe prompt. Save and share CTA. No asterisks.",
  "cta": "Swipe through all slides! Save for your next shift! Share with a colleague!",
  "hashtags": ["25-30 relevant hashtags"],
  "imagePrompt": "Dark purple-navy background, red gradient border, medical infographic carousel style",
  "viralScore": 0.91,
  "carouselSlides": [
${slidesJson}
  ]
}`;
    })(),

    MYTH_FACT: `${baseContext}

Create a MYTH vs FACT post debunking a common ${niche} misconception.

The "hook" field is the MYTH shown large on the card -- short, punchy, shocking. What most people incorrectly believe. No asterisks, max 12 words.

The "content" field is the Instagram caption in this format:
"MYTH: [restate the myth]

FACT: [the evidence-based truth -- cite the study or guideline]

[2-3 short paragraphs: why the myth persists, what the evidence actually shows, real-world implications]

Drop a heart if this surprised you! Share to correct this myth in your network."

Respond with this exact JSON structure:
{
  "title": "Myth vs Fact: [topic]",
  "hook": "The myth -- stated as a common belief. Short, shocking, 8-12 words. No asterisks.",
  "content": "Caption in MYTH/FACT format. 200-280 words. Cite real evidence. Direct voice. No asterisks.",
  "cta": "Share this to bust a myth! Drop a heart if this changed your mind!",
  "hashtags": ["25-30 hashtags"],
  "imagePrompt": "On-brand background, split design with X mark left and checkmark right, myth vs fact visual",
  "viralScore": 0.88,
  "carouselSlides": null
}`,

    CLINICAL_PEARL: `${baseContext}

Create a PRO TIP post -- a high-value, save-worthy insight for your ${niche} audience.

The "hook" field is THE TIP ITSELF shown on the card -- one crisp powerful statement someone would screenshot and send to a friend. No asterisks, under 15 words. Use real numbers where possible.

The "content" field is the Instagram caption:
"PRO TIP -- [topic]

[State the tip clearly with supporting evidence]

THE EVIDENCE:
- [Source, year, key finding]
- [Credible reference if applicable]

HOW TO APPLY IT:
- [When to use this]
- [A specific scenario]
- [Any caveats]

REMEMBER: [One-line memory aid if applicable]

Save this for later. Which tip changed how you do things? Comment below"

Respond with this exact JSON structure:
{
  "title": "Pro Tip: [topic]",
  "hook": "The tip -- one powerful statement with real numbers. No asterisks.",
  "content": "Caption in tip format as described. 180-260 words. Real evidence. Actionable. No asterisks.",
  "cta": "Save this! Which tip do you wish you knew earlier? Comment below!",
  "hashtags": ["25-30 hashtags"],
  "imagePrompt": "On-brand background, diamond gem visual, pro tip card aesthetic",
  "viralScore": 0.90,
  "carouselSlides": null
}`,

    CASE_STUDY: `${baseContext}

Create a STORY / EXAMPLE post written like a real walkthrough of a real-world scenario.

The "hook" field is the opener -- dramatic, specific, scroll-stopping.

The "content" field is the Instagram caption:
"STORY -- [brief topic]

THE SETUP: [the situation / context]

KEY DETAILS:
- [detail 1]
- [detail 2]
- [detail 3]

WHAT HAPPENED: [the turning point] -- [brief reasoning]

THE APPROACH:
- [Step 1]
- [Step 2]
- [Step 3]

OUTCOME: [the result]

TAKEAWAY: [1-2 sentence lesson from this example]

What would YOU do next? Drop your answer below. Save this!"

Respond with this exact JSON structure:
{
  "title": "Story / Example: [brief description]",
  "hook": "The opener -- specific, dramatic, scroll-stopping. No asterisks.",
  "content": "Caption in story/example format as described. 220-300 words. Real concrete details. No asterisks.",
  "cta": "What would you do next? Drop your answer below! Save this!",
  "hashtags": ["25-30 hashtags"],
  "imagePrompt": "On-brand case-file aesthetic, topic-relevant overlay, teaching example visual",
  "viralScore": 0.87,
  "carouselSlides": null
}`,

    ANGIOGRAPHY_QUIZ: `${baseContext}

Create an IMAGE QUIZ post -- a "can you spot it / what is this?" challenge.

The "hook" field is the question shown on the card. Specific and on-topic.

The "content" field is the caption in this format:
"IMAGE CHALLENGE

SETUP: [context for what's shown]

WHAT YOU SEE:
- [observation 1]
- [observation 2]

QUESTION: [Specific decision or identification]

A. [Option]
B. [Option]
C. [Option]
D. [Option]

Comment your answer before scrolling!

Tag someone who'd love this!"

CRITICAL: Do NOT include ANSWER, explanation, or any hint toward the correct option anywhere in the content field. Do NOT mark any option as correct. Do NOT use tick marks, asterisks, arrows, (correct), or any other marker. The answer will be revealed in the comments only.

Respond with this exact JSON structure:
{
  "title": "Image Quiz -- [topic]",
  "hook": "The question -- specific and on-topic. No asterisks.",
  "content": "Full caption in image challenge format as described. No answer, no answer hints, no correct-option markers. 180-250 words. No asterisks.",
  "cta": "Comment your answer! Tag someone to try it!",
  "hashtags": ["25-30 hashtags -- ${niche} and quiz focused"],
  "imagePrompt": "On-brand background, topic-relevant diagram with a focal marker, image challenge visual",
  "viralScore": 0.88,
  "carouselSlides": null
}`,

    ECG_QUIZ: `${baseContext}

Create a KNOWLEDGE QUIZ post -- a deeper interpretation/knowledge challenge.

The "hook" field is the scenario plus question shown on the card. Specific snapshot in 1-2 sentences.

The "content" field is the caption:
"KNOWLEDGE CHALLENGE

SETUP: [context]

KEY POINTS:
- [point 1]
- [point 2]
- [point 3]

QUESTION: What is the answer?
A. [Option]
B. [Option]
C. [Option]
D. [Option]

Post your answer below!

How do you approach this? Share your method below!"

CRITICAL: Do NOT include ANSWER or any explanation anywhere in the content field. Do NOT mark any option as correct. Do NOT use tick marks, asterisks, arrows, (correct), or any other correct-answer indicator on any option. The answer and explanation will be revealed in the comments only.

Respond with this exact JSON structure:
{
  "title": "Knowledge Quiz -- [topic]",
  "hook": "Scenario plus question. Specific. No asterisks.",
  "content": "Caption in knowledge challenge format as described. SETUP, KEY POINTS, QUESTION, A-D options (no answer markers), engagement CTA. No answer/explanation sections. 180-250 words. No asterisks.",
  "cta": "Post your answer! How do you approach this? Share your method below!",
  "hashtags": ["25-30 hashtags -- ${niche} and quiz focused"],
  "imagePrompt": "On-brand background, topic-relevant visual with annotation markers, knowledge challenge visual",
  "viralScore": 0.89,
  "carouselSlides": null
}`,

    PREVENTIVE: `${baseContext}

Create a HOW-TO / TIPS post -- actionable content your audience can apply.

The "hook" field is the card headline -- a shocking statistic or powerful statement. No asterisks, max 12 words.

The "content" field is the caption:
"[Restate the hook with real context -- 1-2 lines]

The data is clear: [key fact with real numbers]

TOP [n] STEPS:
1. [Specific action -- include a concrete target where relevant]
2. [Specific action with target]
3. [Specific action]
4. [Specific action]
5. [Specific action]

According to [credible source]: [specific recommendation]

The tools to do this exist -- use them.

Share this with someone who needs it. What is your number 1 habit here? Comment below."

Respond with this exact JSON structure:
{
  "title": "How-To / Tips: [topic]",
  "hook": "Shocking stat or powerful statement -- 6-10 words. No asterisks.",
  "content": "Caption in how-to/tips format. 200-280 words. Real numbers. Specific targets. Empowering but urgent. No asterisks.",
  "cta": "Share this with someone who needs to hear it! What is your number 1 tip?",
  "hashtags": ["25-30 hashtags -- ${niche} and tips focused"],
  "imagePrompt": "On-brand background with shield icon, tips infographic, how-to visual",
  "viralScore": 0.86,
  "carouselSlides": null
}`,

    CTA: `${baseContext}

Create a high-converting CTA post for ${handle} -- community building, value-forward.

The "hook" field is the card headline -- why someone MUST follow this account. No asterisks, max 12 words.

The "content" field is a genuine caption (not an advertisement):
"If you care about ${niche} -- this account is for you.

Every week here you will find:
- [Content type 1 -- specific example]
- [Content type 2 -- specific example]
- [Content type 3 -- specific example]
- [Content type 4 -- specific example]

I started this account because [genuine reason].

The content that saves the most? [Type of post and why it resonates].

If even one post helps you, that is the goal.

Save this and share it with someone who'd find it valuable.

Turn on notifications so you never miss a post."

Respond with this exact JSON structure:
{
  "title": "Follow ${handle} for more",
  "hook": "Why follow this account -- value in 6-10 words. No asterisks.",
  "content": "Caption in genuine community-builder format. 180-250 words. Authentic and value-first. No asterisks.",
  "cta": "Follow for more! Turn on notifications so you never miss a post!",
  "hashtags": ["25-30 hashtags"],
  "imagePrompt": "On-brand background, sparkles icon, follow call-to-action visual, brand aesthetic",
  "viralScore": 0.84,
  "carouselSlides": null
}`,

    REEL: `${baseContext}

Create a full REEL SCRIPT for a 30-60 second ${niche} video.

The "hook" field is the TEXT ON SCREEN at 0-3 seconds -- must stop the scroll in under 1 second. Bold claim or shocking question. No asterisks.

The "content" field is the Instagram CAPTION for the reel post (not the script). Hook, brief context, CTA. 100-160 words. No asterisks.

The "reelScript" field is the FULL VIDEO SCRIPT in this exact format:
[0-3s] TEXT ON SCREEN: [bold text]
VOICEOVER: [opening line]

[3-12s] SCENE: [what to film/show]
VOICEOVER: [punchy short sentences]

[12-25s] MAIN CONTENT:
VOICEOVER: [key teaching points -- short sentences optimized for video]

[25-40s] KEY TAKEAWAY:
TEXT ON SCREEN: [memorable stat or statement]
VOICEOVER: [reinforcement line]

[40-55s] CTA:
TEXT ON SCREEN: Follow ${handle}
VOICEOVER: [closing line with action]

B-ROLL: [3-4 specific visual suggestions]
AUDIO: [music or sound recommendation]

Respond with this exact JSON structure:
{
  "title": "Reel title -- [topic]",
  "hook": "3-second screen text hook -- bold, stops scroll immediately. No asterisks.",
  "content": "Reel caption -- hook, brief context, CTA. 100-160 words. No asterisks.",
  "cta": "Follow for more reels! Save this! Comment your thoughts!",
  "hashtags": ["25-30 hashtags -- reels and ${niche} focused"],
  "imagePrompt": "On-brand thumbnail concept, ${niche} reel visual, education video aesthetic",
  "reelScript": "FULL REEL SCRIPT in the exact timestamped format described above",
  "viralScore": 0.88,
  "carouselSlides": null
}`,
  };

  // Prefer the brand's per-type custom prompt, then a user-saved prompt override,
  // then the built-in template. Both overrides keep the brand-driven baseContext.
  const brandTypePrompt = (brand.contentTypes as any)?.[type]?.prompt?.trim();
  if (brandTypePrompt) {
    return `${baseContext}\n\n${brandTypePrompt}`;
  }
  if (savedTypePrompt) {
    return `${baseContext}\n\n${savedTypePrompt}`;
  }

  return prompts[type] ?? prompts["EDUCATIONAL"];
}

// --- AI CALL (Grok or Gemini depending on Settings) --------------------------------

async function callAI(
  messages: GrokMessage[],
  maxTokens: number = 2000,
  // The active brand's AI prefs. Drives provider selection per-brand. When the
  // selected provider is "gemini" we honour that brand's geminiApiKey (env still
  // wins, mirroring getAIClient). Omitting this → primary behaviour (legacy).
  aiPrefs?: { aiProvider?: string; geminiApiKey?: string },
): Promise<{ content: string; tokensUsed: number }> {
  // Check which AI provider is active for THIS brand (primary default = grok).
  const provider = (aiPrefs?.aiProvider) ?? "grok";

  if (provider === "gemini") {
    // Gemini path — combine system + user messages into a single prompt.
    // Build the client from this brand's key (env wins), else fall back to the
    // shared factory (primary prefs) → keeps the legacy primary path identical.
    let ai = await getAIClient();
    try {
      const apiKey = (process.env.GEMINI_API_KEY?.trim()) || (aiPrefs?.geminiApiKey?.trim() ?? "");
      if (apiKey) {
        const { GeminiClient } = await import("@/lib/gemini");
        ai = new GeminiClient(apiKey);
      }
    } catch { /* fall back to factory client */ }
    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const userMsg   = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
    const fullPrompt = `${userMsg}\n\nIMPORTANT: Respond with valid JSON only.`;
    const content = await ai.generateContent(fullPrompt, systemMsg, maxTokens);
    // tokensUsed stays 0 for Gemini: generateContent returns only the text string,
    // and usageMetadata is only on the raw SDK response. Surfacing it would require
    // changing the shared client return signature (which lib/catchup.ts depends on),
    // so we intentionally leave 0 here rather than break that contract.
    return { content, tokensUsed: 0 };
  }

  // Grok / Groq path
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error("GROK_API_KEY is not configured");
  }
  const baseUrl = process.env.GROK_API_URL || "https://api.groq.com/openai/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL_MAIN || DEFAULT_GROK_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.8,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  const tokensUsed = data.usage?.total_tokens ?? 0;
  return { content, tokensUsed };
}

// --- VIRAL SCORE GENERATOR --------------------------------------------------------
// Computed server-side so it varies per generation rather than echoing the
// hardcoded template placeholder the AI always copies back.

const VIRAL_BASE: Record<string, [number, number]> = {
  CAROUSEL:        [0.83, 0.97],
  QUIZ:            [0.79, 0.94],
  ECG_QUIZ:        [0.79, 0.94],
  ANGIOGRAPHY_QUIZ:[0.79, 0.94],
  REEL:            [0.80, 0.96],
  CLINICAL_PEARL:  [0.76, 0.92],
  CASE_STUDY:      [0.74, 0.90],
  MYTH_FACT:       [0.74, 0.90],
  EDUCATIONAL:     [0.71, 0.88],
  PREVENTIVE:      [0.70, 0.86],
  CTA:             [0.66, 0.83],
};

function computeViralScore(type: string): number {
  const [min, max] = VIRAL_BASE[type] ?? [0.68, 0.90];
  // Uniform random in range, rounded to 2 dp
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

// --- PARSE GROK RESPONSE ----------------------------------------------------------

function parseGrokResponse(raw: string, type: string, brand: BrandConfig): ContentResult {
  let parsed: Partial<ContentResult> | null = null;

  const sanitise = (s: string): string =>
    s
      .replace(/^```json\s*/im, "").replace(/^```\s*/im, "").replace(/```\s*$/im, "")
      .replace(/^[\s\S]*?(\{[\s\S]*\})\s*$/, "$1")
      .trim();

  try { parsed = JSON.parse(sanitise(raw)); } catch { /* try next */ }

  if (!parsed) {
    try {
      const fixed = sanitise(raw).replace(
        /"((?:[^"\\]|\\.)*)"/g,
        (_, inner) => `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`
      );
      parsed = JSON.parse(fixed);
    } catch { /* try next */ }
  }

  if (!parsed) {
    const start = raw.indexOf("{");
    const end   = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { /* give up */ }
    }
  }

  if (!parsed) {
    const grab = (key: string) => {
      const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*[,\\n}])`, "i"));
      return m ? m[1].replace(/\\n/g, "\n") : "";
    };
    const grabArr = (key: string): string[] => {
      const m = raw.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i"));
      if (!m) return [];
      return m[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    };
    parsed = {
      title:       grab("title")       || `${typeLabel(brand, type)} Content`,
      hook:        grab("hook")        || "",
      content:     grab("content")     || raw,
      cta:         grab("cta")         || "Save this post! Follow for more!",
      hashtags:    grabArr("hashtags"),
      imagePrompt: grab("imagePrompt") || `${brand.niche} illustration`,
      viralScore:  0.75,
    };
  }

  const hashtags = (parsed.hashtags ?? []).map((h: string) =>
    h.startsWith("#") ? h : `#${h}`
  );

  return {
    title: parsed.title ?? `${typeLabel(brand, type)} Content`,
    content: parsed.content ?? "",
    hook: parsed.hook ?? "",
    cta: parsed.cta ?? "Save this post!",
    hashtags,
    imagePrompt: parsed.imagePrompt ?? `${brand.niche} educational infographic`,
    reelScript: parsed.reelScript,
    // Always compute server-side -- the AI just echoes back the template placeholder
    viralScore: computeViralScore(type),
    carouselSlides: parsed.carouselSlides ?? undefined,
  };
}

// --- ROUTE HANDLER ----------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Multi-brand: brand from body OR ?brand= query. Empty/omitted → primary (legacy).
    // Read prefs BEFORE validation so the AI Settings defaults (defaultTone/defaultType/
    // language) can fill in fields the request omits. Brand is derived from the raw body.
    const brandParam = brandFromBody(body, brandFromQuery(request));
    const brandId    = await resolveBrandId(brandParam);
    const prefs      = await readPreferencesForBrand(brandId);
    const brand      = await getBrand(brandId);

    // Apply AI defaults when the request doesn't supply tone/type (optional-chained,
    // no crash if ai prefs absent). Unknown/absent prefs labels are ignored → the
    // Zod schema's own default (tone) / required-check (type) still applies.
    if (body && typeof body === "object") {
      if (body.tone == null) {
        const t = mapDefaultTone((prefs.ai as any)?.defaultTone);
        if (t) body.tone = t;
      }
      if (body.type == null) {
        const t = mapDefaultType((prefs.ai as any)?.defaultType);
        if (t) body.type = t;
      }
    }

    const validation = GenerateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: validation.error.flatten(), data: null },
        { status: 400 }
      );
    }

    const { type, tone, topic, customPrompt, platform, youtubeMode } = validation.data;

    // YouTube is targeted when platform is youtube/both, or the explicit flag is set
    const targetsYouTube = platform === "youtube" || platform === "both" || youtubeMode === true;
    const targetsInstagram = platform === "instagram" || platform === "both";

    // Check for a user-saved custom prompt override for this post type (per brand).
    const savedPrompts    = prefs.prompts ?? {};
    const savedTypePrompt = savedPrompts[type] ?? null;

    // PREPEND the brand's per-account default content prompt(s):
    //   IG/both → igDefaultPrompt, YouTube/both → ytDefaultPrompt.
    // These steer generation toward the brand's voice/topic. Empty → no-op (legacy).
    const prefixes: string[] = [];
    if (targetsInstagram && (prefs.igDefaultPrompt ?? "").trim()) {
      prefixes.push((prefs.igDefaultPrompt ?? "").trim());
    }
    if (targetsYouTube && (prefs.ytDefaultPrompt ?? "").trim()) {
      prefixes.push((prefs.ytDefaultPrompt ?? "").trim());
    }
    const brandPrefix = prefixes.length ? `${prefixes.join("\n\n")}\n\n` : "";

    // When the brand's AI language preference is set and not English, instruct the
    // model to write in that language (optional-chained, no-op if ai prefs absent).
    const aiLanguage = ((prefs.ai as any)?.language ?? "").toString().trim();
    const languageSuffix = aiLanguage && aiLanguage.toLowerCase() !== "english"
      ? `\n\nWrite the response in ${aiLanguage}.`
      : "";

    const systemPrompt = brandPrefix + buildSystemPrompt(type, tone, topic, brand, customPrompt, savedTypePrompt, targetsYouTube) + languageSuffix;
    const messages: GrokMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Generate a ${type.toLowerCase().replace(/_/g, " ")} post about: ${topic}${customPrompt ? `. Additional context: ${customPrompt}` : ""}. Respond with JSON only.`,
      },
    ];

    const startTime = Date.now();
    // For carousels with many slides, use a higher token budget so all slides are generated
    const requestedSlides = type === "CAROUSEL" && customPrompt ? (parseSlideCount(customPrompt) ?? 9) : 9;
    const maxTokens = type === "CAROUSEL"
      ? Math.max(4000, requestedSlides * 350)  // ~350 tokens per slide
      : 4000;
    const { content: rawResponse, tokensUsed } = await callAI(messages, maxTokens, {
      aiProvider:   (prefs.ai as any)?.aiProvider,
      geminiApiKey: (prefs.ai as any)?.geminiApiKey,
    });
    const duration = Date.now() - startTime;

    const result = parseGrokResponse(rawResponse, type, brand);

    // Post-process carousel: enforce requested slide count and ensure last slide is CTA
    if (type === "CAROUSEL" && result.carouselSlides) {
      const targetCount = requestedSlides;
      const slides = result.carouselSlides;

      // If AI returned fewer slides than requested, pad with content slides
      while (slides.length < targetCount - 1) {
        slides.splice(slides.length - 1, 0, {
          slide: slides.length + 1,
          headline: `Key Point ${slides.length}`,
          body: "Additional insight on this topic. Evidence-based recommendation from a credible source.",
        });
      }

      // Trim if AI returned too many (keep up to targetCount)
      if (slides.length > targetCount) {
        slides.splice(targetCount);
      }

      // Re-number all slides sequentially
      slides.forEach((s, i) => { s.slide = i + 1; });

      // Enforce: last slide is always CTA
      const lastSlide = slides[slides.length - 1];
      if (
        !lastSlide.headline.toLowerCase().includes("save") &&
        !lastSlide.headline.toLowerCase().includes("follow") &&
        !lastSlide.headline.toLowerCase().includes("share")
      ) {
        slides[slides.length - 1] = {
          slide: slides.length,
          headline: "Save This Post",
          body: `Follow ${atHandle(brand)} for more. Share with someone who needs to see this.`,
        };
      }

      result.carouselSlides = slides;
    }

    const generation = await prisma.aIGeneration.create({
      data: {
        userId: session.user.id,
        type: type as any,
        prompt: JSON.stringify({ systemPrompt, userMessage: messages[1].content }),
        result: result as any,
        tokensUsed,
        model: process.env.AI_MODEL_MAIN || DEFAULT_GROK_MODEL,
        duration,
      },
    });

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        generationId: generation.id,
        content: result.content,
        hook: result.hook,
        cta: result.cta,
        hashtags: result.hashtags,
        imagePrompt: result.imagePrompt,
        reelScript: result.reelScript ?? null,
        viralScore: result.viralScore,
        carouselSlides: result.carouselSlides ?? null,
        title: result.title,
        tokensUsed,
        duration,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[AI Generate] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
