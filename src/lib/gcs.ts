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

export async function uploadBufferToGCS(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const file = getBucket().file(filename);
  await file.save(buffer, {
    metadata: { contentType },
    resumable: false,
  });
  // Use signed URL (valid 7 days) since bucket has public access prevention
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  return url;
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
