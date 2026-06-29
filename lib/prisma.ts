﻿import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error"], // query logging removed  -  was adding ~10-30ms overhead per request in dev
  });

// Cache on globalThis in ALL environments to avoid duplicate clients / connection
// exhaustion if this module is ever re-evaluated (e.g. HMR or serverless reload).
globalForPrisma.prisma = prisma;

