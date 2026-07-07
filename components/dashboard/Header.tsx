"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Bell, X, CheckCircle, AlertCircle, Calendar,
  Zap, ChevronDown, User, Settings, LogOut, MessageCircle,
  AtSign, Menu,
} from "lucide-react";
import BrandSwitcher from "./BrandSwitcher";
import { useBrand } from "@/components/BrandContext";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveNotification {
  id:        string;
  type:      string;   // "dm" | "comment" | "mention" | "success" | "info" | "warning"
  message:   string;
  detail:    string;
  action:    string;
  createdAt: string;
  read:      boolean;
}

// ─── Page meta ────────────────────────────────────────────────────────────────
const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/overview":        { title: "Overview",         subtitle: "Your content hub" },
  "/generator":       { title: "AI Generator",     subtitle: "Create AI-powered content" },
  "/scheduler":       { title: "Scheduler",        subtitle: "Plan your content calendar" },
  "/analytics":       { title: "Analytics",        subtitle: "Track your performance" },
  "/content-library": { title: "Content Library",  subtitle: "Manage your posts" },
  "/activity":        { title: "Activity",         subtitle: "Recent platform events" },
  "/media":           { title: "Media Folder",     subtitle: "Upload & manage your media" },
  "/settings":        { title: "Settings",         subtitle: "Configure your account" },
};

