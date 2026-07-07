"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Plus, Clock, Calendar,
  List, X, Loader2, Trash2, Edit2, CheckCircle,
  AlertCircle, Zap, RefreshCw, Heart, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";
import { useSelectedBrand, withBrand } from "@/components/dashboard/useSelectedBrand";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScheduledPost {
  id:           string;
  title:        string;
  type?:        string;
  scheduledFor: string;
  status:       string;
  content?:     string;
  hashtags?:    string[];
}

interface DraftPost {
  id:           string;
  title:        string;
  type?:        string;
  content?:     string;
  hashtags?:    string[];
  scheduledFor?: string | null;
  status:       string;
}

// ─── Design constants ─────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  EDUCATIONAL:      "bg-blue-500/20 text-blue-300 border-blue-500/30",
  QUIZ:             "bg-brand/20 text-brand-light border-brand/30",
  CLINICAL_PEARL:   "bg-purple-500/20 text-purple-300 border-purple-500/30",
  MYTH_FACT:        "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  CASE_STUDY:       "bg-brand-light/20 text-brand-light border-brand-light/30",
  CAROUSEL:         "bg-orange-500/20 text-orange-300 border-orange-500/30",
  REEL:             "bg-teal-500/20 text-teal-300 border-teal-500/30",
  ECG_QUIZ:         "bg-brand/20 text-brand-light border-brand/30",
  ANGIOGRAPHY_QUIZ: "bg-brand-light/20 text-brand-light border-brand-light/30",
  PREVENTIVE:       "bg-green-500/20 text-green-300 border-green-500/30",
  CTA:              "bg-amber-500/20 text-amber-300 border-amber-500/30",
  STORY:            "bg-gradient-to-r from-fuchsia-500/20 to-orange-500/20 text-fuchsia-300 border-fuchsia-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  EDUCATIONAL:      "Educational",
  QUIZ:             "Quiz",
  CLINICAL_PEARL:   "Pro Tip",
  MYTH_FACT:        "Myth vs Fact",
  CASE_STUDY:       "Story / Example",
  CAROUSEL:         "Carousel",
  REEL:             "Reel",
  ECG_QUIZ:         "Knowledge Quiz",
  ANGIOGRAPHY_QUIZ: "Image Quiz",
  PREVENTIVE:       "How-To / Tips",
  CTA:              "Call to Action",
  STORY:            "📖 Story",
};

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
const IST = "Asia/Kolkata";
function fmt12(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, month: "short", day: "numeric", year: "numeric" });
}
/** Return YYYY-MM-DD in IST for a datetime string (used to pre-fill date input). */
function toISTDateInput(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts; // en-CA gives YYYY-MM-DD format
}
/** Return HH:MM in IST for a datetime string (used to pre-fill time input). */
function toISTTimeInput(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    PENDING:   { color: "text-blue-400 bg-blue-500/10 border-blue-500/20",    label: "Scheduled" },
    PUBLISHED: { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", label: "Published" },
    FAILED:    { color: "text-red-400 bg-red-500/10 border-red-500/20",       label: "Failed" },
    CANCELLED: { color: "text-white/30 bg-white/5 border-white/10",           label: "Cancelled" },
  };
  const s = map[status] ?? { color: "text-white/30 bg-white/5 border-white/10", label: status };
  return (
    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", s.color)}>
      {s.label}
    </span>
  );
}

