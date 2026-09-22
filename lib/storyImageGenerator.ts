/**
 * lib/storyImageGenerator.ts
 *
 * Generates 1080x1920 Instagram Story cards using Satori + Sharp.
 * Premium, minimal aesthetic, branded per the active brand config.
 *
 * Story types:
 *   - "checklist"        : Tips card (the premium full layout)
 *   - "tip"              : Daily tip card
 *   - "fact"             : Quick fact card
 *   - "quiz"             : Quiz teaser card
 *   - "quote"            : Educational quote card
 */

import satori from "satori";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { sanitizeCardText } from "@/lib/cardText";
import { getBrand } from "@/lib/preferences";
import { atHandle } from "@/lib/brandConfig";

// -- Design tokens -----------------------------------------------------------
const BG_DARK    = "#0a0a0f";
const BG_CARD    = "#12121a";
const RED        = "#e63946";
const RED_DEEP   = "#b5182a";
const RED_LIGHT  = "#ff6b7a";
const CRIMSON    = "#8b0000";
const WHITE      = "#ffffff";
const WHITE80    = "rgba(255,255,255,0.80)";
const WHITE60    = "rgba(255,255,255,0.60)";
const WHITE30    = "rgba(255,255,255,0.30)";
const WHITE12    = "rgba(255,255,255,0.12)";
const WHITE06    = "rgba(255,255,255,0.06)";
const GREEN      = "#22c55e";
const GREEN_DIM  = "rgba(34,197,94,0.15)";

// -- Font loader -------------------------------------------------------------
let _fontBold:       ArrayBuffer | null = null;
let _fontSemibold:   ArrayBuffer | null = null;
let _fontRegular:    ArrayBuffer | null = null;

function readFontFile(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function loadFonts() {
  if (_fontBold && _fontRegular) {
    return { bold: _fontBold, semibold: _fontSemibold ?? _fontBold, regular: _fontRegular };
  }

  const boldPath    = path.join(process.cwd(), "public", "fonts", "Inter-Bold.woff");
  const regularPath = path.join(process.cwd(), "public", "fonts", "Inter-Regular.woff");

  if (fs.existsSync(boldPath) && fs.existsSync(regularPath)) {
    _fontBold    = readFontFile(boldPath);
    _fontSemibold = _fontBold;
    _fontRegular = readFontFile(regularPath);
    return { bold: _fontBold, semibold: _fontSemibold, regular: _fontRegular };
  }

  const [boldRes, regularRes] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.18/files/inter-latin-700-normal.woff"),
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.18/files/inter-latin-400-normal.woff"),
  ]);
  _fontBold    = await boldRes.arrayBuffer();
  _fontSemibold = _fontBold;
  _fontRegular = await regularRes.arrayBuffer();
  return { bold: _fontBold, semibold: _fontSemibold, regular: _fontRegular };
}

// -- Public input type -------------------------------------------------------
export interface StoryInput {
  /** Short headline / tip title (max ~60 chars) */
  headline: string;
  /** Body text  -  1–3 sentences (max ~200 chars) */
  body: string;
  /** Optional label shown at top (e.g. "DAILY TIP", "DID YOU KNOW?", "MONEY HABITS") */
  label?: string;
  /** Optional emoji to display large in the card */
  emoji?: string;
  /**
   * Story layout variant.
   * "checklist" = premium tips layout with a checklist. ("health_awareness"
   * is its old name and is still accepted.)
   * "tip" | "fact" | "quiz" | "quote" = simple branded card.
   */
  type?: "checklist" | "health_awareness" | "tip" | "fact" | "quiz" | "quote";
  /** Tips for the checklist layout (max 6) */
  tips?: string[];
  /** Emotional tagline shown below tips */
  tagline?: string;
  /** CTA text at the bottom */
  cta?: string;
}

// -- Shared sub-components ---------------------------------------------------

