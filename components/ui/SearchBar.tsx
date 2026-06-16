"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Command } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
interface SearchBarProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
  className?: string;
  shortcut?: boolean; // show Cmd+K hint
}

// ─── SearchBar ────────────────────────────────────────────────
// Collapsed by default, expands on click.
// Cmd+K (or Ctrl+K) keyboard shortcut to open.
// Blur or Escape to collapse.
// ──────────────────────────────────────────────────────────────

export default function SearchBar({
  onSearch,
  placeholder = "Search posts, content, hashtags...",
  className,
  shortcut = true,
}: SearchBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 120);
      }
      if (e.key === "Escape" && isExpanded) {
        collapse();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isExpanded]);

  const collapse = useCallback(() => {
    setIsExpanded(false);
    setQuery("");
    onSearch?.("");
  }, [onSearch]);

  const handleExpand = useCallback(() => {
    setIsExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      onSearch?.(e.target.value);
    },
    [onSearch]
  );

  const handleClear = useCallback(() => {
    setQuery("");
    onSearch?.("");
    inputRef.current?.focus();
  }, [onSearch]);

  return (
    <motion.div
      animate={{ width: isExpanded ? 280 : 36 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className={cn("relative flex items-center overflow-hidden rounded-xl", className)}
      style={{
        background: isExpanded
          ? "rgba(255,255,255,0.07)"
          : "rgba(255,255,255,0.06)",
        border: `1px solid ${
          isExpanded ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.1)"
        }`,
        boxShadow: isExpanded ? "0 0 0 3px rgba(239,68,68,0.08)" : "none",
      }}
    >
      {/* Search icon / trigger */}
      <motion.button
        onClick={handleExpand}
        whileHover={isExpanded ? {} : { scale: 1.1 }}
        className="flex-shrink-0 w-9 h-9 flex items-center justify-center"
        aria-label="Open search"
      >
        <Search className="w-4 h-4 text-white/50" />
      </motion.button>

      {/* Input */}
      <AnimatePresence>
        {isExpanded && (
          <motion.input
            ref={inputRef}
            key="search-input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            type="text"
            value={query}
            onChange={handleChange}
            onBlur={() => !query && collapse()}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-white/90 placeholder-white/30 outline-none pr-2"
          />
        )}
      </AnimatePresence>

      {/* Right side: clear button OR keyboard shortcut hint */}
      <AnimatePresence mode="wait">
        {isExpanded && query ? (
          <motion.button
            key="clear"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            onClick={handleClear}
            className="flex-shrink-0 w-7 h-7 mr-1 rounded-md flex items-center justify-center hover:bg-white/10 transition-colors text-white/40 hover:text-white/70"
          >
            <X className="w-3 h-3" />
          </motion.button>
        ) : isExpanded && shortcut ? (
          <motion.div
            key="shortcut"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-shrink-0 flex items-center gap-0.5 mr-2 px-1.5 py-0.5 rounded text-[9px] text-white/25"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <span>Esc</span>
          </motion.div>
        ) : !isExpanded && shortcut ? (
          <motion.div
            key="cmd-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute right-0 top-0 bottom-0 flex items-center pr-1.5 pointer-events-none"
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
