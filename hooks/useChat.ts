﻿"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, ChatRole } from "@/types";

// --- Constants ------------------------------------------------
const MAX_HISTORY = 20;

const INTRO_MESSAGE: ChatMessage = {
  id: "intro-001",
  role: "assistant",
  content:
    "Hello! I'm your intelligent assistant designed and developed by **Yati Bhardwaj** to help streamline cardiology content creation, audience engagement, workflow automation, and Instagram growth. How can I assist you today?",
  timestamp: new Date().toISOString(),
};

// --- Types ----------------------------------------------------
interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sessionId: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;
  error: string | null;
}

// --- useChat --------------------------------------------------
// Manages the full chat lifecycle:
//   - Maintains message list (capped at MAX_HISTORY)
//   - Adds typing indicator while waiting for the response
//   - Sends history context to /api/ai/chat
//   - Auto-scrolls to the bottom via a provided ref
// --------------------------------------------------------------
export function useChat(bottomRef?: React.RefObject<HTMLDivElement>): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([INTRO_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (bottomRef?.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, bottomRef]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setError(null);

      // 1. Add user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => {
        const next = [...prev, userMsg];
        // Cap total (keep intro + last MAX_HISTORY-1)
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });

      // 2. Add typing indicator
      const typingId = "typing-indicator";
      const typingMsg: ChatMessage = {
        id: typingId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        isTyping: true,
      };
      setMessages((prev) => [...prev, typingMsg]);
      setIsLoading(true);

      try {
        // 3. Build history payload (exclude typing + intro)
        const history = messages
          .filter((m) => !m.isTyping && m.id !== "intro-001")
          .slice(-10)
          .map((m) => ({ role: m.role as ChatRole, content: m.content }));

        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            sessionId,
            history,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();

        if (!data.success || !data.data) {
          throw new Error(data.error || "Empty response from server");
        }

        // 4. Persist session ID
        if (data.data.sessionId) {
          setSessionId(data.data.sessionId);
        }

        // 5. Replace typing indicator with real message
        const botMsg: ChatMessage = {
          id: `bot-${Date.now()}`,
          role: "assistant",
          content: data.data.reply,
          timestamp: new Date().toISOString(),
        };

        setMessages((prev) =>
          prev.filter((m) => m.id !== typingId).concat(botMsg)
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unexpected error occurred";
        setError(message);

        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "Sorry, I ran into an issue. Please try again.",
          timestamp: new Date().toISOString(),
          error: true,
        };

        setMessages((prev) =>
          prev.filter((m) => m.id !== typingId).concat(errorMsg)
        );
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, messages, sessionId]
  );

  const clearHistory = useCallback(() => {
    setMessages([INTRO_MESSAGE]);
    setSessionId(null);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    sessionId,
    sendMessage,
    clearHistory,
    error,
  };
}

