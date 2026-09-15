#!/usr/bin/env node
// tokenzip — vision models pay for tiles, not megapixels. Send the size the
// model actually sees: identical tokens & detail, far fewer bytes uploaded.
// Zero dependency. Node >= 18.
//
//   tokenzip photo.png                          analyze (all providers)
//   tokenzip photo.png --provider openai        one provider
//   tokenzip photo.png --out photo-s.png        write optimized PNG
//   tokenzip photo.png --max-tokens 500         shrink INTO a token budget
//   tokenzip --dir ./shots --provider claude    whole folder summary

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { readPng, writePng, resizeNearest, paletteToRgba } from './lib/png.js';
import { encodeJpeg, decodeJpeg } from './lib/jpeg.js';
import { optimize } from './lib/optimize.js';
import { PROVIDERS, COST_PER_MTOK } from './lib/tokens.js';

const argv = process.argv.slice(2);
const flagVal = (name, def) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : def;
};
const has = (name) => argv.includes(name);

// subcommands that bypass analysis entirely.
// Set exitCode (not process.exit) so async stdio loops keep running.
if (argv[0] === 'mcp') {
  await import('./mcp/server.mjs');
  process.exitCode = 0;
} else if (argv[0] === 'hook') {
  // tokenzip hook claude-code — read stdin, write hook JSON
  await import(`./hooks/${argv[1] || 'claude-code'}.mjs`);
  process.exitCode = 0;
} else {
main();
}

function usage() {
  console.log(`tokenzip v${process.env.npm_package_version || '0.3.1'} — pay vision tokens, not megapixels

usage:
  tokenzip <file.png|dir> [--provider anthropic|openai|gemini|all]
                          [--max-tokens N] [--out file.png] [--dir]

a 3000×2000 screenshot costs Claude the same 1568 tokens whether you
send 6 MP or the 1.15 MP it actually downscales to. tokenzip computes that
exact size (or shrinks to your budget) and re-encodes — zero quality loss
within the model's own downscale.`);
}

function imageOf(buf, file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.png') return paletteToRgba(readPng(buf));
  if (ext === '.jpg' || ext === '.jpeg') return decodeJpeg(buf);
  throw new Error(`unsupported format ${ext} (v0.2: PNG + baseline JPEG)`);
}

function pngSizeFrom(buf) {
  // IHDR width/height without full decode — works for JPEG too? no: JPEG SOF parse
  if (buf.length > 24 && buf[0] === 0x89) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let pos = 2;
    while (pos + 9 < buf.length) {
      if (buf[pos] !== 0xff) break;
      const marker = buf[pos + 1];
      const len = buf.readUInt16BE(pos + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(pos + 5), w: buf.readUInt16BE(pos + 7) };
      }
      pos += 2 + len;
    }
  }
  throw new Error('cannot read image dimensions');
}

function main() {
const rows = [];
// values consumed by flags must not be treated as file targets
const VALUE_FLAGS = ['--provider', '--max-tokens', '--out'];
const consumed = new Set();
argv.forEach((a, i) => {
  if (VALUE_FLAGS.includes(a)) consumed.add(i + 1);
});
let targets = argv.filter((a, i) => !a.startsWith('--') && !consumed.has(i) && a !== 'tokenzip' && !['mcp', 'hook'].includes(a));
const dir = has('--dir');
const providerArg = flagVal('--provider', 'all');

if (!targets.length && !dir) {
  if (has('--version') || has('-v')) {
    console.log('0.3.1');
    process.exit(0);
  }
  usage();
  process.exit(0);
}

if (dir) {
  const folder = targets[0] || '.';
  targets = readdirSync(folder)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f) => join(folder, f));
}

const providers = providerArg === 'all' ? Object.keys(PROVIDERS) : [providerArg];
let maxTokens = Number(flagVal('--max-tokens', 0)) || null;
let outArg = flagVal('--out', null);

for (const file of targets) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch (e) {
    console.error(`cannot read ${file}`);
    continue;
  }
  let img = null, dims;
  try {
    dims = pngSizeFrom(buf);
    img = imageOf(buf, file);
  } catch (e) {
    try {
      dims = pngSizeFrom(buf);
    } catch {
      console.error(`${file}: ${e.message}`);
      continue;
    }
    console.error(`${file}: ${e.message} (analyzing size only)`);
  }
  const { w, h } = dims;

  for (const p of providers) {
    const r = optimize(p, w, h, { maxTokens });
    const cost = ((r.original.tokens / 1e6) * (COST_PER_MTOK[p] || 0));
    const savedCost = ((r.savedTokens / 1e6) * (COST_PER_MTOK[p] || 0));
    rows.push({ file, p, ...r, cost, savedCost });

    console.log(`\n${file} — ${w}×${h} (${PROVIDERS[p].label})`);
    console.log(`  billed tokens : ${r.original.tokens}${cost ? ` ≈ $${cost.toFixed(4)}/image` : ''}`);
    console.log(`  model sees    : ${r.best.w}×${r.best.h}`);
    if (r.mode === 'budget') {
      console.log(`  budget        : ${maxTokens} tokens → saved ${r.savedTokens} tokens${savedCost ? ` ≈ $${savedCost.toFixed(4)}` : ''}`);
      if (r.note.includes('floor')) console.log(`  note          : ${r.note}`);
    } else {
      console.log(`  pixels to send: ${(r.pixelRatio * 100).toFixed(1)}%${r.pixelRatio < 0.99 ? ` (${Math.round((1 - r.pixelRatio) * 100)}% fewer bytes)` : ''}`);
      console.log(`  note          : ${r.note}`);
    }

    if (outArg && img && r.best.w * r.best.h < img.width * img.height) {
      const resized = resizeNearest(img, r.best.w, r.best.h);
      const outBuf = /\.jpe?g$/i.test(outArg)
        ? encodeJpeg(resized, { quality: 85 })
        : writePng(resized);
      writeFileSync(outArg, outBuf);
      console.log(`  wrote         : ${outArg} (${outBuf.length} bytes)`);
      break; // one out file per run; provider loop done for this file
    }
  }
}

if (rows.length > 1) {
  const avgRatio = rows.reduce((a, r) => a + r.pixelRatio, 0) / rows.length;
  console.log(`\nsummary: ${rows.length} image/provider rows · avg upload ${Math.max(0, Math.round((1 - avgRatio) * 100))}% smaller`);
}
}
