"use client";

import { cn } from "@/lib/utils";

// ─── Shimmer Base ─────────────────────────────────────────────
// All skeleton variants use this base shimmer animation via CSS keyframes.

const shimmerStyle = `
  @keyframes cardioflow-shimmer {
    0% { background-position: -600px 0; }
    100% { background-position: 600px 0; }
  }
  .cf-shimmer {
    background: linear-gradient(
      90deg,
      rgba(255,255,255,0.03) 0%,
      rgba(255,255,255,0.08) 40%,
      rgba(255,255,255,0.03) 80%
    );
    background-size: 600px 100%;
    animation: cardioflow-shimmer 1.6s ease-in-out infinite;
  }
`;

function ShimmerBase({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <>
      <style>{shimmerStyle}</style>
      <div
        className={cn("cf-shimmer rounded-lg", className)}
        style={{
          background:
            "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.03) 80%)",
          backgroundSize: "600px 100%",
          animation: "cardioflow-shimmer 1.6s ease-in-out infinite",
          ...style,
        }}
      />
    </>
  );
}

// ─── SkeletonCard ─────────────────────────────────────────────
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl p-5 space-y-4",
        className
      )}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        <ShimmerBase className="w-10 h-10 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <ShimmerBase className="h-3.5 w-3/5 rounded-md" />
          <ShimmerBase className="h-2.5 w-2/5 rounded-md" />
        </div>
      </div>
      {/* Content lines */}
      <div className="space-y-2.5">
        <ShimmerBase className="h-3 w-full rounded-md" />
        <ShimmerBase className="h-3 w-11/12 rounded-md" />
        <ShimmerBase className="h-3 w-4/5 rounded-md" />
      </div>
      {/* Footer */}
      <div className="flex gap-2 pt-1">
        <ShimmerBase className="h-7 w-20 rounded-lg" />
        <ShimmerBase className="h-7 w-16 rounded-lg" />
      </div>
    </div>
  );
}

// ─── SkeletonText ─────────────────────────────────────────────
interface SkeletonTextProps {
  rows?: number;
  className?: string;
  lastRowWidth?: string;
}

export function SkeletonText({
  rows = 3,
  className,
  lastRowWidth = "60%",
}: SkeletonTextProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <ShimmerBase
          key={i}
          className="h-3.5 rounded-md"
          style={{ width: i === rows - 1 ? lastRowWidth : "100%" }}
        />
      ))}
    </div>
  );
}

// ─── SkeletonChart ────────────────────────────────────────────
export function SkeletonChart({ className }: { className?: string }) {
  const bars = [60, 85, 45, 90, 70, 55, 80, 65, 75, 50, 88, 72];

  return (
    <div
      className={cn("rounded-2xl p-5", className)}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Title */}
      <ShimmerBase className="h-4 w-36 rounded-md mb-6" />

      {/* Chart area */}
      <div className="flex items-end gap-2 h-32">
        {bars.map((height, i) => (
          <ShimmerBase
            key={i}
            className="flex-1 rounded-t-sm"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-2 mt-2">
        {bars.map((_, i) => (
          <ShimmerBase key={i} className="flex-1 h-2 rounded-sm" />
        ))}
      </div>
    </div>
  );
}

// ─── SkeletonTable ────────────────────────────────────────────
interface SkeletonTableProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: SkeletonTableProps) {
  return (
    <div
      className={cn("rounded-2xl overflow-hidden", className)}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Header */}
      <div
        className="flex gap-4 px-5 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <ShimmerBase key={i} className="h-3 flex-1 rounded-md" />
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex gap-4 px-5 py-4"
          style={{
            borderBottom:
              row < rows - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
          }}
        >
          {Array.from({ length: cols }).map((_, col) => (
            <ShimmerBase
              key={col}
              className="h-3 flex-1 rounded-md"
              style={{
                width: col === 0 ? "40%" : undefined,
                animationDelay: `${(row * cols + col) * 0.05}s`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Default export (SkeletonCard for convenience) ────────────
export default SkeletonCard;
