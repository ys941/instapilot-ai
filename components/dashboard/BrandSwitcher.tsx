"use client";

/**
 * BrandSwitcher — dropdown that scopes the whole dashboard to one account
 * ("brand") or to the aggregate "All accounts" view.
 *
 * Mounted in the dashboard Header so it's visible on every page. On change it
 * persists to localStorage and broadcasts `cf-brandchange` (handled by
 * useSelectedBrand) AND calls router.refresh() so any server components re-render.
 *
 * Backward compatibility: when only the primary brand exists, the control still
 * renders but reads exactly like today (single account shown, primary selected).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check, Instagram, Youtube, Layers, Building2 } from "lucide-react";
import { useSelectedBrand, ALL_BRANDS, type BrandRecord } from "./useSelectedBrand";

function BrandIcon({ brand }: { brand: BrandRecord }) {
  return (
    <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-red-500/30 to-pink-600/20 flex items-center justify-center flex-shrink-0">
      <Building2 size={12} className="text-red-400" />
    </div>
  );
}

export default function BrandSwitcher() {
  const router = useRouter();
  const { brandId, isAll, brands, selected, setBrand, ready } = useSelectedBrand();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = (id: string) => {
    setBrand(id);
    setOpen(false);
    // Refresh server components so per-brand server data re-renders too.
    router.refresh();
  };

  // While loading, render a neutral placeholder so layout doesn't jump.
  const label = !ready
    ? "Loading…"
    : isAll
      ? "All accounts"
      : selected?.label ?? selected?.igUsername ?? "Account";

  // Single-account (only primary) — still show the control, just non-fussy.
  const multi = brands.length > 1;

  return (
    <div className="relative" ref={ref}>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2.5 lg:px-3 py-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-all max-w-[180px]"
        title="Switch account"
      >
        {isAll ? (
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500/30 to-indigo-600/20 flex items-center justify-center flex-shrink-0">
            <Layers size={12} className="text-purple-400" />
          </div>
        ) : selected ? (
          <BrandIcon brand={selected} />
        ) : (
          <div className="w-6 h-6 rounded-lg bg-white/[0.05] flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-white/80 truncate hidden sm:block">{label}</span>
        <ChevronDown size={12} className="text-white/40 flex-shrink-0" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-12 w-64 rounded-2xl border border-white/[0.08] overflow-hidden z-50"
            style={{
              background: "rgb(var(--surface-rgb) / 0.98)",
              backdropFilter: "blur(24px)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div className="px-4 py-2.5 border-b border-white/[0.06]">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                Accounts
              </span>
            </div>

            <div className="max-h-80 overflow-y-auto py-1">
              {brands.map((b) => {
                const active = !isAll && b.id === brandId;
                return (
                  <button
                    key={b.id}
                    onClick={() => choose(b.id)}
                    className={`flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors ${
                      active ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <BrandIcon brand={b} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-white truncate">{b.label}</p>
                        {b.isPrimary && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20 flex-shrink-0">
                            Primary
                          </span>
                        )}
                        {!b.active && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.05] text-white/40 flex-shrink-0">
                            Off
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {b.igUsername && (
                          <span className="flex items-center gap-1 text-[10px] text-white/35">
                            <Instagram size={9} /> {b.igUsername}
                          </span>
                        )}
                        {b.hasYouTube && (
                          <span className="flex items-center gap-1 text-[10px] text-white/35">
                            <Youtube size={9} /> {b.ytChannelTitle || "YouTube"}
                          </span>
                        )}
                      </div>
                    </div>
                    {active && <Check size={14} className="text-red-400 flex-shrink-0" />}
                  </button>
                );
              })}

              {/* All accounts — aggregate read view */}
              {brands.length > 1 && (
                <>
                  <div className="my-1 border-t border-white/[0.06]" />
                  <button
                    onClick={() => choose(ALL_BRANDS)}
                    className={`flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors ${
                      isAll ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500/30 to-indigo-600/20 flex items-center justify-center flex-shrink-0">
                      <Layers size={12} className="text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">All accounts</p>
                      <p className="text-[10px] text-white/35 mt-0.5">Aggregate view (read-only)</p>
                    </div>
                    {isAll && <Check size={14} className="text-purple-400 flex-shrink-0" />}
                  </button>
                </>
              )}
            </div>

            <div className="px-4 py-2 border-t border-white/[0.06]">
              <a
                href="/settings?tab=accounts"
                className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
              >
                Manage accounts →
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
