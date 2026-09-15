// Baseline JPEG read/write, zero dependency.
// Supports: baseline sequential, Huffman, 1 or 3 components, sampling 4:4:4
// and 4:2:0. Progressive/lossless/restart inputs are rejected with a clear
// message (rare for screenshots; convert with any other tool if needed).
// Encoder output is verified byte-identical-decodable by Windows GDI+
// (System.Drawing) in test-jpeg.js — an independent decoder.

// ---- tables ----
// canonical JPEG zigzag scan (mathematically generated, verified against
// the (row,col) walk of ITU-T T.81 Figure A.16): scan position → natural index
const ZIG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37,
  44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const LQ = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 24, 25, 43, 69, 78, 71,
  22, 28, 56, 68, 81, 66, 78, 80, 27, 62, 72, 69, 73, 64, 78, 74,
  42, 72, 76, 77, 76, 78, 80, 83, 64, 76, 78, 79, 80, 80, 80, 80,
];
const CQ = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];
const hexStr = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const HT = {
  ydc: { bits: [0,0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0], vals: hexStr('000102030405060708090a0b') },
  yacc: { bits: [0,0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,125], vals: hexStr('01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa') },
  cdc: { bits: [0,0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0], vals: hexStr('000102030405060708090a0b') },
  cac: { bits: [0,0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,119], vals: hexStr('000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9fa') },
};

// ---- DCT (float, correct two-pass) ----
const COS = new Float64Array(64); // COS[u*8+x] = a(u)·cos((2x+1)uπ/16)
for (let u = 0; u < 8; u++) {
  const a = u === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8);
  for (let x = 0; x < 8; x++) COS[u * 8 + x] = a * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
}
// f, F row-major [y*8+x] (x = column, y = row)
function fdct(f, F) {
  const T = new Float64Array(64); // T[u*8+y]
  for (let u = 0; u < 8; u++)
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * f[y * 8 + x];
      T[u * 8 + y] = s;
    }
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += T[u * 8 + y] * COS[v * 8 + y];
      F[u * 8 + v] = s;
    }
}
function idct(F, f) {
  const T = new Float64Array(64); // T[x*8+v]
  for (let x = 0; x < 8; x++)
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += COS[u * 8 + x] * F[u * 8 + v];
      T[x * 8 + v] = s;
    }
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += T[x * 8 + v] * COS[v * 8 + y];
      f[y * 8 + x] = s;
    }
}

function scaleTable(base, quality) {
  const q = Math.max(1, Math.min(100, quality));
  const s = q < 50 ? 5000 / q : 200 - q * 2;
  return base.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100))));
}
function buildEnc(bits, vals) {
  const t = new Map();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len]; i++) {
      t.set(vals[k++], { code, len });
      code++;
    }
    code <<= 1;
  }
  return t;
}
function buildDec(bits, vals) {
  const map = new Map();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len]; i++) {
      map.set((len << 16) | code, vals[k++]);
      code++;
    }
    code <<= 1;
  }
  return map;
}

// ===================== ENCODER =====================
class BitWriter {
  constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
  put(code, len) {
    this.acc = (this.acc << len) | (code & ((1 << len) - 1));
    this.n += len;
    while (this.n >= 8) {
      this.n -= 8;
      const b = (this.acc >> this.n) & 0xff;
      this.bytes.push(b);
      if (b === 0xff) this.bytes.push(0);
    }
    this.acc &= (1 << this.n) - 1;
  }
  flush() {
    while (this.n > 0) { this.put(1, 1); } // pad with 1-bits
    return Buffer.from(this.bytes);
  }
}
const category = (v) => { let a = v < 0 ? -v : v, c = 0; while (a) { c++; a >>= 1; } return c; };

function encodeBlock(bw, F, qn, tdc, tac, prevDC) {
  const z = new Int16Array(64);
  for (let i = 0; i < 64; i++) z[i] = Math.round(F[i] / qn[i]);
  const diff = z[0] - prevDC;
  const s = category(diff);
  const e = tdc.get(s);
  bw.put(e.code, e.len);
  if (s) bw.put(diff < 0 ? diff + (1 << s) - 1 : diff, s);
  let run = 0;
  for (let i = 1; i < 64; i++) {
    const v = z[ZIG[i]];
    if (v === 0) { run++; continue; }
    while (run > 15) { const e = tac.get(0xf0); bw.put(e.code, e.len); run -= 16; }
    const ss = category(v);
    const ea = tac.get((run << 4) | ss);
    bw.put(ea.code, ea.len);
    bw.put(v < 0 ? v + (1 << ss) - 1 : v, ss);
    run = 0;
  }
  if (run > 0) { const e = tac.get(0x00); bw.put(e.code, e.len); }
  return z[0];
}

