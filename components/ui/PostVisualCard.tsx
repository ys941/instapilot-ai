"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Heart, Loader2, ImageIcon, CheckCircle, XCircle,
  Zap, BookOpen, HelpCircle, Gem, Microscope,
  Shield, Film, ChevronLeft, ChevronRight, RefreshCw,
  BellRing, Sparkles, Activity, AlertTriangle, Stethoscope,
} from "lucide-react";
import toast from "react-hot-toast";
import { useBrand } from "@/components/BrandContext";

export interface PostVisualCardProps {
  postType: string;
  title: string;
  hook: string;
  content: string;
  cta: string;
  hashtags: string[];
  imagePrompt: string;
  viralScore: number;
  reelScript?: string;
  carouselSlides?: Array<{ slide: number; headline: string; body: string }>;
}

// ─── Shared design constants ───────────────────────────────────────────────────
const BG_DARK  = "#1a1428";   // carousel / most cards
const BG_NAVY  = "#0d1420";   // quiz-style cards
const RED      = "#e63946";
const GOLD     = "#ffa500";
const BODY_TXT = "rgba(255,255,255,0.5)";
const ICON_CLR = "#0a0515";   // dark silhouette colour for icons

// ─── BaseCard  -  shared frame for all types ────────────────────────────────────
function BaseCard({
  children,
  darkBg = false,
  noPad = false,
}: {
  children: React.ReactNode;
  darkBg?: boolean;
  noPad?: boolean;
}) {
  return (
    <div
      className="relative rounded-2xl overflow-hidden w-full"
      style={{ aspectRatio: "1/1", background: darkBg ? BG_NAVY : BG_DARK }}
    >
      {/* Top gradient border */}
      <div
        className="absolute top-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }}
      />
      {/* Bottom gradient border */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }}
      />
      {/* Left red stripe */}
      <div
        className="absolute top-0 left-0 bottom-0 z-10"
        style={{ width: 7, background: RED }}
      />
      {/* Content area */}
      <div
        className="absolute inset-0 z-10 flex flex-col"
        style={noPad ? {} : { paddingLeft: 20, paddingRight: 14, paddingTop: 16, paddingBottom: 12 }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Gold header label ─────────────────────────────────────────────────────────
function GoldLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-2">
      <div style={{ height: 1, width: 24, background: `${GOLD}50` }} />
      <span
        className="text-[9px] font-bold uppercase tracking-[0.22em]"
        style={{ color: GOLD }}
      >
        {text}
      </span>
      <div style={{ height: 1, width: 24, background: `${GOLD}50` }} />
    </div>
  );
}

// ─── Dark silhouette icon wrapper ──────────────────────────────────────────────
function DarkIcon({ children, size = 54 }: { children: React.ReactNode; size?: number }) {
  return (
    <div
      className="flex items-center justify-center mb-1 mt-1"
      style={{ width: size, height: size, opacity: 0.82, color: ICON_CLR, fill: ICON_CLR }}
    >
      {children}
    </div>
  );
}

// ─── Watermark ─────────────────────────────────────────────────────────────────
function Watermark() {
  const brand = useBrand();
  return (
    <div className="flex items-center justify-center gap-1 mt-auto pt-2">
      <Heart size={8} color={RED} fill={RED} />
      <span className="text-[8px] font-medium tracking-widest" style={{ color: `${RED}55` }}>
        {`@${brand.handle}`}
      </span>
    </div>
  );
}

// ─── Bullet line ───────────────────────────────────────────────────────────────
function Bullet({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <div
        className="rounded-full flex-shrink-0 mt-1.5"
        style={{ width: 5, height: 5, background: RED }}
      />
      <p className="text-[11px] leading-relaxed" style={{ color: BODY_TXT }}>
        {text.replace(/^[•\-*]\s*/, "").replace(/\*\*/g, "")}
      </p>
    </div>
  );
}

// ─── Content parsers (shared by multiple card types) ─────────────────────────

/** Strip ANSWER/MECHANISM/MANAGEMENT sections so they never appear in cards/captions */
function stripAnswerSections(content: string): string {
  return content
    .replace(/\n?\s*ANSWER\s*[:\-][^\n]*/gi, "")
    .replace(/\n?\s*CORRECT\s+ANSWER\s*[:\-][^\n]*/gi, "")
    .replace(/\n?\s*MECHANISM\s*[:\-][\s\S]*?(?=\n\s*[A-Z]{3,}|\n\s*$|$)/i, "")
    .replace(/\n?\s*MANAGEMENT\s*[:\-][\s\S]*?(?=\n\s*[A-Z]{3,}|\n\s*$|$)/i, "")
    .trim();
}

/** Strip answer markers from a single option text */
function stripAnswerMarkers(text: string): string {
  return text

    .trim();
}

function parseCleanBullets(content: string, max = 5): string[] {
  return content
    .split("\n")
    .map((l) => l.replace(/^[\s•●▪►=>\-*]+/, "").replace(/^\d+[).]\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .filter((l) => !l.endsWith(":") && !/include[s]?:?\s*$/i.test(l))
    .filter((l) => l.length <= 130)
    .filter((l) => !/\breports?\s+that\b|\bstudies?\s+show\b|\baccording\s+to\b|\bevery\s+minute\b/i.test(l))
    .filter((l) => !(l.endsWith("?") && /^(what|which|how|when|do you|have you|can you|drop|comment|follow|save|share|tag)/i.test(l)))
    .filter((l) => !/^(save this|share this|follow for|drop your|comment below|let me know|tag a|like if)/i.test(l))
    .slice(0, max);
}

function parseEcgSections(content: string): { caseInfo: string; ecgFindings: string[] } {
  const caseMatch = content.match(
    /CASE(?:\s*DETAILS?)?\s*[:\-]\s*([\s\S]+?)(?=ECG\s*FINDINGS?|[A-D][).:]\s|\bQUESTION\b|$)/i
  );
  const caseInfo = caseMatch
    ? caseMatch[1].replace(/\*\*/g, "").replace(/\n+/g, " ").replace(/[-•●]\s*/g, "").trim().slice(0, 130)
    : "";

  const ecgMatch = content.match(
    /ECG\s*FINDINGS?\s*[:\-]\s*([\s\S]+?)(?=[A-D][).:]\s|\bQUESTION\b|\bANSWER\b|$)/i
  );
  let ecgFindings: string[] = [];
  if (ecgMatch) {
    ecgFindings = ecgMatch[1]
      .replace(/\*\*/g, "")
      .split(/[,\n•●\-]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3)
      .slice(0, 5);
  }
  return { caseInfo, ecgFindings };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. EDUCATIONAL  –  all content, bullets numbered, paragraphs plain
