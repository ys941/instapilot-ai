"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  FileText,
  Eye,
  Heart,
  Users,
  Sparkles,
  Calendar,
  TrendingUp,
  Lightbulb,
  ArrowRight,
  Zap,
  RefreshCw,
  AlertCircle,
  Youtube,
  ThumbsUp,
  MessageCircle,
  PlaySquare,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import StatsCard from "@/components/dashboard/StatsCard";
import { formatNumber, getGreeting, formatRelativeTime } from "@/lib/utils";
import { useSelectedBrand, withBrand } from "@/components/dashboard/useSelectedBrand";
import { useBrand } from "@/components/BrandContext";

// ─── Animation variants ───────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

// No static insights  -  all generated from real account data via Grok

const quickActions = [
  {
    href: "/generator",
    icon: Sparkles,
    label: "Generate Post",
    desc: "AI content in seconds",
    gradient: "from-red-500 to-pink-600",
    glow: "rgba(239,68,68,0.3)",
  },
  {
    href: "/scheduler",
    icon: Calendar,
    label: "Schedule Post",
    desc: "Plan your calendar",
    gradient: "from-purple-500 to-indigo-600",
    glow: "rgba(147,51,234,0.3)",
  },
  {
    href: "/analytics",
    icon: TrendingUp,
    label: "View Analytics",
    desc: "Track performance",
    gradient: "from-blue-500 to-cyan-600",
    glow: "rgba(59,130,246,0.3)",
  },
];

// ─── Skeleton ────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 animate-pulse" style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="h-3 bg-white/5 rounded-xl w-1/3 mb-3" />
      <div className="h-7 bg-white/5 rounded-xl w-2/3 mb-2" />
      <div className="h-2 bg-white/5 rounded-xl w-1/4" />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="rounded-2xl p-5 animate-pulse h-64" style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="h-3 bg-white/5 rounded-xl w-1/4 mb-4" />
      <div className="h-full bg-white/[0.02] rounded-xl" />
    </div>
  );
}

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
          <span className="text-white font-medium">{typeof e.value === "number" && e.value > 100 ? formatNumber(e.value) : e.value}</span>
        </div>
      ))}
    </div>
  );
};