const be16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const seg = (marker, payload) => Buffer.concat([Buffer.from([0xff, marker]), be16(payload.length + 2), payload]);

export function encodeJpeg(img, { quality = 75 } = {}) {
  const { width: w, height: h, channels } = img;
  if (![1, 3, 4].includes(channels)) throw new Error('jpeg encode: need gray/RGB/RGBA pixels');
  const gray = channels === 1;
  const src = channels === 4 ? rgbaToRgb(img).data : img.data;
  const Y = new Float64Array(w * h);
  const cw = gray ? 0 : Math.ceil(w / 2), chh = gray ? 0 : Math.ceil(h / 2);
  const Cb = gray ? null : new Float64Array(cw * chh);
  const Cr = gray ? null : new Float64Array(cw * chh);
  const cnt = gray ? null : new Uint16Array(cw * chh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = src[i];
      const g = gray ? r : src[i + 1];
      const b = gray ? r : src[i + 2];
      Y[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (!gray) {
        // subsample: box average over the 2×2 cell, edge-safe
        const cx = x >> 1, cy = y >> 1;
        const k = cy * cw + cx;
        Cb[k] += -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
        Cr[k] += 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
        cnt[k]++;
      }
    }
  }
  if (!gray) for (let k = 0; k < cw * chh; k++) { if (cnt[k]) { Cb[k] /= cnt[k]; Cr[k] /= cnt[k]; } }
  const qY = scaleTable(LQ, quality), qC = scaleTable(CQ, quality);
  const tdcY = buildEnc(HT.ydc.bits, HT.ydc.vals), tacY = buildEnc(HT.yacc.bits, HT.yacc.vals);
  const tdcC = buildEnc(HT.cdc.bits, HT.cdc.vals);
  const bw = new BitWriter();
  const blk = new Float64Array(64), F = new Float64Array(64);
  const extract = (plane, pw, ph, bx, by) => {
    for (let v = 0; v < 8; v++)
      for (let u = 0; u < 8; u++) {
        const x = Math.min(bx * 8 + u, pw - 1), y = Math.min(by * 8 + v, ph - 1);
        blk[v * 8 + u] = plane[y * pw + x] - 128;
      }
  };
  let dcY = 0, dcB = 0, dcR = 0;
  if (gray) {
    for (let by = 0; by < Math.ceil(h / 8); by++) {
      for (let bx = 0; bx < Math.ceil(w / 8); bx++) {
        extract(Y, w, h, bx, by);
        fdct(blk, F);
        dcY = encodeBlock(bw, F, qY, tdcY, tacY, dcY);
      }
    }
  } else {
    const mcuX = Math.ceil(w / 16), mcuY = Math.ceil(h / 16);
    for (let my = 0; my < mcuY; my++) {
      for (let mx = 0; mx < mcuX; mx++) {
        for (const [by, bx] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          extract(Y, w, h, mx * 2 + bx, my * 2 + by);
          fdct(blk, F);
          dcY = encodeBlock(bw, F, qY, tdcY, tacY, dcY);
        }
        extract(Cb, cw, chh, mx, my);
        fdct(blk, F);
        dcB = encodeBlock(bw, F, qC, tdcC, tacC(), dcB);
        extract(Cr, cw, chh, mx, my);
        fdct(blk, F);
        dcR = encodeBlock(bw, F, qC, tdcC, tacC(), dcR);
      }
    }
  }
  function tacC() { if (!tacC.t) tacC.t = buildEnc(HT.cac.bits, HT.cac.vals); return tacC.t; }

  const dqt = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(quantToZig(qY)),
    ...(gray ? [] : [Buffer.from([0x01]), Buffer.from(quantToZig(qC))]),
  ]);
  const sofComps = gray
    ? Buffer.from([1, 1, 0x11, 0])
    : Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sof = Buffer.concat([Buffer.from([8]), be16(h), be16(w), sofComps]);
  const hdt = (tab) => Buffer.concat([
    Buffer.from(tab.hdr),
    Buffer.from(tab.bits.slice(1)),
    Buffer.from(tab.vals),
  ]);
  const dhts = [
    seg(0xc4, hdt({ hdr: [0x00], bits: HT.ydc.bits, vals: HT.ydc.vals })),
    seg(0xc4, hdt({ hdr: [0x10], bits: HT.yacc.bits, vals: HT.yacc.vals })),
    ...(gray ? [] : [
      seg(0xc4, hdt({ hdr: [0x01], bits: HT.cdc.bits, vals: HT.cdc.vals })),
      seg(0xc4, hdt({ hdr: [0x11], bits: HT.cac.bits, vals: HT.cac.vals })),
    ]),
  ];
  const app0 = Buffer.from([
    0x4a, 0x46, 0x49, 0x46, 0x00, // 'JFIF\0'
    0x01, 0x01, 0x01, // v1.1, units=dots/inch
    0x00, 0x48, 0x00, 0x48, // 72 dpi
    0x00, 0x00, // no thumbnail
  ]);
  const sosComp = gray
    ? Buffer.from([1, 1, 0x00, 0x00, 0x3f, 0x00])
    : Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, app0),
    seg(0xdb, dqt),
    seg(0xc0, sof),
    ...dhts,
    seg(0xda, sosComp),
    bw.flush(),
    Buffer.from([0xff, 0xd9]),
  ]);
}
const quantToZig = (q) => { const o = new Uint8Array(64); for (let i = 0; i < 64; i++) o[i] = q[ZIG[i]]; return o; };
function rgbaToRgb(img) {
  const { width, height, data } = img;
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    out[i * 3] = data[i * 4]; out[i * 3 + 1] = data[i * 4 + 1]; out[i * 3 + 2] = data[i * 4 + 2];
  }
  return { width, height, channels: 3, data: out };
}

