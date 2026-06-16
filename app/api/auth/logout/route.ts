import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ success: true });

  // Must match EVERY attribute used at login time or browsers ignore the deletion.
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   -1,       // -1 = expire immediately (more reliable than 0)
    path:     "/",
    expires:  new Date(0),   // belt-and-suspenders: explicit past date
  });
  return res;
}
