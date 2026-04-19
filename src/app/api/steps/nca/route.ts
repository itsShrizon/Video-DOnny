import { NextRequest, NextResponse } from "next/server";
import {
  imageToVideo,
  verticalScale,
  overlayVisuals,
  overlayAudio,
  addBackgroundMusic,
  concatenateVideos,
} from "@/lib/nca";
import { withErrorHandler } from "@/lib/api-wrap";

export const maxDuration = 60;

// Generic NCA operation — one call at a time from the client
export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = await req.json();
  const { action } = body;

  let result: string;

  switch (action) {
    case "imageToVideo":
      result = await imageToVideo(body.imageUrl, body.clipIndex ?? 0);
      break;
    case "verticalScale":
      result = await verticalScale(body.videoUrl);
      break;
    case "overlayVisuals":
      result = await overlayVisuals(body.videoUrl, body.logoUrl, body.caption);
      break;
    case "overlayAudio":
      result = await overlayAudio(body.videoUrl, body.audioUrl);
      break;
    case "addBackgroundMusic":
      result = await addBackgroundMusic(body.videoUrl, body.musicUrl);
      break;
    case "concatenateVideos":
      result = await concatenateVideos(body.videoUrls);
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.json({ result });
});
