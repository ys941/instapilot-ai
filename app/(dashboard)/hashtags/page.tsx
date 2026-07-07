"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Hash,
  Search,
  Copy,
  Loader2,
  TrendingUp,
  AlertTriangle,
  Bookmark,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

interface Hashtag {
  tag: string;
  score: number;
  reach: string;
  engProb: string;
  banned?: boolean;
}

// Static banned-tag warnings only  -  all other data comes from the API
const bannedWarnings = ["#Follow4Follow", "#Like4Like", "#SpamTag"];

// Default packs shown before any generation  -  generic starters; real packs
// come from the AI generator, anchored to the brand's niche + hashtag seeds.
const defaultPacks = [
  { name: "Reach Pack",      tags: ["#instagram", "#instagood", "#explore", "#explorepage", "#viral", "#trending", "#reels", "#contentcreator", "#community", "#growth"] },
  { name: "Engagement Pack", tags: ["#tips", "#howto", "#learnsomethingnew", "#didyouknow", "#dailytips", "#motivation", "#inspiration", "#knowledge", "#advice", "#guide"] },
  { name: "Niche Pack",      tags: ["#yourtopic", "#yourniche", "#creator", "#educational", "#valuepost", "#sharethis", "#savethis", "#followformore", "#instadaily", "#contentstrategy"] },
];

function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatEngProb(p: number): string {
  if (p >= 0.04) return "Very High";
  if (p >= 0.025) return "High";
  if (p >= 0.015) return "Medium";
  return "Low";
}

function HashtagCard({ tag, score, reach, engProb, color, banned = false }: Hashtag & { color: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(tag);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success(`Copied ${tag}`);
  };

  const scoreColor = score >= 80 ? "#ef4444" : score >= 60 ? "#f59e0b" : "#3b82f6";

  return (
    <motion.div
      whileHover={{ scale: 1.02, x: 2 }}
      onClick={handleCopy}
      className={cn("p-3 rounded-xl cursor-pointer border transition-all group", banned ? "border-red-500/30 bg-red-500/5" : "border-white/[0.05] hover:border-white/[0.12]")}
      style={{ background: banned ? undefined : "rgba(255,255,255,0.02)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={cn("text-xs font-semibold", color)}>{tag}</span>
        {banned ? (
          <AlertTriangle size={12} className="text-red-400" />
        ) : (
          <motion.div animate={{ opacity: copied ? 1 : 0 }} className="text-emerald-400">
            <Check size={12} />
          </motion.div>
        )}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: scoreColor }} />
        </div>
        <span className="text-[10px] text-white/40 w-6 text-right">{score}</span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-white/30">
        <span>Reach: {reach}</span>
        <span className={cn("font-medium", engProb === "Very High" ? "text-emerald-400" : engProb === "High" ? "text-blue-400" : "text-yellow-400")}>
          {engProb} eng.
        </span>
      </div>
    </motion.div>
  );
}

