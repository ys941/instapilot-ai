/**
 * scripts/demo/make-fixtures.cjs
 *
 * Builds the data behind the public demo: one fictional channel ("Demo Kitchen",
 * a home-cooking niche — any niche works, that's the point of a white-label app)
 * with posts, scheduled Shorts, analytics, comments and activity.
 *
 * Runs in Node so it can use the app's own code: settings come from the real
 * DEFAULTS, the brand from mergeBrand, and every post's card is rendered by the
 * real card generator. Output goes to public/demo/ (git-ignored), which the
 * browser-side demo API (lib/demo/api.ts) loads at startup.
 *
 * Nothing here is a real person, account or channel.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const outDir = path.join(root, "public", "demo");
const cardsDir = path.join(outDir, "cards");
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

// The demo brand, applied through the same env seed a real install can use.
Object.assign(process.env, {
  BRAND_NAME: "InstaPilot AI",
  BRAND_NICHE: "quick home cooking",
  BRAND_PURPOSE: "Help busy people cook good food in under 30 minutes.",
  BRAND_AUDIENCE: "busy people who want easy weeknight meals",
  BRAND_HANDLE: "demokitchen",
  BRAND_DISPLAY_NAME: "Demo Kitchen",
  BRAND_YOUTUBE_HANDLE: "demokitchen",
  BRAND_YOUTUBE_CHANNEL: "Demo Kitchen",
});
// No database in the demo — fail fast and let getBrand() fall back to the seed.
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:1/demo?connect_timeout=1";

const jiti = require("jiti")(__filename, { alias: { "@": root }, interopDefault: true });
const preferences = jiti(path.join(root, "lib", "preferences.ts"));
const { DEFAULTS } = preferences;
const { mergeBrand } = jiti(path.join(root, "lib", "brandConfig.ts"));
const { renderPostToJpeg } = jiti(path.join(root, "lib", "postTypeImageGenerator.ts"));

const DAY = 86_400_000;
const now = Date.now();
const iso = (offsetDays, hour = 9) => {
  const d = new Date(now + offsetDays * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const brand = mergeBrand({
  configured: true,
  tagline: "Weeknight dinners, made simple",
  // The two quiz types ship disabled; the demo channel uses them.
  contentTypes: {
    IMAGE_QUIZ: { enabled: true },
    KNOWLEDGE_QUIZ: { enabled: true },
  },
  topics: ["15-minute pasta", "Meal prep basics", "Knife skills", "One-pan dinners", "Pantry staples", "Baking bread"],
  hashtagSeeds: ["#homecooking", "#easyrecipes", "#weeknightdinner"],
});

// Without a database getBrand() falls back to the neutral defaults, so hand the
// card renderer the demo brand directly (it reads getBrand at call time).
Object.defineProperty(preferences, "getBrand", { value: async () => brand, configurable: true, writable: true });

const opts = "A. Option A\nB. Option B\nC. Option C\nD. Option D";
const POSTS = [
  { type: "EDUCATIONAL", status: "PUBLISHED", day: -1, title: "Why you should salt pasta water", hook: "Salted water seasons pasta from the inside", content: "- Pasta absorbs water as it cooks, and the salt with it\n- About 1 tablespoon per 4 litres is plenty\n- Salting later only seasons the surface", views: 48210, likes: 3120, comments: 214, viral: 0.91 },
  { type: "PRO_TIP", status: "PUBLISHED", day: -2, title: "Pro tip: rest your steak", hook: "Rest steak 5 minutes and keep the juices in", content: "THE EVIDENCE:\n- Muscle fibres relax and reabsorb juices as they cool slightly\nHOW TO APPLY IT:\n- Tent loosely with foil for five minutes before slicing\nREMEMBER: slice against the grain", views: 31870, likes: 2650, comments: 188, viral: 0.88 },
  { type: "MYTH_FACT", status: "PUBLISHED", day: -3, title: "Searing does not seal in juices", hook: "Searing meat seals in the juices", content: "MYTH: Searing meat seals in the juices\nFACT: Searing adds flavour through browning, not moisture\nTHE EVIDENCE:\n- Seared and unseared steaks lose about the same weight while cooking", views: 27440, likes: 1980, comments: 341, viral: 0.86 },
  { type: "KNOWLEDGE_QUIZ", status: "PUBLISHED", day: -4, title: "Which flour makes the chewiest bread?", hook: "Which flour makes the chewiest bread?", content: `SETUP: You are baking a crusty loaf\nKEY POINTS:\n- Protein builds gluten\n- Gluten traps gas and gives chew\nQUESTION: Which flour?\nA. Cake flour\nB. Bread flour\nC. Pastry flour\nD. Rice flour`, views: 22190, likes: 1510, comments: 402, viral: 0.84 },
  { type: "PREVENTIVE", status: "PUBLISHED", day: -5, title: "5 steps to a stress-free meal prep", hook: "Meal prep in 5 simple steps", content: "- Pick three recipes that share ingredients\n- Shop once with a single list\n- Cook grains and proteins first\n- Chop every vegetable in one go\n- Portion into labelled boxes", views: 19880, likes: 1320, comments: 97, viral: 0.82 },
  { type: "IMAGE_QUIZ", status: "PUBLISHED", day: -6, title: "Spot the mistake in this loaf", hook: "What went wrong with this loaf?", content: `SETUP: A loaf straight from the oven\nWHAT YOU SEE:\n- Dense crumb at the base\n- Large tunnel near the top\nQUESTION: What went wrong?\nA. Underproofed\nB. Overproofed\nC. Too much salt\nD. Oven too cool`, views: 17350, likes: 1190, comments: 356, viral: 0.83 },
  { type: "CASE_STUDY", status: "PUBLISHED", day: -8, title: "How one pan changed weeknight cooking", hook: "One pan, four dinners, zero stress", content: "THE SETUP: Cooking every night felt like too much washing up\nKEY DETAILS:\n- Four dinners a week, every one in a single pan\nTHE APPROACH:\n- Roast vegetables and protein together on one tray\nOUTCOME: Dinner on the table in 25 minutes, one pan to wash", views: 15210, likes: 990, comments: 76, viral: 0.8 },
  { type: "QUIZ", status: "SCHEDULED", day: 1, title: "What makes onions sweet?", hook: "What happens when onions caramelise?", content: `QUESTION: What happens when onions caramelise?\n${opts}` },
  { type: "EDUCATIONAL", status: "SCHEDULED", day: 2, title: "The 3 knife cuts you actually need", hook: "Master these 3 cuts and cook faster", content: "- The dice, for soups and sauces\n- The slice, for stir-fries\n- The mince, for garlic and herbs" },
  { type: "PRO_TIP", status: "SCHEDULED", day: 3, title: "Pro tip: freeze herbs in oil", hook: "Freeze herbs in olive oil for instant flavour", content: "THE EVIDENCE:\n- Oil protects herbs from freezer burn\nHOW TO APPLY IT:\n- Chop, fill an ice-cube tray, top with oil and freeze\nREMEMBER: drop a cube straight into the pan" },
  { type: "MYTH_FACT", status: "DRAFT", day: -1, title: "Rinsing chicken is not safer", hook: "You should rinse raw chicken", content: "MYTH: You should rinse raw chicken\nFACT: Rinsing spreads bacteria around your sink\nTHE EVIDENCE:\n- Cooking to the right temperature is what makes it safe" },
  { type: "CTA", status: "DRAFT", day: 0, title: "Follow for daily recipes", hook: "A new 15-minute recipe every day", content: "", cta: "Follow for more!" },
];

(async () => {
  fs.mkdirSync(cardsDir, { recursive: true });
  const posts = [];
  for (let i = 0; i < POSTS.length; i++) {
    const p = POSTS[i];
    const id = `demo-post-${i + 1}`;
    const buf = await renderPostToJpeg({ postType: p.type, title: p.title, hook: p.hook, content: p.content, cta: p.cta ?? "", themeIndex: i % 12 });
    if (buf) fs.writeFileSync(path.join(cardsDir, `${id}.jpg`), buf);
    const published = p.status === "PUBLISHED";
    posts.push({
      id, userId: "demo-user", type: p.type, title: p.title, content: p.content, hook: p.hook,
      cta: p.cta ?? "Save this and follow for more!",
      hashtags: ["#homecooking", "#easyrecipes", "#cookingtips", "#shorts"],
      imagePrompt: null, reelScript: null, status: p.status,
      instagramPostId: published ? `demo-ig-${i + 1}` : null,
      viralScore: p.viral ?? 0.78, engagementPrediction: null,
      publishedAt: published ? iso(p.day, 18) : null,
      scheduledFor: p.status === "SCHEDULED" ? iso(p.day, 18) : null,
      platform: "youtube", youtubeVideoId: published ? `demo${i + 1}` : null,
      mediaUrls: buf ? [`${BASE}/demo/cards/${id}.jpg`] : [], carouselSlides: null, metrics: null, brandId: null,
      createdAt: iso(p.day - 1, 10), updatedAt: iso(p.day - 1, 12),
      analytics: published ? { reach: Math.round(p.views * 1.4), impressions: Math.round(p.views * 2.1), likes: p.likes, comments: p.comments, saves: Math.round(p.likes * 0.4), shares: Math.round(p.likes * 0.2), engagementRate: Math.round(((p.likes + p.comments) / p.views) * 1000) / 1000 } : null,
      _views: p.views ?? 0,
    });
    console.log(`card ${id} (${p.type})${buf ? "" : " — render failed"}`);
  }

  const published = posts.filter((p) => p.status === "PUBLISHED");
  const recentVideos = published.map((p) => ({
    videoId: p.youtubeVideoId, title: p.title, publishedAt: p.publishedAt,
    thumbnail: p.mediaUrls[0] || "", views: p._views, likes: p.analytics.likes, comments: p.analytics.comments, url: "#",
  }));
  const totalViews = recentVideos.reduce((s, v) => s + v.views, 0);

  const weeklyTrend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * DAY);
    return { date: d.toISOString().slice(0, 10), posts: i % 3 === 0 ? 2 : 1, reach: 18000 + i * 4200, impressions: 26000 + i * 6100, followers: 12400 + i * 95 };
  });
  const accountTrend = Array.from({ length: 30 }, (_, i) => ({
    id: `acct-${i}`, date: new Date(now - (29 - i) * DAY).toISOString(), followers: 10200 + i * 78, following: 180, posts: 60 + i,
    reach: 14000 + i * 520, impressions: 21000 + i * 760, profileVisits: 900 + i * 22, websiteClicks: 40 + i, engagementRate: 0.062,
  }));

  const sum = (k) => published.reduce((s, p) => s + p.analytics[k], 0);
  const byType = Object.entries(posts.reduce((m, p) => ((m[p.type] = (m[p.type] || 0) + 1), m), {})).map(([type, count]) => ({ type, count }));

  const analytics = {
    overview: {
      totalPosts: published.length, publishedPosts: published.length,
      draftPosts: posts.filter((p) => p.status === "DRAFT").length,
      scheduledPosts: posts.filter((p) => p.status === "SCHEDULED").length,
      totalLikes: sum("likes"), totalComments: sum("comments"), totalShares: sum("shares"), totalSaves: sum("saves"),
      totalReach: sum("reach"), totalImpressions: sum("impressions"), avgEngagementRate: 6.4, avgViralScore: 0.85,
      followers: 12970, syncedAt: new Date(now - 3600_000).toISOString(),
      postsChange: 18, reachChange: 24, impressionsChange: 31,
    },
    postsByType: byType,
    topPosts: published.slice(0, 5).map((p) => ({
      id: p.id, title: p.title, type: p.type, status: p.status, content: p.content.slice(0, 300), hashtags: p.hashtags,
      publishedAt: p.publishedAt, instagramPostId: p.instagramPostId, mediaUrls: p.mediaUrls,
      reach: p.analytics.reach, likes: p.analytics.likes, comments: p.analytics.comments, saves: p.analytics.saves,
      impressions: p.analytics.impressions, engagementRate: p.analytics.engagementRate, viralScore: p.viralScore,
    })),
    weeklyTrend, accountTrend,
    aiStats: { totalGenerations: 64, byType: byType.map((t) => ({ ...t, totalTokens: t.count * 1850 })) },
    dateRange: { from: new Date(now - 30 * DAY).toISOString(), to: new Date(now).toISOString() },
  };

  const commenters = ["Priya S.", "Marco", "Aiko", "Sam R.", "Leila", "Tom B.", "Nina", "Chris"];
  const commentTexts = [
    "Tried this tonight and it actually worked!", "B for sure, bread flour every time", "Wait, I've been doing this wrong for years 😅",
    "Can you do one on sourdough starters?", "Saved! Making this for meal prep Sunday", "The foil trick is a game changer",
    "Overproofed? My loaves always do this", "More knife skills videos please 🔪",
  ];
  const comments = commentTexts.map((text, i) => {
    const v = recentVideos[i % recentVideos.length];
    return { commentId: `demo-c${i + 1}`, text, author: commenters[i], publishedAt: new Date(now - (i + 1) * 3.3 * 3600_000).toISOString(), videoId: v.videoId, videoTitle: v.title, url: "#" };
  });

  const scheduledPosts = posts.filter((p) => p.status === "SCHEDULED").map((p, i) => ({
    id: `demo-sched-${i + 1}`, userId: "demo-user", postId: p.id, postType: p.type, platform: "youtube",
    title: p.title, content: p.content, hashtags: p.hashtags, mediaUrl: p.mediaUrls[0] || null,
    scheduledFor: p.scheduledFor, timezone: "UTC", status: "PENDING", retryCount: 0, isRecurring: false, recurringRule: null,
    publishedAt: null, instagramPostId: null, youtubeVideoId: null, error: null, brandId: null, createdAt: p.createdAt,
  }));

  const LABELS = { POST_CREATED: "Created a post", POST_PUBLISHED: "Published to YouTube", POST_SCHEDULED: "Scheduled a post", POST_UPDATED: "Updated a post" };
  const logs = posts.flatMap((p, i) => {
    const out = [{ id: `demo-log-${i}-c`, userId: "demo-user", action: "POST_CREATED", entity: "Post", entityId: p.id, metadata: { title: p.title, type: p.type }, createdAt: p.createdAt }];
    if (p.status === "PUBLISHED") out.push({ id: `demo-log-${i}-p`, userId: "demo-user", action: "POST_PUBLISHED", entity: "Post", entityId: p.id, metadata: { title: p.title, youtubeVideoId: p.youtubeVideoId }, createdAt: p.publishedAt });
    if (p.status === "SCHEDULED") out.push({ id: `demo-log-${i}-s`, userId: "demo-user", action: "POST_SCHEDULED", entity: "Post", entityId: p.id, metadata: { title: p.title, scheduledFor: p.scheduledFor }, createdAt: p.updatedAt });
    return out;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((l) => ({ ...l, label: LABELS[l.action] ?? l.action }));

  const prefs = JSON.parse(JSON.stringify({ ...DEFAULTS, brand }));
  prefs.youtube = { ...prefs.youtube, enabled: true, topics: brand.topics };
  prefs.autoPost = { ...prefs.autoPost, enabled: true, topics: brand.topics };

  // ── Instagram ─────────────────────────────────────────────────────────────
  const igProfile = {
    username: "demokitchen", name: "Demo Kitchen", biography: "Weeknight dinners, made simple. New recipe every day.",
    website: "https://example.com", profilePicture: "", followers: 12970, following: 180, mediaCount: 64,
  };
  const igMedia = published.map((p, i) => ({
    id: p.instagramPostId, caption: `${p.hook}

${p.hashtags.join(" ")}`, media_type: "IMAGE",
    media_url: p.mediaUrls[0] || "", thumbnail_url: p.mediaUrls[0] || "", permalink: "#",
    like_count: p.analytics.likes, comments_count: p.analytics.comments, timestamp: p.publishedAt,
  }));
  const igComments = [
    ["sarah_cooks", "This worked perfectly, thank you!", "positive", true, "So glad it worked! Thanks for cooking along 🙌"],
    ["mike.eats", "Wait, do I salt before or after boiling?", "neutral", true, "Salt the water once it's boiling — then add the pasta 👍"],
    ["hungry_dad", "Tried it, family loved it 🔥", "positive", true, "Amazing! Tell them we said hi 👋"],
    ["nina_bakes", "Mine came out too dense, any tips?", "neutral", false, null],
    ["theo.k", "Too much salt for me tbh", "negative", false, null],
    ["cook_with_al", "Saving this for Sunday prep", "positive", true, "Perfect Sunday job — enjoy! 🍝"],
  ].map(([username, text, sentiment, replied, replyText], i) => {
    const media = igMedia[i % igMedia.length];
    return {
      id: `demo-igc-${i + 1}`, postId: media.id, mediaId: media.id, username, text,
      timestamp: new Date(now - (i + 1) * 2.5 * 3600_000).toISOString(),
      createdAt: new Date(now - (i + 1) * 2.5 * 3600_000).toISOString(),
      likeCount: 3 + i, sentiment, replied, replyText, replies: [],
    };
  });
  const dmThread = (i, username, lines) => {
    const messages = lines.map(([isOurs, message], j) => ({
      id: `demo-dm-${i}-${j}`, from: { id: isOurs ? "demo-page" : `u${i}`, name: isOurs ? "Demo Kitchen" : username },
      message, created_time: new Date(now - (6 - j) * 1800_000 - i * 3600_000).toISOString(), isOurs,
    }));
    return {
      id: `demo-convo-${i}`, participants: [{ id: `u${i}`, username }],
      updatedTime: messages[messages.length - 1].created_time,
      messageCount: messages.length, unreadCount: 0,
      latestMessage: messages[messages.length - 1], messages,
    };
  };
  const igDms = [
    dmThread(1, "sarah_cooks", [[false, "Do you have a vegetarian version of the one-pan dinner?"], [true, "Yes! Swap the chicken for chickpeas and roast 10 minutes less 🌱"], [false, "Perfect, thank you!"]]),
    dmThread(2, "mike.eats", [[false, "What pan do you use in the videos?"], [true, "A 28cm cast-iron skillet — anything oven-safe works 👌"]]),
    dmThread(3, "nina_bakes", [[false, "Can I prep the dough the night before?"]]),
  ];

  const fixtures = {
    generatedAt: new Date(now).toISOString(),
    brand, prefs,
    brands: [{ id: "primary", label: "Demo Kitchen", isPrimary: true, active: true, ytChannelTitle: "Demo Kitchen", hasYouTube: true }],
    account: { name: "Demo User", email: "demo@example.com" },
    posts: posts.map(({ _views, ...p }) => p),
    analytics,
    youtube: {
      configured: true, enabled: true,
      channel: { title: "Demo Kitchen", thumbnail: "" },
      stats: { subscribers: 12970, views: totalViews, videos: 64, channelTitle: "Demo Kitchen", thumbnail: "", channelViews: totalViews },
      recentVideos,
    },
    comments, scheduledPosts, logs,
    instagram: {
      profile: igProfile,
      insights: {
        reach: analytics.overview.totalReach, impressions: analytics.overview.totalImpressions,
        profileVisits: 4820, websiteClicks: 260, engagementRate: 6.4,
        totalLikes: analytics.overview.totalLikes, totalComments: analytics.overview.totalComments,
      },
      recentMedia: igMedia.slice(0, 6),
      topPosts: [...igMedia].sort((a, b) => (b.like_count + b.comments_count) - (a.like_count + a.comments_count)).slice(0, 5),
      fetchedAt: new Date(now).toISOString(),
      comments: igComments,
      dms: igDms,
      postInsights: published.map((p) => ({
        postId: p.id, instagramPostId: p.instagramPostId, title: p.title, type: p.type,
        publishedAt: p.publishedAt, content: p.content.slice(0, 300), hashtags: p.hashtags,
        likes: p.analytics.likes, comments: p.analytics.comments, saves: p.analytics.saves,
        reach: p.analytics.reach, impressions: p.analytics.impressions, engagementRate: p.analytics.engagementRate,
        mediaUrl: p.mediaUrls[0] || null, thumbnail: p.mediaUrls[0] || null, permalink: "#", mediaType: "IMAGE",
      })),
    },
  };
  fs.writeFileSync(path.join(outDir, "fixtures.json"), JSON.stringify(fixtures));
  console.log(`fixtures: ${posts.length} posts, ${comments.length} comments, ${logs.length} log entries`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
