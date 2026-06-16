﻿// ============================================================
// Shared TypeScript Types
// ============================================================

// --- Generic API Response -----------------------------------
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

// --- Post Types ----------------------------------------------
export type PostType =
  | "EDUCATIONAL"
  | "QUIZ"
  | "CAROUSEL"
  | "MYTH_FACT"
  | "CLINICAL_PEARL"
  | "CASE_STUDY"
  | "ANGIOGRAPHY_QUIZ"
  | "ECG_QUIZ"
  | "PREVENTIVE"
  | "CTA"
  | "REEL"
  | "STORY";

export type PostStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "PUBLISHED"
  | "FAILED"
  | "PENDING"
  | "CANCELLED";

export type ToneType =
  | "Professional"
  | "Educational"
  | "Conversational"
  | "Inspirational"
  | "Clinical";

// --- Content Generation --------------------------------------
export interface ContentResult {
  id: string;
  type: PostType;
  hook: string;
  mainContent: string;
  cta: string;
  hashtags: string[];
  imagePrompt: string;
  reelScript?: string;
  carouselSlides?: CarouselSlide[];
  viralScore: number;
  tone: ToneType;
  topic?: string;
  createdAt: string;
  wordCount: number;
  estimatedReadTime: number;
}

export interface CarouselSlide {
  slideNumber: number;
  title: string;
  content: string;
  imagePrompt: string;
  designNotes?: string;
}

export interface GenerateContentOptions {
  type: PostType;
  tone?: ToneType;
  topic?: string;
  customPrompt?: string;
  targetAudience?: string;
  includeHashtags?: boolean;
  includeImagePrompt?: boolean;
  includeReelScript?: boolean;
}

// --- Hashtags -------------------------------------------------
export type HashtagCategory = "high" | "medium" | "niche" | "trending";

export interface HashtagScore {
  tag: string;
  category: HashtagCategory;
  estimatedReach: number;
  competitionLevel: "low" | "medium" | "high";
  relevanceScore: number;
}

export interface HashtagPack {
  id: string;
  name: string;
  type: PostType;
  hashtags: HashtagScore[];
  totalReach: number;
  mixScore: number;
  createdAt: string;
}

export interface HashtagResult {
  recommended: HashtagScore[];
  byCategory: {
    high: HashtagScore[];
    medium: HashtagScore[];
    niche: HashtagScore[];
    trending: HashtagScore[];
  };
  packSuggestion: HashtagPack;
}

// --- Analytics ------------------------------------------------
export interface AccountMetrics {
  followers: number;
  followersGrowth: number;
  followersGrowthPercent: number;
  following: number;
  totalPosts: number;
  avgLikes: number;
  avgComments: number;
  avgSaves: number;
  avgShares: number;
  engagementRate: number;
  reachRate: number;
  profileViews: number;
  websiteClicks: number;
}

export interface PostMetrics {
  postId: string;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  reach: number;
  impressions: number;
  engagementRate: number;
  timestamp: string;
}

export interface AnalyticsData {
  account: AccountMetrics;
  posts: PostMetrics[];
  topPosts: PostMetrics[];
  growthTrend: GrowthPoint[];
  bestPostingTimes: BestTime[];
  audienceInsights: AudienceInsights;
  syncedAt: string;
}

export interface GrowthPoint {
  date: string;
  followers: number;
  engagement: number;
  reach: number;
}

export interface BestTime {
  dayOfWeek: string;
  hour: number;
  engagementScore: number;
}

export interface AudienceInsights {
  ageRanges: Record<string, number>;
  genderSplit: { male: number; female: number; other: number };
  topLocations: { location: string; percentage: number }[];
  activeHours: number[];
}

// --- Scheduler ------------------------------------------------
export interface ScheduledPost {
  id: string;
  contentId: string;
  content: ContentResult;
  scheduledFor: string;
  status: PostStatus;
  instagramPostId?: string;
  publishedAt?: string;
  failureReason?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulePostOptions {
  contentId: string;
  scheduledFor: string;
  autoOptimize?: boolean;
}

// --- Chat -----------------------------------------------------
export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  isTyping?: boolean;
  error?: boolean;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  title?: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  history?: { role: ChatRole; content: string }[];
}

export interface ChatResponse {
  reply: string;
  sessionId: string;
}

// --- Activity Log ---------------------------------------------
export type ActivityType =
  | "POST_GENERATED"
  | "POST_PUBLISHED"
  | "POST_SCHEDULED"
  | "POST_FAILED"
  | "ANALYTICS_SYNCED"
  | "WORKFLOW_RUN"
  | "HASHTAG_GENERATED"
  | "CAROUSEL_GENERATED"
  | "COMMENT_RECEIVED";

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// --- Notifications --------------------------------------------
export type NotificationType =
  | "POST_PUBLISHED"
  | "COMMENT_RECEIVED"
  | "WORKFLOW_FAILED"
  | "ANALYTICS_UPDATE"
  | "SCHEDULE_DUE"
  | "ERROR";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  actionUrl?: string;
  createdAt: string;
}

// --- File Storage ---------------------------------------------
export interface StoredFile {
  id: string;
  fileName: string;
  filePath: string;
  type: "post" | "carousel" | "quiz" | "reel" | "hashtag" | "image";
  size: number;
  createdAt: string;
}

export interface FileList {
  files: StoredFile[];
  total: number;
  directory: string;
}

// --- UI State -------------------------------------------------
export interface UIState {
  sidebarOpen: boolean;
  chatOpen: boolean;
  selectedPostType: PostType;
  selectedTone: ToneType;
  theme: "dark" | "light";
}

// --- Instagram ------------------------------------------------
export interface InstagramMedia {
  id: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  mediaUrl: string;
  thumbnailUrl?: string;
  caption?: string;
  timestamp: string;
  permalink: string;
  likeCount: number;
  commentsCount: number;
}

export interface InstagramAccount {
  id: string;
  username: string;
  name: string;
  biography: string;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
  profilePictureUrl: string;
  website?: string;
}

