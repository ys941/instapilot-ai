"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Copy,
  Save,
  Calendar,
  Send,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Hash,
  ImageIcon,
  Play,
  Loader2,
  Target,
  Check,
  Smartphone,
  FileText,
  Heart,
  Zap,
  Instagram,
  Youtube,
} from "lucide-react";
import toast from "react-hot-toast";
import InstagramPostPreview from "@/components/ui/InstagramPostPreview";
import PostVisualCard from "@/components/ui/PostVisualCard";
import { useSelectedBrand, withBrand, ALL_BRANDS } from "@/components/dashboard/useSelectedBrand";
import { useBrand } from "@/components/BrandContext";

// ─── Types ────────────────────────────────────────────────────
interface GeneratedContent {
  title: string;
  hook: string;
  content: string;
  cta: string;
  hashtags: string[];
  imagePrompt: string;
  reelScript?: string;
  viralScore: number;
  engagementPrediction?: string;
  postType?: string;
}

// ─── Post types ───────────────────────────────────────────────
const postTypes = [
  { id: "EDUCATIONAL",      label: "Educational",     emoji: "📚" },
  { id: "QUIZ",             label: "Quiz",            emoji: "❓" },
  { id: "CAROUSEL",         label: "Carousel",        emoji: "🖼️" },
  { id: "MYTH_FACT",        label: "Myth vs Fact",    emoji: "⚖️" },
  { id: "CLINICAL_PEARL",   label: "Pro Tip",         emoji: "💎" },
  { id: "CASE_STUDY",       label: "Story / Example", emoji: "🔬" },
  { id: "ANGIOGRAPHY_QUIZ", label: "Image Quiz",      emoji: "🖼️" }, // must match API enum
  { id: "ECG_QUIZ",         label: "Knowledge Quiz",  emoji: "📈" },
  { id: "PREVENTIVE",       label: "How-To / Tips",   emoji: "🛡️" },
  { id: "CTA",              label: "Call to Action",  emoji: "📣" },
  { id: "REEL",             label: "Reel Script",     emoji: "🎬" },
];

// Map each content type to a platform-appropriate label.
// "Shorts" is just the YouTube framing of the vertical video (REEL) output.
function postTypeLabel(id: string, fallback: string, platform: Platform): string {
  if ((platform === "youtube" || platform === "both") && id === "REEL") return "Short";
  return fallback;
}

// ─── Platforms ────────────────────────────────────────────────
type Platform = "instagram" | "youtube" | "both";

const tones = [
  { id: "professional",   label: "Professional" },
  { id: "engaging",       label: "Engaging" },
  { id: "educational",    label: "Educational" },
  { id: "conversational", label: "Conversational" }, // was "casual"  -  must match API enum
  { id: "authoritative",  label: "Authoritative" },  // was "urgent"  -  must match API enum
];

// ─── Skeleton ─────────────────────────────────────────────────
function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className ?? ""}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5 py-4">
      <div className="flex items-center gap-3 mb-4">
        <motion.div
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <Heart size={20} className="text-red-500" fill="#ef4444" />
        </motion.div>
        <span className="text-sm text-white/60">Generating content with AI...</span>
      </div>
      <SkeletonBlock className="h-7 w-3/4" />
      <SkeletonBlock className="h-4 w-full" />
      <SkeletonBlock className="h-4 w-5/6" />
      <div className="space-y-2 mt-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-3.5 w-full" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-6 w-20 rounded-full" />
        ))}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-center py-20">
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="relative"
      >
        {/* Phone silhouette */}
        <div
          className="w-24 h-40 rounded-2xl border-2 flex flex-col items-center justify-center gap-2"
          style={{
            borderColor: "rgba(239,68,68,0.3)",
            background: "rgba(239,68,68,0.05)",
          }}
        >
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <Heart size={24} className="text-red-500" fill="#ef4444" />
          </motion.div>
          <div className="space-y-1 w-full px-3">
            {[70, 100, 85].map((w, i) => (
              <div
                key={i}
                className="h-1 rounded-full"
                style={{ width: `${w}%`, background: "rgba(239,68,68,0.25)" }}
              />
            ))}
          </div>
        </div>
        {/* Floating sparkles */}
        {["-top-2 -right-2", "-bottom-1 -left-2", "top-1/2 -right-5"].map((pos, i) => (
          <motion.div
            key={i}
            className={`absolute ${pos}`}
            animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.7 }}
          >
            <Sparkles size={14} className="text-pink-400" />
          </motion.div>
        ))}
      </motion.div>

      <div>
        <p className="text-white/60 font-semibold text-base">Ready to generate</p>
        <p className="text-white/30 text-sm mt-1 max-w-[240px]">
          Pick a post type, enter your topic, then hit Generate with AI
        </p>
      </div>
    </div>
  );
}

