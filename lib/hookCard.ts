/**
 * lib/hookCard.ts
 *
 * Renders a branded "hook" intro card and a "subscribe" outro card
 * (both 1080×1920 — full-frame 9:16) for a YouTube Short. The hook card is
 * PREPENDED before the content cards (and reused as the YouTube thumbnail); the
 * outro card is APPENDED after them.
 *
 * 9:16 FULL-FRAME: cards are authored at 1080×1920 so they FILL the 720×1280
 * vertical video with no black bars (ffmpeg downscales 1080×1920 → 720×1280, an
 * exact 9:16 → 9:16 fit). Text is sized LARGE and readable at that scale.
 *
 * RENDERED WITH SATORI + SHARP — NOT hand-written SVG.
 * ------------------------------------------------------------------------------
 * The previous implementation built raw `<svg>`/`<rect>`/`<radialGradient>`
 * strings and rasterized them with `sharp(Buffer.from(svg))`. On the production
 * Railway container the older librsvg build rejected that SVG every time with:
 *   "Input buffer has corrupt header: glib: XML parse error … Couldn't find end
 *    of Start Tag rect line 8"
 * …so the Short published with no hook intro / thumbnail.
 *
 * The content cards (lib/postTypeImageGenerator.ts) render reliably because they
 * use Satori (HTML/flexbox-like element tree → SVG) with Inter fonts, then sharp.
 * Satori-generated SVG is exactly what the container can rasterize, so we copy
 * that proven pattern here: build a flexbox element tree, `satori(...)` → SVG,
 * then `sharp(Buffer.from(svg)).jpeg(...)`.
 *
 * Design uses CSS only (linear-gradient backgrounds, borderRadius, bold Inter,
 * colored accents). NO emoji (there is no emoji font), NO arbitrary SVG paths.
 * Text auto-sizes + wraps so it never overflows 1080×1080. Best-effort: every
 * function returns `Promise<Buffer | null>` and never throws.
 */

import satori from "satori";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { getBrand } from "@/lib/preferences";
import { ytChannelName, ytHandle } from "@/lib/brandConfig";

// Full-frame vertical 9:16 — authored at 1080×1920, downscaled to 720×1280 by
// ffmpeg with no black bars (both are 9:16). LARGE text is keyed off this height.
const WIDTH  = 1080;
const HEIGHT = 1920;

// -- Font loading (identical proven pattern to postTypeImageGenerator.ts) ------
let _fontBold: ArrayBuffer | null = null;
let _fontRegular: ArrayBuffer | null = null;

/** Read a local file as a proper ArrayBuffer (handles Node buffer pool slicing). */
function readFontFile(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function loadFonts(): Promise<{ bold: ArrayBuffer; regular: ArrayBuffer }> {
  if (_fontBold && _fontRegular) return { bold: _fontBold, regular: _fontRegular };

  // 1. Local WOFF first (fast, no network, Satori-compatible — Satori does NOT
  //    support WOFF2, so always point at the .woff files).
  const boldPath    = path.join(process.cwd(), "public", "fonts", "Inter-Bold.woff");
  const regularPath = path.join(process.cwd(), "public", "fonts", "Inter-Regular.woff");

  if (fs.existsSync(boldPath) && fs.existsSync(regularPath)) {
    _fontBold    = readFontFile(boldPath);
    _fontRegular = readFontFile(regularPath);
    console.log("[HookCard] Loaded fonts from public/fonts/");
    return { bold: _fontBold, regular: _fontRegular };
  }

  // 2. Fallback: fetch WOFF from jsDelivr CDN (same source the content cards use).
  console.log("[HookCard] Local fonts not found — fetching from jsDelivr CDN...");
  const [boldRes, regularRes] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.18/files/inter-latin-700-normal.woff"),
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.18/files/inter-latin-400-normal.woff"),
  ]);
  _fontBold    = await boldRes.arrayBuffer();
  _fontRegular = await regularRes.arrayBuffer();
  return { bold: _fontBold, regular: _fontRegular };
}

/** Satori render helper → 1080×1920 (9:16) JPEG buffer. */
async function renderToJpeg(element: object): Promise<Buffer> {
  const { bold, regular } = await loadFonts();
  const svg = await satori(element as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: "Inter", data: bold,    weight: 700, style: "normal" },
      { name: "Inter", data: regular, weight: 400, style: "normal" },
    ],
  });
  // High JPEG quality so text stays crisp — the card is re-encoded into MP4 frames.
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

