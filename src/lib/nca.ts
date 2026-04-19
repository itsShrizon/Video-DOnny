const NCA_URL = process.env.NCA_TOOLKIT_URL!;
const NCA_KEY = process.env.NCA_TOOLKIT_API_KEY!;

async function ncaRequest(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`${NCA_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": NCA_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NCA Toolkit error (${endpoint}): ${res.status} - ${text}`);
  }
  return res.json();
}

// ── Ken Burns effects — gentle, shake-free, aspect-correct ──────────
// Three things this pipeline gets right that the previous one didn't:
//   1. Aspect: scale-to-cover then crop to 9:16 BEFORE zoompan, so landscape
//      inputs aren't vertically stretched into tall/skinny portrait output.
//   2. Smoothness: source is pre-scaled to 2× the output (2160×3840) so
//      zoompan's integer-pixel crop math operates at sub-output-pixel
//      precision; no visible jitter.
//   3. Motion: zoom/pan driven by frame counter (`on/149`) rather than an
//      accumulator (`zoom+K`), eliminating per-frame drift.
// Zoom capped at 1.07× (was 1.2–1.3×) — motion is felt, not announced.
// 150 frames @ 30fps = 5s; on ∈ [0, 149].
const PRE =
  "scale=2160:3840:force_original_aspect_ratio=increase:flags=lanczos,crop=2160:3840";
const KENBURNS_EFFECTS = [
  // 0: Front house — gentle zoom in, centered (establishing shot)
  `${PRE},zoompan=z='1.0+on/149*0.06':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30`,
  // 1: Living room — slow pan L→R at light zoom
  `${PRE},zoompan=z='1.05':x='(iw-iw/zoom)*on/149':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30`,
  // 2: Kitchen — slow zoom out, centered (reveal)
  `${PRE},zoompan=z='1.07-on/149*0.07':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30`,
  // 3: Bedroom — slow pan R→L at light zoom
  `${PRE},zoompan=z='1.05':x='(iw-iw/zoom)*(1-on/149)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30`,
  // 4: Bathroom — slow zoom in with slight downward drift
  `${PRE},zoompan=z='1.0+on/149*0.05':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(0.3+on/149*0.2)':d=150:s=1080x1920:fps=30`,
  // 5: Backyard — slow zoom in with slight upward drift
  `${PRE},zoompan=z='1.0+on/149*0.06':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(0.65-on/149*0.25)':d=150:s=1080x1920:fps=30`,
];

export async function imageToVideo(
  imageUrl: string,
  clipIndex: number = 0
): Promise<string> {
  const effect = KENBURNS_EFFECTS[clipIndex % KENBURNS_EFFECTS.length];
  const data = await ncaRequest("/v1/ffmpeg/compose", {
    inputs: [{ file_url: imageUrl, options: [] }],
    filters: [{ filter: `[0:v]${effect},format=yuv420p[outv]` }],
    outputs: [
      {
        options: [
          { option: "-map", argument: "[outv]" },
          { option: "-c:v", argument: "libx264" },
          { option: "-crf", argument: "18" },
          { option: "-preset", argument: "medium" },
          { option: "-y" },
        ],
        format: "output.mp4",
      },
    ],
    id: `kenburns-${clipIndex}-${Date.now()}`,
  });
  return data.response[0].file_url;
}

// ── Place video on 1080x1920 canvas with white top band for logo ────
// Keeps the 250px white band at top (where the logo sits) but drops the
// stray 1.05× scale-up that used to compound with Ken Burns zoom.
export async function verticalScale(videoUrl: string): Promise<string> {
  const data = await ncaRequest("/v1/ffmpeg/compose", {
    inputs: [{ file_url: videoUrl, options: [] }],
    filters: [
      {
        filter:
          "color=c=white:s=1080x1920:d=5[bg];[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[scaled];[bg][scaled]overlay=(W-w)/2:250[outv]",
      },
    ],
    outputs: [
      {
        options: [
          { option: "-map", argument: "[outv]" },
          { option: "-c:v", argument: "libx264" },
          { option: "-crf", argument: "23" },
          { option: "-preset", argument: "medium" },
          { option: "-y" },
        ],
        format: "output.mp4",
      },
    ],
    id: `vscale-${Date.now()}`,
  });
  return data.response[0].file_url;
}

