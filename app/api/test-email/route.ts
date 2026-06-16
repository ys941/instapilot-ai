import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { sendTestEmail } from "@/lib/notifier";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const result = await sendTestEmail();
    if (result.ok) {
      return NextResponse.json({ success: true, message: "Test email sent successfully!" });
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}
