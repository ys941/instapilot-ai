/**
 * lib/cardText.ts
 *
 * Normalize AI-generated text so the branded card FONT can render every glyph.
 * The satori-loaded font doesn't include some Unicode punctuation/spaces the models
 * emit (en/em dashes, non-breaking hyphens, narrow/no-break spaces, smart quotes),
 * which otherwise render as "tofu" boxes on the card (e.g. "fiber[box]fermenting").
 * Replace them with plain ASCII equivalents the font DOES have.
 */
export function sanitizeCardText(s: string): string {
  return (s || "")
    // Dash / hyphen / minus variants -> ASCII hyphen "-"
    .replace(/[‐-―⁃−﹘﹣－]/g, "-")
    // Exotic spaces -> normal space (nbsp, en/em/thin/hair, narrow-nbsp, math, ideographic)
    .replace(/[  -   　]/g, " ")
    // Zero-width chars -> remove (ZWSP, ZWNJ, ZWJ, word-joiner, BOM)
    .replace(/[​-‍⁠﻿]/g, "")
    // Smart single/double quotes -> straight
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    // Ellipsis -> "..."
    .replace(/…/g, "...")
    // Collapse any doubled spaces the swaps introduced
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
