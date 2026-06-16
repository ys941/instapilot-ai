/**
 * lib/postTypeImageGenerator.ts
 *
 * Server-side Satori renderer for ALL post types.
 * Matches the exact visual card designs in PostVisualCard.tsx.
 * Output: 1080x1080 JPEG buffer.
 *
 * Post types handled:
 *   EDUCATIONAL, QUIZ, MYTH_FACT, CLINICAL_PEARL, CASE_STUDY,
 *   ECG_QUIZ, ANGIOGRAPHY_QUIZ, PREVENTIVE, CTA, REEL
 */

import satori from "satori";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { getBrand } from "@/lib/preferences";
import { atHandle } from "@/lib/brandConfig";

// -- Theme system: 12 distinct card backgrounds, randomly selected per render --
interface CardTheme {
  bg:        string;   // main card background
  bg2:       string;   // secondary background (carousel, nav)
  accent:    string;   // primary accent  (replaces RED)
  accent2:   string;   // secondary accent (replaces ORANGE)
  accent3:   string;   // tertiary accent  (replaces GOLD)
  gradStart: string;   // gradient bar colour 1
  gradMid:   string;   // gradient bar colour 2
  gradEnd:   string;   // gradient bar colour 3
}

const THEMES: readonly CardTheme[] = [
  // 1. Cardinal (classic dark navy + red/orange/gold)
  { bg: "#0c0f1a", bg2: "#0d1420", accent: "#e63946", accent2: "#ff6b35", accent3: "#ffa500", gradStart: "#e63946", gradMid: "#ff6b35", gradEnd: "#ffa500" },
  // 2. Royal Violet (dark purple base)
  { bg: "#0e0a1e", bg2: "#130c28", accent: "#9b5de5", accent2: "#c77dff", accent3: "#e0aaff", gradStart: "#7b2ff7", gradMid: "#9b5de5", gradEnd: "#e0aaff" },
  // 3. Deep Ocean (midnight blue + electric cyan)
  { bg: "#060e1f", bg2: "#091628", accent: "#0ea5e9", accent2: "#38bdf8", accent3: "#67e8f9", gradStart: "#0284c7", gradMid: "#0ea5e9", gradEnd: "#67e8f9" },
  // 4. Emerald Night (very dark green + neon green)
  { bg: "#071a0e", bg2: "#0d2418", accent: "#22c55e", accent2: "#4ade80", accent3: "#a3e635", gradStart: "#16a34a", gradMid: "#22c55e", gradEnd: "#a3e635" },
  // 5. Crimson Forge (dark maroon + hot red/amber)
  { bg: "#140606", bg2: "#1e0a0a", accent: "#ef233c", accent2: "#f77f00", accent3: "#fcbf49", gradStart: "#d62828", gradMid: "#ef233c", gradEnd: "#fcbf49" },
  // 6. Midnight Teal (near-black + teal/aqua)
  { bg: "#051a18", bg2: "#092422", accent: "#14b8a6", accent2: "#2dd4bf", accent3: "#a5f3fc", gradStart: "#0d9488", gradMid: "#14b8a6", gradEnd: "#a5f3fc" },
  // 7. Indigo Storm (deep indigo + periwinkle/lavender)
  { bg: "#080c2a", bg2: "#0d1040", accent: "#6366f1", accent2: "#818cf8", accent3: "#c7d2fe", gradStart: "#4f46e5", gradMid: "#6366f1", gradEnd: "#c7d2fe" },
  // 8. Amber Forge (near-black brown + amber/gold)
  { bg: "#1a1205", bg2: "#241800", accent: "#f59e0b", accent2: "#fbbf24", accent3: "#fde68a", gradStart: "#d97706", gradMid: "#f59e0b", gradEnd: "#fde68a" },
  // 9. Magenta Pulse (dark purple-pink + pink/rose)
  { bg: "#1a0818", bg2: "#240c22", accent: "#ec4899", accent2: "#f472b6", accent3: "#fbcfe8", gradStart: "#be185d", gradMid: "#ec4899", gradEnd: "#fbcfe8" },
  // 10. Arctic Chrome (dark slate + silver/ice)
  { bg: "#0a0f1a", bg2: "#0f1520", accent: "#94a3b8", accent2: "#cbd5e1", accent3: "#e2e8f0", gradStart: "#475569", gradMid: "#94a3b8", gradEnd: "#e2e8f0" },
  // 11. Solar Flare (near-black + deep orange/fire)
  { bg: "#160a03", bg2: "#200e05", accent: "#ea580c", accent2: "#f97316", accent3: "#fed7aa", gradStart: "#c2410c", gradMid: "#ea580c", gradEnd: "#fed7aa" },
  // 12. Jade Dynasty (very dark forest + jade/mint)
  { bg: "#051410", bg2: "#0a201a", accent: "#10b981", accent2: "#34d399", accent3: "#6ee7b7", gradStart: "#059669", gradMid: "#10b981", gradEnd: "#6ee7b7" },
];

// -- Active theme  -  set at the start of each renderPostToJpeg call -------------
// (module-level lets so all builder functions pick up the active theme)
let BG_DARK  = THEMES[0].bg;
let BG_NAVY  = THEMES[0].bg2;
let RED      = THEMES[0].accent;
let ORANGE   = THEMES[0].accent2;
let GOLD     = THEMES[0].accent3;
// Gradient string used in top/bottom bars and decorative stripes
let GRAD     = `linear-gradient(90deg, ${THEMES[0].gradStart}, ${THEMES[0].gradMid}, ${THEMES[0].gradEnd})`;
// BODY_TXT stays constant  -  always full-brightness white for max readability on all dark themes
const BODY_TXT = "#ffffff";

// -- Active brand identity  -  set at the start of each renderPostToJpeg call ----
// HANDLE = "@handle" (watermark); HANDLE_PLAIN = "handle" (top-right corner label).
let HANDLE       = "this account";
let HANDLE_PLAIN = "";
let EYEBROW      = "EDUCATIONAL";          // generic neutral eyebrow above title cards
let COVER_TITLE_FALLBACK = "Insights";     // carousel cover fallback

// -- Font cache ----------------------------------------------------------------
let _fontBold:    ArrayBuffer | null = null;
let _fontRegular: ArrayBuffer | null = null;

/** Read a local file and return a proper ArrayBuffer (handles Node buffer pool slicing). */
function readFontFile(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath);
  // buf.buffer may be a shared pool  -  slice to the exact range
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function loadFonts() {
  if (_fontBold && _fontRegular) return { bold: _fontBold, regular: _fontRegular };

  // 1. Try local WOFF files first (fastest, no network, Satori-compatible)
  //    Note: Satori does NOT support WOFF2  -  always use WOFF or TTF/OTF
  const boldPath    = path.join(process.cwd(), "public", "fonts", "Inter-Bold.woff");
  const regularPath = path.join(process.cwd(), "public", "fonts", "Inter-Regular.woff");

  if (fs.existsSync(boldPath) && fs.existsSync(regularPath)) {
    _fontBold    = readFontFile(boldPath);
    _fontRegular = readFontFile(regularPath);
    console.log("[PostTypeGen] Loaded fonts from public/fonts/");
    return { bold: _fontBold, regular: _fontRegular };
  }

  // 2. Fallback: fetch WOFF from jsDelivr CDN
  //    (Google Fonts static URLs return 404; gstatic woff2 not supported by Satori)
  console.log("[PostTypeGen] Local fonts not found  -  fetching from jsDelivr CDN...");
  const [boldRes, regularRes] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.18/files/inter-latin-700-normal.woff"),
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.18/files/inter-latin-400-normal.woff"),
  ]);
  _fontBold    = await boldRes.arrayBuffer();
  _fontRegular = await regularRes.arrayBuffer();
  return { bold: _fontBold, regular: _fontRegular };
}

// -- Satori render helper ------------------------------------------------------
async function renderToSvg(element: object): Promise<string> {
  const { bold, regular } = await loadFonts();
  return satori(element as Parameters<typeof satori>[0], {
    width: 1080,
    height: 1080,
    fonts: [
      { name: "Inter", data: bold,    weight: 700, style: "normal" },
      { name: "Inter", data: regular, weight: 400, style: "normal" },
    ],
  });
}
async function renderToJpeg(element: object): Promise<Buffer> {
  const svg = await renderToSvg(element);
  // High JPEG quality so text stays CRISP — the Short re-encodes this card again
  // (card → MP4 frame), so a soft source compounds into blurry on-screen text.
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

// -- Helpers -------------------------------------------------------------------
function cleanText(t: string): string {
  // Strip markdown bold, strip leading bullet symbols, then strip numbered-list prefix (e.g. "1. " or "1) ")
  // IMPORTANT: do NOT strip bare leading digits  -  "30 minutes" must stay "30 minutes"
  return (t ?? "")
    .replace(/\*\*/g, "")
    .replace(/^[\s•●▪►'\-*]+/, "")   // strip bullet/dash chars
    .replace(/^\d+[).]\s*/, "")        // strip "1. " or "1) " list prefix only
    .trim();
}

function stripAnswerSections(content: string): string {
  return content
    .replace(/\n?\s*ANSWER\s*[:\-][^\n]*/gi, "")
    .replace(/\n?\s*CORRECT\s+ANSWER\s*[:\-][^\n]*/gi, "")
    .replace(/\n?\s*MECHANISM\s*[:\-][\s\S]*?(?=\n\s*[A-Z]{3,}|\n\s*$|$)/i, "")
    .replace(/\n?\s*MANAGEMENT\s*[:\-][\s\S]*?(?=\n\s*[A-Z]{3,}|\n\s*$|$)/i, "")
    .trim();
}

function parseOptions(content: string): string[] {
  const safe  = stripAnswerSections(content);
  const lines = safe.split("\n").filter((l) => l.trim());
  const opts  = lines.filter((l) => /^[A-D][).:]/.test(l.trim())).slice(0, 4);
  return opts.map((l) =>
    l.replace(/^[A-D][).:]?\s*/, "")
     .replace(/\*\*/g, "")
     // Strip any answer markers the AI may sneak onto an option
     .replace(/\s*[\(（]?\s*(?:correct(?:\s+answer)?|right answer|answer|✔|✓|★|⭐|←|->|>>|correct!?)\s*[\)）]?\s*/gi, "")
     .trim()
  );
}

