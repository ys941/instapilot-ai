"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Sparkles,
  Calendar,
  BarChart2,
  MessageCircle,
  Activity,
  Filter,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  XCircle,
  Trash2,
  AtSign,
  Heart,
  BookOpen,
  Youtube,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useSelectedBrand, withBrand } from "@/components/dashboard/useSelectedBrand";

// ─── Action => display config ─────────────────────────────────────────────────
type ActionConfig = {
  icon: React.ElementType;
  color: string;
  bg: string;
  glow: string;
  label: string;
};

function getActionConfig(action: string): ActionConfig {
  const a = action?.toUpperCase() ?? "";
  if (a === "POST_PUBLISHED")
    return { icon: Send,          color: "text-emerald-400", bg: "bg-emerald-500/10", glow: "rgba(16,185,129,0.15)",  label: "Published" };
  if (a === "POST_CREATED" || a === "CONTENT_GENERATED")
    return { icon: Sparkles,      color: "text-yellow-400",  bg: "bg-yellow-500/10",  glow: "rgba(245,158,11,0.15)",  label: "Generated" };
  if (a === "POST_SCHEDULED")
    return { icon: Calendar,      color: "text-blue-400",    bg: "bg-blue-500/10",    glow: "rgba(59,130,246,0.15)",  label: "Scheduled" };
  if (a === "WORKFLOW_EXECUTED")
    return { icon: Activity,      color: "text-orange-400",  bg: "bg-orange-500/10",  glow: "rgba(249,115,22,0.15)",  label: "Workflow" };
  if (a === "ANALYTICS_SYNCED")
    return { icon: BarChart2,     color: "text-cyan-400",    bg: "bg-cyan-500/10",    glow: "rgba(6,182,212,0.15)",   label: "Analytics" };
  if (a === "COMMENT_RECEIVED")
    return { icon: MessageCircle, color: "text-pink-400",    bg: "bg-pink-500/10",    glow: "rgba(236,72,153,0.15)",  label: "Comment" };
  if (a === "DM_AUTO_REPLIED" || a === "DM_RECEIVED")
    return { icon: MessageCircle, color: "text-purple-400",  bg: "bg-purple-500/10",  glow: "rgba(168,85,247,0.15)",  label: a === "DM_RECEIVED" ? "DM" : "DM Reply" };
  if (a === "AUTO_REPLY_SENT")
    return { icon: MessageCircle, color: "text-pink-400",    bg: "bg-pink-500/10",    glow: "rgba(236,72,153,0.15)",  label: "Auto Reply" };
  if (a === "MENTION_RECEIVED")
    return { icon: AtSign,        color: "text-yellow-400",  bg: "bg-yellow-500/10",  glow: "rgba(245,158,11,0.15)",  label: "Mention" };
  if (a === "DM_REACTION")
    return { icon: Heart,         color: "text-rose-400",    bg: "bg-rose-500/10",    glow: "rgba(244,63,94,0.15)",   label: "Reaction" };
  if (a === "STORY_INSIGHTS")
    return { icon: BookOpen,      color: "text-cyan-400",    bg: "bg-cyan-500/10",    glow: "rgba(6,182,212,0.15)",   label: "Story Insights" };
  if (a === "YOUTUBE_PUBLISHED" || a === "YOUTUBE")
    return { icon: Youtube,       color: "text-red-500",     bg: "bg-red-600/10",     glow: "rgba(255,0,0,0.18)",     label: "YouTube" };
  if (a === "YOUTUBE_COMMENTS_REPLIED" || a === "YOUTUBE_REPLY")
    return { icon: Youtube,       color: "text-red-500",     bg: "bg-red-600/10",     glow: "rgba(255,0,0,0.18)",     label: "YouTube Reply" };
  if (a === "DELETE_ALL_DRAFTS" || a === "CLEAR_LIBRARY" || a === "CANCEL_ALL_SCHEDULED")
    return { icon: Trash2,        color: "text-red-400",     bg: "bg-red-500/10",     glow: "rgba(239,68,68,0.15)",   label: "Deleted" };
  return   { icon: Activity,      color: "text-white/40",    bg: "bg-white/5",        glow: "rgba(255,255,255,0.05)", label: "Activity" };
}