// ─────────────────────────────────────────────────────────────────────────────
function EducationalCard({ hook, content }: { hook: string; content: string }) {
  const brand = useBrand();
  const eyebrow = (brand.niche && brand.niche !== "your topic" ? brand.niche : "Educational");
  // Classify each line: bullet (originally •/-/*/numbered) → gets a number badge
  // Paragraph/intro/heading → shown as plain text without a number
  const BULLET_RE = /^[•●▪►=>\-*]\s|^\d+[).]\s/;
  const CTA_RE    = /^(save this|share this|follow for|drop your|comment below|let me know|tag a|like if)/i;
  const QCTA_RE   = /^(what|which|how|when|do you|have you|can you|drop|comment|follow|save|share|tag)/i;
  const HEAD_RE   = /^[A-Z][A-Z\s]{3,}:\s*$/;  // ALL-CAPS headings like "KEY FINDINGS:"

  const items: Array<{ kind: "bullet" | "para"; text: string }> = content
    .split("\n")
    .map((l) => ({ raw: l, text: l.replace(/\*\*/g, "").trim() }))
    .filter(({ text }) => Boolean(text))
    .filter(({ text }) => !HEAD_RE.test(text))
    .filter(({ text }) => !CTA_RE.test(text))
    .filter(({ text }) => !(text.endsWith("?") && QCTA_RE.test(text)))
    .map(({ raw, text }) => ({
      kind:  BULLET_RE.test(raw.trim()) ? "bullet" : "para",
      text:  text.replace(/^[•●▪►=>\-*]\s*/, "").replace(/^\d+[).]\s*/, ""),
    }));

  let bulletNum = 0;

  return (
    // Variable height — no fixed aspect ratio so all content always fits
    <div className="relative rounded-2xl overflow-hidden w-full" style={{ background: BG_DARK }}>
      {/* Top gradient border */}
      <div className="absolute top-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      {/* Bottom gradient border */}
      <div className="absolute bottom-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      {/* Left red stripe */}
      <div className="absolute top-0 left-0 bottom-0 z-10" style={{ width: 7, background: RED }} />

      {/* Content — relative so card height grows with text */}
      <div className="relative z-10 flex flex-col"
        style={{ paddingLeft: 20, paddingRight: 14, paddingTop: 16, paddingBottom: 16 }}>

        {/* Header */}
        <div className="flex flex-col items-center text-center mb-1">
          <DarkIcon size={52}><BookOpen size={52} color={ICON_CLR} /></DarkIcon>
          <GoldLabel text={eyebrow} />
          <div style={{ height: 1, width: "100%", background: "rgba(255,255,255,0.07)", marginBottom: 8 }} />
        </div>

        {/* Headline */}
        <h2 className="font-black text-white text-center leading-tight mb-4"
          style={{ fontSize: "clamp(16px, 4vw, 22px)", fontFamily: "var(--font-sora), sans-serif" }}>
          {hook.replace(/\*\*/g, "") || "Key Insight"}
        </h2>

        {/* All content — no slice(), no line-clamp */}
        <div className="flex flex-col gap-3">
          {items.map((item, i) => {
            if (item.kind === "bullet") {
              bulletNum++;
              const num = bulletNum;
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex items-center justify-center flex-shrink-0 rounded-full"
                    style={{ width: 22, height: 22, minWidth: 22, background: `${RED}22`, border: `1px solid ${RED}55`, marginTop: 2 }}>
                    <span className="text-[10px] font-bold" style={{ color: RED }}>{num}</span>
                  </div>
                  <p className="text-[11.5px] leading-relaxed" style={{ color: "rgba(255,255,255,0.82)" }}>
                    {item.text}
                  </p>
                </div>
              );
            }
            // Paragraph / intro / closing — plain, no number badge
            return (
              <p key={i} className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                {item.text}
              </p>
            );
          })}
        </div>

        <div style={{ height: 1, background: `${RED}30`, marginTop: 12 }} />
        <Watermark />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. QUIZ  -  CATH LAB QUIZ style
