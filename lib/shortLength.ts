/**
 * lib/shortLength.ts
 *
 * Single source of truth for the "target Short length" feature. Both the content
 * GENERATOR (sizes the script to fit) and the VIDEO/VOICEOVER renderer (paces cards
 * + voiceover) derive their numbers from `shortPlan()` so a Short actually lands
 * near the chosen duration. Soft target — a rich topic may run slightly over.
 *
 * Pure constants/math (no imports) → safe to import anywhere (client + server).
 */

export const SHORT_LENGTH_OPTIONS = [15, 20, 30, 45, 60] as const;
export type ShortLength = (typeof SHORT_LENGTH_OPTIONS)[number];
export const DEFAULT_SHORT_SECONDS = 30;

// How many content points (cards) per target length.
const POINTS_FOR: Record<number, number> = { 15: 2, 20: 3, 30: 4, 45: 5, 60: 6 };

export interface ShortPlan {
  target:       number;  // chosen target seconds
  points:       number;  // number of content cards/points to generate
  wordsPerPoint:number;  // spoken-word budget per point
  totalWords:   number;  // ≈ whole-Short narration budget
  contentWords: number;  // words available for the content points (ex-hook/CTA)
  hookSecs:     number;  // hook cover hold
  outroSecs:    number;  // subscribe outro hold
  contentSecs:  number;  // total seconds for content cards
  perCardSecs:  number;  // silent-mode seconds per content card (voiceover overrides)
  maxSecs:      number;  // soft ceiling (target + slack), never past YouTube's Shorts cap
}

/** Normalise an arbitrary value to a valid target length. */
export function normalizeShortSeconds(v: unknown): number {
  const n = Number(v);
  return (SHORT_LENGTH_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_SHORT_SECONDS;
}

/** Derive the full pacing/word plan for a target Short length. */
export function shortPlan(target?: unknown): ShortPlan {
  const t = normalizeShortSeconds(target);
  const WPS = 2.5;                                  // ≈150 words/min speaking rate
  const hookSecs  = t <= 20 ? 1.5 : 2;
  const outroSecs = t <= 20 ? 2 : 3;
  const contentSecs = Math.max(6, t - hookSecs - outroSecs);
  const points = POINTS_FOR[t] ?? 4;
  const totalWords   = Math.round(t * WPS);
  const contentWords = Math.max(points * 6, totalWords - 8 /*hook*/ - 10 /*cta*/);
  const wordsPerPoint = Math.max(6, Math.round(contentWords / points));
  const perCardSecs   = Math.max(2, Math.round(contentSecs / points));
  // Soft target: allow ~30% slack over the target, but never beyond the ~180s Shorts cap.
  const maxSecs = Math.min(178, Math.round(t * 1.3));
  return { target: t, points, wordsPerPoint, totalWords, contentWords, hookSecs, outroSecs, contentSecs, perCardSecs, maxSecs };
}
