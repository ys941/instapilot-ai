"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  CheckCircle2,
  MessageSquare,
  AlertTriangle,
  BarChart2,
  Send,
  X,
  Check,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── SSE Notification shape (from /api/notifications/stream) ─────────────────
interface SseNotif {
  id:        string;
  type:      "comment" | "dm" | "mention" | "success" | "info" | "error";
  message:   string;   // e.g. "🗨️ New comment on your post"
  detail:    string;   // e.g. comment text or username
  entityId?: string;
  action:    string;
  createdAt: string;
  read:      boolean;
}

// ─── Display config per type ─────────────────────────────────────────────────
const TYPE_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; bg: string; actionUrl: string }
> = {
  comment: { icon: MessageSquare, color: "#3b82f6", bg: "rgba(59,130,246,0.15)",  actionUrl: "/analytics" },
  dm:      { icon: Send,          color: "#a855f7", bg: "rgba(168,85,247,0.15)",  actionUrl: "/analytics" },
  mention: { icon: Bell,          color: "#eab308", bg: "rgba(234,179,8,0.15)",   actionUrl: "/analytics" },
  success: { icon: CheckCircle2,  color: "#22c55e", bg: "rgba(34,197,94,0.15)",   actionUrl: "/posts"     },
  info:    { icon: Info,          color: "#38bdf8", bg: "rgba(56,189,248,0.15)",   actionUrl: "/posts"     },
  error:   { icon: AlertTriangle, color: "#ef4444", bg: "rgba(239,68,68,0.15)",   actionUrl: "/"          },
};
const DEFAULT_CONFIG = TYPE_CONFIG.info;

// ─── localStorage keys ───────────────────────────────────────────────────────
const LS_LAST_ID   = "notif_last_id";
const LS_READ_IDS  = "notif_read_ids";
const MAX_READ_IDS = 200; // keep last N read IDs to avoid unbounded growth

function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_READ_IDS);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function saveReadIds(ids: Set<string>) {
  try {
    const arr = [...ids].slice(-MAX_READ_IDS);
    localStorage.setItem(LS_READ_IDS, JSON.stringify(arr));
  } catch {}
}

function getLastId(): string {
  try { return localStorage.getItem(LS_LAST_ID) ?? ""; } catch { return ""; }
}

function saveLastId(id: string) {
  try { localStorage.setItem(LS_LAST_ID, id); } catch {}
}

