﻿import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBrand } from "@/lib/preferences";

const GRAPH_BASE       = "https://graph.facebook.com/v25.0";
const FALLBACK_PAGE_ID = process.env.FACEBOOK_PAGE_ID ?? "";
const FALLBACK_IG_ID   = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";

// --- GET  -  Fetch conversations ------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const token   = session?.user?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN;
    const igId    = session?.user?.instagramAccountId || FALLBACK_IG_ID;

    if (!token || !igId) {
      return NextResponse.json(
        { success: false, error: "Instagram not configured", data: null },
        { status: 422 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") ?? "20";

    // Our own display name/handle for "our reply" message labels.
    const brand = await getBrand();
    const ourName = (brand.persona.handle || "").replace(/^@/, "") || brand.persona.displayName || "us";

    // -- Step 1: Resolve Page Access Token -------------------------------------
    let pageToken: string = process.env.FACEBOOK_PAGE_ACCESS_TOKEN ?? token;
    let pageId: string    = FALLBACK_PAGE_ID;

    if (!process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
      try {
        const pagesRes  = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${token}`);
        const pagesData = await pagesRes.json();
        if (!pagesData.error && (pagesData.data ?? []).length > 0) {
          pageToken = pagesData.data[0].access_token;
          pageId    = pagesData.data[0].id;
        } else {
          const directRes  = await fetch(`${GRAPH_BASE}/${pageId}?fields=access_token,name&access_token=${token}`);
          const directData = await directRes.json();
          if (!directData.error && directData.access_token) {
            pageToken = directData.access_token;
          }
        }
      } catch { /* use original token */ }
    }

    const conversationFields =
      "id,participants,updated_time,message_count,unread_count,messages{id,from,message,created_time}";

    // -- Step 2: Try Conversations API (requires Live mode + instagram_manage_messages) -
    let conversations: any[] = [];
    let apiNote: string | null = null;
    let diagnosisCode: string | null = null;
    let errorCode: number | null = null;

    const tryFetch = async (scopeId: string, tok: string) => {
      const url = `${GRAPH_BASE}/${scopeId}/conversations?platform=instagram&fields=${conversationFields}&limit=${limit}&access_token=${tok}`;
      const res  = await fetch(url);
      return res.json();
    };

    let convoData = await tryFetch(pageId, pageToken);

    if (convoData.error && igId) {
      console.log("[IG DMs] Page-scoped failed, trying IG account ID:", convoData.error.message);
      const convoData2 = await tryFetch(igId, token);
      if (!convoData2.error) convoData = convoData2;
    }

    if (convoData.error) {
      apiNote   = convoData.error.message ?? "Instagram DM access is unavailable";
      errorCode = convoData.error.code    ?? null;
      const subCode = convoData.error.error_subcode ?? null;

      if (
        errorCode === 190 ||                                    // OAuthException – token expired / invalid
        subCode === 460 || subCode === 463 || subCode === 467   // specific token expiry sub-codes
      ) {
        diagnosisCode = "NEEDS_TOKEN_REFRESH";
      } else if (errorCode === 3 || apiNote?.toLowerCase().includes("capability")) {
        diagnosisCode = "NEEDS_LIVE_MODE";
      } else if (errorCode === 10 || apiNote?.toLowerCase().includes("permission")) {
        diagnosisCode = "NEEDS_APP_REVIEW";
      } else if (errorCode === 100 && apiNote?.toLowerCase().includes("valid")) {
        // Code 100: invalid parameter – usually wrong page ID or IG account ID
        diagnosisCode = "NEEDS_CONFIG";
      } else {
        // Unknown error – default to NEEDS_LIVE_MODE as the most common cause
        diagnosisCode = "NEEDS_LIVE_MODE";
      }

      console.warn(`[IG DMs] Conversations API failed (code ${errorCode}): ${apiNote}`);
      console.log(`[IG DMs] Falling back to ActivityLog for DM display`);

      // -- Fallback: build conversations from webhook-stored ActivityLog --------
      // When a DM arrives via webhook we store DM_RECEIVED + DM_AUTO_REPLIED entries.
      // Reconstruct conversations from those logs so the UI shows something useful.
      try {
        const [received, replied] = await Promise.all([
          prisma.activityLog.findMany({
            where:   { action: "DM_RECEIVED" },
            orderBy: { createdAt: "desc" },
            take:    parseInt(limit) * 2,
          }),
          prisma.activityLog.findMany({
            where:   { action: "DM_AUTO_REPLIED" },
            orderBy: { createdAt: "desc" },
            take:    parseInt(limit) * 2,
          }),
        ]);

        // Group by senderId to form conversations
        const convoMap = new Map<string, any>();

        for (const r of received) {
          const m = r.metadata as any;
          const sid = m?.senderId ?? m?.recipientId ?? r.entityId;
          if (!sid) continue;
          if (!convoMap.has(sid)) {
            convoMap.set(sid, {
              id:           `log-${sid}`,
              participants: [{ id: sid, username: /^\d+$/.test(m?.username ?? sid) ? `user_${(m?.username ?? sid).slice(-6)}` : (m?.username ?? sid) }],
              updatedTime:  r.createdAt.toISOString(),
              messageCount: 0,
              unreadCount:  0,
              messages:     [],
              fromActivityLog: true,
            });
          }
          const c = convoMap.get(sid)!;
          c.messages.push({
            id:           r.entityId,
            from:         { id: sid, name: m?.username ?? sid },
            message:      m?.text ?? "",
            created_time: r.createdAt.toISOString(),
            isOurs:       false,
          });
          c.messageCount++;
        }

        for (const r of replied) {
          const m = r.metadata as any;
          const sid = m?.recipientId ?? r.entityId;
          if (!sid || !convoMap.has(sid)) continue;
          const c = convoMap.get(sid)!;
          c.messages.push({
            id:           `reply-${r.entityId}`,
            from:         { id: FALLBACK_PAGE_ID, name: ourName },
            message:      m?.replyText ?? "",
            created_time: r.createdAt.toISOString(),
            isOurs:       true,
          });
          c.messageCount++;
        }

        conversations = Array.from(convoMap.values())
          .map((c) => ({
            ...c,
            messages: c.messages.sort(
              (a: any, b: any) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime()
            ),
            latestMessage: c.messages[0] ?? null,
          }))
          .sort((a, b) => new Date(b.updatedTime).getTime() - new Date(a.updatedTime).getTime())
          .slice(0, parseInt(limit));

        console.log(`[IG DMs] ActivityLog fallback: ${conversations.length} conversations reconstructed`);
      } catch (logErr) {
        console.error("[IG DMs] ActivityLog fallback failed:", logErr);
      }
    } else {
      conversations = (convoData.data ?? []).map((c: any) => ({
        id:            c.id,
        participants:  c.participants?.data ?? [],
        updatedTime:   c.updated_time,
        messageCount:  c.message_count ?? 0,
        unreadCount:   c.unread_count  ?? 0,
        latestMessage: c.messages?.data?.[0] ?? null,
        messages:      c.messages?.data ?? [],
      }));

      // Always supplement with ActivityLog  -  API may return empty even when
      // webhook-delivered DMs exist (historical DMs not exposed by Conversations API)
      if (conversations.length === 0) {
        try {
          const [received, replied] = await Promise.all([
            prisma.activityLog.findMany({
              where:   { action: "DM_RECEIVED" },
              orderBy: { createdAt: "desc" },
              take:    parseInt(limit) * 2,
            }),
            prisma.activityLog.findMany({
              where:   { action: "DM_AUTO_REPLIED" },
              orderBy: { createdAt: "desc" },
              take:    parseInt(limit) * 2,
            }),
          ]);

          const convoMap = new Map<string, any>();
          for (const r of received) {
            const m   = r.metadata as any;
            const sid = m?.senderId ?? m?.recipientId ?? r.entityId;
            if (!sid) continue;
            if (!convoMap.has(sid)) {
              convoMap.set(sid, {
                id:              `log-${sid}`,
                participants:    [{ id: sid, username: m?.username ?? sid }],
                updatedTime:     r.createdAt.toISOString(),
                messageCount:    0,
                unreadCount:     0,
                messages:        [],
                fromActivityLog: true,
              });
            }
            const c = convoMap.get(sid)!;
            c.messages.push({
              id:           r.entityId,
              from:         { id: sid, name: m?.username ?? sid },
              message:      m?.text ?? "",
              created_time: r.createdAt.toISOString(),
              isOurs:       false,
            });
            c.messageCount++;
          }
          for (const r of replied) {
            const m   = r.metadata as any;
            const sid = m?.recipientId ?? r.entityId;
            if (!sid || !convoMap.has(sid)) continue;
            const c = convoMap.get(sid)!;
            c.messages.push({
              id:           `reply-${r.entityId}`,
              from:         { id: FALLBACK_PAGE_ID, name: ourName },
              message:      m?.replyText ?? "",
              created_time: r.createdAt.toISOString(),
              isOurs:       true,
            });
            c.messageCount++;
          }
          if (convoMap.size > 0) {
            conversations = Array.from(convoMap.values())
              .map((c) => ({
                ...c,
                messages: c.messages.sort(
                  (a: any, b: any) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime()
                ),
                latestMessage: c.messages[0] ?? null,
              }))
              .sort((a, b) => new Date(b.updatedTime).getTime() - new Date(a.updatedTime).getTime())
              .slice(0, parseInt(limit));
            console.log(`[IG DMs] API empty  -  showing ${conversations.length} conversations from ActivityLog`);
          }
        } catch (logErr) {
          console.error("[IG DMs] ActivityLog supplement failed:", logErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        conversations,
        total: conversations.length,
        ...(apiNote && {
          note:               apiNote,
          errorCode,
          diagnosisCode,
          permissionRequired: "instagram_manage_messages",
          usingActivityLog:   true,
        }),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[IG DMs GET] Error:", message);
    return NextResponse.json({ success: false, error: message, data: null }, { status: 500 });
  }
}

// --- POST  -  Send a DM reply ---------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const { recipientId, message } = await request.json();
    if (!recipientId || !message) {
      return NextResponse.json(
        { success: false, error: "recipientId and message are required" },
        { status: 400 }
      );
    }

    const session2 = await getServerSession();
    const token  = session2?.user?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN || "";
    const pageId = process.env.FACEBOOK_PAGE_ID ?? "";

    if (!pageId) {
      return NextResponse.json(
        { success: false, error: "FACEBOOK_PAGE_ID not configured", data: null },
        { status: 422 }
      );
    }

    let pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN ?? token;
    if (!process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
      try {
        const ptRes  = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${token}`);
        const ptData = await ptRes.json();
        if (!ptData.error && (ptData.data ?? []).length > 0) {
          pageToken = ptData.data[0].access_token ?? token;
        }
      } catch {}
    }

    const res = await fetch(`${GRAPH_BASE}/${pageId}/messages`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient:    { id: recipientId },
        message:      { text: message },
        access_token: pageToken,
      }),
    });
    const data = await res.json();

    if (data.error) {
      return NextResponse.json(
        { success: false, error: data.error.message, data: null },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: { messageId: data.message_id } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[IG DMs POST] Error:", message);
    return NextResponse.json({ success: false, error: message, data: null }, { status: 500 });
  }
}

