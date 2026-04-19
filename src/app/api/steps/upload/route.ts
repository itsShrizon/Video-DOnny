import { NextRequest, NextResponse } from "next/server";
import { getSignedUploadUrl } from "@/lib/gcs";
import { withErrorHandler } from "@/lib/api-wrap";
import { v4 as uuid } from "uuid";

type FileMeta = { name: string; contentType: string };

type RequestBody = {
  jobId?: string;
  images: FileMeta[];
  logo: FileMeta;
  customAudio?: FileMeta | null;
};

function extOf(name: string, fallback: string): string {
  const raw = name.split(".").pop();
  if (!raw) return fallback;
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "") || fallback;
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = (await req.json()) as RequestBody;

  if (!body?.images?.length || !body?.logo) {
    return NextResponse.json(
      { error: "Missing images or logo metadata" },
      { status: 400 }
    );
  }

  const jobId = body.jobId || uuid();

  const images = await Promise.all(
    body.images.map((meta, i) =>
      getSignedUploadUrl(
        `jobs/${jobId}/images/img-${i}.${extOf(meta.name, "jpg")}`,
        meta.contentType || "image/jpeg"
      )
    )
  );

  const logo = await getSignedUploadUrl(
    `jobs/${jobId}/logo.${extOf(body.logo.name, "png")}`,
    body.logo.contentType || "image/png"
  );

  let customAudio: { uploadUrl: string; readUrl: string } | null = null;
  if (body.customAudio) {
    customAudio = await getSignedUploadUrl(
      `jobs/${jobId}/audio/custom.${extOf(body.customAudio.name, "mp3")}`,
      body.customAudio.contentType || "audio/mpeg"
    );
  }

  return NextResponse.json({ jobId, images, logo, customAudio });
});
