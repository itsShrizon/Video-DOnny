import { NextRequest, NextResponse } from "next/server";
import { textToSpeech } from "@/lib/openai";
import { generateMusic } from "@/lib/musicgen";
import { uploadBufferToGCS } from "@/lib/gcs";
import { withErrorHandler } from "@/lib/api-wrap";

export const maxDuration = 60;

// Generate audio: TTS for voiceover, or music for musicgen mode
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { audioMode, script, jobId } = await req.json();

  if (audioMode === "voiceover") {
    // Generate TTS for each script sentence
    const ttsBuffers = await Promise.all(
      script.map((s: string) => textToSpeech(s))
    );
    const audioUrls = await Promise.all(
      ttsBuffers.map((buf: Buffer, i: number) =>
        uploadBufferToGCS(buf, `jobs/${jobId}/audio/tts-${i}.mp3`, "audio/mpeg")
      )
    );
    return NextResponse.json({ audioUrls, isBgMusic: false });
  } else if (audioMode === "musicgen") {
    const musicBuf = await generateMusic();
    const url = await uploadBufferToGCS(
      musicBuf,
      `jobs/${jobId}/audio/musicgen.mp3`,
      "audio/mpeg"
    );
    return NextResponse.json({ audioUrls: [url], isBgMusic: true });
  }

  // custom audio mode: audioUrl already uploaded in upload step
  return NextResponse.json({ audioUrls: [], isBgMusic: true });
});