function brandHeader(label: string, handle: string, subtitle: string) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
      },
      children: [
        // Logo + name
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: "16px" },
            children: [
              // Avatar: the brand's initial (from its handle)
              {
                type: "div",
                props: {
                  style: {
                    width: "56px", height: "56px", borderRadius: "50%",
                    background: `linear-gradient(135deg, ${RED}, ${RED_DEEP})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "26px", fontWeight: 700, color: WHITE, border: `2px solid ${RED_LIGHT}`,
                  },
                  children: (handle.replace(/[^A-Za-z0-9]/g, "").charAt(0) || "•").toUpperCase(),
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column" },
                  children: [
                    { type: "span", props: { style: { color: WHITE, fontSize: "20px", fontWeight: 700, lineHeight: "1.2" }, children: handle } },
                    { type: "span", props: { style: { color: WHITE60, fontSize: "15px", fontWeight: 400 }, children: subtitle } },
                  ],
                },
              },
            ],
          },
        },
        // Label pill
        {
          type: "div",
          props: {
            style: {
              display: "flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(135deg, ${RED}, ${RED_DEEP})`,
              borderRadius: "100px", padding: "8px 22px",
              fontSize: "16px", fontWeight: 700, color: WHITE, letterSpacing: "0.07em",
            },
            children: label,
          },
        },
      ],
    },
  };
}

/** A soft accent wave used as a divider. */
function accentLine(color = RED) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex", width: "100%", alignItems: "center",
        opacity: 0.4, overflow: "hidden",
      },
      children: {
        type: "svg",
        props: {
          width: "936", height: "60", viewBox: "0 0 936 60",
          style: { width: "100%", height: "60px" },
          children: [
            {
              type: "path",
              props: {
                d: "M0,30 C78,6 156,6 234,30 C312,54 390,54 468,30 C546,6 624,6 702,30 C780,54 858,54 936,30",
                stroke: color, strokeWidth: "2.5", fill: "none", strokeLinecap: "round",
              },
            },
          ],
        },
      },
    },
  };
}

function dividerLine() {
  return {
    type: "div",
    props: {
      style: { display: "flex", width: "100%", height: "1px", background: WHITE12 },
      children: "",
    },
  };
}

function redAccent() {
  return {
    type: "div",
    props: {
      style: {
        display: "flex", width: "60px", height: "4px", borderRadius: "2px",
        background: `linear-gradient(90deg, ${RED}, ${RED_DEEP})`,
      },
      children: "",
    },
  };
}

// -- Checklist Layout ---------------------------------------------------------