// Common filters applied to candidate bullet lines
function bulletQualityFilters(lines: string[]): string[] {
  return lines
    .map(cleanText)
    .filter(Boolean)
    .filter((l) => !l.endsWith(":") && !l.match(/include[s]?:?\s*$/i))
    // Quality filter only — keep short noise out and very long junk out, but raise
    // the upper bound generously so a long clinical fact is never silently dropped.
    // The renderer (numberedRow/letterRow/etc.) auto-shrinks the font to fit long text.
    .filter((l) => l.length >= 8)   // no upper cap — long lines auto-shrink to fit (no truncation)
    .filter((l) => !/\breports?\s+that\b|\bstudies?\s+show\b|\baccording\s+to\b|\bevery\s+minute\b/i.test(l))
    .filter((l) => !(l.endsWith("?") && /^(what|which|how|when|do you|have you|can you|drop|comment|follow|save|share|tag)/i.test(l)))
    .filter((l) => !/^(save this|share this|follow for|drop your|comment below|let me know|tag a|like if)/i.test(l))
    .filter((l) => !/^(CLINICAL\s+PEARL|EDUCATIONAL|PREVENTIVE|MYTH\s+VS?\s+FACT|CASE\s+STUDY|ECG\s+QUIZ|ANGIOGRAPHY\s+QUIZ|CARDIOLOGY\s+CHALLENGE|REEL|CTA)\b/i.test(l))
    .filter((l) => !/^(THE\s+EVIDENCE|CLINICAL\s+APPLICATION|REMEMBER|KEY\s+POINTS?|SUMMARY|OVERVIEW|INTRODUCTION)\s*[:\-–]/i.test(l))
    // ── Quiz / answer / CTA hygiene — these belong only on QUIZ-type cards ──────
    // Drop A)/B)/C)/D) option lines so quiz content never leaks onto an
    // educational/preventive/pearl/carousel card as numbered points.
    .filter((l) => !/^[A-D][).:]\s/.test(l))
    // Drop "Quiz:" / "Question:" lead-ins
    .filter((l) => !/^(quiz|question)\s*[:\-]/i.test(l))
    // Drop "answer in comments / tomorrow / below" reveal lines and "(Answer …)"
    .filter((l) => !/answer\s+(in\s+(the\s+)?comments?|tomorrow|below|later)/i.test(l))
    .filter((l) => !/^[(\[]?\s*answer\b/i.test(l))
    // Drop additional engagement-bait CTA variants
    .filter((l) => !/^(comment (your|a|below|the)|drop a|double[\s-]?tap|swipe|dm (us|me)|link in bio|tag your|test your team|share this)/i.test(l));
}

/**
 * Extract bullet points from content.
 *
 * Strategy (tried in order until we have ≥2 results):
 *   1. Newline-split lines (AI formatted correctly)
 *   2. Emoji / dash / bullet-prefixed sentences within prose
 *   3. Ordinal / numbered extraction from prose
 *      ("First, ...", "1.", "1)", "Step 1", etc.)
 *   4. Sentence-split fallback — short sentences 20–160 chars
 */
function parseBullets(content: string, max = 5): string[] {
  // ── Strategy 1: newline-separated lines (standard format) ──────────────────
  const byNewline = bulletQualityFilters(content.split("\n").filter((l) => l.trim()));
  if (byNewline.length >= 2) return byNewline.slice(0, max);

  // ── Strategy 2: emoji / bullet marker split within a single-line string ──────
  // Handles: "• point1 • point2", "1️⃣ point1 2️⃣ point2", "→ A → B"
  // Split on bullet markers that appear mid-string
  const bulletSplitRe = /\s*[•►→✅✔🔹🔸⚡💡🫀🩺⚠️]\s*/u;
  const emojiParts = content.split(bulletSplitRe).filter((p) => p.trim().length > 8);
  const byEmoji = bulletQualityFilters(emojiParts);
  if (byEmoji.length >= 2) return byEmoji.slice(0, max);

  // ── Strategy 3: ordinal / numbered extraction from prose ────────────────────
  // Handles: "First,", "Second,", "1.", "1)", "Step 1:", "Pillar 1:"
  const ordinalRe = /(?:^|\.\s+|\n)(?:First[,:]|Second[,:]|Third[,:]|Fourth[,:]|Fifth[,:]|Sixth[,:]|Seventh[,:]|Eighth[,:]|Ninth[,:]|Tenth[,:]|\d+[.)]\s+|Step\s+\d+[:\s]|Pillar\s+\d+[:\s]|Point\s+\d+[:\s])([^.!?\n]{15,200}[.!]?)/gi;
  const ordinalMatches: string[] = [];
  for (const m of content.matchAll(ordinalRe)) {
    const t = m[1]?.trim();
    if (t) ordinalMatches.push(t);
  }
  const byOrdinal = bulletQualityFilters(ordinalMatches);
  if (byOrdinal.length >= 2) return byOrdinal.slice(0, max);

  // ── Strategy 4: sentence-split fallback ─────────────────────────────────────
  // Split on ". " or "! " boundaries, keep sentences 20–160 chars
  const bySentence = bulletQualityFilters(
    content
      .split(/(?<=[.!])\s+/)
      .map((s) => s.replace(/^[^a-zA-Z0-9]+/, "").trim())
      .filter((s) => s.length >= 20 && s.length <= 160)
  );
  return bySentence.slice(0, max);
}

// -- Concentric circles SVG (quiz card background decoration) -----------------
function buildConcentricCirclesSvg(): object {
  const circles = [100, 180, 260, 340, 420, 500, 580, 660].map((r) => ({
    type: "circle",
    props: { cx: "540", cy: "540", r: String(r), fill: "none", stroke: RED, strokeWidth: "1", opacity: "0.10" },
  }));
  return {
    type: "svg",
    props: {
      viewBox: "0 0 1080 1080",
      style: { position: "absolute", top: 0, left: 0, width: "1080px", height: "1080px" },
      children: circles,
    },
  };
}

// -- ECG polyline path ---------------------------------------------------------
function buildEcgStripSvg(): object {
  const points = "0,66 66,66 90,66 102,18 114,114 126,66 180,66 264,66 288,66 300,12 312,120 324,66 378,66 462,66 486,66 498,9 510,117 522,66 576,66 672,66 696,66 708,18 720,114 732,66 786,66 900,66 1080,66";
  return {
    type: "svg",
    props: {
      viewBox: "0 0 1080 132",
      style: { width: "1080px", height: "132px", position: "absolute", top: 0, left: 0 },
      children: [
        ...[1,2,3,4,5].map((i) => ({
          type: "line",
          props: { x1: String(i * 180), y1: "0", x2: String(i * 180), y2: "132", stroke: `${RED}30`, strokeWidth: "1" },
        })),
        ...[1,2].map((i) => ({
          type: "line",
          props: { x1: "0", y1: String(i * 44), x2: "1080", y2: String(i * 44), stroke: `${RED}30`, strokeWidth: "1" },
        })),
        {
          type: "polyline",
          props: { points, fill: "none", stroke: RED, strokeWidth: "5", strokeLinecap: "round", strokeLinejoin: "round" },
        },
      ],
    },
  };
}

// -- Gold divider header ( ECG CHALLENGE style) -----------------------------
function goldHeader(label: string): object {
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "20px", marginBottom: "20px" },
      children: [
        { type: "div", props: { style: { height: "2px", width: "80px", background: `${GOLD}50` } } },
        { type: "div", props: { style: { color: GOLD, fontSize: "30px", fontWeight: "700", letterSpacing: "6px", textTransform: "uppercase" as const }, children: label } },
        { type: "div", props: { style: { height: "2px", width: "80px", background: `${GOLD}50` } } },
      ],
    },
  };
}

// -- Answer option row (A/B/C/D) -----------------------------------------------
function optionRow(letter: string, text: string): object {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "24px",
        padding: "20px 28px",
        background: "rgba(255,255,255,0.13)",   // was 0.05  -  needs to stand out on any dark theme
        border: `1.5px solid ${RED}55`,          // accent-coloured border instead of near-invisible white
        borderRadius: "14px",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "60px", height: "60px", borderRadius: "10px",
              background: `${RED}33`,             // accent tint badge  -  always visible
              border: `2px solid ${RED}88`,
              flexShrink: "0",
            },
            children: { type: "div", props: { style: { color: RED, fontSize: "28px", fontWeight: "800" }, children: letter } },
          },
        },
        { type: "div", props: { style: { color: "#ffffff", fontSize: "30px", lineHeight: "1.4", fontWeight: "500" }, children: text || `Option ${letter}` } },
      ],
    },
  };
}

// -- Background SVG corner decorations ----------------------------------------
function cornerDecorations(): object {
  return {
    type: "svg",
    props: {
      viewBox: "0 0 1080 1080",
      style: { position: "absolute", top: 0, left: 0, width: "1080px", height: "1080px" },
      children: [
        // Top-right rings (bleeding off canvas)
        { type: "circle", props: { cx: "1100", cy: "-30", r: "340", fill: "none", stroke: `${RED}14`, strokeWidth: "1.5" } },
        { type: "circle", props: { cx: "1100", cy: "-30", r: "230", fill: "none", stroke: `${RED}10`, strokeWidth: "1" } },
        { type: "circle", props: { cx: "1100", cy: "-30", r: "140", fill: "none", stroke: `${ORANGE}10`, strokeWidth: "1" } },
        // Bottom-left rings
        { type: "circle", props: { cx: "-20",   cy: "1110", r: "280", fill: "none", stroke: `${GOLD}12`, strokeWidth: "1.5" } },
        { type: "circle", props: { cx: "-20",   cy: "1110", r: "180", fill: "none", stroke: `${GOLD}08`, strokeWidth: "1" } },
      ],
    },
  };
}

