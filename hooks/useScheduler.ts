﻿"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type {
  ScheduledPost,
  SchedulePostOptions,
  PostStatus,
  ApiResponse,
} from "@/types";

// --- Query Keys -----------------------------------------------
const QUERY_KEYS = {
  scheduledPosts: (status?: PostStatus) =>
    status
      ? ["scheduler", "posts", status]
      : ["scheduler", "posts"],
} as const;

// --- API Fetchers ---------------------------------------------
async function fetchScheduledPosts(status?: PostStatus): Promise<ScheduledPost[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);

  const res = await fetch(`/api/scheduler?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch scheduled posts: ${res.status}`);
  const data: ApiResponse<ScheduledPost[]> = await res.json();
  if (!data.success || !data.data) throw new Error(data.error || "No data returned");
  return data.data;
}

async function schedulePost(options: SchedulePostOptions): Promise<ScheduledPost> {
  const res = await fetch("/api/scheduler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Schedule failed: ${res.status}`);
  }
  const data: ApiResponse<ScheduledPost> = await res.json();
  if (!data.success || !data.data) throw new Error(data.error || "Schedule failed");
  return data.data;
}

async function cancelSchedule(scheduleId: string): Promise<void> {
  const res = await fetch(`/api/scheduler/${scheduleId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Cancel failed: ${res.status}`);
  }
}

// --- useScheduledPosts ----------------------------------------
export function useScheduledPosts(status?: PostStatus) {
  return useQuery<ScheduledPost[], Error>({
    queryKey: QUERY_KEYS.scheduledPosts(status),
    queryFn: () => fetchScheduledPosts(status),
    refetchInterval: 60 * 1000, // refresh every minute
    staleTime: 30 * 1000,
    retry: 2,
  });
}

// --- useSchedulePost -----------------------------------------
export function useSchedulePost() {
  const queryClient = useQueryClient();

  return useMutation<ScheduledPost, Error, SchedulePostOptions>({
    mutationFn: schedulePost,

    onMutate: () => {
      toast.loading("Scheduling post...", { id: "schedule-toast" });
    },

    onSuccess: (data) => {
      const scheduledDate = new Date(data.scheduledFor).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      toast.success(`Post scheduled for ${scheduledDate}`, {
        id: "schedule-toast",
        duration: 4000,
      });
      // Invalidate all scheduled-posts queries
      queryClient.invalidateQueries({ queryKey: ["scheduler"] });
    },

    onError: (err) => {
      toast.error(err.message || "Failed to schedule post", {
        id: "schedule-toast",
        duration: 5000,
      });
    },
  });
}

// --- useCancelSchedule ----------------------------------------
export function useCancelSchedule() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: cancelSchedule,

    onMutate: async (scheduleId) => {
      // Optimistic update: remove the post from the list immediately
      await queryClient.cancelQueries({ queryKey: ["scheduler"] });

      const previousData = queryClient.getQueryData<ScheduledPost[]>(
        QUERY_KEYS.scheduledPosts()
      );

      queryClient.setQueryData<ScheduledPost[]>(
        QUERY_KEYS.scheduledPosts(),
        (old) => old?.filter((p) => p.id !== scheduleId) ?? []
      );

      return { previousData };
    },

    onSuccess: () => {
      toast.success("Schedule cancelled", { duration: 3000 });
      queryClient.invalidateQueries({ queryKey: ["scheduler"] });
    },

    onError: (err, _, context: any) => {
      // Roll back optimistic update
      if (context?.previousData) {
        queryClient.setQueryData(QUERY_KEYS.scheduledPosts(), context.previousData);
      }
      toast.error(err.message || "Failed to cancel schedule", { duration: 5000 });
    },
  });
}

