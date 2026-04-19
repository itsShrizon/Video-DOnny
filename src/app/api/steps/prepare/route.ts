import { NextRequest, NextResponse } from "next/server";
import {
  pickBest6Images,
  generateTitles,
  generateScript,
} from "@/lib/openai";
import { withErrorHandler } from "@/lib/api-wrap";

export const maxDuration = 60;

// Pick best 6 images + generate titles + generate script
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { images, description, priceRange, audioMode } = await req.json();

  // Parallel: pick images + titles + script
  const [best6, titles, script] = await Promise.all([
    pickBest6Images(images),
    generateTitles(description, priceRange),
    audioMode === "voiceover"
      ? generateScript(description, priceRange)
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ best6, titles, script });
});
