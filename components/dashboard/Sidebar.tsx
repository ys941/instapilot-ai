"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import {
  LayoutDashboard,
  Sparkles,
  Calendar,
  BarChart2,
  Library,
  Activity,
  Settings,
  Heart,
  LogOut,
  ChevronLeft,
  ChevronRight,
  User,
  FolderOpen,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrand } from "@/components/BrandContext";

const navItems = [
  { href: "/overview",       label: "Overview",        icon: LayoutDashboard },
  { href: "/generator",      label: "AI Generator",    icon: Sparkles },
  { href: "/scheduler",      label: "Scheduler",       icon: Calendar },
  { href: "/analytics",      label: "Analytics",       icon: BarChart2 },
  { href: "/content-library",label: "Content Library", icon: Library },
  { href: "/activity",       label: "Activity",        icon: Activity },
  { href: "/media",          label: "Media Folder",    icon: FolderOpen },
  { href: "/settings",       label: "Settings",        icon: Settings },
];

// ─── Nav item (desktop) ────────────────────────────────────────────────────────
function NavItem({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  onClick,
}: {
  href:      string;
  label:     string;
  icon:      React.ElementType;
  active:    boolean;
  collapsed: boolean;
  onClick?:  () => void;
}) {
  const x       = useMotionValue(0);
  const y       = useMotionValue(0);
  const rotateX = useTransform(y, [-10, 10], [2, -2]);
  const rotateY = useTransform(x, [-10, 10], [-2, 2]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - rect.left - rect.width / 2);
    y.set(e.clientY - rect.top  - rect.height / 2);
  };
  const handleMouseLeave = () => { x.set(0); y.set(0); };

  return (
    <motion.div style={{ rotateX, rotateY, transformPerspective: 800 }}>
      <Link href={href} onClick={onClick}>
        <motion.div
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer relative group",
            collapsed ? "justify-center px-2" : "",
            active
              ? "bg-gradient-to-r from-red-500/20 via-pink-500/15 to-purple-600/10 border border-red-500/20 text-white"
              : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
          )}
        >
          {active && (
            <motion.div
              layoutId="active-sidebar"
              className="absolute inset-0 rounded-xl"
              style={{
                background: "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(236,72,153,0.1), rgba(147,51,234,0.08))",
                boxShadow:  "0 0 20px rgba(239,68,68,0.15)",
              }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            />
          )}
          {active && (
            <motion.div
              layoutId="active-bar"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-gradient-to-b from-red-500 to-pink-500"
              style={{ boxShadow: "0 0 8px rgba(239,68,68,0.6)" }}
            />
          )}
          <span className={cn("relative z-10", active ? "text-white" : "")}>
            <Icon
              size={18}
              className={cn(active ? "text-red-400" : "text-white/40 group-hover:text-white/70")}
            />
          </span>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2 }}
                className="relative z-10 text-sm font-medium whitespace-nowrap overflow-hidden"
              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </Link>
    </motion.div>
  );
}