// -- Gradient top + bottom bars ------------------------------------------------
function gradientBar(pos: "top" | "bottom"): object {
  return { type: "div", props: { style: { [pos === "top" ? "marginBottom" : "marginTop"]: "auto", height: "8px", backgroundImage: GRAD, flexShrink: 0, width: "1080px" } } };
}

// -- New base card: gradient bars + corner rings, no left stripe ---------------
function richCard(bg: string, children: object[]): object {
  return {
    type: "div",
    props: {
      style: { width: "1080px", height: "1080px", background: bg, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Inter", position: "relative" },
      children: [
        // Top gradient bar
        { type: "div", props: { style: { height: "8px", backgroundImage: GRAD, flexShrink: 0 } } },
        // Corner decorations (absolute SVG)
        cornerDecorations(),
        // Content
        { type: "div", props: { style: { flex: 1, display: "flex", flexDirection: "column", padding: "44px 62px 36px 62px" }, children } },
        // Bottom gradient bar
        { type: "div", props: { style: { height: "8px", backgroundImage: GRAD, flexShrink: 0 } } },
      ],
    },
  };
}

// -- Left accent stripe + top/bottom bars (BaseCard frame)  -  kept for quiz types
function wrapBaseCard(bg: string, children: object[]): object {
  return {
    type: "div",
    props: {
      style: { width: "1080px", height: "1080px", background: bg, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Inter" },
      children: [
        { type: "div", props: { style: { position: "absolute", top: 0, left: 0, right: 0, height: "8px", backgroundImage: GRAD } } },
        { type: "div", props: { style: { position: "absolute", bottom: 0, left: 0, right: 0, height: "8px", backgroundImage: GRAD } } },
        { type: "div", props: { style: { position: "absolute", top: 0, left: 0, bottom: 0, width: "18px", background: RED } } },
        {
          type: "div",
          props: {
            style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", padding: "60px 56px 60px 56px" },
            children,
          },
        },
      ],
    },
  };
}

// -- Watermark -----------------------------------------------------------------
function watermark(): object {
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "center", gap: "14px", paddingTop: "18px" },
      children: [
        { type: "div", props: { style: { height: "1px", flex: "1", background: "rgba(255,255,255,0.08)" } } },
        { type: "div", props: { style: { color: RED, fontSize: "20px" }, children: "♥" } },
        { type: "div", props: { style: { color: `${RED}70`, fontSize: "20px", fontWeight: "700", letterSpacing: "3px" }, children: HANDLE } },
        { type: "div", props: { style: { height: "1px", flex: "1", background: "rgba(255,255,255,0.08)" } } },
      ],
    },
  };
}

// -- Title glassmorphism card --------------------------------------------------
function titleCard(subLabel: string, title: string, titleFontSize: string, compact = false): object {
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: "18px", padding: compact ? "16px 28px" : "26px 34px", marginBottom: compact ? "14px" : "22px" },
      children: [
        { type: "div", props: { style: { fontSize: "16px", fontWeight: "700", color: ORANGE, letterSpacing: "3px", marginBottom: "12px" }, children: subLabel } },
        { type: "div", props: { style: { color: "white", fontSize: titleFontSize, fontWeight: "700", lineHeight: "1.22" }, children: title } },
        { type: "div", props: { style: { display: "flex", marginTop: "14px", height: "3px", width: "70px", borderRadius: "2px", backgroundImage: GRAD } } },
      ],
    },
  };
}

// -- Numbered row card ---------------------------------------------------------
// size: "normal" (≤5 rows) | "compact" (6-7 rows) | "mini" (8-10 rows)
function numberedRow(num: number, text: string, size: "normal" | "compact" | "mini" = "normal"): object {
  const label = text;
  const mini    = size === "mini";
  const compact = size === "compact" || mini;

  // Auto-shrink long lines to fit WITHOUT going illegible: every tier bottoms out at
  // a 16px readability FLOOR. (The card is downscaled into 720p video + re-encoded, so
  // anything smaller turns to mush.) We prefer a slightly-smaller-but-readable size
  // over dropping data — full content still shows, just at the floor when very long.
  const FLOOR = "16px";
  const fontSize = mini
    ? (label.length > 120 ? FLOOR : label.length > 80 ? "18px" : "20px")
    : compact
    ? (label.length > 140 ? "18px" : label.length > 100 ? "20px" : label.length > 70 ? "22px" : "24px")
    : (label.length > 210 ? "17px" : label.length > 160 ? "20px" : label.length > 110 ? "23px" : label.length > 80 ? "25px" : "28px");

  const padding    = mini ? "5px 14px" : compact ? "8px 20px" : "11px 24px";
  const gap        = mini ? "10px"     : compact ? "14px"     : "18px";
  const badgeSize  = mini ? "30px"     : compact ? "36px"     : "46px";
  const badgeFontSize = mini ? "14px"  : compact ? "17px"     : "22px";

  return {
    type: "div",
    props: {
      style: { display: "flex", borderRadius: "12px", overflow: "hidden", background: "rgba(255,255,255,0.13)", border: "1.5px solid rgba(255,255,255,0.20)", flex: "1" },
      children: [
        { type: "div", props: { style: { width: "5px", background: RED, flexShrink: 0 } } },
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap, padding, flex: 1 },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", justifyContent: "center", width: badgeSize, height: badgeSize, borderRadius: "50%", background: `${RED}22`, border: `1.5px solid ${RED}55`, flexShrink: 0 },
                  children: { type: "div", props: { style: { color: RED, fontSize: badgeFontSize, fontWeight: "700" }, children: String(num) } },
                },
              },
              { type: "div", props: { style: { color: BODY_TXT, fontSize, lineHeight: "1.38", flex: "1" }, children: label } },
            ],
          },
        },
      ],
    },
  };
}

// -- Bullet point (plain dot  -  for myth-fact, case-study) ---------------------
function bullet(text: string, fontSize = "28px"): object {
  const label = text;
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "flex-start", gap: "18px" },
      children: [
        { type: "div", props: { style: { width: "12px", height: "12px", borderRadius: "50%", background: RED, flexShrink: 0, marginTop: "9px" } } },
        { type: "div", props: { style: { color: BODY_TXT, fontSize, lineHeight: "1.45", flex: "1" }, children: label } },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// POST TYPE RENDERERS
// -----------------------------------------------------------------------------

// 1. EDUCATIONAL
function buildEducational(hook: string, content: string): object {
  const rows     = parseBullets(content, 10); // show up to 10 bullets — no artificial cap
  const hookText = cleanText(hook) || "Key Insight";
  const mini     = rows.length >= 8;
  const compact  = rows.length >= 6;
  const rowSize  = mini ? "mini" : compact ? "compact" : "normal";
  const rowGap   = mini ? "4px" : compact ? "5px" : "8px";
  const hookSize = (mini || compact)
    ? (hookText.length > 52 ? "30px" : hookText.length > 36 ? "34px" : "38px")
    : (hookText.length > 52 ? "40px" : hookText.length > 36 ? "46px" : "52px");

  return richCard(BG_DARK, [
    // Top badge row
    {
      type: "div",
      props: {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: mini ? "16px" : "26px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: "10px", background: `${RED}18`, border: `1.5px solid ${RED}40`, borderRadius: "100px", padding: "10px 26px" },
              children: { type: "div", props: { style: { color: RED, fontSize: "22px", fontWeight: "700", letterSpacing: "3px" }, children: "EDUCATIONAL" } },
            },
          },
          { type: "div", props: { style: { color: "rgba(255,255,255,0.18)", fontSize: "20px", fontWeight: "600", letterSpacing: "2px" }, children: HANDLE_PLAIN } },
        ],
      },
    },
    // Glassmorphism title card
    titleCard(EYEBROW, hookText, hookSize, compact || mini),
    // Numbered rows — flex:1 so each fills equal vertical space
    { type: "div", props: { style: { display: "flex", flexDirection: "column", flex: "1", gap: rowGap }, children: rows.map((b, i) => numberedRow(i + 1, b, rowSize)) } },
    watermark(),
  ]);
}

// -- Letter option row (A/B/C/D)  -  used in all quiz types ---------------------
function letterRow(letter: string, text: string): object {
  const label = text;
  // Long answer options shrink to fit but never below a 16px readability FLOOR
  // (cards are downscaled into 720p video — smaller text becomes blurry).
  const fontSize = label.length > 170 ? "16px" : label.length > 120 ? "19px" : label.length > 85 ? "22px" : label.length > 60 ? "24px" : "26px";
  return {
    type: "div",
    props: {
      style: {
        display: "flex", borderRadius: "14px", overflow: "hidden", flex: "1",
        background: "rgba(255,255,255,0.14)",   // was 0.04  -  barely visible on dark themes
        border: `1.5px solid ${ORANGE}66`,       // accent border for clear separation
      },
      children: [
        // Left accent stripe  -  thicker so it's visible on any background
        { type: "div", props: { style: { width: "6px", background: ORANGE, flexShrink: 0 } } },
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: "18px", padding: "16px 24px", flex: 1 },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "48px", height: "48px", borderRadius: "12px",
                    background: `${ORANGE}44`,     // was 22  -  too transparent, letter invisible
                    border: `2px solid ${ORANGE}`,  // solid accent border
                    flexShrink: 0,
                  },
                  children: { type: "div", props: { style: { color: ORANGE, fontSize: "22px", fontWeight: "800" }, children: letter } },
                },
              },
              { type: "div", props: { style: { color: "#ffffff", fontSize, lineHeight: "1.36", flex: "1", fontWeight: "500" }, children: label } },
            ],
          },
        },
      ],
    },
  };
}

