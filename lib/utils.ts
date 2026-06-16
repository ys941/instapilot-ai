import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The canonical timezone for this app — Indian Standard Time (UTC +5:30). */
export const APP_TIMEZONE = "Asia/Kolkata";

/**
 * Format a Date (or ISO string) as a human-readable date+time string in IST.
 * Safe to call on both server (Railway UTC) and client.
 *
 * @example formatIST(post.scheduledFor) → "23 May 2026, 8:00 AM"
 */
export function formatIST(date: Date | string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(date).toLocaleString("en-IN", {
    timeZone:  APP_TIMEZONE,
    day:       "numeric",
    month:     "short",
    year:      "numeric",
    hour:      "2-digit",
    minute:    "2-digit",
    hour12:    true,
    ...opts,
  });
}

/**
 * Format just the time portion of a Date in IST.
 * @example formatTimeIST(post.scheduledFor) → "8:00 AM"
 */
export function formatTimeIST(date: Date | string): string {
  return new Date(date).toLocaleTimeString("en-IN", {
    timeZone: APP_TIMEZONE,
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   true,
  });
}

/**
 * Format just the date portion of a Date in IST.
 * @example formatDateIST(post.scheduledFor) → "23 May 2026"
 */
export function formatDateIST(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-IN", {
    timeZone: APP_TIMEZONE,
    day:      "numeric",
    month:    "short",
    year:     "numeric",
  });
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatEngagement(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length).trimEnd() + "...";
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateId(prefix = "cf"): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function percentageChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(date);
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Convert a "wall clock" HH:MM on a given UTC date into the correct UTC timestamp.
 *
 * Why this matters: Railway servers run in UTC.  When the user configures
 * "08:00 Asia/Kolkata", that means 02:30 UTC — NOT 08:00 UTC.
 * Using plain `setHours(8, 0)` on a server running UTC creates a 5 h 30 min error.
 *
 * Algorithm:
 *   1. Create a tentative UTC date whose UTC clock reads HH:MM (incorrect, but a starting point).
 *   2. Format that UTC moment in the target timezone to see what wall-clock time it shows.
 *   3. Compute the difference (desired HH:MM  ➜  what the timezone actually shows).
 *   4. Shift the tentative date by that difference to get the real UTC moment.
 *
 * @param year   Full year (e.g. 2025) in UTC
 * @param month  1-based month in UTC
 * @param day    Day of month in UTC
 * @param hh     Wall-clock hours in the target timezone  (0-23)
 * @param mm     Wall-clock minutes in the target timezone (0-59)
 * @param tz     IANA timezone string, e.g. "Asia/Kolkata", "America/New_York", "UTC"
 * @returns      A Date whose UTC value represents that wall-clock moment
 */
export function wallTimeToUTC(
  year:  number,
  month: number,
  day:   number,
  hh:    number,
  mm:    number,
  tz:    string
): Date {
  // Step 1: tentative UTC date with the clock reading HH:MM UTC
  const tentative = new Date(Date.UTC(year, month - 1, day, hh, mm, 0, 0));

  // Step 2: see what wall-clock time that UTC moment shows in `tz`
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   false,
  }).formatToParts(tentative);

  const p: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  }

  // Handle midnight represented as 24:00 in some locales
  const localH = (p["hour"]   ?? 0) % 24;
  const localM =  p["minute"] ?? 0;

  // Step 3: difference in minutes (desired − what we got).
  // CRITICAL: when the tentative UTC time lands on a DIFFERENT calendar day in
  // `tz` (e.g. 19:00 UTC = 00:30 next-day IST), the raw time-of-day difference is
  // off by a full day (+18.5h instead of −5.5h). A timezone offset is always
  // within ±14h, so normalise the diff into (−720, +720] minutes to undo the
  // date wrap. Without this, evening slots (e.g. 19:00 IST) were scheduled a day
  // late and never published on the intended day.
  let diffMin = (hh * 60 + mm) - (localH * 60 + localM);
  if (diffMin >  720) diffMin -= 1440;
  if (diffMin < -720) diffMin += 1440;
  const diffMs = diffMin * 60 * 1000;

  // Step 4: real UTC moment
  return new Date(tentative.getTime() + diffMs);
}