// ─── Mobile nav item (full-width, always expanded) ────────────────────────────
function MobileNavItem({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href:    string;
  label:   string;
  icon:    React.ElementType;
  active:  boolean;
  onClick: () => void;
}) {
  return (
    <Link href={href} onClick={onClick}>
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 cursor-pointer relative",
          active
            ? "bg-gradient-to-r from-red-500/20 via-pink-500/15 to-purple-600/10 border border-red-500/20 text-white"
            : "text-white/55 active:bg-white/[0.06]"
        )}
      >
        {active && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-gradient-to-b from-red-500 to-pink-500"
            style={{ boxShadow: "0 0 8px rgba(239,68,68,0.6)" }}
          />
        )}
        <Icon size={19} className={active ? "text-red-400" : "text-white/45"} />
        <span className="text-sm font-medium">{label}</span>
      </div>
    </Link>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen:    boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const router   = useRouter();
  const brand    = useBrand();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    onMobileClose();
    await fetch("/api/auth/logout", { method: "POST" });
    // Hard redirect — same as Header — forces browser to re-read cleared cookie
    // through the new middleware so the session is truly gone.
    window.location.href = "/login";
  };

  // ── Desktop sidebar ──────────────────────────────────────────────────────────
  const desktopSidebar = (
    <motion.aside
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ type: "spring", bounce: 0.1, duration: 0.4 }}
      className="hidden md:flex fixed left-0 top-0 h-screen z-50 flex-col overflow-hidden"
      style={{
        background:            "rgba(10,10,15,0.85)",
        backdropFilter:        "blur(24px)",
        WebkitBackdropFilter:  "blur(24px)",
        borderRight:           "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-5 border-b border-white/[0.05]",
          collapsed ? "justify-center px-3" : ""
        )}
      >
        <motion.div
          whileHover={{ scale: 1.1 }}
          className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 via-pink-500 to-purple-600 flex items-center justify-center"
          style={{ boxShadow: "0 0 20px rgba(239,68,68,0.4)" }}
        >
          <Heart size={18} className="text-white fill-white" />
        </motion.div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <p className="font-bold text-base leading-tight gradient-text" style={{ fontFamily: "Sora, sans-serif" }}>
                {brand.appName}
              </p>
              <p className="text-[10px] text-white/30 font-medium tracking-widest uppercase">AI Platform</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* User + logout section */}
      <div className="border-t border-white/[0.05] p-3">
        <div
          className={cn(
            "flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.04] transition-colors",
            collapsed ? "justify-center" : ""
          )}
        >
          {/* Avatar */}
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center">
            <User size={14} className="text-white" />
          </div>

          {/* Name + email (expanded) */}
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0"
              >
                <p className="text-xs font-medium text-white truncate">{brand.displayName}</p>
                <p className="text-[10px] text-white/30 truncate">{`@${brand.handle}`}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Logout — always visible, icon + text when expanded, icon-only when collapsed */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={handleLogout}
            className={cn(
              "flex-shrink-0 flex items-center gap-1.5 rounded-lg transition-colors",
              collapsed
                ? "w-8 h-8 justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10"
                : "px-2 py-1 text-white/30 hover:text-red-400 hover:bg-red-500/10"
            )}
            title="Sign out"
          >
            <LogOut size={14} />
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.15 }}
                  className="text-[11px] font-medium whitespace-nowrap overflow-hidden"
                >
                  Sign out
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>

      {/* Collapse toggle */}
      <motion.button
        onClick={() => setCollapsed(!collapsed)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full border border-white/10 bg-[#111118] flex items-center justify-center text-white/40 hover:text-white hover:border-white/20 transition-colors z-50"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </motion.button>
    </motion.aside>
  );

  // ── Mobile drawer (slide in from left) ───────────────────────────────────────
  const mobileSidebar = (
    <AnimatePresence>
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm md:hidden"
            onClick={onMobileClose}
          />

          {/* Drawer panel */}
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", bounce: 0.1, duration: 0.35 }}
            className="fixed left-0 top-0 h-screen w-72 z-[70] flex flex-col md:hidden"
            style={{
              background:           "rgba(10,10,15,0.97)",
              backdropFilter:       "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              borderRight:          "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between px-4 py-5 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 via-pink-500 to-purple-600 flex items-center justify-center"
                  style={{ boxShadow: "0 0 20px rgba(239,68,68,0.4)" }}
                >
                  <Heart size={18} className="text-white fill-white" />
                </div>
                <div>
                  <p className="font-bold text-base leading-tight gradient-text" style={{ fontFamily: "Sora, sans-serif" }}>
                    {brand.appName}
                  </p>
                  <p className="text-[10px] text-white/30 font-medium tracking-widest uppercase">AI Platform</p>
                </div>
              </div>
              <button
                onClick={onMobileClose}
                className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
              {navItems.map((item) => (
                <MobileNavItem
                  key={item.href}
                  {...item}
                  active={pathname === item.href}
                  onClick={onMobileClose}
                />
              ))}
            </nav>

            {/* User + Sign out */}
            <div className="border-t border-white/[0.06] p-4 space-y-3">
              {/* User card */}
              <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center flex-shrink-0">
                  <User size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{brand.displayName}</p>
                  <p className="text-[11px] text-white/35 truncate">{`@${brand.handle}`}</p>
                </div>
              </div>

              {/* Sign out button — large, easy to tap on mobile */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-sm font-semibold text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 active:bg-red-500/15 transition-colors"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {desktopSidebar}
      {mobileSidebar}
    </>
  );
}