// -- Quiz-style card (richCard + concentric circles backdrop) ------------------
function quizCard(children: object[]): object {
  return {
    type: "div",
    props: {
      style: { width: "1080px", height: "1080px", background: BG_DARK, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Inter", position: "relative" },
      children: [
        { type: "div", props: { style: { height: "8px", backgroundImage: GRAD, flexShrink: 0 } } },
        buildConcentricCirclesSvg(),
        cornerDecorations(),
        { type: "div", props: { style: { flex: 1, display: "flex", flexDirection: "column", padding: "36px 60px 28px 60px" }, children } },
        { type: "div", props: { style: { height: "8px", backgroundImage: GRAD, flexShrink: 0 } } },
      ],
    },
  };
}

// 2. QUIZ / CARDIOLOGY CHALLENGE
function buildQuiz(hook: string, content: string): object {
  const opts     = parseOptions(content);
  const hookText = cleanText(hook) || "Test your knowledge";
  const hookSize = hookText.length > 70 ? "36px" : hookText.length > 50 ? "42px" : "48px";

  return quizCard([
    // Top badge row
    {
      type: "div",
      props: {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: "10px", background: `${RED}18`, border: `1.5px solid ${RED}40`, borderRadius: "100px", padding: "10px 26px" },
              children: { type: "div", props: { style: { color: RED, fontSize: "20px", fontWeight: "700", letterSpacing: "3px" }, children: "QUIZ CHALLENGE" } },
            },
          },
          { type: "div", props: { style: { color: "rgba(255,255,255,0.18)", fontSize: "18px", fontWeight: "600", letterSpacing: "2px" }, children: HANDLE_PLAIN } },
        ],
      },
    },
    // Question glassmorphism card
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: "18px", padding: "24px 32px", marginBottom: "20px", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { fontSize: "15px", fontWeight: "700", color: ORANGE, letterSpacing: "3px", marginBottom: "10px" }, children: "QUESTION" } },
          { type: "div", props: { style: { color: "white", fontSize: hookSize, fontWeight: "700", lineHeight: "1.25" }, children: hookText } },
          { type: "div", props: { style: { display: "flex", marginTop: "12px", height: "3px", width: "60px", borderRadius: "2px", backgroundImage: GRAD } } },
        ],
      },
    },
    // Letter rows  -  fill remaining space
    { type: "div", props: { style: { display: "flex", flexDirection: "column", flex: "1", gap: "12px" }, children: ["A","B","C","D"].map((l, i) => letterRow(l, opts[i] || `Option ${l}`)) } },
    // CTA strip
    {
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", paddingTop: "16px" },
        children: [
          { type: "div", props: { style: { height: "1px", flex: "1", background: "rgba(255,255,255,0.08)" } } },
          { type: "div", props: { style: { color: RED, fontSize: "22px", fontWeight: "700" }, children: "Comment A, B, C or D below!" } },
          { type: "div", props: { style: { height: "1px", flex: "1", background: "rgba(255,255,255,0.08)" } } },
        ],
      },
    },
    watermark(),
  ]);
}

// Fact row  -  green accent (used in MYTH_FACT)
function factRow(num: number, text: string): object {
  const label = text;
  // Long fact lines shrink to fit but never below a 16px readability FLOOR
  // (cards are downscaled into 720p video — smaller text becomes blurry).
  const fontSize = label.length > 200 ? "16px" : label.length > 160 ? "19px" : label.length > 110 ? "22px" : label.length > 80 ? "24px" : "26px";
  return {
    type: "div",
    props: {
      style: { display: "flex", borderRadius: "14px", overflow: "hidden", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.20)", flex: "1" },
      children: [
        { type: "div", props: { style: { width: "5px", background: "#22c55e", flexShrink: 0 } } },
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: "18px", padding: "11px 24px", flex: 1 },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", justifyContent: "center", width: "44px", height: "44px", borderRadius: "50%", background: "rgba(34,197,94,0.18)", border: "1.5px solid rgba(34,197,94,0.45)", flexShrink: 0 },
                  children: { type: "div", props: { style: { color: "#4ade80", fontSize: "20px", fontWeight: "700" }, children: String(num) } },
                },
              },
              { type: "div", props: { style: { color: BODY_TXT, fontSize, lineHeight: "1.40", flex: "1" }, children: label } },
            ],
          },
        },
      ],
    },
  };
}

// -- Smart fact-line parser for MYTH_FACT -------------------------------------
// Extracts the actual FACT statement and up to 2 EVIDENCE bullets from content.
// Returns an array: [factText, evidenceBullet1, evidenceBullet2]
function parseMythFactLines(content: string): string[] {
  // Extract FACT section  -  multi-line aware, stops at EVIDENCE or double-newline heading
  const factMatch = content.match(
    /FACT\s*[:\-]\s*([\s\S]+?)(?=\n\s*(?:THE\s+)?EVIDENCE\s*[:\-]|\n\s*CLINICAL\s+APPLICATION|\n\s*REMEMBER|\n\n[A-Z]{3}|$)/i
  );
  const factText = factMatch
    ? factMatch[1].replace(/\*\*/g, "").replace(/\n+/g, " ").trim()
    : "";

  // Extract EVIDENCE / THE EVIDENCE section bullets
  const evidenceMatch = content.match(
    /(?:THE\s+)?EVIDENCE\s*[:\-]\s*([\s\S]+?)(?=\n\n[A-Z]{3}|\n\s*CLINICAL\s+APPLICATION|\n\s*REMEMBER|$)/i
  );
  let evidenceBullets: string[] = [];
  if (evidenceMatch) {
    evidenceBullets = evidenceMatch[1]
      .split("\n")
      .map(cleanText)
      .filter((s) => s.length > 15 && !/^(myth|fact|evidence|comment|follow|share|save|tag|drop a)/i.test(s))
      .slice(0, 3);
  }

  // Build result: [fact, evidence1, evidence2, ...]
  const result: string[] = [];
  if (factText) result.push(factText);
  result.push(...evidenceBullets);

  if (result.length >= 1) return result.slice(0, 3);

  // Fallback: extract all content after "FACT:" label (handles single-line or inline FACT:)
  const fallbackFactMatch = content.match(/\bFACT\b[:\s]+([\s\S]+?)(?=\nMYTH|\n\n[A-Z]|$)/i);
  const fallbackText = fallbackFactMatch
    ? fallbackFactMatch[1]
    : content.replace(/^[\s\S]*?MYTH\s*[:\-][^\n]*\n?/i, ""); // strip myth line, use rest

  // Try newline split
  const byLine = fallbackText
    .split("\n")
    .map(cleanText)
    .filter((s) => s.length > 15 && !/^(myth|fact|comment|follow|share|save|tag|drop a)/i.test(s))
    .slice(0, 4);
  if (byLine.length >= 1) return byLine;

  // Fallback: sentence split
  const bySentence = fallbackText
    .replace(/\*\*/g, "")
    .split(/(?<=[.!])\s+(?=[A-Z1-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && !/^(myth|fact|comment|follow|share|save|tag|drop a)/i.test(s))
    .slice(0, 4);
  if (bySentence.length >= 1) return bySentence;

  return parseBullets(content, 4);
}

// -- Extract myth text from content -------------------------------------------
function extractMythText(hook: string, content: string): string {
  // 1) Try explicit MYTH: label in content
  const mythMatch = content.match(/MYTH\s*[:\-]\s*([\s\S]+?)(?=\n\s*FACT\s*[:\-]|\n\n|$)/i);
  if (mythMatch) {
    return mythMatch[1].replace(/\*\*/g, "").replace(/\n+/g, " ").trim();
  }

  // 2) Try extracting from hook  -  strip everything from "FACT:" onwards (blended hook)
  const hookBeforeFact = hook.replace(/\s*FACT\s*[:\-][\s\S]*/i, "").trim();
  if (hookBeforeFact && hookBeforeFact !== hook) {
    return cleanText(hookBeforeFact) || "Common Misconception";
  }

  // 3) Try first sentence of content before any FACT label
  const contentBeforeFact = content.replace(/\s*FACT\s*[:\-][\s\S]*/i, "").trim();
  const firstSentence = contentBeforeFact.split(/[.!?]/)[0]?.trim();
  if (firstSentence && firstSentence.length > 10) {
    return cleanText(firstSentence) || "Common Misconception";
  }

  return cleanText(hook) || "Common Misconception";
}

// 3. MYTH vs FACT
function buildMythFact(hook: string, content: string): object {
  const factLines = parseMythFactLines(content);
  const mythText  = extractMythText(hook, content);
  const mythSize  = mythText.length > 55 ? "34px" : mythText.length > 38 ? "40px" : "44px";

  return richCard(BG_DARK, [
    // Badge row
    {
      type: "div",
      props: {
        style: { display: "flex", justifyContent: "center", marginBottom: "22px" },
        children: {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(255,255,255,0.14)", borderRadius: "100px", padding: "10px 28px" },
            children: { type: "div", props: { style: { color: GOLD, fontSize: "22px", fontWeight: "700", letterSpacing: "4px" }, children: "MYTH vs FACT" } },
          },
        },
      },
    },
    // Myth card
    {
      type: "div",
      props: {
        style: { display: "flex", borderRadius: "16px", overflow: "hidden", marginBottom: "16px", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { width: "6px", background: "#ef4444", flexShrink: 0 } } },
          {
            type: "div",
            props: {
              style: { flex: 1, display: "flex", flexDirection: "column", gap: "10px", padding: "22px 32px", background: `${RED}10`, border: "1px solid rgba(239,68,68,0.25)" },
              children: [
                { type: "div", props: { style: { color: "#fca5a5", fontSize: "18px", fontWeight: "700", letterSpacing: "4px" }, children: "[X]  COMMON MYTH" } },
                { type: "div", props: { style: { color: "white", fontSize: mythSize, fontWeight: "700", lineHeight: "1.25" }, children: mythText } },
              ],
            },
          },
        ],
      },
    },
    // Fact header label
    {
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" },
        children: [
          { type: "div", props: { style: { width: "28px", height: "2px", background: "#22c55e" } } },
          { type: "div", props: { style: { color: "#86efac", fontSize: "18px", fontWeight: "700", letterSpacing: "4px" }, children: "[OK]  THE FACTS" } },
        ],
      },
    },
    // Fact rows (each on their own row, filling remaining space)
    { type: "div", props: { style: { display: "flex", flexDirection: "column", flex: "1", gap: "12px" }, children: factLines.map((f, i) => factRow(i + 1, f)) } },
    watermark(),
  ]);
}

