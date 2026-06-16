/**
 * lib/slideImageGenerator.ts
 *
 * Generates carousel slide images matching the branded dark-card design:
 *   -- Dark navy background (#0d1420 / #1a1428)
 *   -- Red top/bottom accent bars + left red stripe
 *   -- Gold header / slide counter
 *   -- Bold white headline
 *   -- Body text as bullet points
 *   -- @interventional_heart watermark
 *
 * Uses Satori (JSX -> SVG) + Sharp (SVG -> JPEG buffer).
 * Fonts loaded from local public/fonts/ (WOFF, NOT woff2 -- Satori rejects woff2).
 */

import satori from "satori";
import sharp   from "sharp";
import fs      from "fs";
import path    from "path";
import type { Theme } from "@/lib/hookCard";
import { getBrand } from "@/lib/preferences";
import { atHandle } from "@/lib/brandConfig";

// -- Design constants (mirrors postTypeImageGenerator.ts) --------------------
const BG_NAVY  = "#0d1420";
const BG_DARK  = "#1a1428";
const RED      = "#e63946";
const GOLD     = "#ffa500";
const BODY_TXT = "rgba(255,255,255,0.55)";

// -- Active brand identity  -  set at the start of each render call --------------
let HANDLE       = "@yourhandle";   // "@handle" watermark
let EYEBROW      = "INSIGHT";        // neutral slide eyebrow (was "CARDIOLOGY INSIGHT")
let COVER_TITLE_FALLBACK = "Insights";

// -- Font cache ---------------------------------------------------------------
let _fontBold:    ArrayBuffer | null = null;
let _fontRegular: ArrayBuffer | null = null;

function readFontFile(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function loadFonts(): Promise<{ bold: ArrayBuffer; regular: ArrayBuffer }> {
  if (_fontBold && _fontRegular) return { bold: _fontBold, regular: _fontRegular };

  // 1. Try local WOFF files (no network, Satori-compatible -- NOT woff2)
  const boldPath    = path.join(process.cwd(), "public", "fonts", "Inter-Bold.woff");
  const regularPath = path.join(process.cwd(), "public", "fonts", "Inter-Regular.woff");

  if (fs.existsSync(boldPath) && fs.existsSync(regularPath)) {
    _fontBold    = readFontFile(boldPath);
    _fontRegular = readFontFile(regularPath);
    console.log("[SlideGen] Loaded fonts from public/fonts/");
    return { bold: _fontBold, regular: _fontRegular };
  }

  // 2. Fallback: fetch WOFF from jsDelivr CDN (Google Fonts woff2 = 404 or Satori error)
  console.log("[SlideGen] Local fonts not found -- fetching from jsDelivr CDN...");
  const [boldRes, regularRes] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.18/files/inter-latin-700-normal.woff"),
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.18/files/inter-latin-400-normal.woff"),
  ]);
  _fontBold    = await boldRes.arrayBuffer();
  _fontRegular = await regularRes.arrayBuffer();
  return { bold: _fontBold, regular: _fontRegular };
}

// -- Helpers ------------------------------------------------------------------
function cleanText(t: string): string {
  return (t ?? "").replace(/\*\*/g, "").trim();
}

function parseBullets(text: string, max = 4): string[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.replace(/^[•‣◦⁃\-*\d.]\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .slice(0, max);
}

/** Load the active brand skin and set the module-level identity vars used on cards. */
async function applyBrandIdentity(): Promise<void> {
  try {
    const brand = await getBrand();
    HANDLE  = atHandle(brand);
    EYEBROW = (brand.niche && brand.niche !== "your topic" ? brand.niche : "Insight").toUpperCase();
    COVER_TITLE_FALLBACK = brand.niche && brand.niche !== "your topic"
      ? `${brand.niche} insights`.replace(/\b\w/g, (c) => c.toUpperCase())
      : "Insights";
  } catch {
    /* keep neutral defaults */
  }
}

// -- Shared brand frame wrappers ----------------------------------------------

/** Red top bar */
function topBar(height = 8, color = RED): object {
  return { type: "div", props: { style: { position: "absolute", top: 0, left: 0, right: 0, height: `${height}px`, background: color } } };
}
/** Red bottom bar */
function bottomBar(height = 8, color = RED): object {
  return { type: "div", props: { style: { position: "absolute", bottom: 0, left: 0, right: 0, height: `${height}px`, background: color } } };
}
/** Left red accent stripe */
function leftStripe(): object {
  return { type: "div", props: { style: { position: "absolute", top: 0, left: 0, bottom: 0, width: "18px", background: RED } } };
}
/** Brand handle watermark */
function watermark(handle: string = HANDLE): object {
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginTop: "auto", paddingTop: "16px" },
      children: [
        { type: "div", props: { style: { color: RED, fontSize: "20px" }, children: "♥" } },
        { type: "div", props: { style: { color: `${RED}66`, fontSize: "20px", letterSpacing: "4px", fontWeight: "700" }, children: handle } },
      ],
    },
  };
}
/** Gold divider with label */
function goldHeader(label: string): object {
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", marginBottom: "12px" },
      children: [
        { type: "div", props: { style: { height: "2px", width: "60px", background: `${GOLD}50` } } },
        { type: "div", props: { style: { color: GOLD, fontSize: "26px", fontWeight: "700", letterSpacing: "5px" }, children: label } },
        { type: "div", props: { style: { height: "2px", width: "60px", background: `${GOLD}50` } } },
      ],
    },
  };
}
/** Single bullet row */
function bullet(text: string): object {
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "flex-start", gap: "18px" },
      children: [
        { type: "div", props: { style: { width: "12px", height: "12px", borderRadius: "50%", background: RED, flexShrink: 0, marginTop: "10px" } } },
        { type: "div", props: { style: { color: BODY_TXT, fontSize: text.length > 180 ? "22px" : text.length > 120 ? "26px" : "30px", lineHeight: "1.5", flex: "1" }, children: text } },
      ],
    },
  };
}

