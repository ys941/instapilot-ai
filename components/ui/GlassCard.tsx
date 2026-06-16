"use client";

import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
type AccentColor = "red" | "pink" | "purple" | "blue" | "green" | "none";

interface GlassCardProps extends Omit<HTMLMotionProps<"div">, "ref"> {
  className?: string;
  children: React.ReactNode;
  hover?: boolean;
  glow?: AccentColor;
  padding?: "none" | "sm" | "md" | "lg";
}

// ─── Glow Colors Map ──────────────────────────────────────────
const glowColors: Record<AccentColor, string> = {
  red: "rgba(239,68,68,0.35)",
  pink: "rgba(219,39,119,0.35)",
  purple: "rgba(147,51,234,0.35)",
  blue: "rgba(59,130,246,0.35)",
  green: "rgba(34,197,94,0.35)",
  none: "transparent",
};

const borderColors: Record<AccentColor, string> = {
  red: "rgba(239,68,68,0.3)",
  pink: "rgba(219,39,119,0.3)",
  purple: "rgba(147,51,234,0.3)",
  blue: "rgba(59,130,246,0.3)",
  green: "rgba(34,197,94,0.3)",
  none: "rgba(255,255,255,0.08)",
};

const paddingStyles = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-7",
};

// ─── GlassCard ────────────────────────────────────────────────
export default function GlassCard({
  className,
  children,
  hover = false,
  glow = "none",
  padding = "md",
  style,
  ...rest
}: GlassCardProps) {
  const borderColor = borderColors[glow];
  const glowColor = glowColors[glow];

  return (
    <motion.div
      whileHover={
        hover
          ? {
              y: -3,
              boxShadow: `0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px ${borderColor}, 0 0 32px ${glowColor}`,
              borderColor,
            }
          : {}
      }
      transition={{ type: "spring", stiffness: 340, damping: 26 }}
      className={cn(
        "rounded-2xl relative overflow-hidden",
        paddingStyles[padding],
        className
      )}
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: `1px solid ${borderColor}`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)`,
        ...style,
      }}
      {...rest}
    >
      {/* Subtle inner highlight */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)",
        }}
      />
      {children}
    </motion.div>
  );
}
