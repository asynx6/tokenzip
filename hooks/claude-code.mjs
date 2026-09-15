// tokenzip hook for Claude Code — intercepts Read tool calls on oversized
// images and hands Claude the resized copy (same vision tokens, fewer bytes,
// faster tool results).
//
// settings.json:
//   "hooks": { "PreToolUse": [ { "matcher": "Read", "hooks": [
//     { "type": "command", "command": "npx -y @asynx6/tokenzip hook claude-code" } ] } ] } }
//
// Protocol: JSON payload on stdin; respond on stdout with
//   { hookSpecificOutput: { hookEventName:"PreToolUse", permissionDecision, updatedInput, additionalContext } }
// Silence (empty stdout, exit 0) = no opinion, never block on our own errors.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readPng, writePng, resizeNearest, paletteToRgba } from '../lib/png.js';
import { encodeJpeg, decodeJpeg } from '../lib/jpeg.js';
import { optimize } from '../lib/optimize.js';

const CACHE = process.env.TOKENZIP_CACHE || join(tmpdir(), 'tokenzip-hook');

async function readStdin() {
  return new Promise((res) => {
    let s = '';
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
    process.stdin.on('error', () => res(''));
  });
}

function out(o) {
  process.stdout.write(JSON.stringify(o));
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse((await readStdin()) || '{}');
} catch {
  process.exit(0); // garbage stdin: no opinion, never block
}
const tool = payload.tool_name;
const input = payload.tool_input || {};
if (tool !== 'Read' || !input.file_path) process.exit(0);

const file = input.file_path;
const ext = extname(file).toLowerCase();
if (!['.png', '.jpg', '.jpeg'].includes(ext)) process.exit(0);

let img, buf;
try {
  buf = readFileSync(file);
  img = ext === '.png' ? paletteToRgba(readPng(buf)) : decodeJpeg(buf);
} catch {
  process.exit(0); // unparseable or unsupported variant — not ours to judge
}

// provider choice: explicit env, else the cheapest-token plan across all three
const provider = process.env.TOKENZIP_PROVIDER || 'anthropic';
const r = optimize(provider, img.width, img.height);
if (r.best.w === img.width && r.best.h === img.height) process.exit(0); // already optimal

const dir = dirname(file);
const targetBase = existsSync(dir) && isWritable(dir)
  ? dir
  : (mkdirSync(CACHE, { recursive: true }), CACHE);
const h = createHash('sha1').update(file).update(statSync(file).size + '').digest('hex').slice(0, 8);
const outName = '.tokenzip-' + basename(file, extname(file)) + '-' + h + ext;
const target = join(targetBase, outName);

if (!existsSync(target)) {
  const resized = resizeNearest({ width: img.width, height: img.height, channels: img.channels, data: img.data }, r.best.w, r.best.h);
  writeFileSync(target, /\.jpe?g$/i.test(ext) ? encodeJpeg(resized, { quality: 85 }) : writePng(resized));
}

out({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: { ...input, file_path: target },
    additionalContext:
      `tokenzip: image was ${img.width}x${img.height}; Claude sees the resized ${r.best.w}x${r.best.h} copy at ${target} ` +
      `(identical vision-token count ${r.original.tokens}, ${Math.round((1 - r.pixelRatio) * 100)}% fewer bytes). Original unchanged.`,
  },
});

function isWritable(d) {
  try {
    const probe = join(d, '.tokenzip-probe');
    writeFileSync(probe, 'x');
    import('node:fs').then((fs) => fs.unlinkSync(probe));
    return true;
  } catch {
    return false;
  }
}