// 4. CLINICAL PEARL
function buildClinicalPearl(hook: string, content: string): object {
  const rows     = parseBullets(content, 10); // no artificial cap
  const hookText = cleanText(hook) || "Key Insight";
  const mini     = rows.length >= 8;
  const compact  = rows.length >= 6;
  const rowSize  = mini ? "mini" : compact ? "compact" : "normal";
  const rowGap   = mini ? "4px" : compact ? "5px" : "8px";
  const hookSize = (mini || compact)
    ? (hookText.length > 52 ? "30px" : hookText.length > 36 ? "34px" : "38px")
    : (hookText.length > 52 ? "40px" : hookText.length > 36 ? "46px" : "52px");

  return richCard(BG_DARK, [
    {
      type: "div",
      props: {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: mini ? "16px" : "26px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: "10px", background: `${GOLD}18`, border: `1.5px solid ${GOLD}45`, borderRadius: "100px", padding: "10px 26px" },
              children: { type: "div", props: { style: { color: GOLD, fontSize: "22px", fontWeight: "700", letterSpacing: "3px" }, children: "PRO TIP" } },
            },
          },
          { type: "div", props: { style: { color: "rgba(255,255,255,0.18)", fontSize: "20px", fontWeight: "600", letterSpacing: "2px" }, children: HANDLE_PLAIN } },
        ],
      },
    },
    titleCard("PRO TIP", hookText, hookSize, compact || mini),
    { type: "div", props: { style: { display: "flex", flexDirection: "column", flex: "1", gap: rowGap }, children: rows.map((b, i) => numberedRow(i + 1, b, rowSize)) } },
    // Save reminder
    {
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", gap: "14px", paddingTop: "14px" },
        children: [
          { type: "div", props: { style: { height: "1px", flex: "1", background: "rgba(255,255,255,0.07)" } } },
          { type: "div", props: { style: { color: `${GOLD}90`, fontSize: "20px", fontWeight: "600" }, children: "Save this for later" } },
          { type: "div", props: { style: { height: "1px", flex: "1", background: "rgba(255,255,255,0.07)" } } },
        ],
      },
    },
    watermark(),
  ]);
}

// -- Smart section parser for CASE STUDY --------------------------------------
function parseCaseStudySections(content: string): string[] {
  // Strip post-type category header lines (e.g. "CASE STUDY  -  ECG Interpretation")
  const cleaned = content
    .replace(/^(?:CASE\s+STUDY|TEACHING\s+CASE)\s*[-– - ][^\n]*\n?/im, "")
    .replace(/^#+\s*[^\n]*\n?/m, "")          // strip markdown headings
    .replace(/^\*\*[^\n]*\*\*\n?/m, "")        // strip bold headings
    .trim();

  // Section patterns  -  use multi-line lookaheads so they span across newlines
  const sectionPatterns: RegExp[] = [
    /(?:PATIENT\s+)?(?:PRESENTATION|CHIEF\s+COMPLAINT|HISTORY|CASE\s+DETAILS?)\s*[:\- - ]\s*([\s\S]+?)(?=\n\s*(?:KEY\s+FINDINGS?|ECG\s+FINDINGS?|DIAGNOSIS|CLINICAL\s+FINDINGS?|MANAGEMENT|TREATMENT|OUTCOME|LEARNING)|$)/i,
    /(?:KEY\s+FINDINGS?|ECG\s+FINDINGS?|DIAGNOSIS|CLINICAL\s+FINDINGS?|INTERPRETATION)\s*[:\- - ]\s*([\s\S]+?)(?=\n\s*(?:MANAGEMENT|TREATMENT|PLAN|OUTCOME|RESULT|LEARNING|CONCLUSION)|$)/i,
    /(?:MANAGEMENT|TREATMENT|PLAN)\s*[:\- - ]\s*([\s\S]+?)(?=\n\s*(?:OUTCOME|RESULT|LEARNING\s+POINT|LEARNING|CONCLUSION)|$)/i,
    /(?:OUTCOME|RESULT|LEARNING\s+POINT|LEARNING|CONCLUSION|PEARL)\s*[:\- - ]\s*([\s\S]+?)$/i,
  ];

  const sections: string[] = [];
  for (const pattern of sectionPatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const text = match[1]
        .replace(/\*\*/g, "")
        // Strip ONLY leading list markers (start of string or after a newline) — never
        // mid-word hyphens, so "drug-eluting", "V2-V4", "door-to-balloon" stay intact.
        .replace(/(^|\n)\s*[-•●]\s+/g, "$1")
        .replace(/\n+/g, " ")
        .trim();
      if (text.length > 10) sections.push(text);
    }
  }

  if (sections.length >= 2) return sections;

  // Fallback: newline split  -  each section on its own line (skip any header-looking lines)
  const byLine = cleaned
    .split("\n")
    .map(cleanText)
    .filter((s) =>
      s.length > 10 &&
      !/^(?:CASE\s+STUDY|TEACHING\s+CASE|PRESENTATION|KEY\s+FINDINGS?|MANAGEMENT|OUTCOME|LEARNING)\s*[:\- - ]?\s*$/i.test(s)
    )
    .slice(0, 4);
  if (byLine.length >= 3) return byLine;

  // Last resort: sentence split
  const bySentence = cleaned
    .replace(/\*\*/g, "")
    .split(/(?<=[.!])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, 4);

  return bySentence.length >= 2 ? bySentence : byLine.slice(0, 4);
}

// 5. CASE STUDY
function buildCaseStudy(hook: string, content: string): object {
  const lines = parseCaseStudySections(content);

  // Section colour accents
  const sectionColors = ["#60a5fa", "#fbbf24", "#34d399", "#a78bfa"];
  const sectionLabels = ["SETUP", "INSIGHT", "ACTION", "OUTCOME"];

  const hookText = cleanText(hook) || "Real-world example";
  const hookSize = hookText.length > 180 ? "19px" : hookText.length > 120 ? "22px" : hookText.length > 80 ? "26px" : "30px";

  return richCard(BG_DARK, [
    // Top badge row
    {
      type: "div",
      props: {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "22px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: "10px", background: "rgba(96,165,250,0.14)", border: "1.5px solid rgba(96,165,250,0.40)", borderRadius: "100px", padding: "10px 26px" },
              children: { type: "div", props: { style: { color: "#93c5fd", fontSize: "20px", fontWeight: "700", letterSpacing: "3px" }, children: "STORY / EXAMPLE" } },
            },
          },
          { type: "div", props: { style: { color: "rgba(255,255,255,0.18)", fontSize: "18px", fontWeight: "600", letterSpacing: "2px" }, children: HANDLE_PLAIN } },
        ],
      },
    },
    // Patient card (hook)
    {
      type: "div",
      props: {
        style: { display: "flex", borderRadius: "16px", overflow: "hidden", marginBottom: "18px", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { width: "5px", background: "#60a5fa", flexShrink: 0 } } },
          {
            type: "div",
            props: {
              style: { flex: 1, display: "flex", flexDirection: "column", gap: "8px", padding: "20px 28px", background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.20)" },
              children: [
                { type: "div", props: { style: { color: "#93c5fd", fontSize: "16px", fontWeight: "700", letterSpacing: "4px" }, children: "THE SETUP" } },
                { type: "div", props: { style: { color: "rgba(255,255,255,0.80)", fontSize: hookSize, lineHeight: "1.4", fontStyle: "italic" }, children: hookText } },
              ],
            },
          },
        ],
      },
    },
    // 2x2 grid of section cards
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", flex: "1", gap: "14px" },
        children: [
          // Row 1
          {
            type: "div",
            props: {
              style: { display: "flex", gap: "14px", flex: "1" },
              children: [0, 1].map((i) => {
                const txt = lines[i] || "--";
                // Shrink-to-fit with a 14px readability FLOOR (the 2x2 grid cells are
                // narrow, so the floor is a touch below the single-column rows — still
                // legible after the 720p downscale, never the old 11px blur).
                const fs = txt.length > 240 ? "14px" : txt.length > 180 ? "15px" : txt.length > 120 ? "17px" : txt.length > 90 ? "19px" : txt.length > 60 ? "21px" : "23px";
                return {
                  type: "div",
                  props: {
                    style: { flex: "1", display: "flex", borderRadius: "14px", overflow: "hidden" },
                    children: [
                      { type: "div", props: { style: { width: "4px", background: sectionColors[i], flexShrink: 0 } } },
                      {
                        type: "div",
                        props: {
                          style: { flex: 1, display: "flex", flexDirection: "column", padding: "14px 18px", background: "rgba(255,255,255,0.11)", border: `1px solid ${sectionColors[i]}25` },
                          children: [
                            { type: "div", props: { style: { color: sectionColors[i], fontSize: "13px", fontWeight: "700", letterSpacing: "3px", marginBottom: "8px" }, children: sectionLabels[i] } },
                            { type: "div", props: { style: { color: BODY_TXT, fontSize: fs, lineHeight: "1.45" }, children: txt } },
                          ],
                        },
                      },
                    ],
                  },
                };
              }),
            },
          },
          // Row 2
          {
            type: "div",
            props: {
              style: { display: "flex", gap: "14px", flex: "1" },
              children: [2, 3].map((i) => {
                const txt = lines[i] || "--";
                // Shrink-to-fit with a 14px readability FLOOR (the 2x2 grid cells are
                // narrow, so the floor is a touch below the single-column rows — still
                // legible after the 720p downscale, never the old 11px blur).
                const fs = txt.length > 240 ? "14px" : txt.length > 180 ? "15px" : txt.length > 120 ? "17px" : txt.length > 90 ? "19px" : txt.length > 60 ? "21px" : "23px";
                return {
                  type: "div",
                  props: {
                    style: { flex: "1", display: "flex", borderRadius: "14px", overflow: "hidden" },
                    children: [
                      { type: "div", props: { style: { width: "4px", background: sectionColors[i], flexShrink: 0 } } },
                      {
                        type: "div",
                        props: {
                          style: { flex: 1, display: "flex", flexDirection: "column", padding: "14px 18px", background: "rgba(255,255,255,0.11)", border: `1px solid ${sectionColors[i]}25` },
                          children: [
                            { type: "div", props: { style: { color: sectionColors[i], fontSize: "13px", fontWeight: "700", letterSpacing: "3px", marginBottom: "8px" }, children: sectionLabels[i] } },
                            { type: "div", props: { style: { color: BODY_TXT, fontSize: fs, lineHeight: "1.45" }, children: txt } },
                          ],
                        },
                      },
                    ],
                  },
                };
              }),
            },
          },
        ],
      },
    },
    watermark(),
  ]);
}

