"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { PostStatus } from "@/types";

// ─── Types ────────────────────────────────────────────────────
interface StatusBadgeProps {
  status: PostStatus;
  className?: string;
  showDot?: boolean;
  size?: "sm" | "md";
}

// ─── Config ───────────────────────────────────────────────────
const STATUS_CONFIG: Record<
  PostStatus,
  { label: string; bg: string; border: string; text: string; dotColor: string; animated: boolean }
> = {
  DRAFT: {
    label: "Draft",
    bg: "rgba(107,114,128,0.15)",
    border: "rgba(107,114,128,0.4)",
    text: "#9ca3af",
    dotColor: "#6b7280",
    animated: false,
  },
  SCHEDULED: {
    label: "Scheduled",
    bg: "rgba(59,130,246,0.15)",
    border: "rgba(59,130,246,0.4)",
    text: "#93c5fd",
    dotColor: "#3b82f6",
    animated: true,
  },
  PUBLISHED: {
    label: "Published",
    bg: "rgba(34,197,94,0.15)",
    border: "rgba(34,197,94,0.4)",
    text: "#86efac",
    dotColor: "#22c55e",
    animated: false,
  },
  FAILED: {
    label: "Failed",
    bg: "rgba(239,68,68,0.15)",
    border: "rgba(239,68,68,0.4)",
    text: "#fca5a5",
    dotColor: "#ef4444",
    animated: false,
  },
  PENDING: {
    label: "Pending",
    bg: "rgba(234,179,8,0.15)",
    border: "rgba(234,179,8,0.4)",
    text: "#fde047",
    dotColor: "#eab308",
    animated: true,
  },
  CANCELLED: {
    label: "Cancelled",
    bg: "rgba(107,114,128,0.1)",
    border: "rgba(107,114,128,0.25)",
    text: "#6b7280",
    dotColor: "#6b7280",
    animated: false,
  },
};

// ─── StatusBadge ─────────────────────────────────────────────
export default function StatusBadge({
  status,
  className,
  showDot = true,
  size = "md",
}: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const isSmall = size === "sm";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium rounded-full select-none",
        isSmall ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs",
        className
      )}
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
        color: config.text,
      }}
    >
      {showDot && (
        <span className="relative flex-shrink-0 w-1.5 h-1.5">
          <span
            className="absolute inset-0 rounded-full"
            style={{ background: config.dotColor }}
          />
          {config.animated && (
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{ background: config.dotColor }}
              animate={{ scale: [1, 2.2, 1], opacity: [0.8, 0, 0.8] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </span>
      )}
      {config.label}
    </span>
  );
}
