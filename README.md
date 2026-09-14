# tokenzip

Vision models count image tokens by *tiles*, not megapixels. A 3000×2000
screenshot costs Claude exactly the same 1568 tokens whether you upload 6
megapixels or the 1328×885 it internally resizes to. tokenzip computes that
exact size per provider and re-encodes the PNG: same tokens, same detail
the model ever sees, ~80% fewer bytes uploaded.

```
$ tokenzip screenshot.png --provider anthropic

screenshot.png — 3000×2000 (Claude (Anthropic))
  billed tokens : 1568 ≈ $0.0047/image
  model sees    : 1328×885
  pixels to send: 19.6% (80% fewer bytes)
  note          : send 1328×885: identical tokens & detail, 80% fewer bytes
```

## What it does

- **Per-provider token math** for Claude, GPT-4o+, and Gemini — the resize +
  tile formulas from each provider's own docs, pinned with tests (512²→255
  tokens, 768²→787, 2×768→258, etc.).
- **Exact mode**: shrink to the size the provider's own pipeline ends up at.
  Token bill unchanged, upload bytes slashed (matters for latency, egress
  fees, mobile, batch agents that resend images every turn).
- **Budget mode** (`--max-tokens 300`): binary-searches the largest resize
  that fits your cap, and tells you how many tokens it saves per image.
- **Re-encode** (`--out`): writes the optimized PNG with a built-in zero-dep
  encoder (8-bit, non-interlaced; RGB/RGBA/palette input).
- **Folder mode** (`--dir ./shots`): per-image analysis across a directory.

## Why this saves anything

The money saving is a myth worth killing honestly: tiles are billed on the
provider's *post-resize* dimensions, so resizing first costs you zero
tokens saved on a single image. What you actually save:

1. Upload bandwidth and time — a screenshot batch of 500 images at 80%
   fewer bytes is a real bill on egress-priced storage and a real wall-clock
   cut for agents.
2. Budget mode is where money moves: an agent that sends 1105-token tiles
   per screenshot but only needs layout understanding can cap at 300 and
   cut its vision bill ~70%, with the tool finding the sharpest image that
   fits.
3. Knowing the floor: images under ~768px are one tile on every provider —
   making screenshots small *is* the optimization, and `tokenzip` shows the
   exact per-provider breakpoints.

## Install / run

```bash
npm install -g github:asynx6/tokenzip   # installs the `tokenzip` command
# or just: clone, then `node tokenzip.js ...` (no install step, no deps)
node tokenzip.js ./shot.png --max-tokens 500 --out ./shot-z.png
```

Zero dependencies. Node ≥ 18. Single-file CLI, auditable libraries:
`lib/tokens.js` (formulas + sources), `lib/optimize.js` (search),
`lib/png.js` (PNG codec).

## Limitations (read before trusting)

- v0.1 reads JPEG dimensions but cannot re-encode JPEGs (needs a codec —
  open issue, PRs welcome). PNGs only for `--out`.
- 8-bit, non-interlaced PNGs only.
- Token formulas match provider docs as of 2026-09. They have changed
  before; pin this file if you build on the math (`tokensAt()` is exported).
- Cost figures are order-of-magnitude list-price estimates. Your rate plan
  differs.
- Budget mode optimizes pixels-per-token, not task quality. Only you know
  whether 300 tokens still reads your chart. Check the resized output.

## Tests

```bash
node test-tokens.js   # 12 provider-math cases against documented examples
node test-png.js      # codec roundtrips, palette, resize, optimize invariants
```

## License

MIT
