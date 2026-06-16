"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MoreHorizontal, Smile, ChevronLeft, ChevronRight } from "lucide-react";
import { useBrand } from "@/components/BrandContext";

export interface InstagramPostPreviewProps {
  username?: string;
  content: string;
  hook?: string;
  hashtags?: string[];
  type?: string;
  viralScore?: number;
  imagePrompt?: string;
  mediaUrl?: string; // actual generated card image
}

// ─── Instagram story-ring gradient avatar ─────────────────────────────────────
function IgAvatar({ size = 32 }: { size?: number }) {
  const ring = size + 6;
  return (
    <div style={{ width: ring, height: ring, borderRadius: "50%", padding: 2, background: "linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)", flexShrink: 0 }}>
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#000", border: "2px solid #000", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <svg viewBox="0 0 40 40" style={{ width: size - 4, height: size - 4 }}>
          <defs>
            <linearGradient id="ig-av-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          <circle cx="20" cy="20" r="20" fill="#1a0a0a" />
          {/* heart icon */}
          <path d="M20 30 C10 22 5 16 5 11 C5 6 9 3 13 4 C16 5 19 8 20 11 C21 8 24 5 27 4 C31 3 35 6 35 11 C35 16 30 22 20 30Z"
            fill="url(#ig-av-grad)" />
        </svg>
      </div>
    </div>
  );
}

// ─── Image placeholder (decorative pulse + accent) ───────────────────────────
function ImagePlaceholder({ handle }: { handle: string }) {
  return (
    <div style={{ width: "100%", paddingBottom: "100%", position: "relative", background: "linear-gradient(150deg,#0a0010 0%,#0d0020 50%,#080010 100%)" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* subtle grid */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.15 }}>
          <defs>
            <pattern id="ig-grid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e63946" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ig-grid)" />
        </svg>
        {/* ECG line */}
        <svg viewBox="0 0 400 60" style={{ position: "absolute", width: "90%", opacity: 0.4, top: "50%", transform: "translateY(-50%)" }} preserveAspectRatio="none">
          <motion.polyline
            points="0,30 40,30 55,30 60,8 65,52 70,30 90,30 130,30 145,30 150,5 155,55 160,30 185,30 225,30 240,30 245,6 250,54 255,30 280,30 315,30 330,30 335,7 340,53 345,30 375,30 400,30"
            fill="none" stroke="#e63946" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ pathLength: { duration: 3.5, ease: "linear", repeat: Infinity, repeatType: "loop" }, opacity: { duration: 0.5 } }}
          />
        </svg>
        {/* heart */}
        <motion.svg viewBox="0 0 120 110" style={{ position: "absolute", width: "38%", opacity: 0.12 }}
          animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}>
          <path d="M60,95 C28,74 8,57 8,36 C8,20 20,10 34,12 C43,13 52,19 60,28 C68,19 77,13 86,12 C100,10 112,20 112,36 C112,57 92,74 60,95Z"
            fill="none" stroke="#e63946" strokeWidth="1.5" strokeLinecap="round" />
        </motion.svg>
        {/* label */}
        <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, textAlign: "center" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em", fontFamily: "-apple-system,sans-serif" }}>
            {handle}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Instagram heart SVG (outline / filled) ───────────────────────────────────