// ── Overlay text caption + logo ──────────────────────────────────────
export async function overlayVisuals(
  videoUrl: string,
  logoUrl: string,
  caption: string
): Promise<string> {
  const safeCaption = caption.replace(/'/g, "\u2019").replace(/:/g, "\\:");
  const data = await ncaRequest("/v1/ffmpeg/compose", {
    inputs: [
      { file_url: videoUrl, options: [] },
      { file_url: logoUrl, options: [] },
    ],
    filters: [
      {
        filter: `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[top];color=c=white:s=1080x1920:d=5[canvas];[canvas][top]overlay=0:0[withvideo];[withvideo]drawtext=fontfile=fonts/Roboto-Bold.ttf:fontsize=70:fontcolor=white:x=(w-text_w)/2:y=1470:box=1:boxcolor=#008dd8:boxborderw=20:text='${safeCaption}':text_align=left[withtext];[1:v]scale=iw*0.3:ih*0.3:force_original_aspect_ratio=decrease[scaled_img];[withtext][scaled_img]overlay=(main_w-overlay_w)/2:160[outv]`,
      },
    ],
    outputs: [
      {
        options: [
          { option: "-c:v", argument: "libx264" },
          { option: "-crf", argument: "23" },
          { option: "-preset", argument: "fast" },
          { option: "-y" },
          { option: "-map", argument: "[outv]" },
          { option: "-map", argument: "0:a?" },
        ],
        format: "output.mp4",
      },
    ],
    id: `overlay-vis-${Date.now()}`,
  });
  return data.response[0].file_url;
}

// ── Mux TTS audio onto a 5s video clip, locking duration to 5s ──────
// Pads short TTS with silence (apad) and trims anything over 5s so every
// clip is exactly 5s. Critical for concatenateVideos' xfade offsets,
// which hardcode 5s per clip — variable clip lengths → misaligned fades.
// Video is stream-copied (no re-encode) for speed and to preserve quality.
export async function overlayAudio(
  videoUrl: string,
  audioUrl: string
): Promise<string> {
  const data = await ncaRequest("/v1/ffmpeg/compose", {
    inputs: [
      { file_url: videoUrl, options: [] },
      { file_url: audioUrl, options: [] },
    ],
    filters: [
      {
        filter:
          "[1:a]apad=whole_dur=5,atrim=0:5,asetpts=PTS-STARTPTS[outa]",
      },
    ],
    outputs: [
      {
        options: [
          { option: "-map", argument: "0:v" },
          { option: "-map", argument: "[outa]" },
          { option: "-c:v", argument: "copy" },
          { option: "-c:a", argument: "aac" },
          { option: "-shortest" },
        ],
      },
    ],
    id: `overlay-aud-${Date.now()}`,
  });
  return data.response[0].file_url;
}

// ── Add background music to a video (loops/trims audio to match video length) ─
export async function addBackgroundMusic(
  videoUrl: string,
  musicUrl: string
): Promise<string> {
  const data = await ncaRequest("/v1/ffmpeg/compose", {
    inputs: [
      { file_url: videoUrl, options: [] },
      { file_url: musicUrl, options: [{ option: "-stream_loop", argument: "-1" }] },
    ],
    filters: [
      {
        filter:
          "[1:a]aloop=loop=-1:size=2e+09,atrim=0:30,volume=0.8[music];[music]apad[outa]",
      },
    ],
    outputs: [
      {
        options: [
          { option: "-map", argument: "0:v" },
          { option: "-map", argument: "[outa]" },
          { option: "-c:v", argument: "copy" },
          { option: "-c:a", argument: "aac" },
          { option: "-shortest" },
        ],
      },
    ],
    id: `bg-music-${Date.now()}`,
  });
  return data.response[0].file_url;
}

// ── Concatenate clips with smooth crossfade transitions ─────────────
// Uses xfade for video and acrossfade for audio instead of hard concat.
// 0.5s crossfade per boundary → final length = n*5 - (n-1)*0.5 seconds.
// `hasAudio=false` for bg-music mode, where clips have no per-clip audio
// (music is layered on the concatenated video via addBackgroundMusic).
const CLIP_DUR = 5;
const XFADE_DUR = 0.5;

export async function concatenateVideos(
  videoUrls: string[],
  hasAudio: boolean = true
): Promise<string> {
  if (videoUrls.length === 0) throw new Error("concatenateVideos: empty list");
  if (videoUrls.length === 1) return videoUrls[0];

  const inputs = videoUrls.map((url) => ({ file_url: url, options: [] }));
  const n = videoUrls.length;

  // Video xfade chain. After k clips the running duration is
  // k*CLIP_DUR - (k-1)*XFADE_DUR, so the next transition starts at
  // (running - XFADE_DUR) = (CLIP_DUR - XFADE_DUR) * k  for k clips chained.
  const videoFilters: string[] = [];
  let prevV = "[0:v]";
  for (let i = 1; i < n; i++) {
    const outV = i === n - 1 ? "[outv]" : `[v${i}]`;
    const offset = (CLIP_DUR - XFADE_DUR) * i;
    videoFilters.push(
      `${prevV}[${i}:v]xfade=transition=fade:duration=${XFADE_DUR}:offset=${offset}${outV}`
    );
    prevV = outV;
  }

  const maps: Array<{ option: string; argument: string }> = [
    { option: "-map", argument: "[outv]" },
  ];
  const codecs: Array<{ option: string; argument?: string }> = [
    { option: "-c:v", argument: "libx264" },
    { option: "-crf", argument: "20" },
    { option: "-preset", argument: "medium" },
  ];

  let filter = videoFilters.join(";");

  if (hasAudio) {
    const audioFilters: string[] = [];
    let prevA = "[0:a]";
    for (let i = 1; i < n; i++) {
      const outA = i === n - 1 ? "[outa]" : `[a${i}]`;
      audioFilters.push(
        `${prevA}[${i}:a]acrossfade=d=${XFADE_DUR}${outA}`
      );
      prevA = outA;
    }
    filter += ";" + audioFilters.join(";");
    maps.push({ option: "-map", argument: "[outa]" });
    codecs.push({ option: "-c:a", argument: "aac" });
  }

  const data = await ncaRequest("/v1/ffmpeg/compose", {
    inputs,
    filters: [{ filter }],
    outputs: [
      {
        options: [...maps, ...codecs],
      },
    ],
    id: `concat-${Date.now()}`,
  });
  return data.response[0].file_url;
}
