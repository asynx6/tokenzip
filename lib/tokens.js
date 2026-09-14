// Vision-token math per provider. Formulas are documented in README with
// sources; they change rarely. All return token estimates for ONE image.

// --- Anthropic (Claude) ---
// https://docs.anthropic.com/en/docs/build-with-claude/vision
// tokens = ceil(w*h / 750); images above 8000px longest side are downscaled;
// cap ≈ 1568 tokens (≈1.15 MP effective).
export function anthropicTokens(w, h) {
  let width = w, height = h;
  if (Math.max(width, height) > 8000) {
    const r = 8000 / Math.max(width, height);
    width = Math.round(width * r);
    height = Math.round(height * r);
  }
  return Math.min(1568, Math.ceil((width * height) / 750));
}

// --- OpenAI (GPT-4o family, detail: high) ---
// https://platform.openai.com/docs/guides/vision
// scale: fit within 2048×2048, short side ≥ 768 (shrink long side only)
// tiles of 512px; tokens = 85 + 170 × tiles
export function openaiTokens(w, h) {
  let width = w, height = h;
  // step 1: scale by LONGEST side into 2048 (preserves aspect)
  const longest = Math.max(width, height);
  if (longest > 2048) {
    const r = 2048 / longest;
    width = Math.round(width * r);
    height = Math.round(height * r);
  }
  // step 2: if short side still > 768, scale by the SHORT side to 768
  const shortest = Math.min(width, height);
  if (shortest > 768) {
    const r = 768 / shortest;
    width = Math.round(width * r);
    height = Math.round(height * r);
  }
  const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);
  return 85 + 170 * tiles;
}

// --- Google (Gemini 1.5/2.x/3) ---
// https://ai.google.dev/gemini-api/docs/image-understanding
// each image: up to 384×384 tiles after tiling; tokens = tiles × 258
export function geminiTokens(w, h) {
  const tiles = Math.ceil(w / 768) * Math.ceil(h / 768);
  return tiles * 258;
}

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', fn: anthropicTokens },
  openai: { label: 'GPT-4o+ high detail (OpenAI)', fn: openaiTokens },
  gemini: { label: 'Gemini (Google)', fn: geminiTokens },
};

// what a token costs (USD, mid-tier 2026 pricing, order-of-magnitude for
// "savings" display — labeled as estimate everywhere)
export const COST_PER_MTOK = {
  anthropic: 3.0, // claude sonnet input
  openai: 2.5,   // gpt-4o input
  gemini: 1.25,  // gemini 2.x flash-class input
};
