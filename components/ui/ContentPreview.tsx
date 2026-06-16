"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Copy,
  Check,
  Zap,
  Type,
  MousePointerClick,
  Hash,
  Image,
  Film,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentResult } from "@/types";
import { useBrand } from "@/components/BrandContext";

// ─── Types ────────────────────────────────────────────────────
interface ContentPreviewProps {
  content: ContentResult;
  className?: string;
}

interface SectionConfig {
  key: keyof ContentResult;
  label: string;
  icon: React.ElementType;
  color: string;
  render?: (value: unknown) => string;
  alwaysShow?: boolean;
}

// ─── Section Config ───────────────────────────────────────────
const SECTIONS: SectionConfig[] = [
  {
    key: "hook",
    label: "Hook",
    icon: Zap,
    color: "#f59e0b",
    alwaysShow: true,
  },
  {
    key: "mainContent",
    label: "Main Content",
    icon: Type,
    color: "#3b82f6",
    alwaysShow: true,
  },
  {
    key: "cta",
    label: "Call to Action",
    icon: MousePointerClick,
    color: "#22c55e",
    alwaysShow: true,
  },
  {
    key: "hashtags",
    label: "Hashtags",
    icon: Hash,
    color: "#a855f7",
    render: (v) => (Array.isArray(v) ? (v as string[]).join(" ") : String(v)),
    alwaysShow: true,
  },
  {
    key: "imagePrompt",
    label: "Image Prompt",
    icon: Image,
    color: "#ec4899",
    alwaysShow: true,
  },
  {
    key: "reelScript",
    label: "Reel Script",
    icon: Film,
    color: "#ef4444",
    alwaysShow: false,
  },
];

// ─── Copy hook ────────────────────────────────────────────────
function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return { copied, copy };
}

// ─── Section Accordion ────────────────────────────────────────
function ContentSection({
  section,
  value,
}: {
  section: SectionConfig;
  value: string;
}) {
  const [open, setOpen] = useState(true);
  const { copied, copy } = useCopy(value);
  const Icon = section.icon;

  if (!value && !section.alwaysShow) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${section.color}20` }}
          >
            <Icon className="w-3 h-3" style={{ color: section.color }} />
          </div>
          <span className="text-xs font-semibold text-white/80">{section.label}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Copy button */}
          <motion.button
            onClick={(e) => { e.stopPropagation(); copy(); }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            {copied ? (
              <Check className="w-3 h-3 text-green-400" />
            ) : (
              <Copy className="w-3 h-3 text-white/40" />
            )}
          </motion.button>

          {/* Chevron */}
          <motion.div
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-3.5 h-3.5 text-white/30" />
          </motion.div>
        </div>
      </button>

      {/* Body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-3 pt-0 text-xs text-white/70 leading-relaxed whitespace-pre-wrap"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div className="pt-3">{value || <span className="text-white/25 italic">Not generated</span>}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Instagram Mockup ─────────────────────────────────────────
function InstagramMockup({ content }: { content: ContentResult }) {
  const brand = useBrand();
  const handleText = brand.handle || "yourhandle";
  const preview = content.hook + (content.mainContent ? "\n\n" + content.mainContent : "");
  const truncated = preview.length > 150 ? preview.slice(0, 150) + "..." : preview;

  return (
    <div className="relative mx-auto" style={{ width: 200 }}>
      {/* Phone frame */}
      <div
        className="rounded-[28px] overflow-hidden relative"
        style={{
          background: "#000",
          border: "2px solid rgba(255,255,255,0.15)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        {/* Status bar */}
        <div className="flex justify-between items-center px-4 mb-2">
          <span className="text-[7px] text-white/60 font-medium">9:41</span>
          <div className="flex gap-0.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-white/60" />
            ))}
          </div>
        </div>

        {/* Instagram header */}
        <div
          className="flex items-center gap-1.5 px-3 py-1.5"
          style={{ borderBottom: "0.5px solid rgba(255,255,255,0.1)" }}
        >
          <div
            className="w-5 h-5 rounded-full"
            style={{
              background: "linear-gradient(135deg, #ef4444, #db2777, #9333ea)",
            }}
          />
          <span className="text-[8px] text-white font-semibold">{handleText}</span>
          <span className="text-[7px] text-blue-400 ml-auto">Follow</span>
        </div>

        {/* Post image area */}
        <div
          className="w-full flex items-center justify-center"
          style={{
            height: 180,
            background: `linear-gradient(135deg, rgba(239,68,68,0.2) 0%, rgba(147,51,234,0.2) 100%)`,
          }}
        >
          <Smartphone className="w-8 h-8 text-white/20" />
        </div>

        {/* Caption */}
        <div className="px-3 py-2">
          <p className="text-[7px] text-white/70 leading-relaxed line-clamp-4">
            <span className="font-bold text-white">{handleText} </span>
            {truncated}
          </p>
          {content.hashtags.length > 0 && (
            <p className="text-[6px] text-blue-400 mt-0.5 leading-relaxed">
              {content.hashtags.slice(0, 5).join(" ")}
            </p>
          )}
        </div>

        {/* Like / Comment row */}
        <div className="flex items-center gap-2 px-3 pb-1">
          {["❤️", "💬", "📤"].map((emoji, i) => (
            <span key={i} className="text-[10px]">{emoji}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ContentPreview ───────────────────────────────────────────
export default function ContentPreview({ content, className }: ContentPreviewProps) {
  const [showMockup, setShowMockup] = useState(false);

  // Copy all content
  const allText = [
    content.hook,
    "",
    content.mainContent,
    "",
    content.cta,
    "",
    content.hashtags.join(" "),
  ].join("\n");

  const { copied: allCopied, copy: copyAll } = useCopy(allText);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
            }}
          >
            {content.type.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] text-white/30">
            Viral Score: <span className="text-yellow-400 font-bold">{content.viralScore}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            onClick={() => setShowMockup((v) => !v)}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg text-white/50 hover:text-white/80 transition-colors"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <Smartphone className="w-3 h-3" />
            {showMockup ? "Hide" : "Preview"}
          </motion.button>

          <motion.button
            onClick={copyAll}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition-colors"
            style={{
              background: allCopied ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.1)",
              border: `1px solid ${allCopied ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.25)"}`,
              color: allCopied ? "#86efac" : "#fca5a5",
            }}
          >
            {allCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {allCopied ? "Copied!" : "Copy All"}
          </motion.button>
        </div>
      </div>

      {/* Instagram mockup */}
      <AnimatePresence>
        {showMockup && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="py-4">
              <InstagramMockup content={content} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content sections */}
      <div className="space-y-2">
        {SECTIONS.map((section) => {
          const raw = content[section.key];
          const value = section.render
            ? section.render(raw)
            : typeof raw === "string"
            ? raw
            : "";

          if (!value && !section.alwaysShow) return null;

          return (
            <ContentSection key={section.key} section={section} value={value} />
          );
        })}
      </div>

      {/* Meta info */}
      <div className="flex items-center gap-4 text-[10px] text-white/25 pt-1">
        <span>{content.wordCount} words</span>
        <span>~{content.estimatedReadTime} min read</span>
        <span>{content.hashtags.length} hashtags</span>
      </div>
    </div>
  );
}
