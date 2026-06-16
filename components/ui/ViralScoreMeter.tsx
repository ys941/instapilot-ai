"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
type MeterVariant = "circular" | "linear";

interface ViralScoreMeterProps {
  score: number; // 0–100
  variant?: MeterVariant;
  size?: number; // px (circular only)
  className?: string;
  showLabel?: boolean;
  animationDelay?: number;
}

// ─── Color Logic ──────────────────────────────────────────────
function getScoreColor(score: number): { stroke: string; text: string; label: string; glow: string } {
  if (score <= 40) {
    return {
      stroke: "#ef4444",
      text: "#fca5a5",
      label: "Low Viral Potential",
      glow: "rgba(239,68,68,0.5)",
    };
  }
  if (score <= 70) {
    return {
      stroke: "#eab308",
      text: "#fde047",
      label: "Moderate Viral Potential",
      glow: "rgba(234,179,8,0.5)",
    };
  }
  return {
    stroke: "#22c55e",
    text: "#86efac",
    label: "High Viral Potential",
    glow: "rgba(34,197,94,0.5)",
  };
}

// ─── Circular Meter ───────────────────────────────────────────
function CircularMeter({
  score,
  size = 140,
  showLabel,
  animationDelay = 0,
}: ViralScoreMeterProps) {
  const { stroke, text, label, glow } = getScoreColor(score);
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  const [displayed, setDisplayed] = useState(0);

  // Animate number counter
  useEffect(() => {
    const delay = setTimeout(() => {
      let start = 0;
      const step = Math.ceil(score / 40);
      const interval = setInterval(() => {
        start += step;
        if (start >= score) {
          setDisplayed(score);
          clearInterval(interval);
        } else {
          setDisplayed(start);
        }
      }, 20);
      return () => clearInterval(interval);
    }, animationDelay * 1000);
    return () => clearTimeout(delay);
  }, [score, animationDelay]);

  const strokeOffset = circumference - (displayed / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={8}
          />
          {/* Fill */}
          <motion.circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: strokeOffset }}
            transition={{
              duration: 1.2,
              ease: "easeOut",
              delay: animationDelay,
            }}
            style={{
              filter: `drop-shadow(0 0 8px ${glow})`,
            }}
          />
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-3xl font-bold tabular-nums leading-none"
            style={{ color: text }}
          >
            {displayed}
          </span>
          <span className="text-[10px] text-white/40 mt-0.5">/ 100</span>
        </div>
      </div>

      {showLabel && (
        <div className="text-center">
          <p className="text-xs font-medium" style={{ color: text }}>
            {label}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Linear Meter ─────────────────────────────────────────────
function LinearMeter({
  score,
  showLabel,
  animationDelay = 0,
  className,
}: ViralScoreMeterProps) {
  const { stroke, text, label, glow } = getScoreColor(score);

  return (
    <div className={cn("w-full space-y-2", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/50">Viral Score</span>
        <motion.span
          className="text-sm font-bold tabular-nums"
          style={{ color: text }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: animationDelay + 0.4 }}
        >
          {score}
          <span className="text-xs font-normal text-white/30">/100</span>
        </motion.span>
      </div>

      {/* Bar track */}
      <div
        className="w-full h-2.5 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.07)" }}
      >
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 1.2, ease: "easeOut", delay: animationDelay }}
          style={{
            background: stroke,
            boxShadow: `0 0 12px ${glow}`,
          }}
        />
      </div>

      {/* Tick marks */}
      <div className="flex justify-between px-0.5">
        {["0", "40", "70", "100"].map((tick) => (
          <span key={tick} className="text-[9px] text-white/25">
            {tick}
          </span>
        ))}
      </div>

      {showLabel && (
        <p className="text-[11px] font-medium" style={{ color: text }}>
          {label}
        </p>
      )}
    </div>
  );
}

// ─── ViralScoreMeter ─────────────────────────────────────────
export default function ViralScoreMeter({
  score,
  variant = "circular",
  size = 140,
  className,
  showLabel = true,
  animationDelay = 0,
}: ViralScoreMeterProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  return (
    <div className={cn("flex items-center justify-center", className)}>
      {variant === "circular" ? (
        <CircularMeter
          score={clampedScore}
          size={size}
          showLabel={showLabel}
          animationDelay={animationDelay}
        />
      ) : (
        <LinearMeter
          score={clampedScore}
          showLabel={showLabel}
          animationDelay={animationDelay}
          className="w-full"
        />
      )}
    </div>
  );
}
