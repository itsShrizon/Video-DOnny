import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}
const openai = new Proxy({} as OpenAI, {
  get(_, prop) {
    return (getClient() as any)[prop];
  },
});

// ── Image Analysis (Vision) ─────────────────────────────────────────
export async function analyzeImage(
  imageUrl: string
): Promise<{ description: string; keyword: string }> {
  const [descRes, kwRes] = await Promise.all([
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: "Describe this image in 1 short sentence." },
          ],
        },
      ],
      max_tokens: 100,
    }),
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            {
              type: "text",
              text: 'Classify this image as one of the following keywords: front house, livingroom, kitchen, bedroom, bathroom, backyard, other. Only reply with one of these keywords.',
            },
          ],
        },
      ],
      max_tokens: 20,
    }),
  ]);

  return {
    description: descRes.choices[0].message.content?.trim() || "",
    keyword: kwRes.choices[0].message.content?.trim().toLowerCase() || "other",
  };
}

// ── Pick Best 6 Images ──────────────────────────────────────────────
export async function pickBest6Images(
  images: { url: string; description: string; keyword: string }[]
): Promise<string[]> {
  // Use index-based selection to avoid copying long signed URLs
  const indexed = images.map((img, i) => ({
    index: i,
    description: img.description,
    keyword: img.keyword,
  }));

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Pick the 6 best images by index number.

1st: keyword "front house"
2nd: keyword "livingroom"
3rd: keyword "kitchen"
4th: keyword "bedroom"
5th: keyword "bathroom"
6th: keyword "backyard"

If a category has no match, pick from "other" or any remaining.

Images:
${JSON.stringify(indexed)}

Return JSON with the 6 indices in order:
{ "indices": [0, 2, 4, 1, 3, 5] }`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 200,
  });

  const parsed = JSON.parse(res.choices[0].message.content || "{}");
  const indices: number[] = parsed.indices || [];
  return indices.map((i) => images[i]?.url).filter(Boolean);
}

// ── Generate 6 Titles ───────────────────────────────────────────────
export async function generateTitles(
  description: string,
  priceRange: string
): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Create six short titles for a property video.

INFO
Full description: ${description}
Price: ${priceRange}

From that description derive:
- Bedrooms: the first number that precedes "bedroom"
- Bathrooms: the first number that precedes "bathroom"

Produce exactly six captions, each no more than two words:

1. City & state if mentioned; otherwise a two-word style phrase (e.g. "Charming Cottage")
2. An adjective + "Living" (e.g. "Cozy Living")
3. The single word "Kitchen"
4. "<bedrooms> Bedrooms"
5. "<bathrooms> Bathrooms"
6. A call-to-action such as "Book Tour"

Return only valid JSON:
{ "titles": ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"] }`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 200,
  });

  const parsed = JSON.parse(res.choices[0].message.content || "{}");
  return parsed.titles || [];
}

// ── Generate Voiceover Script ───────────────────────────────────────
export async function generateScript(
  description: string,
  priceRange: string
): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Create a short video voice-over for a real-estate listing.

Description: ${description}
Price: ${priceRange}

Your script must contain exactly six parts, each one sentence of no more than 10 words (~5 spoken seconds):

1. Fun intro to the home (do not mention the address)
2. Highlight the living room
3. Highlight the kitchen
4. State the bedroom count
5. State the bathroom count
6. Mention the price and finish with a call-to-action

Return only valid JSON:
{ "script": ["Sentence one.", "Sentence two.", "Sentence three.", "Sentence four.", "Sentence five.", "Sentence six."] }`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 400,
  });

  const parsed = JSON.parse(res.choices[0].message.content || "{}");
  return parsed.script || [];
}

// ── Text-to-Speech ──────────────────────────────────────────────────
export async function textToSpeech(text: string): Promise<Buffer> {
  const res = await openai.audio.speech.create({
    model: "tts-1-hd",
    voice: "alloy",
    input: text,
    speed: 1.1,
  });
  return Buffer.from(await res.arrayBuffer());
}
