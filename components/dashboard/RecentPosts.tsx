"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye,
  Edit3,
  Trash2,
  Send,
  MoreHorizontal,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

type PostStatus = "published" | "scheduled" | "draft" | "failed";

interface Post {
  id: string;
  title: string;
  type: string;
  status: PostStatus;
  reach: string;
  likes: string;
  date: string;
  viralScore: number;
}

const posts: Post[] = [
  {
    id: "1",
    title: "The one tip that changed everything",
    type: "Pro Tip",
    status: "published",
    reach: "12.4K",
    likes: "892",
    date: "May 14, 2026",
    viralScore: 87,
  },
  {
    id: "2",
    title: "Quiz: Can you guess the answer?",
    type: "Knowledge Quiz",
    status: "published",
    reach: "8.7K",
    likes: "634",
    date: "May 13, 2026",
    viralScore: 79,
  },
  {
    id: "3",
    title: "Myth vs Fact: What most people get wrong",
    type: "Myth-Fact",
    status: "scheduled",
    reach: " - ",
    likes: " - ",
    date: "May 16, 2026",
    viralScore: 92,
  },
  {
    id: "4",
    title: "Story: How one small change made a big difference",
    type: "Story / Example",
    status: "draft",
    reach: " - ",
    likes: " - ",
    date: "May 15, 2026",
    viralScore: 74,
  },
  {
    id: "5",
    title: "The complete beginner's guide",
    type: "Educational",
    status: "failed",
    reach: " - ",
    likes: " - ",
    date: "May 12, 2026",
    viralScore: 68,
  },
];

const statusConfig: Record<PostStatus, { label: string; icon: React.ElementType; className: string }> = {
  published: {
    label: "Published",
    icon: CheckCircle,
    className: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  },
  scheduled: {
    label: "Scheduled",
    icon: Clock,
    className: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  },
  draft: {
    label: "Draft",
    icon: FileText,
    className: "bg-white/5 text-white/50 border border-white/10",
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    className: "bg-red-500/10 text-red-400 border border-red-500/20",
  },
};

const typeColors: Record<string, string> = {
  "Pro Tip": "bg-purple-500/10 text-purple-400",
  "Knowledge Quiz": "bg-red-500/10 text-red-400",
  "Myth-Fact": "bg-yellow-500/10 text-yellow-400",
  "Story / Example": "bg-pink-500/10 text-pink-400",
  Educational: "bg-blue-500/10 text-blue-400",
  Carousel: "bg-orange-500/10 text-orange-400",
  Quiz: "bg-cyan-500/10 text-cyan-400",
};

function ViralScoreBadge({ score }: { score: number }) {
  const color =
    score >= 85
      ? "from-emerald-500 to-teal-500"
      : score >= 70
        ? "from-yellow-500 to-orange-500"
        : "from-red-500 to-pink-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
          className={`absolute h-full rounded-full bg-gradient-to-r ${color}`}
        />
      </div>
      <span className="text-xs text-white/50">{score}</span>
    </div>
  );
}

export default function RecentPosts() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "rgba(17,17,24,0.8)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <h3
          className="text-sm font-semibold text-white"
          style={{ fontFamily: "Sora, sans-serif" }}
        >
          Recent Posts
        </h3>
        <button className="text-xs text-red-400 hover:text-red-300 transition-colors">

        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.04]">
              {["Post", "Type", "Status", "Reach", "Likes", "Viral Score", ""].map(
                (h) => (
                  <th
                    key={h}
                    className="text-left px-5 py-3 text-xs font-medium text-white/30 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {posts.map((post, i) => {
              const status = statusConfig[post.status];
              const StatusIcon = status.icon;

              return (
                <motion.tr
                  key={post.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                  onMouseEnter={() => setHoveredId(post.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={cn(
                    "border-b border-white/[0.03] transition-colors",
                    hoveredId === post.id ? "bg-white/[0.02]" : ""
                  )}
                >
                  {/* Post title */}
                  <td className="px-5 py-3.5 max-w-[240px]">
                    <div>
                      <p className="text-sm text-white/80 font-medium truncate">
                        {post.title}
                      </p>
                      <p className="text-xs text-white/30 mt-0.5">
                        {post.date}
                      </p>
                    </div>
                  </td>

                  {/* Type */}
                  <td className="px-5 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold",
                        typeColors[post.type] ?? "bg-white/5 text-white/50"
                      )}
                    >
                      {post.type}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-5 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold",
                        status.className
                      )}
                    >
                      <StatusIcon size={10} />
                      {status.label}
                    </span>
                  </td>

                  {/* Reach */}
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-white/60">{post.reach}</span>
                  </td>

                  {/* Likes */}
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-white/60">{post.likes}</span>
                  </td>

                  {/* Viral Score */}
                  <td className="px-5 py-3.5">
                    <ViralScoreBadge score={post.viralScore} />
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <AnimatePresence>
                        {hoveredId === post.id && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-1"
                          >
                            <button
                              title="View"
                              className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-white/40 hover:text-white transition-all"
                            >
                              <Eye size={12} />
                            </button>
                            <button
                              title="Edit"
                              className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-blue-500/20 flex items-center justify-center text-white/40 hover:text-blue-400 transition-all"
                            >
                              <Edit3 size={12} />
                            </button>
                            {post.status === "draft" && (
                              <button
                                title="Publish"
                                className="w-7 h-7 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 flex items-center justify-center text-emerald-400 transition-all"
                              >
                                <Send size={12} />
                              </button>
                            )}
                            <div className="relative">
                              <button
                                onClick={() =>
                                  setOpenMenuId(
                                    openMenuId === post.id ? null : post.id
                                  )
                                }
                                className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-white/40 hover:text-white transition-all"
                              >
                                <MoreHorizontal size={12} />
                              </button>
                              <AnimatePresence>
                                {openMenuId === post.id && (
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    className="absolute right-0 bottom-8 w-32 rounded-xl border border-white/10 overflow-hidden z-20"
                                    style={{
                                      background: "rgba(17,17,24,0.98)",
                                      backdropFilter: "blur(20px)",
                                    }}
                                  >
                                    <button className="flex items-center gap-2 w-full px-3 py-2 text-xs text-white/60 hover:text-white hover:bg-white/[0.05] transition-colors">
                                      <Edit3 size={11} /> Duplicate
                                    </button>
                                    <button className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
                                      <Trash2 size={11} /> Delete
                                    </button>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
