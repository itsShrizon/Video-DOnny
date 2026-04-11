import { NextRequest, NextResponse } from "next/server";
import {
  pickBest6Images,
  generateTitles,
  generateScript,
  textToSpeech,
} from "@/lib/openai";
import { generateMusic } from "@/lib/musicgen";
import { uploadBufferToGCS } from "@/lib/gcs";

export const maxDuration = 60;

// Pick best 6 images + generate titles + generate script/audio
export async function POST(req: NextRequest) {
  const { images, description, priceRange, audioMode, jobId } =
    await req.json();

  // Parallel: pick images + titles + script
  const [best6, titles, script] = await Promise.all([
    pickBest6Images(images),
    generateTitles(description, priceRange),
    audioMode === "voiceover"
      ? generateScript(description, priceRange)
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ best6, titles, script });
}