function checklistCard(input: StoryInput, brandHandle: string, brandSubtitle: string, niche: string) {
  const {
    headline = "One small habit, every day",
    body = "1 small positive habit today can shape a better tomorrow.",
    label = niche.toUpperCase(),
    tips = [
      "Start small and stay consistent",
      "Focus on one thing at a time",
      "Build a daily routine",
      "Track your progress",
      "Stay curious and keep learning",
      "Review and adjust regularly",
    ],
    tagline = "Small steps today build big results tomorrow.",
    cta = "Save this story & share it with someone you care about",
  } = input;

  const safeTips = (tips ?? []).slice(0, 6).map((t) => sanitizeCardText(t));

  const tipRows = safeTips.map((tip) => ({
    type: "div",
    props: {
      style: {
        display: "flex", alignItems: "center", gap: "18px",
        background: GREEN_DIM,
        border: `1px solid rgba(34,197,94,0.25)`,
        borderRadius: "16px", padding: "18px 24px",
        width: "100%",
      },
      children: [
        // Checkmark circle
        {
          type: "div",
          props: {
            style: {
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "34px", height: "34px", borderRadius: "50%",
              background: GREEN, flexShrink: 0,
              fontSize: "16px", fontWeight: 700, color: WHITE,
            },
            children: "✓",
          },
        },
        {
          type: "span",
          props: {
            style: { color: WHITE, fontSize: "28px", fontWeight: 700, lineHeight: "1.2" },
            children: tip,
          },
        },
      ],
    },
  }));

  return {
    type: "div",
    props: {
      style: {
        width: "1080px", height: "1920px",
        background: `linear-gradient(160deg, #0d0d18 0%, #0a0a0f 40%, #120008 100%)`,
        display: "flex", flexDirection: "column",
        alignItems: "center", padding: "60px 72px",
        fontFamily: "Inter", position: "relative", overflow: "hidden",
        gap: "0px",
      },
      children: [

        // Top brand
        brandHeader(label, brandHandle, brandSubtitle),

        // Spacer
        { type: "div", props: { style: { height: "32px", display: "flex" }, children: "" } },

        // Accent wave
        accentLine(RED),

        // Spacer
        { type: "div", props: { style: { height: "28px", display: "flex" }, children: "" } },

        // Red accent bar
        redAccent(),

        // Spacer
        { type: "div", props: { style: { height: "24px", display: "flex" }, children: "" } },

        // Headline
        {
          type: "h1",
          props: {
            style: {
              color: WHITE, fontSize: "58px", fontWeight: 700,
              lineHeight: "1.15", margin: "0", textAlign: "center",
              maxWidth: "920px",
            },
            children: headline,
          },
        },

        // Spacer
        { type: "div", props: { style: { height: "20px", display: "flex" }, children: "" } },

        // Subtext body
        {
          type: "p",
          props: {
            style: {
              color: WHITE60, fontSize: "30px", fontWeight: 400,
              lineHeight: "1.5", margin: "0", textAlign: "center",
              maxWidth: "880px",
            },
            children: body,
          },
        },

        // Spacer
        { type: "div", props: { style: { height: "32px", display: "flex" }, children: "" } },

        // Tips section header
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: "12px", width: "100%" },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex", width: "4px", height: "32px", borderRadius: "2px",
                    background: `linear-gradient(180deg, ${RED}, ${RED_DEEP})`,
                  },
                  children: "",
                },
              },
              {
                type: "span",
                props: {
                  style: { color: RED_LIGHT, fontSize: "22px", fontWeight: 700, letterSpacing: "0.1em" },
                  children: `${niche.toUpperCase()} HABITS`,
                },
              },
            ],
          },
        },

        // Spacer
        { type: "div", props: { style: { height: "20px", display: "flex" }, children: "" } },

        // Tips list
        {
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "column", gap: "14px", width: "100%",
            },
            children: tipRows,
          },
        },

        // Spacer
        { type: "div", props: { style: { height: "28px", display: "flex" }, children: "" } },

        // Tagline card
        {
          type: "div",
          props: {
            style: {
              display: "flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(135deg, rgba(230,57,70,0.15), rgba(139,0,0,0.25))`,
              border: `1px solid rgba(230,57,70,0.35)`,
              borderRadius: "20px", padding: "24px 32px",
              width: "100%",
            },
            children: {
              type: "p",
              props: {
                style: {
                  color: WHITE80, fontSize: "28px", fontWeight: 400,
                  lineHeight: "1.5", margin: "0", textAlign: "center",
                  fontStyle: "italic",
                },
                children: `""${tagline}""`,
              },
            },
          },
        },

        // Flex spacer
        { type: "div", props: { style: { flex: "1", display: "flex" }, children: "" } },

        // Second accent wave
        accentLine("rgba(230,57,70,0.6)"),

        // Spacer
        { type: "div", props: { style: { height: "20px", display: "flex" }, children: "" } },

        // Divider
        dividerLine(),

        // Spacer
        { type: "div", props: { style: { height: "20px", display: "flex" }, children: "" } },

        // CTA row
        {
          type: "div",
          props: {
            style: {
              display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", gap: "24px",
            },
            children: [
              {
                type: "span",
                props: {
                  style: {
                    color: WHITE60, fontSize: "22px", fontWeight: 400,
                    lineHeight: "1.4", flex: "1",
                  },
                  children: cta,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: `linear-gradient(135deg, ${RED}, ${RED_DEEP})`,
                    borderRadius: "50px", padding: "14px 28px",
                    color: WHITE, fontSize: "20px", fontWeight: 700,
                    flexShrink: 0, whiteSpace: "nowrap",
                  },
                  children: brandHandle,
                },
              },
            ],
          },
        },

      ],
    },
  };
}

// -- Simple Branded Card Layout (tip / fact / quiz / quote) ------------------

