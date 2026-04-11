import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { uploadBufferToGCS } from "@/lib/gcs";
import {
  analyzeImage,
  pickBest6Images,
  generateTitles,
  generateScript,
  textToSpeech,
} from "@/lib/openai";
import {
  imageToVideo,
  verticalScale,
  overlayVisuals,
  overlayAudio,
  addBackgroundMusic,
  concatenateVideos,
} from "@/lib/nca";
import { generateMusic } from "@/lib/musicgen";
import { sendVideoEmail } from "@/lib/email";
import { createJob, updateJob } from "@/lib/progress";

export const maxDuration = 300; // 5 min for Vercel (Pro plan)

export async function POST(req: NextRequest) {
  const jobId = uuid();
  createJob(jobId);

  const formData = await req.formData();
  const description = formData.get("description") as string;
  const priceRange = formData.get("priceRange") as string;
  const email = formData.get("email") as string;
  const audioMode = formData.get("audioMode") as string; // "voiceover" | "custom" | "musicgen"
  const logoFile = formData.get("logo") as File;
  const customAudioFile = formData.get("customAudio") as File | null;
  const imageFiles: File[] = [];

  for (const [key, value] of formData.entries()) {
    if (key === "images" && value instanceof File) {
      imageFiles.push(value);
    }
  }

  if (!imageFiles.length || !description || !email || !logoFile) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Return job ID immediately, process in background
  const responsePromise = NextResponse.json({ jobId });

  // Fire-and-forget the pipeline
  runPipeline(
    jobId,
    imageFiles,
    logoFile,
    description,
    priceRange,
    email,
    audioMode,
    customAudioFile
  ).catch((err) => {
    console.error("Pipeline failed:", err);
    updateJob(jobId, {
      status: "failed",
      step: "Pipeline failed",
      error: err.message,
    });
  });

  return responsePromise;
}

