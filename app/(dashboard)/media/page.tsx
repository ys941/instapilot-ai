"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FolderOpen, Image, Film, FileVideo, Check,
  X, Send, Hash, Type, Tag, Loader2, ExternalLink,
  Trash2, ImagePlus, AlertCircle, Sparkles, Zap,
  TrendingUp, Calendar, Clock, Instagram, Youtube,
} from "lucide-react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { useSelectedBrand, ALL_BRANDS } from "@/components/dashboard/useSelectedBrand";

// ─── Post types ───────────────────────────────────────────────────────────────
const POST_TYPES = [
  { id: "EDUCATIONAL",      label: "Educational",     emoji: "📚" },
  { id: "QUIZ",             label: "Quiz",            emoji: "❓" },
  { id: "CAROUSEL",         label: "Carousel",        emoji: "🖼️" },
  { id: "MYTH_FACT",        label: "Myth vs Fact",    emoji: "⚖️" },
  { id: "CLINICAL_PEARL",   label: "Pro Tip",         emoji: "💎" },
  { id: "CASE_STUDY",       label: "Story / Example", emoji: "🔬" },
  { id: "ANGIOGRAPHY_QUIZ", label: "Image Quiz",      emoji: "🖼️" },
  { id: "ECG_QUIZ",         label: "Knowledge Quiz",  emoji: "📈" },
  { id: "PREVENTIVE",       label: "How-To / Tips",   emoji: "🛡️" },
  { id: "CTA",              label: "Call to Action",  emoji: "📣" },
  { id: "REEL",             label: "Reel",            emoji: "🎬" },
];

// ─── Queued file ──────────────────────────────────────────────────────────────
interface QueuedFile {
  id:           string;
  file:         File;
  preview:      string;
  isVideo:      boolean;
  title:        string;
  caption:      string;
  hashtags:     string;
  hashtagList:  string[];   // individual tags array
  postType:     string;
  /** For QUIZ/ECG_QUIZ/ANGIOGRAPHY_QUIZ: user-provided correct answer.
   *  Format: "<letter>|<full answer text>"  e.g. "B|Atrial Fibrillation with RVR"
   *  Stored in Post.reelScript as "QUIZ_ANS:..." — never appears in Instagram caption. */
  quizAnswer:   string;
  status:       "idle" | "uploading" | "done" | "error";
  error?:       string;
  postId?:      string;
  isScheduled?: boolean;
  scheduledAt?: string;    // ISO string of the scheduled post
}