// -- Helpers -------------------------------------------------------------------

/** Small stable string hash → non-negative int (for deterministic theme/eyebrow). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface HookCardInput {
  hook?:     string | null;
  title:     string;
  postType?: string | null;
  /** Optional explicit theme (so the whole Short — hook, slides, outro — share it).
   *  When omitted, a theme is derived deterministically from the hook/title. */
  theme?:    Theme | null;
}

export interface Theme {
  id:       string;
  /** diagonal background gradient as a ready-to-use CSS string. */
  bg:       string;
  /** primary accent (top bar, brand, glow rule). */
  accent:   string;
  /** secondary accent (brand mark text, soft glow halo). */
  accent2:  string;
  /** CTA / energetic line color (high-contrast on the dark bg). */
  ctaColor: string;
}

/**
 * Theme catalogue — 12 bold, high-contrast palettes. Backgrounds
 * are CSS linear-gradients (135deg dark → accent-tinted) that Satori renders
 * natively. Headline ink stays white for legibility on every theme.
 */
export const THEMES: readonly Theme[] = [
  { id: "crimson",        bg: "linear-gradient(135deg, #080A12 0%, #1a0a1e 50%, #3a0c18 100%)", accent: "#ff2d46", accent2: "#ff6e82", ctaColor: "#ffd23f" },
  { id: "electric-blue",  bg: "linear-gradient(135deg, #020617 0%, #0a1f47 52%, #0e3a7a 100%)", accent: "#2a93ff", accent2: "#6fc0ff", ctaColor: "#bfe0ff" },
  { id: "teal-dark",      bg: "linear-gradient(135deg, #021414 0%, #04282a 55%, #063e40 100%)", accent: "#14d3c4", accent2: "#4ff0e2", ctaColor: "#7ff4ea" },
  { id: "purple-indigo",  bg: "linear-gradient(135deg, #0a0420 0%, #1b0d3e 55%, #2e1466 100%)", accent: "#8b5cf6", accent2: "#b794ff", ctaColor: "#cbb4ff" },
  { id: "amber-charcoal", bg: "linear-gradient(135deg, #100d08 0%, #241c0c 55%, #3a2c0e 100%)", accent: "#f5a623", accent2: "#ffc658", ctaColor: "#ffd98a" },
  { id: "emerald-black",  bg: "linear-gradient(135deg, #04140b 0%, #062a17 55%, #084023 100%)", accent: "#22c55e", accent2: "#5ef08c", ctaColor: "#8df0ac" },
  { id: "magenta-violet", bg: "linear-gradient(135deg, #16031a 0%, #330a3e 55%, #52125f 100%)", accent: "#ec4899", accent2: "#ff7ac0", ctaColor: "#ffaad8" },
  { id: "orange-maroon",  bg: "linear-gradient(135deg, #1a0604 0%, #3a0f08 55%, #5c1a0a 100%)", accent: "#ff6b1a", accent2: "#ff9558", ctaColor: "#ffc299" },
  { id: "cyan-slate",     bg: "linear-gradient(135deg, #04121a 0%, #0a2633 55%, #0f3c4d 100%)", accent: "#06b6d4", accent2: "#4fdbef", ctaColor: "#8fe9f5" },
  { id: "gold-black",     bg: "linear-gradient(135deg, #000000 0%, #0e0c04 55%, #1c1808 100%)", accent: "#d4af37", accent2: "#f2d671", ctaColor: "#f2d671" },
  { id: "urgent-red",     bg: "linear-gradient(135deg, #1a0000 0%, #330000 50%, #5e0808 100%)", accent: "#ff1f3d", accent2: "#ff6b7d", ctaColor: "#ffd23f" },
  { id: "sky-navy",       bg: "linear-gradient(135deg, #02040f 0%, #0a1838 55%, #11295e 100%)", accent: "#38bdf8", accent2: "#7dd3fc", ctaColor: "#bae6fd" },
];

/** Curiosity / attention eyebrow phrases — varied by a hash of the hook. */
const EYEBROWS: readonly string[] = [
  "WAIT — DID YOU KNOW?",
  "STOP SCROLLING",
  "MOST PEOPLE GET THIS WRONG",
  "HERE'S THE TRUTH",
  "THE THING YOU SHOULDN'T IGNORE",
  "EXPERTS WISH YOU KNEW THIS",
  "QUICK FACT",
  "BEFORE YOU SCROLL...",
  "THIS IS WORTH KNOWING",
  "QUICK QUESTION",
];

