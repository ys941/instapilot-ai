"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  HelpCircle,
  Images,
  FlaskConical,
  Lightbulb,
  FileSearch,
  Activity,
  HeartPulse,
  Shield,
  Megaphone,
  Film,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PostType } from "@/types";
import { useBrand } from "@/components/BrandContext";

// ─── Post Type Config ─────────────────────────────────────────
interface PostTypeConfig {
  type: PostType;
  label: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
}

const POST_TYPES: PostTypeConfig[] = [
  {
    type: "EDUCATIONAL",
    label: "Educational",
    description: "Teach one concept clearly",
    icon: BookOpen,
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    type: "QUIZ",
    label: "Quiz",
    description: "Engage with questions",
    icon: HelpCircle,
    gradient: "from-purple-500 to-violet-600",
  },
  {
    type: "CAROUSEL",
    label: "Carousel",
    description: "Multi-slide content",
    icon: Images,
    gradient: "from-pink-500 to-rose-600",
  },
  {
    type: "MYTH_FACT",
    label: "Myth vs Fact",
    description: "Debunk misconceptions",
    icon: FlaskConical,
    gradient: "from-orange-500 to-amber-600",
  },
  {
    type: "CLINICAL_PEARL",
    label: "Pro Tip",
    description: "One high-value tip",
    icon: Lightbulb,
    gradient: "from-yellow-500 to-orange-500",
  },
  {
    type: "CASE_STUDY",
    label: "Story / Example",
    description: "A real-world example",
    icon: FileSearch,
    gradient: "from-teal-500 to-emerald-600",
  },
  {
    type: "ANGIOGRAPHY_QUIZ",
    label: "Image Quiz",
    description: "Image-based challenge",
    icon: Activity,
    gradient: "from-red-500 to-rose-600",
  },
  {
    type: "ECG_QUIZ",
    label: "Knowledge Quiz",
    description: "Deeper knowledge challenge",
    icon: HeartPulse,
    gradient: "from-red-600 to-pink-600",
  },
  {
    type: "PREVENTIVE",
    label: "How-To / Tips",
    description: "Actionable steps",
    icon: Shield,
    gradient: "from-green-500 to-teal-600",
  },
  {
    type: "CTA",
    label: "CTA",
    description: "Call to action posts",
    icon: Megaphone,
    gradient: "from-indigo-500 to-purple-600",
  },
  {
    type: "REEL",
    label: "Reel",
    description: "Short-form video script",
    icon: Film,
    gradient: "from-fuchsia-500 to-pink-600",
  },
];

// ─── Props ────────────────────────────────────────────────────
interface PostTypeSelectorProps {
  selected: PostType;
  onChange: (type: PostType) => void;
  className?: string;
}

// ─── PostTypeSelector ─────────────────────────────────────────
export default function PostTypeSelector({
  selected,
  onChange,
  className,
}: PostTypeSelectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const brand = useBrand();

  return (
    <div className={cn("relative", className)}>
      {/* Fade edges */}
      <div
        className="absolute left-0 top-0 bottom-0 w-8 z-10 pointer-events-none"
        style={{
          background:
            "linear-gradient(to right, rgba(10,10,15,1), transparent)",
        }}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-8 z-10 pointer-events-none"
        style={{
          background:
            "linear-gradient(to left, rgba(10,10,15,1), transparent)",
        }}
      />

      {/* Scrollable row */}
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide px-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>

        {POST_TYPES.map((pt) => {
          const isSelected = selected === pt.type;
          const Icon = pt.icon;
          // Source the user-facing label/description from the active brand's
          // content-type config; fall back to the neutral defaults above.
          const bct = brand.contentTypes?.[pt.type];
          const label = bct?.label || pt.label;
          const description = bct?.description || pt.description;

          return (
            <motion.button
              key={pt.type}
              onClick={() => onChange(pt.type)}
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.96 }}
              className={cn(
                "relative flex-shrink-0 flex flex-col items-center gap-2 px-4 py-3 rounded-2xl",
                "transition-all duration-200 cursor-pointer min-w-[88px]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
              )}
              style={{
                background: isSelected
                  ? undefined
                  : "rgba(255,255,255,0.04)",
                border: isSelected
                  ? "1px solid transparent"
                  : "1px solid rgba(255,255,255,0.08)",
                boxShadow: isSelected
                  ? "0 8px 28px rgba(0,0,0,0.3)"
                  : "none",
              }}
              animate={
                isSelected
                  ? { scale: 1.06 }
                  : { scale: 1 }
              }
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              {/* Gradient background when selected */}
              {isSelected && (
                <motion.div
                  layoutId="post-type-bg"
                  className={cn(
                    "absolute inset-0 rounded-2xl bg-gradient-to-br opacity-90",
                    pt.gradient
                  )}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}

              {/* Icon */}
              <div className="relative z-10">
                <Icon
                  className={cn(
                    "w-5 h-5 transition-colors",
                    isSelected ? "text-white" : "text-white/50"
                  )}
                />
              </div>

              {/* Label */}
              <span
                className={cn(
                  "relative z-10 text-[10px] font-semibold leading-tight text-center",
                  isSelected ? "text-white" : "text-white/50"
                )}
              >
                {label}
              </span>

              {/* Description tooltip on hover */}
              <span
                className={cn(
                  "relative z-10 text-[9px] leading-tight text-center",
                  isSelected ? "text-white/80" : "text-white/30"
                )}
              >
                {description}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
