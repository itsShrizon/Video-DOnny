import fs from "fs";
import path from "path";

const BASE = "http://localhost:3000";
const IMG_DIR = "./test-images";

async function run() {
  console.log("=== Donny E2E Test ===\n");

  // Build form data
  const form = new FormData();

  const imageFiles = ["front.jpg", "living.jpg", "kitchen.jpg", "bedroom.jpg", "bathroom.jpg", "backyard.jpg"];
  for (const name of imageFiles) {
    const buf = fs.readFileSync(path.join(IMG_DIR, name));
    form.append("images", new Blob([buf], { type: "image/jpeg" }), name);
    console.log(`  Added image: ${name} (${buf.length} bytes)`);
  }

  const logoBuf = fs.readFileSync(path.join(IMG_DIR, "logo.png"));
  form.append("logo", new Blob([logoBuf], { type: "image/png" }), "logo.png");
  console.log(`  Added logo: logo.png (${logoBuf.length} bytes)`);

  form.append("description", "Beautiful 3 bedroom 2 bathroom modern home in Austin, Texas. Features an open-concept living room with hardwood floors, a gourmet kitchen with granite countertops and stainless steel appliances, spacious bedrooms with walk-in closets, and a landscaped backyard with a patio perfect for entertaining.");
  form.append("priceRange", "$450,000 - $500,000");
  form.append("email", "test@example.com");
  form.append("audioMode", "voiceover");

  console.log("\n1. Submitting to /api/generate...");
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    body: form,
  });

  const data = await res.json();
  if (!data.jobId) {
    console.error("FAILED:", data);
    process.exit(1);
  }
  console.log(`   Job ID: ${data.jobId}\n`);

  // Poll for status
  console.log("2. Polling for progress...\n");
  let done = false;
  while (!done) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(`${BASE}/api/status?id=${data.jobId}`);
    const job = await statusRes.json();
    const pct = Math.round((job.stepNumber / job.totalSteps) * 100);
    console.log(`   [${pct}%] Step ${job.stepNumber}/${job.totalSteps} - ${job.step}`);

    if (job.status === "completed") {
      console.log(`\n=== SUCCESS ===`);
      console.log(`Video URL: ${job.videoUrl}`);
      done = true;
    } else if (job.status === "failed") {
      console.error(`\n=== FAILED ===`);
      console.error(`Error: ${job.error}`);
      done = true;
      process.exit(1);
    }
  }
}

run().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(1);
});