// Each filter chip maps its display label to a representative real action key,
// so getActionConfig() returns the correct icon/color (deriving the key from the
// label produced wrong matches for multi-word labels like "DM" or "Generated").
const FILTER_CHIPS: { label: string; action: string }[] = [
  { label: "Published",      action: "POST_PUBLISHED" },
  { label: "Generated",      action: "POST_CREATED" },
  { label: "Scheduled",      action: "POST_SCHEDULED" },
  { label: "Workflow",       action: "WORKFLOW_EXECUTED" },
  { label: "Analytics",      action: "ANALYTICS_SYNCED" },
  { label: "Comment",        action: "COMMENT_RECEIVED" },
  { label: "DM",             action: "DM_RECEIVED" },
  { label: "DM Reply",       action: "DM_AUTO_REPLIED" },
  { label: "Auto Reply",     action: "AUTO_REPLY_SENT" },
  { label: "Mention",        action: "MENTION_RECEIVED" },
  { label: "Reaction",       action: "DM_REACTION" },
  { label: "Story Insights", action: "STORY_INSIGHTS" },
  { label: "YouTube",        action: "YOUTUBE_PUBLISHED" },
  { label: "YouTube Reply",  action: "YOUTUBE_COMMENTS_REPLIED" },
  { label: "Deleted",        action: "DELETE_ALL_DRAFTS" },
  { label: "Activity",       action: "ACTIVITY" },
];

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "SUCCESS" || status === "success")
    return (
      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
        <CheckCircle size={8} /> success
      </span>
    );
  if (status === "ERROR" || status === "error" || status === "FAILED" || status === "failed")
    return (
      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-medium">
        <XCircle size={8} /> error
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-medium">
      <AlertCircle size={8} /> warning
    </span>
  );
}

