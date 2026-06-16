"use client";

import { useRef, useCallback } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  HTMLMotionProps,
} from "framer-motion";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
interface AnimatedCardProps extends Omit<HTMLMotionProps<"div">, "ref"> {
  children: React.ReactNode;
  className?: string;
  intensity?: number; // tilt degree multiplier, default 1
}

// ─── AnimatedCard ─────────────────────────────────────────────
// Magnetic hover effect: card tilts and a gradient glow follows the cursor.
export default function AnimatedCard({
  children,
  className,
  intensity = 1,
  style,
  ...rest
}: AnimatedCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Raw cursor position relative to card center (−1 => +1)
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  // Spring-smoothed values
  const springConfig = { stiffness: 180, damping: 20 };
  const x = useSpring(rawX, springConfig);
  const y = useSpring(rawY, springConfig);

  // Tilt transforms (rotateY = x, rotateX = -y so it tilts naturally)
  const rotateX = useTransform(y, [-0.5, 0.5], [7 * intensity, -7 * intensity]);
  const rotateY = useTransform(x, [-0.5, 0.5], [-7 * intensity, 7 * intensity]);

  // Glow position (percentage for background-position)
  const glowX = useTransform(x, [-0.5, 0.5], [0, 100]);
  const glowY = useTransform(y, [-0.5, 0.5], [0, 100]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5; // −0.5 => +0.5
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      rawX.set(nx);
      rawY.set(ny);
    },
    [rawX, rawY]
  );

  const handleMouseLeave = useCallback(() => {
    rawX.set(0);
    rawY.set(0);
  }, [rawX, rawY]);

  return (
    <motion.div
      ref={cardRef as React.Ref<HTMLDivElement>}
      className={cn("relative overflow-hidden rounded-2xl cursor-default", className)}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        perspective: 800,
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
        ...style,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={{ scale: 1.02 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      {...rest}
    >
      {/* Gradient glow that follows the cursor */}
      <motion.div
        className="absolute inset-0 pointer-events-none rounded-2xl opacity-0 group-hover:opacity-100"
        style={{
          background: `radial-gradient(circle at ${glowX.get()}% ${glowY.get()}%, rgba(239,68,68,0.18) 0%, transparent 70%)`,
          opacity: 0.7,
        }}
      />

      {/* Animated border glow */}
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background:
            "linear-gradient(135deg, rgba(239,68,68,0.2), rgba(219,39,119,0.15), rgba(147,51,234,0.2))",
          opacity: 0,
          border: "1px solid transparent",
        }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      />

      {/* Top highlight */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)",
        }}
      />

      {/* Content layer (slightly raised for 3D effect) */}
      <div style={{ transform: "translateZ(20px)" }}>{children}</div>
    </motion.div>
  );
}
