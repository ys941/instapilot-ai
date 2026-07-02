"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye, TrendingUp, Heart, Users, Bookmark, User,
  ArrowUpRight, ArrowDownRight, MessageCircle, RefreshCw,
  AlertCircle, Send, ThumbsUp, CornerDownRight, Inbox,
  Clock, CheckCheck, X, ExternalLink, Image as ImageIcon,
  BarChart2, Repeat2, Sparkles,
  Youtube, PlayCircle, Settings,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import { useSelectedBrand, withBrand } from "@/components/dashboard/useSelectedBrand";
import { useBrand } from "@/components/BrandContext";

// ─── Variants ─────────────────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

// ─── Color config ─────────────────────────────────────────────────────────────
const colorMap: Record<string, { bg: string; text: string }> = {
  red:    { bg: "rgb(var(--accent-rgb) / 0.1)",   text: "text-brand" },
  pink:   { bg: "rgb(var(--accent-2-rgb) / 0.1)",  text: "text-brand-light" },
  purple: { bg: "rgba(147,51,234,0.1)",  text: "text-purple-400" },
  blue:   { bg: "rgba(59,130,246,0.1)",  text: "text-blue-400" },
  green:  { bg: "rgba(16,185,129,0.1)",  text: "text-emerald-400" },
  orange: { bg: "rgba(249,115,22,0.1)",  text: "text-orange-400" },
};