async function runPipeline(
  jobId: string,
  imageFiles: File[],
  logoFile: File,
  description: string,
  priceRange: string,
  email: string,
  audioMode: string,
  customAudioFile: File | null
) {
  const ts = Date.now();

  // ── Step 1: Upload images + logo to GCS ──────────────────────────
  updateJob(jobId, {
    status: "processing",
    step: "Uploading files to cloud storage...",
    stepNumber: 1,
  });

  const imageUploadPromises = imageFiles.map(async (file, i) => {
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "jpg";
    const url = await uploadBufferToGCS(
      buf,
      `jobs/${jobId}/images/img-${i}.${ext}`,
      file.type || "image/jpeg"
    );
    return url;
  });

  const logoBuf = Buffer.from(await logoFile.arrayBuffer());
  const logoExt = logoFile.name.split(".").pop() || "png";
  const logoUrlPromise = uploadBufferToGCS(
    logoBuf,
    `jobs/${jobId}/logo.${logoExt}`,
    logoFile.type || "image/png"
  );

  const [imageUrls, logoUrl] = await Promise.all([
    Promise.all(imageUploadPromises),
    logoUrlPromise,
  ]);

  // ── Step 2: Analyze all images with OpenAI Vision ────────────────
  updateJob(jobId, {
    step: "Analyzing property images with AI...",
    stepNumber: 2,
  });

  const analysisResults = await Promise.all(
    imageUrls.map(async (url) => {
      const analysis = await analyzeImage(url);
      return { url, ...analysis };
    })
  );

  // ── Step 3: Pick best 6 images + Generate titles (parallel) ──────
  updateJob(jobId, {
    step: "Selecting best images & generating titles...",
    stepNumber: 3,
  });

  const [best6, titles] = await Promise.all([
    pickBest6Images(analysisResults),
    generateTitles(description, priceRange),
  ]);

  // ── Step 4: Handle audio based on mode ───────────────────────────
  updateJob(jobId, {
    step: "Preparing audio...",
    stepNumber: 4,
  });

  let audioUrls: string[] = [];
  let isBgMusic = false; // true for custom audio and musicgen modes

  if (audioMode === "voiceover") {
    // Generate script + TTS for each of the 6 clips
    const script = await generateScript(description, priceRange);
    const ttsBuffers = await Promise.all(script.map((s) => textToSpeech(s)));
    audioUrls = await Promise.all(
      ttsBuffers.map((buf, i) =>
        uploadBufferToGCS(
          buf,
          `jobs/${jobId}/audio/tts-${i}.mp3`,
          "audio/mpeg"
        )
      )
    );
  } else if (audioMode === "custom" && customAudioFile) {
    // Upload custom audio to GCS
    const buf = Buffer.from(await customAudioFile.arrayBuffer());
    const ext = customAudioFile.name.split(".").pop() || "mp3";
    const url = await uploadBufferToGCS(
      buf,
      `jobs/${jobId}/audio/custom.${ext}`,
      customAudioFile.type || "audio/mpeg"
    );
    audioUrls = [url];
    isBgMusic = true;
  } else if (audioMode === "musicgen") {
    // Generate free AI music
    const musicBuf = await generateMusic();
    const url = await uploadBufferToGCS(
      musicBuf,
      `jobs/${jobId}/audio/musicgen.wav`,
      "audio/wav"
    );
    audioUrls = [url];
    isBgMusic = true;
  }

  // ── Step 5: Convert each image to 5s video ───────────────────────
  updateJob(jobId, {
    step: "Converting images to video clips...",
    stepNumber: 5,
  });

  const rawVideos: string[] = [];
  for (let i = 0; i < best6.length; i++) {
    const vid = await imageToVideo(best6[i], i);
    rawVideos.push(vid);
  }

  // ── Step 6: Scale to vertical format ─────────────────────────────
  updateJob(jobId, {
    step: "Scaling to vertical format...",
    stepNumber: 6,
  });

  const scaledVideos: string[] = [];
  for (const vid of rawVideos) {
    const scaled = await verticalScale(vid);
    scaledVideos.push(scaled);
  }

  // ── Step 7: Overlay text captions + logo ─────────────────────────
  updateJob(jobId, {
    step: "Adding text overlays & logo...",
    stepNumber: 7,
  });

  const visualVideos: string[] = [];
  for (let i = 0; i < scaledVideos.length; i++) {
    const overlaid = await overlayVisuals(
      scaledVideos[i],
      logoUrl,
      titles[i] || ""
    );
    visualVideos.push(overlaid);
  }

  // ── Step 8: Add audio ────────────────────────────────────────────
  updateJob(jobId, {
    step: "Adding audio...",
    stepNumber: 8,
  });

  let audioVideos: string[];

  if (isBgMusic) {
    // For custom audio / musicgen: first concat all clips, then add music as background
    // We'll add silent audio tracks first, concat, then overlay music
    audioVideos = visualVideos; // skip per-clip audio, add music after concat
  } else {
    // Voiceover mode: overlay each TTS clip onto its matching video
    audioVideos = [];
    for (let i = 0; i < visualVideos.length; i++) {
      const withAudio = await overlayAudio(visualVideos[i], audioUrls[i]);
      audioVideos.push(withAudio);
    }
  }

  // ── Step 9: Concatenate all clips ────────────────────────────────
  updateJob(jobId, {
    step: "Concatenating final video...",
    stepNumber: 9,
  });

  let finalVideoUrl: string;

  if (isBgMusic) {
    // Concat video-only clips first, then add bg music
    const concatted = await concatenateVideos(audioVideos);
    finalVideoUrl = await addBackgroundMusic(concatted, audioUrls[0]);
  } else {
    finalVideoUrl = await concatenateVideos(audioVideos);
  }

  // ── Step 10: Send email ──────────────────────────────────────────
  updateJob(jobId, {
    step: "Sending email...",
    stepNumber: 10,
  });

  await sendVideoEmail(email, finalVideoUrl);

  updateJob(jobId, {
    status: "completed",
    step: "Done! Video sent to your email.",
    stepNumber: 10,
    videoUrl: finalVideoUrl,
  });
}
