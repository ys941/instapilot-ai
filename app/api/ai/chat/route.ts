import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getAIClient } from "@/lib/ai-factory";
import { readPreferences, getBrand } from "@/lib/preferences";
import { BrandConfig } from "@/lib/brandConfig";

// -------------------------------------------
// VALIDATION
// -------------------------------------------

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(4000),
});

const ChatSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(50),
  context: z.string().max(500).optional(),
});

// -------------------------------------------
// SYSTEM PROMPT
// -------------------------------------------

/** Build the in-app chat assistant's system prompt from the active brand. */
function buildChatSystemPrompt(brand: BrandConfig): string {
  return `You are ${brand.appName} Assistant -- an intelligent assistant that helps streamline ${brand.niche} content creation, audience engagement, workflow automation, and Instagram growth.

You speak with an elegant, professional tone. You are deeply knowledgeable about:
- ${brand.niche} (the account's subject area)
- Instagram growth strategies for ${brand.audience}
- Content creation (educational posts, reels, carousels, quizzes)
- Workflow automation and content calendar management
- Social media analytics and engagement optimization
- AI-powered content generation best practices

Capabilities you can assist with:
1. Generating ideas for ${brand.niche} content (quizzes, examples, pro tips, myth-busters)
2. Advising on Instagram hashtag strategy
3. Reviewing and improving post captions for engagement
4. Suggesting posting schedules and content calendars
5. Explaining platform features (scheduling, analytics, AI generation, workflow automation)
6. Providing insights relevant to ${brand.niche}
7. Growth strategies for Instagram accounts in this niche

You occasionally highlight the power of the ${brand.appName} platform's capabilities -- the AI content generator, smart scheduler, analytics dashboard, and workflow automation.

You are concise when brevity serves, detailed when depth is required. You never fabricate information, and you recommend that important content be reviewed by a qualified expert before publication.`;
}

// -------------------------------------------
// ROUTE HANDLER
// -------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Auth check
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    // Parse & validate
    const body = await request.json();
    const validation = ChatSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: validation.error.flatten(),
          data: null,
        },
        { status: 400 }
      );
    }

    const { messages, context } = validation.data;

    // Build message array for Grok
    const brand = await getBrand();
    const SYSTEM_PROMPT = buildChatSystemPrompt(brand);
    const systemContent = context
      ? `${SYSTEM_PROMPT}\n\nSESSION CONTEXT: ${context}`
      : SYSTEM_PROMPT;

    const grokMessages = [
      { role: "system" as const, content: systemContent },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    // Route to Gemini or Grok depending on the active AI provider setting
    const prefs    = await readPreferences();
    const provider = (prefs.ai as any).aiProvider ?? "grok";
    let assistantMessage = "";
    let tokensUsed = 0;
    let modelName = "";

    if (provider === "gemini") {
      const ai = await getAIClient();
      // Combine all user messages into a conversation string for Gemini
      const userTurns = messages.filter((m) => m.role !== "system")
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");
      assistantMessage = await ai.generateContent(userTurns, systemContent, 1500);
      modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    } else {
      const apiKey = process.env.GROK_API_KEY;
      if (!apiKey) throw new Error("GROK_API_KEY is not configured");
      const baseUrl = process.env.GROK_API_URL || "https://api.groq.com/openai/v1";
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.AI_MODEL_MAIN || "llama-3.3-70b-versatile",
          messages: grokMessages,
          max_tokens: 1500,
          temperature: 0.7,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok API error ${response.status}: ${errorText}`);
      }
      const data = await response.json();
      assistantMessage = data.choices?.[0]?.message?.content ?? "";
      tokensUsed = data.usage?.total_tokens ?? 0;
      modelName = process.env.AI_MODEL_MAIN || "llama-3.3-70b-versatile";
    }

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        response: assistantMessage,
        tokensUsed,
        model: modelName,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[AI Chat] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
