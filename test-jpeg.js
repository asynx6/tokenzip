// JPEG codec tests. Cross-validation, not self-consistency:
//  - our encoder's output is verified by Windows GDI+ (independent decoder)
//  - our decoder reads a GDI+-encoded JPEG (independent encoder)
// verify-jpeg.ps1 generates + validates the cross files; run it after this
// suite on Windows, or `npm run test:jpeg:cross`.
import { encodeJpeg, decodeJpeg } from './lib/jpeg.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) pass++;
  else { fail++; console.error('FAIL ' + name); }
};
const meanAbs = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

// 1. encode → self-decode: structurally sane, visually close (lossy, q75)
{
  const W = 130, H = 90; // non-multiples of 16 stress MCU edges
  const src = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      src[i] = (x * 2) & 0xff; src[i + 1] = (y * 3) & 0xff; src[i + 2] = 90;
    }
  const jpg = encodeJpeg({ width: W, height: H, channels: 3, data: src }, { quality: 80 });
  ok(jpg[0] === 0xff && jpg[1] === 0xd8, 'jpeg SOI');
  ok(jpg.readUInt16BE(jpg.length - 2) === 0xffd9, 'jpeg EOI');
  const dec = decodeJpeg(jpg);
  ok(dec.width === W && dec.height === H, 'jpeg self-decode dims');
  const mae = meanAbs(dec.data, src);
  ok(mae < 6, `jpeg self-decode MAE ${mae.toFixed(2)} < 6 (q80 smooth gradient)`);
  const big = encodeJpeg({ width: W, height: H, channels: 3, data: src }, { quality: 20 });
  ok(big.length < jpg.length, 'lower quality → smaller file');
}

// 2. gray path
{
  const W = 40, H = 40;
  const src = Buffer.alloc(W * H, 170);
  const jpg = encodeJpeg({ width: W, height: H, channels: 1, data: src }, { quality: 90 });
  const dec = decodeJpeg(jpg);
  ok(dec.channels === 1 && meanAbs(dec.data, src) < 2, 'gray plane flat region ≈170');
}

// 3. random noise: 4:2:0 chroma subsampling genuinely discards most of the
// chroma of white noise — assert the LUMA path is tight (that's the code
// quality signal) and the pipeline doesn't crash
{
  const W = 32, H = 32;
  const src = randomBytes(W * H * 3);
  const jpg = encodeJpeg({ width: W, height: H, channels: 3, data: src }, { quality: 95 });
  const dec = decodeJpeg(jpg);
  let sy = 0;
  for (let i = 0; i < W * H; i++) {
    const y0 = 0.299 * src[i * 3] + 0.587 * src[i * 3 + 1] + 0.114 * src[i * 3 + 2];
    const y1 = 0.299 * dec.data[i * 3] + 0.587 * dec.data[i * 3 + 1] + 0.114 * dec.data[i * 3 + 2];
    sy += Math.abs(y0 - y1);
  }
  ok(dec.width === W && sy / (W * H) < 5, `noise luma MAE ${(sy / (W * H)).toFixed(1)} < 5 (q95)`);
}

// 4. write our encode for GDI+ to verify (verify-jpeg.ps1 checks it opens)
{
  const W = 100, H = 60;
  const src = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { src[i * 3] = (i * 7) & 0xff; src[i * 3 + 1] = (i * 13) & 0xff; src[i * 3 + 2] = (i * 3) & 0xff; }
  writeFileSync('fixtures/enc-tz.jpg', encodeJpeg({ width: W, height: H, channels: 3, data: src }, { quality: 85 }));
  ok(existsSync('fixtures/enc-tz.jpg'), 'wrote fixtures/enc-tz.jpg for GDI+ check');
}

// 5. GDI+ cross-validation fixtures (present only after verify-jpeg.ps1 ran)
{
  if (existsSync('fixtures/gen-gdi.jpg')) {
    const dec = decodeJpeg(readFileSync('fixtures/gen-gdi.jpg'));
    ok(dec.width === 64 && dec.height === 64, 'our decoder reads GDI+-encoded JPEG');
    const i = (32 * 64 + 32) * 3;
    const p = dec.data;
    ok(p[i] > 200 && p[i + 1] < 60 && p[i + 2] < 50, 'GDI+ ARGB(220,20,10) decoded correctly');
  } else {
    console.log('NOTE: gdi cross-tests skipped (run verify-jpeg.ps1)');
  }
}

console.log(`\n${fail === 0 ? '✔' : '✖'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