// ─────────────────────────────────────────────────────────────────────────────
function QuizCard({ hook, content }: { hook: string; content: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const opts = ["A", "B", "C", "D"];
  const safe = stripAnswerSections(content);
  const lines = safe.split("\n").filter((l) => l.trim());
  const optLines = lines.filter((l) => /^[A-D][).:]/.test(l.trim())).slice(0, 4);

  return (
    <div
      className="relative rounded-2xl overflow-hidden w-full"
      style={{ aspectRatio: "1/1", background: BG_NAVY }}
    >
      <div className="absolute top-0 left-0 right-0 z-20" style={{ height: 3, background: RED }} />
      <div className="absolute bottom-0 left-0 right-0 z-20" style={{ height: 3, background: RED }} />

      {/* Concentric red circles */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.13 }}>
        {[40, 70, 100, 130, 160, 195, 230, 265].map((r) => (
          <circle key={r} cx="50%" cy="50%" r={r} fill="none" stroke={RED} strokeWidth="1" />
        ))}
      </svg>

      <div className="absolute inset-0 flex flex-col z-10" style={{ padding: "14px 18px 10px" }}>
        {/* CARDIOLOGY CHALLENGE header */}
        <div className="flex flex-col items-center gap-1 mb-2">
          <div className="flex items-center gap-2">
            <div style={{ height: 1, width: 28, background: `${GOLD}45` }} />
            <span className="text-[9px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>
              QUIZ  -  CHALLENGE
            </span>
            <div style={{ height: 1, width: 28, background: `${GOLD}45` }} />
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", width: "100%" }} />
        </div>

        {/* Question */}
        <h2
          className="font-extrabold text-center leading-snug mb-3"
          style={{ color: "white", fontSize: "clamp(14px, 3.5vw, 19px)", fontFamily: "var(--font-sora), sans-serif", lineHeight: 1.3 }}
        >
          {hook.replace(/\*\*/g, "") || "Test your knowledge"}
        </h2>

        {/* Options */}
        <div className="flex flex-col gap-2 flex-1 justify-center">
          {opts.map((opt, i) => (
            <motion.button
              key={opt}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelected(opt)}
              className="flex items-center gap-3 w-full text-left transition-all"
              style={{
                padding: "9px 14px",
                background: selected === opt ? `${RED}22` : "rgba(255,255,255,0.05)",
                border: `1px solid ${selected === opt ? `${RED}80` : "rgba(255,255,255,0.1)"}`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0 rounded"
                style={{
                  width: 28, height: 28,
                  background: selected === opt ? RED : "rgba(255,255,255,0.12)",
                  transition: "background 0.2s",
                }}
              >
                <span className="text-[12px] font-bold text-white">{opt}</span>
              </div>
              <span className="text-[12px] text-white/80 leading-snug">
                {optLines[i] ? stripAnswerMarkers(optLines[i].replace(/^[A-D][).:]?\s*/, "").replace(/\*\*/g, "")) : `Option ${opt}`}
              </span>
            </motion.button>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-0.5 pt-3">
          <p className="text-[13px] font-bold" style={{ color: RED }}>🎯 Comment your answer</p>
          <p className="text-[10px] italic" style={{ color: BODY_TXT }}>before seeing the next post!</p>
          <p className="text-[11px] mt-0.5" style={{ color: selected ? GOLD : "rgba(255,255,255,0.3)", fontWeight: selected ? 700 : 400 }}>
            {selected ? "Let me know! 🎯" : "Want more challenges?"}
          </p>
        </div>
        <div className="flex justify-center pt-1">
          <Heart size={10} fill={RED} color={RED} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MYTH vs FACT
// ─────────────────────────────────────────────────────────────────────────────
function MythFactCard({ hook, content }: { hook: string; content: string }) {
  const [side, setSide] = useState<"myth" | "fact">("myth");
  const mythText = hook.replace(/\*\*/g, "") || "Common Misconception";
  // Show the full FACT section — no character cap
  const factLines = content
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.replace(/\*\*/g, "").trim())
    .filter((l) => !/^MYTH\s*[:\-]/i.test(l))  // drop "MYTH: ..." line (shown as hook)
    .filter((l) => !/^(save this|share this|drop a heart|share to)/i.test(l));
  const factText = factLines.join("\n").replace(/^FACT\s*[:\-]\s*/im, "").trim() || "The evidence-based truth.";

  return (
    <BaseCard noPad>
      {/* Toggle tabs */}
      <div className="flex" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {(["myth", "fact"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className="flex-1 py-3 text-[11px] font-bold uppercase tracking-wider transition-all"
            style={{
              paddingLeft: s === "myth" ? 24 : 8,
              background: side === s ? (s === "myth" ? `${RED}18` : "rgba(34,197,94,0.12)") : "transparent",
              color: side === s ? (s === "myth" ? "#fca5a5" : "#86efac") : "rgba(255,255,255,0.3)",
            }}
          >
            {s === "myth" ? "✕ Myth" : "✓ Fact"}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={side}
          initial={{ opacity: 0, x: side === "myth" ? -12 : 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col flex-1"
          style={{ paddingLeft: 24, paddingRight: 14, paddingTop: 18, paddingBottom: 12 }}
        >
          <div className="flex flex-col items-center text-center gap-4 flex-1 justify-center">
            <DarkIcon size={56}>
              {side === "myth"
                ? <XCircle size={56} color={ICON_CLR} fill={ICON_CLR} />
                : <CheckCircle size={56} color={ICON_CLR} fill={ICON_CLR} />}
            </DarkIcon>
            <GoldLabel text={side === "myth" ? "Common Myth" : "The Truth"} />
            <h2
              className="font-black text-white leading-tight"
              style={{ fontSize: "clamp(15px, 3.8vw, 22px)", fontFamily: "var(--font-sora), sans-serif" }}
            >
              {side === "myth" ? mythText : factText}
            </h2>
          </div>
          <p className="text-center text-[9px] pb-2" style={{ color: BODY_TXT }}>
            Tap to toggle Myth / Fact
          </p>
          <Watermark />
        </motion.div>
      </AnimatePresence>
    </BaseCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CLINICAL PEARL
// ─────────────────────────────────────────────────────────────────────────────
function ClinicalPearlCard({ hook, content }: { hook: string; content: string }) {
  // No .slice() — show every line
  const CTA_RE = /^(save this|share this|follow for|drop your|comment below|let me know|tag a|like if)/i;
  const QCTA_RE = /^(what|which|how|when|do you|have you|can you|drop|comment|follow|save|share|tag)/i;
  const lines = content
    .split("\n")
    .map((l) => l.replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .filter((l) => !CTA_RE.test(l))
    .filter((l) => !(l.endsWith("?") && QCTA_RE.test(l)));

  return (
    // Variable height so all lines always fit
    <div className="relative rounded-2xl overflow-hidden w-full" style={{ background: BG_DARK }}>
      <div className="absolute top-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      <div className="absolute bottom-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      <div className="absolute top-0 left-0 bottom-0 z-10" style={{ width: 7, background: RED }} />
      <div className="relative z-10 flex flex-col"
        style={{ paddingLeft: 20, paddingRight: 14, paddingTop: 16, paddingBottom: 16 }}>
        <div className="flex flex-col items-center text-center mb-1">
          <DarkIcon size={52}><Gem size={52} color={ICON_CLR} /></DarkIcon>
          <GoldLabel text="Pro Tip" />
          <div style={{ height: 1, width: "100%", background: "rgba(255,255,255,0.07)", marginBottom: 8 }} />
        </div>
        <h2 className="font-black text-white text-center leading-tight mb-3"
          style={{ fontSize: "clamp(15px, 3.8vw, 20px)", fontFamily: "var(--font-sora), sans-serif" }}>
          {hook.replace(/\*\*/g, "") || "Key Insight"}
        </h2>
        <div className="flex flex-col gap-2">
          {lines.map((line, i) => (
            <Bullet key={i} text={line} />
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 mt-3">
          <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.08)" }} />
          <span className="text-[9px]" style={{ color: `${GOLD}80` }}>💎 Save this for later</span>
          <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>
        <Watermark />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CASE STUDY
// ─────────────────────────────────────────────────────────────────────────────
function CaseStudyCard({ hook, content }: { hook: string; content: string }) {
  // Parse sections from the structured case study content
  const sectionLabels = ["PRESENTATION", "KEY FINDINGS", "DIAGNOSIS", "MANAGEMENT", "OUTCOME", "LEARNING POINT"];
  const CTA_RE = /^(save this|share this|what would you|drop your|comment below|let me know|tag a)/i;

  // Extract sections by label, or fall back to line-by-line
  const sectionMap: Record<string, string> = {};
  let currentSection = "";
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\*\*/g, "").trim();
    if (!line) continue;
    const headerMatch = sectionLabels.find((s) => new RegExp(`^${s}\\s*[:\\-]?`, "i").test(line));
    if (headerMatch) { currentSection = headerMatch; continue; }
    if (currentSection) sectionMap[currentSection] = (sectionMap[currentSection] ? sectionMap[currentSection] + " " : "") + line;
  }

  const allLines = content
    .split("\n")
    .map((l) => l.replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .filter((l) => !CTA_RE.test(l))
    .filter((l) => !sectionLabels.some((s) => new RegExp(`^${s}\\s*[:\\-]?\\s*$`, "i").test(l)));

  const hasSections = Object.keys(sectionMap).length >= 2;

  return (
    // Variable height so all content fits
    <div className="relative rounded-2xl overflow-hidden w-full" style={{ background: BG_DARK }}>
      <div className="absolute top-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      <div className="absolute bottom-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      <div className="absolute top-0 left-0 bottom-0 z-10" style={{ width: 7, background: RED }} />

      <div className="relative z-10 flex flex-col"
        style={{ paddingLeft: 20, paddingRight: 14, paddingTop: 16, paddingBottom: 16 }}>
        <div className="flex flex-col items-center text-center mb-1">
          <div className="flex items-center justify-between w-full mb-1">
            <DarkIcon size={44}><Stethoscope size={44} color={ICON_CLR} /></DarkIcon>
            <div className="text-[8px] font-bold uppercase tracking-wider px-2 py-1 rounded"
              style={{ background: `${RED}20`, border: `1px solid ${RED}35`, color: RED }}>
              STORY / EXAMPLE
            </div>
          </div>
          <GoldLabel text="Story / Example" />
          <div style={{ height: 1, width: "100%", background: "rgba(255,255,255,0.07)", marginBottom: 6 }} />
        </div>

        {/* Setup */}
        <div className="rounded-lg p-2.5 mb-3"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="text-[11px] italic leading-snug" style={{ color: "rgba(255,255,255,0.65)" }}>
            {hook.replace(/\*\*/g, "") || "Real-world example"}
          </p>
        </div>

        {/* Show parsed sections if available, otherwise show all lines */}
        {hasSections ? (
          <div className="flex flex-col gap-2.5">
            {Object.entries(sectionMap).map(([sec, text]) => (
              <div key={sec} className="rounded-lg p-2.5"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: `${GOLD}80` }}>{sec}</p>
                <p className="text-[10px] leading-relaxed" style={{ color: BODY_TXT }}>{text}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {allLines.map((line, i) => (
              <p key={i} className="text-[10.5px] leading-relaxed" style={{ color: BODY_TXT }}>
                {line.replace(/^[•\-*]\s*/, "")}
              </p>
            ))}
          </div>
        )}
        <Watermark />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ECG QUIZ
// ─────────────────────────────────────────────────────────────────────────────
function EcgQuizCard({ hook, content }: { hook: string; content: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const opts = ["A", "B", "C", "D"];
  const safe = stripAnswerSections(content);
  const lines = safe.split("\n").filter((l) => l.trim());
  const optLines = lines.filter((l) => /^[A-D][).:]/.test(l.trim())).slice(0, 4);
  const { caseInfo, ecgFindings } = parseEcgSections(safe);

  return (
    <div
      className="relative rounded-2xl overflow-hidden w-full"
      style={{ aspectRatio: "1/1", background: BG_NAVY }}
    >
      <div className="absolute top-0 left-0 right-0 z-20" style={{ height: 3, background: RED }} />
      <div className="absolute bottom-0 left-0 right-0 z-20" style={{ height: 3, background: RED }} />

      {/* Concentric circles */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.11 }}>
        {[40, 70, 100, 130, 160, 195, 230].map((r) => (
          <circle key={r} cx="50%" cy="50%" r={r} fill="none" stroke={RED} strokeWidth="1" />
        ))}
      </svg>

      <div className="absolute inset-0 flex flex-col z-10" style={{ padding: "11px 16px 9px" }}>
        {/* Header */}
        <div className="flex items-center justify-center gap-2 mb-1.5">
          <div style={{ height: 1, width: 22, background: `${GOLD}45` }} />
          <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>⚡ Knowledge Challenge</span>
          <div style={{ height: 1, width: 22, background: `${GOLD}45` }} />
        </div>

        {/* ECG Strip */}
        <div
          className="rounded-xl relative overflow-hidden mb-2"
          style={{ height: 44, background: `${RED}08`, border: `1px solid ${RED}22`, flexShrink: 0 }}
        >
          <svg viewBox="0 0 300 44" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            {[1,2,3,4,5].map((i) => <line key={`v${i}`} x1={i*60} y1="0" x2={i*60} y2="44" stroke={`${RED}20`} strokeWidth="0.5" />)}
            {[1,2,3].map((i) => <line key={`h${i}`} x1="0" y1={i*11} x2="300" y2={i*11} stroke={`${RED}20`} strokeWidth="0.5" />)}
            <motion.polyline
              points="0,22 22,22 30,22 34,6 38,38 42,22 60,22 88,22 96,22 100,4 104,40 108,22 126,22 154,22 162,22 166,5 170,39 174,22 192,22 224,22 232,22 236,6 240,38 244,22 262,22 300,22"
              fill="none" stroke={RED} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2.5, ease: "easeInOut", repeat: Infinity, repeatType: "loop" }}
            />
          </svg>
          <span className="absolute top-1 left-2 text-[7px] font-mono" style={{ color: `${RED}55` }}>VISUAL CHALLENGE</span>
        </div>

        {/* CASE INFO row */}
        {caseInfo && (
          <div
            className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 mb-1.5"
            style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)", flexShrink: 0 }}
          >
            <span className="text-[8px] font-bold uppercase tracking-wider flex-shrink-0 mt-0.5" style={{ color: "#60a5fa" }}>CASE</span>
            <p className="text-[10px] leading-snug" style={{ color: "rgba(255,255,255,0.78)" }}>
              {caseInfo}
            </p>
          </div>
        )}

        {/* ECG FINDINGS chips */}
        {ecgFindings.length > 0 && (
          <div
            className="rounded-lg px-2.5 py-1.5 mb-1.5"
            style={{ background: `${RED}08`, border: `1px solid ${RED}28`, flexShrink: 0 }}
          >
            <p className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: RED }}>Key Findings</p>
            <div className="flex flex-wrap gap-1">
              {ecgFindings.map((f, i) => (
                <span
                  key={i}
                  className="text-[9px] px-2 py-0.5 rounded"
                  style={{ background: `${RED}14`, border: `1px solid ${RED}40`, color: "rgba(255,255,255,0.75)" }}
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Question */}
        <h2
          className="font-extrabold text-center text-white leading-snug mb-1.5"
          style={{ fontSize: "clamp(11px, 2.8vw, 14px)", fontFamily: "var(--font-sora), sans-serif", flexShrink: 0 }}
        >
          {hook.replace(/\*\*/g, "") || "What's the answer? 🧠"}
        </h2>

        {/* Options */}
        <div className="flex flex-col gap-1 flex-1">
          {opts.map((opt, i) => (
            <motion.button
              key={opt}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelected(opt)}
              className="flex items-center gap-2 w-full text-left"
              style={{
                padding: "6px 10px",
                background: selected === opt ? `${RED}22` : "rgba(255,255,255,0.04)",
                border: `1px solid ${selected === opt ? `${RED}70` : "rgba(255,255,255,0.09)"}`,
                borderRadius: 6, cursor: "pointer",
              }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0 rounded"
                style={{ width: 22, height: 22, background: selected === opt ? RED : "rgba(255,255,255,0.1)", transition: "background 0.2s" }}
              >
                <span className="text-[10px] font-bold text-white">{opt}</span>
              </div>
              <span className="text-[10px] leading-snug" style={{ color: "rgba(255,255,255,0.75)" }}>
                {optLines[i] ? stripAnswerMarkers(optLines[i].replace(/^[A-D][).:]?\s*/, "").replace(/\*\*/g, "")) : `Option ${opt}`}
              </span>
            </motion.button>
          ))}
        </div>

        <div className="flex flex-col items-center pt-1.5">
          <p className="text-[11px] font-bold" style={{ color: RED }}>🎯 Post your answer below</p>
        </div>
        <div className="flex justify-center pt-0.5"><Heart size={9} fill={RED} color={RED} /></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. ANGIOGRAPHY QUIZ
// ─────────────────────────────────────────────────────────────────────────────
function AngiographyQuizCard({ hook, content }: { hook: string; content: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const opts = ["A", "B", "C", "D"];
  const safe = stripAnswerSections(content);
  const lines = safe.split("\n").filter((l) => l.trim());
  const optLines = lines.filter((l) => /^[A-D][).:]/.test(l.trim())).slice(0, 4);

  return (
    <div
      className="relative rounded-2xl overflow-hidden w-full"
      style={{ aspectRatio: "1/1", background: BG_NAVY }}
    >
      <div className="absolute top-0 left-0 right-0 z-20" style={{ height: 3, background: RED }} />
      <div className="absolute bottom-0 left-0 right-0 z-20" style={{ height: 3, background: RED }} />
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.11 }}>
        {[40, 70, 100, 130, 160, 195, 230].map((r) => (
          <circle key={r} cx="50%" cy="50%" r={r} fill="none" stroke={RED} strokeWidth="1" />
        ))}
      </svg>

      <div className="absolute inset-0 flex flex-col z-10" style={{ padding: "12px 18px 10px" }}>
        {/* Header */}
        <div className="flex flex-col items-center gap-1 mb-1">
          <div className="flex items-center gap-2">
            <div style={{ height: 1, width: 20, background: `${GOLD}45` }} />
            <span className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: GOLD }}>🔍 Image Challenge</span>
            <div style={{ height: 1, width: 20, background: `${GOLD}45` }} />
          </div>
        </div>

        {/* Coronary vessel diagram */}
        <div
          className="rounded-xl relative overflow-hidden mb-2"
          style={{ height: 58, background: `${RED}07`, border: `1px solid ${RED}20` }}
        >
          <svg viewBox="0 0 200 52" className="absolute inset-0 w-full h-full">
            <motion.path d="M100,6 C100,6 78,14 66,26 C54,38 60,46 70,46" fill="none" stroke={`${RED}cc`} strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, repeat: Infinity, repeatType: "loop" }} />
            <motion.path d="M100,6 C100,6 122,14 134,26 C146,38 140,46 130,46" fill="none" stroke={`${RED}88`} strokeWidth="2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.3, repeat: Infinity, repeatType: "loop", delay: 0.3 }} />
            <motion.path d="M100,6 C100,6 100,22 100,40" fill="none" stroke={`${RED}99`} strokeWidth="1.8" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.8, repeat: Infinity, repeatType: "loop", delay: 0.6 }} />
            <circle cx="72" cy="33" r="4" fill={`${RED}35`} stroke={RED} strokeWidth="1.2" />
            <text x="80" y="36" fontSize="7" fill={RED} fontWeight="bold">?</text>
          </svg>
          <span className="absolute top-1 left-2 text-[7px]" style={{ color: `${RED}55` }}>WHAT IS THIS?</span>
        </div>

        {/* Question */}
        <h2
          className="font-extrabold text-center text-white leading-snug mb-2"
          style={{ fontSize: "clamp(13px, 3.2vw, 17px)", fontFamily: "var(--font-sora), sans-serif" }}
        >
          {hook.replace(/\*\*/g, "") || "What is this? 🔍"}
        </h2>

        {/* Options */}
        <div className="flex flex-col gap-1.5 flex-1 justify-center">
          {opts.map((opt, i) => (
            <motion.button
              key={opt}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelected(opt)}
              className="flex items-center gap-2.5 w-full text-left"
              style={{
                padding: "7px 12px",
                background: selected === opt ? `${RED}22` : "rgba(255,255,255,0.04)",
                border: `1px solid ${selected === opt ? `${RED}70` : "rgba(255,255,255,0.09)"}`,
                borderRadius: 7, cursor: "pointer",
              }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0 rounded"
                style={{ width: 24, height: 24, background: selected === opt ? RED : "rgba(255,255,255,0.1)", transition: "background 0.2s" }}
              >
                <span className="text-[11px] font-bold text-white">{opt}</span>
              </div>
              <span className="text-[11px] text-white/75">
                {optLines[i] ? stripAnswerMarkers(optLines[i].replace(/^[A-D][).:]?\s*/, "").replace(/\*\*/g, "")) : `Option ${opt}`}
              </span>
            </motion.button>
          ))}
        </div>

        <div className="flex flex-col items-center pt-2">
          <p className="text-[12px] font-bold" style={{ color: RED }}>🎯 Tag a friend who knows!</p>
        </div>
        <div className="flex justify-center pt-1"><Heart size={9} fill={RED} color={RED} /></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PREVENTIVE
// ─────────────────────────────────────────────────────────────────────────────
function PreventiveCard({ hook, content }: { hook: string; content: string }) {
  const BULLET_RE = /^[•●▪►=>\-*]\s|^\d+[).]\s/;
  const CTA_RE    = /^(save this|share this|follow for|drop your|comment below|let me know|tag a|like if)/i;
  const QCTA_RE   = /^(what|which|how|when|do you|have you|can you|drop|comment|follow|save|share|tag)/i;

  // Classify lines — bullet points get sequential numbers, paragraphs are plain
  const items: Array<{ kind: "bullet" | "para"; text: string }> = content
    .split("\n")
    .map((l) => ({ raw: l, text: l.replace(/\*\*/g, "").trim() }))
    .filter(({ text }) => Boolean(text))
    .filter(({ text }) => !CTA_RE.test(text))
    .filter(({ text }) => !(text.endsWith("?") && QCTA_RE.test(text)))
    .map(({ raw, text }) => ({
      kind:  BULLET_RE.test(raw.trim()) ? "bullet" : "para",
      text:  text.replace(/^[•●▪►=>\-*]\s*/, "").replace(/^\d+[).]\s*/, ""),
    }));

  let bulletNum = 0;

  return (
    // Variable height — no fixed aspect ratio so all content always fits
    <div className="relative rounded-2xl overflow-hidden w-full" style={{ background: BG_DARK }}>
      <div className="absolute top-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      <div className="absolute bottom-0 left-0 right-0 z-20"
        style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      <div className="absolute top-0 left-0 bottom-0 z-10" style={{ width: 7, background: RED }} />
      <div className="relative z-10 flex flex-col"
        style={{ paddingLeft: 20, paddingRight: 14, paddingTop: 16, paddingBottom: 16 }}>
        <div className="flex flex-col items-center text-center mb-1">
          <DarkIcon size={52}><Shield size={52} color={ICON_CLR} fill={ICON_CLR} /></DarkIcon>
          <GoldLabel text="How-To / Tips" />
          <div style={{ height: 1, width: "100%", background: "rgba(255,255,255,0.07)", marginBottom: 8 }} />
        </div>
        <h2 className="font-black text-white text-center leading-tight mb-3"
          style={{ fontSize: "clamp(15px, 3.8vw, 20px)", fontFamily: "var(--font-sora), sans-serif" }}>
          {hook.replace(/\*\*/g, "") || "How to get started"}
        </h2>
        <div className="flex flex-col gap-2.5">
          {items.map((item, i) => {
            if (item.kind === "bullet") {
              bulletNum++;
              const num = bulletNum;
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex items-center justify-center flex-shrink-0 rounded-full"
                    style={{ width: 20, height: 20, background: `${RED}22`, border: `1px solid ${RED}40`, marginTop: 2 }}>
                    <span className="text-[9px] font-bold" style={{ color: RED }}>{num}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.80)" }}>
                    {item.text}
                  </p>
                </div>
              );
            }
            return (
              <p key={i} className="text-[10.5px] leading-relaxed" style={{ color: BODY_TXT }}>
                {item.text}
              </p>
            );
          })}
        </div>
        <Watermark />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. CTA
// ─────────────────────────────────────────────────────────────────────────────
function CtaCard({ hook, cta }: { hook: string; cta: string }) {
  return (
    <BaseCard>
      <div className="flex flex-col items-center text-center justify-center flex-1 gap-4">
        <DarkIcon size={68}><Heart size={68} color={ICON_CLR} fill={ICON_CLR} /></DarkIcon>
        <h2
          className="font-black text-white text-center leading-tight"
          style={{ fontSize: "clamp(20px, 5vw, 28px)", fontFamily: "var(--font-sora), sans-serif" }}
        >
          {hook.replace(/\*\*/g, "") || "Save this post"}
        </h2>
        <p className="text-[12px] text-center leading-relaxed" style={{ color: BODY_TXT }}>
          and share it with someone who needs to see it 🤍
        </p>
        <div className="flex flex-col items-center gap-1 mt-2">
          <p className="text-[13px] font-bold" style={{ color: RED }}>
            💬 Comment below &amp; 📱 Follow for more
          </p>
          <p className="text-[10px]" style={{ color: BODY_TXT }}>
            {cta.replace(/\*\*/g, "").slice(0, 60) || "Daily content you'll love"}
          </p>
        </div>
      </div>
      <Watermark />
    </BaseCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. REEL
// ─────────────────────────────────────────────────────────────────────────────
function ReelCard({ hook, reelScript, cta }: { hook: string; reelScript?: string; cta: string }) {
  const scenes = reelScript
    ? reelScript.split(/\[(\d+-\d+s|\d+s)\]/i).filter((s) => s.trim())
    : ["Hook", "Scene 1", "Scene 2", "Takeaway", "CTA"];
  const [currentScene, setCurrentScene] = useState(0);

  return (
    <BaseCard>
      <div className="flex flex-col items-center text-center mb-1">
        <div className="flex items-center gap-3 justify-center mb-2">
          <DarkIcon size={40}><Film size={40} color={ICON_CLR} /></DarkIcon>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: RED }} />
            <span className="text-[8px] font-bold" style={{ color: BODY_TXT }}>30-60s</span>
          </div>
        </div>
        <GoldLabel text="Reel Script" />
        <div style={{ height: 1, width: "100%", background: "rgba(255,255,255,0.07)", marginBottom: 8 }} />
      </div>

      {/* Timeline */}
      <div className="flex gap-1 mb-3">
        {scenes.slice(0, 5).map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentScene(i)}
            style={{
              flex: 1, height: 4, borderRadius: 2, border: "none", cursor: "pointer",
              background: i === currentScene ? RED : "rgba(255,255,255,0.15)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      {/* Hook highlight */}
      <div
        className="rounded-lg p-3 mb-3"
        style={{ background: `${RED}10`, border: `1px solid ${RED}28` }}
      >
        <p className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: RED }}>
          🎯 Hook (0-3s)
        </p>
        <p className="text-xs font-bold text-white leading-snug line-clamp-2">
          {hook.replace(/\*\*/g, "") || "Attention-grabbing opener"}
        </p>
      </div>

      {/* Script preview */}
      <div
        className="flex-1 rounded-lg p-3 overflow-hidden"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <p className="text-[8px] font-bold uppercase tracking-wider mb-1.5" style={{ color: BODY_TXT }}>
          Script Preview
        </p>
        <p className="text-[10px] leading-relaxed whitespace-pre-wrap" style={{ color: BODY_TXT }}>
          {reelScript ? reelScript.replace(/\*\*/g, "") : "Full reel script will appear here after generation..."}
        </p>
      </div>
      <div className="text-center mt-2">
        <p className="text-[9px]" style={{ color: `${GOLD}70` }}>
          {cta.replace(/\*\*/g, "").slice(0, 55) || "Follow for more content!"}
        </p>
      </div>
      <Watermark />
    </BaseCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. CAROUSEL  -  matches actual @interventional_heart carousel style
// ─────────────────────────────────────────────────────────────────────────────
function CarouselCardCompact({
  slides,
  hook,
}: {
  slides: Array<{ slide: number; headline: string; body: string }>;
  hook?: string;
}) {
  const [idx, setIdx] = useState(0);
  const slide = slides[idx];
  const isFirst = idx === 0;
  const isLast = idx === slides.length - 1;

  const getSlideIcon = (headline: string, slideIndex: number) => {
    const h = (headline || "").toLowerCase();
    const sz = 58;
    const dark = ICON_CLR;
    if (h.includes("emergency") || h.includes("urgent") || h.includes("immediate") || h.includes("alarm"))
      return <BellRing size={sz} color={dark} fill={dark} />;
    if (h.includes("exert") || h.includes("exercise") || h.includes("physical") || h.includes("activ"))
      return <Activity size={sz} color={dark} />;
    if (h.includes("inform") || h.includes("learn") || h.includes("aware") || h.includes("stay") || h.includes("spark"))
      return <Sparkles size={sz} color={dark} fill={dark} />;
    if (h.includes("save") || h.includes("share") || h.includes("follow") || h.includes("bookmark"))
      return <Heart size={sz} color={dark} fill={dark} />;
    if (h.includes("not") || h.includes("myth") || h.includes("false") || h.includes("wrong") || h.includes("never"))
      return <XCircle size={sz} color={dark} fill={dark} />;
    if (h.includes("prevent") || h.includes("protect") || h.includes("risk") || h.includes("reduce"))
      return <Shield size={sz} color={dark} fill={dark} />;
    if (h.includes("warning") || h.includes("alert") || h.includes("sign") || h.includes("danger"))
      return <AlertTriangle size={sz} color={dark} fill={dark} />;
    if (h.includes("diagnos") || h.includes("treat") || h.includes("cath") || h.includes("clinical"))
      return <Stethoscope size={sz} color={dark} />;
    const defaults = [Heart, Activity, Shield, Zap, BookOpen, BellRing, AlertTriangle];
    const Icon = defaults[slideIndex % defaults.length];
    return <Icon size={sz} color={dark} fill={dark} />;
  };

  return (
    <div
      className="relative rounded-2xl overflow-hidden w-full"
      style={{ aspectRatio: "1/1", background: BG_DARK }}
    >
      <div className="absolute top-0 left-0 right-0 z-20" style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      <div className="absolute bottom-0 left-0 right-0 z-20" style={{ height: 3, background: `linear-gradient(90deg, ${RED}, #ff6b35, ${GOLD})` }} />
      <div className="absolute top-0 left-0 bottom-0 z-10" style={{ width: 7, background: RED }} />

      {/* SLIDE 1  -  Cover */}
      {isFirst && (
        <motion.div
          key="first"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10"
          style={{ paddingLeft: 20, paddingRight: 14, paddingTop: 16, paddingBottom: 10 }}
        >
          <svg viewBox="0 0 120 110" style={{ width: 62, opacity: 0.82 }}>
            <path d="M60,95 C28,74 8,57 8,36 C8,20 20,10 34,12 C43,13 52,19 60,28 C68,19 77,13 86,12 C100,10 112,20 112,36 C112,57 92,74 60,95Z" fill="none" stroke={ICON_CLR} strokeWidth="3.5" strokeLinecap="round" />
            <path d="M60,28 C59,22 57,14 55,9 C53,4 63,2 65,8 C67,14 63,24 60,28Z" fill="none" stroke={ICON_CLR} strokeWidth="2" />
            <path d="M57,26 C53,21 47,17 42,14" fill="none" stroke={ICON_CLR} strokeWidth="2" strokeLinecap="round" />
            <path d="M56,34 C50,40 42,50 38,64 C34,76 39,88 48,92" fill="none" stroke={ICON_CLR} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M64,34 C70,40 78,50 82,62 C86,74 81,86 72,91" fill="none" stroke={ICON_CLR} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full" style={{ background: RED }}>
            <span className="text-[9px]">⚠</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white">WARNING SIGNS</span>
          </div>
          <svg viewBox="0 0 320 28" style={{ width: "84%", opacity: 0.2 }} preserveAspectRatio="none">
            <polyline points="0,14 30,14 42,14 46,3 50,25 54,14 74,14 104,14 116,14 120,2 124,26 128,14 148,14 178,14 190,14 194,3 198,25 202,14 222,14 252,14 264,14 268,3 272,25 276,14 296,14 320,14" fill="none" stroke={RED} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <h1 className="font-black text-white text-center leading-tight" style={{ fontSize: "clamp(22px, 5.5vw, 32px)", fontFamily: "var(--font-sora), sans-serif" }}>
            {(hook || slide.headline).replace(/\*\*/g, "")}
          </h1>
          <div className="text-center mt-1">
            <p className="text-[11px]" style={{ color: BODY_TXT }}>👆 Swipe for all {slides.length} slides</p>
            <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.28)" }}>Tap the caption for full details ↓</p>
          </div>
        </motion.div>
      )}

      {/* LAST SLIDE  -  CTA */}
      {isLast && !isFirst && (
        <motion.div
          key="last"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10"
          style={{ paddingLeft: 20, paddingRight: 14 }}
        >
          <Heart size={68} color={ICON_CLR} fill={ICON_CLR} />
          <h2 className="font-black text-white text-center leading-tight" style={{ fontSize: "clamp(20px, 5.5vw, 30px)", fontFamily: "var(--font-sora), sans-serif" }}>
            {slide.headline.replace(/\*\*/g, "") || "Save this post"}
          </h2>
          <p className="text-[12px] text-center leading-relaxed" style={{ color: BODY_TXT }}>
            {slide.body || "and share it with someone who needs to see it 🤍"}
          </p>
          <p className="text-[13px] font-bold text-center" style={{ color: RED }}>💬 Comment below &amp; 📱 Follow for more</p>
          <p className="text-[10px]" style={{ color: BODY_TXT }}>Daily content you'll love</p>
        </motion.div>
      )}

      {/* MIDDLE SLIDES */}
      {!isFirst && !isLast && (
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 flex flex-col items-center justify-around z-10"
            style={{ paddingLeft: 20, paddingRight: 14, paddingTop: 20, paddingBottom: 12 }}
          >
            <div style={{ marginTop: 4, opacity: 0.82 }}>{getSlideIcon(slide.headline, idx)}</div>
            <h2 className="font-black text-white text-center leading-tight" style={{ fontSize: "clamp(20px, 5.5vw, 32px)", fontFamily: "var(--font-sora), sans-serif" }}>
              {slide.headline.replace(/\*\*/g, "")}
            </h2>
            <p className="text-center leading-relaxed" style={{ fontSize: "clamp(11px, 2.5vw, 13px)", color: BODY_TXT }}>
              {slide.body.replace(/\*\*/g, "")}
            </p>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Dot indicators */}
      <div className="absolute z-20 flex items-center justify-center gap-1.5" style={{ bottom: 12, left: 14, right: 0 }}>
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            style={{ width: i === idx ? 18 : 6, height: 6, borderRadius: 3, background: i === idx ? "white" : "rgba(255,255,255,0.28)", border: "none", cursor: "pointer", transition: "all 0.2s", padding: 0 }}
          />
        ))}
      </div>

      {idx > 0 && (
        <button onClick={() => setIdx(Math.max(0, idx - 1))} className="absolute z-30 flex items-center justify-center" style={{ left: 16, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.18)", border: "none", cursor: "pointer" }}>
          <ChevronLeft size={15} color="white" />
        </button>
      )}
      {idx < slides.length - 1 && (
        <button onClick={() => setIdx(Math.min(slides.length - 1, idx + 1))} className="absolute z-30 flex items-center justify-center" style={{ right: 10, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.18)", border: "none", cursor: "pointer" }}>
          <ChevronRight size={15} color="white" />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export default function PostVisualCard({
  postType, title, hook, content, cta, hashtags, imagePrompt, viralScore, reelScript, carouselSlides,
}: PostVisualCardProps) {
  const brand = useBrand();
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleGenerateImage = async () => {
    setGeneratingImage(true);
    setImageLoaded(false);
    setImageError(false);
    try {
      const typeLabel = postType.toLowerCase().replace(/_/g, " ");
      const nicheText = brand.niche && brand.niche !== "your topic" ? brand.niche : "lifestyle";
      const fullPrompt = [
        `professional ${nicheText} Instagram post`,
        "modern dark background",
        "bold accent colors",
        `${typeLabel} visual style`,
        imagePrompt,
        "ultra high quality 1080x1080",
        "no text overlay",
        "cinematic aesthetic",
      ].filter(Boolean).join(", ");

      const seed = Math.floor(Math.random() * 999999);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1080&height=1080&nologo=true&seed=${seed}&model=flux`;
      setGeneratedImageUrl(url);
      toast.success("Generating image... (may take 20-40s) ✨");
    } finally {
      setGeneratingImage(false);
    }
  };

  const renderCard = () => {
    if (postType === "CAROUSEL" && carouselSlides?.length) {
      return <CarouselCardCompact slides={carouselSlides} hook={hook} />;
    }
    switch (postType) {
      case "EDUCATIONAL":       return <EducationalCard hook={hook} content={content} />;
      case "QUIZ":              return <QuizCard hook={hook} content={content} />;
      case "MYTH_FACT":         return <MythFactCard hook={hook} content={content} />;
      case "CLINICAL_PEARL":    return <ClinicalPearlCard hook={hook} content={content} />;
      case "CASE_STUDY":        return <CaseStudyCard hook={hook} content={content} />;
      case "ECG_QUIZ":          return <EcgQuizCard hook={hook} content={content} />;
      case "ANGIOGRAPHY_QUIZ":  return <AngiographyQuizCard hook={hook} content={content} />;
      case "PREVENTIVE":        return <PreventiveCard hook={hook} content={content} />;
      case "CTA":               return <CtaCard hook={hook} cta={cta} />;
      case "REEL":              return <ReelCard hook={hook} reelScript={reelScript} cta={cta} />;
      default:                  return <EducationalCard hook={hook} content={content} />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        {renderCard()}

        {generatedImageUrl && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: imageLoaded ? 1 : 0 }} className="absolute inset-0 rounded-2xl overflow-hidden">
            {!imageLoaded && !imageError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl" style={{ background: "rgba(26,20,40,0.92)" }}>
                <Loader2 size={28} className="animate-spin" style={{ color: RED }} />
                <p className="text-xs" style={{ color: `${RED}90` }}>Loading image from Pollinations.ai...</p>
              </div>
            )}
            {imageError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl" style={{ background: "rgba(26,20,40,0.92)" }}>
                <p className="text-xs text-red-400">Image failed to load  -  try again</p>
              </div>
            )}
            <img src={generatedImageUrl} alt="AI Generated" className="w-full h-full object-cover" onLoad={() => setImageLoaded(true)} onError={() => { setImageError(true); setImageLoaded(false); }} />
            {imageLoaded && (
              <>
                <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.3)" }} />
                <button onClick={() => { setGeneratedImageUrl(null); setImageLoaded(false); setImageError(false); }} className="absolute top-3 right-3 p-1.5 rounded-lg text-xs" style={{ background: "rgba(0,0,0,0.65)", color: "rgba(255,255,255,0.7)" }}>✕</button>
              </>
            )}
          </motion.div>
        )}

        {generatingImage && (
          <div className="absolute inset-0 rounded-2xl flex items-center justify-center" style={{ background: "rgba(26,20,40,0.8)" }}>
            <Loader2 size={32} className="animate-spin" style={{ color: RED }} />
          </div>
        )}
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleGenerateImage}
        disabled={generatingImage}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-all"
        style={{ background: `linear-gradient(135deg, ${RED}22, rgba(255,107,53,0.18))`, border: `1px solid ${RED}35` }}
      >
        {generatingImage ? (
          <><Loader2 size={14} className="animate-spin" /> Generating image...</>
        ) : generatedImageUrl ? (
          <><RefreshCw size={14} /> Regenerate AI Image</>
        ) : (
          <><ImageIcon size={14} /> Generate AI Image for This Post</>
        )}
      </motion.button>

      {generatedImageUrl && imageLoaded && (
        <motion.a
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          href={generatedImageUrl} target="_blank" rel="noopener noreferrer"
          className="block text-center text-xs underline underline-offset-2 transition-colors"
          style={{ color: `${RED}60` }}
        >
          Open full resolution ↗
        </motion.a>
      )}
    </div>
  );
}
