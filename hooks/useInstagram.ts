﻿"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type {
  AnalyticsData,
  InstagramMedia,
  ApiResponse,
} from "@/types";

// --- Query Keys -----------------------------------------------
const QUERY_KEYS = {
  analytics: ["instagram", "analytics"] as const,
  media: ["instagram", "media"] as const,
};

// --- API Fetchers ---------------------------------------------
async function fetchAnalytics(): Promise<AnalyticsData> {
  const res = await fetch("/api/instagram/analytics");
  if (!res.ok) throw new Error(`Analytics fetch failed: ${res.status}`);
  const data: ApiResponse<AnalyticsData> = await res.json();
  if (!data.success || !data.data) throw new Error(data.error || "No analytics data");
  return data.data;
}

async function fetchMedia(): Promise<InstagramMedia[]> {
  const res = await fetch("/api/instagram/media");
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);
  const data: ApiResponse<InstagramMedia[]> = await res.json();
  if (!data.success || !data.data) throw new Error(data.error || "No media data");
  return data.data;
}

async function publishPost(postId: string): Promise<{ instagramPostId: string }> {
  const res = await fetch(`/api/posts/${postId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Publish failed: ${res.status}`);
  }
  const data: ApiResponse<{ instagramPostId: string }> = await res.json();
  if (!data.success || !data.data) throw new Error(data.error || "Publish failed");
  return data.data;
}

// --- useInstagramAnalytics ------------------------------------
export function useInstagramAnalytics() {
  return useQuery<AnalyticsData, Error>({
    queryKey: QUERY_KEYS.analytics,
    queryFn: fetchAnalytics,
    // Refetch every 5 minutes
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    retry: 2,
  });
}

// --- useInstagramMedia ----------------------------------------
export function useInstagramMedia() {
  return useQuery<InstagramMedia[], Error>({
    queryKey: QUERY_KEYS.media,
    queryFn: fetchMedia,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    retry: 2,
  });
}

// --- usePublishPost -------------------------------------------
export function usePublishPost() {
  const queryClient = useQueryClient();

  return useMutation<{ instagramPostId: string }, Error, string>({
    mutationFn: publishPost,

    onMutate: () => {
      toast.loading("Publishing to Instagram...", { id: "publish-toast" });
    },

    onSuccess: (data) => {
      toast.success("Post published successfully!", {
        id: "publish-toast",
        duration: 4000,
      });
      // Invalidate media and analytics so they refresh
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.media });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.analytics });
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },

    onError: (err) => {
      toast.error(err.message || "Failed to publish post", {
        id: "publish-toast",
        duration: 5000,
      });
    },
  });
}

