"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduledPost, PostStatus } from "@/types";

// ─── Types ────────────────────────────────────────────────────
interface CalendarGridProps {
  posts?: ScheduledPost[];
  className?: string;
  onPostClick?: (post: ScheduledPost) => void;
}

// ─── Status Dot Colors ────────────────────────────────────────
const STATUS_DOT: Record<PostStatus, string> = {
  DRAFT: "#6b7280",
  SCHEDULED: "#3b82f6",
  PUBLISHED: "#22c55e",
  FAILED: "#ef4444",
  PENDING: "#eab308",
  CANCELLED: "#4b5563",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── CalendarGrid ─────────────────────────────────────────────
export default function CalendarGrid({
  posts = [],
  className,
  onPostClick,
}: CalendarGridProps) {
  // Use a ref for "today" so it is computed once (not every render) and
  // never changes between SSR and client hydration.
  const todayRef = useRef<Date | null>(null);
  if (!todayRef.current) todayRef.current = new Date();
  const today = todayRef.current;
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDayPanel, setShowDayPanel] = useState(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Build calendar cells
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  // Map posts by date string (YYYY-MM-DD)
  const postsByDate = posts.reduce<Record<string, ScheduledPost[]>>((acc, post) => {
    const date = new Date(post.scheduledFor);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(post);
    return acc;
  }, {} as Record<string, ScheduledPost[]>);

  const getPostsForCell = useCallback(
    (day: number) => {
      const key = `${year}-${month}-${day}`;
      return postsByDate[key] || [];
    },
    [year, month, postsByDate]
  );

  const prevMonth = useCallback(() => {
    setViewDate(new Date(year, month - 1, 1));
    setSelectedDate(null);
    setShowDayPanel(false);
  }, [year, month]);

  const nextMonth = useCallback(() => {
    setViewDate(new Date(year, month + 1, 1));
    setSelectedDate(null);
    setShowDayPanel(false);
  }, [year, month]);

  const handleDayClick = useCallback(
    (day: number) => {
      const date = new Date(year, month, day);
      setSelectedDate(date);
      setShowDayPanel(true);
    },
    [year, month]
  );

  const selectedPosts: ScheduledPost[] = selectedDate
    ? getPostsForCell(selectedDate.getDate())
    : [];

  return (
    <div className={cn("space-y-4", className)}>
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          {MONTHS[month]} {year}
        </h3>
        <div className="flex items-center gap-1">
          <motion.button
            onClick={prevMonth}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/08 transition-colors"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <ChevronLeft className="w-4 h-4" />
          </motion.button>
          <motion.button
            onClick={() => {
              setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelectedDate(today);
              setShowDayPanel(true);
            }}
            whileHover={{ scale: 1.04 }}
            className="px-2 py-1 rounded-lg text-[10px] text-white/50 hover:text-white transition-colors"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            Today
          </motion.button>
          <motion.button
            onClick={nextMonth}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white transition-colors"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <ChevronRight className="w-4 h-4" />
          </motion.button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-center text-[10px] text-white/30 font-medium py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNumber = i - firstDay + 1;
          const isValid = dayNumber >= 1 && dayNumber <= daysInMonth;
          const isToday =
            isValid &&
            today.getDate() === dayNumber &&
            today.getMonth() === month &&
            today.getFullYear() === year;
          const isSelected =
            isValid &&
            selectedDate?.getDate() === dayNumber &&
            selectedDate?.getMonth() === month &&
            selectedDate?.getFullYear() === year;
          const dayPosts: ScheduledPost[] = isValid ? getPostsForCell(dayNumber) : [];

          return (
            <motion.button
              key={i}
              onClick={() => isValid && handleDayClick(dayNumber)}
              whileHover={isValid ? { scale: 1.06 } : {}}
              whileTap={isValid ? { scale: 0.95 } : {}}
              disabled={!isValid}
              suppressHydrationWarning
              className={cn(
                "relative aspect-square rounded-xl flex flex-col items-center justify-start pt-1.5 gap-1 transition-all",
                !isValid && "opacity-0 pointer-events-none",
                isValid && "cursor-pointer",
                isSelected && "ring-1 ring-red-500/60"
              )}
              style={{
                background: isToday
                  ? "rgba(239,68,68,0.18)"
                  : isSelected
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(255,255,255,0.03)",
                border: isToday
                  ? "1px solid rgba(239,68,68,0.4)"
                  : "1px solid rgba(255,255,255,0.05)",
              }}
            >
              {/* Day number */}
              <span
                className={cn(
                  "text-[11px] font-medium leading-none",
                  isToday ? "text-red-300 font-bold" : "text-white/60"
                )}
              >
                {isValid ? dayNumber : ""}
              </span>

              {/* Post dots */}
              {dayPosts.length > 0 && (
                <div className="flex flex-wrap gap-0.5 justify-center px-0.5">
                  {dayPosts.slice(0, 3).map((post, pi) => (
                    <span
                      key={pi}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: STATUS_DOT[post.status] }}
                    />
                  ))}
                  {dayPosts.length > 3 && (
                    <span className="text-[7px] text-white/30">+{dayPosts.length - 3}</span>
                  )}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Day detail panel */}
      <AnimatePresence>
        {showDayPanel && selectedDate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div
              className="rounded-xl p-4"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-white">
                  {selectedDate.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
                <button
                  onClick={() => setShowDayPanel(false)}
                  className="text-white/30 hover:text-white/60 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {selectedPosts.length === 0 ? (
                <p className="text-xs text-white/30 text-center py-3">
                  No posts scheduled for this day
                </p>
              ) : (
                <div className="space-y-2">
                  {selectedPosts.map((post) => (
                    <motion.div
                      key={post.id}
                      whileHover={{ x: 3 }}
                      onClick={() => onPostClick?.(post)}
                      className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer hover:bg-white/[0.03] transition-colors"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: STATUS_DOT[post.status] }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/80 truncate">
                          {post.content?.hook || "Untitled post"}
                        </p>
                        <p className="text-[10px] text-white/30" suppressHydrationWarning>
                          {new Date(post.scheduledFor).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full capitalize flex-shrink-0"
                        style={{
                          background: `${STATUS_DOT[post.status]}20`,
                          color: STATUS_DOT[post.status],
                        }}
                      >
                        {post.status.toLowerCase()}
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
