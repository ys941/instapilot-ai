/**
 * lib/captionBuilder.ts
 *
 * Builds beautiful, type-specific Instagram captions for each post type.
 * All non-ASCII characters are expressed as Unicode escape sequences
 * so encoding can never corrupt the output.
 */

import { BrandConfig, atHandle, typeLabel } from "@/lib/brandConfig";

// Neutral fallback labels when no brand is supplied (white-label: the header is
// the user's renameable type label, resolved via typeLabel(brand, postType)).
const NEUTRAL_TYPE_LABEL: Record<string, string> = {
  EDUCATIONAL: "Did You Know", QUIZ: "Quiz", MYTH_FACT: "Myth vs Fact",
  CLINICAL_PEARL: "Pro Tip", CASE_STUDY: "Story", ECG_QUIZ: "Knowledge Quiz",
  ANGIOGRAPHY_QUIZ: "Image Quiz", PREVENTIVE: "How-To", CTA: "Take Action",
  REEL: "Reel", CAROUSEL: "Carousel",
};

// -- Helpers ------------------------------------------------------------------
function clean(t: string): string {
  return (t ?? "").replace(/\*\*/g, "").trim();
}

/**
 * Post-process a built caption, substituting the neutral `@__HANDLE__` placeholder
 * used in the per-type footers with the active brand's handle (or a neutral default
 * when no brand is supplied). All parsing/structure is preserved.
 */
export function applyBrand(text: string, brand?: BrandConfig): string {
  return (text ?? "").replace(/@__HANDLE__/g, brand ? atHandle(brand) : "this account");
}

/**
 * Instagram caption hard limit is 2200 chars. Our unified rich caption is tuned
 * for YouTube (5000-char limit) and can exceed IG's cap, which makes IG container
 * creation fail with code 36004 ("The caption was too long."). This trims the
 * body to fit while PRESERVING the trailing hashtag block (hashtags drive reach).
 */
export const IG_CAPTION_MAX = 2200;
export function capIgCaption(caption: string, limit = IG_CAPTION_MAX): string {
  if (!caption || caption.length <= limit) return caption;
  const paras = caption.split("\n\n");
  // Peel trailing STRUCTURAL paragraphs and ALWAYS preserve them: the hashtag
  // block (drives reach) AND the "follow links" block (the ━ Subscribe/Follow
  // block). Only the prose body in the middle is trimmed.
  const tailParas: string[] = [];
  while (paras.length > 1) {
    const last = (paras[paras.length - 1] ?? "").trim();
    const isHashtags = /(^|\s)#\w/.test(last);
    const isLinks    = last.startsWith("━") || last.includes("youtube.com/@") || last.includes("instagram.com/");
    if (isHashtags || isLinks) { tailParas.unshift(paras.pop()!.trim()); } else break;
  }
  const tail = tailParas.join("\n\n");
  let body = paras.join("\n\n").trim();
  const reserve = tail ? tail.length + 2 : 0; // "\n\n" + tail
  const max = Math.max(0, limit - reserve);
  if (body.length > max) {
    let cut = body.slice(0, max);
    // Prefer cutting at a sentence end / line break so it never ends mid-thought.
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (stop > max * 0.6) cut = cut.slice(0, stop + 1).trim();
    else cut = cut.replace(/\s+\S*$/, "").trim() + "…";
    body = cut;
  }
  return [body, tail].filter(Boolean).join("\n\n");
}