function simpleBrandedCard(input: StoryInput, brandHandle: string, brandSubtitle: string, niche: string) {
  const { headline, body, label = `DAILY ${niche.toUpperCase()} TIP` } = input;
  // No character cap — keep the FULL headline/body and let the font tiers below
  // shrink the text so everything fits the 1080×1920 story.
  const safeHeadline = sanitizeCardText(headline ?? "");
  const safeBody     = sanitizeCardText(body     ?? "");

  return {
    type: "div",
    props: {
      style: {
        width: "1080px", height: "1920px",
        background: `linear-gradient(160deg, #0d0d18 0%, #0a0a0f 40%, #120008 100%)`,
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "space-between", padding: "80px 72px",
        fontFamily: "Inter", position: "relative", overflow: "hidden",
      },
      children: [

        // Top brand
        brandHeader(label, brandHandle, brandSubtitle),

        // Centre content
        {
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: "44px", width: "100%", textAlign: "center",
            },
            children: [

              // Accent wave
              accentLine(RED),

              // Big sparkle — inline SVG (Satori has no emoji font loaded, so an
              // emoji glyph would render as a black block).
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", justifyContent: "center" },
                  children: {
                    type: "svg",
                    props: {
                      viewBox: "0 0 24 24",
                      style: { width: "130px", height: "130px" },
                      children: {
                        type: "path",
                        props: { d: "M12 1.5 L14.4 9.6 L22.5 12 L14.4 14.4 L12 22.5 L9.6 14.4 L1.5 12 L9.6 9.6 Z", fill: WHITE },
                      },
                    },
                  },
                },
              },

              // Red accent
              redAccent(),

              // Headline
              {
                type: "h1",
                props: {
                  style: {
                    color: WHITE,
                    fontSize: safeHeadline.length > 110 ? "38px" : safeHeadline.length > 80 ? "44px" : safeHeadline.length > 50 ? "52px" : "64px",
                    fontWeight: 700, lineHeight: "1.15",
                    margin: "0", maxWidth: "900px",
                  },
                  children: safeHeadline,
                },
              },

              // Body card
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    background: WHITE06,
                    border: `1.5px solid ${WHITE12}`,
                    borderRadius: "24px", padding: "44px 52px",
                    maxWidth: "960px", width: "100%",
                  },
                  children: {
                    type: "p",
                    props: {
                      style: {
                        color: WHITE60,
                        // Shrink for very long bodies so nothing is clipped (no char cap).
                        fontSize: safeBody.length > 520 ? "24px" : safeBody.length > 360 ? "28px" : safeBody.length > 240 ? "31px" : "34px",
                        fontWeight: 400,
                        lineHeight: "1.6", margin: "0",
                      },
                      children: safeBody,
                    },
                  },
                },
              },
            ],
          },
        },

        // Bottom
        {
          type: "div",
          props: {
            style: {
              display: "flex", flexDirection: "column",
              alignItems: "center", gap: "20px", width: "100%",
            },
            children: [
              dividerLine(),
              {
                type: "div",
                props: {
                  style: {
                    display: "flex", alignItems: "center",
                    justifyContent: "space-between", width: "100%",
                  },
                  children: [
                    {
                      type: "span",
                      props: {
                        style: { color: WHITE60, fontSize: "24px", fontWeight: 400 },
                        children: `Follow for daily ${niche} tips`,
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: `linear-gradient(135deg, ${RED}, ${RED_DEEP})`,
                          borderRadius: "50px", padding: "12px 28px",
                          color: WHITE, fontSize: "20px", fontWeight: 700,
                        },
                        children: brandHandle,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },

      ],
    },
  };
}

// -- Main renderer -----------------------------------------------------------
export async function renderStoryToJpeg(input: StoryInput): Promise<Buffer | null> {
  try {
    const { bold, semibold, regular } = await loadFonts();

    const brand = await getBrand();
    const brandHandleText = atHandle(brand);
    const brandSubtitle = `${brand.niche.replace(/^\w/, (c) => c.toUpperCase())} Content`;
    const niche = brand.niche;

    const W = 1080;
    const H = 1920;

    // Choose layout
    const layout = input.type === "checklist" || input.type === "health_awareness"
      ? checklistCard(input, brandHandleText, brandSubtitle, niche)
      : simpleBrandedCard(input, brandHandleText, brandSubtitle, niche);

    const svg = await satori(
      layout as any,
      {
        width:  W,
        height: H,
        fonts: [
          { name: "Inter", data: bold,     weight: 700, style: "normal" },
          { name: "Inter", data: semibold, weight: 600, style: "normal" },
          { name: "Inter", data: regular,  weight: 400, style: "normal" },
        ],
      }
    );

    return await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  } catch (err) {
    console.error("[StoryGen] Render failed:", err);
    return null;
  }
}
