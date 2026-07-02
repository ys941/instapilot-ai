﻿/**
 * GET  /api/settings/instagram   -  return current Instagram credentials + token health
 * POST /api/settings/instagram   -  validate token then persist to User table in DB
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";
import { resolveBrandId, getPrimaryBrandId, getBrandCredentials, updateBrandCredentials } from "@/lib/brands";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

// Probes the Graph API on every load — never let upstream cache it.
export const dynamic = "force-dynamic";

// -- Helper: probe a token and return health info ------------------------------
async function probeToken(token: string) {
  try {
    // Bound outbound Graph calls so a hung upstream can't block the settings tab.
    const res  = await fetch(`${GRAPH_BASE}/me?fields=id,name&access_token=${token}`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (data.error) return { valid: false, error: data.error.message as string, name: null, id: null };

    // Also get expiry from debug_token
    let expiresAt: string | null = null;
    try {
      const dbRes  = await fetch(`${GRAPH_BASE}/debug_token?input_token=${token}&access_token=${token}`, { signal: AbortSignal.timeout(8000) });
      const dbData = await dbRes.json();
      const exp    = dbData?.data?.expires_at;
      if (exp && exp !== 0) {
        expiresAt = new Date(exp * 1000).toISOString();
      }
    } catch {}

    return { valid: true, error: null, name: data.name as string, id: data.id as string, expiresAt };
  } catch (e: any) {
    return { valid: false, error: e?.message ?? "Network error", name: null, id: null, expiresAt: null };
  }
}

// -- GET  -  load current settings -----------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Brand scope: no/unknown brand resolves to the primary → legacy User-row path below.
    const brand      = brandFromQuery(request);
    const resolvedId = await resolveBrandId(brand);
    const primaryId  = await getPrimaryBrandId();

    let token: string, igId: string, pageId: string, source: "database" | "env";
    if (resolvedId !== primaryId) {
      // Non-primary brand → its stored credential columns (the same storage the
      // brand publishing pipeline reads via getBrandCredentials).
      const c = await getBrandCredentials(resolvedId);
      token  = c.igToken;
      igId   = c.igAcctId;
      pageId = c.fbPageId;
      source = "database";
    } else {
      const user = await prisma.user.findUnique({
        where:  { id: session.user.id },
        select: { instagramToken: true, instagramAccountId: true },
      });

      // Use DB value; fall back to env vars
      token  = user?.instagramToken    || process.env.INSTAGRAM_ACCESS_TOKEN || "";
      igId   = user?.instagramAccountId || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "";
      pageId = process.env.FACEBOOK_PAGE_ID || "";
      source = user?.instagramToken ? "database" : "env";
    }

    // Probe the token
    const health = token ? await probeToken(token) : { valid: false, error: "No token configured", name: null, id: null, expiresAt: null };

    return NextResponse.json({
      success: true,
      data: {
        // Mask token  -  only return first 12 + last 4 chars
        tokenMasked:   token ? `${token.slice(0, 12)}...${token.slice(-4)}` : "",
        tokenPresent:  !!token,
        accountId:     igId,
        pageId,
        tokenValid:    health.valid,
        tokenError:    health.error,
        accountName:   health.name,
        expiresAt:     health.expiresAt ?? null,
        source,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}

// -- POST  -  validate + save new token -----------------------------------------
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
    const token = (body.accessToken ?? "").trim();
    const igId  = (body.accountId   ?? "").trim();

    // Brand scope: no/unknown brand resolves to the primary → legacy User-row path below.
    const brand      = brandFromBody(body, brandFromQuery(request));
    const resolvedId = await resolveBrandId(brand);
    const primaryId  = await getPrimaryBrandId();

    if (!token) {
      return NextResponse.json({ success: false, error: "Access token is required" }, { status: 400 });
    }

    // Validate the token against the Graph API before saving
    const health = await probeToken(token);
    if (!health.valid) {
      return NextResponse.json({
        success: false,
        error:   `Token validation failed: ${health.error}`,
      }, { status: 422 });
    }

    // Resolve account ID  -  use provided, or try to auto-detect from the token
    let resolvedIgId = igId;
    if (!resolvedIgId) {
      try {
        // Attempt to find the linked IG Business Account
        const meRes  = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${token}`);
        const meData = await meRes.json();
        const page   = (meData.data ?? [])[0];
        if (page?.id) {
          const igRes  = await fetch(`${GRAPH_BASE}/${page.id}?fields=instagram_business_account&access_token=${page.access_token || token}`);
          const igData = await igRes.json();
          resolvedIgId = igData?.instagram_business_account?.id ?? "";
        }
      } catch {}
    }

    if (resolvedId !== primaryId) {
      // Non-primary brand → persist to its Brand credential columns (the same
      // storage the brand publishing pipeline reads via getBrandCredentials),
      // never the primary account's User row.
      await updateBrandCredentials(resolvedId, {
        igToken: token,
        ...(resolvedIgId ? { igAcctId: resolvedIgId } : {}),
      });
    } else {
      // Persist to User record  -  now the entire app reads from here first
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          instagramToken:     token,
          instagramAccountId: resolvedIgId || undefined,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        accountName: health.name,
        accountId:   resolvedIgId,
        expiresAt:   health.expiresAt ?? null,
        tokenValid:  true,
      },
    });
  } catch (error: any) {
    console.error("[Settings Instagram POST]", error?.message);
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}

