/**
 * lib/brandRequest.ts
 *
 * Tiny helpers for the Phase 2A multi-brand API convention:
 *   - brand comes from the `?brand=<id>` query string OR a JSON body `brand` field.
 *   - empty / omitted  → primary brand (callers pass the result to resolveBrandId()).
 *   - special `brand=all` → aggregate across all active brands (READ-only views).
 *
 * These helpers intentionally do NOT resolve to the primary id themselves — they
 * just surface the raw param so each route can decide between the single-brand and
 * `all` paths. Pass a non-"all" value straight to resolveBrandId()/getBrandCredentials()
 * (which already treat null/unknown as the primary brand → identical legacy behaviour).
 */

export const ALL_BRANDS = "all" as const;

/** Read the brand param from the request URL query string. */
export function brandFromQuery(request: { url: string }): string | null {
  try {
    const v = new URL(request.url).searchParams.get("brand");
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Read the brand param from a parsed JSON body, falling back to a query value. */
export function brandFromBody(body: unknown, fallback?: string | null): string | null {
  const v = (body as { brand?: unknown } | null)?.brand;
  if (typeof v === "string" && v.trim()) return v.trim();
  return fallback ?? null;
}

/** True when the param requests cross-brand aggregation. */
export function isAllBrands(brand: string | null | undefined): boolean {
  return (brand ?? "").toLowerCase() === ALL_BRANDS;
}