// ─── Calendar cell ────────────────────────────────────────────────────────────
function CalendarCell({
  day, isToday, isCurrentMonth, posts, selected, onClick,
}: {
  day: number;
  isToday: boolean;
  isCurrentMonth: boolean;
  posts: ScheduledPost[];
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={cn(
        "min-h-[88px] p-2 rounded-xl border cursor-pointer transition-all",
        isToday     ? "border-brand/40 bg-brand/5"   : "border-white/[0.05] bg-white/[0.01]",
        selected    ? "ring-1 ring-brand/60"            : "",
        !isCurrentMonth ? "opacity-25 pointer-events-none" : "",
        "hover:border-white/[0.12] hover:bg-white/[0.025]"
      )}
    >
      {/* Day number */}
      <div className="flex items-center justify-between mb-1">
        <span className={cn(
          "text-xs font-semibold leading-none",
          isToday
            ? "w-5 h-5 rounded-full bg-gradient-to-br from-brand to-brand-light text-white flex items-center justify-center text-[10px]"
            : "text-white/40"
        )}>
          {day}
        </span>
        {posts.length > 0 && (
          <span className="text-[9px] text-white/30">{posts.length}</span>
        )}
      </div>

      {/* Post pills */}
      <div className="space-y-0.5">
        {posts.slice(0, 2).map((p) => (
          <div
            key={p.id}
            className={cn("px-1.5 py-0.5 rounded text-[8px] font-medium border truncate", TYPE_COLORS[p.type ?? ""] ?? "bg-white/5 text-white/50 border-white/10")}
          >
            {fmt12(p.scheduledFor)} {p.title.slice(0, 14)}...
          </div>
        ))}
        {posts.length > 2 && (
          <div className="text-[8px] text-white/25 px-1">+{posts.length - 2} more</div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Schedule Modal ───────────────────────────────────────────────────────────
function ScheduleModal({
  onClose,
  onSaved,
  editPost,
  drafts,
  brandId,
}: {
  onClose: () => void;
  onSaved: () => void;
  editPost?: ScheduledPost | null;
  drafts: DraftPost[];
  brandId: string;
}) {
  const isEdit = !!editPost;

  const [title,    setTitle]    = useState(editPost?.title   ?? "");
  const [type,     setType]     = useState(editPost?.type    ?? "POST"); // "POST" or "STORY"
  const [date,     setDate]     = useState(() => {
    if (editPost?.scheduledFor) {
      return toISTDateInput(editPost.scheduledFor);  // IST calendar date
    }
    // Default: tomorrow in IST
    const tmr = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return toISTDateInput(tmr.toISOString());
  });
  const [time,     setTime]     = useState(() => {
    if (editPost?.scheduledFor) {
      return toISTTimeInput(editPost.scheduledFor);  // IST wall-clock time
    }
    return "08:00";
  });
  const [content,  setContent]  = useState(editPost?.content ?? "");
  const [draftId,  setDraftId]  = useState<string>("");
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);

  // When a draft is chosen, populate fields from it
  const handleSelectDraft = (id: string) => {
    setDraftId(id);
    const d = drafts.find((x) => x.id === id);
    if (d) {
      setTitle(d.title);
      if (d.type) setType(d.type);
      if (d.content) setContent(d.content);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Enter a title"); return; }
    if (!date || !time) { toast.error("Pick a date and time"); return; }

    // Parse date+time as IST wall-clock time, then convert to UTC ISO string.
    // IST offset is always +05:30 (no DST).
    const scheduledFor = new Date(`${date}T${time}:00+05:30`).toISOString();
    if (isNaN(new Date(scheduledFor).getTime())) { toast.error("Invalid date or time"); return; }
    if (new Date(scheduledFor) <= new Date()) { toast.error("Schedule time must be in the future"); return; }

    setSaving(true);
    try {
      if (isEdit) {
        // Update existing scheduled post via PATCH
        const res  = await fetch(withBrand(`/api/scheduler/${editPost!.id}`, brandId), {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ title, scheduledFor, timezone: "Asia/Kolkata" }),
        });
        const data = await res.json();
        if (data.success) {
          toast.success("Schedule updated ✅");
          onSaved();
        } else {
          toast.error(data.error ?? "Update failed");
        }
      } else {
        // Create new scheduled post
        const body: Record<string, unknown> = {
          title,
          content:  content || (type === "STORY" ? title : `Post about ${title}`),
          scheduledFor,
          timezone: "Asia/Kolkata",
          hashtags: [],
          postType: type === "STORY" ? "STORY" : undefined,
        };
        if (draftId && type !== "STORY") body.postId = draftId;
        if (brandId) body.brand = brandId;

        const res  = await fetch("/api/scheduler", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) {
          toast.success("Post scheduled! 📅");
          onSaved();
        } else {
          toast.error(data.error ?? "Scheduling failed");
        }
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editPost || !window.confirm("Cancel this scheduled post?")) return;
    setDeleting(true);
    try {
      const res  = await fetch(withBrand(`/api/scheduler/${editPost.id}`, brandId), { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success("Scheduled post cancelled");
        onSaved();
      } else {
        toast.error(data.error ?? "Delete failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDeleting(false);
    }
  };

  const bestTimes = ["08:00","10:00","12:00","19:00","20:00"];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg z-50 rounded-2xl p-6"
        style={{
          background:     "rgba(13,13,20,0.98)",
          backdropFilter: "blur(30px)",
          border:         "1px solid rgba(255,255,255,0.1)",
          boxShadow:      "0 30px 80px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
            {isEdit ? "Edit Scheduled Post" : "Schedule New Post"}
          </h3>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center text-white/40 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4">

          {/* Post vs Story toggle */}
          {!isEdit && (
            <div>
              <label className="text-xs font-medium text-white/40 block mb-2 uppercase tracking-wider">
                Content Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "POST",  label: "📋 Regular Post",  desc: "Feed post (1:1 square)" },
                  { value: "STORY", label: "📖 Story",         desc: "Vertical card (9:16) • expires in 24h" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setType(opt.value)}
                    className={cn(
                      "px-4 py-3 rounded-xl border text-left transition-all",
                      type === opt.value
                        ? opt.value === "STORY"
                          ? "border-fuchsia-500/50 bg-fuchsia-500/10"
                          : "border-brand/50 bg-brand/10"
                        : "border-white/[0.08] hover:border-white/20"
                    )}
                  >
                    <div className={cn("text-sm font-semibold", type === opt.value ? (opt.value === "STORY" ? "text-fuchsia-300" : "text-brand-light") : "text-white/70")}>
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-white/30 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
              {type === "STORY" && (
                <p className="text-[11px] text-fuchsia-300/60 mt-2 flex items-center gap-1">
                  ✨ The story card will be auto-generated from your title + caption
                </p>
              )}
            </div>
          )}

          {/* Draft picker (only on create, only for regular posts) */}
          {!isEdit && type !== "STORY" && drafts.length > 0 && (
            <div>
              <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
                Link a Draft (optional)
              </label>
              <select
                value={draftId}
                onChange={(e) => handleSelectDraft(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <option value="" style={{ background: "#0d0d14" }}> -  Select a draft to schedule  - </option>
                {drafts.map((d) => (
                  <option key={d.id} value={d.id} style={{ background: "#0d0d14" }}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
              {type === "STORY" ? "Story Headline" : "Post Title"}
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === "STORY" ? "Short punchy headline (max 10 words)..." : "Enter post title..."}
              className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              onFocus={(e)  => { e.target.style.borderColor = type === "STORY" ? "rgba(217,70,239,0.5)" : "rgb(var(--accent-rgb) / 0.5)"; }}
              onBlur={(e)   => { e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}
            />
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
                Date
              </label>
              <input
                type="date"
                value={date}
                min={new Date().toISOString().slice(0,10)}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", colorScheme: "dark" }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
                Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none font-mono"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", colorScheme: "dark" }}
              />
            </div>
          </div>

          {/* Best time chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-white/30 flex items-center gap-1">
              <Sparkles size={10} className="text-yellow-400" />
              Best times:
            </span>
            {bestTimes.map((t) => (
              <button
                key={t}
                onClick={() => setTime(t)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-mono font-medium border transition-all",
                  time === t
                    ? "bg-yellow-500/15 border-yellow-500/30 text-yellow-400"
                    : "border-white/[0.08] text-white/35 hover:text-white/70 hover:border-white/20"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Content / Story body */}
          {!isEdit && !draftId && (
            <div>
              <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
                {type === "STORY" ? "Story Body (1–2 sentences)" : "Caption (optional)"}
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  type === "STORY"
                    ? "1–2 sentences of insight shown on the story card..."
                    : "Post caption  -  leave blank to fill later from content library..."
                }
                rows={type === "STORY" ? 2 : 3}
                className="w-full px-4 py-3 rounded-xl text-sm text-white/70 placeholder-white/20 outline-none resize-none"
                style={{
                  background:  "rgba(255,255,255,0.04)",
                  border:      `1px solid ${type === "STORY" ? "rgba(217,70,239,0.2)" : "rgba(255,255,255,0.08)"}`,
                }}
              />
              {type === "STORY" && (
                <p className="text-[10px] text-white/25 mt-1">
                  Max ~180 characters · The story card image will be generated automatically
                </p>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            {isEdit && (
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={handleDelete}
                disabled={deleting || saving}
                className="flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-medium text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all disabled:opacity-50"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Cancel Post
              </motion.button>
            )}
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-medium text-white/60 border border-white/[0.08] hover:border-white/[0.15] transition-all"
            >
              Discard
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-2-rgb)))" }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
              {saving ? "Saving..." : isEdit ? "Update" : "Schedule"}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SchedulerPage() {
  const { brandId, isAll, selected } = useSelectedBrand();
  const now     = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [allPosts,     setAllPosts]     = useState<ScheduledPost[]>([]);
  const [drafts,       setDrafts]       = useState<DraftPost[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [selectedDay,  setSelectedDay]  = useState<number | null>(now.getDate());
  const [showModal,    setShowModal]    = useState(false);
  const [editPost,     setEditPost]     = useState<ScheduledPost | null>(null);
  const [autoEnabled,  setAutoEnabled]  = useState(false);
  const [generating,   setGenerating]   = useState(false);

  // ── Load scheduled posts ──────────────────────────────────────────────────
  const loadPosts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const from = new Date(year, month, 1).toISOString();
      const to   = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      const res  = await fetch(withBrand(`/api/scheduler?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, brandId));
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.success) {
        const sp: ScheduledPost[] = (data.data.scheduledPosts ?? []).map((p: any) => ({
          id:           p.id,
          title:        p.title,
          // postType field on scheduled posts; fall back to linked post's type
          type:         p.postType ?? p.type ?? undefined,
          scheduledFor: p.scheduledFor,
          status:       p.status,
          content:      p.content,
          hashtags:     p.hashtags,
        }));
        const ds: ScheduledPost[] = (data.data.draftScheduled ?? []).map((p: any) => ({
          id:           p.id,
          title:        p.title,
          type:         p.type ?? undefined,
          scheduledFor: p.scheduledFor,
          status:       "PENDING",
          content:      p.content,
          hashtags:     p.hashtags,
        }));

        // Deduplicate: if a draftScheduled post has the exact same title + scheduledFor
        // as a ScheduledPost entry, it's the same post shown twice  -  drop the duplicate.
        const spKeys = new Set(sp.map((p) => `${p.title}|${p.scheduledFor}`));
        const dedupedDs = ds.filter((p) => !spKeys.has(`${p.title}|${p.scheduledFor}`));

        setAllPosts([...sp, ...dedupedDs]);
      } else {
        if (!silent) toast.error(data.error ?? "Could not load scheduled posts");
      }
    } catch (err) {
      if (!silent) toast.error("Could not reach scheduler  -  check your connection");
      console.error("[Scheduler] loadPosts error:", err);
    } finally {
      if (!silent) setLoading(false);
      else setLoading(false);
    }
  }, [year, month, brandId]);

  // ── Load drafts (for the "pick from draft" dropdown) ─────────────────────
  const loadDrafts = useCallback(async () => {
    try {
      const res  = await fetch(withBrand("/api/posts?status=DRAFT&limit=50", brandId));
      const data = await res.json();
      if (data.success) {
        setDrafts((data.data?.posts ?? []).map((p: any) => ({
          id:          p.id,
          title:       p.title,
          type:        p.type,
          content:     p.content,
          hashtags:    p.hashtags,
          scheduledFor:p.scheduledFor,
          status:      p.status,
        })));
      }
    } catch { /* ignore */ }
  }, [brandId]);

  // ── Load auto-post config ─────────────────────────────────────────────────
  const loadAutoConfig = useCallback(async () => {
    try {
      const res  = await fetch(withBrand("/api/settings/auto-post", brandId));
      const data = await res.json();
      if (data.success) setAutoEnabled(data.data.enabled ?? false);
    } catch { /* ignore */ }
  }, [brandId]);

  useEffect(() => {
    loadPosts();
    loadDrafts();
    loadAutoConfig();
  }, [loadPosts, loadDrafts, loadAutoConfig]);

  // ── Auto-refresh every 30s (silent  -  no spinner) ──────────────────────────
  useEffect(() => {
    const id = setInterval(() => loadPosts(true), 30_000);
    return () => clearInterval(id);
  }, [loadPosts]);

  // ── Calendar construction ─────────────────────────────────────────────────
  const daysInMonth   = getDaysInMonth(year, month);
  const firstDayOfWk  = getFirstDayOfMonth(year, month);
  const todayDay      = now.getFullYear() === year && now.getMonth() === month ? now.getDate() : -1;

  // prev-month trailing days
  const prevDaysCount = firstDayOfWk;
  const prevMonthDays = getDaysInMonth(year, month === 0 ? 11 : month - 1);

  const calendarCells: Array<{ day: number; isCurrentMonth: boolean }> = [
    ...Array.from({ length: prevDaysCount }, (_, i) => ({
      day: prevMonthDays - prevDaysCount + i + 1,
      isCurrentMonth: false,
    })),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      isCurrentMonth: true,
    })),
  ];
  // fill to full rows of 7
  const remainder = calendarCells.length % 7;
  if (remainder !== 0) {
    for (let i = 1; i <= 7 - remainder; i++) {
      calendarCells.push({ day: i, isCurrentMonth: false });
    }
  }

  const getPostsForDay = (day: number) =>
    allPosts.filter((p) => {
      const d = new Date(p.scheduledFor);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });

  const selectedPosts = selectedDay ? getPostsForDay(selectedDay) : [];

  // ── Month navigation ──────────────────────────────────────────────────────
  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else              { setMonth((m) => m - 1); }
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else               { setMonth((m) => m + 1); }
    setSelectedDay(null);
  };

  // ── Auto-generate trigger ─────────────────────────────────────────────────
  const handleAutoGenerate = async () => {
    setGenerating(true);
    const tid = toast.loading("Generating posts automatically...");
    try {
      const res  = await fetch("/api/auto-generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(brandId ? { brand: brandId } : {}),
      });
      const data = await res.json();
      if (data.success) {
        const n = data.data?.generated?.length ?? 0;
        toast.success(`${n} post${n !== 1 ? "s" : ""} generated and scheduled! 🎉`, { id: tid });
        loadPosts();
      } else {
        toast.error(data.error ?? "Auto-generation failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setGenerating(false);
    }
  };

  const panelStyle: React.CSSProperties = {
    background:     "rgb(var(--surface-rgb) / 0.85)",
    backdropFilter: "blur(20px)",
    border:         "1px solid rgba(255,255,255,0.07)",
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
          {isAll ? "All accounts" : selected?.label ?? "Primary"}
        </span>
      </div>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Month navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white hover:border-white/20 transition-all"
          >
            <ChevronLeft size={14} />
          </button>
          <h2 className="text-lg font-bold text-white min-w-[160px] text-center" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
            {MONTH_NAMES[month]} {year}
          </h2>
          <button
            onClick={nextMonth}
            className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white hover:border-white/20 transition-all"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => {
              setYear(now.getFullYear());
              setMonth(now.getMonth());
              setSelectedDay(now.getDate());
            }}
            className="text-xs text-white/40 hover:text-white/70 px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/20 transition-all"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-generate button (visible only if enabled) */}
          {autoEnabled && (
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={handleAutoGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white border border-emerald-500/30 hover:bg-emerald-500/10 transition-all disabled:opacity-50"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} className="text-emerald-400" />}
              {generating ? "Generating..." : "Auto-Generate"}
            </motion.button>
          )}
          {/* Refresh */}
          <motion.button
            whileHover={{ rotate: 180 }} transition={{ duration: 0.3 }}
            onClick={() => loadPosts()}
            disabled={loading}
            className="w-8 h-8 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white transition-all"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </motion.button>
          {/* Schedule new */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => { setEditPost(null); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-2-rgb)))", boxShadow: "0 0 20px rgb(var(--accent-rgb) / 0.3)" }}
          >
            <Plus size={14} />
            Schedule Post
          </motion.button>
        </div>
      </div>

      {/* ── Auto-post status banner ───────────────────────────────────────────── */}
      {autoEnabled && (
        <motion.div
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5"
        >
          <Zap size={14} className="text-emerald-400 flex-shrink-0" />
          <p className="text-sm text-emerald-300/80">
            <span className="font-semibold text-emerald-400">Auto-Post is active.</span>
            {" "}Posts are being generated automatically based on your schedule.

          </p>
        </motion.div>
      )}

      {/* ── Main grid ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">

        {/* ── Calendar ───────────────────────────────────────────────────────── */}
        <div className="rounded-2xl p-5" style={panelStyle}>
          {/* Calendar scrolls horizontally on small screens so all 7 columns stay legible */}
          <div className="overflow-x-auto -mx-2 px-2">
          <div className="min-w-[600px]">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-2">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center text-[11px] font-medium text-white/25 py-2">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {loading ? (
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-[88px] rounded-xl animate-pulse bg-white/[0.03]" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1.5">
              {calendarCells.map((cell, idx) => (
                <CalendarCell
                  key={idx}
                  day={cell.day}
                  isToday={cell.isCurrentMonth && cell.day === todayDay}
                  isCurrentMonth={cell.isCurrentMonth}
                  posts={cell.isCurrentMonth ? getPostsForDay(cell.day) : []}
                  selected={cell.isCurrentMonth && selectedDay === cell.day}
                  onClick={() => cell.isCurrentMonth && setSelectedDay(cell.day === selectedDay ? null : cell.day)}
                />
              ))}
            </div>
          )}
          </div>
          </div>

          {/* Legend */}
          <div className="mt-4 pt-4 border-t border-white/[0.05] flex flex-wrap gap-3">
            {[
              { type: "EDUCATIONAL",    label: "Educational" },
              { type: "QUIZ",           label: "Quiz" },
              { type: "CLINICAL_PEARL", label: "Pro Tip" },
              { type: "CAROUSEL",       label: "Carousel" },
            ].map(({ type, label }) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className={cn("w-2.5 h-2.5 rounded-sm border", TYPE_COLORS[type])} />
                <span className="text-[10px] text-white/30">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right panel: selected day detail + queue ────────────────────────── */}
        <div className="space-y-4">

          {/* Selected day detail */}
          <div className="rounded-2xl overflow-hidden" style={panelStyle}>
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-white/40" />
                <span className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
                  {selectedDay
                    ? `${MONTH_NAMES[month]} ${selectedDay}`
                    : "Select a day"}
                </span>
              </div>
              {selectedDay && (
                <span className="text-xs text-white/30">{selectedPosts.length} post{selectedPosts.length !== 1 ? "s" : ""}</span>
              )}
            </div>

            <div className="p-3 space-y-2 max-h-[260px] overflow-y-auto">
              {!selectedDay && (
                <p className="text-xs text-white/25 text-center py-6">Click a day on the calendar</p>
              )}
              {selectedDay && selectedPosts.length === 0 && (
                <div className="text-center py-6 space-y-2">
                  <p className="text-xs text-white/25">No posts scheduled</p>
                  <button
                    onClick={() => { setEditPost(null); setShowModal(true); }}
                    className="text-xs text-brand/70 hover:text-brand transition-colors underline underline-offset-2"
                  >
                    Schedule one
                  </button>
                </div>
              )}
              {selectedPosts.map((post) => (
                <motion.div
                  key={post.id}
                  whileHover={{ x: 2 }}
                  className="p-3 rounded-xl border border-white/[0.05] hover:border-white/[0.1] cursor-pointer transition-all"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                  onClick={() => { setEditPost(post); setShowModal(true); }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-xs font-medium text-white/80 leading-snug line-clamp-2 flex-1">
                      {post.title}
                    </p>
                    <Edit2 size={11} className="text-white/20 flex-shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center justify-between">
                    {post.type && (
                      <span className={cn("text-[9px] px-2 py-0.5 rounded-full border font-medium", TYPE_COLORS[post.type] ?? "bg-white/5 text-white/40 border-white/10")}>
                        {TYPE_LABELS[post.type] ?? post.type}
                      </span>
                    )}
                    <div className="flex items-center gap-1 text-[10px] text-white/30">
                      <Clock size={9} />
                      {fmt12(post.scheduledFor)}
                    </div>
                  </div>
                  <div className="mt-1.5">
                    <StatusBadge status={post.status} />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Upcoming queue */}
          <div className="rounded-2xl overflow-hidden" style={panelStyle}>
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <List size={14} className="text-white/40" />
              <span className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
                Upcoming
              </span>
              <span className="ml-auto text-xs text-white/30">
                {allPosts.filter((p) => p.status === "PENDING").length} pending
              </span>
            </div>

            <div className="p-3 space-y-2 max-h-[320px] overflow-y-auto">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl animate-pulse bg-white/[0.03]" />
                ))
              ) : allPosts.filter((p) => p.status === "PENDING").length === 0 ? (
                <p className="text-xs text-white/25 text-center py-6">No upcoming scheduled posts</p>
              ) : (
                allPosts
                  .filter((p) => p.status === "PENDING")
                  .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
                  .slice(0, 10)
                  .map((post, i) => (
                    <motion.div
                      key={post.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      whileHover={{ x: 2 }}
                      className="p-3 rounded-xl border border-white/[0.05] hover:border-white/[0.1] cursor-pointer transition-all"
                      style={{ background: "rgba(255,255,255,0.02)" }}
                      onClick={() => { setEditPost(post); setShowModal(true); }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-xs font-medium text-white/80 leading-snug line-clamp-1 flex-1">
                          {post.title}
                        </p>
                        <Edit2 size={11} className="text-white/20 flex-shrink-0 mt-0.5" />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        {post.type && (
                          <span className={cn("text-[9px] px-2 py-0.5 rounded-full border font-medium", TYPE_COLORS[post.type] ?? "bg-white/5 text-white/40 border-white/10")}>
                            {TYPE_LABELS[post.type] ?? post.type}
                          </span>
                        )}
                        <div className="flex items-center gap-1 text-[10px] text-white/30 ml-auto">
                          <Clock size={9} />
                          {fmtDate(post.scheduledFor)} {fmt12(post.scheduledFor)}
                        </div>
                      </div>
                    </motion.div>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Schedule Modal ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showModal && (
          <ScheduleModal
            onClose={() => { setShowModal(false); setEditPost(null); }}
            onSaved={() => { setShowModal(false); setEditPost(null); loadPosts(); }}
            editPost={editPost}
            drafts={drafts}
            brandId={brandId}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
