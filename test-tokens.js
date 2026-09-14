import { anthropicTokens, openaiTokens, geminiTokens } from './lib/tokens.js';

let pass = 0, fail = 0;
const eq = (a, b, name) => {
  if (a === b) pass++;
  else { fail++; console.error(`FAIL ${name}: got ${a}, want ${b}`); }
};

// OpenAI cookbook calculate_tokens (smart aspect handling):
// scale longest→2048, then short→≤768, tiles of 512, 85 + 170/tile
eq(openaiTokens(512, 512), 255, 'openai 1 tile');
eq(openaiTokens(1024, 1024), 765, 'openai 4 tiles');
eq(openaiTokens(200, 200), 255, 'openai small still 1 tile (85+170)');
eq(openaiTokens(2048, 2048), 765, 'openai 2048² scaled by short side');
eq(openaiTokens(4096, 2048), 1105, 'openai wide: →1536×768 → 3×2 tiles = 1105');
eq(openaiTokens(768, 768), 765, 'openai 768²: ceil(768/512)=2 → 4 tiles = 765');
eq(openaiTokens(1536, 1536), 765, 'openai 1536²: short 1536→768 → 768² → 4 tiles');

// Anthropic: area/750, cap 1568
eq(anthropicTokens(768, 768), 787, 'anthropic 768²');
eq(anthropicTokens(2000, 2000), 1568, 'anthropic capped');
eq(anthropicTokens(100, 100), 14, 'anthropic small');

// Gemini: tiles of 768, 258 each
eq(geminiTokens(768, 768), 258, 'gemini 1 tile');
eq(geminiTokens(1536, 1536), 1032, 'gemini 4 tiles');

console.log(`\n${fail === 0 ? '✔' : '✖'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
