"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: number | string;
  change?: number;
  suffix?: string;
  prefix?: string;
  icon: React.ElementType;
  color: "red" | "pink" | "purple" | "blue" | "green";
  trend?: "up" | "down" | "neutral";
  animateValue?: boolean;
  index?: number;
}

const colorMap = {
  red: {
    icon: "text-red-400",
    iconBg: "bg-red-500/10",
    glow: "rgba(239,68,68,0.15)",
    border: "rgba(239,68,68,0.2)",
    badge: "bg-red-500/10 text-red-400",
  },
  pink: {
    icon: "text-pink-400",
    iconBg: "bg-pink-500/10",
    glow: "rgba(236,72,153,0.15)",
    border: "rgba(236,72,153,0.2)",
    badge: "bg-pink-500/10 text-pink-400",
  },
  purple: {
    icon: "text-purple-400",
    iconBg: "bg-purple-500/10",
    glow: "rgba(147,51,234,0.15)",
    border: "rgba(147,51,234,0.2)",
    badge: "bg-purple-500/10 text-purple-400",
  },
  blue: {
    icon: "text-blue-400",
    iconBg: "bg-blue-500/10",
    glow: "rgba(59,130,246,0.15)",
    border: "rgba(59,130,246,0.2)",
    badge: "bg-blue-500/10 text-blue-400",
  },
  green: {
    icon: "text-emerald-400",
    iconBg: "bg-emerald-500/10",
    glow: "rgba(16,185,129,0.15)",
    border: "rgba(16,185,129,0.2)",
    badge: "bg-emerald-500/10 text-emerald-400",
  },
};

function AnimatedNumber({
  target,
  prefix = "",
  suffix = "",
}: {
  target: number;
  prefix?: string;
  suffix?: string;
}) {
  const [current, setCurrent] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const duration = 1200;
    const start = performance.now();

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(eased * target));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target]);

  const formatted =
    current >= 1_000_000
      ? `${(current / 1_000_000).toFixed(1)}M`
      : current >= 1_000
        ? `${(current / 1_000).toFixed(1)}K`
        : current.toString();

  return (
    <span>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" },
  }),
};

export default function StatsCard({
  title,
  value,
  change,
  suffix = "",
  prefix = "",
  icon: Icon,
  color,
  trend,
  animateValue = true,
  index = 0,
}: StatsCardProps) {
  const colors = colorMap[color];
  const numericValue = typeof value === "number" ? value : parseFloat(value as string) || 0;
  const isPositive = (change ?? 0) >= 0;

  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover={{
        scale: 1.02,
        boxShadow: `0 8px 40px ${colors.glow}`,
      }}
      transition={{ duration: 0.2 }}
      className="relative rounded-2xl p-5 overflow-hidden cursor-default"
      style={{
        background: "rgba(17,17,24,0.8)",
        backdropFilter: "blur(20px)",
        border: `1px solid rgba(255,255,255,0.07)`,
      }}
    >
      {/* Hover border gradient */}
      <motion.div
        className="absolute inset-0 rounded-2xl opacity-0 pointer-events-none"
        whileHover={{ opacity: 1 }}
        style={{
          background: `linear-gradient(135deg, ${colors.glow}, transparent)`,
          border: `1px solid ${colors.border}`,
        }}
        transition={{ duration: 0.2 }}
      />

      {/* Corner glow */}
      <div
        className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${colors.glow.replace("0.15", "0.6")} 0%, transparent 70%)`,
        }}
      />

      <div className="relative z-10 flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
            {title}
          </p>
          <div
            className="text-2xl font-bold text-white mb-2"
            style={{ fontFamily: "Sora, sans-serif" }}
          >
            {animateValue && typeof value === "number" ? (
              <AnimatedNumber
                target={numericValue}
                prefix={prefix}
                suffix={suffix}
              />
            ) : (
              <span>
                {prefix}
                {value}
                {suffix}
              </span>
            )}
          </div>

          {change !== undefined && (
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold",
                  isPositive
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400"
                )}
              >
                {isPositive ? (
                  <TrendingUp size={10} />
                ) : (
                  <TrendingDown size={10} />
                )}
                {isPositive ? "+" : ""}
                {change.toFixed(1)}%
              </div>
              <span className="text-xs text-white/25">vs last week</span>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center",
            colors.iconBg
          )}
        >
          <Icon size={20} className={colors.icon} />
        </div>
      </div>

      {/* Subtle bottom bar */}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5 opacity-50"
        style={{
          background: `linear-gradient(90deg, transparent, ${colors.glow.replace("0.15", "0.8")}, transparent)`,
        }}
      />
    </motion.div>
  );
}
