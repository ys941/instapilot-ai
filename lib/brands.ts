/**
 * lib/brands.ts
 *
 * Phase 1 foundation for multi-account ("multi-brand") support.
 *
 * A "Brand" = a paired Instagram account + YouTube channel — mirroring the
 * current single-account setup. There is always exactly one PRIMARY brand
 * (isPrimary=true). The primary brand resolves its credentials from ENV vars,
 * preserving the existing behaviour EXACTLY; non-primary brands store their own
 * credentials in their Brand row.
 *
 * Backward-compat rules baked in here:
 *   - A `null` brandId everywhere means "the primary brand".
 *   - getBrandCredentials() for the primary brand returns the SAME values the
 *     current code reads from ENV (env wins, brand-row columns are fallback).
 *   - The Brand table + columns are additive; nothing here changes existing
 *     Post/ScheduledPost/Comment/Analytics behaviour.
 */

import { prisma } from "@/lib/prisma";

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

/** Fully-resolved credentials for one brand (secrets included — server only). */
export interface BrandCredentials {
  igToken:        string;
  igAcctId:       string;
  igUsername:     string;
  fbPageId:       string;
  ytClientId:     string;
  ytClientSecret: string;
  ytRefreshToken: string;
  ytChannelId:    string;
  ytChannelTitle: string;
}