// -- ECG hook splitter  -  separates findings from the question -----------------
function splitEcgHook(hook: string): { findings: string[]; question: string } {
  const cleaned = cleanText(hook);
  // Split into sentences by ". "
  const sentences = cleaned.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);

  // Last sentence that is a question (starts with What/Which/Identify or has ?)
  const qIdx = sentences.findIndex(
    (s) => /^(what|which|identify|most likely)/i.test(s) || s.endsWith("?")
  );

  if (qIdx > 0) {
    const findingText = sentences.slice(0, qIdx).join(". ");
    const question    = sentences[qIdx].endsWith("?") ? sentences[qIdx] : sentences[qIdx] + "?";
    // Split findings by ", "
    const findings = findingText
      .split(/[,]\s*/)
      .map((f) => f.trim())
      .filter((f) => f.length > 4)
      .slice(0, 4);
    return { findings, question };
  }

  // Fallback: whole hook is the question, no parsed findings
  return { findings: [], question: cleaned };
}

// -- ECG content parser  -  extracts CASE and ECG FINDINGS from content body ----
function parseEcgContent(content: string): { caseInfo: string; ecgFindings: string[] } {
  // -- CASE section ----------------------------------------------------------
  // Matches "CASE:" or "CASE DETAILS:" followed by text until the next labelled section
  const caseMatch = content.match(
    /(?:^|\n)\s*CASE(?:\s*DETAILS?)?\s*[:\-]\s*([\s\S]+?)(?=\n\s*(?:ECG\s*FINDINGS?|CLINICAL\s*SCENARIO|[A-D][).:]|\bQUESTION\b|\bASK\b|$))/i
  );
  const caseInfo = caseMatch
    // Strip leading list markers only (after a space/newline) so mid-word hyphens
    // like "70-year-old" are preserved.
    ? caseMatch[1].replace(/\*\*/g, "").replace(/\n+/g, " ").replace(/(^|\s)[-•●]\s+/g, "$1").trim()
    : "";

  // -- ECG FINDINGS section --------------------------------------------------
  const ecgMatch = content.match(
    /(?:^|\n)\s*ECG\s*FINDINGS?\s*[:\-]\s*([\s\S]+?)(?=\n\s*(?:[A-D][).:]|\bQUESTION\b|\bASK\b|ANSWER|$))/i
  );
  let ecgFindings: string[] = [];
  if (ecgMatch) {
    const raw = ecgMatch[1].replace(/\*\*/g, "").trim();
    ecgFindings = raw
      .split(/[,\n•●]+/)
      .map((s) => s.trim().replace(/^[-\s]+/, ""))
      .filter((s) => s.length > 3)
      .slice(0, 5);
  }

  return { caseInfo, ecgFindings };
}

// 6. ECG QUIZ
function buildEcgQuiz(hook: string, content: string): object {
  const safe           = stripAnswerSections(content);
  const opts           = parseOptions(safe);
  const { findings: hookFindings, question } = splitEcgHook(cleanText(hook) || "What's the answer?");
  const { caseInfo, ecgFindings: contentFindings } = parseEcgContent(safe);

  // Prefer content-parsed findings (richer) over hook-parsed findings
  const findings = contentFindings.length > 0 ? contentFindings : hookFindings;

  const hookText = question;
  const hookSize = hookText.length > 60 ? "30px" : hookText.length > 40 ? "34px" : "38px";

  // -- Helper: compact chip row ----------------------------------------------
  const findingsChips = (items: string[], accentColor: string) =>
    items.map((f) => ({
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", background: `${accentColor}14`, border: `1px solid ${accentColor}45`, borderRadius: "8px", padding: "5px 12px" },
        children: { type: "div", props: { style: { color: BODY_TXT, fontSize: "18px", lineHeight: "1.3" }, children: f } },
      },
    }));

  return quizCard([
    // Top badge row
    {
      type: "div",
      props: {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: "10px", background: `${RED}18`, border: `1.5px solid ${RED}40`, borderRadius: "100px", padding: "8px 22px" },
              children: { type: "div", props: { style: { color: RED, fontSize: "19px", fontWeight: "700", letterSpacing: "3px" }, children: "KNOWLEDGE CHALLENGE" } },
            },
          },
          { type: "div", props: { style: { color: "rgba(255,255,255,0.18)", fontSize: "17px", fontWeight: "600", letterSpacing: "2px" }, children: HANDLE_PLAIN } },
        ],
      },
    },

    // ECG strip card
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: "16px", padding: "8px 0 0 0", marginBottom: "12px", overflow: "hidden", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { display: "flex", paddingLeft: "18px", paddingBottom: "4px" }, children: { type: "div", props: { style: { color: `${RED}70`, fontSize: "14px", fontWeight: "700", letterSpacing: "2px" }, children: "VISUAL CHALLENGE" } } } },
          {
            type: "div",
            props: {
              style: { height: "90px", background: `${RED}08`, position: "relative", overflow: "hidden", display: "flex" },
              children: buildEcgStripSvg(),
            },
          },
        ],
      },
    },

    // -- CASE INFO  -  patient demographics (from content CASE: section) -----
    ...(caseInfo
      ? [{
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "row", alignItems: "flex-start", gap: "10px", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.28)", borderRadius: "12px", padding: "10px 16px", marginBottom: "10px", flexShrink: 0 },
            children: [
              { type: "div", props: { style: { color: "#60a5fa", fontSize: "12px", fontWeight: "700", letterSpacing: "2px", marginTop: "2px", flexShrink: 0 }, children: "CASE" } },
              { type: "div", props: { style: { color: BODY_TXT, fontSize: "19px", lineHeight: "1.4", flex: "1" }, children: caseInfo } },
            ],
          },
        }]
      : []),

    // -- ECG FINDINGS chips ------------------------------------------------
    ...(findings.length > 0
      ? [{
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", background: `${RED}08`, border: `1px solid ${RED}28`, borderRadius: "12px", padding: "10px 16px", marginBottom: "10px", flexShrink: 0 },
            children: [
              { type: "div", props: { style: { color: RED, fontSize: "12px", fontWeight: "700", letterSpacing: "2.5px", marginBottom: "8px" }, children: "KEY FINDINGS" } },
              {
                type: "div",
                props: {
                  style: { display: "flex", flexWrap: "wrap", gap: "7px" },
                  children: findingsChips(findings, RED),
                },
              },
            ],
          },
        }]
      : []),

    // Question card
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: "14px", padding: "14px 22px", marginBottom: "10px", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { fontSize: "12px", fontWeight: "700", color: ORANGE, letterSpacing: "3px", marginBottom: "6px" }, children: "QUESTION" } },
          { type: "div", props: { style: { color: "white", fontSize: hookSize, fontWeight: "700", lineHeight: "1.25" }, children: hookText } },
        ],
      },
    },

    // Letter rows
    { type: "div", props: { style: { display: "flex", flexDirection: "column", flex: "1", gap: "8px" }, children: ["A","B","C","D"].map((l, i) => letterRow(l, opts[i] || `Option ${l}`)) } },

    // CTA strip
    {
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", paddingTop: "10px" },
        children: [
          { type: "div", props: { style: { height: "1px", flex: "1", background: "rgba(255,255,255,0.08)" } } },
          { type: "div", props: { style: { color: RED, fontSize: "18px", fontWeight: "700" }, children: "Post your answer below!" } },
          { type: "div", props: { style: { height: "1px", flex: "1", background: "rgba(255,255,255,0.08)" } } },
        ],
      },
    },
    watermark(),
  ]);
}

