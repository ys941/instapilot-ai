"use client";

import { forwardRef } from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "danger";
type Size = "sm" | "md" | "lg";

interface GlowButtonProps extends Omit<HTMLMotionProps<"button">, "ref"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

// ─── Style Maps ───────────────────────────────────────────────
const variantStyles: Record<Variant, { base: string; hover: string; glow: string }> = {
  primary: {
    base: "bg-gradient-to-r from-red-500 via-pink-600 to-purple-700 text-white border border-transparent",
    hover: "hover:from-red-400 hover:via-pink-500 hover:to-purple-600",
    glow: "rgba(239,68,68,0.5)",
  },
  secondary: {
    base: "text-white border border-white/20",
    hover: "hover:border-white/40",
    glow: "rgba(255,255,255,0.2)",
  },
  danger: {
    base: "bg-gradient-to-r from-red-600 to-rose-700 text-white border border-transparent",
    hover: "hover:from-red-500 hover:to-rose-600",
    glow: "rgba(220,38,38,0.6)",
  },
};

const sizeStyles: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5",
  md: "px-5 py-2.5 text-sm rounded-xl gap-2",
  lg: "px-7 py-3.5 text-base rounded-2xl gap-2.5",
};

const secondaryBg =
  "rgba(255,255,255,0.06)";

// ─── Spinner ─────────────────────────────────────────────────
function Spinner({ size }: { size: Size }) {
  const dim = size === "sm" ? "w-3 h-3" : size === "lg" ? "w-5 h-5" : "w-4 h-4";
  return (
    <motion.div
      className={`${dim} rounded-full border-2 border-white/30 border-t-white`}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
    />
  );
}

// ─── GlowButton ───────────────────────────────────────────────
const GlowButton = forwardRef<HTMLButtonElement, GlowButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled = false,
      children,
      className,
      style,
      ...rest
    },
    ref
  ) => {
    const vStyle = variantStyles[variant];
    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        whileHover={
          isDisabled
            ? {}
            : {
                scale: 1.04,
                boxShadow: `0 0 28px ${vStyle.glow}, 0 4px 16px rgba(0,0,0,0.3)`,
              }
        }
        whileTap={isDisabled ? {} : { scale: 0.96 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        disabled={isDisabled}
        className={cn(
          "relative inline-flex items-center justify-center font-medium select-none",
          "transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0F]",
          sizeStyles[size],
          vStyle.base,
          vStyle.hover,
          isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          className
        )}
        style={{
          background:
            variant === "secondary"
              ? secondaryBg
              : undefined,
          backdropFilter: variant === "secondary" ? "blur(12px)" : undefined,
          WebkitBackdropFilter: variant === "secondary" ? "blur(12px)" : undefined,
          ...style,
        }}
        {...rest}
      >
        {/* Gradient border on hover for secondary */}
        {variant === "secondary" && (
          <span
            className="absolute inset-0 rounded-xl opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none"
            style={{
              background:
                "linear-gradient(135deg, rgba(239,68,68,0.3), rgba(219,39,119,0.3), rgba(147,51,234,0.3))",
              padding: "1px",
              borderRadius: "inherit",
            }}
          />
        )}

        {loading && <Spinner size={size} />}
        <span className={loading ? "opacity-70" : ""}>{children}</span>
      </motion.button>
    );
  }
);

GlowButton.displayName = "GlowButton";

export default GlowButton;
