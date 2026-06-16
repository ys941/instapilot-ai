﻿"use client";

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type {
  ContentResult,
  GenerateContentOptions,
  ApiResponse,
} from "@/types";

// --- API Call -------------------------------------------------
async function generateContent(
  options: GenerateContentOptions
): Promise<ContentResult> {
  const response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error || `Generation failed with status ${response.status}`
    );
  }

  const data: ApiResponse<ContentResult> = await response.json();

  if (!data.success || !data.data) {
    throw new Error(data.error || "Generation returned no content");
  }

  return data.data;
}

// --- Hook Return Type -----------------------------------------
interface UseGenerateReturn {
  generate: (options: GenerateContentOptions) => Promise<ContentResult | null>;
  isLoading: boolean;
  content: ContentResult | null;
  error: string | null;
  reset: () => void;
}

// --- useGenerateContent ---------------------------------------
export function useGenerateContent(): UseGenerateReturn {
  const queryClient = useQueryClient();
  const [content, setContent] = useState<ContentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation<ContentResult, Error, GenerateContentOptions>({
    mutationFn: generateContent,

    onMutate: () => {
      setError(null);
      toast.loading("Generating content...", { id: "generate-toast" });
    },

    onSuccess: (data) => {
      setContent(data);
      toast.success(
        `Content generated! Viral score: ${data.viralScore}/100`,
        { id: "generate-toast", duration: 4000 }
      );

      // Invalidate recent-posts cache so the list refreshes
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },

    onError: (err) => {
      const message = err.message || "Content generation failed. Please try again.";
      setError(message);
      toast.error(message, { id: "generate-toast", duration: 5000 });
    },
  });

  const generate = useCallback(
    async (options: GenerateContentOptions): Promise<ContentResult | null> => {
      try {
        const result = await mutation.mutateAsync(options);
        return result;
      } catch {
        return null;
      }
    },
    [mutation]
  );

  const reset = useCallback(() => {
    setContent(null);
    setError(null);
    mutation.reset();
  }, [mutation]);

  return {
    generate,
    isLoading: mutation.isPending,
    content,
    error,
    reset,
  };
}

