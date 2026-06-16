﻿// Local-only mode  -  no login required.
// On first call, upserts the local user into the DB (satisfies all FK constraints).
// Does NOT overwrite instagramToken/instagramAccountId on subsequent restarts  - 
// those are managed by the user via Settings -> Instagram.

import { prisma } from "@/lib/prisma";

export interface LocalUser {
  id: string;
  email: string;
  name: string;
  role: string;
  instagramAccountId: string | null;
  instagramToken: string | null;
}

export async function getServerSession(..._args: unknown[]): Promise<{ user: LocalUser }> {
  // Always read fresh from DB so token updates via Settings are reflected immediately.
  // On first run, create the local user seeded with env-var credentials.
  // Always sync token from .env.local so updating the env var takes effect immediately
  // without needing to wipe the DB. Settings UI can still override per-request.
  const envToken  = process.env.INSTAGRAM_ACCESS_TOKEN       ?? null;
  const envIgId   = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? null;
  const BRAND_NAME = process.env.BRAND_NAME ?? "InstaPilot AI";

  const user = await prisma.user.upsert({
    where: { id: "local-user" },
    update: {
      ...(envToken && { instagramToken: envToken }),
      ...(envIgId  && { instagramAccountId: envIgId }),
    },
    create: {
      id:                 "local-user",
      email:              "local@localhost",
      name:               `${BRAND_NAME} User`,
      password:           "local-no-auth",
      role:               "ADMIN",
      instagramToken:     envToken,
      instagramAccountId: envIgId,
    },
  });

  return {
    user: {
      id:                 user.id,
      email:              user.email,
      name:               user.name ?? `${BRAND_NAME} User`,
      role:               user.role,
      instagramToken:     user.instagramToken,
      instagramAccountId: user.instagramAccountId,
    },
  };
}

// Kept for import compatibility
export const authOptions = {};