// ===================== DECODER =====================
class BitReader {
  constructor(buf, pos) { this.b = buf; this.p = pos; this.acc = 0; this.n = 0; }
  bit() {
    if (this.n === 0) {
      let x = this.b[this.p++];
      if (x === 0xff && this.b[this.p] === 0) this.p++; // un-stuff
      this.acc = x; this.n = 8;
    }
    this.n--;
    return (this.acc >> this.n) & 1;
  }
  bits(k) { let v = 0; for (let i = 0; i < k; i++) v = (v << 1) | this.bit(); return v; }
  huff(map) {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | this.bit();
      const s = map.get((len << 16) | code);
      if (s !== undefined) return s;
    }
    throw new Error('jpeg: bad huffman code');
  }
}
const extend = (v, t) => (t === 0 ? 0 : v < 1 << (t - 1) ? v - ((1 << t) - 1) : v);

export function decodeJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let pos = 2;
  const quants = [];
  const huffs = new Map(); // (cls<<4)|id -> decoder map
  let frame = null, scan = null;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) { pos++; continue; }
    const m = buf[pos + 1];
    if (m === 0xd9) break; // EOI
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { pos += 2; continue; }
    const L = buf.readUInt16BE(pos + 2);
    const p = buf.subarray(pos + 4, pos + 2 + L);
    pos += 2 + L;
    if (m === 0xdb) {
      let i = 0;
      while (i < p.length) {
        const pq = p[i] >> 4, id = p[i] & 15;
        i++;
        const t = new Float64Array(64);
        // DQT payload is zigzag order: val[j] belongs to natural index ZIG[j]
        for (let j = 0; j < 64; j++) {
          const val = pq === 0 ? p[i + j] : p.readUInt16BE(i + j * 2);
          t[ZIG[j]] = val;
        }
        quants[id] = t;
        i += pq === 0 ? 64 : 128;
      }
    } else if (m === 0xc4) {
      let i = 0;
      while (i < p.length) {
        const tc = p[i] >> 4, th = p[i] & 15;
        i++;
        const bits = new Uint8Array(17);
        bits.set(p.subarray(i, i + 16), 1);
        i += 16;
        const total = bits.reduce((a, b) => a + b, 0);
        const vals = p.subarray(i, i + total);
        huffs.set((tc << 4) | th, buildDec(bits, vals));
        i += total;
      }
    } else if (m === 0xc2 || m >= 0xc5 && m <= 0xc7 || m >= 0xc9 && m <= 0xcb || m >= 0xcd && m <= 0xcf) {
      throw new Error('jpeg: progressive/lossless not supported (v0.2: baseline only)');
    } else if (m >= 0xc0 && m <= 0xc1 || m === 0xc3) {
      const precision = p[0], height = p.readUInt16BE(1), width = p.readUInt16BE(3);
      const nc = p[5];
      const comps = [];
      for (let c = 0; c < nc; c++) {
        comps.push({
          id: p[6 + c * 3],
          h: p[7 + c * 3] >> 4,
          v: p[7 + c * 3] & 15,
          tq: p[8 + c * 3],
        });
      }
      frame = { width, height, comps };
    } else if (m === 0xdd) {
      throw new Error('jpeg: restart intervals not supported (v0.2)');
    } else if (m === 0xda) {
      const ns = p[0];
      const comps = [];
      for (let c = 0; c < ns; c++) comps.push({ id: p[1 + c * 2], td: p[2 + c * 2] >> 4, ta: p[2 + c * 2] & 15 });
      scan = { comps, dataStart: pos };
      break;
    }
  }
  if (!frame) throw new Error('jpeg: no SOF');
  if (!scan) throw new Error('jpeg: no SOS');
  // attach scan selectors (Td/Ta) to frame components by id
  const selOf = new Map(scan.comps.map((c) => [c.id, c]));
  const comps = frame.comps.map((c) => ({ ...c, ...selOf.get(c.id) }));
  const { width: w, height: h } = frame;
  const planes = comps.map((c) => new Float64Array(w * h));
  const br = new BitReader(buf, scan.dataStart);
  const dc = comps.map(() => 0);
  const b1 = new Float64Array(64), b2 = new Float64Array(64);
  const Hm = Math.max(...comps.map((c) => c.h)), Vm = Math.max(...comps.map((c) => c.v));
  const mcuX = Math.ceil(w / (8 * Hm)), mcuY = Math.ceil(h / (8 * Vm));
  const decodeTo = (plane, pw, ph, comp, ci, bx, by) => {
    const compH = comp.h, compV = comp.v;
    const q = quants[comp.tq] || new Float64Array(64).fill(1);
    const tdc = huffs.get(comp.td); // class 0 (DC) → key is just the id
    const tac = huffs.get((1 << 4) | comp.ta);
    b1.fill(0);
    const rs = br.huff(tdc);
    if (rs > 0) dc[ci] += extend(br.bits(rs), rs);
    b1[0] = dc[ci] * q[0];
    let i = 1;
    while (i < 64) {
      const r = br.huff(tac);
      const rr = r >> 4, ss = r & 15;
      if (ss === 0 && rr === 0) break; // EOB
      i += rr; // skip the run-length zeros before the nonzero coefficient
      if (i >= 64) break;
      if (ss === 0) continue; // ZRL (rr=15) consumed above
      b1[ZIG[i]] = extend(br.bits(ss), ss) * q[ZIG[i]];
      i++;
    }
    idct(b1, b2);
    // nearest upscale to full-res plane: sample factor relative to max
    const sx = Hm / compH, sy = Vm / compV;
    const x0 = Math.floor((bx * 8 * sx)), x1 = Math.floor(((bx + 1) * 8 * sx));
    const y0 = Math.floor((by * 8 * sy)), y1 = Math.floor(((by + 1) * 8 * sy));
    for (let y = y0; y < y1 && y < h; y++)
      for (let x = x0; x < x1 && x < w; x++) {
        const u = Math.min(7, Math.floor((x - x0) / sx)), v = Math.min(7, Math.floor((y - y0) / sy));
        plane[y * w + x] = b2[v * 8 + u];
      }
  };
  for (let my = 0; my < mcuY; my++) {
    for (let mx = 0; mx < mcuX; mx++) {
      comps.forEach((comp, ci) => {
        // blocks in an MCU = comp.h × comp.v; planes are full-res (stride w),
        // decodeTo upscales via the sampling factor
        for (let v = 0; v < comp.v; v++) {
          for (let u = 0; u < comp.h; u++) {
            decodeTo(planes[ci], w, h, comp, ci, mx * comp.h + u, my * comp.v + v);
          }
        }
      });
    }
  }
  // YCbCr → RGB (planes 0,1,2; add 128 back after IDCT offset)
  const out = Buffer.alloc(w * h * (comps.length === 1 ? 1 : 3));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const yy = planes[0][i] + 128;
      if (comps.length === 1) { out[i] = Math.max(0, Math.min(255, Math.round(yy))); continue; }
      // planes[1]/[2] are IDCT outputs = stored−128 (extract() shifted them);
      // the inverse matrix uses the level-shifted Cr/Cb directly
      const cb = planes[1][i], cr = planes[2][i];
      const r = yy + 1.402 * cr, g = yy - 0.344136 * cb - 0.714136 * cr, b = yy + 1.772 * cb;
      const o = i * 3;
      out[o] = Math.max(0, Math.min(255, Math.round(r)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return { width: w, height: h, channels: comps.length === 1 ? 1 : 3, data: out };
}