function formatBytes(bytes: number) {
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Read a File as raw base64 (no "data:..." prefix) for Gemini vision.
 * Returns null if the file is too large to send inline:
 *   images  > 8 MB  → skip (Gemini inline limit ~20 MB, but keep it comfortable)
 *   videos  > 4 MB  → skip (large videos time-out)
 */
async function fileToBase64(file: File): Promise<{ data: string; mimeType: string } | null> {
  const isVideo   = file.type.startsWith("video/");
  // Gemini inline data limit: ~20 MB. Keep image headroom at 15 MB, video at 10 MB.
  const maxBytes  = isVideo ? 10 * 1024 * 1024 : 15 * 1024 * 1024;
  if (file.size > maxBytes) return null;          // too large → use text fallback

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;     // "data:image/jpeg;base64,/9j/..."
      const base64 = result.split(",")[1] ?? "";
      resolve(base64 ? { data: base64, mimeType: file.type } : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function formatReach(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

// Min datetime-local value = now + 5 minutes
function minScheduleValue() {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  // datetime-local requires "YYYY-MM-DDTHH:MM"
  return d.toISOString().slice(0, 16);
}

type Platform = "instagram" | "youtube" | "both";

const glassCard: React.CSSProperties = {
  background:     "rgb(var(--surface-rgb) / 0.8)",
  backdropFilter: "blur(20px)",
  border:         "1px solid rgba(255,255,255,0.07)",
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MediaFolderPage() {
  const router   = useRouter();
  const dropRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Selected brand (account) to publish to ──────────────────────────────────
  const { brandId: globalBrandId, brands } = useSelectedBrand();
  const primaryId = brands.find((b) => b.isPrimary)?.id ?? brands[0]?.id ?? "";
  // Account chosen in the publish/schedule modal. Defaults to the global
  // selection (never "all" — media publishes to ONE account).
  const [pubBrand, setPubBrand] = useState<string>("");
  const defaultPubBrand =
    globalBrandId && globalBrandId !== ALL_BRANDS ? globalBrandId : primaryId;

  const [queue,      setQueue]      = useState<QueuedFile[]>([]);
  const [dragging,   setDragging]   = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [selected,   setSelected]   = useState<string | null>(null);

  // Per-item AI loading states
  const [genCaption,  setGenCaption]  = useState<Record<string, boolean>>({});
  const [genHashtags, setGenHashtags] = useState<Record<string, boolean>>({});

  // Schedule state (per selected item stored in item itself, but edit via this local state)
  const [scheduleValue, setScheduleValue] = useState<string>("");

  // Platform picker modal. `intent` decides what happens on confirm:
  //   "schedule"     → upload with scheduledFor + chosen platform
  //   "publish"      → upload as draft then publish-now to chosen platform(s)
  const [platformModal, setPlatformModal] = useState<{
    item: QueuedFile;
    intent: "schedule" | "publish";
  } | null>(null);
  const [platformChoice, setPlatformChoice] = useState<Platform>("instagram");
  const [publishing, setPublishing] = useState(false);

  // ── Add files ──────────────────────────────────────────────────────────────
  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const newItems: QueuedFile[] = arr
      .filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"))
      .map((f) => ({
        id:          `${Date.now()}-${Math.random()}`,
        file:        f,
        preview:     URL.createObjectURL(f),
        isVideo:     f.type.startsWith("video/"),
        title:       f.name.replace(/\.[^.]+$/, ""),
        caption:     "",
        hashtags:    "",
        hashtagList: [],
        quizAnswer:  "",
        postType:    f.type.startsWith("video/") ? "REEL" : "EDUCATIONAL",
        status:      "idle",
      }));

    if (newItems.length === 0) { toast.error("Only image and video files are supported"); return; }
    setQueue((prev) => [...prev, ...newItems]);
    if (newItems.length > 0 && !selected) setSelected(newItems[0].id);
    toast.success(`${newItems.length} file${newItems.length > 1 ? "s" : ""} added`);
  }, [selected]);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop      = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); };

  // ── Update field ───────────────────────────────────────────────────────────
  const update = (id: string, patch: Partial<QueuedFile>) =>
    setQueue((prev) => prev.map((q) => q.id === id ? { ...q, ...patch } : q));

  // ── Remove ─────────────────────────────────────────────────────────────────
  const remove = (id: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((q) => q.id !== id);
    });
    if (selected === id) setSelected(null);
  };

  // ── AI: Generate caption (with Gemini vision if media fits inline) ──────────
  const generateCaption = async (item: QueuedFile) => {
    setGenCaption((p) => ({ ...p, [item.id]: true }));
    try {
      // Convert file to base64 so Gemini can actually SEE the image/video
      const mediaData = await fileToBase64(item.file);

      const res  = await fetch("/api/media/generate-caption", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          postType:    item.postType,
          title:       item.title,
          imageBase64: mediaData?.data     ?? undefined,
          mimeType:    mediaData?.mimeType ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        update(item.id, { caption: data.data.caption });
        const isVision = data.data.source === "gemini-vision";
        toast.success(isVision ? "Caption generated from your media! ✨" : "Caption generated! ✨");
      } else {
        toast.error(data.error ?? "Caption generation failed");
      }
    } catch {
      toast.error("Caption generation failed");
    } finally {
      setGenCaption((p) => ({ ...p, [item.id]: false }));
    }
  };

  // ── AI: Generate hashtags (3-4 high-engagement) ───────────────────────────
  const generateHashtags = async (item: QueuedFile) => {
    setGenHashtags((p) => ({ ...p, [item.id]: true }));
    try {
      const res  = await fetch("/api/media/generate-hashtags", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ postType: item.postType, title: item.title, caption: item.caption }),
      });
      const data = await res.json();
      if (data.success) {
        update(item.id, {
          hashtags:    data.data.hashtags,
          hashtagList: data.data.tags ?? [],
        });
        toast.success(`${data.data.count} hashtags ready — ~${formatReach(data.data.estimatedReach)} est. reach 🚀`);
      } else {
        toast.error(data.error ?? "Hashtag generation failed");
      }
    } catch {
      toast.error("Hashtag generation failed");
    } finally {
      setGenHashtags((p) => ({ ...p, [item.id]: false }));
    }
  };

  // ── Build FormData and POST to /api/upload ─────────────────────────────────
  const buildAndUpload = async (
    item: QueuedFile,
    scheduledFor?: string,
    platform: Platform = "instagram",
    brand?: string,
  ): Promise<string | null> => {
    // ── Auto-fill caption + hashtags if empty (so published post always has content) ──
    let finalCaption  = item.caption.trim();
    let finalHashtags = item.hashtags.trim();

    if (!finalCaption || !finalHashtags) {
      // Show a subtle loading indicator while we generate
      update(item.id, { status: "uploading" });

      if (!finalCaption) {
        try {
          // Send base64 so Gemini can analyse the actual media
          const mediaData = await fileToBase64(item.file);
          const r = await fetch("/api/media/generate-caption", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              postType:    item.postType,
              title:       item.title,
              imageBase64: mediaData?.data     ?? undefined,
              mimeType:    mediaData?.mimeType ?? undefined,
            }),
          });
          const d = await r.json();
          if (d.success && d.data?.caption) {
            finalCaption = d.data.caption;
            update(item.id, { caption: finalCaption });
          }
        } catch { /* best-effort */ }
      }

      if (!finalHashtags) {
        try {
          const r = await fetch("/api/media/generate-hashtags", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ postType: item.postType, title: item.title, caption: finalCaption }),
          });
          const d = await r.json();
          if (d.success && d.data?.hashtags) {
            finalHashtags = d.data.hashtags;
            update(item.id, { hashtags: finalHashtags, hashtagList: d.data.tags ?? [] });
          }
        } catch { /* best-effort */ }
      }
    }

    update(item.id, { status: "uploading" });
    try {
      // 1) Upload the file DIRECTLY to Cloudinary from the browser when possible.
      //    This bypasses the server's multipart body limit, so large videos
      //    (100 MB+) upload reliably instead of failing with
      //    "Failed to parse body as FormData".
      let mediaUrl: string | null = null;
      try {
        const cfg = await fetch("/api/upload").then((r) => r.json());
        if (cfg?.cloudName && cfg?.uploadPreset) {
          const isVideo = item.file.type.startsWith("video/");
          const cForm = new FormData();
          cForm.append("file", item.file);
          cForm.append("upload_preset", cfg.uploadPreset);
          cForm.append("folder", cfg.folder || "uploads");
          const cRes  = await fetch(
            `https://api.cloudinary.com/v1_1/${cfg.cloudName}/${isVideo ? "video" : "image"}/upload`,
            { method: "POST", body: cForm }
          );
          const cData = await cRes.json();
          if (cData.secure_url) mediaUrl = cData.secure_url as string;
          else throw new Error(cData.error?.message || "Cloud upload failed");
        }
      } catch (cloudErr: any) {
        // No Cloudinary config (or it errored) → fall back to the server multipart path.
        console.warn("Direct Cloudinary upload failed, falling back to server:", cloudErr?.message);
      }

      // 2) Register the post with our server.
      let res: Response;
      if (mediaUrl) {
        // Direct path: send ONLY the URL + metadata as small JSON.
        res = await fetch("/api/upload", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaUrl,
            fileName: item.file.name,
            fileType: item.file.type,
            title:    item.title || item.file.name,
            caption:  finalCaption,
            hashtags: finalHashtags,
            postType: item.postType,
            platform,
            ...(brand ? { brand } : {}),
            ...(scheduledFor ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
            ...(item.quizAnswer?.trim() ? { quizAnswer: item.quizAnswer.trim() } : {}),
          }),
        });
      } else {
        // Legacy fallback: stream the file through the server (small files only).
        const form = new FormData();
        form.append("file",     item.file);
        form.append("title",    item.title    || item.file.name);
        form.append("caption",  finalCaption);
        form.append("hashtags", finalHashtags);
        form.append("postType", item.postType);
        form.append("platform", platform);
        if (brand) form.append("brand", brand);
        if (scheduledFor) form.append("scheduledFor", new Date(scheduledFor).toISOString());
        // Quiz answer (optional — stored internally, never shown in the post caption)
        if (item.quizAnswer?.trim()) form.append("quizAnswer", item.quizAnswer.trim());
        res = await fetch("/api/upload", { method: "POST", body: form });
      }

      const data = await res.json();
      if (data.success) {
        update(item.id, {
          status:      "done",
          postId:      data.data.post.id,
          isScheduled: !!scheduledFor,
          scheduledAt: scheduledFor ?? undefined,
        });
        return data.data.post.id as string;
      } else {
        update(item.id, { status: "error", error: data.error });
        return null;
      }
    } catch (err: any) {
      update(item.id, { status: "error", error: err?.message ?? "Upload failed" });
      return null;
    }
  };

  // ── Upload all idle to library ─────────────────────────────────────────────
  const uploadAll = async () => {
    const pending = queue.filter((q) => q.status === "idle");
    if (pending.length === 0) { toast("Nothing to upload — all done or failed"); return; }
    setUploading(true);
    await Promise.all(pending.map((item) => buildAndUpload(item)));
    setUploading(false);
    toast.success(`${pending.length} file${pending.length > 1 ? "s" : ""} added to Content Library! 🎉`);
  };

  // ── Open the platform picker for the Schedule flow ─────────────────────────
  const scheduleSelected = () => {
    if (!selectedItem) return;
    if (!scheduleValue) { toast.error("Please pick a date and time first"); return; }
    const picked = new Date(scheduleValue);
    if (picked <= new Date()) { toast.error("Scheduled time must be in the future"); return; }
    setPlatformChoice("instagram");
    setPubBrand(defaultPubBrand);
    setPlatformModal({ item: selectedItem, intent: "schedule" });
  };

  // ── Open the platform picker for the Publish-now flow ──────────────────────
  const publishSelected = () => {
    if (!selectedItem) return;
    setPlatformChoice("instagram");
    setPubBrand(defaultPubBrand);
    setPlatformModal({ item: selectedItem, intent: "publish" });
  };

  // ── Publish an already-uploaded media post to the chosen platform(s) ───────
  // Instagram (and the IG half of "both") reuses the existing /api/posts/[id]/publish
  // route — Instagram behavior is unchanged. YouTube uses the media-specific route
  // that turns the actual uploaded image→Short / video→direct upload.
  const publishMediaPost = async (postId: string, platform: Platform, brand?: string): Promise<void> => {
    if (platform === "instagram" || platform === "both") {
      const res  = await fetch(`/api/posts/${postId}/publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ platform: "instagram", ...(brand && { brand }) }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Instagram publish failed");
    }
    if (platform === "youtube" || platform === "both") {
      const ytUrl = brand ? `/api/media/${postId}/publish-youtube?brand=${encodeURIComponent(brand)}` : `/api/media/${postId}/publish-youtube`;
      const res  = await fetch(ytUrl, { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        // For "both", the Instagram post is already live — surface YouTube failure
        // without claiming the whole publish failed.
        if (platform === "both") {
          toast.error(`Published to Instagram, but YouTube failed: ${data.error}`);
          return;
        }
        throw new Error(data.error ?? "YouTube publish failed");
      }
    }
  };

  // ── Confirm handler for the platform picker modal ──────────────────────────
  const confirmPlatform = async () => {
    if (!platformModal) return;
    const { item, intent } = platformModal;
    const platform = platformChoice;
    // REQUIRE an account when more than one exists.
    const brand = pubBrand || defaultPubBrand;
    if (brands.length > 1 && !brand) {
      toast.error("Please choose which account to publish to");
      return;
    }

    if (intent === "schedule") {
      const picked = new Date(scheduleValue);
      setPlatformModal(null);
      await buildAndUpload(item, scheduleValue, platform, brand);
      const label = picked.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
      const where =
        platform === "both" ? "Instagram + YouTube"
        : platform === "youtube" ? "YouTube" : "Instagram";
      toast.success(`Scheduled to ${where} for ${label} ✅`);
      return;
    }

    // intent === "publish": upload as a draft first, then publish now.
    setPublishing(true);
    try {
      const postId = item.postId ?? (await buildAndUpload(item, undefined, platform, brand));
      if (!postId) { toast.error("Upload failed — cannot publish"); return; }
      const t = toast.loading("Publishing...");
      try {
        await publishMediaPost(postId, platform, brand);
        const where =
          platform === "both" ? "Instagram + YouTube"
          : platform === "youtube" ? "YouTube" : "Instagram";
        toast.success(`Published to ${where}! 🎉`, { id: t });
        update(item.id, { status: "done" });
      } catch (err: any) {
        toast.error(err?.message ?? "Publish failed", { id: t });
        update(item.id, { status: "error", error: err?.message });
      }
    } finally {
      setPublishing(false);
      setPlatformModal(null);
    }
  };

  const selectedItem = queue.find((q) => q.id === selected);
  const doneCount    = queue.filter((q) => q.status === "done").length;
  const idleCount    = queue.filter((q) => q.status === "idle").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="max-w-7xl mx-auto space-y-6"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
            <FolderOpen size={22} className="text-brand" />
            Media Folder
          </h2>
          <p className="text-xs text-white/40 mt-0.5">Upload · AI Caption · AI Hashtags · Schedule to Instagram &amp; YouTube</p>
        </div>
        <div className="flex items-center gap-3">
          {doneCount > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => router.push("/content-library")}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10 transition-all"
            >
              <ExternalLink size={12} />
              View in Library ({doneCount})
            </motion.button>
          )}
          {idleCount > 0 && (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={uploadAll}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-2-rgb)), #9333ea)" }}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {uploading ? "Uploading..." : `Save ${idleCount} to Library`}
            </motion.button>
          )}
        </div>
      </div>

      {/* Capability chips — shown when empty */}
      {queue.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: Sparkles,   color: "from-purple-500/20 to-pink-500/20",    border: "border-purple-500/20",  text: "text-purple-400",  label: "AI Caption",   desc: "Instant viral Instagram captions" },
            { icon: Zap,        color: "from-blue-500/20 to-cyan-500/20",      border: "border-blue-500/20",    text: "text-blue-400",    label: "4 Top Hashtags", desc: "High-reach tags, no clutter" },
            { icon: Calendar,   color: "from-emerald-500/20 to-teal-500/20",   border: "border-emerald-500/20", text: "text-emerald-400", label: "Direct Schedule", desc: "Pick time & post, no extra steps" },
          ].map(({ icon: Icon, color, border, text, label, desc }) => (
            <div key={label} className={`rounded-xl p-4 flex items-center gap-3 bg-gradient-to-r ${color} border ${border}`}>
              <Icon size={20} className={text} />
              <div>
                <p className={`text-sm font-semibold ${text}`}>{label}</p>
                <p className="text-xs text-white/40">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
        {/* ── Left: Drop zone + queue ── */}
        <div className="space-y-4 order-2 lg:order-1">
          {/* Drop zone */}
          <motion.div
            ref={dropRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            animate={{ borderColor: dragging ? "rgb(var(--accent-rgb) / 0.6)" : "rgba(255,255,255,0.1)", scale: dragging ? 1.01 : 1 }}
            className="relative rounded-2xl border-2 border-dashed cursor-pointer transition-colors"
            style={{ background: dragging ? "rgb(var(--accent-rgb) / 0.05)" : "rgb(var(--surface-rgb) / 0.6)", minHeight: 200 }}
          >
            <input ref={inputRef} type="file" multiple accept="image/*,video/*" className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <div className="flex flex-col items-center justify-center py-14 gap-4">
              <motion.div
                animate={{ y: dragging ? -8 : 0 }}
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "rgb(var(--accent-rgb) / 0.1)", border: "1px solid rgb(var(--accent-rgb) / 0.2)" }}
              >
                {dragging ? <ImagePlus size={28} className="text-brand" /> : <Upload size={28} className="text-brand" />}
              </motion.div>
              <div className="text-center">
                <p className="text-white/70 font-medium text-sm">{dragging ? "Drop files here" : "Drag & drop or click to browse"}</p>
                <p className="text-white/30 text-xs mt-1">JPG · PNG · WebP · GIF · MP4 · MOV · WebM — up to 100 MB each</p>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-white/25">
                <span className="flex items-center gap-1"><Image size={10} /> Images</span>
                <span className="w-px h-3 bg-white/10" />
                <span className="flex items-center gap-1"><Film size={10} /> Videos</span>
                <span className="w-px h-3 bg-white/10" />
                <span className="flex items-center gap-1"><FileVideo size={10} /> Reels</span>
              </div>
            </div>
          </motion.div>

          {/* Queue grid */}
          <AnimatePresence>
            {queue.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {queue.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={() => setSelected(item.id)}
                    className="relative rounded-xl overflow-hidden cursor-pointer group"
                    style={{
                      border: selected === item.id ? "2px solid rgb(var(--accent-rgb) / 0.7)" : "2px solid rgba(255,255,255,0.06)",
                      aspectRatio: "1 / 1",
                    }}
                  >
                    {item.isVideo
                      ? <video src={item.preview} className="w-full h-full object-cover" muted />
                      : <img src={item.preview} alt={item.title} className="w-full h-full object-cover" />} {/* eslint-disable-line */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    <div className="absolute top-2 left-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: "rgba(0,0,0,0.6)", color: "rgba(255,255,255,0.8)" }}>
                        {item.isVideo ? "VIDEO" : "IMAGE"}
                      </span>
                    </div>
                    <div className="absolute top-2 right-2">
                      {item.status === "done" && item.isScheduled && (
                        <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center" title="Scheduled">
                          <Calendar size={10} className="text-white" />
                        </div>
                      )}
                      {item.status === "done" && !item.isScheduled && (
                        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><Check size={10} className="text-white" /></div>
                      )}
                      {item.status === "uploading" && <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center"><Loader2 size={10} className="text-white animate-spin" /></div>}
                      {item.status === "error"     && <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"><X size={10} className="text-white" /></div>}
                    </div>
                    {/* AI + schedule badges */}
                    {(item.caption || item.hashtags || item.isScheduled) && (
                      <div className="absolute bottom-8 left-2 flex gap-1 flex-wrap">
                        {item.caption    && <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/60 text-white font-medium">AI Caption</span>}
                        {item.hashtags   && <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/60 text-white font-medium"># Tags</span>}
                        {item.isScheduled && <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/60 text-white font-medium">Scheduled</span>}
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 px-2 pb-2">
                      <p className="text-[10px] text-white/80 truncate">{item.title || item.file.name}</p>
                      <p className="text-[9px] text-white/40">{formatBytes(item.file.size)}</p>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); remove(item.id); }}
                      className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-8 h-8 rounded-full bg-red-500/80 flex items-center justify-center">
                        <Trash2 size={14} className="text-white" />
                      </div>
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right: Edit + Schedule panel ── */}
        <div className="space-y-4 order-1 lg:order-2">
          <AnimatePresence mode="wait">
            {selectedItem ? (
              <motion.div
                key={selectedItem.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl p-5 space-y-4"
                style={glassCard}
              >
                {/* Preview */}
                <div className="rounded-xl overflow-hidden" style={{ aspectRatio: "1 / 1" }}>
                  {selectedItem.isVideo
                    ? <video src={selectedItem.preview} controls className="w-full h-full object-cover" />
                    : <img src={selectedItem.preview} alt={selectedItem.title} className="w-full h-full object-cover" />} {/* eslint-disable-line */}
                </div>
                <p className="text-[10px] text-white/30 text-center">{selectedItem.file.name} · {formatBytes(selectedItem.file.size)}</p>

                {/* Status banners */}
                {selectedItem.status === "done" && selectedItem.isScheduled && selectedItem.scheduledAt && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <Calendar size={13} className="text-blue-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-blue-400 font-medium">Scheduled!</p>
                      <p className="text-[10px] text-blue-400/60 truncate">
                        {new Date(selectedItem.scheduledAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </div>
                    <button onClick={() => router.push("/scheduler")} className="text-[10px] text-blue-400/70 hover:text-blue-400 underline flex-shrink-0">View</button>
                  </div>
                )}
                {selectedItem.status === "done" && !selectedItem.isScheduled && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <Check size={13} className="text-emerald-400" />
                    <span className="text-xs text-emerald-400">Saved to Content Library!</span>
                    <button onClick={() => router.push("/content-library")} className="ml-auto text-[10px] text-emerald-400/70 hover:text-emerald-400 underline">View</button>
                  </div>
                )}
                {selectedItem.status === "error" && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                    <AlertCircle size={13} className="text-red-400" />
                    <span className="text-xs text-red-400 truncate">{selectedItem.error}</span>
                  </div>
                )}

                {selectedItem.status !== "done" && (
                  <>
                    {/* Title */}
                    <div>
                      <label className="flex items-center gap-1.5 text-[10px] text-white/40 uppercase tracking-wider mb-1.5">
                        <Type size={10} /> Title
                      </label>
                      <input
                        type="text"
                        value={selectedItem.title}
                        onChange={(e) => update(selectedItem.id, { title: e.target.value })}
                        placeholder="Post title..."
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-brand/40 transition-all"
                      />
                    </div>

                    {/* Post type */}
                    <div>
                      <label className="flex items-center gap-1.5 text-[10px] text-white/40 uppercase tracking-wider mb-1.5">
                        <Tag size={10} /> Post Type
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {POST_TYPES.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => update(selectedItem.id, { postType: t.id })}
                            className={`text-[10px] py-1.5 px-1 rounded-lg border transition-all font-medium ${
                              selectedItem.postType === t.id
                                ? "bg-brand/20 border-brand/30 text-white"
                                : "border-white/[0.06] text-white/40 hover:text-white/70"
                            }`}
                          >
                            {t.emoji} {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ── Caption ── */}
                    <div>
                      <label className="flex items-center gap-1.5 text-[10px] text-white/40 uppercase tracking-wider mb-1.5">
                        <Type size={10} /> Caption
                      </label>
                      <motion.button
                        whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                        onClick={() => generateCaption(selectedItem)}
                        disabled={genCaption[selectedItem.id]}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold mb-2 transition-all disabled:opacity-50"
                        style={{
                          background: "linear-gradient(135deg, rgba(139,92,246,0.45), rgba(236,72,153,0.45))",
                          border: "1px solid rgba(139,92,246,0.6)",
                          color: "#e879f9",
                          boxShadow: genCaption[selectedItem.id] ? "none" : "0 0 16px rgba(139,92,246,0.2)",
                        }}
                      >
                        {genCaption[selectedItem.id]
                          ? <><Loader2 size={13} className="animate-spin" /> Generating Caption...</>
                          : <><Sparkles size={13} /> ✨ AI Generate Caption</>}
                      </motion.button>
                      <textarea
                        value={selectedItem.caption}
                        onChange={(e) => update(selectedItem.id, { caption: e.target.value })}
                        placeholder="Caption will appear here after AI generation, or type manually..."
                        rows={5}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-brand/40 transition-all resize-none"
                      />
                      {selectedItem.caption && (
                        <p className="text-[9px] text-white/25 mt-1 text-right">{selectedItem.caption.length} chars</p>
                      )}
                    </div>

                    {/* ── Hashtags (3-4 tags) ── */}
                    <div>
                      <label className="flex items-center gap-1.5 text-[10px] text-white/40 uppercase tracking-wider mb-1.5">
                        <Hash size={10} /> Hashtags
                        <span className="ml-auto text-[9px] text-white/20 font-normal normal-case tracking-normal">3-4 high-reach tags</span>
                      </label>
                      <motion.button
                        whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                        onClick={() => generateHashtags(selectedItem)}
                        disabled={genHashtags[selectedItem.id]}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold mb-2 transition-all disabled:opacity-50"
                        style={{
                          background: "linear-gradient(135deg, rgba(59,130,246,0.45), rgba(16,185,129,0.45))",
                          border: "1px solid rgba(59,130,246,0.6)",
                          color: "#67e8f9",
                          boxShadow: genHashtags[selectedItem.id] ? "none" : "0 0 16px rgba(59,130,246,0.2)",
                        }}
                      >
                        {genHashtags[selectedItem.id]
                          ? <><Loader2 size={13} className="animate-spin" /> Researching...</>
                          : <><Zap size={13} /> ⚡ AI Research Top 4 Hashtags</>}
                      </motion.button>

                      {/* Tag pills display */}
                      {selectedItem.hashtagList.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {selectedItem.hashtagList.map((tag) => (
                              <span
                                key={tag}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-mono font-medium"
                                style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#67e8f9" }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/70">
                            <TrendingUp size={9} />
                            <span>~12.5M+ combined reach</span>
                            <span className="text-white/20">·</span>
                            <span className="text-white/40">{selectedItem.hashtagList.length} focused tags</span>
                          </div>
                          {/* Edit raw */}
                          <textarea
                            value={selectedItem.hashtags}
                            onChange={(e) => update(selectedItem.id, { hashtags: e.target.value, hashtagList: e.target.value.trim().split(/\s+/).filter(Boolean) })}
                            rows={2}
                            className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white/50 placeholder-white/20 outline-none focus:border-brand/30 transition-all resize-none font-mono"
                            placeholder="Edit hashtags..."
                          />
                        </div>
                      ) : (
                        <textarea
                          value={selectedItem.hashtags}
                          onChange={(e) => update(selectedItem.id, { hashtags: e.target.value })}
                          placeholder="#yourtopic #yourniche... or click AI Research"
                          rows={2}
                          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-brand/40 transition-all resize-none font-mono"
                        />
                      )}
                    </div>

                    {/* ── Quiz Answer (shown only for quiz post types) ── */}
                    {["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(selectedItem.postType) && (
                      <div
                        className="rounded-xl p-3 space-y-2"
                        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">✅ Correct Answer</span>
                          <span className="text-[9px] text-white/30 ml-auto normal-case font-normal tracking-normal">Optional — helps AI reply accurately</span>
                        </div>
                        <p className="text-[10px] text-white/40 leading-relaxed">
                          Provide the correct answer so the AI can give accurate quiz replies to comments.
                          Format: <code className="text-amber-300/70 bg-amber-900/20 px-1 rounded">B|Atrial Fibrillation with RVR</code>
                        </p>
                        <input
                          type="text"
                          value={selectedItem.quizAnswer}
                          onChange={(e) => update(selectedItem.id, { quizAnswer: e.target.value })}
                          placeholder="e.g. B|Atrial Fibrillation with RVR"
                          className="w-full bg-white/[0.04] border border-amber-500/20 rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-amber-500/40 transition-all"
                        />
                        {selectedItem.quizAnswer && (
                          <p className="text-[9px] text-amber-400/60">
                            Answer saved internally — will NOT appear in the Instagram caption.
                          </p>
                        )}
                      </div>
                    )}

                    {/* ── Quick-gen both ── */}
                    <motion.button
                      whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                      onClick={async () => {
                        await generateCaption(selectedItem);
                        await generateHashtags({ ...selectedItem, caption: queue.find(q => q.id === selectedItem.id)?.caption ?? selectedItem.caption });
                      }}
                      disabled={genCaption[selectedItem.id] || genHashtags[selectedItem.id]}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50"
                      style={{
                        background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(59,130,246,0.25))",
                        border: "1px solid rgba(139,92,246,0.3)",
                      }}
                    >
                      {(genCaption[selectedItem.id] || genHashtags[selectedItem.id])
                        ? <><Loader2 size={12} className="animate-spin" /> Generating with AI...</>
                        : <><Sparkles size={12} /> Generate Caption + Top Hashtags</>}
                    </motion.button>

                    {/* ── SCHEDULE SECTION ─────────────────────────────────────── */}
                    <div
                      className="rounded-xl p-3.5 space-y-3"
                      style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}
                    >
                      <div className="flex items-center gap-2">
                        <Calendar size={13} className="text-emerald-400" />
                        <span className="text-xs font-semibold text-emerald-400">Schedule Post</span>
                        <span className="text-[10px] text-white/30 ml-auto">original media · no card conversion</span>
                      </div>

                      {/* Date + Time row */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="flex items-center gap-1 text-[9px] text-white/30 uppercase tracking-wider mb-1">
                            <Calendar size={8} /> Date &amp; Time
                          </label>
                          <input
                            type="datetime-local"
                            value={scheduleValue}
                            min={minScheduleValue()}
                            onChange={(e) => setScheduleValue(e.target.value)}
                            className="w-full bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/50 transition-all"
                            style={{ colorScheme: "dark" }}
                          />
                        </div>
                      </div>

                      {/* Schedule button */}
                      <motion.button
                        whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                        onClick={scheduleSelected}
                        disabled={selectedItem.status === "uploading" || !scheduleValue}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                        style={{
                          background: scheduleValue
                            ? "linear-gradient(135deg, rgba(16,185,129,0.7), rgba(5,150,105,0.7))"
                            : "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(16,185,129,0.4)",
                        }}
                      >
                        {selectedItem.status === "uploading"
                          ? <><Loader2 size={14} className="animate-spin" /> Scheduling...</>
                          : <><Clock size={14} /> {scheduleValue ? `Schedule for ${new Date(scheduleValue).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Pick a time above"}</>}
                      </motion.button>
                    </div>

                    {/* ── PUBLISH NOW ──────────────────────────────────────────── */}
                    <motion.button
                      whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                      onClick={publishSelected}
                      disabled={selectedItem.status === "uploading" || publishing}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-3-rgb)))", border: "1px solid rgb(var(--accent-rgb) / 0.5)" }}
                    >
                      {publishing
                        ? <><Loader2 size={14} className="animate-spin" /> Publishing...</>
                        : <><Send size={14} /> Publish Now</>}
                    </motion.button>

                    {/* ── Save to Library (draft) ── */}
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-px bg-white/[0.05]" />
                      <span className="text-[10px] text-white/20">or</span>
                      <div className="flex-1 h-px bg-white/[0.05]" />
                    </div>
                    <button
                      onClick={() => buildAndUpload(selectedItem)}
                      disabled={selectedItem.status === "uploading"}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
                      style={{ background: "linear-gradient(135deg, rgb(var(--accent-rgb) / 0.6), rgb(var(--accent-2-rgb) / 0.6))", border: "1px solid rgb(var(--accent-rgb) / 0.3)" }}
                    >
                      {selectedItem.status === "uploading"
                        ? <><Loader2 size={14} className="animate-spin" /> Saving...</>
                        : <><Send size={14} /> Save to Library (Draft)</>}
                    </button>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-2xl p-8 flex flex-col items-center justify-center gap-5 text-center"
                style={{ ...glassCard, minHeight: 300 }}
              >
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(16,185,129,0.12))", border: "1px solid rgba(139,92,246,0.2)" }}
                >
                  <Calendar size={32} className="text-emerald-400/70" />
                </div>
                <div>
                  <p className="text-white/70 text-sm font-semibold" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
                    Upload · AI · Schedule
                  </p>
                  <p className="text-white/30 text-xs mt-1.5 leading-relaxed">
                    Upload your image or video,<br />
                    generate AI caption + 4 top hashtags,<br />
                    then schedule to Instagram or YouTube
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {["✨ AI Caption", "⚡ 4 Hashtags", "📅 Direct Schedule"].map((f) => (
                    <span key={f} className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-white/40 bg-white/[0.03]">{f}</span>
                  ))}
                </div>
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => inputRef.current?.click()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(16,185,129,0.3))", border: "1px solid rgba(139,92,246,0.3)" }}
                >
                  <Upload size={14} />
                  Upload media to get started
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* How it works */}
          <div className="rounded-2xl p-4 space-y-3" style={glassCard}>
            <p className="text-xs font-semibold text-white/60" style={{ fontFamily: "var(--font-sora), sans-serif" }}>How it works</p>
            {[
              { icon: Upload,   text: "Drop or pick your image/video (kept as-is, no card conversion)" },
              { icon: Sparkles, text: "AI generates a viral caption for your post" },
              { icon: Zap,      text: "AI picks 3–4 focused high-reach hashtags" },
              { icon: Calendar, text: "Pick a date & time → Schedule to Instagram or YouTube" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
                  <Icon size={11} className="text-brand" />
                </div>
                <p className="text-xs text-white/40">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Platform picker modal (Instagram / YouTube / Both) ─────────────────── */}
      <AnimatePresence>
        {platformModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !publishing && setPlatformModal(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl p-6 space-y-5"
              style={glassCard}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white" style={{ fontFamily: "var(--font-sora), sans-serif" }}>
                    {platformModal.intent === "schedule" ? "Schedule to" : "Publish to"}
                  </h3>
                  <p className="text-[11px] text-white/40 mt-0.5">Choose where this media goes</p>
                </div>
                <button
                  onClick={() => !publishing && setPlatformModal(null)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Account (brand) picker — REQUIRED when multiple accounts exist */}
              {brands.length > 1 && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    Account
                  </label>
                  <select
                    value={pubBrand}
                    onChange={(e) => setPubBrand(e.target.value)}
                    className="mt-1.5 w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none appearance-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    {brands.map((b) => (
                      <option key={b.id} value={b.id} className="bg-[#11111a] text-white">
                        {b.label}{b.isPrimary ? " (Primary)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2.5">
                {([
                  { id: "instagram", label: "Instagram", desc: "Post or Reel to your IG feed", icon: Instagram },
                  { id: "youtube",   label: "YouTube",   desc: "Video → Short · Image → vertical Short", icon: Youtube },
                  { id: "both",      label: "Both",      desc: "Publish to Instagram and YouTube", icon: Send },
                ] as { id: Platform; label: string; desc: string; icon: typeof Instagram }[]).map(({ id, label, desc, icon: Icon }) => {
                  const active = platformChoice === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setPlatformChoice(id)}
                      className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all text-left"
                      style={{
                        background: active ? "rgb(var(--accent-rgb) / 0.12)" : "rgba(255,255,255,0.03)",
                        borderColor: active ? "rgb(var(--accent-rgb) / 0.5)" : "rgba(255,255,255,0.07)",
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: active ? "rgb(var(--accent-rgb) / 0.2)" : "rgba(255,255,255,0.05)" }}
                      >
                        <Icon size={17} className={active ? "text-brand" : "text-white/50"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${active ? "text-white" : "text-white/70"}`}>{label}</p>
                        <p className="text-[10px] text-white/35 truncate">{desc}</p>
                      </div>
                      {active && (
                        <div className="w-5 h-5 rounded-full bg-brand flex items-center justify-center flex-shrink-0">
                          <Check size={11} className="text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Confirm */}
              <motion.button
                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                onClick={confirmPlatform}
                disabled={publishing}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-3-rgb)))", border: "1px solid rgb(var(--accent-rgb) / 0.5)" }}
              >
                {publishing
                  ? <><Loader2 size={14} className="animate-spin" /> Working...</>
                  : platformModal.intent === "schedule"
                    ? <><Clock size={14} /> Confirm Schedule</>
                    : <><Send size={14} /> Confirm Publish</>}
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