/**
 * Keyword → eyebrow bias so the attention phrase fits the topic. First match
 * wins; falls back to a hash-rotated phrase so identical topics stay varied.
 */
const KEYWORD_EYEBROW: ReadonlyArray<{ re: RegExp; eyebrow: string }> = [
  { re: /\b(urgent|emergency|critical|warning|danger|important)\b/i,                               eyebrow: "THIS IS WORTH KNOWING" },
  { re: /\b(symptom|sign|warning|ignore|hidden|early)\b/i,                                          eyebrow: "THE THING YOU SHOULDN'T IGNORE" },
  { re: /\b(myth|wrong|mistake|misconception|false|believe|think)\b/i,                            eyebrow: "MOST PEOPLE GET THIS WRONG" },
  { re: /\b(quiz|question|guess|can you|test yourself|do you know)\b/i,                            eyebrow: "QUICK QUESTION" },
  { re: /\b(doctor|expert|pro|specialist|told|wish you knew)\b/i,                                  eyebrow: "EXPERTS WISH YOU KNEW THIS" },
  { re: /\b(fact|tip|did you know|truth|reality|actually)\b/i,                                     eyebrow: "QUICK FACT" },
  { re: /\b(secret|hidden|nobody|real reason|here'?s why)\b/i,                                     eyebrow: "HERE'S THE TRUTH" },
  { re: /\b(stop|scroll|wait|hold on|listen)\b/i,                                                  eyebrow: "STOP SCROLLING" },
];

/** Deterministic theme pick (hash of hook/title) so identical topics stay stable. */
function pickTheme(hook: string, title: string): Theme {
  const seed = hashStr(hook || title || "app");
  return THEMES[seed % THEMES.length];
}

/**
 * Pick ONE theme for an entire Short from a seed string (e.g. `post.id` or
 * `post.id + title`). Hash-derived so DIFFERENT posts reliably land on different
 * themes, while the SAME post always resolves to the same theme. The caller passes
 * the returned theme to the hook cover, every content slide, and the outro so all
 * cards in one Short share a cohesive look (and different Shorts look different).
 */
export function pickShortTheme(seed: string): Theme {
  const h = hashStr(seed || "app");
  return THEMES[h % THEMES.length];
}

/** Pick the eyebrow: keyword-biased, else hash-rotated through the phrase set. */
function pickEyebrow(hook: string, title: string, postType: string): string {
  const blob = `${hook} ${title} ${postType}`.toLowerCase();
  const match = KEYWORD_EYEBROW.find((k) => k.re.test(blob));
  if (match) return match.eyebrow;
  const seed = hashStr(hook || title || "app");
  return EYEBROWS[seed % EYEBROWS.length];
}

/**
 * Auto-size the headline. We estimate how many characters fit per line at a
 * candidate font size, count the resulting wrapped lines, and step the size down
 * until the block fits the vertical safe zone. Satori does the real wrapping; this
 * just picks a size that won't clip. Returns the chosen font size (px).
 */
function fitHeadlineFontSize(text: string): number {
  const len = text.length;
  // Generous tiers keyed on character count — longer hooks shrink so all 1080px
  // of width is used and the (Satori-wrapped) block never runs off the now-taller
  // 1920px card. The 1920px height gives far more vertical room than the old
  // square, so the headline can run BIG (up to ~150px) for a striking thumbnail.
  if (len > 130) return 70;
  if (len > 100) return 82;
  if (len > 72)  return 98;
  if (len > 48)  return 118;
  if (len > 28)  return 134;
  return 150;
}

// -- HOOK CARD -----------------------------------------------------------------

/**
 * Render the hook intro card (1080×1080 JPEG). Striking, curiosity-driven, and
 * doubles as the YouTube thumbnail. Returns null on failure (caller starts the
 * Short with the content cards).
 */
export async function renderHookCard(input: HookCardInput): Promise<Buffer | null> {
  try {
    const raw = (input.hook && input.hook.trim()) || input.title || "Here's what you need to know";
    const headline = raw.replace(/\s+/g, " ").trim().toUpperCase();

    const brand = await getBrand();
    const brandMark = (ytChannelName(brand) || brand.persona.displayName || brand.appName).toUpperCase();

    const theme = input.theme ?? pickTheme(input.hook || "", input.title || "");
    const eyebrow = pickEyebrow(input.hook || "", input.title || "", input.postType || "");
    const fontSize = fitHeadlineFontSize(headline);

    const element = {
      type: "div",
      props: {
        style: {
          width: `${WIDTH}px`,
          height: `${HEIGHT}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          background: theme.bg,
          fontFamily: "Inter",
          position: "relative",
          overflow: "hidden",
          padding: "0px",
        },
        children: [
          // Top accent bar (taller for the full-frame card)
          { type: "div", props: { style: { display: "flex", width: `${WIDTH}px`, height: "20px", background: theme.accent, flexShrink: 0 } } },

          // ── TOP: brand lockup + eyebrow chip ───────────────────────────────
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "40px", paddingTop: "150px" },
              children: [
                // Brand "THE CARDIO DOC" lockup with pulse rules flanking it
                {
                  type: "div",
                  props: {
                    style: { display: "flex", alignItems: "center", gap: "22px" },
                    children: [
                      { type: "div", props: { style: { display: "flex", width: "80px", height: "5px", borderRadius: "3px", background: theme.accent2, opacity: 0.7 } } },
                      { type: "div", props: { style: { display: "flex", color: theme.accent2, fontSize: "42px", fontWeight: 700, letterSpacing: "10px" }, children: brandMark } },
                      { type: "div", props: { style: { display: "flex", width: "80px", height: "5px", borderRadius: "3px", background: theme.accent2, opacity: 0.7 } } },
                    ],
                  },
                },
                // Eyebrow chip (curiosity phrase)
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: theme.accent,
                      borderRadius: "100px",
                      padding: "22px 56px",
                    },
                    children: { type: "div", props: { style: { display: "flex", color: "#ffffff", fontSize: eyebrow.length > 24 ? "38px" : "46px", fontWeight: 700, letterSpacing: "4px" }, children: eyebrow } },
                  },
                },
              ],
            },
          },

          // ── MIDDLE: big hook headline (auto-sized, wraps, centered) ─────────
          {
            type: "div",
            props: {
              style: { display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: "60px 90px", width: `${WIDTH}px` },
              children: {
                type: "div",
                props: {
                  // NOTE: a block div with an explicit width (NOT display:flex) so
                  // Satori WRAPS the headline across multiple lines. A flex item does
                  // not wrap text — long hooks overflowed and clipped to a fragment
                  // (e.g. "THIS IS"). width = card minus the 90px side padding.
                  style: {
                    width: `${WIDTH - 180}px`,
                    color: "#ffffff",
                    fontSize: `${fontSize}px`,
                    fontWeight: 700,
                    lineHeight: 1.12,
                    letterSpacing: "-1px",
                    textAlign: "center",
                  },
                  children: headline,
                },
              },
            },
          },

          // ── BOTTOM: accent rule + WATCH cue ────────────────────────────────
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "44px", paddingBottom: "150px" },
              children: [
                { type: "div", props: { style: { display: "flex", width: "240px", height: "10px", borderRadius: "5px", background: theme.accent } } },
                {
                  type: "div",
                  props: {
                    style: { display: "flex", alignItems: "center", gap: "26px" },
                    children: [
                      // CSS-drawn "play" triangle (no emoji): a 0-width/height box with borders.
                      {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            width: "0px",
                            height: "0px",
                            borderTop: "26px solid transparent",
                            borderBottom: "26px solid transparent",
                            borderLeft: `44px solid ${theme.ctaColor}`,
                          },
                        },
                      },
                      { type: "div", props: { style: { display: "flex", color: theme.ctaColor, fontSize: "56px", fontWeight: 700, letterSpacing: "4px" }, children: "WATCH TILL THE END" } },
                    ],
                  },
                },
              ],
            },
          },

          // Bottom accent bar
          { type: "div", props: { style: { display: "flex", width: `${WIDTH}px`, height: "20px", background: theme.accent, flexShrink: 0 } } },
        ],
      },
    };

    return await renderToJpeg(element);
  } catch (err: any) {
    console.warn("[HookCard] render failed:", err?.message ?? err);
    return null;
  }
}

// -- OUTRO CARD ----------------------------------------------------------------

/**
 * Render the CTA outro card (1080×1080 JPEG) shown AFTER the content cards.
 * Same theme family (picked from the same hook string for cohesion) with a
 * prominent YouTube-red SUBSCRIBE button, an energetic line, a CSS-drawn bell
 * indicator, and a bottom "Read the caption" cue. Returns null on failure.
 */
export async function renderOutroCard(input: HookCardInput): Promise<Buffer | null> {
  try {
    const theme = input.theme ?? pickTheme(input.hook || "", input.title || "");
    const YT_RED = "#FF0033";

    const brand = await getBrand();
    const brandMark = (ytChannelName(brand) || brand.persona.displayName || brand.appName).toUpperCase();
    const handle = ytHandle(brand);

    // CSS-drawn bell (no emoji): a rounded body + a clapper dot, in white.
    const bell = (bodyColor: string) => ({
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", alignItems: "center", marginRight: "26px" },
        children: [
          // Bell body: rounded-top rectangle
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                width: "54px",
                height: "52px",
                background: bodyColor,
                borderTopLeftRadius: "27px",
                borderTopRightRadius: "27px",
                borderBottomLeftRadius: "10px",
                borderBottomRightRadius: "10px",
              },
            },
          },
          // Clapper
          { type: "div", props: { style: { display: "flex", width: "20px", height: "20px", borderRadius: "10px", background: bodyColor, marginTop: "5px" } } },
        ],
      },
    });

    const element = {
      type: "div",
      props: {
        style: {
          width: `${WIDTH}px`,
          height: `${HEIGHT}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          background: theme.bg,
          fontFamily: "Inter",
          position: "relative",
          overflow: "hidden",
        },
        children: [
          // Top accent bar
          { type: "div", props: { style: { display: "flex", width: `${WIDTH}px`, height: "20px", background: theme.accent, flexShrink: 0 } } },

          // ── TOP: brand lockup ──────────────────────────────────────────────
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "150px" },
              children: {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: "22px" },
                  children: [
                    { type: "div", props: { style: { display: "flex", width: "80px", height: "5px", borderRadius: "3px", background: theme.accent2, opacity: 0.7 } } },
                    { type: "div", props: { style: { display: "flex", color: theme.accent2, fontSize: "42px", fontWeight: 700, letterSpacing: "10px" }, children: brandMark } },
                    { type: "div", props: { style: { display: "flex", width: "80px", height: "5px", borderRadius: "3px", background: theme.accent2, opacity: 0.7 } } },
                  ],
                },
              },
            },
          },

          // ── MIDDLE: headline + subtitle + SUBSCRIBE button ─────────────────
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", gap: "44px", padding: "0px 90px", width: `${WIDTH}px` },
              children: [
                {
                  type: "div",
                  props: {
                    style: { display: "flex", color: "#ffffff", fontSize: "120px", fontWeight: 700, letterSpacing: "-2px", textAlign: "center", lineHeight: 1.04 },
                    children: "Subscribe & Like",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: { display: "flex", color: theme.ctaColor, fontSize: "52px", fontWeight: 700, textAlign: "center", lineHeight: 1.3 },
                    children: `Subscribe to ${handle} if you love the content!`,
                  },
                },
                // YouTube-red rounded SUBSCRIBE button with a CSS bell
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: YT_RED,
                      borderRadius: "90px",
                      padding: "38px 90px",
                      marginTop: "12px",
                    },
                    children: [
                      bell("#ffffff"),
                      { type: "div", props: { style: { display: "flex", color: "#ffffff", fontSize: "72px", fontWeight: 700, letterSpacing: "4px" }, children: "SUBSCRIBE" } },
                    ],
                  },
                },
                // "Share this — it could save a life" line
                {
                  type: "div",
                  props: {
                    style: { display: "flex", color: "#ffffff", fontSize: "50px", fontWeight: 700, textAlign: "center", lineHeight: 1.25, marginTop: "10px" },
                    children: "Share this with someone who needs it",
                  },
                },
              ],
            },
          },

          // ── BOTTOM: caption cue band ───────────────────────────────────────
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "30px", paddingBottom: "140px", width: `${WIDTH}px` },
              children: [
                { type: "div", props: { style: { display: "flex", width: "240px", height: "10px", borderRadius: "5px", background: theme.accent } } },
                { type: "div", props: { style: { display: "flex", color: "#ffffff", fontSize: "50px", fontWeight: 700, textAlign: "center", padding: "0px 100px", lineHeight: 1.25 }, children: "Read the caption for the full breakdown" } },
              ],
            },
          },

          // Bottom accent bar
          { type: "div", props: { style: { display: "flex", width: `${WIDTH}px`, height: "20px", background: theme.accent, flexShrink: 0 } } },
        ],
      },
    };

    return await renderToJpeg(element);
  } catch (err: any) {
    console.warn("[OutroCard] render failed:", err?.message ?? err);
    return null;
  }
}
