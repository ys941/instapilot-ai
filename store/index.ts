﻿import { create } from "zustand";
import { devtools, persist, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// --- Types --------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  image?: string;
  role: "admin" | "editor" | "viewer";
  createdAt: string;
}

export interface Session {
  token: string;
  expiresAt: string;
}

export interface GeneratedContent {
  id: string;
  type: string;
  title: string;
  content: string;
  hook: string;
  cta: string;
  hashtags: string[];
  imagePrompt: string;
  reelScript: string;
  viralScore: number;
  engagementPrediction: {
    likes: string;
    comments: string;
    shares: string;
    saves: string;
    reach: string;
  };
  createdAt: string;
}

export interface Draft {
  id: string;
  title: string;
  content: string;
  hashtags: string[];
  status: "draft" | "ready" | "scheduled";
  scheduledFor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledPost {
  id: string;
  draftId?: string;
  title: string;
  content: string;
  imageUrl?: string;
  hashtags: string[];
  scheduledFor: string;
  status: "pending" | "published" | "failed" | "cancelled";
  postId?: string;
  createdAt: string;
}

export interface AnalyticsMetrics {
  followers: number;
  followersGrowth: number;
  totalPosts: number;
  avgEngagement: number;
  totalReach: number;
  totalImpressions: number;
  profileViews: number;
  websiteClicks: number;
  topPost?: {
    id: string;
    caption: string;
    likes: number;
    comments: number;
    reach: number;
  };
  weeklyData: {
    date: string;
    likes: number;
    comments: number;
    reach: number;
    impressions: number;
  }[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// --- Slice Interfaces ---------------------------------------------------------

interface AuthSlice {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User, session: Session) => void;
  logout: () => void;
  updateUser: (partial: Partial<User>) => void;
  setLoading: (loading: boolean) => void;
}

interface ContentSlice {
  generatedContent: GeneratedContent | null;
  drafts: Draft[];
  isGenerating: boolean;
  generationError: string | null;
  setGeneratedContent: (content: GeneratedContent | null) => void;
  setIsGenerating: (generating: boolean) => void;
  setGenerationError: (error: string | null) => void;
  saveContent: (content: Omit<Draft, "id" | "createdAt" | "updatedAt">) => Draft;
  deleteDraft: (id: string) => void;
  updateDraft: (id: string, partial: Partial<Draft>) => void;
  clearDrafts: () => void;
}

interface SchedulerSlice {
  scheduledPosts: ScheduledPost[];
  isScheduling: boolean;
  addPost: (post: Omit<ScheduledPost, "id" | "createdAt">) => ScheduledPost;
  removePost: (id: string) => void;
  updatePost: (id: string, partial: Partial<ScheduledPost>) => void;
  setIsScheduling: (scheduling: boolean) => void;
  getUpcomingPosts: () => ScheduledPost[];
}

interface AnalyticsSlice {
  metrics: AnalyticsMetrics | null;
  isLoadingMetrics: boolean;
  lastFetched: string | null;
  setMetrics: (metrics: AnalyticsMetrics) => void;
  setIsLoadingMetrics: (loading: boolean) => void;
  fetchMetrics: () => Promise<void>;
}

interface ChatSlice {
  messages: ChatMessage[];
  isOpen: boolean;
  isTyping: boolean;
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  clearMessages: () => void;
  setIsTyping: (typing: boolean) => void;
}

interface UISlice {
  theme: "dark" | "light";
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  activeTab: string;
  notifications: Array<{ id: string; type: "info" | "success" | "error" | "warning"; message: string; read: boolean; createdAt: string }>;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  collapseSidebar: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setActiveTab: (tab: string) => void;
  addNotification: (notification: Omit<UISlice["notifications"][0], "id" | "createdAt" | "read">) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
}

// --- Full Store Type ----------------------------------------------------------

type AppStore = AuthSlice &
  ContentSlice &
  SchedulerSlice &
  AnalyticsSlice &
  ChatSlice &
  UISlice;

// --- Store Implementation -----------------------------------------------------

const generateId = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useAppStore = create<AppStore>()(
  devtools(
    persist(
      subscribeWithSelector(
        immer((set, get) => ({
          // --- Auth Slice ------------------------------------------------
          user: null,
          session: null,
          isAuthenticated: false,
          isLoading: false,

          login: (user, session) =>
            set((state) => {
              state.user = user;
              state.session = session;
              state.isAuthenticated = true;
              state.isLoading = false;
            }),

          logout: () =>
            set((state) => {
              state.user = null;
              state.session = null;
              state.isAuthenticated = false;
              state.generatedContent = null;
              state.messages = [];
            }),

          updateUser: (partial) =>
            set((state) => {
              if (state.user) {
                Object.assign(state.user, partial);
              }
            }),

          setLoading: (loading) =>
            set((state) => {
              state.isLoading = loading;
            }),

          // --- Content Slice ---------------------------------------------
          generatedContent: null,
          drafts: [],
          isGenerating: false,
          generationError: null,

          setGeneratedContent: (content) =>
            set((state) => {
              state.generatedContent = content;
            }),

          setIsGenerating: (generating) =>
            set((state) => {
              state.isGenerating = generating;
            }),

          setGenerationError: (error) =>
            set((state) => {
              state.generationError = error;
            }),

          saveContent: (content) => {
            const draft: Draft = {
              ...content,
              id: generateId(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            set((state) => {
              state.drafts.unshift(draft);
            });
            return draft;
          },

          deleteDraft: (id) =>
            set((state) => {
              state.drafts = state.drafts.filter((d: Draft) => d.id !== id);
            }),

          updateDraft: (id, partial) =>
            set((state) => {
              const idx = state.drafts.findIndex((d: Draft) => d.id === id);
              if (idx !== -1) {
                Object.assign(state.drafts[idx], {
                  ...partial,
                  updatedAt: new Date().toISOString(),
                });
              }
            }),

          clearDrafts: () =>
            set((state) => {
              state.drafts = [];
            }),

          // --- Scheduler Slice -------------------------------------------
          scheduledPosts: [],
          isScheduling: false,

          addPost: (post) => {
            const newPost: ScheduledPost = {
              ...post,
              id: generateId(),
              createdAt: new Date().toISOString(),
            };
            set((state) => {
              state.scheduledPosts.push(newPost);
              // Sort by scheduledFor
              state.scheduledPosts.sort(
                (a: ScheduledPost, b: ScheduledPost) =>
                  new Date(a.scheduledFor).getTime() -
                  new Date(b.scheduledFor).getTime()
              );
            });
            return newPost;
          },

          removePost: (id) =>
            set((state) => {
              state.scheduledPosts = state.scheduledPosts.filter(
                (p: ScheduledPost) => p.id !== id
              );
            }),

          updatePost: (id, partial) =>
            set((state) => {
              const idx = state.scheduledPosts.findIndex((p: ScheduledPost) => p.id === id);
              if (idx !== -1) {
                Object.assign(state.scheduledPosts[idx], partial);
              }
            }),

          setIsScheduling: (scheduling) =>
            set((state) => {
              state.isScheduling = scheduling;
            }),

          getUpcomingPosts: () => {
            const now = new Date();
            return get().scheduledPosts.filter(
              (p) =>
                p.status === "pending" && new Date(p.scheduledFor) > now
            );
          },

          // --- Analytics Slice -------------------------------------------
          metrics: null,
          isLoadingMetrics: false,
          lastFetched: null,

          setMetrics: (metrics) =>
            set((state) => {
              state.metrics = metrics;
              state.lastFetched = new Date().toISOString();
              state.isLoadingMetrics = false;
            }),

          setIsLoadingMetrics: (loading) =>
            set((state) => {
              state.isLoadingMetrics = loading;
            }),

          fetchMetrics: async () => {
            const { setIsLoadingMetrics, setMetrics } = get();

            // Skip if fetched within last 5 minutes
            const lastFetched = get().lastFetched;
            if (lastFetched) {
              const elapsed = Date.now() - new Date(lastFetched).getTime();
              if (elapsed < 5 * 60 * 1000) return;
            }

            setIsLoadingMetrics(true);
            try {
              const res = await fetch("/api/analytics/overview");
              if (res.ok) {
                const data = await res.json();
                setMetrics(data);
              }
            } catch (err) {
              console.error("[useAppStore] fetchMetrics error:", err);
            } finally {
              set((state) => {
                state.isLoadingMetrics = false;
              });
            }
          },

          // --- Chat Slice ------------------------------------------------
          messages: [],
          isOpen: false,
          isTyping: false,

          toggleChat: () =>
            set((state) => {
              state.isOpen = !state.isOpen;
            }),

          openChat: () =>
            set((state) => {
              state.isOpen = true;
            }),

          closeChat: () =>
            set((state) => {
              state.isOpen = false;
            }),

          addMessage: (message) =>
            set((state) => {
              state.messages.push({
                ...message,
                id: generateId(),
                timestamp: new Date().toISOString(),
              });
            }),

          clearMessages: () =>
            set((state) => {
              state.messages = [];
            }),

          setIsTyping: (typing) =>
            set((state) => {
              state.isTyping = typing;
            }),

          // --- UI Slice --------------------------------------------------
          theme: "dark",
          sidebarOpen: true,
          sidebarCollapsed: false,
          activeTab: "overview",
          notifications: [],

          toggleSidebar: () =>
            set((state) => {
              state.sidebarOpen = !state.sidebarOpen;
            }),

          setSidebarOpen: (open) =>
            set((state) => {
              state.sidebarOpen = open;
            }),

          collapseSidebar: () =>
            set((state) => {
              state.sidebarCollapsed = !state.sidebarCollapsed;
            }),

          setTheme: (theme) =>
            set((state) => {
              state.theme = theme;
            }),

          setActiveTab: (tab) =>
            set((state) => {
              state.activeTab = tab;
            }),

          addNotification: (notification) =>
            set((state) => {
              state.notifications.unshift({
                ...notification,
                id: generateId(),
                read: false,
                createdAt: new Date().toISOString(),
              });
              // Keep only last 50 notifications
              if (state.notifications.length > 50) {
                state.notifications = state.notifications.slice(0, 50);
              }
            }),

          markNotificationRead: (id) =>
            set((state) => {
              const n = state.notifications.find((n: { id: string }) => n.id === id);
              if (n) n.read = true;
            }),

          clearNotifications: () =>
            set((state) => {
              state.notifications = [];
            }),
        }))
      ),
      {
        name: "cardioflow-store",
        partialize: (state) => ({
          // Persist only essential non-sensitive data
          theme: state.theme,
          sidebarCollapsed: state.sidebarCollapsed,
          drafts: state.drafts,
          scheduledPosts: state.scheduledPosts,
          activeTab: state.activeTab,
        }),
      }
    ),
    { name: "InstaPilot AI Store" }
  )
);

// --- Selector Hooks -----------------------------------------------------------

export const useUser = () => useAppStore((s) => s.user);
export const useIsAuthenticated = () => useAppStore((s) => s.isAuthenticated);
export const useGeneratedContent = () => useAppStore((s) => s.generatedContent);
export const useDrafts = () => useAppStore((s) => s.drafts);
export const useScheduledPosts = () => useAppStore((s) => s.scheduledPosts);
export const useMetrics = () => useAppStore((s) => s.metrics);
export const useChatMessages = () => useAppStore((s) => s.messages);
export const useChatOpen = () => useAppStore((s) => s.isOpen);
export const useSidebarOpen = () => useAppStore((s) => s.sidebarOpen);
export const useTheme = () => useAppStore((s) => s.theme);
export const useNotifications = () => useAppStore((s) => s.notifications);
export const useUnreadCount = () =>
  useAppStore((s) => s.notifications.filter((n) => !n.read).length);