// 7. ANGIOGRAPHY QUIZ
function buildAngiographyQuiz(hook: string, content: string): object {
  const stripped = stripAnswerSections(content);
  const opts     = parseOptions(stripped);
  const hookText = cleanText(hook) || "What is this?";
  const hookSize = hookText.length > 70 ? "28px" : hookText.length > 50 ? "32px" : "36px";

  // -- Extract CASE section -----------------------------------------------
  const caseMatch = stripped.match(/CASE\s*[:\-]\s*([\s\S]+?)(?=ANGIOGRAPHIC|QUESTION|\bQUESTION\b|[A-D][).:]|$)/i);
  const caseText  = caseMatch
    ? caseMatch[1].replace(/\*\*/g, "").replace(/\n+/g, " ").trim()
    : "";

  // -- Extract ANGIOGRAPHIC FINDINGS ---------------------------------------
  const findMatch = stripped.match(/ANGIOGRAPHIC\s*FINDINGS?\s*[:\-]?\s*([\s\S]+?)(?=QUESTION|\bQUESTION\b|[A-D][).:]|$)/i);
  const findings: string[] = findMatch
    ? findMatch[1]
        .split(/\n/)
        .map((s) => s.replace(/^[\s\-•*]+/, "").replace(/\*\*/g, "").trim())
        .filter((s) => s.length > 3)
        .slice(0, 5)
    : [];

  // -- Finding row ---------------------------------------------------------
  // NOTE: every div with >1 child MUST have display: flex (Satori strict mode)
  const findingRow = (text: string): object => ({
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "row", alignItems: "flex-start", gap: "8px" },
      children: [
        { type: "div", props: { style: { display: "flex", color: RED, fontSize: "16px", fontWeight: "700", marginTop: "2px", flexShrink: 0 }, children: "–" } },
        { type: "div", props: { style: { display: "flex", color: "rgba(255,255,255,0.85)", fontSize: "18px", fontWeight: "400", lineHeight: "1.35", flex: "1" }, children: text } },
      ],
    },
  });

  return quizCard([
    // Header badge row
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", background: `${RED}18`, border: `1.5px solid ${RED}40`, borderRadius: "100px", padding: "8px 22px" },
              children: { type: "div", props: { style: { display: "flex", color: RED, fontSize: "18px", fontWeight: "700", letterSpacing: "3px" }, children: "IMAGE CHALLENGE" } },
            },
          },
          { type: "div", props: { style: { display: "flex", color: "rgba(255,255,255,0.18)", fontSize: "16px", fontWeight: "600", letterSpacing: "2px" }, children: HANDLE_PLAIN } },
        ],
      },
    },

    // CASE section
    ...(caseText ? [{
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.06)", border: `1px solid ${ORANGE}60`, borderRadius: "14px", padding: "10px 18px", marginBottom: "8px", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { display: "flex", fontSize: "12px", fontWeight: "700", color: ORANGE, letterSpacing: "2.5px", marginBottom: "5px" }, children: "CASE" } },
          { type: "div", props: { style: { display: "flex", color: "rgba(255,255,255,0.85)", fontSize: "19px", fontWeight: "400", lineHeight: "1.35" }, children: caseText } },
        ],
      },
    }] : []),

    // ANGIOGRAPHIC FINDINGS section
    ...(findings.length > 0 ? [{
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", background: `${RED}0d`, border: `1px solid ${RED}40`, borderRadius: "14px", padding: "10px 18px", marginBottom: "8px", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { display: "flex", fontSize: "12px", fontWeight: "700", color: RED, letterSpacing: "2.5px", marginBottom: "6px" }, children: "KEY FINDINGS" } },
          { type: "div", props: { style: { display: "flex", flexDirection: "column", gap: "4px" }, children: findings.map(findingRow) } },
        ],
      },
    }] : []),

    // QUESTION
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: "14px", padding: "10px 18px", marginBottom: "8px", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { display: "flex", fontSize: "12px", fontWeight: "700", color: ORANGE, letterSpacing: "2.5px", marginBottom: "5px" }, children: "QUESTION" } },
          { type: "div", props: { style: { display: "flex", color: "white", fontSize: hookSize, fontWeight: "700", lineHeight: "1.25" }, children: hookText } },
        ],
      },
    },

    // Answer options — use global letterRow (proven safe with Satori)
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", flex: "1", gap: "6px", marginBottom: "8px" },
        children: ["A", "B", "C", "D"].map((l, i) => letterRow(l, opts[i] || `Option ${l}`)),
      },
    },

    // CTA strip
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "row", alignItems: "center", gap: "10px", paddingTop: "6px" },
        children: [
          { type: "div", props: { style: { display: "flex", height: "1px", flex: "1", background: "rgba(255,255,255,0.07)" } } },
          { type: "div", props: { style: { display: "flex", color: RED, fontSize: "16px", fontWeight: "700" }, children: "Comment your answer below!" } },
          { type: "div", props: { style: { display: "flex", height: "1px", flex: "1", background: "rgba(255,255,255,0.07)" } } },
        ],
      },
    },
    watermark(),
  ]);
}

// 8. PREVENTIVE
function buildPreventive(hook: string, content: string): object {
  const tips     = parseBullets(content, 10); // no artificial cap
  const hookText = cleanText(hook) || "How to get started";
  const mini     = tips.length >= 8;
  const compact  = tips.length >= 6;
  const rowSize  = mini ? "mini" : compact ? "compact" : "normal";
  const rowGap   = mini ? "4px" : compact ? "5px" : "8px";
  const hookSize = (mini || compact)
    ? (hookText.length > 52 ? "30px" : hookText.length > 36 ? "34px" : "38px")
    : (hookText.length > 52 ? "40px" : hookText.length > 36 ? "46px" : "52px");

  return richCard(BG_DARK, [
    {
      type: "div",
      props: {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: mini ? "16px" : "26px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: "10px", background: "rgba(16,185,129,0.14)", border: "1.5px solid rgba(16,185,129,0.40)", borderRadius: "100px", padding: "10px 26px" },
              children: { type: "div", props: { style: { color: "#34d399", fontSize: "22px", fontWeight: "700", letterSpacing: "3px" }, children: "PREVENTIVE" } },
            },
          },
          { type: "div", props: { style: { color: "rgba(255,255,255,0.18)", fontSize: "20px", fontWeight: "600", letterSpacing: "2px" }, children: HANDLE_PLAIN } },
        ],
      },
    },
    titleCard("HOW-TO GUIDE", hookText, hookSize, compact || mini),
    { type: "div", props: { style: { display: "flex", flexDirection: "column", flex: "1", gap: rowGap }, children: tips.map((b, i) => numberedRow(i + 1, b, rowSize)) } },
    watermark(),
  ]);
}

// 9. CTA
function buildCta(hook: string, cta: string): object {
  const hookText = cleanText(hook) || "If this helped you, share it";
  const hookSize = hookText.length > 50 ? "48px" : hookText.length > 34 ? "56px" : "64px";
  const ctaText  = cleanText(cta) || "Follow for daily content";

  return richCard(BG_DARK, [
    // Spacer top
    { type: "div", props: { style: { flex: "1" } } },
    // Heart ring decoration (SVG heart  -  emoji not supported in Satori)
    {
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "32px" },
        children: {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", justifyContent: "center", width: "160px", height: "160px", borderRadius: "80px", background: `${RED}14`, border: `2px solid ${RED}35` },
            children: {
              type: "div",
              props: {
                style: { display: "flex", alignItems: "center", justifyContent: "center", width: "110px", height: "110px", borderRadius: "55px", background: `${RED}22`, border: `1.5px solid ${RED}55` },
                children: {
                  type: "svg",
                  props: {
                    viewBox: "0 0 24 24",
                    style: { width: "56px", height: "56px" },
                    children: {
                      type: "path",
                      props: { d: "M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z", fill: RED },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    // Hook text
    { type: "div", props: { style: { color: "white", fontSize: hookSize, fontWeight: "700", textAlign: "center", lineHeight: "1.18", marginBottom: "24px" }, children: hookText } },
    // Sub text
    { type: "div", props: { style: { display: "flex", justifyContent: "center", marginBottom: "36px" }, children: { type: "div", props: { style: { color: BODY_TXT, fontSize: "28px", lineHeight: "1.5", textAlign: "center" }, children: "Share this with someone you care about" } } } },
    // Action badges row
    {
      type: "div",
      props: {
        style: { display: "flex", gap: "20px", justifyContent: "center", marginBottom: "24px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", background: `${RED}18`, border: `1.5px solid ${RED}40`, borderRadius: "100px", padding: "14px 36px" },
              children: { type: "div", props: { style: { color: RED, fontSize: "22px", fontWeight: "700" }, children: "Save" } },
            },
          },
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", background: `${ORANGE}18`, border: `1.5px solid ${ORANGE}40`, borderRadius: "100px", padding: "14px 36px" },
              children: { type: "div", props: { style: { color: ORANGE, fontSize: "22px", fontWeight: "700" }, children: "Share" } },
            },
          },
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", background: `${GOLD}14`, border: `1.5px solid ${GOLD}35`, borderRadius: "100px", padding: "14px 36px" },
              children: { type: "div", props: { style: { color: GOLD, fontSize: "22px", fontWeight: "700" }, children: "Follow" } },
            },
          },
        ],
      },
    },
    // CTA text
    { type: "div", props: { style: { display: "flex", justifyContent: "center" }, children: { type: "div", props: { style: { color: `${BODY_TXT}99`, fontSize: "22px", textAlign: "center" }, children: ctaText } } } },
    // Spacer bottom
    { type: "div", props: { style: { flex: "1" } } },
    watermark(),
  ]);
}

// 10. CAROUSEL (cover preview card)
function buildCarousel(hook: string, content: string): object {
  const bullets = parseBullets(content, 6);
  const coverTitle = cleanText(hook) || COVER_TITLE_FALLBACK;
  // Shrink the big cover title for long hooks so it never overflows (no char cap).
  const coverTitleSize = coverTitle.length > 70 ? "44px" : coverTitle.length > 50 ? "56px" : coverTitle.length > 34 ? "64px" : "72px";
  return {
    type: "div",
    props: {
      style: { width: "1080px", height: "1080px", background: BG_NAVY, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Inter" },
      children: [
        { type: "div", props: { style: { position: "absolute", top: 0, left: 0, right: 0, height: "10px", background: RED } } },
        { type: "div", props: { style: { position: "absolute", bottom: 0, left: 0, right: 0, height: "10px", background: RED } } },
        // Concentric circles backdrop
        {
          type: "svg",
          props: {
            viewBox: "0 0 1080 1080",
            style: { position: "absolute", top: 0, left: 0, width: "1080px", height: "1080px" },
            children: [100, 200, 310, 430, 560, 700].map((r) => ({
              type: "circle",
              props: { cx: "540", cy: "540", r: String(r), fill: "none", stroke: RED, strokeWidth: "1", opacity: "0.08" },
            })),
          },
        },
        {
          type: "div",
          props: {
            style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "70px 70px" },
            children: [
              goldHeader("SWIPE TO LEARN"),
              { type: "div", props: { style: { height: "2px", width: "100%", background: "rgba(255,255,255,0.07)", marginBottom: "40px" } } },
              // Title
              {
                type: "div",
                props: {
                  style: { color: "white", fontSize: coverTitleSize, fontWeight: "700", textAlign: "center", lineHeight: "1.15", marginBottom: "36px" },
                  children: coverTitle,
                },
              },
              // Bullet preview
              bullets.length > 0
                ? {
                    type: "div",
                    props: {
                      style: { display: "flex", flexDirection: "column", gap: "16px", width: "100%", marginBottom: "36px" },
                      children: bullets.map((b) => ({
                        type: "div",
                        props: {
                          style: { display: "flex", alignItems: "flex-start", gap: "16px" },
                          children: [
                            { type: "div", props: { style: { width: "10px", height: "10px", borderRadius: "50%", background: RED, flexShrink: 0, marginTop: "12px" } } },
                            { type: "div", props: { style: { color: BODY_TXT, fontSize: b.length > 160 ? "20px" : b.length > 110 ? "24px" : "28px", lineHeight: "1.4", flex: "1" }, children: b } },
                          ],
                        },
                      })),
                    },
                  }
                : { type: "div", props: { style: { flex: "1" } } },
              // Swipe badge
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: "14px", background: `${RED}18`, border: `1.5px solid ${RED}40`, borderRadius: "100px", padding: "16px 36px" },
                  children: [
                    { type: "div", props: { style: { color: RED, fontSize: "28px" }, children: "->" } },
                    { type: "div", props: { style: { color: "rgba(255,255,255,0.85)", fontSize: "28px", fontWeight: "600" }, children: "Swipe through all slides" } },
                  ],
                },
              },
              watermark(),
            ],
          },
        },
      ],
    },
  };
}