// ─── Tooltip ──────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl px-4 py-3 border border-white/10 text-xs" style={{ background: "rgba(17,17,24,0.98)", backdropFilter: "blur(20px)" }}>
      <p className="text-white/50 mb-2">{label}</p>
      {payload.map((e: any) => (
        <div key={e.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: e.color }} />
          <span className="text-white/50 capitalize">{e.name}:</span>
          <span className="text-white font-medium">
            {typeof e.value === "number" && e.value > 100 ? formatNumber(e.value) : e.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Sentiment badge ──────────────────────────────────────────────────────────
function SentimentBadge({ sentiment }: { sentiment?: string }) {
  if (sentiment === "positive")
    return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">+</span>;
  if (sentiment === "negative")
    return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-medium">−</span>;
  return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30 border border-white/10 font-medium">~</span>;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function SkeletonKPI() {
  return (
    <div className="rounded-2xl p-4 animate-pulse" style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="w-8 h-8 rounded-lg bg-white/5 mb-3" />
      <div className="h-2 bg-white/5 rounded w-1/2 mb-2" />
      <div className="h-6 bg-white/5 rounded w-3/4 mb-1" />
      <div className="h-2 bg-white/5 rounded w-1/4" />
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────
function StatChip({ icon: Icon, label, value, color = "white/50" }: { icon: any; label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl p-3 flex-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <Icon size={14} className={`text-${color}`} />
      <span className="text-lg font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>{value}</span>
      <span className="text-[9px] text-white/30 uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ─── Post Detail Drawer ───────────────────────────────────────────────────────
function PostDetailDrawer({
  post,
  postComments,
  onClose,
  onRefresh,
  refreshing,
}: {
  post: any;
  postComments: any[];
  onClose: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const brand = useBrand();
  const hasStats   = post.reach > 0 || post.likes > 0 || post.comments > 0 || post.saves > 0;
  const hasMedia   = !!post.thumbnail || !!post.mediaUrl;
  const permalink  = post.permalink ?? (post.instagramPostId ? `https://www.instagram.com/p/${post.instagramPostId}/` : null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="relative w-full max-w-md h-full overflow-y-auto"
        style={{ background: "rgba(13,13,20,0.98)", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-white/[0.06]" style={{ background: "rgba(13,13,20,0.98)", backdropFilter: "blur(20px)" }}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20 font-medium">{post.type}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              post.status === "PUBLISHED"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-white/5 text-white/30 border border-white/10"
            }`}>{post.status ?? "DRAFT"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all disabled:opacity-40"
            >
              <RefreshCw size={9} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Syncing..." : "Refresh stats"}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-all">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Title */}
          <div>
            <h2 className="text-base font-bold text-white leading-snug" style={{ fontFamily: "Sora, sans-serif" }}>{post.title}</h2>
            {post.publishedAt && (
              <p className="text-[11px] text-white/30 mt-1">
                Published {formatRelativeTime(post.publishedAt)}
              </p>
            )}
          </div>

          {/* Thumbnail */}
          {hasMedia && (
            <div className="relative rounded-xl overflow-hidden aspect-square bg-white/5 flex items-center justify-center">
              <img
                src={post.thumbnail ?? post.mediaUrl}
                alt={post.title}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}

          {/* Stats grid */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Performance</p>
              {!hasStats && post.instagramPostId && (
                <span className="text-[10px] text-yellow-400/60">Insights require Business account</span>
              )}
              {!post.instagramPostId && (
                <span className="text-[10px] text-white/30">Not yet published to Instagram</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <StatChip icon={Eye}           label="Reach"       value={hasStats ? formatNumber(post.reach)       : " - "} color="brand" />
              <StatChip icon={Heart}         label="Likes"       value={hasStats ? formatNumber(post.likes)       : " - "} color="brand-light" />
              <StatChip icon={MessageCircle} label="Comments"    value={hasStats ? formatNumber(post.comments)    : " - "} color="blue-400" />
              <StatChip icon={Bookmark}      label="Saves"       value={hasStats ? formatNumber(post.saves)       : " - "} color="purple-400" />
              <StatChip icon={TrendingUp}    label="Impressions" value={hasStats ? formatNumber(post.impressions) : " - "} color="orange-400" />
              <StatChip icon={BarChart2}     label="Eng. Rate"   value={hasStats ? `${Number(post.engagementRate).toFixed(1)}%` : " - "} color="emerald-400" />
            </div>
          </div>

          {/* Caption / content preview */}
          {post.content && (
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-wider font-medium mb-2">Caption</p>
              <p className="text-xs text-white/60 leading-relaxed rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                {post.content}
                {post.content?.length >= 300 && <span className="text-white/25">...</span>}
              </p>
            </div>
          )}

          {/* Hashtags */}
          {(post.hashtags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(post.hashtags as string[]).map((h, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {h.startsWith("#") ? h : `#${h}`}
                </span>
              ))}
            </div>
          )}

          {/* Instagram link */}
          {permalink && (
            <a
              href={permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
            >
              <ExternalLink size={12} />
              View on Instagram
            </a>
          )}

          {/* Comments for this post  -  shows full conversation threads */}
          {postComments.length > 0 && (
            <div>
              {/* Total count = top-level + all replies */}
              {(() => {
                const totalWithReplies = postComments.reduce(
                  (sum: number, c: any) => sum + 1 + (c.replies?.length ?? 0), 0
                );
                return (
                  <p className="text-[10px] text-white/30 uppercase tracking-wider font-medium mb-2">
                    Comments ({totalWithReplies})
                  </p>
                );
              })()}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {postComments.map((c: any, i: number) => (
                  <div key={c.id ?? i}>
                    {/* Top-level comment */}
                    <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-brand">@{c.username ?? "user"}</span>
                        <span className="text-[10px] text-white/25">{c.createdAt ? formatRelativeTime(c.createdAt) : ""}</span>
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed">{c.text ?? ""}</p>
                      {c.replied && (
                        <span className="text-[9px] text-emerald-400/60 flex items-center gap-1 mt-1">
                          <CheckCheck size={9} /> Auto-replied
                        </span>
                      )}
                    </div>

                    {/* Nested replies (our auto-reply + any other replies) */}
                    {(c.replies ?? []).length > 0 && (
                      <div className="ml-4 mt-1 space-y-1 border-l-2 border-white/[0.06] pl-3">
                        {(c.replies as any[]).map((r: any, ri: number) => {
                          const ourHandle = (brand.handle ?? "").toLowerCase();
                          const isOurs = !!ourHandle && (r.username ?? "").toLowerCase() === ourHandle;
                          return (
                            <div
                              key={r.id ?? ri}
                              className="rounded-lg px-2.5 py-2"
                              style={{
                                background: isOurs ? "rgb(var(--accent-rgb) / 0.06)" : "rgba(255,255,255,0.02)",
                                border: isOurs ? "1px solid rgb(var(--accent-rgb) / 0.15)" : "1px solid rgba(255,255,255,0.04)",
                              }}
                            >
                              <div className="flex items-center justify-between mb-0.5">
                                <span className={`text-[10px] font-semibold ${isOurs ? "text-brand/80" : "text-white/50"}`}>
                                  @{r.username ?? "user"}{isOurs ? " · AI" : ""}
                                </span>
                                <span className="text-[9px] text-white/20">{r.timestamp ? formatRelativeTime(r.timestamp) : ""}</span>
                              </div>
                              <p className="text-[11px] text-white/50 leading-relaxed">{r.text ?? ""}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const queryClient = useQueryClient();
  const brand = useBrand();
  const { brandId, isAll, selected, brands } = useSelectedBrand();
  // Effective WRITE/engagement brand. Reads can aggregate across "all", but
  // engagement actions (reply / like / DM / AI-suggest) must target a concrete
  // account, so coerce "all"/unresolved → the primary brand id. Mirrors the
  // generator/media isAll→primary pattern. With only the primary brand this
  // resolves to the primary id, so behavior is unchanged.
  const primaryBrandId = brands.find((b) => b.isPrimary)?.id ?? brands[0]?.id ?? "";
  const effBrand = isAll || !brandId ? primaryBrandId : brandId;
  const [sortBy, setSortBy] = useState("reach");
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [refreshingInsights, setRefreshingInsights] = useState(false);

  // ── Comment reply / like state ────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<"comments" | "dms">("comments");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [likingId, setLikingId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [sendingReply, setSendingReply] = useState(false);
  const [generatingAiReply, setGeneratingAiReply] = useState(false);
  const replyInputRef = useRef<HTMLInputElement>(null);
  // DM state
  const [dmReplyTo, setDmReplyTo]     = useState<string | null>(null);
  const [dmReplyText, setDmReplyText] = useState("");
  const [sendingDm, setSendingDm]     = useState(false);
  const dmInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
    dataUpdatedAt,
    refetch: refetchAnalytics,
  } = useQuery({
    queryKey: ["analytics-overview", brandId],
    queryFn: () => fetch(withBrand("/api/analytics/overview", brandId)).then((r) => r.json()),
    refetchInterval: 120000,             // auto-refresh every 2 min
    refetchIntervalInBackground: true,   // keep refreshing even if tab is unfocused
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: igData, isLoading: igLoading } = useQuery({
    queryKey: ["instagram-analytics", brandId],
    queryFn: () => fetch(withBrand("/api/instagram/analytics", brandId)).then((r) => r.json()),
    refetchInterval: 300000,             // auto-refresh every 5 min
    refetchIntervalInBackground: true,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: commentsData, isLoading: commentsLoading } = useQuery({
    queryKey: ["instagram-comments", brandId],
    queryFn: () => fetch(withBrand("/api/instagram/comments?limit=20", brandId)).then((r) => r.json()),
    // No interval needed  -  served from local DB (0 IG API calls).
    // The webhook counter poll (every 5s) invalidates this query on new events.
    refetchInterval: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: dmsData, isLoading: dmsLoading, refetch: refetchDms } = useQuery({
    queryKey: ["instagram-dms", brandId],
    queryFn: () => fetch(withBrand("/api/instagram/dms?limit=20", brandId)).then((r) => r.json()),
    refetchInterval: 300000,             // 5 min  -  webhook counter triggers on new DMs
    refetchIntervalInBackground: false,  // don't hammer IG when tab is in background
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // ── Real-time Instagram post insights (syncs to DB + returns live stats) ──
  const { data: igInsightsData, refetch: refetchInsights } = useQuery({
    queryKey: ["ig-post-insights", brandId],
    queryFn: () => fetch(withBrand("/api/instagram/posts/insights", brandId)).then((r) => r.json()),
    refetchInterval: 600000,             // 10 min  -  insights change slowly; DB stays fresh via runCatchup
    refetchIntervalInBackground: false,  // don't poll IG when tab is in background
    staleTime: 300000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // ── YouTube analytics (channel stats + recent videos) ─────────────────────
  const { data: ytData, isLoading: ytLoading } = useQuery({
    queryKey: ["youtube-overview", brandId],
    queryFn: () => fetch(withBrand("/api/youtube/overview", brandId)).then((r) => r.json()),
    refetchInterval: 300000,             // auto-refresh every 5 min
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // ── YouTube comments (flat list across recent videos) ─────────────────────
  const { data: ytCommentsData, isLoading: ytCommentsLoading } = useQuery({
    queryKey: ["youtube-comments", brandId],
    queryFn: () => fetch(withBrand("/api/youtube/comments", brandId)).then((r) => r.json()),
    refetchInterval: 600000,             // auto-refresh every 10 min (quota-friendly)
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // ── Seconds-ago counter ───────────────────────────────────────────────────
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const update = () => setSecondsSinceUpdate(Math.floor((Date.now() - dataUpdatedAt) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [dataUpdatedAt]);

  // ── Webhook event polling  -  triggers refetch when new comments/DMs arrive ──
  // Polls /api/notifications/count every 5s. When the count changes it means
  // the webhook received a new event (comment, DM, reaction), so we refresh
  // the comments and DMs queries to show fresh data.
  useEffect(() => {
    let lastCount: number | null = null;
    const poll = async () => {
      try {
        const res  = await fetch("/api/notifications/count");
        const data = await res.json();
        const count: number = data.count ?? 0;
        if (lastCount !== null && count !== lastCount) {
          // New webhook event received  -  refresh engagement data
          queryClient.invalidateQueries({ queryKey: ["instagram-comments"] });
          queryClient.invalidateQueries({ queryKey: ["instagram-dms"] });
          queryClient.invalidateQueries({ queryKey: ["analytics-overview"] });
        }
        lastCount = count;
      } catch { /* non-fatal  -  skip */ }
    };
    poll(); // immediate first check
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["analytics-overview"] });
    queryClient.invalidateQueries({ queryKey: ["instagram-analytics"] });
    queryClient.invalidateQueries({ queryKey: ["instagram-comments"] });
    queryClient.invalidateQueries({ queryKey: ["instagram-dms"] });
    queryClient.invalidateQueries({ queryKey: ["ig-post-insights"] });
    queryClient.invalidateQueries({ queryKey: ["youtube-overview"] });
    queryClient.invalidateQueries({ queryKey: ["youtube-comments"] });
    toast.success("Analytics refreshed");
  };

  // ── Refresh insights for selected post ───────────────────────────────────
  const handleRefreshInsights = async () => {
    setRefreshingInsights(true);
    try {
      await refetchInsights();
      // Re-merge the refreshed data into selectedPost
      const freshPosts: any[] = igInsightsData?.data?.posts ?? [];
      const fresh = freshPosts.find((p) => p.postId === selectedPost?.id);
      if (fresh) {
        setSelectedPost((prev: any) => ({ ...prev, ...fresh, id: prev.id }));
      }
      toast.success("Stats refreshed from Instagram");
    } catch {
      toast.error("Failed to refresh stats");
    } finally {
      setRefreshingInsights(false);
    }
  };

  // ── Reply handler ─────────────────────────────────────────────────────────
  const handleReply = async (commentId: string) => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch(withBrand(`/api/instagram/comments/${commentId}`, effBrand), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Reply posted!");
        setReplyText("");
        setReplyingTo(null);
        queryClient.invalidateQueries({ queryKey: ["instagram-comments"] });
      } else {
        toast.error(data.error ?? "Failed to post reply");
      }
    } catch {
      toast.error("Network error posting reply");
    } finally {
      setSendingReply(false);
    }
  };

  // ── AI Suggest  -  generate reply with Groq then let user edit ─────────────
  const handleAiSuggestComment = async (comment: any) => {
    setGeneratingAiReply(true);
    try {
      const res = await fetch(withBrand("/api/instagram/ai-reply", effBrand), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type:        "comment",
          commentText: comment.text,
          username:    comment.username,
          // mediaId lets the backend look up full post context (type, hook, quiz answer)
          mediaId:     comment.mediaId ?? comment.postId ?? undefined,
          postTitle:   selectedPost?.title ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReplyText(data.data.reply);
        setTimeout(() => replyInputRef.current?.focus(), 50);
      } else {
        toast.error("AI suggestion failed  -  type your reply manually");
      }
    } catch {
      toast.error("AI suggestion failed  -  type your reply manually");
    } finally {
      setGeneratingAiReply(false);
    }
  };

  const handleAiSuggestDm = async (convo: any, senderUsername: string) => {
    setGeneratingAiReply(true);
    try {
      // Derive our own handle from the selected brand (falls back to the
      // historical default when running with only the primary account).
      const ourIg = `@${selected?.igUsername ?? brand.handle ?? "yourhandle"}`;
      const thread = (convo.messages ?? []).map((m: any) => ({
        from: m.from?.name === senderUsername ? `@${senderUsername}` : ourIg,
        text: m.message ?? "",
        time: m.created_time ?? new Date().toISOString(),
      }));
      const res = await fetch(withBrand("/api/instagram/ai-reply", effBrand), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "dm", messages: thread, senderUsername }),
      });
      const data = await res.json();
      if (data.success) {
        setDmReplyText(data.data.reply);
        setTimeout(() => dmInputRef.current?.focus(), 50);
      } else {
        toast.error("AI suggestion failed  -  type your reply manually");
      }
    } catch {
      toast.error("AI suggestion failed");
    } finally {
      setGeneratingAiReply(false);
    }
  };

  // ── Like handler ──────────────────────────────────────────────────────────
  const handleLike = async (commentId: string) => {
    if (likedIds.has(commentId) || likingId === commentId) return;
    setLikingId(commentId);
    try {
      const res = await fetch(withBrand(`/api/instagram/comments/${commentId}`, effBrand), { method: "PUT" });
      const data = await res.json();
      if (data.success) {
        setLikedIds((prev) => new Set([...prev, commentId]));
        toast.success("Comment liked!");
      } else {
        toast.error(data.error ?? "Failed to like comment");
      }
    } catch {
      toast.error("Network error liking comment");
    } finally {
      setLikingId(null);
    }
  };

  // ── Send DM reply ─────────────────────────────────────────────────────────
  const handleSendDm = async (recipientId: string) => {
    if (!dmReplyText.trim()) return;
    setSendingDm(true);
    try {
      const res = await fetch(withBrand("/api/instagram/dms", effBrand), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId, message: dmReplyText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("DM sent! ✉️");
        setDmReplyText("");
        setDmReplyTo(null);
        refetchDms();
      } else {
        toast.error(data.error ?? "Failed to send DM");
      }
    } catch {
      toast.error("Network error sending DM");
    } finally {
      setSendingDm(false);
    }
  };


  // ── Derived data ──────────────────────────────────────────────────────────
  const weeklyTrends    = analytics?.data?.weeklyTrend ?? analytics?.data?.weeklyTrends ?? [];
  const comments        = commentsData?.data?.comments ?? [];
  const conversations          = dmsData?.data?.conversations ?? [];
  const dmsNote: string | null = dmsData?.data?.note ?? null;
  const dmsPermError           = dmsData?.data?.permissionRequired ?? null;
  const dmsDiagnosis: string   = dmsData?.data?.diagnosisCode ?? "";
  const dmsTokenHasScope: boolean = dmsData?.data?.tokenHasMessagingScope ?? false;
  // If the API returned { success: false } (e.g. Instagram not configured → 422)
  const dmsConfigError: string | null = (dmsData && dmsData.success === false)
    ? (dmsData.error ?? "Instagram not configured")
    : null;

  // Merge DB top posts with live Instagram insights
  // Live insights take priority over DB data (more up-to-date)
  const dbTopPosts: any[] = analytics?.data?.topPosts ?? [];
  const igLivePosts: any[] = igInsightsData?.data?.posts ?? [];

  const topPosts: any[] = dbTopPosts.map((dbPost) => {
    const live = igLivePosts.find((p) => p.postId === dbPost.id);
    // Fallback thumbnail: live IG thumbnail => catbox/CDN URL stored in DB => null
    const dbFallbackThumb = (dbPost.mediaUrls ?? [])[0] ?? null;
    if (live) {
      return {
        ...dbPost,
        // Overlay live IG stats (these are real numbers, 0 is valid not "unknown")
        reach:          live.reach,
        likes:          live.likes,
        comments:       live.comments,
        saves:          live.saves,
        impressions:    live.impressions,
        engagementRate: live.engagementRate,
        mediaUrl:       live.mediaUrl  ?? dbPost.mediaUrl,
        thumbnail:      live.thumbnail ?? dbFallbackThumb,
        permalink:      live.permalink ?? dbPost.permalink,
        hasLiveData:    true,   // flag: we have confirmed live data from Instagram
      };
    }
    return { ...dbPost, thumbnail: dbPost.thumbnail ?? dbFallbackThumb };
  });

  // Also include any posts only in igLivePosts but not in DB topPosts
  for (const lp of igLivePosts) {
    if (!topPosts.find((p) => p.id === lp.postId)) {
      topPosts.push({ id: lp.postId, ...lp, hasLiveData: true });
    }
  }

  // Sort top posts
  const sortedTopPosts = [...topPosts].sort((a, b) => {
    const key = sortBy === "engagementRate" ? "engagementRate" : sortBy;
    return (b[key] ?? 0) - (a[key] ?? 0);
  });

  const kpis = [
    { label: "Reach",         value: igData?.data?.insights?.reach           ?? analytics?.data?.overview?.totalReach        ?? 0, format: "number",  change: 0, icon: Eye,        color: "red" },
    { label: "Impressions",   value: igData?.data?.insights?.impressions      ?? 0,                                               format: "number",  change: 0, icon: TrendingUp, color: "pink" },
    { label: "Eng. Rate",     value: igData?.data?.insights?.engagementRate   ?? analytics?.data?.overview?.avgEngagementRate ?? 0, format: "percent", change: 0, icon: Heart,      color: "purple" },
    { label: "Followers",     value: igData?.data?.profile?.followers         ?? 0,                                               format: "number",  change: 0, icon: Users,      color: "blue" },
    { label: "Saves",         value: igData?.data?.insights?.totalLikes       ?? 0,                                               format: "number",  change: 0, icon: Bookmark,   color: "green" },
    { label: "Profile Visits",value: igData?.data?.insights?.profileVisits    ?? 0,                                               format: "number",  change: 0, icon: User,       color: "orange" },
  ];

  const isLoading = analyticsLoading || igLoading;

  // ── YouTube derived data ──────────────────────────────────────────────────
  const ytConfigured: boolean   = ytData?.data?.configured ?? false;
  const ytChannel               = ytData?.data?.channel ?? null;
  const ytStats                 = ytData?.data?.stats ?? null;
  const ytRecentVideos: any[]   = ytData?.data?.recentVideos ?? [];
  // Chart data: most-recent-first → reverse so oldest is on the left.
  // Truncate long titles for axis labels.
  const ytChartData = [...ytRecentVideos]
    .slice(0, 10)
    .reverse()
    .map((v: any) => ({
      name: (v.title ?? "Untitled").length > 16 ? `${(v.title ?? "Untitled").slice(0, 16)}…` : (v.title ?? "Untitled"),
      views: v.views ?? 0,
      likes: v.likes ?? 0,
      comments: v.comments ?? 0,
    }));
  // Top videos sorted by views (desc) for the table.
  const ytTopVideos = [...ytRecentVideos].sort((a: any, b: any) => (b.views ?? 0) - (a.views ?? 0));
  // Flat YouTube comments across recent videos (already newest-first from API).
  const ytComments: any[] = ytCommentsData?.data ?? [];

  // Comments for selected post (filter by postId or instagram media id)
  const postComments = selectedPost
    ? comments.filter((c: any) =>
        c.postId === selectedPost.id ||
        c.mediaId === selectedPost.instagramPostId
      )
    : [];

  return (
    <>
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="max-w-7xl mx-auto space-y-6">
        {/* ── Header bar ─────────────────────────────────────────────────────── */}
        <motion.div variants={itemVariants} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Analytics</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-white/50">
              {isAll ? "All accounts" : selected?.label ?? "Primary"}
            </span>
            {dataUpdatedAt ? (
              <span className="text-xs text-white/30">
                Last synced: {secondsSinceUpdate < 60 ? `${secondsSinceUpdate}s ago` : `${Math.floor(secondsSinceUpdate / 60)}m ago`}
              </span>
            ) : null}
          </div>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
          >
            <RefreshCw size={11} />
            Refresh
          </motion.button>
        </motion.div>

        {/* ── Error banner ───────────────────────────────────────────────────── */}
        {analyticsError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/10 text-xs text-red-400"
          >
            <AlertCircle size={13} />
            Could not load data  -  retrying...
          </motion.div>
        )}

        {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
        <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonKPI key={i} />)
            : kpis.map((kpi, i) => {
                const c = colorMap[kpi.color];
                const isPos = kpi.change >= 0;
                const displayValue = kpi.format === "percent"
                  ? `${Number(kpi.value).toFixed(1)}%`
                  : formatNumber(Number(kpi.value));
                return (
                  <motion.div
                    key={kpi.label}
                    custom={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    whileHover={{ scale: 1.03 }}
                    className="rounded-2xl p-4"
                    style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background: c.bg }}>
                      <kpi.icon size={15} className={c.text} />
                    </div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{kpi.label}</p>
                    <p className="text-xl font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>{displayValue}</p>
                    <div className={`flex items-center gap-1 mt-1 text-[10px] font-semibold ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                      {isPos ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                      {isPos ? "+" : ""}{Number(kpi.change).toFixed(1)}%
                    </div>
                  </motion.div>
                );
              })}
        </motion.div>

        {/* ── Charts row ─────────────────────────────────────────────────────── */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Reach & Impressions */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <h3 className="text-sm font-semibold text-white mb-4" style={{ fontFamily: "Sora, sans-serif" }}>Reach & Impressions</h3>
            <div className="h-52">
              {analyticsLoading ? (
                <div className="h-full animate-pulse bg-white/[0.02] rounded-xl" />
              ) : weeklyTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyTrends} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="reachGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="impGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#9333ea" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#9333ea" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="reach"    stroke="#ef4444" strokeWidth={2} fill="url(#reachGrad2)" dot={false} />
                    <Area type="monotone" dataKey="impressions" stroke="#9333ea" strokeWidth={2} fill="url(#impGrad2)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-white/25 text-xs">No trend data yet</div>
              )}
            </div>
          </div>

          {/* Follower Growth */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <h3 className="text-sm font-semibold text-white mb-4" style={{ fontFamily: "Sora, sans-serif" }}>Follower Growth</h3>
            <div className="h-52">
              {analyticsLoading ? (
                <div className="h-full animate-pulse bg-white/[0.02] rounded-xl" />
              ) : weeklyTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyTrends} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="followers" stroke="#ec4899" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#ec4899" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-white/25 text-xs">No follower data yet</div>
              )}
            </div>
          </div>
        </motion.div>

        {/* ── Top Posts Table + Comments ──────────────────────────────────────── */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* Top posts */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Top Posts</h3>
                <span className="text-[10px] text-white/25 flex items-center gap-1">
                  <Repeat2 size={9} className="text-emerald-400" />
                  Live
                </span>
              </div>
              <div className="flex gap-1">
                {["reach", "likes", "saves", "engagementRate"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-all ${sortBy === s ? "bg-brand/20 text-brand" : "text-white/30 hover:text-white/60"}`}
                  >
                    {s === "engagementRate" ? "Eng" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {analyticsLoading ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse bg-white/5 rounded-xl" />
                ))}
              </div>
            ) : sortedTopPosts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.04]">
                      {["Post", "Type", "Reach", "Likes", "Comments", "Saves", "Eng."].map((h) => (
                        <th key={h} className="text-left px-5 py-3 text-[10px] font-medium text-white/30 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTopPosts.map((p: any, i: number) => {
                      // hasLiveData = we fetched real numbers from Instagram (0 is valid, not "unknown")
                      const hasLiveData = p.hasLiveData === true;
                      const permalink   = p.permalink ?? (p.instagramPostId ? `https://www.instagram.com/p/${p.instagramPostId}/` : null);
                      return (
                        <motion.tr
                          key={p.id ?? i}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.1 + i * 0.04 }}
                          onClick={() => setSelectedPost(p)}
                          className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors cursor-pointer group"
                          title="Click for details"
                        >
                          <td className="px-5 py-3 max-w-[200px]">
                            <div className="flex items-center gap-2">
                              {/* Thumbnail  -  click opens Instagram post */}
                              {p.thumbnail ? (
                                <a
                                  href={permalink ?? undefined}
                                  target="_blank" rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-shrink-0 relative group/thumb"
                                  title="Preview on Instagram"
                                >
                                  <img src={p.thumbnail} alt="" className="w-8 h-8 rounded-md object-cover opacity-80 group-hover/thumb:opacity-100 transition-opacity" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                  {/* Hover overlay */}
                                  <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 bg-black/40 rounded-md transition-opacity text-[7px] text-white font-bold">↗</span>
                                </a>
                              ) : (
                                <a
                                  href={permalink ?? undefined}
                                  target="_blank" rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-8 h-8 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0 hover:bg-white/10 transition-colors"
                                  title={permalink ? "View on Instagram" : "No preview"}
                                >
                                  <ImageIcon size={10} className="text-white/30" />
                                </a>
                              )}
                              <div className="min-w-0">
                                <p className="text-xs text-white/80 font-medium truncate group-hover:text-white transition-colors">{p.title ?? p.caption ?? " - "}</p>
                                {permalink && (
                                  <a href={permalink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                    className="text-[9px] text-white/20 hover:text-brand transition-colors flex items-center gap-0.5 mt-0.5">
                                    View on Instagram ↗
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">{p.type ?? "Post"}</span>
                          </td>
                          <td className="px-5 py-3 text-xs tabular-nums">
                            {hasLiveData ? (
                              <span className={p.reach > 0 ? "text-white/70" : "text-white/30"}>{formatNumber(p.reach)}</span>
                            ) : <span className="text-white/20"> - </span>}
                          </td>
                          <td className="px-5 py-3 text-xs tabular-nums">
                            {hasLiveData ? (
                              <span className={p.likes > 0 ? "text-brand-light" : "text-white/30"}>{formatNumber(p.likes)}</span>
                            ) : <span className="text-white/20"> - </span>}
                          </td>
                          <td className="px-5 py-3 text-xs tabular-nums">
                            {hasLiveData ? (
                              <span className={p.comments > 0 ? "text-blue-400" : "text-white/30"}>{formatNumber(p.comments)}</span>
                            ) : <span className="text-white/20"> - </span>}
                          </td>
                          <td className="px-5 py-3 text-xs tabular-nums">
                            {hasLiveData ? (
                              <span className={p.saves > 0 ? "text-purple-400" : "text-white/30"}>{formatNumber(p.saves)}</span>
                            ) : <span className="text-white/20"> - </span>}
                          </td>
                          <td className="px-5 py-3">
                            {hasLiveData ? (
                              p.engagementRate > 0 ? (
                                <span className="text-xs font-semibold text-emerald-400">
                                  {Number(p.engagementRate).toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-xs text-white/30">0%</span>
                              )
                            ) : (
                              <span className="text-xs text-white/20"> - </span>
                            )}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-center text-[10px] text-white/20 py-3">
                  Click any row for full details · Stats sync from Instagram every 10s
                </p>
              </div>
            ) : (
              <div className="py-10 text-center text-white/30 text-sm">No posts yet  -  publish your first post!</div>
            )}
          </div>

          {/* Comments + DMs tabbed panel */}
          <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {/* Tab header */}
            <div className="flex items-center border-b border-white/[0.06]">
              <button
                onClick={() => setActivePanel("comments")}
                className={`flex items-center gap-1.5 px-4 py-3.5 text-xs font-medium border-b-2 transition-all ${
                  activePanel === "comments"
                    ? "border-brand text-white"
                    : "border-transparent text-white/40 hover:text-white/70"
                }`}
              >
                <MessageCircle size={13} />
                Comments
                {comments.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-brand/20 text-brand">{comments.length}</span>
                )}
              </button>
              <button
                onClick={() => { setActivePanel("dms"); setDmReplyTo(null); }}
                className={`flex items-center gap-1.5 px-4 py-3.5 text-xs font-medium border-b-2 transition-all ${
                  activePanel === "dms"
                    ? "border-purple-500 text-white"
                    : "border-transparent text-white/40 hover:text-white/70"
                }`}
              >
                <Inbox size={13} />
                DMs
                {conversations.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-purple-500/20 text-purple-400">{conversations.length}</span>
                )}
              </button>
              <div className="ml-auto pr-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Live" />
              </div>
            </div>

            {/* ── Comments panel ── */}
            {activePanel === "comments" && (
              <>
                {commentsLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse bg-white/5 rounded-xl" />)}
                  </div>
                ) : comments.length > 0 ? (
                  <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
                    {comments.map((c: any, i: number) => (
                      <motion.div key={c.id ?? i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                        className="px-4 py-3 hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-brand">@{c.username ?? "user"}</span>
                            <SentimentBadge sentiment={c.sentiment} />
                          </div>
                          <span className="text-[10px] text-white/25">{c.createdAt ? formatRelativeTime(c.createdAt) : ""}</span>
                        </div>
                        <p className="text-xs text-white/60 leading-relaxed mb-1.5">{c.text ?? ""}</p>

                        {/* ── Existing replies (from Instagram) ── */}
                        {(c.replies ?? []).length > 0 && (
                          <div className="ml-3 pl-2 border-l border-white/[0.06] space-y-1 mb-2">
                            {(c.replies as any[]).map((r: any, ri: number) => (
                              <div key={r.id ?? ri} className="text-[10px]">
                                <span className="text-blue-400/80 font-medium">@{r.username ?? "reply"}</span>
                                <span className="text-white/40 ml-1.5">{r.text ?? ""}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {c.id && (
                          <div className="flex items-center gap-3">
                            <button onClick={() => handleLike(c.id)} disabled={likedIds.has(c.id) || likingId === c.id}
                              className={`flex items-center gap-1 text-[10px] transition-colors ${likedIds.has(c.id) ? "text-brand-light cursor-default" : "text-white/30 hover:text-brand-light"}`}
                            >
                              <ThumbsUp size={10} className={likingId === c.id ? "animate-pulse" : ""} />
                              {likedIds.has(c.id) ? "Liked" : "Like"}
                              {c.likeCount > 0 && <span className="text-white/20 ml-0.5">({c.likeCount})</span>}
                            </button>
                            <button onClick={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(""); setTimeout(() => replyInputRef.current?.focus(), 50); }}
                              className={`flex items-center gap-1 text-[10px] transition-colors ${replyingTo === c.id ? "text-blue-400" : "text-white/30 hover:text-blue-400"}`}
                            >
                              <CornerDownRight size={10} />
                              Reply {(c.replies ?? []).length > 0 && <span className="text-white/25">({(c.replies as any[]).length})</span>}
                            </button>
                          </div>
                        )}
                        <AnimatePresence>
                          {replyingTo === c.id && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-2 overflow-hidden">
                              {/* AI Suggest button */}
                              <button
                                onClick={() => handleAiSuggestComment(c)}
                                disabled={generatingAiReply}
                                className="mb-1.5 flex items-center gap-1 text-[10px] text-purple-400/70 hover:text-purple-400 transition-colors disabled:opacity-40"
                              >
                                <Sparkles size={9} className={generatingAiReply ? "animate-pulse" : ""} />
                                {generatingAiReply ? "Generating AI reply..." : "✨ AI Suggest"}
                              </button>
                              <div className="flex items-center gap-2">
                                <input ref={replyInputRef} type="text" value={replyText} onChange={(e) => setReplyText(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleReply(c.id); } if (e.key === "Escape") setReplyingTo(null); }}
                                  placeholder={`Reply to @${c.username ?? "user"}...`}
                                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-blue-500/40 transition-all"
                                />
                                <button onClick={() => handleReply(c.id)} disabled={sendingReply || !replyText.trim()}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-blue-600/80 hover:bg-blue-600 disabled:opacity-40 text-white transition-colors"
                                >
                                  <Send size={9} />{sendingReply ? "..." : "Send"}
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-center text-white/30 text-sm">No comments yet</div>
                )}
              </>
            )}

            {/* ── DMs panel ── */}
            {activePanel === "dms" && (
              <>
                {dmsLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse bg-white/5 rounded-xl" />)}
                  </div>
                ) : conversations.length > 0 ? (
                  <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
                    {conversations.map((convo: any, i: number) => {
                      const sender = (convo.participants ?? []).find((p: any) => p.username);
                      const latest = convo.latestMessage;
                      const isOurs = !latest;
                      const recipientId = sender?.id ?? convo.id;
                      return (
                        <motion.div key={convo.id ?? i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                          className="px-4 py-3 hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[9px] font-bold text-white">
                                {(sender?.username ?? "?")[0].toUpperCase()}
                              </div>
                              <span className="text-[11px] font-semibold text-purple-400">
                                @{sender?.username ?? "Unknown"}
                              </span>
                              {convo.unreadCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/30">
                                  {convo.unreadCount} new
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-white/25">
                              {convo.updatedTime ? formatRelativeTime(convo.updatedTime) : ""}
                            </span>
                          </div>
                          {latest?.message && (
                            <p className="text-xs text-white/50 leading-relaxed mb-2 break-words whitespace-pre-wrap">{latest.message}</p>
                          )}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-[10px] text-white/30">
                              <span className="flex items-center gap-1">
                                <MessageCircle size={9} />{convo.messageCount ?? 0} msgs
                              </span>
                              {isOurs ? (
                                <span className="flex items-center gap-1 text-emerald-400/70">
                                  <CheckCheck size={9} /> Replied
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-yellow-400/70">
                                  <Clock size={9} /> Awaiting reply
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => { setDmReplyTo(dmReplyTo === convo.id ? null : convo.id); setDmReplyText(""); setTimeout(() => dmInputRef.current?.focus(), 50); }}
                              className="flex items-center gap-1 text-[10px] text-white/30 hover:text-purple-400 transition-colors"
                            >
                              <Send size={9} /> Reply
                            </button>
                          </div>
                          <AnimatePresence>
                            {dmReplyTo === convo.id && (
                              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-2 overflow-hidden">
                                {/* AI Suggest button */}
                                <button
                                  onClick={() => handleAiSuggestDm(convo, sender?.username ?? "user")}
                                  disabled={generatingAiReply}
                                  className="mb-1.5 flex items-center gap-1 text-[10px] text-purple-400/70 hover:text-purple-400 transition-colors disabled:opacity-40"
                                >
                                  <Sparkles size={9} className={generatingAiReply ? "animate-pulse" : ""} />
                                  {generatingAiReply ? "Generating AI reply..." : "✨ AI Suggest"}
                                </button>
                                <div className="flex items-center gap-2">
                                  <input ref={dmInputRef} type="text" value={dmReplyText} onChange={(e) => setDmReplyText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSendDm(recipientId); } if (e.key === "Escape") setDmReplyTo(null); }}
                                    placeholder={`Message @${sender?.username ?? "user"}...`}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-purple-500/40 transition-all"
                                  />
                                  <button onClick={() => handleSendDm(recipientId)} disabled={sendingDm || !dmReplyText.trim()}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-purple-600/80 hover:bg-purple-600 disabled:opacity-40 text-white transition-colors"
                                  >
                                    <Send size={9} />{sendingDm ? "..." : "Send"}
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 gap-3 px-5 text-center">
                    <Inbox size={26} className={dmsNote || dmsConfigError ? "text-yellow-500/30" : "text-white/10"} />

                    {/* ── Instagram not configured (422 / missing env vars) ── */}
                    {dmsConfigError && (
                      <div className="w-full space-y-2">
                        <p className="text-red-400 text-xs font-semibold">⚙️ Instagram not configured</p>
                        <p className="text-white/40 text-[11px] leading-relaxed">
                          {dmsConfigError}. Make sure{" "}
                          <code className="text-red-400/80 font-mono text-[9px] bg-red-400/10 px-1 rounded">INSTAGRAM_ACCESS_TOKEN</code>
                          {" "}and{" "}
                          <code className="text-red-400/80 font-mono text-[9px] bg-red-400/10 px-1 rounded">INSTAGRAM_BUSINESS_ACCOUNT_ID</code>
                          {" "}are set in your Railway environment variables.
                        </p>
                        <a
                          href="https://railway.app"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-medium text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all"
                        >
                          <ExternalLink size={9} /> Open Railway Dashboard
                        </a>
                      </div>
                    )}

                    {/* ── DIAGNOSIS: Token missing scope ── */}
                    {!dmsConfigError && dmsNote && dmsDiagnosis === "NEEDS_TOKEN_REFRESH" && (
                      <div className="w-full space-y-2">
                        <p className="text-yellow-400 text-xs font-semibold">🔑 Token needs to be refreshed</p>
                        <p className="text-white/40 text-[11px] leading-relaxed">
                          <span className="text-emerald-400 font-medium">✓ Permission is in your app</span>
                          {" "} — but your saved access token was generated before it was added.
                        </p>
                        <div className="rounded-xl p-3 text-left space-y-1.5" style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.15)" }}>
                          <p className="text-[11px] text-yellow-300/80 font-semibold">Fix in 3 steps:</p>
                          <p className="text-[10px] text-white/40 leading-relaxed">
                            <span className="text-yellow-400 font-bold mr-1">1.</span>
                            Go to{" "}
                            <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-yellow-400 underline underline-offset-2">
                              Meta Graph API Explorer
                            </a>
                          </p>
                          <p className="text-[10px] text-white/40 leading-relaxed">
                            <span className="text-yellow-400 font-bold mr-1">2.</span>
                            Add{" "}
                            <code className="text-yellow-400 font-mono text-[9px] bg-yellow-400/10 px-1 rounded">instagram_manage_messages</code>
                            {" "}to permissions, then generate a new User or Page token.
                          </p>
                          <p className="text-[10px] text-white/40 leading-relaxed">
                            <span className="text-yellow-400 font-bold mr-1">3.</span>
                            Update{" "}
                            <code className="text-yellow-400 font-mono text-[9px] bg-yellow-400/10 px-1 rounded">INSTAGRAM_ACCESS_TOKEN</code>
                            {" "}in your Railway environment variables.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* ── DIAGNOSIS: App is in Development mode (error code 3) ── */}
                    {!dmsConfigError && dmsNote && dmsDiagnosis === "NEEDS_LIVE_MODE" && (
                      <div className="w-full space-y-2.5">
                        <p className="text-yellow-400 text-xs font-semibold">🚦 Meta app is in Development mode</p>

                        <p className="text-white/40 text-[11px] leading-relaxed">
                          Meta&apos;s Conversations API is{" "}
                          <strong className="text-white/60">blocked in Development mode</strong>.
                          Switch your app to <strong className="text-white/60">Live mode</strong> to enable DMs.
                        </p>

                        <div className="rounded-xl p-3 text-left space-y-2" style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.15)" }}>
                          <p className="text-[11px] text-yellow-300/80 font-semibold">Switch to Live mode (2 min):</p>
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-white/50 leading-relaxed">
                              <span className="text-yellow-400 font-bold mr-1">1.</span>
                              Open{" "}
                              <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="text-yellow-400 underline underline-offset-2">
                                developers.facebook.com/apps
                              </a>
                              {" "}and click your app.
                            </p>
                            <p className="text-[10px] text-white/50 leading-relaxed">
                              <span className="text-yellow-400 font-bold mr-1">2.</span>
                              In the left menu go to <strong className="text-white/60">App Settings → Basic</strong> and make sure your Privacy Policy URL and App Icon are filled in (required for Live mode).
                            </p>
                            <p className="text-[10px] text-white/50 leading-relaxed">
                              <span className="text-yellow-400 font-bold mr-1">3.</span>
                              At the top of the page, flip the toggle from{" "}
                              <span className="text-orange-400 font-semibold">Development</span>
                              {" "}to{" "}
                              <span className="text-emerald-400 font-semibold">Live</span>
                              {" "}and confirm.
                            </p>
                            <p className="text-[10px] text-white/50 leading-relaxed">
                              <span className="text-yellow-400 font-bold mr-1">4.</span>
                              Come back here and click{" "}
                              <strong className="text-white/60">Check again</strong>{" "}
                              — DMs will load immediately 🎉
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => refetchDms()}
                          className="flex items-center gap-1.5 text-[10px] text-yellow-400/60 hover:text-yellow-400 transition-colors mx-auto"
                        >
                          <RefreshCw size={9} /> Check again after switching
                        </button>
                      </div>
                    )}

                    {/* ── DIAGNOSIS: App Review needed ── */}
                    {!dmsConfigError && dmsNote && dmsDiagnosis === "NEEDS_APP_REVIEW" && (
                      <div className="w-full space-y-2">
                        <p className="text-yellow-400 text-xs font-semibold">📋 App Review required</p>
                        <p className="text-white/40 text-[11px] leading-relaxed">
                          <code className="text-yellow-400 font-mono text-[9px] bg-yellow-400/10 px-1 rounded">instagram_manage_messages</code>
                          {" "}requires Meta App Review approval before it can be used with accounts outside your app&apos;s developers/testers list.
                        </p>
                        <a
                          href="https://developers.facebook.com/apps/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-medium text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/10 transition-all"
                        >
                          <ExternalLink size={9} /> Open App Review Dashboard
                        </a>
                      </div>
                    )}

                    {/* ── DIAGNOSIS: Wrong page/account ID (code 100) ── */}
                    {!dmsConfigError && dmsNote && dmsDiagnosis === "NEEDS_CONFIG" && (
                      <div className="w-full space-y-2">
                        <p className="text-yellow-400 text-xs font-semibold">⚙️ Wrong Page ID or Account ID</p>
                        <p className="text-white/40 text-[11px] leading-relaxed">
                          Meta returned an invalid parameter error. Check that{" "}
                          <code className="text-yellow-400/80 font-mono text-[9px] bg-yellow-400/10 px-1 rounded">FACEBOOK_PAGE_ID</code>
                          {" "}and{" "}
                          <code className="text-yellow-400/80 font-mono text-[9px] bg-yellow-400/10 px-1 rounded">INSTAGRAM_BUSINESS_ACCOUNT_ID</code>
                          {" "}are set correctly in your Railway environment variables.
                        </p>
                        <p className="text-white/25 text-[10px] font-mono break-all">{dmsNote}</p>
                      </div>
                    )}

                    {/* ── Unknown error ── */}
                    {!dmsConfigError && dmsNote && !["NEEDS_TOKEN_REFRESH","NEEDS_LIVE_MODE","NEEDS_APP_REVIEW","NEEDS_CONFIG"].includes(dmsDiagnosis) && (
                      <div className="w-full space-y-1.5">
                        <p className="text-yellow-400/70 text-xs font-medium">DM access restricted</p>
                        <p className="text-white/30 text-[11px] leading-relaxed">{dmsNote}</p>
                        {dmsPermError && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-mono">
                            {dmsPermError}
                          </span>
                        )}
                        <button
                          onClick={() => refetchDms()}
                          className="mt-1 flex items-center gap-1 text-[10px] text-white/20 hover:text-white/50 transition-colors mx-auto"
                        >
                          <RefreshCw size={9} /> Retry
                        </button>
                      </div>
                    )}

                    {/* ── No error  -  no DMs yet (or still loading) ── */}
                    {!dmsConfigError && !dmsNote && (
                      <div className="space-y-2">
                        <p className="text-white/40 text-xs font-medium">No messages yet</p>
                        <p className="text-white/20 text-[10px]">
                          DMs sent to your Instagram will appear here in real-time via webhook.
                        </p>
                        <div className="flex items-center gap-2 justify-center mt-2 flex-wrap">
                          <button
                            onClick={() => refetchDms()}
                            className="flex items-center gap-1 text-[10px] text-white/20 hover:text-white/50 transition-colors"
                          >
                            <RefreshCw size={9} /> Check again
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* ── YouTube Analytics ──────────────────────────────────────────────── */}
        <motion.div variants={itemVariants} className="pt-2">
          {/* Section header */}
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,0,0,0.12)" }}>
              <Youtube size={16} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>YouTube</h2>
            {ytConfigured && (ytChannel?.title || ytStats?.channelTitle) && (
              <span className="text-xs text-white/30 truncate max-w-[200px]">@{ytChannel?.title || ytStats?.channelTitle}</span>
            )}
            {ytConfigured && (
              <span className="ml-auto text-[10px] text-white/25 flex items-center gap-1">
                <Repeat2 size={9} className="text-red-500" /> Live
              </span>
            )}
          </div>

          {/* ── Loading ── */}
          {ytLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonKPI key={i} />)}
            </div>
          ) : !ytConfigured ? (
            /* ── Not connected placeholder ── */
            <div className="rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,0,0,0.1)" }}>
                <Youtube size={24} className="text-red-500/60" />
              </div>
              <p className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>YouTube not connected</p>
              <p className="text-[11px] text-white/40 max-w-xs leading-relaxed">
                Connect your YouTube channel to see channel stats, video performance charts and your top videos here.
              </p>
              <a
                href="/settings?tab=youtube"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-medium text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all"
              >
                <Settings size={11} /> Settings → YouTube
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {/* ── Channel stat tiles ── */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Subscribers", value: ytStats?.subscribers ?? 0, icon: Users,      bg: "rgba(255,0,0,0.1)",   text: "text-red-500" },
                  { label: "Views",       value: ytStats?.views       ?? 0, icon: Eye,        bg: "rgba(236,72,153,0.1)", text: "text-pink-400" },
                  { label: "Videos",      value: ytStats?.videos      ?? 0, icon: PlayCircle, bg: "rgba(147,51,234,0.1)", text: "text-purple-400" },
                ].map((t, i) => (
                  <motion.div
                    key={t.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    whileHover={{ scale: 1.03 }}
                    className="rounded-2xl p-4"
                    style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background: t.bg }}>
                      <t.icon size={15} className={t.text} />
                    </div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{t.label}</p>
                    <p className="text-xl font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>{formatNumber(Number(t.value))}</p>
                  </motion.div>
                ))}
              </div>

              {/* ── Recent video performance chart ── */}
              <div className="rounded-2xl p-5" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <h3 className="text-sm font-semibold text-white mb-4" style={{ fontFamily: "Sora, sans-serif" }}>Recent Video Performance</h3>
                <div className="h-52">
                  {ytChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ytChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="ytViewsGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ff0000" stopOpacity={0.85} />
                            <stop offset="95%" stopColor="#ff0000" stopOpacity={0.35} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} interval={0} />
                        <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="views"    fill="url(#ytViewsGrad)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="likes"    fill="#ec4899" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="comments" fill="#9333ea" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-white/25 text-xs">
                      No videos yet  -  publish your first video to see performance here
                    </div>
                  )}
                </div>
              </div>

              {/* ── Top videos table ── */}
              <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
                  <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Top Videos</h3>
                  <span className="text-[10px] text-white/25">by views</span>
                </div>
                {ytTopVideos.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-white/[0.04]">
                          {["Video", "Views", "Likes", "Comments"].map((h) => (
                            <th key={h} className="text-left px-5 py-3 text-[10px] font-medium text-white/30 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ytTopVideos.map((v: any, i: number) => (
                          <motion.tr
                            key={v.videoId ?? i}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.1 + i * 0.04 }}
                            className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
                          >
                            <td className="px-5 py-3 max-w-[260px]">
                              <div className="flex items-center gap-2.5">
                                <a
                                  href={v.url ?? (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : undefined)}
                                  target="_blank" rel="noopener noreferrer"
                                  className="flex-shrink-0 relative group/thumb"
                                  title="Watch on YouTube"
                                >
                                  {v.thumbnail ? (
                                    <img src={v.thumbnail} alt="" className="w-14 h-8 rounded-md object-cover opacity-85 group-hover/thumb:opacity-100 transition-opacity" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                  ) : (
                                    <div className="w-14 h-8 rounded-md bg-white/5 flex items-center justify-center">
                                      <PlayCircle size={12} className="text-white/30" />
                                    </div>
                                  )}
                                </a>
                                <div className="min-w-0">
                                  <p className="text-xs text-white/80 font-medium truncate group-hover:text-white transition-colors">{v.title ?? "Untitled"}</p>
                                  <a
                                    href={v.url ?? (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : undefined)}
                                    target="_blank" rel="noopener noreferrer"
                                    className="text-[9px] text-white/20 hover:text-red-500 transition-colors flex items-center gap-0.5 mt-0.5"
                                  >
                                    Watch on YouTube ↗
                                  </a>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-xs tabular-nums">
                              <span className={v.views > 0 ? "text-white/70" : "text-white/30"}>{formatNumber(v.views ?? 0)}</span>
                            </td>
                            <td className="px-5 py-3 text-xs tabular-nums">
                              <span className={v.likes > 0 ? "text-pink-400" : "text-white/30"}>{formatNumber(v.likes ?? 0)}</span>
                            </td>
                            <td className="px-5 py-3 text-xs tabular-nums">
                              <span className={v.comments > 0 ? "text-purple-400" : "text-white/30"}>{formatNumber(v.comments ?? 0)}</span>
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-10 text-center text-white/30 text-sm">No videos yet  -  publish your first video!</div>
                )}
              </div>

              {/* ── YouTube comments ── */}
              <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
                  <MessageCircle size={13} className="text-red-500" />
                  <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Comments</h3>
                  {ytComments.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-red-500/20 text-red-400">{ytComments.length}</span>
                  )}
                  <span className="ml-auto text-[10px] text-white/25">recent videos</span>
                </div>

                {ytCommentsLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse bg-white/5 rounded-xl" />)}
                  </div>
                ) : ytComments.length > 0 ? (
                  <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
                    {ytComments.map((c: any, i: number) => (
                      <motion.div
                        key={c.commentId ?? i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.04 }}
                        className="px-4 py-3 hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-red-500">{c.author ?? "User"}</span>
                          <span className="text-[10px] text-white/25">{c.publishedAt ? formatRelativeTime(c.publishedAt) : ""}</span>
                        </div>
                        <p className="text-xs text-white/60 leading-relaxed mb-1.5">{c.text ?? ""}</p>
                        {c.videoTitle && (
                          <a
                            href={c.url ?? (c.videoId ? `https://youtube.com/shorts/${c.videoId}` : undefined)}
                            target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-white/30 hover:text-red-500 transition-colors max-w-full"
                            title={c.videoTitle}
                          >
                            <PlayCircle size={10} className="flex-shrink-0" />
                            <span className="truncate">{c.videoTitle}</span>
                            <span className="flex-shrink-0">↗</span>
                          </a>
                        )}
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-center text-white/30 text-sm">No comments yet</div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* ── Post Detail Drawer ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedPost && (
          <PostDetailDrawer
            post={selectedPost}
            postComments={postComments}
            onClose={() => setSelectedPost(null)}
            onRefresh={handleRefreshInsights}
            refreshing={refreshingInsights}
          />
        )}
      </AnimatePresence>
    </>
  );
}