function IgHeart({ filled, color }: { filled: boolean; color: string }) {
  return (
    <svg aria-label="Like" height="24" viewBox="0 0 48 48" width="24">
      {filled
        ? <path d="M34.6 3.1c-4.5 0-7.9 1.8-10.6 5.6-2.7-3.7-6.1-5.5-10.6-5.5C6 3.1 0 9.6 0 17.6c0 7.3 5.4 12 10.6 16.5.6.5 1.3 1.1 1.9 1.7l2.3 2c4.4 3.9 6.6 5.9 9.2 7.4.6.3 1.2.5 1.8.5.7 0 1.4-.2 2-.5 2.6-1.5 4.8-3.5 9.2-7.4l2.3-2c.6-.6 1.3-1.1 1.9-1.7C45.5 29.6 48 25 48 17.6c0-8-6-14.5-13.4-14.5z"
          fill={color} />
        : <path d="M34.6 6.1c5.7 0 10.4 5.2 10.4 11.5 0 6.8-5.9 11-11.5 16S23 39.5 24 39.5c-1 0-6.3-5.2-11.5-10.4S1 19.2 1 12.7C1 6.4 5.7 1.2 11.4 1.2c4.2 0 7.4 2.4 9 5.1C21.9 4 25.7 1.2 29.7 1.2c-.8 0 1.6.3 4.9 4.9zM12 6.2c-3.6 0-6.8 3.3-6.8 6.5 0 5.2 5 9.6 11.8 15.8l7 6.4 7-6.4c6.8-6.2 11.8-10.6 11.8-15.8 0-3.2-3.2-6.5-6.8-6.5-2.3 0-4.6 1.5-6 3.6l-5.9 8.9-5.9-8.9c-1.4-2.1-3.7-3.6-6-3.6z"
          fill={color} clipRule="evenodd" fillRule="evenodd" />
      }
    </svg>
  );
}

// ─── Instagram comment SVG ────────────────────────────────────────────────────
function IgComment() {
  return (
    <svg aria-label="Comment" height="24" viewBox="0 0 48 48" width="24">
      <path clipRule="evenodd" d="M47.5 46.1l-2.8-11c1.8-3.3 2.8-7.1 2.8-11.1C47.5 11 37.5 1 25 1S2.5 11 2.5 24 12.5 47 25 47c4 0 7.8-1 11.1-2.8l11.4 2.9zM25 5c10.5 0 19 8.5 19 19S35.5 43 25 43c-3.7 0-7.2-1-10.1-2.8l-1-.6-9.5 2.4 2.4-9.2-.7-1C4.9 29.2 4 26.2 4 23c0-11.6 9.5-19 21-19z" fill="rgba(255,255,255,0.8)" fillRule="evenodd" />
    </svg>
  );
}

// ─── Instagram share SVG ──────────────────────────────────────────────────────
function IgShare() {
  return (
    <svg aria-label="Share Post" height="24" viewBox="0 0 48 48" width="24">
      <path d="M47.8 3.8c-.3-.5-.8-.8-1.3-.8h-45C.9 3.1.3 3.5.1 4S0 5.2.4 5.7l15.9 15.6 5.5 22.6c.1.6.6 1 1.2 1.1h.2c.5 0 1-.3 1.3-.7l23.2-39c.4-.4.4-1 .1-1.5zM5.2 6.1h35.5L18 18.7 5.2 6.1zm18.7 33.6l-4.4-18.4 20.5-12.6-16.1 31z" fill="rgba(255,255,255,0.8)" />
    </svg>
  );
}

// ─── Instagram bookmark SVG ───────────────────────────────────────────────────
function IgBookmark({ filled }: { filled: boolean }) {
  return (
    <svg aria-label="Save" height="24" viewBox="0 0 48 48" width="24">
      {filled
        ? <path d="M43.5 48c-.4 0-.8-.2-1.1-.4L24 29 5.6 47.6c-.4.4-1.1.6-1.6.3-.6-.2-1-.8-1-1.4v-45C3 .7 3.7 0 4.5 0h39c.8 0 1.5.7 1.5 1.5v45c0 .6-.4 1.2-.9 1.4-.2.1-.4.1-.6.1z" fill="rgba(255,255,255,0.9)" />
        : <path d="M43.5 48c-.4 0-.8-.2-1.1-.4L24 29 5.6 47.6c-.4.4-1.1.6-1.6.3-.6-.2-1-.8-1-1.4v-45C3 .7 3.7 0 4.5 0h39c.8 0 1.5.7 1.5 1.5v45c0 .6-.4 1.2-.9 1.4-.2.1-.4.1-.6.1zM24 26c.8 0 1.6.3 2.2.9l15.3 16V3H6.5v39.9l15.3-16c.6-.6 1.4-.9 2.2-.9z" fill="rgba(255,255,255,0.8)" />
      }
    </svg>
  );
}