// 11. REEL
function buildReel(hook: string, reelScript?: string): object {
  const hookText      = cleanText(hook) || "Attention-grabbing opener";
  const hookSize      = hookText.length > 60 ? "34px" : hookText.length > 40 ? "40px" : "46px";
  const scriptPreview = reelScript
    ? reelScript.replace(/\*\*/g, "")
    : "Your reel script will appear here  -  key talking points, timing cues, and on-screen text suggestions for maximum engagement.";

  // Timeline segment labels
  const segments = ["HOOK", "PROBLEM", "INSIGHT", "SOLUTION", "CTA"];

  return richCard(BG_DARK, [
    // Top badge row
    {
      type: "div",
      props: {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: "10px", background: "rgba(168,85,247,0.15)", border: "1.5px solid rgba(168,85,247,0.40)", borderRadius: "100px", padding: "10px 26px" },
              children: { type: "div", props: { style: { color: "#c084fc", fontSize: "20px", fontWeight: "700", letterSpacing: "3px" }, children: "REEL SCRIPT" } },
            },
          },
          { type: "div", props: { style: { color: "rgba(255,255,255,0.18)", fontSize: "18px", fontWeight: "600", letterSpacing: "2px" }, children: HANDLE_PLAIN } },
        ],
      },
    },
    // Timeline segments
    {
      type: "div",
      props: {
        style: { display: "flex", gap: "8px", marginBottom: "22px", flexShrink: 0 },
        children: segments.map((seg, i) => ({
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flex: "1" },
            children: [
              { type: "div", props: { style: { width: "100%", height: "6px", borderRadius: "3px", background: i === 0 ? RED : i === 1 ? ORANGE : "rgba(255,255,255,0.14)" } } },
              { type: "div", props: { style: { color: i === 0 ? RED : "rgba(255,255,255,0.35)", fontSize: "13px", fontWeight: "700", letterSpacing: "1px" }, children: seg } },
            ],
          },
        })),
      },
    },
    // Hook card (red accent)
    {
      type: "div",
      props: {
        style: { display: "flex", borderRadius: "16px", overflow: "hidden", marginBottom: "18px", flexShrink: 0 },
        children: [
          { type: "div", props: { style: { width: "5px", background: RED, flexShrink: 0 } } },
          {
            type: "div",
            props: {
              style: { flex: 1, display: "flex", flexDirection: "column", gap: "8px", padding: "20px 28px", background: `${RED}10`, border: "1px solid rgba(230,57,70,0.25)" },
              children: [
                { type: "div", props: { style: { color: RED, fontSize: "16px", fontWeight: "700", letterSpacing: "3px" }, children: "HOOK  (0 – 3s)" } },
                { type: "div", props: { style: { color: "white", fontSize: hookSize, fontWeight: "700", lineHeight: "1.25" }, children: hookText } },
              ],
            },
          },
        ],
      },
    },
    // Script preview card
    {
      type: "div",
      props: {
        style: { flex: "1", display: "flex", borderRadius: "16px", overflow: "hidden" },
        children: [
          { type: "div", props: { style: { width: "5px", background: "rgba(168,85,247,0.70)", flexShrink: 0 } } },
          {
            type: "div",
            props: {
              style: { flex: 1, display: "flex", flexDirection: "column", padding: "20px 28px", background: "rgba(168,85,247,0.05)", border: "1px solid rgba(168,85,247,0.18)" },
              children: [
                { type: "div", props: { style: { color: "#c084fc", fontSize: "16px", fontWeight: "700", letterSpacing: "3px", marginBottom: "12px" }, children: "SCRIPT PREVIEW" } },
                { type: "div", props: { style: { color: BODY_TXT, fontSize: "25px", lineHeight: "1.58" }, children: scriptPreview } },
              ],
            },
          },
        ],
      },
    },
    watermark(),
  ]);
}

// -- Generic dark card (fallback) ----------------------------------------------
function buildGeneric(hook: string, content: string, title: string, postType: string): object {
  const bullets = parseBullets(content, 5);
  const label   = postType.replace(/_/g, " ");
  return wrapBaseCard(BG_DARK, [
    goldHeader(label),
    { type: "div", props: { style: { height: "2px", background: "rgba(255,255,255,0.08)", marginBottom: "30px" } } },
    { type: "div", props: { style: { color: "white", fontSize: "54px", fontWeight: "700", textAlign: "center", lineHeight: "1.2", marginBottom: "36px" }, children: cleanText(hook) || cleanText(title) || label } },
    { type: "div", props: { style: { display: "flex", flexDirection: "column", gap: "20px", flex: "1" }, children: bullets.map((b) => bullet(b)) } },
    watermark(),
  ]);
}

// -- Public API ----------------------------------------------------------------

/**
 * Renders a post as a 1080x1080 branded dark-card JPEG buffer.
 * Returns null if rendering fails.
 */
export async function renderPostToJpeg(opts: {
  postType:   string;
  title:      string;
  hook:       string;
  content:    string;
  cta:        string;
  reelScript?: string;
  themeIndex?: number;   // optional override (0-11); omit for random
}): Promise<Buffer | null> {
  const { postType, title, hook, content, cta, reelScript } = opts;

  // -- Load the active brand skin so the card carries the right identity --------
  const brand = await getBrand();
  HANDLE       = atHandle(brand);                                  // "@handle" for watermark
  HANDLE_PLAIN = (brand.persona.handle || "").replace(/^@/, "");   // plain corner label
  // Neutral eyebrow for the title-card slot: prefer the brand's content-type label.
  EYEBROW      = (brand.contentTypes?.[postType as keyof typeof brand.contentTypes]?.label
                  || brand.niche || "Educational").toUpperCase();
  COVER_TITLE_FALLBACK = brand.niche && brand.niche !== "your topic"
    ? `${brand.niche} insights`.replace(/\b\w/g, (c) => c.toUpperCase())
    : "Insights";

  // -- Pick theme (random unless caller pins a specific index) ------------------
  const idx = (opts.themeIndex !== undefined && opts.themeIndex >= 0 && opts.themeIndex < THEMES.length)
    ? opts.themeIndex
    : Math.floor(Math.random() * THEMES.length);
  const theme = THEMES[idx];
  // Apply theme to module-level vars so all builder functions pick it up
  BG_DARK = theme.bg;
  BG_NAVY = theme.bg2;
  RED     = theme.accent;
  ORANGE  = theme.accent2;
  GOLD    = theme.accent3;
  GRAD    = `linear-gradient(90deg, ${theme.gradStart}, ${theme.gradMid}, ${theme.gradEnd})`;
  // When the brand locks a fixed palette, override the random theme with brand colours.
  if (brand.lockCardTheme && brand.colors) {
    BG_DARK = brand.colors.bg;
    BG_NAVY = brand.colors.bg2;
    RED     = brand.colors.accent;
    ORANGE  = brand.colors.accent2;
    GOLD    = brand.colors.accent3;
    GRAD    = `linear-gradient(90deg, ${brand.colors.accent}, ${brand.colors.accent2}, ${brand.colors.accent3})`;
  }
  console.log(`[PostTypeGen] Theme ${idx + 1}/12 selected for ${postType}`);

  try {
    let element: object;

    switch (postType) {
      case "EDUCATIONAL":      element = buildEducational(hook, content);                   break;
      case "QUIZ":             element = buildQuiz(hook, content);                          break;
      case "MYTH_FACT":        element = buildMythFact(hook, content);                      break;
      case "CLINICAL_PEARL":   element = buildClinicalPearl(hook, content);                 break;
      case "CASE_STUDY":       element = buildCaseStudy(hook, content);                     break;
      case "ECG_QUIZ":         element = buildEcgQuiz(hook, content);                       break;
      case "ANGIOGRAPHY_QUIZ": element = buildAngiographyQuiz(hook, content);               break;
      case "PREVENTIVE":       element = buildPreventive(hook, content);                    break;
      case "CTA":              element = buildCta(hook, cta);                               break;
      case "CAROUSEL":         element = buildCarousel(hook, content);                      break;
      case "REEL":             element = buildReel(hook, reelScript);                       break;
      // NOTE: "STORY" is intentionally absent  -  stories use renderStoryToJpeg() in storyImageGenerator.ts
      default:                 element = buildGeneric(hook, content, title, postType);      break;
    }

    const buf = await renderToJpeg(element);
    console.log(`[PostTypeGen] Rendered ${postType} -> ${Math.round(buf.length / 1024)} KB`);
    return buf;
  } catch (err: any) {
    console.error(`[PostTypeGen] Failed to render ${postType}:`, err?.message);
    return null;
  }
}

