"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Heart, Sparkles } from "lucide-react";
import ChatMessage from "./ChatMessage";
import TypingIndicator from "./TypingIndicator";
import type { ChatMessage as ChatMessageType } from "@/types";
import { useBrand } from "@/components/BrandContext";

// ─── Intro message ────────────────────────────────────────────
// Use empty timestamp here  -  it is set client-side in useEffect to avoid
// SSR/client Date.now() hydration mismatch (timestamp shown on hover only).
const INTRO_MESSAGE: ChatMessageType = {
  id: "intro-001",
  role: "assistant",
  content:
    "Hello! I'm your intelligent assistant designed and developed by **Yati Bhardwaj** to help streamline content creation, audience engagement, workflow automation, and Instagram growth. How can I assist you today?",
  timestamp: "",
};

// ─── ChatWidget ───────────────────────────────────────────────
export default function ChatWidget() {
  const brand = useBrand();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageType[]>([INTRO_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Stamp intro message with the real client-side timestamp on mount.
  // Keeping it empty in the module constant avoids SSR/hydration mismatch.
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === "intro-001" && m.timestamp === ""
          ? { ...m, timestamp: new Date().toISOString() }
          : m
      )
    );
  }, []);

  // Auto-scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [isOpen]);

  // Send message handler
  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessageType = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev.slice(-19), userMsg]);
    setInput("");
    setIsLoading(true);

    // Add typing indicator
    const typingMsg: ChatMessageType = {
      id: "typing-indicator",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      isTyping: true,
    };
    setMessages((prev) => [...prev, typingMsg]);

    try {
      const history = messages
        .filter((m) => !m.isTyping && m.id !== "intro-001")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionId,
          history,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      if (data.success && data.data) {
        setSessionId(data.data.sessionId);
        const botMsg: ChatMessageType = {
          id: `bot-${Date.now()}`,
          role: "assistant",
          content: data.data.reply,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) =>
          [...prev.filter((m) => m.id !== "typing-indicator"), botMsg]
        );
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (err) {
      const errorMsg: ChatMessageType = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date().toISOString(),
        error: true,
      };
      setMessages((prev) =>
        [...prev.filter((m) => m.id !== "typing-indicator"), errorMsg]
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, sessionId]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  // Auto-resize textarea
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      e.target.style.height = "auto";
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    },
    []
  );

  return (
    <>
      {/* ── Floating Trigger Button ── */}
      <motion.button
        className="fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full flex items-center justify-center cursor-pointer"
        style={{
          background: "linear-gradient(135deg, #ef4444 0%, #db2777 60%, #9333ea 100%)",
          boxShadow: "0 0 0 0 rgba(239,68,68,0.4)",
        }}
        animate={
          isOpen
            ? {}
            : {
                boxShadow: [
                  "0 0 0 0 rgba(239,68,68,0.5), 0 4px 24px rgba(239,68,68,0.4)",
                  "0 0 0 18px rgba(239,68,68,0), 0 4px 24px rgba(239,68,68,0.4)",
                  "0 0 0 0 rgba(239,68,68,0), 0 4px 24px rgba(239,68,68,0.4)",
                ],
              }
        }
        transition={
          isOpen
            ? {}
            : { duration: 2.2, repeat: Infinity, ease: "easeOut" }
        }
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.92 }}
        onClick={() => setIsOpen((v) => !v)}
        aria-label={`Open ${brand.appName} Assistant`}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
              transition={{ duration: 0.2 }}
            >
              <X className="w-6 h-6 text-white" />
            </motion.div>
          ) : (
            <motion.div
              key="open"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2 }}
              className="relative"
            >
              <Heart className="w-7 h-7 text-white fill-white" />
              <Sparkles className="w-3 h-3 text-yellow-300 absolute -top-1 -right-1" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* ── Chat Panel ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            key="chat-panel"
            initial={{ opacity: 0, y: 60, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed bottom-28 right-6 z-50 flex flex-col overflow-hidden"
            style={{
              width: 380,
              height: 520,
              background: "rgba(10, 10, 20, 0.82)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 20,
              boxShadow:
                "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            {/* ── Header ── */}
            <div
              className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(219,39,119,0.12) 50%, rgba(147,51,234,0.1) 100%)",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {/* Icon */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background:
                    "linear-gradient(135deg, #ef4444 0%, #db2777 60%, #9333ea 100%)",
                  boxShadow: "0 0 16px rgba(239,68,68,0.4)",
                }}
              >
                <Heart className="w-4 h-4 text-white fill-white" />
              </div>

              {/* Title */}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white leading-tight">
                  {brand.appName} Assistant
                </h3>
                <p className="text-[10px] text-white/40 leading-tight mt-0.5 truncate">
                  AI-powered content & automation
                </p>
              </div>

              {/* Status dot */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <motion.div
                  className="w-2 h-2 rounded-full bg-emerald-400"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span className="text-[10px] text-white/40">Online</span>
              </div>

              {/* Close */}
              <button
                onClick={() => setIsOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ml-1"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            {/* ── Messages Area ── */}
            <div
              className="flex-1 overflow-y-auto px-4 py-3 space-y-0 custom-scrollbar"
              style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(239,68,68,0.3) transparent" }}
            >
              <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                  width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                  background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                  background: rgba(239,68,68,0.3);
                  border-radius: 2px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                  background: rgba(239,68,68,0.5);
                }
              `}</style>

              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  index={i}
                />
              ))}

              <div ref={messagesEndRef} />
            </div>

            {/* ── Input Bar ── */}
            <div
              className="flex-shrink-0 px-3 py-3"
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div
                className="flex items-end gap-2 rounded-2xl px-3 py-2"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about content, analytics..."
                  disabled={isLoading}
                  className="flex-1 bg-transparent text-sm text-white/90 placeholder-white/30 resize-none outline-none leading-relaxed py-1"
                  style={{ maxHeight: 120, minHeight: 24 }}
                />
                <motion.button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.92 }}
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-40"
                  style={{
                    background:
                      input.trim() && !isLoading
                        ? "linear-gradient(135deg, #ef4444 0%, #db2777 100%)"
                        : "rgba(255,255,255,0.1)",
                    boxShadow:
                      input.trim() && !isLoading
                        ? "0 0 16px rgba(239,68,68,0.4)"
                        : "none",
                  }}
                >
                  {isLoading ? (
                    <motion.div
                      className="w-3.5 h-3.5 rounded-full border-2 border-white/60 border-t-transparent"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                    />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-white" />
                  )}
                </motion.button>
              </div>
              <p className="text-center text-[9px] text-white/20 mt-1.5 select-none">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
