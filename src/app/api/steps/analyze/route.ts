import { NextRequest, NextResponse } from "next/server";
import { analyzeImage } from "@/lib/openai";
import { withErrorHandler } from "@/lib/api-wrap";

export const maxDuration = 60;

// Analyze all images with OpenAI Vision (parallel)
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { imageUrls } = await req.json();

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return NextResponse.json(
      { error: "Missing or empty imageUrls" },
      { status: 400 }
    );
  }

  const results = await Promise.all(
    imageUrls.map(async (url: string) => {
      try {
        const analysis = await analyzeImage(url);
        return { url, ...analysis };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`analyzeImage failed for ${url}: ${msg}`);
      }
    })
  );

  return NextResponse.json({ images: results });
});
