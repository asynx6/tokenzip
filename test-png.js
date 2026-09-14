// PNG codec roundtrip tests — generate images in-memory, encode, decode,
// compare pixels. Also validates optimize() against provider math.
import { readPng, writePng, resizeNearest, paletteToRgba } from './lib/png.js';
import { optimize } from './lib/optimize.js';
import { tokensAt } from './lib/optimize.js';
import { randomBytes } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) pass++;
  else { fail++; console.error('FAIL ' + name); }
};

// 1. RGBA roundtrip: encode → decode → identical pixels
{
  const W = 97, H = 61; // odd sizes stress filters
  const data = randomBytes(W * H * 4);
  const enc = writePng({ width: W, height: H, channels: 4, data });
  const dec = readPng(enc);
  ok(dec.width === W && dec.height === H, 'roundtrip dims');
  ok(Buffer.compare(dec.data, data) === 0, 'roundtrip RGBA pixels identical');
}

// 2. RGB roundtrip
{
  const W = 40, H = 25;
  const data = randomBytes(W * H * 3);
  const enc = writePng({ width: W, height: H, channels: 3, data });
  const dec = readPng(enc);
  ok(Buffer.compare(dec.data, data) === 0, 'roundtrip RGB pixels identical');
}

// 3. palette expansion
{
  const W = 8, H = 8;
  const idx = Buffer.alloc(W * H);
  for (let i = 0; i < idx.length; i++) idx[i] = i % 4;
  const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 128, 128, 128]);
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    plte.copy(rgba, i * 4, idx[i] * 3, idx[i] * 3 + 3);
    rgba[i * 4 + 3] = 255;
  }
  const exp = paletteToRgba({ width: W, height: H, colorType: 3, channels: 1, data: idx, plte });
  ok(Buffer.compare(exp.data, rgba) === 0, 'paletteToRgba correct RGB + opaque alpha');
}

// 4. resize sanity: dims + a sampled pixel matches source location
{
  const W = 200, H = 100;
  const data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    data[i] = x & 0xff; data[i + 1] = y & 0xff; data[i + 2] = 128;
  }
  const small = resizeNearest({ width: W, height: H, channels: 3, data }, 100, 50);
  ok(small.width === 100 && small.height === 50, 'resize dims');
  // target (50,25) samples source ((25+.5)*2, (50+.5)*2) = (101, 51)
  const i = (25 * 100 + 50) * 3;
  ok(small.data[i] === 101 && small.data[i + 1] === 51, 'resize samples pixel centers');
}

// 5. optimize: oversized screenshot → provider effective size, tokens unchanged
{
  const r = optimize('anthropic', 3000, 2000);
  ok(r.original.tokens === r.best.tokens, 'exact mode keeps tokens');
  ok(r.pixelRatio < 0.25, 'exact mode cuts pixels hard on big images');
  const t = tokensAt('anthropic', r.best.w, r.best.h);
  ok(t === r.original.tokens, 'optimized dims really produce same token count');
}

// 6. optimize budget: saved tokens never below zero, result fits budget
{
  const r = optimize('openai', 3000, 2000, { maxTokens: 300 });
  ok(r.best.tokens <= 300, 'budget respected');
  ok(r.savedTokens > 0, 'budget mode saves tokens');
}

// 7. small images: optimize leaves them alone
{
  const r = optimize('anthropic', 300, 200);
  ok(r.best.w === 300 && r.best.h === 200, 'small image untouched');
}

console.log(`\n${fail === 0 ? '✔' : '✖'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