// ─── System Status Card (real health check) ──────────────────────────────────
function SystemStatusCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetch("/api/health").then((r) => r.json()),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const services = data?.data?.services;
  const overall  = data?.data?.overall;
  // Use dynamic label returned by health API (e.g. "Gemini AI ✨" or "Grok AI 🤖")
  const aiLabel   = services?.ai?.label ?? services?.groq?.label ?? "AI";
  const grokLabel = services?.grok?.label ?? "Grok AI 🤖 (DMs)";

  const rows = services
    ? [
        { label: "PostgreSQL",    ok: services.database?.ok,   detail: services.database?.detail },
        { label: aiLabel,         ok: services.ai?.ok ?? services.groq?.ok,   detail: services.ai?.detail ?? services.groq?.detail },
        ...(services.grok ? [{ label: grokLabel, ok: services.grok?.ok, detail: services.grok?.detail }] : []),
        { label: "Instagram API", ok: services.instagram?.ok,  detail: services.instagram?.detail },
      ]
    : [];

  const allOk = overall === "healthy";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.7 }}
      className="p-4 rounded-2xl border"
      style={{
        borderColor: allOk ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
        background:  allOk ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        {isLoading ? (
          <div className="w-2 h-2 rounded-full bg-white/30 animate-pulse" />
        ) : (
          <div
            className={`w-2 h-2 rounded-full animate-pulse ${allOk ? "bg-emerald-400" : "bg-red-400"}`}
          />
        )}
        <span
          className={`text-xs font-semibold ${isLoading ? "text-white/40" : allOk ? "text-emerald-400" : "text-red-400"}`}
        >
          {isLoading ? "Checking systems..." : allOk ? "All Systems Online" : "Some Services Offline"}
        </span>
      </div>

      <div className="space-y-1.5">
        {isLoading
          ? [1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-2.5 w-24 bg-white/10 rounded animate-pulse" />
                <div className="h-2.5 w-12 bg-white/10 rounded animate-pulse" />
              </div>
            ))
          : rows.map((s) => (
              <div key={s.label} className="flex items-center justify-between" title={s.detail}>
                <span className="text-[11px] text-white/50">{s.label}</span>
                <span
                  className={`text-[11px] font-medium ${s.ok ? "text-emerald-400" : "text-red-400"}`}
                >
                  {s.ok ? "● Online" : "● Offline"}
                </span>
              </div>
            ))}
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const brand = useBrand();
  const niche = brand.niche && brand.niche !== "your topic" ? brand.niche : "your";
  // getGreeting() uses new Date().getHours()  -  differs between SSR and client clock.
  // Initialize to a neutral string on the server; update on the client in useEffect.
  const [greeting, setGreeting] = useState("Good day");
  const queryClient = useQueryClient();
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("just now");
  const [refreshingInsights, setRefreshingInsights] = useState(false);
  const [insights, setInsights] = useState<string[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // ── Selected brand (account) — scopes all data fetches on this page ─────────
  const { brandId, isAll, selected } = useSelectedBrand();

  // ── AI provider setting — drives all labels/badges in this page ────────────
  const { data: aiPrefs } = useQuery({
    queryKey: ["ai-prefs"],
    queryFn:  () => fetch("/api/settings/ai").then((r) => r.json()),
    staleTime: 60000,
  });
  const aiProvider    = (aiPrefs?.data?.aiProvider ?? "grok") as "grok" | "gemini";
  const aiLabel       = aiProvider === "gemini" ? "Gemini ✨" : "Grok 🤖";
  const aiKeyEnvName  = aiProvider === "gemini" ? "GEMINI_API_KEY" : "GROK_API_KEY";

  // ── Queries ────────────────────────────────────────────────────────────────
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
    dataUpdatedAt: overviewUpdatedAt,
  } = useQuery({
    queryKey: ["analytics-overview", brandId],
    queryFn: () => fetch(withBrand("/api/analytics/overview", brandId)).then((r) => r.json()),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: posts, isLoading: postsLoading } = useQuery({
    queryKey: ["posts", "recent", brandId],
    queryFn: () => fetch(withBrand("/api/posts?limit=5&sort=createdAt", brandId)).then((r) => r.json()),
    refetchInterval: 60000,
    refetchIntervalInBackground: true,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: igAnalytics } = useQuery({
    queryKey: ["instagram-analytics", brandId],
    queryFn: () => fetch(withBrand("/api/instagram/analytics", brandId)).then((r) => r.json()),
    refetchInterval: 300000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  // ── YouTube overview (parallel to Instagram) ────────────────────────────────
  const { data: youtube, isLoading: youtubeLoading } = useQuery({
    queryKey: ["youtube-overview", brandId],
    queryFn: () => fetch(withBrand("/api/youtube/overview", brandId)).then((r) => r.json()),
    refetchInterval: 300000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const yt           = youtube?.data ?? {};
  const ytConfigured = !!yt.configured;
  const ytEnabled    = !!yt.enabled;
  const ytStats      = yt.stats ?? {};
  const ytChannelName = yt.channel?.title || ytStats.channelTitle || "";
  const ytSubscribers = ytStats.subscribers ?? 0;
  const ytViews       = ytStats.views ?? 0;
  const ytVideos      = ytStats.videos ?? 0;
  const ytRecent      = (yt.recentVideos ?? []) as Array<{
    videoId: string;
    title: string;
    publishedAt: string;
    thumbnail: string;
    views: number;
    likes: number;
    comments: number;
    url: string;
  }>;
  const ytTopVideo = ytRecent.length
    ? ytRecent.reduce((a, b) => (b.views > a.views ? b : a))
    : null;

  // ── Greeting (client-side  -  depends on local clock/timezone) ──────────────
  useEffect(() => {
    setGreeting(getGreeting());
  }, []);

  // ── Live timestamp ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!overviewUpdatedAt) return;
    const update = () => setLastUpdatedLabel(formatRelativeTime(new Date(overviewUpdatedAt)));
    update();
    const interval = setInterval(update, 15000);
    return () => clearInterval(interval);
  }, [overviewUpdatedAt]);

  // ── Generate AI insights from real account data ────────────────────────────
  const generateInsights = async (force = false) => {
    if (insightsLoading) return;
    if (insights.length > 0 && !force) return; // already loaded
    setInsightsLoading(true);
    setRefreshingInsights(force);

    // Snapshot all data NOW (before any await) so the values are consistent
    const ov          = overview?.data?.overview ?? {} as any;
    const ig          = igAnalytics?.data ?? {} as any;
    const topPosts    = (overview?.data?.topPosts ?? []).slice(0, 3) as any[];

    // Use the richest available numbers: DB stats supplemented by live IG API.
    // publishedPosts from DB only counts posts we scheduled internally (e.g. 2).
    // The live Instagram mediaCount (e.g. 14) reflects ALL published posts on the
    // account — use the larger value so AI gets the correct picture.
    const snapshotTotal       = Math.max(ov.totalPosts ?? 0, ig.profile?.mediaCount ?? 0);
    const snapshotPublished   = Math.max(ov.publishedPosts ?? 0, ig.profile?.mediaCount ?? 0);
    const snapshotDrafts      = ov.draftPosts ?? 0;
    const snapshotScheduled   = ov.scheduledPosts ?? 0;
    const snapshotEngagement  = ov.avgEngagementRate || ig.insights?.engagementRate || 0;
    const snapshotReach       = ov.totalReach       ?? ig.insights?.reach ?? 0;
    const snapshotSaves       = ov.totalSaves       ?? 0;
    const snapshotFollowers   = ig.profile?.followers ?? 0;
    const topTitles           = topPosts.map((p: any) => p.title).join(", ") || "none yet";

    // Snapshot YouTube data too (when connected + enabled) so AI sees both channels
    const ytOn                = ytConfigured && ytEnabled;
    const snapshotYtSubs      = ytOn ? ytSubscribers : 0;
    const snapshotYtViews     = ytOn ? ytViews : 0;
    const snapshotYtVideos    = ytOn ? ytVideos : 0;
    const snapshotYtTopTitle  = ytOn && ytTopVideo ? ytTopVideo.title : "";
    const snapshotYtTopViews  = ytOn && ytTopVideo ? ytTopVideo.views : 0;

    try {
      // Build a rich context string with real numbers
      const ytContext = ytOn
        ? ` YouTube channel stats: ${snapshotYtSubs} subscribers, ${snapshotYtViews} total views, ${snapshotYtVideos} videos.` +
          (snapshotYtTopTitle ? ` Best-performing recent video: "${snapshotYtTopTitle}" with ${snapshotYtTopViews} views.` : "")
        : "";

      const contextStr =
        `Instagram ${niche} account stats: ` +
        `${snapshotTotal} total posts (${snapshotPublished} published, ${snapshotDrafts} drafts, ${snapshotScheduled} scheduled), ` +
        `${snapshotFollowers} followers, ` +
        `avg engagement rate ${snapshotEngagement.toFixed(2)}%, ` +
        `total reach ${snapshotReach}, ` +
        `total saves ${snapshotSaves}. ` +
        `Recent top posts: ${topTitles}.` +
        ytContext;

      // FIX: API requires { messages: [{role, content}] }, NOT { message: "..." }
      // FIX: Response is in data.data.response, NOT data.data.message
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role:    "user",
              content: `Based on this ${niche} creator's data, give exactly 5 short actionable performance insights. One insight per line. No bullet points, no numbering, no markdown, no asterisks. Be specific to the numbers provided.${ytOn ? " Include at least one insight about the YouTube channel." : ""} ${contextStr}`,
            },
          ],
        }),
      });

      const data = await res.json();

      // FIX: response field is "response", not "message"
      if (data.success && data.data?.response) {
        const lines = (data.data.response as string)
          .split("\n")
          .map((l: string) => l.replace(/^[-•*\d.]+\s*/, "").trim())
          .filter((l: string) => l.length > 10)
          .slice(0, 5);
        if (lines.length > 0) {
          setInsights(lines);
          if (force) toast.success("Insights refreshed!");
          return;
        }
      }
      throw new Error("no valid insights in response");
    } catch (err: unknown) {
      // Detect invalid API key so the user sees a clear, actionable message
      const errMsg = err instanceof Error ? err.message : String(err);
      const isKeyError = errMsg.toLowerCase().includes("invalid_api_key") ||
                         errMsg.toLowerCase().includes("invalid api key") ||
                         errMsg.toLowerCase().includes("401");

      // Fallback: build data-accurate insights from the snapshot values
      const ytFallback = ytOn
        ? snapshotYtVideos > 0
          ? `YouTube: ${snapshotYtSubs} subscribers across ${snapshotYtVideos} videos (${formatNumber(snapshotYtViews)} total views)${snapshotYtTopTitle ? ` — your top recent video "${snapshotYtTopTitle}" pulled ${formatNumber(snapshotYtTopViews)} views; repurpose its hook into a Short.` : " — post Shorts consistently to grow reach."}`
          : "YouTube channel is connected but has no videos yet — publish a 60s Short to seed the algorithm."
        : null;

      setInsights([
        snapshotTotal > 0
          ? `You have ${snapshotTotal} posts total (${snapshotPublished} published) — aim for 5+ published per week for optimal reach growth.`
          : "You have no posts yet — start with an Educational or Quiz post to kick off your content strategy.",
        snapshotEngagement > 0
          ? `Your average engagement rate is ${snapshotEngagement.toFixed(2)}% — ${snapshotEngagement >= 3 ? "great! maintain consistency to keep it above the 3–5% benchmark." : "industry benchmark is 3–5%; boost it with quiz posts and reply to every comment."}`
          : "Track your first post's engagement — industry benchmark is 3–5%.",
        snapshotSaves > 0
          ? `Total saves: ${snapshotSaves} — save-worthy posts are prime candidates for carousel repurposing.`
          : "Add save-worthy content like how-to guides or checklists — saves signal long-term value to the algorithm.",
        snapshotFollowers < 500
          ? `${snapshotFollowers > 0 ? `With ${snapshotFollowers} followers,` : "Early accounts"} focus on consistent posting (daily or every 2 days) and using 20–30 targeted hashtags to accelerate discovery.`
          : `Post carousels and reels on weekdays 7–9 PM IST when your audience is most active on Instagram.`,
        ytFallback ??
          "Reply to every comment in the first 30 minutes after posting — early engagement signals to the algorithm that your content is worth amplifying.",
      ]);
      if (force) {
        if (isKeyError) {
          toast.error(`⚠️ ${aiLabel} API key is invalid — go to Settings → AI Config to update it`);
        } else {
          toast.error("Could not reach AI — showing data-based defaults");
        }
      }
    } finally {
      setInsightsLoading(false);
      setRefreshingInsights(false);
    }
  };

  const handleRefreshInsights = () => generateInsights(true);

  // Auto-generate insights once overview data is loaded
  useEffect(() => {
    if (overview?.data && insights.length === 0) generateInsights(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.data, youtube?.data]);

  // API returns { data: { overview: {...}, weeklyTrend: [...], ... } }
  const weeklyTrends  = overview?.data?.weeklyTrend ?? [];
  // Instagram analytics returns { data: { profile: { followers, mediaCount, ... }, insights: { ... } } }
  const followers     = igAnalytics?.data?.profile?.followers ?? 0;
  const igMediaCount  = igAnalytics?.data?.profile?.mediaCount ?? 0;
  const igReach       = igAnalytics?.data?.insights?.reach ?? 0;
  const igEngagement  = igAnalytics?.data?.insights?.engagementRate ?? 0;

  // Use the higher of DB total and live Instagram media count.
  // DB may only track locally-scheduled posts (e.g. 1) while the real Instagram
  // account has many more  -  Math.max ensures we always show the correct number.
  const totalPosts    = Math.max(overview?.data?.overview?.totalPosts ?? 0, igMediaCount ?? 0) || 0;
  const totalReach    = overview?.data?.overview?.totalReach    || igReach               || 0;
  const avgEngagement = overview?.data?.overview?.avgEngagementRate || igEngagement      || 0;

  const isFresh = overviewUpdatedAt && Date.now() - overviewUpdatedAt < 60000;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6 max-w-7xl mx-auto"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="flex items-start justify-between">
        <div>
          <h2
            className="text-2xl font-bold text-white"
            style={{ fontFamily: "Sora, sans-serif" }}
            suppressHydrationWarning
          >
            {greeting},{" "}
            <span className="gradient-text">{brand.displayName}</span> 👋
          </h2>
          <p className="text-white/40 text-sm mt-1">
            Here&apos;s what&apos;s happening with your content today.
          </p>
          <p className="text-white/30 text-xs mt-0.5">
            Account:{" "}
            <span className="text-white/60 font-medium">
              {isAll ? "All accounts (aggregate)" : selected?.label ?? "Primary"}
            </span>
          </p>
          {overviewUpdatedAt ? (
            <p className="text-white/25 text-xs mt-0.5">Last updated: {lastUpdatedLabel}</p>
          ) : null}
        </div>
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-xs text-white/40">
          <div className={`w-1.5 h-1.5 rounded-full ${isFresh ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
          {isFresh ? "Live data" : "Updating..."}
        </div>
      </motion.div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {overviewError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/10 text-xs text-red-400"
        >
          <AlertCircle size={13} />
          Could not load data  -  retrying automatically...
        </motion.div>
      )}

      {/* ── Stat Cards ─────────────────────────────────────────────────────── */}
      <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {overviewLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatsCard title="Total Posts"    value={totalPosts}    change={overview?.data?.overview?.postsChange      ?? 0} icon={FileText} color="red"    index={0} />
            <StatsCard title="Total Reach"    value={totalReach}    change={overview?.data?.overview?.reachChange       ?? 0} icon={Eye}      color="pink"   index={1} />
            <StatsCard title="Avg Engagement" value={avgEngagement} change={overview?.data?.overview?.impressionsChange ?? 0} icon={Heart}    color="purple" index={2} suffix="%" animateValue={false} />
            <StatsCard title="Followers"      value={followers}     change={igAnalytics?.data?.followersChange          ?? 0} icon={Users}    color="blue"   index={3} />
          </>
        )}
      </motion.div>

      {/* ── YouTube ────────────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center gap-2 mb-3 px-1">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-600/25 to-red-500/10 flex items-center justify-center">
            <Youtube size={15} className="text-red-500" />
          </div>
          <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>
            YouTube
          </h3>
          {ytConfigured && ytChannelName ? (
            <span className="text-xs text-white/40 truncate max-w-[40%]">· {ytChannelName}</span>
          ) : null}
          {ytConfigured && !ytEnabled ? (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] text-white/40 border border-white/[0.08]">
              Disabled
            </span>
          ) : null}
        </div>

        {youtubeLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : !ytConfigured ? (
          /* Not connected — subtle CTA card */
          <div
            className="rounded-2xl p-5 flex items-center gap-4"
            style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600/20 to-red-500/5 flex items-center justify-center flex-shrink-0">
              <Youtube size={18} className="text-red-500/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white/70">YouTube not connected</p>
              <p className="text-xs text-white/35 mt-0.5">
                Configure in{" "}
                <Link href="/settings" className="text-red-400 hover:text-red-300 underline underline-offset-2">
                  Settings → YouTube
                </Link>{" "}
                to track your channel here.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* YouTube stat tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "Subscribers", value: ytSubscribers, icon: Users },
                { label: "Total Views", value: ytViews, icon: Eye },
                { label: "Videos", value: ytVideos, icon: PlaySquare },
              ].map((tile, i) => (
                <motion.div
                  key={tile.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="rounded-2xl p-5"
                  style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(239,68,68,0.18)" }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-white/40">{tile.label}</span>
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-600/25 to-red-500/10 flex items-center justify-center">
                      <tile.icon size={13} className="text-red-500" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>
                    {formatNumber(tile.value)}
                  </p>
                </motion.div>
              ))}
            </div>

            {/* Recent videos */}
            <div
              className="mt-4 rounded-2xl overflow-hidden"
              style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className="px-5 py-4 border-b border-white/[0.06]">
                <h4 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>
                  Recent Videos
                </h4>
              </div>
              {ytRecent.length ? (
                <div className="divide-y divide-white/[0.04]">
                  {ytRecent.map((v, i) => (
                    <motion.a
                      key={v.videoId ?? i}
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors group"
                    >
                      {v.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={v.thumbnail}
                          alt={v.title}
                          className="w-20 h-12 rounded-lg object-cover flex-shrink-0 border border-white/[0.06]"
                        />
                      ) : (
                        <div className="w-20 h-12 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                          <Youtube size={16} className="text-red-500/60" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/80 font-medium truncate group-hover:text-white transition-colors">
                          {v.title}
                        </p>
                        <p className="text-xs text-white/30 mt-0.5">
                          {v.publishedAt ? formatRelativeTime(v.publishedAt) : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-white/40 flex-shrink-0">
                        <span className="flex items-center gap-1"><Eye size={11} /> {formatNumber(v.views ?? 0)}</span>
                        <span className="flex items-center gap-1"><ThumbsUp size={11} /> {formatNumber(v.likes ?? 0)}</span>
                        <span className="flex items-center gap-1"><MessageCircle size={11} /> {formatNumber(v.comments ?? 0)}</span>
                      </div>
                    </motion.a>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-white/30 text-sm">
                  No videos yet — your channel is connected and ready.
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Engagement trend */}
        {overviewLoading ? (
          <>
            <SkeletonChart />
            <SkeletonChart />
          </>
        ) : (
          <>
            <div
              className="rounded-2xl p-5"
              style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <h3 className="text-sm font-semibold text-white mb-4" style={{ fontFamily: "Sora, sans-serif" }}>
                Weekly Engagement
              </h3>
              <div className="h-52">
                {weeklyTrends.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weeklyTrends} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="likesGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="savesGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#9333ea" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#9333ea" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="posts"   stroke="#ef4444" strokeWidth={2} fill="url(#likesGrad)" dot={false} />
                      <Area type="monotone" dataKey="reach"   stroke="#9333ea" strokeWidth={2} fill="url(#savesGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-white/25 text-xs">No trend data yet</div>
                )}
              </div>
            </div>

            {/* Reach trend */}
            <div
              className="rounded-2xl p-5"
              style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <h3 className="text-sm font-semibold text-white mb-4" style={{ fontFamily: "Sora, sans-serif" }}>
                Weekly Reach
              </h3>
              <div className="h-52">
                {weeklyTrends.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weeklyTrends} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="reachGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="reach" stroke="#3b82f6" strokeWidth={2} fill="url(#reachGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-white/25 text-xs">No reach data yet</div>
                )}
              </div>
            </div>
          </>
        )}
      </motion.div>

      {/* ── AI Insights + Quick Actions ─────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AI Insights */}
        <div
          className="lg:col-span-2 rounded-2xl p-5"
          style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-yellow-500/20 to-orange-500/10 flex items-center justify-center">
              <Lightbulb size={14} className="text-yellow-400" />
            </div>
            <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>
              AI Performance Insights
            </h3>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
              Powered by {aiLabel}
            </span>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleRefreshInsights}
              disabled={refreshingInsights}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all disabled:opacity-40"
            >
              <RefreshCw size={9} className={refreshingInsights ? "animate-spin" : ""} />
              Refresh
            </motion.button>
          </div>

          <div className="space-y-3">
            {insightsLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-xl bg-white/[0.03] border border-white/[0.04]" />
                ))
              : insights.map((insight, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className="flex gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-red-500/30 to-pink-500/20 flex items-center justify-center mt-0.5">
                      <Zap size={10} className="text-red-400" />
                    </div>
                    <p className="text-xs text-white/65 leading-relaxed">{insight}</p>
                  </motion.div>
                ))
            }
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-3">
          <h3
            className="text-sm font-semibold text-white/60 uppercase tracking-wider px-1"
            style={{ fontFamily: "Sora, sans-serif" }}
          >
            Quick Actions
          </h3>
          {quickActions.map((action, i) => (
            <motion.div
              key={action.href}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              whileHover={{ scale: 1.02, x: 2 }}
            >
              <Link
                href={action.href}
                className="flex items-center gap-4 p-4 rounded-2xl border border-white/[0.07] hover:border-white/[0.12] transition-all group"
                style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)" }}
              >
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${action.gradient} flex items-center justify-center flex-shrink-0`}
                  style={{ boxShadow: `0 0 20px ${action.glow}` }}
                >
                  <action.icon size={18} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{action.label}</p>
                  <p className="text-xs text-white/40 mt-0.5">{action.desc}</p>
                </div>
                <ArrowRight size={14} className="text-white/20 group-hover:text-white/60 group-hover:translate-x-1 transition-all" />
              </Link>
            </motion.div>
          ))}

          {/* Live status card  -  real health check */}
          <SystemStatusCard />
        </div>
      </motion.div>

      {/* ── Recent Posts ────────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(17,17,24,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <h3 className="text-sm font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>
              Recent Posts
            </h3>
            <Link href="/content-library" className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1 transition-colors">
              View all <ArrowRight size={11} />
            </Link>
          </div>
          {postsLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse bg-white/5 rounded-xl" />
              ))}
            </div>
          ) : (posts?.data?.posts ?? posts?.data ?? []).length ? (
            <div className="divide-y divide-white/[0.04]">
              {(posts?.data?.posts ?? posts?.data ?? []).map((post: any, i: number) => (
                <motion.div
                  key={post.id ?? i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/80 font-medium truncate">{post.caption ?? post.title ?? "Untitled"}</p>
                    <p className="text-xs text-white/30 mt-0.5">{post.type ?? "Post"} · {post.createdAt ? formatRelativeTime(post.createdAt) : ""}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-white/40 flex-shrink-0">
                    {post.likes != null && <span>❤ {formatNumber(post.likes)}</span>}
                    {post.reach != null && <span>👁 {formatNumber(post.reach)}</span>}
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-white/30 text-sm">
              No posts yet  -  <Link href="/generator" className="text-red-400 hover:text-red-300 underline underline-offset-2">generate your first</Link>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