function parseBullets(content: string, max = 6): string[] {
  return content
    .split("\n")
    .filter((l) => l.trim())
    // Strip bullet/dash chars and the numbered-list prefix ONLY (e.g. "1. " / "1) ").
    // IMPORTANT: do NOT strip bare leading digits — "30 minutes" must stay intact.
    // This mirrors cleanText() in postTypeImageGenerator.ts so the card and caption
    // keep identical text for each line.
    .map((l) => l.replace(/\*\*/g, "").replace(/^[\s•●▪►◦'\-*]+/, "").replace(/^\d+[).]\s*/, "").trim())
    .filter(Boolean)
    // Skip intro/header lines that end with ":"
    .filter((l) => !l.endsWith(":") && !l.match(/include[s]?:?\s*$/i))
    // Match the card's length window so caption + card select the SAME lines.
    // (No character truncation — this only drops sub-8-char noise / >400 junk.)
    .filter((l) => l.length >= 8 && l.length <= 400)
    // Skip CTA questions the AI appends
    .filter((l) => !(l.endsWith("?") && /^(what|which|how|when|do you|have you|can you|drop|comment|follow|save|share|tag)/i.test(l)))
    // Skip lines that are clearly engagement bait / CTAs from the AI
    .filter((l) => !/^(save this|share this|follow for|drop your|comment below|let me know|tag a|like if|double tap)/i.test(l))
    // ── Quiz / answer hygiene — keep these OUT of non-quiz captions so the
    //    caption body matches the card body (which strips the same lines). ──────
    .filter((l) => !/^[A-D][).:]\s/.test(l))                                   // A)/B)/C)/D) options
    .filter((l) => !/^(quiz|question)\s*[:\-]/i.test(l))                        // "Quiz:"/"Question:"
    .filter((l) => !/answer\s+(in\s+(the\s+)?comments?|tomorrow|below|later)/i.test(l)) // "answer in comments/tomorrow"
    .filter((l) => !/^[(\[]?\s*answer\b/i.test(l))                              // "(Answer …)"
    .slice(0, max);
}

function parseOptions(content: string): { letter: string; text: string }[] {
  const lines = content.split("\n").filter((l) => /^[A-D][).:]/.test(l.trim()));
  return lines.slice(0, 4).map((l) => {
    const letter = l.trim()[0];
    const text   = l
      .replace(/^[A-D][).:]?\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/\s*[\(（]?\s*(?:correct(?:\s+answer)?|right answer|answer|✔|✓|★|⭐|←|->|>>|correct!?)\s*[\)）]?\s*/gi, "")
      .trim();
    return { letter, text };
  });
}

/** Strip ANSWER/MECHANISM/MANAGEMENT reveal sections from quiz content */
function stripAnswerSections(content: string): string {
  return content
    .replace(/\n?\s*ANSWER\s*[:\-][^\n]*/gi, "")
    .replace(/\n?\s*CORRECT\s+ANSWER\s*[:\-][^\n]*/gi, "")
    .replace(/\n?\s*MECHANISM\s*[:\-][\s\S]*?(?=\n\s*[A-Z]{3,}|\n\s*$|$)/i, "")
    .replace(/\n?\s*MANAGEMENT\s*[:\-][\s\S]*?(?=\n\s*[A-Z]{3,}|\n\s*$|$)/i, "")
    .trim();
}

// Encoded as Unicode escapes so source file encoding never matters
const LETTER_EMOJI: Record<string, string> = {
  A: "\u{1F150}", // 🅰  🅐
  B: "\u{1F151}", // 🅱  🅑
  C: "\u{1F152}", // 🅲  🅒
  D: "\u{1F153}", // 🅳  🅓
};

// ─ = ─  (BOX DRAWINGS LIGHT HORIZONTAL)
const DIVIDER = "─".repeat(22);

// Common emojis as constants (all Unicode escapes -- encoding-safe)
const E = {
  heart:        "❤️",        // ❤️
  anatomHeart:  "\u{1FAC0}",           // 🫀
  stethoscope:  "\u{1FA7A}",           // 🩺
  pushpin:      "\u{1F4CC}",           // 📌
  floppy:       "\u{1F4BE}",           // 💾
  pointDown:    "\u{1F447}",           // 👇
  hospital:     "\u{1F3E5}",           // 🏥
  muscle:       "\u{1F4AA}",           // 💪
  microscope:   "\u{1F52C}",           // 🔬
  pill:         "\u{1F48A}",           // 💊
  books:        "\u{1F4DA}",           // 📚
  clipboard:    "\u{1F4CB}",           // 📋
  person:       "\u{1F464}",           // 👤
  chartUp:      "\u{1F4C8}",           // 📈
  chartBar:     "\u{1F4CA}",           // 📊
  brain:        "\u{1F9E0}",           // 🧠
  lightning:    "⚡",              // ⚡
  arrows:       "\u{1F504}",           // 🔄
  wavy:         "〰️",        // 〰️
  magnify:      "\u{1F50D}",           // 🔍
  timer:        "⏱️",        // ⏱️
  arrowUp:      "\u{1F53A}",           // 🔺
  noEntry:      "\u{1F6AB}",           // 🚫
  shield:       "\u{1F6E1}️",     // 🛡️
  checkGreen:   "✅",              // ✅
  pointUp:      "\u{1F446}",           // 👆
  arrowRight:   "➡️",        // ➡️
  sparkles:     "✨",              // ✨
  gem:          "\u{1F48E}",           // 💎
  speech:       "\u{1F4AC}",           // 💬
  memo:         "\u{1F4DD}",           // 📝
  clapper:      "\u{1F3AC}",           // 🎬
  cross:        "❌",              // ❌
  scales:       "⚖️",        // ⚖️
  question:     "❓",              // ❓
  thought:      "\u{1F4AD}",           // 💭
  target:       "\u{1F3AF}",           // 🎯
  bulb:         "\u{1F4A1}",           // 💡
  bullet:       "•",              // •
  n1:           "1️⃣",       // 1️⃣
  n2:           "2️⃣",       // 2️⃣
  n3:           "3️⃣",       // 3️⃣
  n4:           "4️⃣",       // 4️⃣
  n5:           "5️⃣",       // 5️⃣
  n6:           "6️⃣",       // 6️⃣
};

// -- Caption builders ---------------------------------------------------------

function educational(hook: string, content: string, cta: string): string {
  // Match the card (parseBullets(content, 10)) so caption + card show the SAME facts.
  const bullets  = parseBullets(content, 10);
  const numbered = [E.n1, E.n2, E.n3, E.n4, E.n5, E.n6];
  const bulletLines = bullets.map((b, i) => `${numbered[i] ?? E.bullet} ${b}`).join("\n\n");
  return [
    `${E.anatomHeart} ${clean(hook) || "Key Insight"}`,
    "",
    DIVIDER,
    "",
    `${E.pushpin} What you need to know:`,
    "",
    bulletLines,
    "",
    DIVIDER,
    "",
    clean(cta) || `${E.floppy} Save this post  -  you'll thank yourself later!`,
    "",
    `${E.pointDown} Drop your questions below  -  I reply to every comment! ${E.heart}`,
    "",
    `${E.heart} Follow @__HANDLE__ for more!`,
  ].join("\n");
}

function extractAnswer(content: string): { answerLine: string; explanation: string } {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const answerIdx = lines.findIndex((l) => /^(answer|correct answer)\s*[:\-]/i.test(l));
  const answerLine = answerIdx >= 0
    ? lines[answerIdx].replace(/^(answer|correct answer)\s*[:\-]\s*/i, "").replace(/\*\*/g, "").trim()
    : "";
  const explanationLines = answerIdx >= 0
    ? lines.slice(answerIdx + 1)
        .filter((l) =>
          !/^[A-D][).:]/i.test(l) &&
          !/(comment|follow|tag|save|share|swipe|quiz #|challenge)/i.test(l) &&
          l.length > 25
        )
        .slice(0, 2)
    : [];
  return { answerLine, explanation: explanationLines.join(" ") };
}

function quiz(hook: string, content: string, cta: string): string {
  const opts    = parseOptions(stripAnswerSections(content));
  const optText = opts.length
    ? opts.map(({ letter, text }) => `${LETTER_EMOJI[letter]} ${text}`).join("\n\n")
    : "";

  return [
    `${E.hospital} CHALLENGE`,
    "",
    `${E.question} ${clean(hook) || "Test your knowledge"}`,
    "",
    optText,
    "",
    DIVIDER,
    "",
    `${E.thought} Comment your answer below!`,
    "",
    clean(cta) || `${E.floppy} Save this for revision | ${E.memo} Tag a colleague to test them!`,
    "",
    `${E.pointDown} Drop your answer  -  A, B, C or D? ${E.anatomHeart}${E.heart}`,
  ].join("\n");
}

function mythFact(hook: string, content: string, cta: string): string {
  const cc = (t: string) => t.replace(/\*\*/g, "").trim();

  const mythMatch = content.match(/MYTH\s*[:\-]\s*([\s\S]+?)(?=\n\s*FACT\s*[:\-]|\n\n\n|$)/i);
  const mythText  = mythMatch
    ? cc(mythMatch[1]).replace(/\n+/g, " ")
    : clean(hook).replace(/\s*FACT\s*[:\-][\s\S]*/i, "").trim();

  const factMatch = content.match(/FACT\s*[:\-]\s*([\s\S]+?)(?=\n\n[A-Z]|\n\n\[|\n\n\n|$)/i);
  const factText  = factMatch
    ? cc(factMatch[1]).replace(/\n+/g, " ")
    : "";

  const afterFact = factMatch
    ? content.slice(content.indexOf(factMatch[0]) + factMatch[0].length)
    : content;

  const evidenceMatch = afterFact.match(/(?:THE\s+)?EVIDENCE\s*[:\-]\s*([\s\S]+?)(?=\n\n[A-Z]|\n\n\[|$)/i);
  let explanationParas: string[] = [];
  if (evidenceMatch) {
    explanationParas = evidenceMatch[1]
      .split(/\n/)
      .map((l) => l.replace(/^[\s\-•◦▪►\-*\d.]+/, "").replace(/\*\*/g, "").trim())
      .filter((l) => l.length > 20)
      .filter((l) => !/^(drop|share|follow|comment|save|like|tag|double tap|let me know|which did)/i.test(l))
      .slice(0, 3);
  } else {
    explanationParas = afterFact
      .split(/\n\n+/)
      .map((p) => p.replace(/\*\*/g, "").replace(/\n/g, " ").trim())
      .filter((p) => p.length > 25)
      .filter((p) => !/^(drop|share|follow|comment|save|like|tag|double tap|let me know|which did)/i.test(p))
      .slice(0, 2);
  }

  const parts: string[] = [];

  parts.push(`${E.scales} MYTH vs FACT`);
  parts.push("");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(`${E.cross} THE MYTH`);
  parts.push(mythText || clean(hook));
  parts.push("");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(`${E.checkGreen} THE FACT`);
  parts.push(factText || "The evidence-based truth challenges this common belief.");

  if (explanationParas.length > 0) {
    parts.push("");
    parts.push(DIVIDER);
    parts.push("");
    parts.push(`${E.microscope} THE EVIDENCE`);
    explanationParas.forEach((p) => parts.push(`${E.bullet} ${p}`));
  }

  parts.push("");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(clean(cta) || `${E.speech} Did this surprise you? Drop a ${E.heart} below!`);
  parts.push("");
  parts.push(`${E.memo} Share this to bust this myth in your network!`);
  parts.push("");
  parts.push(`${E.heart} Follow @__HANDLE__ for more!`);

  return parts.join("\n");
}

function clinicalPearl(hook: string, content: string, cta: string, label = "PRO TIP"): string {
  const parseSectionBullets = (text: string, max = 3): string[] =>
    text
      .split(/\n/)
      .map((l) => l.replace(/^[\s\-•◦▪►\-*\d.]+/, "").replace(/\*\*/g, "").trim())
      .filter((l) => l.length > 10)
      .slice(0, max);

  const evidenceMatch     = content.match(/THE\s+EVIDENCE\s*[:\-]\s*([\s\S]+?)(?=CLINICAL\s+APPLICATION|REMEMBER\s*[:\-]|$)/i);
  const evidenceBullets   = evidenceMatch ? parseSectionBullets(evidenceMatch[1], 3) : [];

  const applicationMatch  = content.match(/CLINICAL\s+APPLICATION\s*[:\-]\s*([\s\S]+?)(?=REMEMBER\s*[:\-]|$)/i);
  const applicationBullets = applicationMatch ? parseSectionBullets(applicationMatch[1], 3) : [];

  const rememberMatch     = content.match(/REMEMBER\s*[:\-]\s*([^\n]+)/i);
  const rememberText      = rememberMatch ? rememberMatch[1].replace(/\*\*/g, "").trim() : "";

  if (evidenceBullets.length === 0 && applicationBullets.length === 0) {
    const bullets  = parseBullets(content, 5);
    const numbered = [E.n1, E.n2, E.n3, E.n4, E.n5];
    const bulletLines = bullets.map((b, i) => `${numbered[i] ?? E.bullet} ${b}`).join("\n\n");
    return [
      `${E.gem} ${label}`,
      "",
      DIVIDER,
      "",
      `${E.sparkles} ${clean(hook)}`,
      "",
      `${E.pushpin} Key points:`,
      "",
      bulletLines,
      "",
      DIVIDER,
      "",
      clean(cta) || `${E.floppy} Save this for later  -  share it with someone who'd find it useful!`,
      "",
      `${E.pointDown} Got something to add? Drop it below! ${E.sparkles}`,
      "",
      `${E.heart} Follow @__HANDLE__ for more!`,
    ].join("\n");
  }

  const parts: string[] = [];

  parts.push(`${E.gem} ${label}`);
  parts.push("");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(`${E.sparkles} ${clean(hook)}`);

  if (evidenceBullets.length > 0) {
    parts.push("");
    parts.push(DIVIDER);
    parts.push("");
    parts.push(`${E.microscope} THE EVIDENCE`);
    evidenceBullets.forEach((b) => parts.push(`${E.bullet} ${b}`));
  }

  if (applicationBullets.length > 0) {
    parts.push("");
    parts.push(DIVIDER);
    parts.push("");
    parts.push(`${E.pushpin} HOW TO APPLY IT`);
    applicationBullets.forEach((b) => parts.push(`${E.bullet} ${b}`));
  }

  if (rememberText) {
    parts.push("");
    parts.push(DIVIDER);
    parts.push("");
    parts.push(`${E.bulb} REMEMBER`);
    parts.push(rememberText);
  }

  parts.push("");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(clean(cta) || `${E.floppy} Save this for later  -  share it with someone who'd find it useful!`);
  parts.push("");
  parts.push(`${E.pointDown} What would you add? Comment below! ${E.sparkles}`);
  parts.push("");
  parts.push(`${E.heart} Follow @__HANDLE__ for more!`);

  return parts.join("\n");
}

function parseCaseSections(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  const cleaned = content
    .replace(/^(?:CASE\s+STUDY|TEACHING\s+CASE)\s*[-– - ][^\n]*\n?/im, "")
    .replace(/^#+\s*[^\n]*\n?/m, "")
    .trim();

  const patterns: Array<[string, RegExp]> = [
    ["PRESENTATION", /(?:PATIENT\s+)?(?:PRESENTATION|CHIEF\s+COMPLAINT|HISTORY|CASE\s+DETAILS?)\s*[:\-–]\s*([\s\S]+?)(?=\n\s*(?:KEY\s+FINDINGS?|ECG\s+FINDINGS?|DIAGNOSIS|CLINICAL\s+FINDINGS?|MANAGEMENT|TREATMENT|OUTCOME|LEARNING)|$)/i],
    ["DIAGNOSIS",    /(?:KEY\s+FINDINGS?|ECG\s+FINDINGS?|DIAGNOSIS|CLINICAL\s+FINDINGS?|INTERPRETATION)\s*[:\-–]\s*([\s\S]+?)(?=\n\s*(?:MANAGEMENT|TREATMENT|PLAN|OUTCOME|RESULT|LEARNING|CONCLUSION)|$)/i],
    ["MANAGEMENT",   /(?:MANAGEMENT|TREATMENT|PLAN)\s*[:\-–]\s*([\s\S]+?)(?=\n\s*(?:OUTCOME|RESULT|LEARNING\s+POINT|LEARNING|CONCLUSION|PEARL)|$)/i],
    ["OUTCOMES",     /(?:OUTCOME|RESULT|LEARNING\s+POINT|LEARNING|CONCLUSION|PEARL)\s*[:\-–]\s*([\s\S]+?)$/i],
  ];

  for (const [key, pattern] of patterns) {
    const m = cleaned.match(pattern);
    if (m) result[key] = m[1].replace(/\*\*/g, "").replace(/[-•◦]\s*/g, "").replace(/\n+/g, " ").trim();
  }

  if (Object.keys(result).length < 2) {
    const lines = parseBullets(content, 4);
    const keys  = ["PRESENTATION", "DIAGNOSIS", "MANAGEMENT", "OUTCOMES"];
    lines.forEach((l, i) => { if (keys[i]) result[keys[i]] = l; });
  }

  return result;
}

function caseStudy(hook: string, content: string, cta: string): string {
  const sections = parseCaseSections(content);
  const sectionEmojis: Record<string, string> = {
    PRESENTATION: E.stethoscope,
    DIAGNOSIS:    E.microscope,
    MANAGEMENT:   E.pill,
    OUTCOMES:     E.books,
  };

  const body = Object.entries(sections)
    .filter(([, text]) => text)
    .map(([key, text]) => `${sectionEmojis[key] || E.pushpin} ${key}\n${text}`)
    .join("\n\n");

  return [
    `${E.clipboard} TEACHING CASE`,
    "",
    `${E.person} ${clean(hook)}`,
    "",
    DIVIDER,
    "",
    body,
    "",
    DIVIDER,
    "",
    clean(cta) || `${E.floppy} Save this. Quiz a friend!`,
    "",
    `${E.pointDown} What would YOU have done differently? Comment below! ${E.brain}`,
    "",
    `${E.heart} Follow @__HANDLE__ for more!`,
  ].join("\n");
}

function parseEcgCase(content: string): { caseInfo: string; ecgFindings: string[] } {
  const caseMatch = content.match(
    /CASE(?:\s*DETAILS?)?\s*[:\-]\s*([\s\S]+?)(?=ECG\s*FINDINGS?|[A-D][).:]\s|\bQUESTION\b|$)/i
  );
  const caseInfo = caseMatch
    ? caseMatch[1].replace(/\*\*/g, "").replace(/\n+/g, " ").replace(/[-•◦]\s*/g, "").trim()
    : "";

  const ecgMatch = content.match(
    /ECG\s*FINDINGS?\s*[:\-]\s*([\s\S]+?)(?=[A-D][).:]\s|\bQUESTION\b|\bANSWER\b|$)/i
  );
  let ecgFindings: string[] = [];
  if (ecgMatch) {
    ecgFindings = ecgMatch[1]
      .replace(/\*\*/g, "")
      .split(/[,\n•◦\-]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3)
      .slice(0, 5);
  }
  return { caseInfo, ecgFindings };
}

/** Assign a visual emoji prefix to each ECG finding label */
function ecgFindingEmoji(finding: string): string {
  const f = finding.toLowerCase();
  if (/rate|bpm|hr\b/.test(f))                      return E.lightning;
  if (/rhythm/.test(f))                             return E.arrows;
  if (/p.wave|p-wave/.test(f))                      return E.wavy;
  if (/qrs/.test(f))                                return E.chartBar;
  if (/qt\b|qtc/.test(f))                           return E.timer;
  if (/axis/.test(f))                               return E.magnify;
  if (/st.seg|st-seg|st elev|st dep/.test(f))       return E.arrowUp;
  if (/t.wave|t-wave/.test(f))                      return E.wavy;
  if (/block|bundle/.test(f))                       return E.noEntry;
  if (/hypertrophy|lvh|rvh/.test(f))                return E.muscle;
  return E.bullet;
}

function ecgQuiz(hook: string, content: string, cta: string, label = "KNOWLEDGE QUIZ"): string {
  const stripped = stripAnswerSections(content);
  const opts     = parseOptions(stripped);
  const { caseInfo, ecgFindings } = parseEcgCase(stripped);

  const LETTER_BOX: Record<string, string> = {
    A: "\u{1F150}", B: "\u{1F151}", C: "\u{1F152}", D: "\u{1F153}",
  };

  const parts: string[] = [];

  // -- Header ----------------------------------------------------------------
  parts.push(`${E.chartUp} ${label}  -  Can you crack this one? ${E.brain}`);
  parts.push("");
  parts.push(DIVIDER);

  // -- Case ------------------------------------------------------------------
  if (caseInfo) {
    parts.push("");
    parts.push(`${E.stethoscope} THE CASE`);
    parts.push(caseInfo);
  }

  // -- ECG Findings ----------------------------------------------------------
  if (ecgFindings.length > 0) {
    parts.push("");
    parts.push(DIVIDER);
    parts.push("");
    parts.push(`${E.chartBar} THE FINDINGS`);
    ecgFindings.forEach((f) => {
      parts.push(`${ecgFindingEmoji(f)} ${f}`);
    });
  }

  // -- Question --------------------------------------------------------------
  parts.push("");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(`${E.question} WHAT'S THE ANSWER?`);
  parts.push("");

  if (opts.length > 0) {
    opts.forEach(({ letter, text }) => {
      parts.push(`${LETTER_BOX[letter] ?? letter} ${text}`);
      parts.push("");
    });
  } else {
    ["A", "B", "C", "D"].forEach((l) => {
      parts.push(`${LETTER_BOX[l]}  - `);
      parts.push("");
    });
  }

  // -- CTA -------------------------------------------------------------------
  parts.push(DIVIDER);
  parts.push("");
  parts.push(`${E.speech} Drop your answer  -  A, B, C or D below!`);
  parts.push(`${E.pointDown} I reveal the full explanation in the comments ${E.sparkles}`);
  parts.push("");
  parts.push(clean(cta) || `${E.floppy} Save this for later! Share it with a friend`);
  parts.push("");
  parts.push(`${E.heart} Follow @__HANDLE__ for more!`);

  return parts.join("\n");
}

function angiographyQuiz(hook: string, content: string, cta: string, label = "IMAGE QUIZ"): string {
  const stripped = stripAnswerSections(content);
  const opts     = parseOptions(stripped);
  const LETTER_BOX: Record<string, string> = {
    A: "\u{1F150}", B: "\u{1F151}", C: "\u{1F152}", D: "\u{1F153}",
  };

  const caseMatch = stripped.match(/CASE\s*[:\-]\s*([\s\S]+?)(?=ANGIOGRAPHIC|[A-D][).:]|\bQUESTION\b|$)/i);
  const caseInfo  = caseMatch
    ? caseMatch[1].replace(/\*\*/g, "").replace(/\n+/g, " ").trim()
    : "";

  const findingsMatch = stripped.match(/ANGIOGRAPHIC\s*FINDINGS?\s*[:\-]\s*([\s\S]+?)(?=[A-D][).:]|\bQUESTION\b|$)/i);
  const angiFindings: string[] = findingsMatch
    ? findingsMatch[1]
        .split(/[\n•\-]+/)
        .map((s) => s.replace(/\*\*/g, "").trim())
        .filter((s) => s.length > 4)
        .slice(0, 4)
    : [];

  const parts: string[] = [];

  parts.push(`${E.sparkles} ${label}`);
  parts.push("");
  parts.push(DIVIDER);

  if (caseInfo) {
    parts.push("");
    parts.push(`${E.pushpin} THE SETUP`);
    parts.push(caseInfo);
  }

  if (angiFindings.length > 0) {
    parts.push("");
    parts.push(DIVIDER);
    parts.push("");
    parts.push(`${E.microscope} THE FINDINGS`);
    angiFindings.forEach((f) => parts.push(`${E.bullet} ${f}`));
  }

  parts.push("");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(`${E.question} ${clean(hook) || "What's your answer?"}`);
  parts.push("");
  opts.forEach(({ letter, text }) => {
    parts.push(`${LETTER_BOX[letter] ?? letter} ${text}`);
    parts.push("");
  });

  parts.push(DIVIDER);
  parts.push("");
  parts.push(`${E.speech} Comment your answer  -  A, B, C or D!`);
  parts.push(`${E.pointDown} Tag a friend  -  can they crack it? ${E.sparkles}`);
  parts.push("");
  parts.push(clean(cta) || `${E.floppy} Save for later! I reveal the answer in the comments`);
  parts.push("");
  parts.push(`${E.heart} Follow @__HANDLE__ for more!`);

  return parts.join("\n");
}

function preventive(hook: string, content: string, cta: string): string {
  const tips     = parseBullets(content, 6);
  const numbered = [E.n1, E.n2, E.n3, E.n4, E.n5, E.n6];
  const tipLines = tips.map((t, i) => `${numbered[i] ?? E.bullet} ${t}`).join("\n\n");
  return [
    `${E.shield} ${clean(hook) || "Start Here"}`,
    "",
    DIVIDER,
    "",
    `${E.checkGreen} Start these habits TODAY:`,
    "",
    tipLines,
    "",
    DIVIDER,
    "",
    `${E.heart} You'll thank yourself for starting NOW!`,
    "",
    clean(cta) || `${E.floppy} Save this. Share it with someone you love!`,
    "",
    `${E.pointDown} Which tip are you starting today? Comment below!`,
    "",
    `${E.heart} Follow @__HANDLE__ for more!`,
  ].join("\n");
}

function ctaPost(hook: string, content: string, ctaText: string): string {
  const bullets = parseBullets(content, 4);
  const bulletLines = bullets.map((b) => `${E.bullet} ${b}`).join("\n\n");
  return [
    `${E.heart} ${clean(hook) || "If this helped you, share it!"}`,
    "",
    bulletLines,
    "",
    DIVIDER,
    "",
    clean(ctaText) || `${E.speech} Comment below & ${E.memo} Follow for more!`,
    "",
    `${E.memo} Share this with someone who'd find it useful ${E.anatomHeart}`,
  ].join("\n");
}

function reel(hook: string, content: string, reelScript: string | null | undefined, ctaText: string): string {
  const script = reelScript
    ? clean(reelScript)
    : parseBullets(content, 4).join(`\n${E.bullet} `);
  return [
    `${E.clapper} ${clean(hook)}`,
    "",
    script,
    "",
    DIVIDER,
    "",
    clean(ctaText) || `${E.floppy} Save this reel! Drop any questions below ${E.pointDown}`,
    "",
    `${E.heart} Follow @__HANDLE__ for more!`,
  ].join("\n");
}

function carousel(hook: string, content: string, cta: string): string {
  const bullets = parseBullets(content, 6);
  const bulletLines = bullets.map((b) => `${E.bullet} ${b}`).join("\n\n");
  return [
    `${E.pointUp} SWIPE to learn everything ${E.arrowRight}`,
    "",
    `${E.sparkles} ${clean(hook)}`,
    "",
    bulletLines,
    "",
    DIVIDER,
    "",
    clean(cta) || `${E.floppy} Save this post  -  you'll want to come back to it!`,
    "",
    `${E.pointDown} Which slide surprised you most? Comment below! ${E.heart}`,
  ].join("\n");
}

// -- Main export --------------------------------------------------------------

export interface CaptionInput {
  postType:   string;
  title:      string;
  hook:       string | null;
  content:    string;
  cta:        string | null;
  reelScript: string | null | undefined;
  hashtags:   string[];
}

/**
 * Builds a beautiful, type-specific Instagram caption.
 * Returns the caption string (body + blank line + hashtags).
 */
export function buildBeautifulCaption(input: CaptionInput, brand?: BrandConfig): string {
  const { postType, hook, content, cta: ctaText, reelScript, hashtags } = input;
  const h   = hook    ?? "";
  const ct  = ctaText ?? "";
  // White-label: the caption's type header is the user's RENAMEABLE label, not a
  // hardcoded niche word. Falls back to a neutral label when no brand is supplied.
  const label = (brand ? typeLabel(brand, postType) : NEUTRAL_TYPE_LABEL[postType] || "Post").toUpperCase();

  let body: string;
  switch (postType) {
    case "EDUCATIONAL":      body = educational(h, content, ct);              break;
    case "QUIZ":             body = quiz(h, content, ct);                     break;
    case "MYTH_FACT":        body = mythFact(h, content, ct);                 break;
    case "CLINICAL_PEARL":   body = clinicalPearl(h, content, ct, label);     break;
    case "CASE_STUDY":       body = caseStudy(h, content, ct);                break;
    case "ECG_QUIZ":         body = ecgQuiz(h, content, ct, label);           break;
    case "ANGIOGRAPHY_QUIZ": body = angiographyQuiz(h, content, ct, label);   break;
    case "PREVENTIVE":       body = preventive(h, content, ct);               break;
    case "CTA":              body = ctaPost(h, content, ct);                  break;
    case "REEL":             body = reel(h, content, reelScript, ct);         break;
    case "CAROUSEL":         body = carousel(h, content, ct);                  break;
    default:                 body = educational(h, content, ct);               break;
  }

  const hashtagStr = hashtags.filter(Boolean).join(" ");
  const full = hashtagStr ? `${body}\n\n${hashtagStr}` : body;
  return applyBrand(full, brand);
}
