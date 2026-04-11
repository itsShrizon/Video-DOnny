// HuggingFace free serverless inference no longer supports MusicGen.
// Fallback: use OpenAI TTS to generate a soft ambient narration as background audio.
// This produces a gentle spoken "mood" track — not music, but a usable audio layer.

import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export async function generateMusic(): Promise<Buffer> {
  const openai = getOpenAI();

  // Generate a calm ambient narration to use as background audio
  const res = await openai.audio.speech.create({
    model: "tts-1",
    voice: "shimmer",
    input:
      "Welcome to this beautiful property. Take a moment to explore each room and imagine yourself living here. This home is waiting for you.",
    speed: 0.85,
  });

  return Buffer.from(await res.arrayBuffer());
}
