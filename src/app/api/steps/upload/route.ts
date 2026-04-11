import { NextRequest, NextResponse } from "next/server";
import { uploadBufferToGCS } from "@/lib/gcs";
import { v4 as uuid } from "uuid";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const jobId = (formData.get("jobId") as string) || uuid();

  const imageFiles: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (key === "images" && value instanceof File) {
      imageFiles.push(value);
    }
  }
  const logoFile = formData.get("logo") as File;

  // Upload all images + logo to GCS in parallel
  const imageUploadPromises = imageFiles.map(async (file, i) => {
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "jpg";
    return uploadBufferToGCS(
      buf,
      `jobs/${jobId}/images/img-${i}.${ext}`,
      file.type || "image/jpeg"
    );
  });

  const logoBuf = Buffer.from(await logoFile.arrayBuffer());
  const logoExt = logoFile.name.split(".").pop() || "png";
  const logoUrlPromise = uploadBufferToGCS(
    logoBuf,
    `jobs/${jobId}/logo.${logoExt}`,
    logoFile.type || "image/png"
  );

  // Also upload custom audio if present
  const customAudioFile = formData.get("customAudio") as File | null;
  let customAudioUrl: string | null = null;

  const uploads: Promise<any>[] = [
    Promise.all(imageUploadPromises),
    logoUrlPromise,
  ];

  if (customAudioFile && customAudioFile.size > 0) {
    const audioBuf = Buffer.from(await customAudioFile.arrayBuffer());
    const audioExt = customAudioFile.name.split(".").pop() || "mp3";
    uploads.push(
      uploadBufferToGCS(
        audioBuf,
        `jobs/${jobId}/audio/custom.${audioExt}`,
        customAudioFile.type || "audio/mpeg"
      )
    );
  }

  const results = await Promise.all(uploads);
  const imageUrls = results[0];
  const logoUrl = results[1];
  if (results[2]) customAudioUrl = results[2];

  return NextResponse.json({ jobId, imageUrls, logoUrl, customAudioUrl });
}
