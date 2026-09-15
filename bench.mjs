// Reproducible benchmark — generates its test images in memory, runs them
// through optimize + encode, prints the README table. No fixtures required.
//   node bench.mjs
import { optimize } from './lib/optimize.js';
import { encodeJpeg } from './lib/jpeg.js';
import { writePng, resizeNearest } from './lib/png.js';

function makeImage(W, H, painter) {
  const data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = painter(x, y);
      const i = (y * W + x) * 3;
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  return { width: W, height: H, channels: 3, data };
}

const cases = [
  {
    name: 'screenshot-like 3000×2000',
    img: (() => {
      let seed = 12345;
      return makeImage(3000, 2000, (x, y) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const flip = (seed & 7) === 0;
        return [(x >> 2) & 0xff, (y >> 1) & 0xff, ((x ^ y) >> 1) & 0xff].map((v) => (flip ? v ^ 0x40 : v));
      });
    })(),
  },
  { name: 'chat UI 1280×800', img: (() => makeImage(1280, 800, (x, y) => (y < 60 || y > 740 ? [235, 235, 240] : [250, 250, 252])) )() },
  { name: 'phone shot 1080×2400', img: (() => makeImage(1080, 2400, (x, y) => [(x * 3 + y) & 0xff, (y >> 1) & 0xff, (x ^ y) & 0xff]))() },
];

const rows = [];
for (const { name, img } of cases) {
  const { width: w, height: h } = img;
  const basePng = writePng(img).length;
  const baseJpg = encodeJpeg(img, { quality: 85 }).length;
  const a = optimize('anthropic', w, h);
  const res = resizeNearest(img, a.best.w, a.best.h);
  const optJpg = encodeJpeg(res, { quality: 85 }).length;
  const b300 = optimize('openai', w, h, { maxTokens: 300 });
  const budgetJpg = encodeJpeg(resizeNearest(img, b300.best.w, b300.best.h), { quality: 85 }).length;
  rows.push({
    name, w, h,
    tokA: a.original.tokens, tokO: optimize('openai', w, h).original.tokens,
    exact: `${a.best.w}×${a.best.h}`,
    jpgBase: baseJpg, jpgOpt: optJpg, jpgSave: Math.round((1 - optJpg / baseJpg) * 100),
    pngBase: basePng, budget: `${b300.best.w}×${b300.best.h}`, budgetJpg, budgetTok: b300.original.tokens - b300.best.tokens,
  });
}

console.log('| image | in | Anthropic tok | exact→ | JPEG q85 | →optimized | | budget300→ |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`| ${r.name} | ${r.w}×${r.h} | ${r.tokA} | ${r.exact} | ${kb(r.jpgBase)} | ${kb(r.jpgOpt)} (−${r.jpgSave}%) | | ${r.budget} |`);
}
console.log('\n(anthropic tokens for input sizes; openai tok column:', rows.map((r) => r.tokO).join(', '), ')');
console.log('budget mode (openai, cap 300) saves', rows.map((r) => r.budgetTok).join('/'), 'tokens per image');
