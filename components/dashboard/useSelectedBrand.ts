"use client";

/**
 * useSelectedBrand — client hook for multi-brand (multi-account) support.
 *
 * A "brand" = a paired Instagram account + YouTube channel. The env-seeded
 * account is the PRIMARY brand. This hook is the single source of truth for
 * which brand the dashboard is currently scoped to.
 *
 * It:
 *   - loads the brand list from `GET /api/brands`
 *   - reads/persists the chosen brand in localStorage (`cf_selected_brand`)
 *   - exposes `setBrand()` which persists + broadcasts a `cf-brandchange` event
 *   - listens for `cf-brandchange` so EVERY consumer stays in sync across the app
 *
 * Backward compatibility: when no extra brand exists / "Primary" is selected,
 * the resolved brandId is the primary brand id and `withBrand()` appends
 * `?brand=<primaryId>` which the backend treats identically to omitting it.
 */

import { useCallback, useEffect, useState } from "react";

// ─── Types (mirror lib/brands.ts BrandRecord — kept local so this client file
//     never imports the server-only module) ────────────────────────────────────
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

/** localStorage key holding the selected brand id, or the literal "all". */
export const SELECTED_BRAND_KEY = "cf_selected_brand";
/** Custom event broadcast on every brand change. */
export const BRAND_CHANGE_EVENT = "cf-brandchange";
/** Sentinel meaning "aggregate across all accounts" (read-only views). */
export const ALL_BRANDS = "all";

export interface BrandChangeDetail {
  brandId: string; // a brand id OR the literal "all"
}

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_BRAND_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_BRAND_KEY, value);
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export interface UseSelectedBrand {
  /** The selected brand id, or "all". Defaults to the primary brand id. */
  brandId: string;
  /** True when the aggregate ("All accounts") view is selected. */
  isAll: boolean;
  /** All brands from the API (primary first). */
  brands: BrandRecord[];
  /** The full record of the currently-selected brand (null when "all"). */
  selected: BrandRecord | null;
  /** Persist + broadcast a new selection. */
  setBrand: (id: string) => void;
  /** True once brands have loaded and the stored choice has been resolved. */
  ready: boolean;
  /** Re-fetch the brand list (e.g. after add/edit/delete in Settings). */
  refresh: () => void;
}

let _brandsCache: BrandRecord[] | null = null;

export function useSelectedBrand(): UseSelectedBrand {
  const [brands, setBrands]   = useState<BrandRecord[]>(_brandsCache ?? []);
  const [brandId, setBrandId] = useState<string>("");
  const [ready, setReady]     = useState<boolean>(false);

  // ── Resolve the stored choice against the loaded list ──────────────────────
  const resolve = useCallback((list: BrandRecord[], stored: string | null): string => {
    const primary = list.find((b) => b.isPrimary) ?? list[0];
    if (stored === ALL_BRANDS) return ALL_BRANDS;
    if (stored && list.some((b) => b.id === stored)) return stored;
    return primary?.id ?? "";
  }, []);

  // ── Load brand list ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/brands");
      const json = await res.json();
      // The API may return a bare array OR { data: [...] } — accept both.
      const list: BrandRecord[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.data)
          ? json.data
          : [];
      _brandsCache = list;
      setBrands(list);
      setBrandId((prev) => resolve(list, prev || readStored()));
    } catch {
      // Network/early-boot failure — leave empty; consumers fall back to primary.
      setBrands([]);
    } finally {
      setReady(true);
    }
  }, [resolve]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Stay in sync with other components ─────────────────────────────────────
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<BrandChangeDetail>).detail;
      if (detail?.brandId) setBrandId(detail.brandId);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SELECTED_BRAND_KEY && e.newValue) setBrandId(e.newValue);
    };
    window.addEventListener(BRAND_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BRAND_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setBrand = useCallback((id: string) => {
    setBrandId(id);
    writeStored(id);
    window.dispatchEvent(
      new CustomEvent<BrandChangeDetail>(BRAND_CHANGE_EVENT, { detail: { brandId: id } }),
    );
  }, []);

  const isAll    = brandId === ALL_BRANDS;
  const selected = isAll ? null : brands.find((b) => b.id === brandId) ?? null;

  return { brandId, isAll, brands, selected, setBrand, ready, refresh: load };
}

/**
 * Append the brand scope to an API URL.
 *
 * - "all" → `?brand=all` (aggregate read views)
 * - a real id → `?brand=<id>`
 * - empty (not yet resolved) → URL unchanged (backend defaults to primary)
 */
export function withBrand(url: string, brandId: string): string {
  if (!brandId) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}brand=${encodeURIComponent(brandId)}`;
}