/** Safe, non-secret summary of a brand — for UI lists. */
export interface BrandRecord {
  id:             string;
  label:          string;
  isPrimary:      boolean;
  active:         boolean;
  igUsername:     string;
  ytChannelTitle: string;
  hasInstagram:   boolean;
  hasYouTube:     boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** Resolve the IG handle the same way the legacy single-account code did. */
function envIgUsername(): string {
  return process.env.INSTAGRAM_USERNAME?.trim() || "";
}

/** Build a safe summary from a raw Brand row. */
function toRecord(b: {
  id: string;
  label: string;
  isPrimary: boolean;
  active: boolean;
  igUsername: string | null;
  igAccessToken: string | null;
  igBusinessAccountId: string | null;
  ytChannelTitle: string | null;
  ytClientId: string | null;
  ytRefreshToken: string | null;
}): BrandRecord {
  // For the primary brand, credentials live in ENV — reflect that in has* flags
  // and in the displayed username/channel so the UI shows the live account.
  const igUsername = b.isPrimary ? (envIgUsername() || b.igUsername || "") : (b.igUsername ?? "");
  const ytChannelTitle = b.ytChannelTitle ?? "";

  const hasInstagram = b.isPrimary
    ? Boolean(env("INSTAGRAM_ACCESS_TOKEN") && env("INSTAGRAM_BUSINESS_ACCOUNT_ID")) ||
      Boolean(b.igAccessToken && b.igBusinessAccountId)
    : Boolean(b.igAccessToken && b.igBusinessAccountId);

  const hasYouTube = b.isPrimary
    ? Boolean(env("YOUTUBE_CLIENT_ID") && env("YOUTUBE_CLIENT_SECRET") && env("YOUTUBE_REFRESH_TOKEN")) ||
      Boolean(b.ytClientId && b.ytRefreshToken)
    : Boolean(b.ytClientId && b.ytRefreshToken);

  return {
    id:             b.id,
    label:          b.label,
    isPrimary:      b.isPrimary,
    active:         b.active,
    igUsername,
    ytChannelTitle,
    hasInstagram,
    hasYouTube,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Primary-brand lifecycle
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ensure a primary brand exists. Creates one labelled "Primary" with
 * isPrimary=true (credentials left null — the primary resolves them from ENV).
 * Idempotent. Returns the primary brand id.
 */
export async function ensurePrimaryBrand(): Promise<string> {
  const existing = await prisma.brand.findFirst({
    where:  { isPrimary: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Use a fixed update-or-create to avoid a race creating two primaries.
  try {
    const created = await prisma.brand.create({
      data: { label: "Primary", isPrimary: true, active: true },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Lost a race — re-read.
    const again = await prisma.brand.findFirst({ where: { isPrimary: true }, select: { id: true } });
    if (again) return again.id;
    throw new Error("Failed to ensure primary brand");
  }
}

/** ensurePrimaryBrand() + return its id. */
export async function getPrimaryBrandId(): Promise<string> {
  return ensurePrimaryBrand();
}

/**
 * Normalise an optional brandId → an existing brand id. Returns the given id if
 * it maps to a real brand; otherwise (null/undefined/unknown) the primary id.
 */
export async function resolveBrandId(brandId?: string | null): Promise<string> {
  if (brandId) {
    const found = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (found) return found.id;
  }
  return getPrimaryBrandId();
}

// ───────────────────────────────────────────────────────────────────────────
// Listing / summaries
// ───────────────────────────────────────────────────────────────────────────

const RECORD_SELECT = {
  id: true,
  label: true,
  isPrimary: true,
  active: true,
  igUsername: true,
  igAccessToken: true,
  igBusinessAccountId: true,
  ytChannelTitle: true,
  ytClientId: true,
  ytRefreshToken: true,
} as const;

/** All brands: primary first, then active brands by createdAt ascending. */
export async function listBrands(): Promise<BrandRecord[]> {
  await ensurePrimaryBrand();
  const rows = await prisma.brand.findMany({
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select:  RECORD_SELECT,
  });
  return rows.map(toRecord);
}

/** Safe summary for a single brand, or null if it does not exist. */
export async function getBrandSummary(id: string): Promise<BrandRecord | null> {
  const row = await prisma.brand.findUnique({ where: { id }, select: RECORD_SELECT });
  return row ? toRecord(row) : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Create / update / delete
// ───────────────────────────────────────────────────────────────────────────

/** Create a new (non-primary) brand with optional credentials. */
export async function createBrand(
  input: { label: string } & Partial<BrandCredentials>,
): Promise<BrandRecord> {
  await ensurePrimaryBrand();
  const row = await prisma.brand.create({
    data: {
      label:               input.label,
      isPrimary:           false,
      active:              true,
      igAccessToken:       input.igToken        ?? null,
      igBusinessAccountId: input.igAcctId       ?? null,
      igUsername:          input.igUsername     ?? null,
      fbPageId:            input.fbPageId       ?? null,
      ytClientId:          input.ytClientId     ?? null,
      ytClientSecret:      input.ytClientSecret ?? null,
      ytRefreshToken:      input.ytRefreshToken ?? null,
      ytChannelId:         input.ytChannelId    ?? null,
      ytChannelTitle:      input.ytChannelTitle ?? null,
    },
    select: RECORD_SELECT,
  });
  return toRecord(row);
}

/**
 * Patch a brand's credential columns. Only provided keys are written — undefined
 * keys are left untouched. The isPrimary flag is NEVER modified here.
 */
export async function updateBrandCredentials(
  id: string,
  patch: Partial<BrandCredentials>,
): Promise<void> {
  const data: Record<string, string | null> = {};
  if (patch.igToken        !== undefined) data.igAccessToken       = patch.igToken;
  if (patch.igAcctId       !== undefined) data.igBusinessAccountId = patch.igAcctId;
  if (patch.igUsername     !== undefined) data.igUsername          = patch.igUsername;
  if (patch.fbPageId       !== undefined) data.fbPageId            = patch.fbPageId;
  if (patch.ytClientId     !== undefined) data.ytClientId          = patch.ytClientId;
  if (patch.ytClientSecret !== undefined) data.ytClientSecret      = patch.ytClientSecret;
  if (patch.ytRefreshToken !== undefined) data.ytRefreshToken      = patch.ytRefreshToken;
  if (patch.ytChannelId    !== undefined) data.ytChannelId         = patch.ytChannelId;
  if (patch.ytChannelTitle !== undefined) data.ytChannelTitle      = patch.ytChannelTitle;

  if (Object.keys(data).length === 0) return;
  // Note: isPrimary is intentionally absent from `data` so it can never be wiped.
  await prisma.brand.update({ where: { id }, data });
}

/** Delete a brand. THROWS if the brand is the primary brand. */
export async function deleteBrand(id: string): Promise<void> {
  const brand = await prisma.brand.findUnique({ where: { id }, select: { isPrimary: true } });
  if (!brand) return; // already gone — idempotent
  if (brand.isPrimary) {
    throw new Error("Cannot delete the primary brand");
  }
  await prisma.brand.delete({ where: { id } });
}

// ───────────────────────────────────────────────────────────────────────────
// THE KEY FUNCTION — credential resolution
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve full credentials for a brand. `null`/undefined → the primary brand.
 *
 * PRIMARY brand: ENV wins (exact legacy behaviour), brand-row columns are only a
 * fallback when an env var is empty.
 * NON-PRIMARY brand: returns that brand's stored credential columns verbatim.
 */
export async function getBrandCredentials(brandId?: string | null): Promise<BrandCredentials> {
  const resolvedId = await resolveBrandId(brandId);
  const brand = await prisma.brand.findUnique({
    where: { id: resolvedId },
    select: {
      isPrimary:           true,
      igAccessToken:       true,
      igBusinessAccountId: true,
      igUsername:          true,
      fbPageId:            true,
      ytClientId:          true,
      ytClientSecret:      true,
      ytRefreshToken:      true,
      ytChannelId:         true,
      ytChannelTitle:      true,
    },
  });

  if (brand?.isPrimary) {
    // ENV wins; brand-row columns are the fallback. This reproduces the exact
    // values the legacy single-account code reads.
    return {
      igToken:        env("INSTAGRAM_ACCESS_TOKEN")          || (brand.igAccessToken       ?? ""),
      igAcctId:       env("INSTAGRAM_BUSINESS_ACCOUNT_ID")   || (brand.igBusinessAccountId ?? ""),
      igUsername:     envIgUsername()                        || (brand.igUsername          ?? ""),
      fbPageId:       env("FACEBOOK_PAGE_ID")                || (brand.fbPageId            ?? ""),
      ytClientId:     env("YOUTUBE_CLIENT_ID")               || (brand.ytClientId          ?? ""),
      ytClientSecret: env("YOUTUBE_CLIENT_SECRET")           || (brand.ytClientSecret      ?? ""),
      ytRefreshToken: env("YOUTUBE_REFRESH_TOKEN")           || (brand.ytRefreshToken      ?? ""),
      ytChannelId:    env("YOUTUBE_CHANNEL_ID")              || (brand.ytChannelId         ?? ""),
      ytChannelTitle: brand.ytChannelTitle ?? "",
    };
  }

  // Non-primary brand → stored columns only.
  return {
    igToken:        brand?.igAccessToken       ?? "",
    igAcctId:       brand?.igBusinessAccountId ?? "",
    igUsername:     brand?.igUsername          ?? "",
    fbPageId:       brand?.fbPageId            ?? "",
    ytClientId:     brand?.ytClientId          ?? "",
    ytClientSecret: brand?.ytClientSecret      ?? "",
    ytRefreshToken: brand?.ytRefreshToken      ?? "",
    ytChannelId:    brand?.ytChannelId         ?? "",
    ytChannelTitle: brand?.ytChannelTitle      ?? "",
  };
}