// ─── Build human-readable title + detail from API activity item ──────────────
function parseActivity(item: any): { title: string; detail: string; status: string } {
  const action = (item.action ?? "").toUpperCase();
  const meta = item.metadata ?? {};
  switch (action) {
    case "POST_PUBLISHED":
      return { title: "Post Published", detail: meta.caption ?? meta.title ?? `Post ${item.entityId ?? ""} published to Instagram`, status: "SUCCESS" };
    case "POST_CREATED":
      return { title: "Post Created", detail: meta.caption ?? meta.title ?? "New post created", status: "SUCCESS" };
    case "CONTENT_GENERATED":
      return { title: "Content Generated", detail: meta.summary ?? `AI generated ${meta.count ?? 1} new post(s)`, status: "SUCCESS" };
    case "POST_SCHEDULED":
      return { title: "Post Scheduled", detail: meta.caption ?? meta.title ?? `Post scheduled`, status: "SUCCESS" };
    case "WORKFLOW_EXECUTED":
      return { title: "Workflow Executed", detail: meta.workflowName ?? "n8n workflow ran", status: meta.failed ? "ERROR" : "SUCCESS" };
    case "ANALYTICS_SYNCED":
      return { title: "Analytics Synced", detail: meta.summary ?? "Instagram analytics updated", status: "SUCCESS" };
    case "COMMENT_RECEIVED":
      return { title: "New Comment", detail: meta.text ? `@${meta.username ?? "user"}: "${meta.text}"` : "New comment received", status: "SUCCESS" };
    case "YOUTUBE_PUBLISHED": {
      const kind = meta.isStory ? "YouTube Short" : "YouTube video";
      const slides = typeof meta.slides === "number" ? ` (${meta.slides} slides)` : "";
      const detail = meta.youtubeVideoId
        ? `https://youtube.com/shorts/${meta.youtubeVideoId}`
        : `${kind}${slides} published to YouTube`;
      return { title: `Published a ${kind}`, detail, status: "SUCCESS" };
    }
    case "YOUTUBE_COMMENTS_REPLIED":
      return {
        title: "Replied to YouTube comments",
        detail: typeof meta.count === "number"
          ? `Auto-replied to ${meta.count} YouTube comment(s)`
          : "Replied to YouTube comments",
        status: "SUCCESS",
      };
    default:
      return { title: item.action ?? "Activity", detail: meta.description ?? JSON.stringify(meta).slice(0, 120), status: "SUCCESS" };
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ActivityPage() {
  const { brandId } = useSelectedBrand();
  const [filter, setFilter] = useState<string>("all");
  const [limit, setLimit] = useState(50);

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["activity", limit, brandId],
    queryFn: () => fetch(withBrand(`/api/activity?limit=${limit}`, brandId)).then((r) => r.json()),
    refetchInterval: 15000,              // auto-refresh every 15 s
    refetchIntervalInBackground: true,   // keep refreshing even without tab focus
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Poll comment sync every 2 minutes  -  catches any comments missed by webhook
  useQuery({
    queryKey: ["comment-sync", brandId],
    queryFn: () => fetch(withBrand("/api/instagram/comments/sync", brandId)).then(r => r.json()),
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: true,
    staleTime: 90_000,
  });

  // ── Real-time refresh via SSE custom event ──────────────────────────────────
  // Header.tsx dispatches "cardioflow:activity" whenever the SSE stream fires a
  // new notification (comment, DM, mention, etc.).  This lets us instantly
  // refetch instead of waiting up to 15 s for the poll interval.
  useEffect(() => {
    const handler = () => { refetch(); };
    window.addEventListener("cardioflow:activity", handler);
    return () => window.removeEventListener("cardioflow:activity", handler);
  }, [refetch]);

  const rawActivities: any[] = data?.data?.logs ?? [];

  // Attach parsed display fields and config
  const enriched = rawActivities.map((item) => {
    const cfg = getActionConfig(item.action);
    const parsed = parseActivity(item);
    return { ...item, _cfg: cfg, _title: parsed.title, _detail: parsed.detail, _status: parsed.status };
  });

  // Filter
  const filtered = filter === "all"
    ? enriched
    : enriched.filter((a) => a._cfg.label.toLowerCase() === filter.toLowerCase());

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-white/50">Live feed  -  instant updates</span>
        </div>
        <span className="ml-auto text-xs text-white/25">{filtered.length} activities</span>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 mr-1">
          <Filter size={13} className="text-white/30" />
        </div>
        <button
          onClick={() => setFilter("all")}
          className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            filter === "all" ? "bg-red-500/20 text-red-300 border-red-500/30" : "border-white/[0.06] text-white/40 hover:text-white/70"
          )}
        >
          All
        </button>
        {FILTER_CHIPS.map(({ label, action }) => {
          const cfg = getActionConfig(action);
          const isActive = filter === label;
          return (
            <button
              key={label}
              onClick={() => setFilter(label)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                isActive ? `${cfg.bg} ${cfg.color} border-current border-opacity-30` : "border-white/[0.06] text-white/40 hover:text-white/70"
              )}
            >
              <cfg.icon size={10} />
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {isError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/10 text-xs text-red-400"
        >
          <AlertCircle size={13} />
          Could not load data  -  retrying...
        </motion.div>
      )}

      {/* ── Timeline ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="w-11 h-11 rounded-xl animate-pulse bg-white/5 flex-shrink-0" />
              <div className="flex-1 rounded-2xl p-4 animate-pulse bg-white/5 h-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[22px] top-0 bottom-0 w-px bg-white/[0.06]" />

          <div className="space-y-2">
            <AnimatePresence>
              {filtered.map((activity, i) => {
                const cfg = activity._cfg as ActionConfig;
                const Icon = cfg.icon;

                return (
                  <motion.div
                    key={activity.id ?? i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: i * 0.03, duration: 0.3 }}
                    className="flex gap-4 group"
                  >
                    {/* Icon */}
                    <div className="relative flex-shrink-0">
                      <motion.div
                        whileHover={{ scale: 1.15 }}
                        className={cn(
                          "w-11 h-11 rounded-xl flex items-center justify-center border z-10 relative transition-all",
                          cfg.bg,
                          "border-white/[0.06] group-hover:border-white/[0.12]"
                        )}
                        style={{ boxShadow: `0 0 0 0 ${cfg.glow}` }}
                      >
                        <Icon size={16} className={cfg.color} />
                      </motion.div>
                    </div>

                    {/* Content */}
                    <motion.div
                      whileHover={{ x: 2 }}
                      className="flex-1 rounded-2xl p-4 border border-white/[0.05] hover:border-white/[0.1] transition-all"
                      style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)" }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <p className="text-sm font-semibold text-white">{activity._title}</p>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <StatusBadge status={activity._status} />
                          <span className="text-[11px] text-white/25 whitespace-nowrap">
                            {activity.createdAt ? formatRelativeTime(activity.createdAt) : ""}
                          </span>
                        </div>
                      </div>
                      {typeof activity._detail === "string" && activity._detail.startsWith("http") ? (
                        <a
                          href={activity._detail}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2 leading-relaxed break-all"
                        >
                          {activity._detail}
                        </a>
                      ) : (
                        <p className="text-xs text-white/50 leading-relaxed">{activity._detail}</p>
                      )}
                    </motion.div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!isLoading && filtered.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
            <Activity size={24} className="text-white/20" />
          </div>
          <p className="text-white/40 text-sm font-medium">No activity yet</p>
          <p className="text-white/25 text-xs mt-1">Generate your first post to see activity here!</p>
        </motion.div>
      )}

      {/* ── Load more ──────────────────────────────────────────────────────── */}
      {!isLoading && rawActivities.length >= limit && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLimit((l) => l + 50)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/[0.15] transition-all"
          >
            <ChevronDown size={14} />
            Load more
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}
