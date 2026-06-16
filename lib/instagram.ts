﻿import axios, { AxiosInstance } from "axios";

// --- Types --------------------------------------------------------------------

export interface Analytics {
  postId: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagementRate: number;
  timestamp: string;
}

export interface AccountAnalytics {
  followers: number;
  following: number;
  mediaCount: number;
  profileViews: number;
  websiteClicks: number;
  impressionsWeek: number;
  reachWeek: number;
  accountsEngaged: number;
}

export interface Comment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  likeCount: number;
  replies?: Comment[];
}

export interface MediaItem {
  id: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  mediaUrl: string;
  thumbnailUrl?: string;
  caption?: string;
  permalink: string;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
}

export interface Story {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  timestamp: string;
  expiresAt: string;
}

export interface CarouselItem {
  imageUrl: string;
  caption?: string;
}

export interface PublishResult {
  postId: string;
  permalink?: string;
  timestamp: string;
}

interface GraphAPIResponse<T> {
  data?: T;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

// --- InstagramClient ----------------------------------------------------------

export class InstagramClient {
  private client: AxiosInstance;
  private accessToken: string;
  private businessAccountId: string;
  private graphVersion = "v25.0";

  constructor(accessToken?: string, businessAccountId?: string) {
    this.accessToken =
      accessToken || process.env.INSTAGRAM_ACCESS_TOKEN || "";
    this.businessAccountId =
      businessAccountId ||
      process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "";

    if (!this.accessToken) {
      throw new Error("Instagram access token is required");
    }
    if (!this.businessAccountId) {
      throw new Error("Instagram business account ID is required");
    }

    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${this.graphVersion}`,
      timeout: 30000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const apiError = error.response?.data?.error;
        if (apiError) {
          console.error(
            `[InstagramClient] Graph API Error ${apiError.code}: ${apiError.message}`
          );
        }
        return Promise.reject(error);
      }
    );
  }

  private get defaultParams() {
    return { access_token: this.accessToken };
  }

  // --- Publishing ---------------------------------------------------------

  /**
   * Publish a single photo to Instagram
   */
  async publishPhoto(imageUrl: string, caption: string): Promise<PublishResult> {
    // Step 1: Create media container
    const containerRes = await this.client.post<{ id: string }>(
      `/${this.businessAccountId}/media`,
      null,
      {
        params: {
          ...this.defaultParams,
          image_url: imageUrl,
          caption,
        },
      }
    );

    const containerId = containerRes.data.id;

    // Step 2: Wait for container to be ready
    await this.waitForContainer(containerId);

    // Step 3: Publish the container
    const publishRes = await this.client.post<{ id: string }>(
      `/${this.businessAccountId}/media_publish`,
      null,
      {
        params: {
          ...this.defaultParams,
          creation_id: containerId,
        },
      }
    );

    return {
      postId: publishRes.data.id,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Publish a carousel post to Instagram
   */
  async publishCarousel(
    items: CarouselItem[],
    caption: string
  ): Promise<PublishResult> {
    if (items.length < 2 || items.length > 10) {
      throw new Error("Carousel must have between 2 and 10 items");
    }

    // Step 1: Create individual media containers
    const itemContainerIds = await Promise.all(
      items.map(async (item) => {
        const res = await this.client.post<{ id: string }>(
          `/${this.businessAccountId}/media`,
          null,
          {
            params: {
              ...this.defaultParams,
              image_url: item.imageUrl,
              is_carousel_item: true,
            },
          }
        );
        return res.data.id;
      })
    );

    // Step 2: Create carousel container
    const carouselRes = await this.client.post<{ id: string }>(
      `/${this.businessAccountId}/media`,
      null,
      {
        params: {
          ...this.defaultParams,
          media_type: "CAROUSEL",
          caption,
          children: itemContainerIds.join(","),
        },
      }
    );

    const containerId = carouselRes.data.id;

    // Step 3: Wait for container
    await this.waitForContainer(containerId);

    // Step 4: Publish
    const publishRes = await this.client.post<{ id: string }>(
      `/${this.businessAccountId}/media_publish`,
      null,
      {
        params: {
          ...this.defaultParams,
          creation_id: containerId,
        },
      }
    );

    return {
      postId: publishRes.data.id,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Wait until a media container status is FINISHED
   */
  private async waitForContainer(
    containerId: string,
    maxWait = 30000
  ): Promise<void> {
    const pollInterval = 2000;
    const maxAttempts = Math.floor(maxWait / pollInterval);

    for (let i = 0; i < maxAttempts; i++) {
      const res = await this.client.get<{ status_code: string }>(
        `/${containerId}`,
        {
          params: {
            ...this.defaultParams,
            fields: "status_code",
          },
        }
      );

      if (res.data.status_code === "FINISHED") return;
      if (res.data.status_code === "ERROR") {
        throw new Error(`Media container ${containerId} failed with ERROR status`);
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(
      `Media container ${containerId} timed out after ${maxWait}ms`
    );
  }

  // --- Insights & Analytics ------------------------------------------------

  /**
   * Get insights for a specific post
   */
  async getInsights(postId: string): Promise<Analytics> {
    const fields = [
      "impressions",
      "reach",
      "likes",
      "comments",
      "shares",
      "saved",
    ].join(",");

    const [mediaRes, insightsRes] = await Promise.all([
      this.client.get<{
        like_count: number;
        comments_count: number;
        timestamp: string;
      }>(`/${postId}`, {
        params: {
          ...this.defaultParams,
          fields: "like_count,comments_count,timestamp",
        },
      }),
      this.client
        .get<{
          data: Array<{ name: string; values: Array<{ value: number }> }>;
        }>(`/${postId}/insights`, {
          params: {
            ...this.defaultParams,
            metric: fields,
          },
        })
        .catch(() => ({ data: { data: [] } })),
    ]);

    const metricsMap: Record<string, number> = {};
    for (const metric of insightsRes.data.data) {
      metricsMap[metric.name] = metric.values[0]?.value ?? 0;
    }

    const likes = mediaRes.data.like_count || metricsMap.likes || 0;
    const comments = mediaRes.data.comments_count || metricsMap.comments || 0;
    const reach = metricsMap.reach || 0;

    return {
      postId,
      impressions: metricsMap.impressions || 0,
      reach,
      likes,
      comments,
      shares: metricsMap.shares || 0,
      saves: metricsMap.saved || 0,
      engagementRate: reach > 0 ? (likes + comments) / reach : 0,
      timestamp: mediaRes.data.timestamp,
    };
  }

  /**
   * Get account-level insights
   */
  async getAccountInsights(): Promise<AccountAnalytics> {
    const [accountRes, insightsRes] = await Promise.all([
      this.client.get<{
        followers_count: number;
        follows_count: number;
        media_count: number;
      }>(`/${this.businessAccountId}`, {
        params: {
          ...this.defaultParams,
          fields: "followers_count,follows_count,media_count",
        },
      }),
      this.client
        .get<{
          data: Array<{ name: string; values: Array<{ value: number }> }>;
        }>(`/${this.businessAccountId}/insights`, {
          params: {
            ...this.defaultParams,
            metric: "profile_views,website_clicks,impressions,reach,accounts_engaged",
            period: "day",
            since: Math.floor(
              (Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000
            ).toString(),
            until: Math.floor(Date.now() / 1000).toString(),
          },
        })
        .catch(() => ({ data: { data: [] } })),
    ]);

    const metricsMap: Record<string, number> = {};
    for (const metric of insightsRes.data.data) {
      const total = metric.values.reduce((sum, v) => sum + (v.value || 0), 0);
      metricsMap[metric.name] = total;
    }

    return {
      followers: accountRes.data.followers_count || 0,
      following: accountRes.data.follows_count || 0,
      mediaCount: accountRes.data.media_count || 0,
      profileViews: metricsMap.profile_views || 0,
      websiteClicks: metricsMap.website_clicks || 0,
      impressionsWeek: metricsMap.impressions || 0,
      reachWeek: metricsMap.reach || 0,
      accountsEngaged: metricsMap.accounts_engaged || 0,
    };
  }

  // --- Content Retrieval ---------------------------------------------------

  /**
   * Get comments for a post
   */
  async getComments(postId: string): Promise<Comment[]> {
    const res = await this.client.get<{
      data: Array<{
        id: string;
        text: string;
        username: string;
        timestamp: string;
        like_count: number;
      }>;
    }>(`/${postId}/comments`, {
      params: {
        ...this.defaultParams,
        fields: "id,text,username,timestamp,like_count",
      },
    });

    return (res.data.data || []).map((c) => ({
      id: c.id,
      text: c.text,
      username: c.username,
      timestamp: c.timestamp,
      likeCount: c.like_count || 0,
    }));
  }

  /**
   * Get follower count
   */
  async getFollowerCount(): Promise<number> {
    const res = await this.client.get<{ followers_count: number }>(
      `/${this.businessAccountId}`,
      {
        params: {
          ...this.defaultParams,
          fields: "followers_count",
        },
      }
    );

    return res.data.followers_count || 0;
  }

  /**
   * Get recent media posts
   */
  async getRecentMedia(limit = 20): Promise<MediaItem[]> {
    const res = await this.client.get<{
      data: Array<{
        id: string;
        media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
        media_url: string;
        thumbnail_url?: string;
        caption?: string;
        permalink: string;
        timestamp: string;
        like_count: number;
        comments_count: number;
      }>;
    }>(`/${this.businessAccountId}/media`, {
      params: {
        ...this.defaultParams,
        fields:
          "id,media_type,media_url,thumbnail_url,caption,permalink,timestamp,like_count,comments_count",
        limit,
      },
    });

    return (res.data.data || []).map((item) => ({
      id: item.id,
      mediaType: item.media_type,
      mediaUrl: item.media_url,
      thumbnailUrl: item.thumbnail_url,
      caption: item.caption,
      permalink: item.permalink,
      timestamp: item.timestamp,
      likeCount: item.like_count || 0,
      commentsCount: item.comments_count || 0,
    }));
  }

  /**
   * Get active stories
   */
  async getStories(): Promise<Story[]> {
    const res = await this.client.get<{
      data: Array<{
        id: string;
        media_type: "IMAGE" | "VIDEO";
        media_url: string;
        timestamp: string;
      }>;
    }>(`/${this.businessAccountId}/stories`, {
      params: {
        ...this.defaultParams,
        fields: "id,media_type,media_url,timestamp",
      },
    });

    return (res.data.data || []).map((story) => ({
      id: story.id,
      mediaType: story.media_type,
      mediaUrl: story.media_url,
      timestamp: story.timestamp,
      expiresAt: new Date(
        new Date(story.timestamp).getTime() + 24 * 60 * 60 * 1000
      ).toISOString(),
    }));
  }

  /**
   * Reply to a comment
   */
  async replyToComment(
    commentId: string,
    message: string
  ): Promise<{ id: string }> {
    const res = await this.client.post<{ id: string }>(
      `/${commentId}/replies`,
      null,
      {
        params: {
          ...this.defaultParams,
          message,
        },
      }
    );

    return { id: res.data.id };
  }

  /**
   * Delete a comment
   */
  async deleteComment(commentId: string): Promise<boolean> {
    const res = await this.client.delete<{ success: boolean }>(
      `/${commentId}`,
      {
        params: this.defaultParams,
      }
    );

    return res.data.success === true;
  }

  /**
   * Schedule a post via the container/publish method
   * Instagram only supports scheduling up to 75 days in advance
   */
  async schedulePhoto(
    imageUrl: string,
    caption: string,
    publishTime: Date
  ): Promise<PublishResult> {
    const publishTimestamp = Math.floor(publishTime.getTime() / 1000);

    const containerRes = await this.client.post<{ id: string }>(
      `/${this.businessAccountId}/media`,
      null,
      {
        params: {
          ...this.defaultParams,
          image_url: imageUrl,
          caption,
          published: false,
        },
      }
    );

    const containerId = containerRes.data.id;

    // Publish at scheduled time
    const publishRes = await this.client.post<{ id: string }>(
      `/${this.businessAccountId}/media_publish`,
      null,
      {
        params: {
          ...this.defaultParams,
          creation_id: containerId,
          scheduled_publish_time: publishTimestamp,
          published: false,
        },
      }
    );

    return {
      postId: publishRes.data.id,
      timestamp: publishTime.toISOString(),
    };
  }
}

// --- Singleton -----------------------------------------------------------------

let instagramInstance: InstagramClient | null = null;

export function getInstagramClient(): InstagramClient {
  if (!instagramInstance) {
    instagramInstance = new InstagramClient();
  }
  return instagramInstance;
}

export default getInstagramClient;

