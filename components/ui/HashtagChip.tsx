"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HashtagScore, HashtagCategory } from "@/types";

// ─── Color Map ────────────────────────────────────────────────
const CATEGORY_STYLES: Record<
  HashtagCategory,
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  high: {
    bg: "rgba(239,68,68,0.12)",
    border: "rgba(239,68,68,0.35)",
    text: "#fca5a5",
    dot: "#ef4444",
    label: "High",
  },
  medium: {
    bg: "rgba(234,179,8,0.12)",
    border: "rgba(234,179,8,0.35)",
    text: "#fde047",
    dot: "#eab308",
    label: "Medium",
  },
  niche: {
    bg: "rgba(59,130,246,0.12)",
    border: "rgba(59,130,246,0.35)",
    text: "#93c5fd",
    dot: "#3b82f6",
    label: "Niche",
  },
  trending: {
    bg: "rgba(147,51,234,0.14)",
    border: "rgba(147,51,234,0.4)",
    text: "#c4b5fd",
    dot: "#9333ea",
    label: "Trending",
  },
};

// ─── Props ────────────────────────────────────────────────────
interface HashtagChipProps {
  hashtag: HashtagScore;
  onClick?: (tag: string) => void;
  selected?: boolean;
  showScore?: boolean;
  size?: "sm" | "md";
  className?: string;
}

// ─── HashtagChip ──────────────────────────────────────────────
export default function HashtagChip({
  hashtag,
  onClick,
  selected = false,
  showScore = false,
  size = "md",
  className,
}: HashtagChipProps) {
  const [copied, setCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const styles = CATEGORY_STYLES[hashtag.category];
  const isSmall = size === "sm";

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(hashtag.tag);
        setCopied(true);
        setShowToast(true);
        setTimeout(() => {
          setCopied(false);
          setShowToast(false);
        }, 2000);
      } catch {
        // Fallback
        const el = document.createElement("textarea");
        el.value = hashtag.tag;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        setCopied(true);
        setShowToast(true);
        setTimeout(() => {
          setCopied(false);
          setShowToast(false);
        }, 2000);
      }
    },
    [hashtag.tag]
  );

  const handleClick = useCallback(() => {
    onClick?.(hashtag.tag);
  }, [onClick, hashtag.tag]);

  return (
    <div className="relative inline-block">
      {/* Chip */}
      <motion.div
        onClick={handleClick}
        whileHover={{ scale: 1.06, y: -1 }}
        whileTap={{ scale: 0.96 }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full cursor-pointer select-none group",
          "transition-all duration-150",
          isSmall ? "px-2 py-0.5 text-[10px]" : "px-3 py-1.5 text-xs",
          className
        )}
        style={{
          background: selected ? styles.dot + "30" : styles.bg,
          border: `1px solid ${selected ? styles.dot : styles.border}`,
          color: styles.text,
          boxShadow: selected ? `0 0 12px ${styles.dot}40` : "none",
        }}
      >
        {/* Category indicator dot */}
        <motion.span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: styles.dot }}
          animate={
            hashtag.category === "trending"
              ? { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }
              : {}
          }
          transition={{ duration: 1.8, repeat: Infinity }}
        />

        {/* Tag text */}
        <span className="font-medium">{hashtag.tag}</span>

        {/* Trending icon */}
        {hashtag.category === "trending" && (
          <TrendingUp className="w-2.5 h-2.5 flex-shrink-0" />
        )}

        {/* Score badge */}
        {showScore && (
          <span
            className="text-[9px] font-semibold px-1 py-0.5 rounded"
            style={{ background: "rgba(0,0,0,0.3)" }}
          >
            {hashtag.relevanceScore}
          </span>
        )}

        {/* Copy button  -  appears on hover */}
        <motion.button
          onClick={handleCopy}
          initial={{ opacity: 0, width: 0 }}
          whileHover={{ opacity: 1 }}
          className="overflow-hidden flex items-center"
          style={{ marginLeft: 2 }}
        >
          <motion.span
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="w-2.5 h-2.5 text-green-400" />
            ) : (
              <Copy className="w-2.5 h-2.5 opacity-60 hover:opacity-100" />
            )}
          </motion.span>
        </motion.button>
      </motion.div>

      {/* Copy toast */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: -32, scale: 1 }}
            exit={{ opacity: 0, y: -40, scale: 0.85 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap text-green-300"
              style={{
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.3)",
                backdropFilter: "blur(8px)",
              }}
            >
              <Check className="w-2.5 h-2.5" />
              Copied!
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
