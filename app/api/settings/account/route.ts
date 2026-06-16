﻿/**
 * GET  /api/settings/account  -  return current user name + email
 * POST /api/settings/account  -  update name, email, and optionally password
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { name: true, email: true },
    });
    return NextResponse.json({
      success: true,
      data: { name: user?.name ?? "", email: user?.email ?? "" },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const name    = (body.name    ?? "").trim();
    const email   = (body.email   ?? "").trim();
    const currentPassword = (body.currentPassword ?? "").trim();
    const newPassword     = (body.newPassword     ?? "").trim();

    const updateData: Record<string, any> = {};
    if (name)  updateData.name  = name;
    if (email) updateData.email = email;

    // Handle password change
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ success: false, error: "Current password is required to set a new password" }, { status: 400 });
      }
      const user = await prisma.user.findUnique({ where: { id: session.user.id } });
      // For the local-no-auth user, skip current password check
      if (user?.password !== "local-no-auth") {
        const valid = await bcrypt.compare(currentPassword, user?.password ?? "");
        if (!valid) {
          return NextResponse.json({ success: false, error: "Current password is incorrect" }, { status: 400 });
        }
      }
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where:  { id: session.user.id },
      data:   updateData,
      select: { name: true, email: true },
    });

    return NextResponse.json({ success: true, data: { name: updated.name, email: updated.email } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

