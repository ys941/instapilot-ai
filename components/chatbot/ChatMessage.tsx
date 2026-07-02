"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage as ChatMessageType } from "@/types";
import TypingIndicator from "./TypingIndicator";

// ─── Props ────────────────────────────────────────────────────
interface ChatMessageProps {
  message: ChatMessageType;
  index: number;
}

// ─── Helpers ─────────────────────────────────────────────────
function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    // Explicit locale avoids SSR/client environment divergence.
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ─── ChatMessage Component ────────────────────────────────────
export default function ChatMessage({ message, index }: ChatMessageProps) {
  const [showTime, setShowTime] = useState(false);
  const isUser = message.role === "user";

  // Typing placeholder
  if (message.isTyping) {
    return <TypingIndicator />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 380,
        damping: 28,
        delay: index * 0.04,
      }}
      className={`flex items-end gap-2 mb-4 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      onMouseEnter={() => setShowTime(true)}
      onMouseLeave={() => setShowTime(false)}
    >
      {/* Avatar  -  only for assistant */}
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-brand via-brand-light to-purple-700 flex items-center justify-center shadow-lg mb-1">
          <span className="text-white text-xs font-bold select-none">CF</span>
        </div>
      )}

      <div className={`flex flex-col gap-1 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>
        {/* Bubble */}
        {isUser ? (
          <motion.div
            className="px-4 py-2.5 rounded-2xl rounded-br-sm text-white text-sm leading-relaxed"
            style={{
              background: "linear-gradient(135deg, rgb(var(--accent-rgb)) 0%, rgb(var(--accent-2-rgb)) 100%)",
              boxShadow: "0 4px 20px rgb(var(--accent-rgb) / 0.35)",
            }}
            whileHover={{ scale: 1.01 }}
          >
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </motion.div>
        ) : (
          <motion.div
            className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
            style={{
              background: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: message.error
                ? "1px solid rgba(239,68,68,0.4)"
                : "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
              color: message.error ? "#fca5a5" : "rgba(255,255,255,0.9)",
            }}
            whileHover={{ scale: 1.005 }}
          >
            {message.error ? (
              <p className="flex items-center gap-2">
                <span>⚠️</span> {message.content}
              </p>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => (
                    <p className="mb-2 last:mb-0 whitespace-pre-wrap break-words">{children}</p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-brand-light">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-purple-300">{children}</em>
                  ),
                  code: ({ children }) => (
                    <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono text-brand-light">
                      {children}
                    </code>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>
                  ),
                  li: ({ children }) => (
                    <li className="text-white/80">{children}</li>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-light underline hover:text-brand-light transition-colors"
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-brand-light pl-3 my-2 text-white/70 italic">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </motion.div>
        )}

        {/* Timestamp  -  shown on hover */}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: showTime ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-[10px] text-white/30 px-1 select-none"
          suppressHydrationWarning
        >
          {formatTime(message.timestamp)}
        </motion.span>
      </div>
    </motion.div>
  );
}
