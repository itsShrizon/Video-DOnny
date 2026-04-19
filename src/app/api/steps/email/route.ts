import { NextRequest, NextResponse } from "next/server";
import { sendVideoEmail } from "@/lib/email";
import { withErrorHandler } from "@/lib/api-wrap";

export const maxDuration = 60;

export const POST = withErrorHandler(async (req: NextRequest) => {
  const { email, videoUrl } = await req.json();
  await sendVideoEmail(email, videoUrl);
  return NextResponse.json({ sent: true });
});