export default function HashtagsPage() {
  const [topic,   setTopic]   = useState("");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [totalReach, setTotalReach] = useState<string>("");

  const [highVolume, setHighVolume]   = useState<Hashtag[]>([]);
  const [medium,     setMedium]       = useState<Hashtag[]>([]);
  const [niche,      setNiche]        = useState<Hashtag[]>([]);
  const [trending,   setTrending]     = useState<Hashtag[]>([]);

  const handleGenerate = async () => {
    if (!topic.trim()) { toast.error("Enter a topic first"); return; }
    setLoading(true);
    try {
      const res  = await fetch("/api/ai/hashtags", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ topic: topic.trim(), count: 25 }),
      });
      const data = await res.json();
      if (!data.success) { toast.error(data.error ?? "Failed to generate hashtags"); return; }

      const map = (arr: any[]): Hashtag[] =>
        arr.map((h: any) => ({
          tag:     h.tag,
          score:   Math.round((h.score ?? 0.5) * 100),
          reach:   formatReach(h.estimatedReach ?? 0),
          engProb: formatEngProb(h.engagementProbability ?? 0),
        }));

      setHighVolume(map(data.data.byCategory.HIGH_VOLUME   ?? []));
      setMedium(    map(data.data.byCategory.MEDIUM_COMPETITION ?? []));
      setNiche(     map(data.data.byCategory.NICHE         ?? []));
      setTrending(  map(data.data.byCategory.TRENDING      ?? []));
      setTotalReach(formatReach(data.data.totalReach ?? 0));
      setGenerated(true);
      toast.success(`Generated ${data.data.totalHashtags} hashtags  -  total reach ${formatReach(data.data.totalReach ?? 0)}`);
    } catch {
      toast.error("Network error  -  please try again");
    } finally {
      setLoading(false);
    }
  };

  const copyPack = (tags: string[]) => {
    navigator.clipboard.writeText(tags.join(" "));
    toast.success(`Copied ${tags.length} hashtags!`);
  };

  const allGenerated = [...highVolume, ...medium, ...niche];

  const columns = [
    { title: "High Volume",          subtitle: "Broad reach, more competition",     tags: highVolume, badge: "bg-red-500/10 text-red-400 border-red-500/20",    tagColor: "text-red-300" },
    { title: "Medium Competition",   subtitle: "Balanced reach & engagement",        tags: medium,     badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", tagColor: "text-yellow-300" },
    { title: "Niche",                subtitle: "Targeted, very high engagement",     tags: niche,      badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",   tagColor: "text-blue-300" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl mx-auto space-y-6">
      {/* Generator bar */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "rgb(var(--surface-rgb) / 0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
            Hashtag Intelligence Engine
          </h3>
          {generated && totalReach && (
            <span className="text-[11px] text-emerald-400 font-medium">
              ~{totalReach} total estimated reach
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Enter topic or keyword (e.g. your niche or post topic)"
              className="w-full pl-9 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm text-white disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #ef4444, #ec4899)", boxShadow: "0 0 20px rgba(239,68,68,0.3)" }}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {loading ? "Analyzing..." : "Generate"}
          </motion.button>
        </div>

        {/* Banned warnings */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <AlertTriangle size={11} className="text-red-400/60" />
          <span className="text-[11px] text-white/30">Banned tags (avoid):</span>
          {bannedWarnings.map((t) => (
            <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400/70 border border-red-500/15">{t}</span>
          ))}
        </div>
      </div>

      {/* Hashtag columns  -  only shown after real generation */}
      <AnimatePresence>
        {generated && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {columns.map((col, ci) => (
              <motion.div
                key={col.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: ci * 0.1 }}
                className="rounded-2xl overflow-hidden"
                style={{ background: "rgb(var(--surface-rgb) / 0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>{col.title}</h4>
                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", col.badge)}>{col.tags.length}</span>
                    </div>
                    <p className="text-[11px] text-white/30 mt-0.5">{col.subtitle}</p>
                  </div>
                  <button
                    onClick={() => copyPack(col.tags.map((t) => t.tag))}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/50 hover:text-white border border-white/[0.08] hover:border-white/[0.15] transition-all"
                  >
                    <Copy size={10} /> Copy Pack
                  </button>
                </div>
                <div className="p-3 space-y-2">
                  {col.tags.length === 0 ? (
                    <p className="text-[11px] text-white/30 text-center py-4">No tags in this category for this topic</p>
                  ) : col.tags.map((tag, ti) => (
                    <motion.div key={tag.tag} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: ci * 0.1 + ti * 0.04 }}>
                      <HashtagCard {...tag} color={col.tagColor} />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Copy All  -  only shown after generation */}
      {generated && allGenerated.length > 0 && (
        <div className="flex justify-center">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => copyPack(allGenerated.map((t) => t.tag))}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white border border-white/[0.1] hover:border-white/[0.2] transition-all"
            style={{ background: "rgb(var(--surface-rgb) / 0.8)" }}
          >
            <Copy size={15} />
            Copy All {allGenerated.length} Hashtags
          </motion.button>
        </div>
      )}

      {/* Bottom section: Trending + Saved Packs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trending  -  from last generation, or default if not generated yet */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "rgb(var(--surface-rgb) / 0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-red-400" />
            <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
              {generated ? `Top Tags for "${topic}"` : "Trending Tags"}
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(generated ? [...trending, ...highVolume].slice(0, 6) : defaultPacks[0].tags.slice(0, 6).map(t => ({ tag: t }))).map((t: any, i: number) => (
              <motion.div
                key={t.tag}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ scale: 1.03 }}
                onClick={() => { navigator.clipboard.writeText(t.tag); toast.success(`Copied ${t.tag}`); }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.06] hover:border-red-500/20 bg-white/[0.02] hover:bg-red-500/5 cursor-pointer transition-all"
              >
                <Hash size={10} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-white/70 font-medium truncate">{t.tag.replace("#", "")}</span>
                {t.reach && <span className="ml-auto text-[10px] text-white/30">{t.reach}</span>}
              </motion.div>
            ))}
          </div>
          {!generated && (
            <p className="text-[11px] text-white/25 mt-3 text-center">Enter a topic above to generate custom hashtags</p>
          )}
        </div>

        {/* Saved Packs */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "rgb(var(--surface-rgb) / 0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Bookmark size={14} className="text-purple-400" />
            <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>Saved Hashtag Packs</h3>
          </div>
          <div className="space-y-3">
            {defaultPacks.map((pack, i) => (
              <motion.div
                key={pack.name}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className="p-3 rounded-xl border border-white/[0.05] hover:border-white/[0.1] transition-all"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-white">{pack.name}</p>
                  <button
                    onClick={() => copyPack(pack.tags)}
                    className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white transition-colors"
                  >
                    <Copy size={9} /> Copy
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {pack.tags.slice(0, 5).map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400/80 border border-purple-500/15">
                      {tag}
                    </span>
                  ))}
                  {pack.tags.length > 5 && (
                    <span className="text-[10px] text-white/25 flex items-center">+{pack.tags.length - 5} more</span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
