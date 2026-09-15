# FORMULAS.md — vision token math provenance

Every formula in `lib/tokens.js` is pinned here with its source and the date
last verified. If a provider changes pricing or tiling, update THIS file and
add a failing-then-passing test case to `test-tokens.js`.

| provider | formula | source | verified |
|---|---|---|---|
| Anthropic | `ceil(w·h / 750)`, cap 1568, >8000px longest side downscaled | docs.anthropic.com/en/docs/build-with-claude/vision ("Calculate output tokens"/"Image resolutions") | 2026-09 |
| OpenAI (GPT-4o+) | scale longest→2048, then short→≤768; tiles of 512; `85 + 170·tiles` | platform.openai.com/docs/guides/image-understanding + cookbook `calculate_tokens` | 2026-09 |
| Gemini | tile into 768×768; `258 · tiles` | ai.google.dev/gemini-api/docs/image-understanding | 2026-09 |

## Pinned examples (also in test-tokens.js)

- 512×512 → OpenAI 255 (docs example)
- 1024×1024 → OpenAI 765 (docs example)
- 3000×2000 → Anthropic 1568 (cap)
- 768×768 → Anthropic 787
- 768×768 → Gemini 258; 1536×1536 → 1032

## Update procedure for contributors

1. Find the new rule in the provider's official docs (no blog posts, no
   secondary sites).
2. Record it in the table above with the month/year.
3. Add at least two pinned examples from the docs to `test-tokens.js` and
   confirm they FAIL against the old formula before editing `lib/tokens.js`.
4. If the effective-resize step changed, update `effectiveSize()` in
   `lib/optimize.js` and re-run `node bench.mjs` to refresh README numbers.

History:
- 2026-09: initial pinning (v0.1/v0.2).
