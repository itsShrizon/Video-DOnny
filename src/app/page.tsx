"use client";

import { useState, useCallback } from "react";

type AudioMode = "voiceover" | "custom" | "musicgen";
type JobStatus = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  step: string;
  stepNumber: number;
  totalSteps: number;
  videoUrl?: string;
  error?: string;
};

export default function Home() {
  // ── Form state ────────────────────────────────────────────────────
  const [images, setImages] = useState<File[]>([]);
  const [logo, setLogo] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [email, setEmail] = useState("");
  const [audioMode, setAudioMode] = useState<AudioMode>("voiceover");
  const [customAudio, setCustomAudio] = useState<File | null>(null);

  // ── Job state ─────────────────────────────────────────────────────
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Image previews ────────────────────────────────────────────────
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [logoPrev, setLogoPrev] = useState<string | null>(null);

  const handleImages = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setImages(files);
    setImagePreviews(files.map((f) => URL.createObjectURL(f)));
  }, []);

  const handleLogo = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setLogo(file);
    setLogoPrev(file ? URL.createObjectURL(file) : null);
  }, []);

  // Resize photos before upload: OpenAI Vision rejects source images >20MB,
  // and modern phone JPEGs routinely exceed that. Cap the long edge at 1600px
  // and re-encode as JPEG — plenty of detail for classification, ~300–600KB.
  async function resizeImage(file: File): Promise<File> {
    const MAX_DIM = 1600;
    const QUALITY = 0.85;
    try {
      const img = await createImageBitmap(file);
      const longEdge = Math.max(img.width, img.height);
      const scale = Math.min(1, MAX_DIM / longEdge);
      // Skip re-encode if already small enough (<3MB and within dims)
      if (scale >= 1 && file.size < 3 * 1024 * 1024) {
        img.close?.();
        return file;
      }
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");
      ctx.drawImage(img, 0, 0, w, h);
      img.close?.();
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
          "image/jpeg",
          QUALITY
        );
      });
      const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], newName, { type: "image/jpeg" });
    } catch (err) {
      console.warn("resize failed, using original file:", file.name, err);
      return file;
    }
  }

  // ── Helper: call a step API ─────────────────────────────────────
  async function callStep(url: string, body: FormData | object) {
    const isForm = body instanceof FormData;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        ...(isForm
          ? { body: body as FormData }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
    } catch (netErr) {
      const msg = netErr instanceof Error ? netErr.message : String(netErr);
      throw new Error(`Network error calling ${url}: ${msg}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error || text;
      } catch {
        // leave as raw text
      }
      throw new Error(
        `${url} → ${res.status}: ${detail || "(empty response body)"}`
      );
    }
    return res.json();
  }

  function progress(stepNumber: number, step: string) {
    setJob((j) => j ? { ...j, status: "processing", stepNumber, step } : j);
  }

  // ── Submit — client-side orchestration ────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!images.length || !logo || !description || !email) return;
    setSubmitting(true);

    const totalSteps = 10;
    setJob({
      id: "",
      status: "processing",
      step: "Uploading files...",
      stepNumber: 1,
      totalSteps,
    });

    try {
      // ── 1. Resize images, then request signed upload URLs ──
      progress(1, "Preparing images...");
      const resizedImages = await Promise.all(images.map(resizeImage));
      progress(1, "Requesting upload URLs...");
      const imageMetas = resizedImages.map((f) => ({
        file: f,
        name: f.name,
        contentType: f.type || "image/jpeg",
      }));
      const logoMeta = {
        file: logo,
        name: logo.name,
        contentType: logo.type || "image/png",
      };
      const customAudioMeta =
        audioMode === "custom" && customAudio
          ? {
              file: customAudio,
              name: customAudio.name,
              contentType: customAudio.type || "audio/mpeg",
            }
          : null;

      const uploadData = await callStep("/api/steps/upload", {
        images: imageMetas.map(({ name, contentType }) => ({ name, contentType })),
        logo: { name: logoMeta.name, contentType: logoMeta.contentType },
        customAudio: customAudioMeta
          ? { name: customAudioMeta.name, contentType: customAudioMeta.contentType }
          : null,
      });
      const {
        jobId: jid,
        images: imageTargets,
        logo: logoTarget,
        customAudio: customAudioTarget,
      } = uploadData as {
        jobId: string;
        images: { uploadUrl: string; readUrl: string }[];
        logo: { uploadUrl: string; readUrl: string };
        customAudio: { uploadUrl: string; readUrl: string } | null;
      };
      setJobId(jid);

      // ── 1b. PUT files directly to GCS (bypasses Vercel 4.5MB cap) ──
      progress(1, "Uploading files to cloud storage...");
      async function putToGcs(
        file: File,
        contentType: string,
        target: { uploadUrl: string }
      ) {
        const res = await fetch(target.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!res.ok) {
          throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
        }
      }

      await Promise.all(
        imageMetas.map((m, i) => putToGcs(m.file, m.contentType, imageTargets[i]))
      );
      await putToGcs(logoMeta.file, logoMeta.contentType, logoTarget);
      if (customAudioMeta && customAudioTarget) {
        await putToGcs(customAudioMeta.file, customAudioMeta.contentType, customAudioTarget);
      }

      const imageUrls = imageTargets.map((t) => t.readUrl);
      const logoUrl = logoTarget.readUrl;
      const customAudioUrl = customAudioTarget?.readUrl ?? null;

      // ── 2. Analyze images ───────────────────────────────────
      progress(2, "Analyzing property images with AI...");
      const analyzeData = await callStep("/api/steps/analyze", { imageUrls });

      // ── 3. Pick images + titles + script ────────────────────
      progress(3, "Selecting best images & generating titles...");
      const prepData = await callStep("/api/steps/prepare", {
        images: analyzeData.images,
        description,
        priceRange,
        audioMode,
        jobId: jid,
      });

      // ── 4. Generate audio ───────────────────────────────────
      progress(4, "Preparing audio...");
      let audioUrls: string[] = [];
      let isBgMusic = false;

      if (audioMode === "custom" && customAudioUrl) {
        audioUrls = [customAudioUrl];
        isBgMusic = true;
      } else {
        const audioData = await callStep("/api/steps/audio", {
          audioMode,
          script: prepData.script,
          jobId: jid,
        });
        audioUrls = audioData.audioUrls;
        isBgMusic = audioData.isBgMusic;
      }

      // ── 5. Image to video (one at a time) ───────────────────
      progress(5, "Converting images to video clips...");
      const rawVideos: string[] = [];
      for (let i = 0; i < prepData.best6.length; i++) {
        const { result } = await callStep("/api/steps/nca", {
          action: "imageToVideo",
          imageUrl: prepData.best6[i],
          clipIndex: i,
        });
        rawVideos.push(result);
      }

      // ── 6. Scale to vertical ────────────────────────────────
      progress(6, "Scaling to vertical format...");
      const scaledVideos: string[] = [];
      for (const vid of rawVideos) {
        const { result } = await callStep("/api/steps/nca", {
          action: "verticalScale",
          videoUrl: vid,
        });
        scaledVideos.push(result);
      }

      // ── 7. Overlay text + logo ──────────────────────────────
      progress(7, "Adding text overlays & logo...");
      const visualVideos: string[] = [];
      for (let i = 0; i < scaledVideos.length; i++) {
        const { result } = await callStep("/api/steps/nca", {
          action: "overlayVisuals",
          videoUrl: scaledVideos[i],
          logoUrl,
          caption: prepData.titles[i] || "",
        });
        visualVideos.push(result);
      }

      // ── 8. Add audio ────────────────────────────────────────
      progress(8, "Adding audio...");
      let clipsForConcat: string[];

      if (isBgMusic) {
        clipsForConcat = visualVideos;
      } else {
        clipsForConcat = [];
        for (let i = 0; i < visualVideos.length; i++) {
          const { result } = await callStep("/api/steps/nca", {
            action: "overlayAudio",
            videoUrl: visualVideos[i],
            audioUrl: audioUrls[i],
          });
          clipsForConcat.push(result);
        }
      }

      // ── 9. Concatenate ──────────────────────────────────────
      progress(9, "Concatenating final video...");
      const { result: concatUrl } = await callStep("/api/steps/nca", {
        action: "concatenateVideos",
        videoUrls: clipsForConcat,
      });

      let finalVideoUrl = concatUrl;
      if (isBgMusic && audioUrls.length > 0) {
        const { result } = await callStep("/api/steps/nca", {
          action: "addBackgroundMusic",
          videoUrl: concatUrl,
          musicUrl: audioUrls[0],
        });
        finalVideoUrl = result;
      }

      // ── 10. Send email ──────────────────────────────────────
      progress(10, "Sending email...");
      await callStep("/api/steps/email", { email, videoUrl: finalVideoUrl });

      setJob({
        id: jid,
        status: "completed",
        step: "Done! Video sent to your email.",
        stepNumber: 10,
        totalSteps,
        videoUrl: finalVideoUrl,
      });
    } catch (err: any) {
      setJob((j) => ({
        ...(j || { id: "", stepNumber: 0, totalSteps: 10 }),
        status: "failed",
        step: "Pipeline failed",
        error: err.message || "Unknown error",
      }));
    }
  };

  const isProcessing =
    job && job.status !== "completed" && job.status !== "failed";
  const progressPct = job
    ? Math.round((job.stepNumber / job.totalSteps) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-300 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 py-16 text-center">
          <h1 className="text-5xl font-bold tracking-tight">Donny</h1>
          <p className="mt-4 text-xl text-blue-100 max-w-2xl mx-auto">
            AI-powered property video generator. Upload your listing photos and
            get a professional vertical video tour in minutes.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        {/* ── Progress Panel ───────────────────────────────────── */}
        {job && submitting && (
          <div className="mb-10 rounded-2xl bg-white shadow-lg border border-slate-200 p-8">
            <h2 className="text-xl font-semibold mb-4">
              {job.status === "completed"
                ? "Video Ready!"
                : job.status === "failed"
                ? "Generation Failed"
                : "Generating Your Video..."}
            </h2>

            <div className="w-full bg-slate-100 rounded-full h-3 mb-3">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${
                  job.status === "failed"
                    ? "bg-red-500"
                    : job.status === "completed"
                    ? "bg-green-500"
                    : "bg-blue-600"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-sm text-slate-600">
              Step {job.stepNumber}/{job.totalSteps} &mdash; {job.step}
            </p>

            {job.status === "completed" && job.videoUrl && (
              <div className="mt-6 flex flex-col items-center gap-4">
                <a
                  href={job.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700 transition"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Watch Video
                </a>
                <p className="text-sm text-green-700">
                  A link has also been sent to {email}
                </p>
                <button
                  onClick={() => {
                    setSubmitting(false);
                    setJob(null);
                    setJobId(null);
                  }}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Generate another video
                </button>
              </div>
            )}

            {job.status === "failed" && (
              <div className="mt-4">
                <p className="text-red-600 text-sm">{job.error}</p>
                <button
                  onClick={() => {
                    setSubmitting(false);
                    setJob(null);
                    setJobId(null);
                  }}
                  className="mt-3 text-sm text-blue-600 hover:underline"
                >
                  Try again
                </button>
              </div>
            )}

            {isProcessing && (
              <div className="mt-6 flex justify-center">
                <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}

        {/* ── Form ─────────────────────────────────────────────── */}
        {(!submitting ||
          job?.status === "completed" ||
          job?.status === "failed") &&
          !isProcessing && (
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Property Images */}
              <section className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
                <label className="block text-lg font-semibold mb-2">
                  Property Images
                </label>
                <p className="text-sm text-slate-500 mb-4">
                  Upload at least 6 photos: front of house, living room,
                  kitchen, bedroom, bathroom, backyard. AI will pick the best
                  ones.
                </p>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImages}
                  className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                    file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100 cursor-pointer"
                />
                {imagePreviews.length > 0 && (
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {imagePreviews.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`Preview ${i + 1}`}
                        className="w-full h-24 object-cover rounded-lg border border-slate-200"
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Logo */}
              <section className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
                <label className="block text-lg font-semibold mb-2">
                  Company Logo
                </label>
                <p className="text-sm text-slate-500 mb-4">
                  Your logo will appear at the top of each video clip.
                </p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogo}
                  className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                    file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100 cursor-pointer"
                />
                {logoPrev && (
                  <img
                    src={logoPrev}
                    alt="Logo preview"
                    className="mt-4 h-16 object-contain rounded border border-slate-200 p-1"
                  />
                )}
              </section>

              {/* Property Details */}
              <section className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6 space-y-4">
                <h2 className="text-lg font-semibold">Property Details</h2>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Property Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    required
                    placeholder="Describe the property: location, bedrooms, bathrooms, features..."
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                      placeholder:text-slate-400 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Price Range
                  </label>
                  <input
                    type="text"
                    value={priceRange}
                    onChange={(e) => setPriceRange(e.target.value)}
                    placeholder="e.g. $450,000 - $500,000"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                      placeholder:text-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                      placeholder:text-slate-400"
                  />
                </div>
              </section>

              {/* Audio Mode */}
              <section className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold mb-4">Audio</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* AI Voiceover */}
                  <button
                    type="button"
                    onClick={() => setAudioMode("voiceover")}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      audioMode === "voiceover"
                        ? "border-blue-600 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <svg
                        className="w-5 h-5 text-blue-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                        />
                      </svg>
                      <span className="font-semibold text-sm">
                        AI Voiceover
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      AI generates a script and narrates it
                    </p>
                  </button>

                  {/* Custom Audio */}
                  <button
                    type="button"
                    onClick={() => setAudioMode("custom")}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      audioMode === "custom"
                        ? "border-blue-600 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <svg
                        className="w-5 h-5 text-blue-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                        />
                      </svg>
                      <span className="font-semibold text-sm">
                        Custom Audio
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Upload your own song or music
                    </p>
                  </button>

                  {/* Free AI Music */}
                  <button
                    type="button"
                    onClick={() => setAudioMode("musicgen")}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      audioMode === "musicgen"
                        ? "border-blue-600 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <svg
                        className="w-5 h-5 text-blue-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                      <span className="font-semibold text-sm">
                        Free AI Music
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Auto-generated background music (free)
                    </p>
                  </button>
                </div>

                {audioMode === "custom" && (
                  <div className="mt-4">
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) =>
                        setCustomAudio(e.target.files?.[0] || null)
                      }
                      className="block w-full text-sm text-slate-500
                        file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                        file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700
                        hover:file:bg-blue-100 cursor-pointer"
                    />
                    {customAudio && (
                      <p className="mt-2 text-sm text-green-700">
                        Selected: {customAudio.name}
                      </p>
                    )}
                  </div>
                )}

                {audioMode === "musicgen" && (
                  <p className="mt-4 text-sm text-slate-500 bg-slate-50 rounded-lg p-3">
                    Background music will be generated using Meta MusicGen via
                    Hugging Face. This is free but may take 30-60 seconds.
                  </p>
                )}
              </section>

              {/* Submit */}
              <button
                type="submit"
                disabled={
                  !images.length || !logo || !description || !email || submitting
                }
                className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600
                  text-white font-bold text-lg shadow-lg
                  hover:from-blue-700 hover:to-indigo-700 transition
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate Property Video
              </button>
            </form>
          )}
      </main>

      <footer className="text-center text-sm text-slate-400 py-8">
        Donny &mdash; AI Property Video Generator
        <div className="mt-2 text-xs text-slate-300">
          build {process.env.NEXT_PUBLIC_GIT_SHA} &middot;{" "}
          {process.env.NEXT_PUBLIC_BUILD_TIME}
        </div>
      </footer>
    </div>
  );
}