// ─── Copy Button ──────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handle}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-white/40 hover:text-white transition-all"
      style={{ border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─── Section wrapper ──────────────────────────────────────────
function Section({ label, children, copyText }: { label: string; children: React.ReactNode; copyText?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium">
          {label}
        </label>
        {copyText && <CopyBtn text={copyText} />}
      </div>
      {children}
    </div>
  );
}

// ─── Card style ───────────────────────────────────────────────
const glassCard: React.CSSProperties = {
  background: "rgba(17,17,24,0.8)",
  backdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
};

// ─── Carousel Preview ─────────────────────────────────────────
function CarouselPreview({
  slides,
  slideImages,
  onGenerateImages,
  generatingImages,
}: {
  slides: Array<{ slide: number; headline: string; body: string }>;
  slideImages: string[];
  onGenerateImages: () => void;
  generatingImages: boolean;
}) {
  const brand = useBrand();
  const [currentSlide, setCurrentSlide] = useState(0);
  const slide = slides[currentSlide];
  const hasImage = slideImages[currentSlide];

  return (
    <div className="space-y-4">
      {/* Slide viewer */}
      <div className="relative rounded-2xl overflow-hidden" style={{ aspectRatio: "1/1", background: "#0d0d12", border: "1px solid rgba(255,255,255,0.08)" }}>
        {/* Red top accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: "linear-gradient(90deg, #ef4444, #ec4899, #9333ea)" }} />

        {hasImage && (
          <img src={hasImage} alt={`Slide ${slide.slide}`} className="absolute inset-0 w-full h-full object-cover opacity-20" />
        )}

        <div className="relative z-10 flex flex-col justify-between h-full p-8">
          {/* Slide number */}
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">SLIDE {slide.slide} / {slides.length}</span>
            <div className="flex gap-1">
              {slides.map((_, i) => (
                <div key={i} className={`h-1 rounded-full transition-all ${i === currentSlide ? "w-6 bg-red-500" : "w-2 bg-white/20"}`} />
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col justify-center gap-4">
            <h2 className="text-2xl font-bold text-white leading-tight" style={{ fontFamily: "Sora, sans-serif" }}>
              {slide.headline}
            </h2>
            <p className="text-sm text-white/60 leading-relaxed">{slide.body}</p>
          </div>

          {/* Footer brand */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #ef4444, #ec4899)" }}>
              <Heart size={12} className="text-white fill-white" />
            </div>
            <span className="text-[10px] text-white/30 font-medium">{`@${brand.handle}`}</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))} disabled={currentSlide === 0}
          className="p-2 rounded-lg border border-white/[0.08] text-white/40 hover:text-white disabled:opacity-30 transition-all">
          ←
        </button>
        <span className="text-xs text-white/40">{currentSlide + 1} of {slides.length}</span>
        <button onClick={() => setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))} disabled={currentSlide === slides.length - 1}
          className="p-2 rounded-lg border border-white/[0.08] text-white/40 hover:text-white disabled:opacity-30 transition-all">

        </button>
      </div>

      {/* All slides thumbnail row */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {slides.map((s, i) => (
          <button key={i} onClick={() => setCurrentSlide(i)}
            className={`flex-shrink-0 w-16 h-16 rounded-lg border p-2 text-left transition-all ${i === currentSlide ? "border-red-500/50 bg-red-500/10" : "border-white/[0.06] bg-white/[0.02] hover:border-white/20"}`}>
            <p className="text-[8px] text-white/30 mb-0.5">#{s.slide}</p>
            <p className="text-[9px] text-white/60 line-clamp-2 leading-tight">{s.headline}</p>
          </button>
        ))}
      </div>

      {/* Generate images button */}
      <motion.button
        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
        onClick={onGenerateImages}
        disabled={generatingImages}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.3), rgba(147,51,234,0.3))", border: "1px solid rgba(239,68,68,0.3)" }}
      >
        {generatingImages ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
        {generatingImages ? "Generating slide images..." : `Generate Images for All ${slides.length} Slides`}
      </motion.button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function GeneratorPage() {
  const brand = useBrand();
  // Global selected brand — used as the default for this page's own account picker.
  const { brandId: globalBrandId, brands } = useSelectedBrand();
  // Per-page account override. "" until resolved, then a real brand id.
  // (Generator publishes to ONE account, so "all" is coerced to the primary.)
  const [genBrand, setGenBrand] = useState<string>("");
  // Keep the local picker in sync with the global selection until the user
  // explicitly overrides it on this page.
  const [genBrandTouched, setGenBrandTouched] = useState(false);
  // Resolve effective brand: explicit local choice wins; else the global one
  // (never "all" — generation targets a single account, so fall back to primary).
  const primaryId = brands.find((b) => b.isPrimary)?.id ?? brands[0]?.id ?? "";
  const effectiveBrand =
    (genBrandTouched ? genBrand : globalBrandId) === ALL_BRANDS || !(genBrandTouched ? genBrand : globalBrandId)
      ? primaryId
      : (genBrandTouched ? genBrand : globalBrandId);

  const [postType, setPostType] = useState("CLINICAL_PEARL");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [tone, setTone] = useState("professional");
  const [topic, setTopic] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [reelExpanded, setReelExpanded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [activeTab, setActiveTab] = useState<"content" | "visual" | "carousel" | "preview">("content");
  const [savedPostId, setSavedPostId] = useState<string | null>(null);
  const [cachedMediaUrl, setCachedMediaUrl] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");
  const [carouselSlides, setCarouselSlides] = useState<Array<{slide:number;headline:string;body:string}> | null>(null);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [slideImageUrls, setSlideImageUrls] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isAlreadyPublished, setIsAlreadyPublished] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishTarget, setPublishTarget] = useState<Platform>(platform);

  // ── Generate ────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error("Please enter a topic first");
      return;
    }
    setIsGenerating(true);
    setGeneratedContent(null);
    setSavedPostId(null);
    setCachedMediaUrl(null);

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: postType,
          tone,
          topic: topic.trim(),
          customPrompt: customPrompt.trim() || undefined,
          platform,
          youtubeMode: platform === "youtube" || platform === "both",
          ...(effectiveBrand && { brand: effectiveBrand }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedContent(data.data);
        setEditedContent(data.data.content ?? "");
        setCarouselSlides(data.data.carouselSlides ?? null);
        setSlideImageUrls([]);
        if (data.data.carouselSlides) {
          setActiveTab("carousel");
        } else {
          setActiveTab("visual");
        }
        toast.success("Content generated! 🎉");
      } else {
        toast.error(data.error ?? "Generation failed");
      }
    } catch {
      toast.error("Network error  -  check your connection");
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Copy all ────────────────────────────────────────────────
  const copyAll = () => {
    if (!generatedContent) return;
    const text = [
      generatedContent.title,
      "",
      generatedContent.hook,
      "",
      editedContent || generatedContent.content,
      "",
      generatedContent.cta,
      "",
      (generatedContent.hashtags ?? []).join(" "),
    ].join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  // ── Build post payload (strips null/undefined so Zod doesn't choke) ─────
  const buildPostPayload = (status: "DRAFT" | "SCHEDULED" = "DRAFT") => {
    if (!generatedContent) return null;
    const payload: Record<string, unknown> = {
      type:    postType,
      title:   generatedContent.title   || "Untitled",
      content: editedContent            || generatedContent.content || "",
      status,
      platform,
      hashtags: generatedContent.hashtags ?? [],
    };
    if (effectiveBrand) payload.brand = effectiveBrand;
    // Only include optional string fields if they are non-null, non-empty strings
    if (generatedContent.hook)        payload.hook        = generatedContent.hook;
    if (generatedContent.cta)         payload.cta         = generatedContent.cta;
    if (generatedContent.imagePrompt) payload.imagePrompt = generatedContent.imagePrompt;
    if (generatedContent.reelScript)  payload.reelScript  = generatedContent.reelScript;
    if (typeof generatedContent.viralScore === "number" && generatedContent.viralScore > 0)
      payload.viralScore = generatedContent.viralScore;
    // Include carousel slides so the publish route can generate one image per slide
    if (carouselSlides && carouselSlides.length > 0)
      payload.carouselSlides = carouselSlides;
    return payload;
  };

  // ── Save Draft ──────────────────────────────────────────────
  const handleSaveDraft = async () => {
    if (!generatedContent) return;
    const payload = buildPostPayload("DRAFT");
    if (!payload) return;
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        // API returns { data: { post: { id, mediaUrl, ... } } }
        setSavedPostId(data.data?.post?.id ?? null);
        if (data.data?.post?.mediaUrl) setCachedMediaUrl(data.data.post.mediaUrl);
        toast.success("Saved to Content Library!");
      } else {
        toast.error(data.error ?? "Failed to save");
      }
    } catch {
      toast.error("Network error while saving");
    }
  };

  // ── Schedule ────────────────────────────────────────────────
  const handleScheduleOpen = async () => {
    // Auto-save as draft first if not already saved
    if (!savedPostId) {
      await handleSaveDraft();
    }
    // Default to 1 hour from now
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    setScheduleTime(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
    setShowScheduleModal(true);
  };

  const handleScheduleConfirm = async () => {
    if (!scheduleTime) { toast.error("Pick a date/time first"); return; }
    // datetime-local input gives "YYYY-MM-DDTHH:MM" in local (IST) time; append IST offset
    const scheduledFor = new Date(`${scheduleTime}:00+05:30`).toISOString();
    if (new Date(scheduledFor) <= new Date()) { toast.error("Must schedule in the future"); return; }
    try {
      // Ensure we have a saved post first
      let postId = savedPostId;
      if (!postId && generatedContent) {
        const draftPayload = buildPostPayload("DRAFT");
        if (draftPayload) {
          const res = await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draftPayload),
          });
          const d = await res.json();
          if (d.success) postId = d.data?.post?.id ?? null;
        }
      }
      const res = await fetch("/api/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          title: generatedContent!.title,
          content: editedContent || generatedContent!.content,
          hashtags: generatedContent!.hashtags,
          scheduledFor,
          timezone: "Asia/Kolkata",
          platform,
          ...(effectiveBrand && { brand: effectiveBrand }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Scheduled for ${new Date(scheduledFor).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} IST 📅`);
        setShowScheduleModal(false);
        if (postId) setSavedPostId(postId);
      } else {
        toast.error(data.error ?? "Scheduling failed");
      }
    } catch {
      toast.error("Network error while scheduling");
    }
  };

  // ── Platform-aware label helper ──────────────────────────────
  const platformLabelFor = (p: Platform) =>
    p === "youtube" ? "YouTube"
    : p === "both"  ? "Instagram & YouTube"
    : "Instagram";

  // ── Publish (step 1: open the platform picker) ───────────────
  const handlePublish = async () => {
    if (!savedPostId) {
      toast("Save as draft first before publishing", { icon: "ℹ️" });
      return;
    }
    if (isPublishing || isAlreadyPublished) return;
    // Preselect the modal with the top-of-page platform choice, then let the
    // user make the final call inside the modal.
    setPublishTarget(platform);
    setShowPublishModal(true);
  };

  // ── Publish (step 2: confirm chosen platform & POST) ─────────
  const handlePublishConfirm = async (chosen: Platform) => {
    if (!savedPostId) {
      toast("Save as draft first before publishing", { icon: "ℹ️" });
      return;
    }
    if (isPublishing || isAlreadyPublished) return;
    setShowPublishModal(false);
    setIsPublishing(true);
    const isCarousel = postType === "CAROUSEL";
    const platformLabel = platformLabelFor(chosen);
    toast(
      isCarousel
        ? "🎨 Rendering branded slides & publishing... (30–60 s)"
        : `📤 Publishing to ${platformLabel}...`,
      { duration: 5000 }
    );
    try {
      const res = await fetch(`/api/posts/${savedPostId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: chosen, ...(effectiveBrand && { brand: effectiveBrand }) }),
      });
      const data = await res.json();
      if (res.status === 409 || data.error?.toLowerCase().includes("already published")) {
        // Post already live  -  treat as success, disable button
        setIsAlreadyPublished(true);
        toast(`This post is already live on ${platformLabel} ✅`, { icon: "📸" });
      } else if (data.success) {
        setIsAlreadyPublished(true);
        toast.success(`Published to ${platformLabel}! 🎉`);
      } else {
        toast.error(data.error ?? "Publish failed");
      }
    } catch {
      toast.error("Publish request failed");
    } finally {
      setIsPublishing(false);
    }
  };

  // ── Generate Carousel Images ─────────────────────────────────
  const handleGenerateCarouselImages = async () => {
    if (!carouselSlides) return;
    setGeneratingImages(true);
    const urls: string[] = [];
    for (const slide of carouselSlides) {
      const nicheText = brand.niche && brand.niche !== "your topic" ? brand.niche : "lifestyle";
      const prompt = encodeURIComponent(
        `professional ${nicheText} infographic slide, dark background, bold accent colors, bold headline text "${slide.headline}", clean minimal design, 1080x1080 Instagram post, no watermark`
      );
      const seed = Math.floor(Math.random() * 999999);
      const url = `https://image.pollinations.ai/prompt/${prompt}?width=1080&height=1080&nologo=true&seed=${seed}&model=flux`;
      urls.push(url);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    }
    setSlideImageUrls(urls);
    setGeneratingImages(false);
    toast.success(`Generated ${urls.length} slide images! 🎨`);
    // Save the first image as the post's mediaUrl for publishing
    if (urls.length > 0 && generatedContent) {
      setGeneratedContent({ ...generatedContent, imagePrompt: generatedContent.imagePrompt });
    }
  };

  const currentPostType = postTypes.find((p) => p.id === postType);

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="max-w-7xl mx-auto"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
        {/* ════════════════════════════════════════════
            LEFT: Controls
        ════════════════════════════════════════════ */}
        <div className="space-y-4">

          {/* Account (Brand) Selector — defaults to the globally-selected account */}
          {brands.length > 1 && (
            <div className="rounded-2xl p-5" style={glassCard}>
              <h3 className="text-sm font-semibold text-white mb-3" style={{ fontFamily: "Sora, sans-serif" }}>
                Account
              </h3>
              <select
                value={effectiveBrand}
                onChange={(e) => { setGenBrand(e.target.value); setGenBrandTouched(true); }}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none transition-all appearance-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id} className="bg-[#11111a] text-white">
                    {b.label}{b.isPrimary ? " (Primary)" : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-white/35 mt-2">
                Content will be generated and published to this account.
              </p>
            </div>
          )}

          {/* Platform Selector */}
          <div className="rounded-2xl p-5" style={glassCard}>
            <h3 className="text-sm font-semibold text-white mb-4" style={{ fontFamily: "Sora, sans-serif" }}>
              Platform
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "instagram", label: "Instagram", Icon: Instagram, accent: "#ec4899" },
                { id: "youtube",   label: "YouTube",   Icon: Youtube,   accent: "#ef4444" },
                { id: "both",      label: "Both",      Icon: Smartphone, accent: "#9333ea" },
              ] as const).map(({ id, label, Icon, accent }) => {
                const active = platform === id;
                return (
                  <motion.button
                    key={id}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setPlatform(id)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                      active
                        ? "text-white"
                        : "border-white/[0.06] text-white/40 hover:text-white/70 hover:border-white/[0.12]"
                    }`}
                    style={active ? { borderColor: `${accent}66`, background: `${accent}1f` } : undefined}
                  >
                    <Icon size={18} style={{ color: active ? accent : undefined }} />
                    <span className="leading-tight">{label}</span>
                  </motion.button>
                );
              })}
            </div>

            {(platform === "youtube" || platform === "both") && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-start gap-2 p-2.5 rounded-xl"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <Youtube size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-red-200/80 leading-relaxed">
                  {platform === "both"
                    ? "Publishes to Instagram and as a vertical YouTube Short. Hashtags are researched per the YouTube algorithm."
                    : "Publishes as a vertical YouTube Short. Hashtags are researched per the YouTube algorithm."}
                </p>
              </motion.div>
            )}
          </div>

          {/* Post Type Grid */}
          <div className="rounded-2xl p-5" style={glassCard}>
            <h3 className="text-sm font-semibold text-white mb-4" style={{ fontFamily: "Sora, sans-serif" }}>
              {platform === "youtube" ? "Short Type" : platform === "both" ? "Content Type" : "Post Type"}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {postTypes.map((type) => (
                <motion.button
                  key={type.id}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setPostType(type.id)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                    postType === type.id
                      ? "bg-gradient-to-br from-red-500/20 to-pink-500/10 border-red-500/30 text-white"
                      : "border-white/[0.06] text-white/40 hover:text-white/70 hover:border-white/[0.12]"
                  }`}
                >
                  <span className="text-base">{type.id === "REEL" && (platform === "youtube" || platform === "both") ? "📱" : type.emoji}</span>
                  <span className="leading-tight text-center">{postTypeLabel(type.id, type.label, platform)}</span>
                </motion.button>
              ))}
            </div>
          </div>

          {/* Tone + Topic + Custom Prompt */}
          <div className="rounded-2xl p-5 space-y-4" style={glassCard}>
            {/* Tone */}
            <div>
              <label className="text-xs font-medium text-white/40 uppercase tracking-wider block mb-2">
                Tone
              </label>
              <div className="flex flex-wrap gap-2">
                {tones.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      tone === t.id
                        ? "bg-gradient-to-r from-red-500/20 to-pink-500/10 border-red-500/30 text-red-300"
                        : "border-white/[0.08] text-white/40 hover:text-white/70"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Topic */}
            <div>
              <label className="text-xs font-medium text-white/40 uppercase tracking-wider block mb-2">
                Topic / Keyword
              </label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="e.g. a topic, tip, or question for your audience..."
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                onFocus={(e) => {
                  e.target.style.borderColor = "rgba(239,68,68,0.5)";
                  e.target.style.boxShadow = "0 0 0 3px rgba(239,68,68,0.1)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "rgba(255,255,255,0.08)";
                  e.target.style.boxShadow = "none";
                }}
              />
            </div>

            {/* Custom Prompt */}
            <div>
              <button
                onClick={() => setPromptExpanded((v) => !v)}
                className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors w-full"
              >
                {promptExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Custom prompt (optional)
              </button>
              <AnimatePresence>
                {promptExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="Add specific instructions, target audience, or extra context..."
                      rows={4}
                      className="mt-2 w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-none transition-all"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                      onFocus={(e) => { e.target.style.borderColor = "rgba(239,68,68,0.5)"; }}
                      onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Generate Button */}
          <div className="space-y-3">
            <motion.button
              onClick={handleGenerate}
              disabled={isGenerating}
              whileHover={{ scale: isGenerating ? 1 : 1.02 }}
              whileTap={{ scale: isGenerating ? 1 : 0.98 }}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-white relative overflow-hidden pulse-glow disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #ef4444, #ec4899, #9333ea)" }}
            >
              {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {isGenerating ? "Generating..." : "Generate with AI ⚡"}
            </motion.button>

            {generatedContent && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium text-white/60 border border-white/[0.08] hover:border-white/[0.15] hover:text-white transition-all disabled:opacity-40"
              >
                <RefreshCw size={14} className={isGenerating ? "animate-spin" : ""} />
                Regenerate
              </motion.button>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════
            RIGHT: Output
        ════════════════════════════════════════════ */}
        <div className="rounded-2xl p-6 min-h-[600px] flex flex-col" style={glassCard}>

          {/* Empty state */}
          {!isGenerating && !generatedContent && <EmptyState />}

          {/* Loading skeleton */}
          {isGenerating && (
            <div className="flex-1">
              <LoadingSkeleton />
            </div>
          )}

          {/* Generated Content */}
          {!isGenerating && generatedContent && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col flex-1 gap-4"
            >
              {/* Tab switcher */}
              <div
                className="flex rounded-xl overflow-hidden self-start"
                style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
              >
                {(["content", "visual", ...(postType === "CAROUSEL" && carouselSlides ? ["carousel"] : []), "preview"] as string[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all capitalize ${
                      activeTab === tab
                        ? "bg-gradient-to-r from-red-500/20 to-pink-500/10 text-white"
                        : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    {tab === "content" ? <FileText size={14} /> : tab === "visual" ? <Sparkles size={14} /> : tab === "carousel" ? <ImageIcon size={14} /> : <Smartphone size={14} />}
                    {tab === "content" ? "📋 Content" : tab === "visual" ? "✨ Visual" : tab === "carousel" ? "🖼️ Carousel" : "📱 Preview"}
                  </button>
                ))}
              </div>

              {/* ── Tab 1: Content ── */}
              <AnimatePresence mode="wait">
                {activeTab === "content" && (
                  <motion.div
                    key="content"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-5 flex-1"
                  >
                    {/* Title */}
                    <Section label="Title" copyText={generatedContent.title}>
                      <h2 className="text-lg font-bold text-white leading-snug" style={{ fontFamily: "Sora, sans-serif" }}>
                        {generatedContent.title}
                      </h2>
                    </Section>

                    {/* Hook */}
                    <Section label="Hook" copyText={generatedContent.hook}>
                      <p className="text-sm text-white/80 leading-relaxed italic border-l-2 border-red-500/40 pl-3">
                        {generatedContent.hook}
                      </p>
                    </Section>

                    {/* Content (editable) */}
                    <Section label="Content (editable)" copyText={editedContent}>
                      <textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        rows={8}
                        className="w-full px-4 py-3 rounded-xl text-sm text-white/70 leading-relaxed resize-y outline-none transition-all"
                        style={{
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                        onFocus={(e) => { e.target.style.borderColor = "rgba(239,68,68,0.4)"; }}
                        onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.06)"; }}
                      />
                    </Section>

                    {/* CTA */}
                    <Section label="Call to Action" copyText={generatedContent.cta}>
                      <p className="text-sm text-white/70">{generatedContent.cta}</p>
                    </Section>

                    {/* Hashtags */}
                    <Section label={`Hashtags (${(generatedContent.hashtags ?? []).length})`}>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(generatedContent.hashtags ?? []).map((tag) => (
                          <motion.span
                            key={tag}
                            whileHover={{ scale: 1.05 }}
                            onClick={() => { navigator.clipboard.writeText(tag); toast.success(`${tag} copied!`); }}
                            className="px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors"
                            style={{
                              background: "rgba(239,68,68,0.1)",
                              border: "1px solid rgba(239,68,68,0.2)",
                              color: "rgba(252,165,165,0.9)",
                            }}
                          >
                            {tag}
                          </motion.span>
                        ))}
                      </div>
                    </Section>

                    {/* Image Prompt */}
                    <Section label="Image Prompt" copyText={generatedContent.imagePrompt}>
                      <div className="flex items-start gap-2">
                        <ImageIcon size={12} className="text-white/30 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-white/50 italic leading-relaxed">
                          {generatedContent.imagePrompt}
                        </p>
                      </div>
                    </Section>

                    {/* Reel Script accordion */}
                    {generatedContent.reelScript && (
                      <div>
                        <button
                          onClick={() => setReelExpanded((v) => !v)}
                          className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors"
                        >
                          <Play size={10} />
                          Reel Script
                          {reelExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                        <AnimatePresence>
                          {reelExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <pre
                                className="mt-2 p-3 rounded-xl text-xs text-white/60 leading-relaxed whitespace-pre-wrap"
                                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", fontFamily: "monospace" }}
                              >
                                {generatedContent.reelScript}
                              </pre>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Viral Score + Engagement */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium">
                            Viral Score
                          </label>
                          <span className="text-sm font-bold text-white">{Math.round(generatedContent.viralScore * 100)}/100</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.round(generatedContent.viralScore * 100)}%` }}
                            transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
                            className="h-full rounded-full"
                            style={{
                              background: generatedContent.viralScore >= 0.7
                                ? "linear-gradient(90deg,#22c55e,#4ade80)"
                                : generatedContent.viralScore >= 0.4
                                ? "linear-gradient(90deg,#eab308,#fde047)"
                                : "linear-gradient(90deg,#ef4444,#f97316)",
                            }}
                          />
                        </div>
                      </div>

                      <div className="p-3 rounded-xl flex flex-col justify-between" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <label className="text-[10px] text-white/30 uppercase tracking-wider font-medium">
                          Engagement
                        </label>
                        <div className="flex items-center gap-2 mt-2">
                          <Target size={16} className="text-emerald-400" />
                          <span className="text-sm font-bold text-emerald-400">
                            {generatedContent.engagementPrediction ?? (generatedContent.viralScore >= 0.7 ? "High" : generatedContent.viralScore >= 0.4 ? "Medium" : "Low")}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action bar */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
                      <button
                        onClick={copyAll}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/[0.15] transition-all"
                      >
                        <Copy size={12} /> Copy All
                      </button>
                      <button
                        onClick={handleSaveDraft}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/[0.15] transition-all"
                      >
                        <Save size={12} /> Save Draft
                      </button>
                      <button
                        onClick={handleScheduleOpen}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-blue-400 border border-blue-500/20 hover:bg-blue-500/10 transition-all"
                      >
                        <Calendar size={12} /> Schedule
                      </button>
                      <button
                        onClick={handlePublish}
                        disabled={isPublishing || isAlreadyPublished}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white bg-gradient-to-r from-red-500 to-pink-600 hover:opacity-90 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {isPublishing ? (
                          <>
                            <span className="inline-block w-3 h-3 rounded-full border-2 border-transparent border-t-white border-r-pink-300 animate-spin" />
                            Publishing...
                          </>
                        ) : isAlreadyPublished ? (
                          <>✅ Published</>
                        ) : (
                          <><Send size={12} /> Publish Now</>
                        )}
                      </button>
                      <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white/40 hover:text-white/70 transition-all ml-auto disabled:opacity-40"
                      >
                        <RefreshCw size={12} className={isGenerating ? "animate-spin" : ""} /> Regenerate
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* ── Tab: Visual ── */}
                {activeTab === "visual" && (
                  <motion.div
                    key="visual"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                    className="flex-1"
                  >
                    <PostVisualCard
                      postType={postType}
                      title={generatedContent.title}
                      hook={generatedContent.hook}
                      content={editedContent || generatedContent.content}
                      cta={generatedContent.cta}
                      hashtags={generatedContent.hashtags ?? []}
                      imagePrompt={generatedContent.imagePrompt}
                      viralScore={generatedContent.viralScore}
                      reelScript={generatedContent.reelScript}
                      carouselSlides={carouselSlides ?? undefined}
                    />
                  </motion.div>
                )}

                {/* ── Tab 2: Carousel ── */}
                {activeTab === "carousel" && carouselSlides && (
                  <motion.div
                    key="carousel"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                    className="flex-1"
                  >
                    <CarouselPreview
                      slides={carouselSlides}
                      slideImages={slideImageUrls}
                      onGenerateImages={handleGenerateCarouselImages}
                      generatingImages={generatingImages}
                    />
                  </motion.div>
                )}

                {/* ── Tab 3: Preview ── */}
                {activeTab === "preview" && (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                    className="flex-1"
                  >
                    <p className="text-xs text-white/30 mb-6 text-center">
                      {platform === "youtube"
                        ? "This is how your YouTube Short will look"
                        : platform === "both"
                        ? "This is how your post will look on Instagram & YouTube"
                        : "This is how your post will look on Instagram"}
                    </p>
                    <InstagramPostPreview
                      content={editedContent || generatedContent.content}
                      hook={generatedContent.hook}
                      hashtags={generatedContent.hashtags ?? []}
                      type={currentPostType?.label}
                      viralScore={generatedContent.viralScore}
                      imagePrompt={generatedContent.imagePrompt}
                      mediaUrl={cachedMediaUrl ?? undefined}
                    />

                    {/* Action bar repeated */}
                    <div className="flex flex-wrap gap-2 pt-6 mt-4 border-t border-white/[0.06]">
                      <button onClick={copyAll} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/[0.15] transition-all">
                        <Copy size={12} /> Copy All
                      </button>
                      <button onClick={handleSaveDraft} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/[0.15] transition-all">
                        <Save size={12} /> Save Draft
                      </button>
                      <button onClick={handleScheduleOpen} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-blue-400 border border-blue-500/20 hover:bg-blue-500/10 transition-all">
                        <Calendar size={12} /> Schedule
                      </button>
                      <button
                        onClick={handlePublish}
                        disabled={isPublishing || isAlreadyPublished}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white bg-gradient-to-r from-red-500 to-pink-600 hover:opacity-90 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {isPublishing ? (
                          <>
                            <span className="inline-block w-3 h-3 rounded-full border-2 border-transparent border-t-white border-r-pink-300 animate-spin" />
                            Publishing...
                          </>
                        ) : isAlreadyPublished ? (
                          <>✅ Published</>
                        ) : (
                          <><Send size={12} /> Publish Now</>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>

    {/* ── Schedule Modal ── */}
    <AnimatePresence>
      {showScheduleModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowScheduleModal(false)}
        >
          <motion.div
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-6 space-y-5"
            style={{ background: "rgba(14,14,22,0.98)", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            <div>
              <h3 className="text-base font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>
                📅 Schedule Post
              </h3>
              <p className="text-xs text-white/40 mt-1">Pick a date and time to publish this post to {platformLabelFor(platform)}.</p>
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-2">
                Date &amp; Time
              </label>
              <input
                type="datetime-local"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                min={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() + 60000)).replace(", ", "T")}
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  colorScheme: "dark",
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowScheduleModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm text-white/50 border border-white/[0.08] hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleScheduleConfirm}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: "linear-gradient(135deg,#ef4444,#db2777)" }}
              >
                Confirm Schedule
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* ── Publish Platform Picker Modal ── */}
    <AnimatePresence>
      {showPublishModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowPublishModal(false)}
        >
          <motion.div
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-6 space-y-5"
            style={{ background: "rgba(14,14,22,0.98)", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            <div>
              <h3 className="text-base font-semibold text-white" style={{ fontFamily: "Sora, sans-serif" }}>
                📤 Publish Post
              </h3>
              <p className="text-xs text-white/40 mt-1">Choose where to publish this post.</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "instagram", label: "Instagram", Icon: Instagram, accent: "#ec4899" },
                { id: "youtube",   label: "YouTube",   Icon: Youtube,   accent: "#ef4444" },
                { id: "both",      label: "Both",      Icon: Smartphone, accent: "#9333ea" },
              ] as const).map(({ id, label, Icon, accent }) => {
                const active = publishTarget === id;
                return (
                  <motion.button
                    key={id}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setPublishTarget(id)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                      active
                        ? "text-white"
                        : "border-white/[0.06] text-white/40 hover:text-white/70 hover:border-white/[0.12]"
                    }`}
                    style={active ? { borderColor: `${accent}66`, background: `${accent}1f` } : undefined}
                  >
                    <Icon size={18} style={{ color: active ? accent : undefined }} />
                    <span className="leading-tight">{label}</span>
                  </motion.button>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowPublishModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm text-white/50 border border-white/[0.08] hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePublishConfirm(publishTarget)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: "linear-gradient(135deg,#ef4444,#db2777)" }}
              >
                Publish to {platformLabelFor(publishTarget)}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
