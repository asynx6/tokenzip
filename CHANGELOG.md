# Changelog

## v0.3.0 — 2026-09-15

- `tokenzip mcp` — MCP server (stdio JSON-RPC): `tokenzip_estimate`,
  `tokenzip_optimize`, `tokenzip_batch_dir`. Works with Claude Desktop,
  OpenCode, Cursor, Cline — any MCP host, zero dependency.
- `tokenzip hook claude-code` — Claude Code PreToolUse hook: intercepts
  image Reads and hands Claude the tokenzip'd copy (same tokens, fewer
  bytes). Fails silent by design: never blocks, never opinions on
  non-images.
- Integration tests spawn both the way hosts actually do (13 cases).
- Release workflow for provenance publishing via GitHub Actions.

## v0.2.0 — 2026-09-15

- Baseline JPEG encode + decode, zero dependency (4:4:4/4:2:0, quality knob,
  gray + color). Cross-validated both directions against Windows GDI+.
- `--out image.jpg` now re-encodes JPEG; PNG path unchanged.
- Formula provenance pinned in FORMULAS.md with update procedure.
- Benchmark table (bench.mjs) + README chart (gen-demo.mjs), both
  reproducible from a clean clone.
- Library entry points documented; same tested math as the CLI.
- Tests: 12 provider-math + 12 codec/optimize + 10 JPEG (24 → 34).
- npm package renamed to `@asynx6/tokenzip` (`tokenzip` unclaimed — taken).

## v0.1.0 — 2026-09-14

- Initial: per-provider token math (Claude/GPT-4o/Gemini), exact + budget
  resize modes, zero-dep PNG codec (read/write/resize), folder mode, CLI.
