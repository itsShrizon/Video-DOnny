import { Storage, type Bucket } from "@google-cloud/storage";

let _bucket: Bucket | null = null;

function getBucket(): Bucket {
  if (!_bucket) {
    // Parse private key: handle both escaped \\n and real \n
    let privateKey = process.env.GCS_PRIVATE_KEY || "";
    // Remove surrounding quotes if present
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    // Replace escaped newlines with real newlines
    privateKey = privateKey.replace(/\\n/g, "\n");

    const storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      credentials: {
        client_email: process.env.GCS_CLIENT_EMAIL!,
        private_key: privateKey,
      },
    });
    _bucket = storage.bucket(process.env.GCS_BUCKET_NAME!);
  }
  return _bucket;
}

export async function getSignedUploadUrl(
  filename: string,
  contentType: string
): Promise<{ uploadUrl: string; readUrl: string }> {
  const file = getBucket().file(filename);
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 15 * 60 * 1000,
    contentType,
  });
  const [readUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  return { uploadUrl, readUrl };
}

// Upload bytes generated server-side (OpenAI TTS, musicgen output, etc.)
// via a signed write URL + HTTP PUT — matches the client pattern and
// avoids routing the bytes through Vercel's request/response cycle.
export async function uploadBufferToGCS(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const { uploadUrl, readUrl } = await getSignedUploadUrl(filename, contentType);
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    throw new Error(
      `GCS upload failed (${res.status}) for ${filename}: ${await res.text()}`
    );
  }
  return readUrl;
}

export async function uploadFromUrl(
  url: string,
  filename: string,
  contentType: string
): Promise<string> {
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  return uploadBufferToGCS(buffer, filename, contentType);
}
