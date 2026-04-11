import { NextRequest, NextResponse } from "next/server";
import { sendVideoEmail } from "@/lib/email";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { email, videoUrl } = await req.json();
  await sendVideoEmail(email, videoUrl);
  return NextResponse.json({ sent: true });
}
