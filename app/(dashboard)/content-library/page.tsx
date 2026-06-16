"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Grid,
  List,
  RefreshCw,
  Trash2,
  Calendar,
  Copy,
  CheckCircle,
  Clock,
  FileText,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Send,
  X,
  Heart,
  Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import InstagramPostPreview from "@/components/ui/InstagramPostPreview";
import { useSelectedBrand, withBrand } from "@/components/dashboard/useSelectedBrand";

// ─── Types ────────────────────────────────────────────────────
type PostStatus = "PUBLISHED" | "SCHEDULED" | "DRAFT" | "FAILED";

interface Post {
  id: string;
  title: string;
  content: string;
  hook?: string;
  cta?: string;
  hashtags?: string[];
  imagePrompt?: string;
  reelScript?: string;
  type: string;
  status: PostStatus;
  viralScore?: number;
  createdAt: string;
  scheduledAt?: string;
  reach?: string;
  mediaUrls?: string[];
  instagramPostId?: string;
}

interface ApiResponse {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Status config ────────────────────────────────────────────
const statusConfig: Record<PostStatus, { label: string; icon: React.ElementType; className: string }> = {
  PUBLISHED: { label: "Published", icon: CheckCircle, className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  SCHEDULED: { label: "Scheduled", icon: Clock, className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  DRAFT: { label: "Draft", icon: FileText, className: "bg-white/5 text-white/50 border-white/10" },
  FAILED: { label: "Failed", icon: AlertCircle, className: "bg-red-500/10 text-red-400 border-red-500/20" },
};

// ─── Type colors ──────────────────────────────────────────────
const typeColors: Record<string, string> = {
  CLINICAL_PEARL: "text-purple-400 bg-purple-500/10",
  ECG_QUIZ: "text-red-400 bg-red-500/10",
  MYTH_FACT: "text-yellow-400 bg-yellow-500/10",
  CASE_STUDY: "text-pink-400 bg-pink-500/10",
  EDUCATIONAL: "text-blue-400 bg-blue-500/10",
  CAROUSEL: "text-orange-400 bg-orange-500/10",
  ANGIOGRAPHY_QUIZ: "text-cyan-400 bg-cyan-500/10",
  PREVENTIVE: "text-teal-400 bg-teal-500/10",
  REEL: "text-indigo-400 bg-indigo-500/10",
  QUIZ: "text-amber-400 bg-amber-500/10",
  CTA: "text-rose-400 bg-rose-500/10",
};

// Neutral, niche-agnostic labels for the internal post-type enum ids. KEEPS the
// enum ids (DB values) but never surfaces cardiology wording in the UI.
const NEUTRAL_TYPE_LABELS: Record<string, string> = {
  EDUCATIONAL:      "Educational",
  QUIZ:             "Quiz",
  CAROUSEL:         "Carousel",
  MYTH_FACT:        "Myth vs Fact",
  CLINICAL_PEARL:   "Pro Tip",
  CASE_STUDY:       "Story / Example",
  ANGIOGRAPHY_QUIZ: "Image Quiz",
  ECG_QUIZ:         "Knowledge Quiz",
  PREVENTIVE:       "How-To / Tips",
  CTA:              "Call to Action",
  REEL:             "Reel",
  STORY:            "Story",
};

function typeLabel(t: string): string {
  return NEUTRAL_TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const glassCard: React.CSSProperties = {
  background: "rgba(17,17,24,0.8)",
  backdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
};

// ─── Viral Score Bar ──────────────────────────────────────────
function ViralBar({ score }: { score?: number }) {
  if (!score) return null;
  const color =
    score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
  return (
    <div className="w-full h-1 rounded-full overflow-hidden mt-1" style={{ background: "rgba(255,255,255,0.07)" }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${score}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="h-full rounded-full"
        style={{ background: color }}
      />
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────
function EmptyState({ isFiltered }: { isFiltered: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      {isFiltered ? (
        <>
          <svg width="100" height="100" viewBox="0 0 120 120" fill="none" className="mb-5 opacity-30">
            <circle cx="60" cy="60" r="50" stroke="rgba(239,68,68,0.4)" strokeWidth="2" strokeDasharray="8 4" />
            <motion.path
              d="M40 60 L52 72 L80 44"
              stroke="#ef4444"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1, delay: 0.3 }}
            />
          </svg>
          <p className="text-white/40 font-medium">No posts match your filters</p>
          <p className="text-white/20 text-sm mt-1">Try adjusting your search or filters</p>
        </>
      ) : (
        <>
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="mb-5"
          >
            <div
              className="w-20 h-32 rounded-2xl border-2 flex flex-col items-center justify-center gap-3"
              style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}
            >
              <Sparkles size={20} className="text-red-400" />
              <Heart size={16} className="text-red-500/50" fill="rgba(239,68,68,0.3)" />
            </div>
          </motion.div>
          <p className="text-white/40 font-medium">No posts yet</p>
          <p className="text-white/20 text-sm mt-1">
            Head to the Generator to create your first post!
          </p>
        </>
      )}
    </motion.div>
  );
}

// ─── Preview Modal ────────────────────────────────────────────
function PreviewModal({ post, onClose, onDelete, onPublish, onSchedule, isPublishing }: {
  post: Post;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onPublish: (id: string) => Promise<void>;
  onSchedule: (post: Post) => void;
  isPublishing: boolean;
}) {
  const st = statusConfig[post.status] ?? statusConfig.DRAFT;
  const StIcon = st.icon;

  const copyCaption = () => {
    const parts = [
      post.hook,
      post.content,
      post.cta,
      (post.hashtags ?? []).join(" "),
    ].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(parts);
    toast.success("Caption copied!");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ duration: 0.3 }}
        className="relative w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-3xl flex flex-col"
        style={glassCard}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border", st.className)}>
              <StIcon size={10} />{st.label}
            </span>
            <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-semibold", typeColors[post.type] ?? "bg-white/5 text-white/40")}>
              {typeLabel(post.type)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col lg:flex-row gap-6 p-6 overflow-y-auto flex-1">
          {/* LEFT: Instagram preview */}
          <div className="flex-shrink-0">
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-4 text-center">Instagram Preview</p>
            <InstagramPostPreview
              content={post.content}
              hook={post.hook}
              hashtags={post.hashtags ?? []}
              type={typeLabel(post.type)}
              viralScore={post.viralScore ?? 0}
              imagePrompt={post.imagePrompt}
              mediaUrl={(post.mediaUrls ?? [])[0]}
            />
          </div>

          {/* RIGHT: Details */}
          <div className="flex-1 min-w-0 space-y-4">
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Title</label>
              <h2 className="text-lg font-bold text-white mt-1 leading-snug" style={{ fontFamily: "Sora, sans-serif" }}>
                {post.title}
              </h2>
            </div>

            {post.hook && (
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Hook</label>
                <p className="text-sm text-white/80 mt-1 italic border-l-2 border-red-500/40 pl-3 leading-relaxed">
                  {post.hook}
                </p>
              </div>
            )}

            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Content</label>
              <div
                className="mt-1 p-3 rounded-xl text-sm text-white/70 leading-relaxed whitespace-pre-line max-h-48 overflow-y-auto"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                {post.content}
              </div>
            </div>

            {post.cta && (
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Call to Action</label>
                <p className="text-sm text-white/70 mt-1">{post.cta}</p>
              </div>
            )}

            {(post.hashtags ?? []).length > 0 && (
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium">
                  Hashtags ({(post.hashtags ?? []).length})
                </label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {(post.hashtags ?? []).map((tag) => (
                    <span
                      key={tag}
                      onClick={() => { navigator.clipboard.writeText(tag); toast.success(`${tag} copied!`); }}
                      className="px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer"
                      style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(252,165,165,0.9)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              {post.viralScore !== undefined && (
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span>Viral Score:</span>
                  <span className="font-semibold text-white">{post.viralScore}/100</span>
                </div>
              )}
              <span className="text-white/20">•</span>
              <span className="text-xs text-white/30" suppressHydrationWarning>
                {new Date(post.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-t border-white/[0.06]">
          <button
            onClick={copyCaption}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/[0.15] transition-all"
          >
            <Copy size={12} /> Copy Caption
          </button>
          <button
            onClick={() => { onClose(); onSchedule(post); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-blue-400 border border-blue-500/20 hover:bg-blue-500/10 transition-all"
          >
            <Calendar size={12} /> Schedule
          </button>
          <button
            onClick={async () => { await onPublish(post.id); onClose(); }}
            disabled={isPublishing || post.status === "PUBLISHED"}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white bg-gradient-to-r from-red-500 to-pink-600 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden"
          >
            {isPublishing ? (
              <>
                {/* Colorful spinning ring */}
                <span className="inline-block w-3 h-3 rounded-full border-2 border-transparent border-t-white border-r-pink-300 animate-spin" />
                Publishing...
                {/* shimmer sweep */}
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.2s_infinite]" style={{ backgroundSize: "200% 100%" }} />
              </>
            ) : post.status === "PUBLISHED" ? (
              <><CheckCircle size={12} /> Published</>
            ) : (
              <><Send size={12} />{(post.mediaUrls ?? []).length === 0 ? "Publish (AI image)" : "Publish Now"}</>
            )}
          </button>
          {(post.mediaUrls ?? []).length === 0 && (
            <span className="text-[10px] text-purple-400/60 flex items-center gap-1">
              ✨ No media  -  an image will be AI-generated automatically
            </span>
          )}
          <button
            onClick={async () => { await onDelete(post.id); onClose(); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all ml-auto"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Schedule Modal ───────────────────────────────────────────
function ScheduleModal({ post, onClose, onScheduled, brandId }: {
  post: Post;
  onClose: () => void;
  onScheduled: () => void;
  brandId: string;
}) {
  // Default to 1 hour from now in IST, rounded to next quarter hour
  const IST = "Asia/Kolkata";
  const defaultDt = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    // Format as "YYYY-MM-DDTHH:MM" in IST for datetime-local input
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d).replace(", ", "T");
  };
  const [scheduledAt, setScheduledAt] = useState(defaultDt);
  const [scheduling, setScheduling] = useState(false);

  const handleSchedule = async () => {
    if (!scheduledAt) return;
    setScheduling(true);
    try {
      // Parse as IST (datetime-local value is IST wall-clock time, offset +05:30)
      const scheduledFor = new Date(`${scheduledAt}:00+05:30`).toISOString();
      const res = await fetch("/api/scheduler", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId:       post.id,
          title:        post.title,
          content:      post.content,
          hashtags:     post.hashtags ?? [],
          mediaUrl:     (post.mediaUrls ?? [])[0] ?? undefined,
          scheduledFor,
          timezone:     "Asia/Kolkata",
          isRecurring:  false,
          ...(brandId && { brand: brandId }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Post scheduled! 📅");
        onScheduled();
        onClose();
      } else {
        toast.error(data.error ?? "Failed to schedule post");
      }
    } catch {
      toast.error("Failed to schedule post");
    } finally {
      setScheduling(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-sm rounded-3xl p-6 space-y-4"
        style={glassCard}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <Calendar size={16} className="text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Schedule Post</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all">
            <X size={14} />
          </button>
        </div>

        {/* Post title preview */}
        <div className="px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Post</p>
          <p className="text-xs text-white/80 font-medium truncate">{post.title}</p>
        </div>

        {/* Date/time picker */}
        <div>
          <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium block mb-1.5">
            Schedule for
          </label>
          <input
            type="datetime-local"
            value={scheduledAt}
            min={new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() + 5 * 60 * 1000)).replace(", ", "T")}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none transition-all"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(59,130,246,0.3)", colorScheme: "dark" }}
          />
          <p className="text-[10px] text-white/25 mt-1">Timezone: India Standard Time (IST)</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-xl text-xs font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSchedule}
            disabled={scheduling || !scheduledAt}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-600 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scheduling ? (
              <><span className="w-3 h-3 rounded-full border-2 border-transparent border-t-white animate-spin" />Scheduling...</>
            ) : (
              <><Calendar size={12} />Schedule</>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function ContentLibraryPage() {
  const { brandId, isAll, selected } = useSelectedBrand();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [previewPost, setPreviewPost]   = useState<Post | null>(null);
  const [schedulingPost, setSchedulingPost] = useState<Post | null>(null);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());

  // ── Fetch data ───────────────────────────────────────────────
  const { data, isLoading, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ["content-library", searchQuery, statusFilter, typeFilter, page, brandId],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "12",
        ...(searchQuery && { search: searchQuery }),
        ...(statusFilter !== "ALL" && { status: statusFilter }),
        ...(typeFilter !== "ALL" && { type: typeFilter }),
        ...(brandId && { brand: brandId }),
      });
      const res = await fetch(`/api/content-library?${params}`);
      if (!res.ok) throw new Error("Failed to fetch posts");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const posts: Post[] = data?.data?.posts ?? data?.data ?? [];
  const pagination = data?.data?.pagination ?? data?.pagination;
  const totalPosts = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;

  const isFiltered = Boolean(searchQuery || statusFilter !== "ALL" || typeFilter !== "ALL");

  // ── Delete ───────────────────────────────────────────────────
  const handleDelete = async (postId: string) => {
    try {
      await fetch(withBrand(`/api/posts/${postId}`, brandId), { method: "DELETE" });
      toast.success("Post deleted");
      refetch();
    } catch {
      toast.error("Failed to delete post");
    }
  };

  // ── Publish ──────────────────────────────────────────────────
  const handlePublish = async (postId: string) => {
    // Prevent duplicate publish
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    if (post.status === "PUBLISHED") {
      toast("This post is already published on Instagram", { icon: "✅" });
      return;
    }
    if (publishingIds.has(postId)) return; // already in-flight

    setPublishingIds((prev) => new Set([...prev, postId]));

    const hasMedia = (post?.mediaUrls ?? []).length > 0;
    const isCarousel = post?.type === "CAROUSEL";
    const toastId = isCarousel
      ? toast.loading("🎨 Rendering branded slides & publishing... (30–60 s)")
      : hasMedia
      ? toast.loading("Publishing to Instagram...")
      : toast.loading("✨ Generating image & publishing... (20–40 s)");

    try {
      const res  = await fetch(withBrand(`/api/posts/${postId}/publish`, brandId), { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("Published to Instagram! 🎉", { id: toastId });
        refetch();
      } else {
        toast.error(data.error ?? "Publish failed", { id: toastId });
      }
    } catch {
      toast.error("Publish request failed", { id: toastId });
    } finally {
      setPublishingIds((prev) => { const s = new Set(prev); s.delete(postId); return s; });
    }
  };

  // ── Page change helper ────────────────────────────────────────
  const goToPage = (p: number) => {
    setPage(Math.max(1, Math.min(p, totalPages)));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-7xl mx-auto space-y-5"
    >
      {/* Active account indicator */}
      <div className="text-xs text-white/40">
        Account:{" "}
        <span className="text-white/60 font-medium">
          {isAll ? "All accounts (aggregate)" : selected?.label ?? "Primary"}
        </span>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            placeholder="Search posts..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
            style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(255,255,255,0.08)" }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(239,68,68,0.4)"; }}
            onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
          />
        </div>

        {/* Status filter */}
        <div className="flex rounded-xl overflow-hidden border border-white/[0.08]" style={{ background: "rgba(17,17,24,0.8)" }}>
          {(["ALL", "PUBLISHED", "SCHEDULED", "DRAFT", "FAILED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={cn(
                "px-3 py-2 text-xs font-medium capitalize transition-all",
                statusFilter === s ? "bg-red-500/20 text-white" : "text-white/30 hover:text-white/60"
              )}
            >
              {s === "ALL" ? "All" : (statusConfig[s as PostStatus]?.label ?? s)}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.08]"
          style={{ background: "rgba(17,17,24,0.8)" }}
        >
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="bg-transparent text-xs text-white/60 outline-none cursor-pointer"
          >
            <option value="ALL" style={{ background: "#111118" }}>All Types</option>
            {Object.keys(typeColors).map((t) => (
              <option key={t} value={t} style={{ background: "#111118" }}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        </div>

        {/* Refresh */}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs text-white/40 hover:text-white border border-white/[0.08] hover:border-white/[0.15] transition-all disabled:opacity-40"
          style={{ background: "rgba(17,17,24,0.8)" }}
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>

        {/* View toggle */}
        <div className="flex rounded-xl overflow-hidden border border-white/[0.08]" style={{ background: "rgba(17,17,24,0.8)" }}>
          <button
            onClick={() => setViewMode("grid")}
            className={cn("p-2.5 transition-all", viewMode === "grid" ? "bg-red-500/20 text-white" : "text-white/30 hover:text-white/60")}
          >
            <Grid size={14} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn("p-2.5 transition-all", viewMode === "list" ? "bg-red-500/20 text-white" : "text-white/30 hover:text-white/60")}
          >
            <List size={14} />
          </button>
        </div>
      </div>

      {/* Count */}
      {!isLoading && (
        <div className="text-xs text-white/25">
          {totalPosts} post{totalPosts !== 1 ? "s" : ""} found
          {pagination && totalPosts > 0 && (
            <span>
              {" "} -  showing {(page - 1) * (pagination.limit) + 1}–{Math.min(page * pagination.limit, totalPosts)}
            </span>
          )}
        </div>
      )}

      {/* ── Content ── */}
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={
              viewMode === "grid"
                ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
                : "space-y-2"
            }
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={viewMode === "grid" ? "rounded-2xl p-4 space-y-3" : "rounded-xl p-4 flex gap-4"}
                style={glassCard}
              >
                <div className="shimmer h-4 w-2/3 rounded" />
                <div className="shimmer h-3 w-full rounded" />
                <div className="shimmer h-3 w-4/5 rounded" />
              </div>
            ))}
          </motion.div>
        ) : posts.length === 0 ? (
          <EmptyState isFiltered={isFiltered} />
        ) : viewMode === "grid" ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {posts.map((post, i) => {
              const st = statusConfig[post.status] ?? statusConfig.DRAFT;
              const StIcon = st.icon;
              return (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={{ scale: 1.02, y: -2 }}
                  onClick={() => setPreviewPost(post)}
                  className="rounded-2xl p-4 flex flex-col gap-3 cursor-pointer group transition-all"
                  style={glassCard}
                >
                  {/* Badges */}
                  <div className="flex items-center justify-between">
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold", typeColors[post.type] ?? "bg-white/5 text-white/40")}>
                      {typeLabel(post.type)}
                    </span>
                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border", st.className)}>
                      <StIcon size={9} />{st.label}
                    </span>
                  </div>

                  {/* Title & preview */}
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-white leading-snug mb-1.5">{post.title}</h4>
                    <p className="text-xs text-white/40 leading-relaxed line-clamp-2">{post.content}</p>
                  </div>

                  {/* Viral score bar */}
                  <ViralBar score={post.viralScore} />

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.05]">
                    <div>
                      <p className="text-[10px] text-white/25" suppressHydrationWarning>
                        {new Date(post.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      {post.viralScore !== undefined && (
                        <p className="text-[10px] text-white/30 mt-0.5">
                          Viral: <span className="font-semibold text-white/50">{post.viralScore}</span>
                        </p>
                      )}
                    </div>
                    {/* Quick actions (stop propagation so card click doesn't fire) */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); setPreviewPost(post); }}
                        className="w-6 h-6 rounded-lg bg-white/[0.05] hover:bg-purple-500/20 flex items-center justify-center text-white/40 hover:text-purple-400 transition-all"
                        title="Preview"
                      >
                        <Eye size={10} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSchedulingPost(post); }}
                        className="w-6 h-6 rounded-lg bg-white/[0.05] hover:bg-blue-500/20 flex items-center justify-center text-white/40 hover:text-blue-400 transition-all"
                        title="Schedule"
                      >
                        <Calendar size={10} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(post.id); }}
                        className="w-6 h-6 rounded-lg bg-white/[0.05] hover:bg-red-500/20 flex items-center justify-center text-white/40 hover:text-red-400 transition-all"
                        title="Delete"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl overflow-hidden"
            style={glassCard}
          >
            {posts.map((post, i) => {
              const st = statusConfig[post.status] ?? statusConfig.DRAFT;
              const StIcon = st.icon;
              return (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setPreviewPost(post)}
                  className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors group cursor-pointer"
                >
                  <span className={cn("flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold", typeColors[post.type] ?? "bg-white/5 text-white/40")}>
                    {typeLabel(post.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/80 truncate">{post.title}</p>
                    <p className="text-xs text-white/30 truncate mt-0.5">{post.content}</p>
                  </div>
                  <span className={cn("flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border", st.className)}>
                    <StIcon size={9} />{st.label}
                  </span>
                  <span className="flex-shrink-0 text-xs text-white/30 w-24 text-right" suppressHydrationWarning>
                    {new Date(post.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  {post.viralScore !== undefined && (
                    <span className="flex-shrink-0 text-xs text-white/40 w-12 text-right font-semibold">
                      {post.viralScore}
                    </span>
                  )}
                  <div
                    className="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => setPreviewPost(post)}
                      className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-purple-500/20 flex items-center justify-center text-white/40 hover:text-purple-400 transition-all"
                    >
                      <Eye size={12} />
                    </button>
                    <button
                      onClick={() => setSchedulingPost(post)}
                      className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-blue-500/20 flex items-center justify-center text-white/40 hover:text-blue-400 transition-all"
                      title="Schedule"
                    >
                      <Calendar size={12} />
                    </button>
                    <button
                      onClick={() => handlePublish(post.id)}
                      disabled={publishingIds.has(post.id) || post.status === "PUBLISHED"}
                      title={
                        post.status === "PUBLISHED" ? "Already published"
                          : publishingIds.has(post.id) ? "Publishing..."
                          : (post.mediaUrls ?? []).length === 0 ? "Publish (AI image)"
                          : "Publish to Instagram"
                      }
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        post.status === "PUBLISHED"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : publishingIds.has(post.id)
                          ? "bg-red-500/20 text-white"
                          : (post.mediaUrls ?? []).length === 0
                          ? "bg-purple-500/10 hover:bg-purple-500/20 text-purple-400/60 hover:text-purple-400"
                          : "bg-white/[0.04] hover:bg-green-500/20 text-white/40 hover:text-green-400"
                      }`}
                    >
                      {publishingIds.has(post.id)
                        ? <span className="w-3 h-3 rounded-full border-2 border-transparent border-t-white border-r-pink-300 animate-spin inline-block" />
                        : post.status === "PUBLISHED"
                        ? <CheckCircle size={12} />
                        : <Send size={12} />
                      }
                    </button>
                    <button
                      onClick={() => handleDelete(post.id)}
                      className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-red-500/20 flex items-center justify-center text-white/40 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page === 1}
            className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={14} />
          </button>

          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            // Simple windowed pagination
            let p: number;
            if (totalPages <= 7) {
              p = i + 1;
            } else if (page <= 4) {
              p = i + 1;
            } else if (page >= totalPages - 3) {
              p = totalPages - 6 + i;
            } else {
              p = page - 3 + i;
            }
            return (
              <button
                key={p}
                onClick={() => goToPage(p)}
                className={cn(
                  "w-8 h-8 rounded-lg text-xs font-medium transition-all",
                  page === p
                    ? "bg-gradient-to-r from-red-500 to-pink-500 text-white"
                    : "border border-white/[0.08] text-white/40 hover:text-white"
                )}
              >
                {p}
              </button>
            );
          })}

          <button
            onClick={() => goToPage(page + 1)}
            disabled={page === totalPages}
            className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* ── Preview Modal ── */}
      <AnimatePresence>
        {previewPost && (
          <PreviewModal
            post={previewPost}
            onClose={() => setPreviewPost(null)}
            onDelete={async (id) => { await handleDelete(id); setPreviewPost(null); }}
            onPublish={async (id) => { await handlePublish(id); setPreviewPost(null); }}
            onSchedule={(p) => setSchedulingPost(p)}
            isPublishing={publishingIds.has(previewPost.id)}
          />
        )}
      </AnimatePresence>

      {/* ── Schedule Modal ── */}
      <AnimatePresence>
        {schedulingPost && (
          <ScheduleModal
            post={schedulingPost}
            onClose={() => setSchedulingPost(null)}
            onScheduled={() => refetch()}
            brandId={brandId}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