// ─── Icon map ─────────────────────────────────────────────────────────────────
function NotifIcon({ type }: { type: string }) {
  if (type === "dm")      return <MessageCircle size={14} className="text-blue-400" />;
  if (type === "comment") return <MessageCircle size={14} className="text-purple-400" />;
  if (type === "mention") return <AtSign        size={14} className="text-yellow-400" />;
  if (type === "success") return <CheckCircle   size={14} className="text-green-400" />;
  if (type === "warning") return <AlertCircle   size={14} className="text-yellow-400" />;
  return <Zap size={14} className="text-blue-400" />;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Toast popup ─────────────────────────────────────────────────────────────
function Toast({ notif, onClose }: { notif: LiveNotification; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0,  scale: 1    }}
      exit={{    opacity: 0, x: 80, scale: 0.95 }}
      transition={{ type: "spring", bounce: 0.3 }}
      className="fixed bottom-6 right-6 z-[9999] flex items-start gap-3 px-4 py-3 rounded-2xl border border-white/10 shadow-2xl max-w-xs"
      style={{ background: "rgb(var(--surface-rgb) / 0.98)", backdropFilter: "blur(24px)" }}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-white/[0.05] flex items-center justify-center mt-0.5">
        <NotifIcon type={notif.type} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white">{notif.message}</p>
        {notif.detail && (
          <p className="text-[11px] text-white/50 mt-0.5 truncate">{notif.detail}</p>
        )}
      </div>
      <button onClick={onClose} className="flex-shrink-0 text-white/30 hover:text-white transition-colors mt-0.5">
        <X size={13} />
      </button>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Header({
  onMobileMenuToggle,
}: {
  onMobileMenuToggle?: () => void;
}) {
  const pathname  = usePathname();
  const router    = useRouter();
  const brand     = useBrand();
  const pageInfo  = pageTitles[pathname] ?? { title: "Dashboard", subtitle: "" };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // Hard redirect so the browser sends the now-cleared session cookie to the
    // middleware on the very next request — soft navigation keeps the old
    // cached route and the session appears to persist.
    window.location.href = "/login";
  };

  const [searchOpen,         setSearchOpen]         = useState(false);
  const [searchQuery,        setSearchQuery]        = useState("");
  const [showNotifications,  setShowNotifications]  = useState(false);
  const [showUserMenu,       setShowUserMenu]       = useState(false);

  // ── Live notifications state ──────────────────────────────────────────────
  const [notifs,   setNotifs]   = useState<LiveNotification[]>([]);
  const [toast,    setToast]    = useState<LiveNotification | null>(null);
  const lastIdRef              = useRef<string>("");
  const esRef                  = useRef<EventSource | null>(null);

  const unreadCount = notifs.filter((n) => !n.read).length;

  // ── Request browser notification permission ───────────────────────────────
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  // ── SSE connection ────────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (esRef.current) esRef.current.close();

    const url = lastIdRef.current
      ? `/api/notifications/stream?after=${lastIdRef.current}`
      : `/api/notifications/stream`;

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("notification", (e: MessageEvent) => {
      const notif: LiveNotification = JSON.parse(e.data);
      lastIdRef.current = notif.id;

      setNotifs((prev) => {
        // Avoid duplicates
        if (prev.find((n) => n.id === notif.id)) return prev;
        return [notif, ...prev].slice(0, 50); // keep max 50
      });

      // Show toast
      setToast(notif);

      // ── Broadcast to all page components so they can instant-refetch data ──
      // Pages listen to "cardioflow:activity" to invalidate their React Query cache.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cardioflow:activity", {
          detail: { type: notif.type, action: notif.action },
        }));
      }

      // Browser push notification
      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        new Notification(notif.message, {
          body: notif.detail || undefined,
          icon: "/favicon.ico",
        });
      }
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 5 s
      setTimeout(connectSSE, 5_000);
    };
  }, []);

  useEffect(() => {
    connectSSE();
    return () => esRef.current?.close();
  }, [connectSSE]);

  const markAllRead = () =>
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));

  const markRead = (id: string) =>
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));

  return (
    <>
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 lg:px-8 h-16 border-b border-white/[0.05]"
        style={{
          background: "rgb(var(--bg-rgb) / 0.8)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        {/* Left: hamburger (mobile only) + page title */}
        <div className="flex items-center gap-3">
          {/* Hamburger — mobile only */}
          {onMobileMenuToggle && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onMobileMenuToggle}
              className="md:hidden flex-shrink-0 w-9 h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              <Menu size={18} />
            </motion.button>
          )}

          {/* Page title */}
          <motion.div
            key={pathname}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h1 className="text-base lg:text-lg font-bold text-white leading-none" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
              {pageInfo.title}
            </h1>
            {pageInfo.subtitle && (
              <p className="text-xs text-white/40 mt-0.5 hidden sm:block">{pageInfo.subtitle}</p>
            )}
          </motion.div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 lg:gap-3">
          {/* Account (brand) switcher — visible on every page */}
          <BrandSwitcher />

          {/* Search */}
          <div className="relative hidden sm:block">
            <AnimatePresence>
              {searchOpen ? (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 280, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0.1, duration: 0.3 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden"
                >
                  <Search size={14} className="text-white/40 flex-shrink-0" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search content, posts..."
                    className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none"
                  />
                  <button
                    onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                    className="text-white/40 hover:text-white transition-colors"
                  >
                    <X size={14} />
                  </button>
                </motion.div>
              ) : (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setSearchOpen(true)}
                  className="w-9 h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-all"
                >
                  <Search size={16} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Notifications bell */}
          <div className="relative">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { setShowNotifications(!showNotifications); setShowUserMenu(false); }}
              className="relative w-9 h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-to-r from-red-500 to-pink-500 flex items-center justify-center text-[9px] font-bold text-white"
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </motion.span>
              )}
            </motion.button>

            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-12 w-80 rounded-2xl border border-white/[0.08] overflow-hidden z-[60]"
                  style={{
                    background: "rgb(var(--surface-rgb) / 0.98)",
                    backdropFilter: "blur(24px)",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                  }}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                    <span className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
                      Notifications
                    </span>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto">
                    {notifs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-white/20">
                        <Bell size={28} className="mb-2" />
                        <p className="text-xs">No notifications yet</p>
                      </div>
                    ) : (
                      notifs.map((n, i) => (
                        <motion.div
                          key={n.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          onClick={() => markRead(n.id)}
                          className={`flex gap-3 px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer ${
                            !n.read ? "bg-white/[0.02]" : ""
                          }`}
                        >
                          <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center mt-0.5">
                            <NotifIcon type={n.type} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium ${n.read ? "text-white/60" : "text-white"}`}>
                              {n.message}
                            </p>
                            {n.detail && (
                              <p className="text-[11px] text-white/30 mt-0.5 truncate">{n.detail}</p>
                            )}
                            <p className="text-[10px] text-white/20 mt-1">{timeAgo(n.createdAt)}</p>
                          </div>
                          {!n.read && (
                            <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5" />
                          )}
                        </motion.div>
                      ))
                    )}
                  </div>

                  <div className="px-4 py-2.5 border-t border-white/[0.04]">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${esRef.current?.readyState === 1 ? "bg-green-500" : "bg-yellow-500"} animate-pulse`} />
                      <span className="text-[10px] text-white/20">
                        {esRef.current?.readyState === 1 ? "Live  -  connected" : "Reconnecting..."}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* User menu */}
          <div className="relative">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifications(false); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-all"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center">
                <User size={12} className="text-white" />
              </div>
              <span className="text-xs font-medium text-white/70 hidden sm:block">{brand.displayName}</span>
              <ChevronDown size={12} className="text-white/40" />
            </motion.button>

            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-12 w-48 rounded-2xl border border-white/[0.08] overflow-hidden z-[60]"
                  style={{
                    background: "rgb(var(--surface-rgb) / 0.98)",
                    backdropFilter: "blur(24px)",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                  }}
                >
                  {[
                    { icon: User,     label: "Profile",  href: "/settings" },
                    { icon: Settings, label: "Settings", href: "/settings" },
                  ].map(({ icon: Icon, label, href }) => (
                    <button
                      key={label}
                      onClick={() => { setShowUserMenu(false); router.push(href); }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors"
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                  <div className="border-t border-white/[0.06] mt-1">
                    <button
                      onClick={() => { setShowUserMenu(false); handleLogout(); }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-colors"
                    >
                      <LogOut size={14} />
                      Sign out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Click outside to close */}
        {(showNotifications || showUserMenu) && (
          <div
            className="fixed inset-0 z-30"
            onClick={() => { setShowNotifications(false); setShowUserMenu(false); }}
          />
        )}
      </header>

      {/* Toast popup */}
      <AnimatePresence>
        {toast && (
          <Toast key={toast.id} notif={toast} onClose={() => setToast(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
