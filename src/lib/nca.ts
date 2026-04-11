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

// ── CapCut-style Ken Burns effects ───────────────────────────────────
// Each clip gets a different smooth pan/zoom motion for a professional look.
// Uses ffmpeg zoompan filter: 150 frames = 5 seconds at 30fps.
// z = zoom level, x/y = pan position, d = total frames, s = output size
const KENBURNS_EFFECTS = [
  // 0: Slow zoom in, centered — classic establishing shot for front house
  "zoompan=z='min(zoom+0.0015,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30",
  // 1: Pan left to right with slight zoom — sweeping living room reveal
  "zoompan=z='1.1':x='if(eq(on,0),0,x+2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30",
  // 2: Slow zoom out from center — kitchen overview
  "zoompan=z='if(eq(on,0),1.3,max(zoom-0.002,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30",
  // 3: Pan right to left with slight zoom — bedroom scan
  "zoompan=z='1.1':x='if(eq(on,0),iw,max(x-2,0))':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920:fps=30",
  // 4: Zoom in on upper area then pan down — bathroom detail
  "zoompan=z='min(zoom+0.001,1.15)':x='iw/2-(iw/zoom/2)':y='if(eq(on,0),0,min(y+1,ih/2))':d=150:s=1080x1920:fps=30",
  // 5: Slow zoom in with slight upward pan — dramatic backyard reveal
  "zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='if(eq(on,0),ih/3,max(y-0.8,0))':d=150:s=1080x1920:fps=30",
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

// ── Scale to vertical 1080x1920 ─────────────────────────────────────
export async function verticalScale(videoUrl: string): Promise<string> {
  const data = await ncaRequest("/v1/ffmpeg/compose", {
    inputs: [{ file_url: videoUrl, options: [] }],
    filters: [
      {
        filter:
          "color=c=white:s=1080x1920:d=5[bg];[0:v]scale=iw*1.05:ih*1.05:force_original_aspect_ratio=decrease[scaled];[bg][scaled]overlay=(W-w)/2:250[outv]",
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

// ── Overlay audio onto a video clip ──────────────────────────────────
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
          "[0:v:0][1:a:0]concat=n=1:v=1:a=1[outv][outa]",
      },
    ],
    outputs: [
      {
        options: [
          { option: "-map", argument: "[outv]" },
          { option: "-map", argument: "[outa]" },
          { option: "-c:v", argument: "libx264" },
          { option: "-c:a", argument: "aac" },
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

// ── Concatenate 6 clips into final video ─────────────────────────────
export async function concatenateVideos(videoUrls: string[]): Promise<string> {
  const inputs = videoUrls.map((url) => ({ file_url: url, options: [] }));
  const n = videoUrls.length;
  const streams = videoUrls
    .map((_, i) => `[${i}:v:0][${i}:a:0]`)
    .join("");
  const data = await ncaRequest("/v1/ffmpeg/compose", {
    inputs,
    filters: [
      {
        filter: `${streams}concat=n=${n}:v=1:a=1[outv][outa]`,
      },
    ],
    outputs: [
      {
        options: [
          { option: "-map", argument: "[outv]" },
          { option: "-map", argument: "[outa]" },
          { option: "-c:v", argument: "libx264" },
          { option: "-c:a", argument: "aac" },
        ],
      },
    ],
    id: `concat-${Date.now()}`,
  });
  return data.response[0].file_url;
}
