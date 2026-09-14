// Minimal PNG read/write, 8-bit, non-interlaced, zero dependency.
// v0.1 supports color types 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha), 6 (RGBA).

import { inflateSync, deflateSync } from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function readPng(buf) {
  if (buf.length < 8 || buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('not a PNG');
  }
  let pos = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG without IHDR');
  if (ihdr.interlace) throw new Error('interlaced PNG not supported (v0.1)');
  if (ihdr.bitDepth !== 8) throw new Error('only 8-bit PNG supported (v0.1)');
  const channels = CH[ihdr.colorType];
  if (!channels) throw new Error('unsupported color type ' + ihdr.colorType);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const out = Buffer.alloc(ihdr.height * stride);
  let rp = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[rp++];
    const rowIn = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = rowIn[x]; break;
        case 1: v = rowIn[x] + a; break;
        case 2: v = rowIn[x] + b; break;
        case 3: v = rowIn[x] + ((a + b) >> 1); break;
        case 4: v = rowIn[x] + paeth(a, b, c); break;
        default: throw new Error('bad PNG filter ' + filter);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width: ihdr.width, height: ihdr.height, colorType: ihdr.colorType, channels, plte, trns, data: out };
}

function crc32(buf) {
  let c, table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** encode RGBA (channels 4) or RGB (3) or gray (1) pixel buffer → PNG */
export function writePng(img, filterHeuristic = true) {
  const { width, height, channels, data } = img;
  const colorType = { 1: 0, 3: 2, 4: 6 }[channels] ?? (channels === 2 ? 4 : 6);
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  let wp = 0;
  for (let y = 0; y < height; y++) {
    let filterByte = 0;
    if (!filterHeuristic) {
      raw[wp++] = 0;
      data.copy(raw, wp, y * stride, (y + 1) * stride);
      wp += stride;
      continue;
    }
    // pick best per-row filter by sum-of-absolute-deviates heuristic
    let bestScore = Infinity;
    const rowStart = y * stride;
    for (const f of [0, 1, 2, 3, 4]) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const cur = data[rowStart + x];
        const a = x >= channels ? data[rowStart + x - channels] : 0;
        const b = y ? data[rowStart - stride + x] : 0;
        const c = y && x >= channels ? data[rowStart - stride + x - channels] : 0;
        let pred;
        if (f === 0) pred = 0;
        else if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else pred = paeth(a, b, c);
        const v = (cur - pred) & 0xff;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        filterByte = f;
      }
    }
    raw[wp++] = filterByte;
    for (let x = 0; x < stride; x++) {
      const cur = data[rowStart + x];
      const a = x >= channels ? data[rowStart + x - channels] : 0;
      const b = y ? data[rowStart - stride + x] : 0;
      const c = y && x >= channels ? data[rowStart - stride + x - channels] : 0;
      let pred;
      if (filterByte === 0) pred = 0;
      else if (filterByte === 1) pred = a;
      else if (filterByte === 2) pred = b;
      else if (filterByte === 3) pred = (a + b) >> 1;
      else pred = paeth(a, b, c);
      raw[wp + x] = (cur - pred) & 0xff;
    }
    wp += stride;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** box-average downscale of a raw pixel buffer */
export function resizeNearest(img, tw, th) {
  const { width, height, channels, data } = img;
  const out = Buffer.alloc(tw * th * channels);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / tw));
      data.copy(out, (y * tw + x) * channels, (sy * width + sx) * channels, (sy * width + sx) * channels + channels);
    }
  }
  return { width: tw, height: th, channels, data: out };
}

/** expand palette image to RGBA */
export function paletteToRgba(png) {
  const { width, height, channels, data, plte, trns } = png;
  if (png.colorType !== 3) return png;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = data[i];
    out[i * 4] = plte[idx * 3];
    out[i * 4 + 1] = plte[idx * 3 + 1];
    out[i * 4 + 2] = plte[idx * 3 + 2];
    out[i * 4 + 3] = trns ? (trns[idx] ?? 255) : 255;
  }
  return { width, height, channels: 4, colorType: 6, data: out };
}