// ─── Viral score ring ─────────────────────────────────────────────────────────
function ViralRing({ score }: { score: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 52, height: 52 }}>
        <svg width="52" height="52" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
          <motion.circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="3.5"
            strokeLinecap="round" strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "-apple-system,sans-serif" }}>{score}</span>
        </div>
      </div>
      <div>
        <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.6)", fontFamily: "-apple-system,sans-serif" }}>Viral Score</p>
        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "-apple-system,sans-serif" }}>/ 100</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function InstagramPostPreview({
  username,
  content,
  hook,
  hashtags = [],
  type,
  viralScore = 0,
  imagePrompt,
  mediaUrl,
}: InstagramPostPreviewProps) {
  const brand = useBrand();
  const handleText = username || brand.handle || "yourhandle";
  const atHandleText = `@${handleText.replace(/^@/, "")}`;
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [liked, setLiked]   = useState(false);
  const [saved, setSaved]   = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const score    = viralScore <= 1 ? Math.round(viralScore * 100) : Math.round(viralScore);
  const baseLikes    = Math.round(score * 4800 + 800);
  const baseComments = Math.round(baseLikes * 0.035);
  const baseSaves    = Math.round(baseLikes * 0.08);
  const baseReach    = Math.round(baseLikes * 3.5);
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  const fullCaption  = [hook, content].filter(Boolean).join("\n\n");
  const shortCaption = fullCaption.length > 200 ? fullCaption.slice(0, 200).trimEnd() : fullCaption;
  const isTruncated  = fullCaption.length > 200;

  // ── Instagram dark-mode colours ──
  const BG      = "#000";
  const DIVIDER = "#262626";
  const TEXT1   = "#f5f5f5";
  const TEXT2   = "#a8a8a8";
  const BLUE    = "#0095f6";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      {/* ══════════════════════════════════════════════════════
          INSTAGRAM POST CARD  -  pixel-perfect dark mode
      ══════════════════════════════════════════════════════ */}
      <div style={{
        background: BG,
        border: `1px solid ${DIVIDER}`,
        borderRadius: 12,
        overflow: "hidden",
        maxWidth: 470,
        width: "100%",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
      }}>

        {/* ── Header ───────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px 8px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <IgAvatar size={34} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: TEXT1, lineHeight: 1.2, margin: 0 }}>{handleText}</p>
              {type && (
                <p style={{ fontSize: 11, color: TEXT2, margin: 0, lineHeight: 1.2 }}>
                  {type.replace(/_/g, " ").toLowerCase()}
                </p>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button style={{ fontSize: 14, fontWeight: 600, color: BLUE, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Follow
            </button>
            <MoreHorizontal size={20} color={TEXT1} />
          </div>
        </div>

        {/* ── Post image (square) ───────────────────────────── */}
        <div style={{ position: "relative", width: "100%", aspectRatio: "1/1", background: "#111", overflow: "hidden" }}>
          {mediaUrl ? (
            <>
              {!imgLoaded && <ImagePlaceholder handle={atHandleText} />}
              <img
                src={mediaUrl}
                alt="Post card"
                onLoad={() => setImgLoaded(true)}
                style={{
                  position: imgLoaded ? "relative" : "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                  opacity: imgLoaded ? 1 : 0,
                  transition: "opacity 0.5s ease",
                }}
              />
            </>
          ) : (
            <ImagePlaceholder handle={atHandleText} />
          )}
        </div>

        {/* ── Action bar ───────────────────────────────────── */}
        <div style={{ padding: "6px 12px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={() => setLiked(v => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}
              >
                <IgHeart filled={liked} color={liked ? "#ff0000" : TEXT1} />
              </motion.button>
              <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}>
                <IgComment />
              </button>
              <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}>
                <IgShare />
              </button>
            </div>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => setSaved(v => !v)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}
            >
              <IgBookmark filled={saved} />
            </motion.button>
          </div>
        </div>

        {/* ── Likes ────────────────────────────────────────── */}
        <div style={{ padding: "4px 16px 0" }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT1, margin: 0 }}>
            {fmt(baseLikes + (liked ? 1 : 0))} likes
          </p>
        </div>

        {/* ── Caption ──────────────────────────────────────── */}
        <div style={{ padding: "6px 16px 0" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT1 }}>{username} </span>
          <span style={{ fontSize: 14, color: TEXT1, lineHeight: 1.5 }}>
            {captionExpanded ? fullCaption : shortCaption}
            {isTruncated && !captionExpanded && (
              <>{"... "}
                <button onClick={() => setCaptionExpanded(true)}
                  style={{ fontSize: 14, color: TEXT2, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  more
                </button>
              </>
            )}
          </span>
        </div>

        {/* ── Hashtags ─────────────────────────────────────── */}
        {hashtags.length > 0 && (
          <div style={{ padding: "4px 16px 0", display: "flex", flexWrap: "wrap", gap: "2px 4px" }}>
            {hashtags.map((tag) => (
              <span key={tag} style={{ fontSize: 14, color: "#e0f1ff", cursor: "pointer" }}>
                {tag.startsWith("#") ? tag : `#${tag}`}
              </span>
            ))}
          </div>
        )}

        {/* ── View comments ────────────────────────────────── */}
        <div style={{ padding: "6px 16px 0" }}>
          <button style={{ fontSize: 14, color: TEXT2, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            View all {fmt(baseComments)} comments
          </button>
        </div>

        {/* ── Sample comments ──────────────────────────────── */}
        <div style={{ padding: "4px 16px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            { user: "alex_creates",   text: "This is incredibly helpful 🙏 saving this for later!" },
            { user: "jordan.makes",   text: "Always learning from your posts 💙 keep it up!" },
          ].map((c) => (
            <p key={c.user} style={{ fontSize: 14, color: TEXT1, margin: 0, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 600 }}>{c.user} </span>
              <span style={{ color: "rgba(245,245,245,0.85)" }}>{c.text}</span>
            </p>
          ))}
        </div>

        {/* ── Timestamp ────────────────────────────────────── */}
        <div style={{ padding: "6px 16px 2px" }}>
          <p style={{ fontSize: 10, color: TEXT2, textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
            2 hours ago
          </p>
        </div>

        {/* ── Add a comment ────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 12px", borderTop: `1px solid ${DIVIDER}`, marginTop: 10 }}>
          <IgAvatar size={26} />
          <span style={{ flex: 1, fontSize: 14, color: TEXT2 }}>Add a comment...</span>
          <Smile size={16} color={TEXT2} />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          STATS ROW
      ══════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        {score > 0 && <ViralRing score={score} />}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1 }}>
          {[
            { emoji: "❤️", label: "Est. Likes",    value: fmt(baseLikes) },
            { emoji: "💬", label: "Comments",      value: fmt(baseComments) },
            { emoji: "🔖", label: "Saves",         value: fmt(baseSaves) },
            { emoji: "👁️", label: "Reach",         value: fmt(baseReach) },
          ].map(({ emoji, label, value }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
              <span style={{ fontSize: 14 }}>{emoji}</span>
              <div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", margin: 0, fontFamily: "-apple-system,sans-serif" }}>{label}</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0, fontFamily: "-apple-system,sans-serif" }}>{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Caption meta */}
        <div style={{ padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "-apple-system,sans-serif", flexShrink: 0 }}>
          <span>{fullCaption.length} chars</span>
          {fullCaption.length > 2200 && <span style={{ color: "#f87171", marginLeft: 4 }}>(over IG limit)</span>}
          <span style={{ margin: "0 6px" }}>·</span>
          <span>{hashtags.length} tags</span>
          {hashtags.length > 30 && <span style={{ color: "#fbbf24", marginLeft: 4 }}>(max 30)</span>}
        </div>
      </div>
    </motion.div>
  );
}
