"use client";

import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

// ─── ThemeToggle ──────────────────────────────────────────────
// Animated dark/light mode toggle using next-themes.
// Shows a sun icon for light mode and a moon icon for dark mode
// with a smooth swap animation using AnimatePresence.
// ──────────────────────────────────────────────────────────────

export default function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className="w-9 h-9 rounded-xl"
        style={{ background: "rgba(255,255,255,0.06)" }}
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <motion.button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors overflow-hidden ${className ?? ""}`}
      style={{
        background: isDark
          ? "rgba(147,51,234,0.15)"
          : "rgba(234,179,8,0.15)",
        border: isDark
          ? "1px solid rgba(147,51,234,0.3)"
          : "1px solid rgba(234,179,8,0.3)",
      }}
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="moon"
            initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
            transition={{ duration: 0.22 }}
          >
            <Moon className="w-4 h-4 text-purple-300" />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ opacity: 0, rotate: 90, scale: 0.5 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: -90, scale: 0.5 }}
            transition={{ duration: 0.22 }}
          >
            <Sun className="w-4 h-4 text-yellow-400" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Glow overlay on hover */}
      <motion.div
        className="absolute inset-0 rounded-xl pointer-events-none"
        style={{
          background: isDark
            ? "radial-gradient(circle, rgba(147,51,234,0.2) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(234,179,8,0.2) 0%, transparent 70%)",
        }}
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />
    </motion.button>
  );
}