// ─── Relative time ────────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── NotificationPanel ────────────────────────────────────────────────────────
export default function NotificationPanel() {
  const [isOpen,         setIsOpen]         = useState(false);
  const [notifications,  setNotifications]  = useState<SseNotif[]>([]);
  // IDs scheduled to vanish (marked read, fading out)
  const [vanishingIds,   setVanishingIds]   = useState<Set<string>>(new Set());
  const panelRef   = useRef<HTMLDivElement>(null);
  const esRef      = useRef<EventSource | null>(null);
  const lastIdRef  = useRef<string>("");

  // ── Connect SSE on mount ────────────────────────────────────────────────
  useEffect(() => {
    // Restore cursor from localStorage
    lastIdRef.current = getLastId();

    function connect() {
      const afterParam = lastIdRef.current ? `?after=${encodeURIComponent(lastIdRef.current)}` : "";
      const es = new EventSource(`/api/notifications/stream${afterParam}`);
      esRef.current = es;

      es.addEventListener("notification", (e: MessageEvent) => {
        try {
          const notif = JSON.parse(e.data) as SseNotif;
          // Track cursor
          lastIdRef.current = notif.id;
          saveLastId(notif.id);

          // Skip already-read/dismissed
          const readIds = getReadIds();
          if (readIds.has(notif.id)) return;

          setNotifications((prev) => {
            if (prev.some((n) => n.id === notif.id)) return prev;
            return [notif, ...prev].slice(0, 50); // keep max 50 in memory
          });
        } catch {}
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        // Reconnect after 8 s
        setTimeout(connect, 8_000);
      };
    }

    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  // ── Close panel on outside click ────────────────────────────────────────
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // ── Mark one read => auto-vanish after 1.5 s ─────────────────────────────
  const markRead = useCallback((id: string) => {
    const readIds = getReadIds();
    readIds.add(id);
    saveReadIds(readIds);

    // Start vanish animation
    setVanishingIds((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setVanishingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }, 1_500);
  }, []);

  // ── Dismiss immediately (X button) ──────────────────────────────────────
  const dismiss = useCallback((id: string) => {
    const readIds = getReadIds();
    readIds.add(id);
    saveReadIds(readIds);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ── Mark ALL read => all vanish after 1.5 s ──────────────────────────────
  const markAllRead = useCallback(() => {
    const readIds = getReadIds();
    const unread  = notifications.filter((n) => !vanishingIds.has(n.id));
    unread.forEach((n) => readIds.add(n.id));
    saveReadIds(readIds);

    setVanishingIds(new Set(unread.map((n) => n.id)));
    setTimeout(() => {
      setNotifications([]);
      setVanishingIds(new Set());
    }, 1_500);
  }, [notifications, vanishingIds]);

  const unreadCount = notifications.filter((n) => !vanishingIds.has(n.id)).length;

  return (
    <div ref={panelRef} className="relative">
      {/* ── Bell Trigger ───────────────────────────────────────────────── */}
      <motion.button
        onClick={() => setIsOpen((v) => !v)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
        style={{
          background: isOpen ? "rgb(var(--accent-rgb) / 0.12)" : "rgba(255,255,255,0.06)",
          border: `1px solid ${isOpen ? "rgb(var(--accent-rgb) / 0.3)" : "rgba(255,255,255,0.1)"}`,
        }}
      >
        <Bell className="w-4 h-4 text-white/70" />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
              style={{ background: "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-2-rgb)))" }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* ── Panel ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="absolute right-0 top-12 w-80 rounded-2xl overflow-hidden z-50"
            style={{
              background:         "rgba(12,12,22,0.95)",
              backdropFilter:     "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border:             "1px solid rgba(255,255,255,0.1)",
              boxShadow:          "0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgb(var(--accent-rgb) / 0.1)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className="flex items-center gap-2">
                <Bell className="w-3.5 h-3.5 text-brand" />
                <span className="text-sm font-semibold text-white">Notifications</span>
                {unreadCount > 0 && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-brand-light"
                    style={{ background: "rgb(var(--accent-rgb) / 0.15)" }}
                  >
                    {unreadCount} new
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-white/40 hover:text-white/70 flex items-center gap-1 transition-colors"
                >
                  <Check className="w-2.5 h-2.5" />
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-[340px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              <AnimatePresence initial={false}>
                {notifications.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="py-10 text-center text-white/30 text-sm"
                  >
                    <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    All caught up!
                  </motion.div>
                ) : (
                  notifications.map((notif, i) => {
                    const cfg = TYPE_CONFIG[notif.type] ?? DEFAULT_CONFIG;
                    const { icon: Icon, color, bg } = cfg;
                    const isVanishing = vanishingIds.has(notif.id);

                    return (
                      <motion.div
                        key={notif.id}
                        layout
                        initial={{ opacity: 0, x: 12, height: "auto" }}
                        animate={{
                          opacity: isVanishing ? 0 : 1,
                          x:       isVanishing ? -20 : 0,
                          scale:   isVanishing ? 0.95 : 1,
                        }}
                        exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
                        transition={{ duration: 0.3 }}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 relative cursor-pointer group",
                          "hover:bg-white/[0.03] transition-colors"
                        )}
                        style={{
                          borderBottom:
                            i < notifications.length - 1
                              ? "1px solid rgba(255,255,255,0.04)"
                              : "none",
                        }}
                        onClick={() => !isVanishing && markRead(notif.id)}
                      >
                        {/* Unread dot */}
                        {!isVanishing && (
                          <div
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full"
                            style={{ background: color }}
                          />
                        )}

                        {/* Icon */}
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: bg }}
                        >
                          <Icon className="w-3.5 h-3.5" style={{ color }} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white leading-snug">
                            {notif.message}
                          </p>
                          {notif.detail && (
                            <p className="text-[10px] text-white/45 leading-snug mt-0.5 line-clamp-2">
                              {notif.detail}
                            </p>
                          )}
                          <p className="text-[9px] text-white/25 mt-1" suppressHydrationWarning>
                            {relativeTime(notif.createdAt)}
                          </p>
                        </div>

                        {/* Dismiss X */}
                        <motion.button
                          onClick={(e) => { e.stopPropagation(); dismiss(notif.id); }}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-white/30 hover:text-white/60 transition-all flex-shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </motion.button>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div
              className="px-4 py-2.5 text-center"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="text-[10px] text-white/20 flex items-center justify-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                Live  -  updates automatically
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
