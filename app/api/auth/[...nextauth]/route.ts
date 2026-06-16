import { NextResponse } from "next/server";

// Auth disabled in local mode — dashboard is open without login.
export async function GET() {
  return NextResponse.json({ message: "Auth disabled in local mode" });
}

export async function POST() {
  return NextResponse.json({ message: "Auth disabled in local mode" });
}
