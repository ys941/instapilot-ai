"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import GlowButton from "./GlowButton";

// ─── Types ────────────────────────────────────────────────────
interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: EmptyStateAction;
  icon?: React.ElementType;
  className?: string;
  illustration?: "posts" | "analytics" | "calendar" | "default";
}

// ─── SVG Illustrations ────────────────────────────────────────
function DefaultIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
      {/* Outer circle */}
      <circle cx="60" cy="60" r="50" stroke="rgba(239,68,68,0.15)" strokeWidth="1" />
      <circle cx="60" cy="60" r="38" stroke="rgba(219,39,119,0.12)" strokeWidth="1" />

      {/* Center heart */}
      <path
        d="M60 78 C60 78 38 64 38 50 C38 44 43 39 49.5 39 C53.5 39 57 41.5 60 44.5 C63 41.5 66.5 39 70.5 39 C77 39 82 44 82 50 C82 64 60 78 60 78Z"
        fill="url(#heartGrad)"
        opacity="0.5"
      />
      <defs>
        <linearGradient id="heartGrad" x1="38" y1="39" x2="82" y2="78" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ef4444" />
          <stop offset="1" stopColor="#9333ea" />
        </linearGradient>
      </defs>

      {/* Sparkle dots */}
      {[
        [24, 32], [96, 32], [24, 88], [96, 88],
        [60, 14], [60, 106],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="rgba(239,68,68,0.3)" />
      ))}
    </svg>
  );
}

function PostsIllustration() {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none">
      {/* Stacked cards */}
      {[{ x: 24, y: 30, opacity: 0.2 }, { x: 16, y: 22, opacity: 0.35 }, { x: 8, y: 14, opacity: 0.5 }].map(
        (card, i) => (
          <rect
            key={i}
            x={card.x}
            y={card.y}
            width="72"
            height="56"
            rx="8"
            fill="rgba(239,68,68,0.1)"
            stroke={`rgba(239,68,68,${card.opacity})`}
            strokeWidth="1"
          />
        )
      )}
      {/* Plus icon */}
      <circle cx="60" cy="44" r="14" fill="rgba(239,68,68,0.15)" />
      <line x1="60" y1="38" x2="60" y2="50" stroke="rgba(239,68,68,0.6)" strokeWidth="2" strokeLinecap="round" />
      <line x1="54" y1="44" x2="66" y2="44" stroke="rgba(239,68,68,0.6)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function AnalyticsIllustration() {
  const bars = [30, 55, 40, 70, 45, 80, 60];
  return (
    <svg width="120" height="80" viewBox="0 0 120 80" fill="none">
      {bars.map((h, i) => (
        <rect
          key={i}
          x={8 + i * 16}
          y={80 - h}
          width="10"
          height={h}
          rx="4"
          fill={`rgba(239,68,68,${0.2 + i * 0.1})`}
        />
      ))}
      {/* Trend line */}
      <polyline
        points="13,50 29,25 45,35 61,10 77,25 93,4 109,20"
        fill="none"
        stroke="url(#trendGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="trendGrad" x1="13" y1="50" x2="109" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ef4444" />
          <stop offset="1" stopColor="#9333ea" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function CalendarIllustration() {
  return (
    <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
      <rect x="10" y="20" width="80" height="70" rx="10" fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.3)" strokeWidth="1" />
      <rect x="10" y="20" width="80" height="22" rx="10" fill="rgba(239,68,68,0.15)" />
      <line x1="10" y1="42" x2="90" y2="42" stroke="rgba(239,68,68,0.2)" strokeWidth="1" />
      <line x1="30" y1="12" x2="30" y2="28" stroke="rgba(239,68,68,0.5)" strokeWidth="2" strokeLinecap="round" />
      <line x1="70" y1="12" x2="70" y2="28" stroke="rgba(239,68,68,0.5)" strokeWidth="2" strokeLinecap="round" />
      {/* Dots */}
      {[[28,56],[50,56],[72,56],[28,74],[50,74]].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill={i === 1 ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.12)"} />
      ))}
    </svg>
  );
}

const ILLUSTRATIONS = {
  posts: PostsIllustration,
  analytics: AnalyticsIllustration,
  calendar: CalendarIllustration,
  default: DefaultIllustration,
};

// ─── EmptyState ───────────────────────────────────────────────
export default function EmptyState({
  title,
  description,
  action,
  icon: IconComponent,
  className,
  illustration = "default",
}: EmptyStateProps) {
  const Illustration = ILLUSTRATIONS[illustration];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-8",
        className
      )}
    >
      {/* Floating illustration */}
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
        className="mb-6 relative"
      >
        {/* Glow behind illustration */}
        <div
          className="absolute inset-0 rounded-full blur-2xl"
          style={{ background: "radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)" }}
        />
        <div className="relative">
          {IconComponent ? (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <IconComponent className="w-9 h-9 text-red-400/60" />
            </div>
          ) : (
            <Illustration />
          )}
        </div>
      </motion.div>

      {/* Text */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="space-y-2 mb-6"
      >
        <h3 className="text-base font-semibold text-white/80">{title}</h3>
        {description && (
          <p className="text-sm text-white/40 max-w-xs mx-auto leading-relaxed">
            {description}
          </p>
        )}
      </motion.div>

      {/* Action */}
      {action && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <GlowButton
            variant={action.variant || "primary"}
            size="md"
            onClick={action.onClick}
          >
            {action.label}
          </GlowButton>
        </motion.div>
      )}
    </div>
  );
}