// -- COVER SLIDE --------------------------------------------------------------
function buildCoverSlide(title: string, totalSlides: number, headline: string): object {
  return {
    type: "div",
    props: {
      style: { width: "1080px", height: "1080px", background: BG_NAVY, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Inter" },
      children: [
        topBar(10),
        bottomBar(10),
        // Subtle concentric circles backdrop
        {
          type: "svg",
          props: {
            viewBox: "0 0 1080 1080",
            style: { position: "absolute", top: 0, left: 0, width: "1080px", height: "1080px" },
            children: [100, 200, 310, 430, 560].map((r) => ({
              type: "circle",
              props: { cx: "540", cy: "540", r: String(r), fill: "none", stroke: RED, strokeWidth: "1", opacity: "0.08" },
            })),
          },
        },
        // Content layer
        {
          type: "div",
          props: {
            style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 70px" },
            children: [
              goldHeader("SWIPE TO LEARN"),
              { type: "div", props: { style: { height: "2px", width: "100%", background: "rgba(255,255,255,0.07)", marginBottom: "48px" } } },
              // Big title
              {
                type: "div",
                props: {
                  style: { color: "white", fontSize: ((cleanText(title) || cleanText(headline) || COVER_TITLE_FALLBACK).length > 64 ? "52px" : (cleanText(title) || cleanText(headline) || COVER_TITLE_FALLBACK).length > 42 ? "64px" : "80px"), fontWeight: "700", textAlign: "center", lineHeight: "1.1", marginBottom: "36px" },
                  children: cleanText(title) || cleanText(headline) || COVER_TITLE_FALLBACK,
                },
              },
              // Swipe badge
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: "14px", background: `${RED}18`, border: `1.5px solid ${RED}40`, borderRadius: "100px", padding: "16px 36px", marginBottom: "20px" },
                  children: [
                    { type: "div", props: { style: { color: RED, fontSize: "28px" }, children: "▶" } },
                    { type: "div", props: { style: { color: "rgba(255,255,255,0.85)", fontSize: "28px", fontWeight: "600" }, children: `${totalSlides} slides inside` } },
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

// -- CONTENT SLIDE ------------------------------------------------------------
function buildContentSlide(
  headline: string,
  body: string,
  slideNum: number,
  totalSlides: number
): object {
  const bullets = parseBullets(body, 4);
  const hasBullets = bullets.length > 0;

  return {
    type: "div",
    props: {
      style: { width: "1080px", height: "1080px", background: BG_DARK, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Inter" },
      children: [
        topBar(8),
        bottomBar(8),
        leftStripe(),
        {
          type: "div",
          props: {
            style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", padding: "52px 56px" },
            children: [
              // Slide counter row
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" },
                  children: [
                    { type: "div", props: { style: { color: GOLD, fontSize: "24px", fontWeight: "700", letterSpacing: "4px" }, children: EYEBROW } },
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", alignItems: "center", gap: "8px", background: `${RED}20`, border: `1px solid ${RED}40`, borderRadius: "8px", padding: "6px 16px" },
                        children: { type: "div", props: { style: { color: RED, fontSize: "22px", fontWeight: "700" }, children: `${String(slideNum).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}` } },
                      },
                    },
                  ],
                },
              },
              // Divider
              { type: "div", props: { style: { height: "2px", background: "rgba(255,255,255,0.08)", marginBottom: "32px" } } },
              // Headline
              {
                type: "div",
                props: {
                  style: { color: "white", fontSize: ((cleanText(headline) || "").length > 70 ? "40px" : (cleanText(headline) || "").length > 48 ? "48px" : "58px"), fontWeight: "700", lineHeight: "1.2", marginBottom: "36px" },
                  children: cleanText(headline) || `Slide ${slideNum}`,
                },
              },
              // Body
              hasBullets
                ? { type: "div", props: { style: { display: "flex", flexDirection: "column", gap: "22px", flex: "1" }, children: bullets.map(bullet) } }
                : (() => {
                    // No character cap — shrink the font so the FULL body fits the slide.
                    const txt = cleanText(body);
                    const fs = txt.length > 900 ? "20px" : txt.length > 600 ? "24px" : txt.length > 380 ? "28px" : "34px";
                    return {
                      type: "div",
                      props: {
                        style: { flex: "1", color: BODY_TXT, fontSize: fs, lineHeight: "1.6" },
                        children: txt,
                      },
                    };
                  })(),
              // Bottom red divider
              { type: "div", props: { style: { height: "2px", background: `${RED}40`, marginTop: "24px" } } },
              watermark(),
            ],
          },
        },
      ],
    },
  };
}

// -- LAST SLIDE (CTA) ---------------------------------------------------------
function buildLastSlide(headline: string, body: string, slideNum: number, totalSlides: number): object {
  return {
    type: "div",
    props: {
      style: { width: "1080px", height: "1080px", background: BG_NAVY, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Inter" },
      children: [
        topBar(10),
        bottomBar(10),
        {
          type: "svg",
          props: {
            viewBox: "0 0 1080 1080",
            style: { position: "absolute", top: 0, left: 0, width: "1080px", height: "1080px" },
            children: [80, 180, 300, 440].map((r) => ({
              type: "circle",
              props: { cx: "540", cy: "540", r: String(r), fill: "none", stroke: RED, strokeWidth: "1", opacity: "0.10" },
            })),
          },
        },
        {
          type: "div",
          props: {
            style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 70px" },
            children: [
              goldHeader(`${String(slideNum).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`),
              { type: "div", props: { style: { height: "2px", width: "100%", background: "rgba(255,255,255,0.07)", marginBottom: "40px" } } },
              { type: "div", props: { style: { color: RED, fontSize: "80px", marginBottom: "16px" }, children: "♥" } },
              {
                type: "div",
                props: {
                  style: { color: "white", fontSize: ((cleanText(headline) || "Save & Share").length > 56 ? "42px" : (cleanText(headline) || "Save & Share").length > 38 ? "50px" : "60px"), fontWeight: "700", textAlign: "center", lineHeight: "1.2", marginBottom: "28px" },
                  children: cleanText(headline) || "Save & Share",
                },
              },
              {
                type: "div",
                props: {
                  style: { color: BODY_TXT, fontSize: ((cleanText(body) || "Tag a colleague who needs to see this!").length > 360 ? "20px" : (cleanText(body) || "Tag a colleague who needs to see this!").length > 220 ? "24px" : (cleanText(body) || "Tag a colleague who needs to see this!").length > 140 ? "27px" : "30px"), textAlign: "center", lineHeight: "1.5", marginBottom: "36px" },
                  children: cleanText(body) || "Tag a colleague who needs to see this!",
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: "14px", background: `${RED}18`, border: `1.5px solid ${RED}40`, borderRadius: "100px", padding: "16px 36px" },
                  children: [
                    { type: "div", props: { style: { color: RED, fontSize: "28px" }, children: "\u{1F4AC}" } },
                    { type: "div", props: { style: { color: "rgba(255,255,255,0.85)", fontSize: "28px", fontWeight: "600" }, children: "Drop your thoughts below!" } },
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

// -- Public API ---------------------------------------------------------------

/**
 * Render a single carousel slide to a JPEG Buffer.
 */
export async function renderSlideToPng(opts: {
  headline:    string;
  body:        string;
  slideNum:    number;
  totalSlides: number;
  isCover?:    boolean;
  isLast?:     boolean;
  coverTitle?: string;
}): Promise<Buffer> {
  const { headline, body, slideNum, totalSlides, isCover, isLast, coverTitle } = opts;
  const { bold, regular } = await loadFonts();
  await applyBrandIdentity();

  let element: object;
  if (isCover) {
    element = buildCoverSlide(coverTitle ?? headline, totalSlides, headline);
  } else if (isLast) {
    element = buildLastSlide(headline, body, slideNum, totalSlides);
  } else {
    element = buildContentSlide(headline, body, slideNum, totalSlides);
  }

  const svg = await satori(element as Parameters<typeof satori>[0], {
    width:  1080,
    height: 1080,
    fonts: [
      { name: "Inter", data: bold,    weight: 700, style: "normal" },
      { name: "Inter", data: regular, weight: 400, style: "normal" },
    ],
  });

  // Sharp: no mozjpeg (can silently fail on some builds)
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/**
 * Generate all slide images for a carousel post.
 * Returns JPEG buffers in slide order (cover first, CTA last).
 */
export async function generateAllSlideBuffers(
  slides: Array<{ slide: number; headline: string; body: string }>,
  coverTitle?: string
): Promise<Buffer[]> {
  const total   = slides.length;
  const buffers: Buffer[] = [];

  for (const s of slides) {
    try {
      const isCover = s.slide === 1;
      const isLast  = s.slide === total && total > 2;
      const buf = await renderSlideToPng({
        headline:    s.headline,
        body:        s.body,
        slideNum:    s.slide,
        totalSlides: total,
        isCover,
        isLast,
        coverTitle,
      });
      buffers.push(buf);
      console.log(`[SlideGen] Rendered slide ${s.slide}/${total} (${Math.round(buf.length / 1024)} KB)`);
    } catch (err: any) {
      console.warn(`[SlideGen] Failed to render slide ${s.slide}:`, err?.message);
    }
  }

  return buffers;
}

// ============================================================================
//  VERTICAL SHORT SLIDES (1080×1920, 9:16) — themed, full-frame, LARGE text
// ----------------------------------------------------------------------------
//  Used by the YouTube Short carousel. Distinct from the square (1080×1080)
//  Instagram-feed slides above. Each slide:
//    - Full-bleed THEME gradient background (theme passed in by youtubePublish so
//      the whole Short — hook, slides, outro — shares ONE cohesive look).
//    - Top row: eyebrow brand on the left + "NN / NN" slide counter on the right.
//    - Center: the slide's KEY POINT as LARGE, bold, readable white text.
//    - Bottom: @interventional_heart watermark + pulse accent.
//  Rendered with satori → sharp (container-safe; NO raw SVG / feDropShadow).
// ============================================================================

const SHORT_W = 1080;
const SHORT_H = 1920;

/**
 * Auto-size the big center "point" text so a longer point shrinks but a short,
 * punchy point runs huge. Keyed on character count; generous line-height keeps it
 * readable. Target band ~64–88px (short headlines can go bigger). Satori does the
 * real wrapping — this just picks a size that won't clip the 1920px-tall frame.
 */
function fitShortPointFontSize(text: string): number {
  const len = (text ?? "").length;
  if (len > 320) return 46;
  if (len > 240) return 54;
  if (len > 170) return 64;
  if (len > 110) return 74;
  if (len > 64)  return 84;
  if (len > 32)  return 96;
  return 108;
}

/** Hex accent + alpha suffix → an "#rrggbbAA"-style translucent colour for Satori. */
function withAlpha(hex: string, alphaHex: string): string {
  // Only applies to 6-digit hex; otherwise return as-is (gradients/named colours).
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alphaHex}` : hex;
}

/**
 * Build ONE vertical Short content slide element (1080×1920) on the given theme.
 * `headline` is an optional short label; `body` is the dominant KEY POINT.
 */
function buildShortSlideVertical(
  headline: string,
  body: string,
  slideNum: number,
  totalSlides: number,
  theme: Theme,
): object {
  const point     = cleanText(body) || cleanText(headline) || `Slide ${slideNum}`;
  const label     = cleanText(headline);
  const hasLabel  = label.length > 0 && label.toLowerCase() !== point.toLowerCase();
  const pointSize = fitShortPointFontSize(point);
  const counter   = `${String(slideNum).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`;

  return {
    type: "div",
    props: {
      style: {
        width: `${SHORT_W}px`,
        height: `${SHORT_H}px`,
        display: "flex",
        flexDirection: "column",
        background: theme.bg,
        fontFamily: "Inter",
        position: "relative",
        overflow: "hidden",
      },
      children: [
        // Top accent bar
        { type: "div", props: { style: { display: "flex", width: `${SHORT_W}px`, height: "20px", background: theme.accent, flexShrink: 0 } } },

        // ── TOP ROW: brand eyebrow (left) + slide counter (right) ────────────
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "110px 90px 0px 90px", width: `${SHORT_W}px` },
            children: [
              { type: "div", props: { style: { display: "flex", color: theme.accent2, fontSize: "40px", fontWeight: 700, letterSpacing: "8px" }, children: EYEBROW } },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: withAlpha(theme.accent, "26"),
                    border: `2px solid ${withAlpha(theme.accent, "66")}`,
                    borderRadius: "14px",
                    padding: "10px 24px",
                  },
                  children: { type: "div", props: { style: { display: "flex", color: theme.ctaColor, fontSize: "38px", fontWeight: 700, letterSpacing: "2px" }, children: counter } },
                },
              },
            ],
          },
        },

        // ── CENTER: optional short label + the LARGE key point ───────────────
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", gap: "44px", padding: "40px 100px", width: `${SHORT_W}px` },
            children: [
              ...(hasLabel
                ? [{
                    type: "div",
                    props: {
                      style: { display: "flex", color: theme.accent2, fontSize: "52px", fontWeight: 700, letterSpacing: "1px", textAlign: "center", lineHeight: 1.15 },
                      children: label,
                    },
                  }]
                : []),
              // Accent rule under the label / above the point
              { type: "div", props: { style: { display: "flex", width: "160px", height: "8px", borderRadius: "4px", background: theme.accent } } },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    color: "#ffffff",
                    fontSize: `${pointSize}px`,
                    fontWeight: 700,
                    lineHeight: 1.22,
                    letterSpacing: "-0.5px",
                    textAlign: "center",
                  },
                  children: point,
                },
              },
            ],
          },
        },

        // ── BOTTOM: pulse accent + @interventional_heart watermark ───────────
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "26px", paddingBottom: "120px", width: `${SHORT_W}px` },
            children: [
              { type: "div", props: { style: { display: "flex", width: "200px", height: "8px", borderRadius: "4px", background: withAlpha(theme.accent, "80") } } },
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: "16px" },
                  children: [
                    // CSS-drawn pulse dot (no emoji)
                    { type: "div", props: { style: { display: "flex", width: "22px", height: "22px", borderRadius: "11px", background: theme.accent } } },
                    { type: "div", props: { style: { display: "flex", color: theme.accent2, fontSize: "36px", fontWeight: 700, letterSpacing: "4px" }, children: HANDLE } },
                  ],
                },
              },
            ],
          },
        },

        // Bottom accent bar
        { type: "div", props: { style: { display: "flex", width: `${SHORT_W}px`, height: "20px", background: theme.accent, flexShrink: 0 } } },
      ],
    },
  };
}

/**
 * Render ONE vertical (1080×1920, 9:16) themed Short content slide to a JPEG
 * buffer. The whole Short shares one `theme` for a cohesive look. Throws on
 * failure (callers in renderPostCardBuffers catch per-slide).
 */
export async function renderShortSlideVertical(opts: {
  headline:    string;
  body:        string;
  slideNum:    number;
  totalSlides: number;
  theme:       Theme;
}): Promise<Buffer> {
  const { headline, body, slideNum, totalSlides, theme } = opts;
  const { bold, regular } = await loadFonts();
  await applyBrandIdentity();

  const element = buildShortSlideVertical(headline, body, slideNum, totalSlides, theme);

  const svg = await satori(element as Parameters<typeof satori>[0], {
    width:  SHORT_W,
    height: SHORT_H,
    fonts: [
      { name: "Inter", data: bold,    weight: 700, style: "normal" },
      { name: "Inter", data: regular, weight: 400, style: "normal" },
    ],
  });

  // High JPEG quality so text stays crisp — re-encoded into MP4 frames.
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Generate all vertical (1080×1920) themed Short content slides for a post.
 * Returns JPEG buffers in slide order. Skips any slide that fails to render.
 */
export async function generateShortSlidesVertical(
  slides: Array<{ slide: number; headline: string; body: string }>,
  theme: Theme,
): Promise<Buffer[]> {
  const total = slides.length;
  const buffers: Buffer[] = [];

  for (const s of slides) {
    try {
      const buf = await renderShortSlideVertical({
        headline:    s.headline,
        body:        s.body,
        slideNum:    s.slide,
        totalSlides: total,
        theme,
      });
      if (buf && buf.length > 0) {
        buffers.push(buf);
        console.log(`[SlideGen] Rendered vertical Short slide ${s.slide}/${total} (${Math.round(buf.length / 1024)} KB)`);
      }
    } catch (err: any) {
      console.warn(`[SlideGen] Failed to render vertical Short slide ${s.slide}:`, err?.message);
    }
  }

  return buffers;
}
