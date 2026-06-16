"use client";

/**
 * Client-side brand context. Fetches the active brand config from
 * /api/settings/brand once and exposes it to all client components (sidebar,
 * chat widget, post previews, page headings, …) so the whole UI re-skins to
 * whatever the user configured in Settings → Brand.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export interface ClientContentType {
  label: string;
  description: string;
  enabled: boolean;
}

export interface ClientBrand {
  appName: string;
  tagline: string;
  niche: string;
  handle: string;        // without @
  displayName: string;
  accent: string;
  accent2: string;
  configured: boolean;
  /** YouTube handle without @ (falls back to IG handle in UI where relevant). */
  youtubeHandle: string;
  youtubeChannelName: string;
  /** Per-type config keyed by internal id (EDUCATIONAL, QUIZ, …). */
  contentTypes: Record<string, ClientContentType>;
}

const NEUTRAL: ClientBrand = {
  appName: "InstaPilot AI",
  tagline: "AI-powered Instagram content automation",
  niche: "your topic",
  handle: "yourhandle",
  displayName: "the creator",
  accent: "#6366f1",
  accent2: "#818cf8",
  configured: false,
  youtubeHandle: "",
  youtubeChannelName: "",
  contentTypes: {},
};

const BrandCtx = createContext<{ brand: ClientBrand; reload: () => void }>({
  brand: NEUTRAL,
  reload: () => {},
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<ClientBrand>(NEUTRAL);

  const load = () => {
    // Follow the account selected in the header switcher (multi-account). The id
    // is persisted in localStorage by useSelectedBrand; "all"/empty → primary.
    let url = "/api/settings/brand";
    try {
      const sel = typeof window !== "undefined" ? window.localStorage.getItem("cf_selected_brand") : null;
      if (sel && sel !== "all") url += `?brand=${encodeURIComponent(sel)}`;
    } catch { /* ignore */ }
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && d.data) {
          const b = d.data;
          setBrand({
            appName:     b.appName     ?? NEUTRAL.appName,
            tagline:     b.tagline     ?? NEUTRAL.tagline,
            niche:       b.niche       ?? NEUTRAL.niche,
            handle:      (b.persona?.handle ?? NEUTRAL.handle).replace(/^@/, ""),
            displayName: b.persona?.displayName ?? NEUTRAL.displayName,
            accent:      b.colors?.accent  ?? NEUTRAL.accent,
            accent2:     b.colors?.accent2 ?? NEUTRAL.accent2,
            configured:  Boolean(b.configured),
            youtubeHandle: (b.youtube?.handle ?? "").replace(/^@/, ""),
            youtubeChannelName: b.youtube?.channelName ?? "",
            contentTypes: b.contentTypes ?? {},
          });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    // Re-skin the chrome whenever the user switches accounts in the header.
    const onChange = () => load();
    if (typeof window !== "undefined") window.addEventListener("cf-brandchange", onChange);
    return () => { if (typeof window !== "undefined") window.removeEventListener("cf-brandchange", onChange); };
  }, []);

  return <BrandCtx.Provider value={{ brand, reload: load }}>{children}</BrandCtx.Provider>;
}

/** Access the active brand in any client component. */
export function useBrand(): ClientBrand {
  return useContext(BrandCtx).brand;
}

/** Access the brand plus a reload() to refetch after saving Settings → Brand. */
export function useBrandContext() {
  return useContext(BrandCtx);
}
