import { NextRequest, NextResponse } from "next/server";
import { analyzeImage } from "@/lib/openai";

export const maxDuration = 60;

// Analyze all images with OpenAI Vision (parallel)
export async function POST(req: NextRequest) {
  const { imageUrls } = await req.json();

  const results = await Promise.all(
    imageUrls.map(async (url: string) => {
      const analysis = await analyzeImage(url);
      return { url, ...analysis };
    })
  );

  return NextResponse.json({ images: results });
}
