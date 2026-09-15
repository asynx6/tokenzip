// Minimal MCP server over stdio (JSON-RPC 2.0), zero dependency.
// Speaks protocol version 2025-03-26 with tools/list + tools/call — the
// subset every host (Claude Desktop/Code, OpenCode, Cursor, Cline, Codex)
// negotiates down to.
//
//   npx @asynx6/tokenzip mcp
//   → config: { "mcpServers": { "tokenzip": { "command": "npx", "args": ["-y","@asynx6/tokenzip","mcp"] } } }

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { extname, join, dirname, basename } from 'node:path';
import { readPng, writePng, resizeNearest, paletteToRgba } from '../lib/png.js';
import { encodeJpeg, decodeJpeg } from '../lib/jpeg.js';
import { optimize, tokensAt } from '../lib/optimize.js';
import { PROVIDERS } from '../lib/tokens.js';

const TOOLS = [
  {
    name: 'tokenzip_estimate',
    description: 'Exact vision-token cost of an image (by file path or by width/height) for one provider or all: anthropic, openai, gemini.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'image file (png/jpg) — reads dimensions' },
        width: { type: 'number' }, height: { type: 'number' },
        provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini', 'all'], default: 'all' },
      },
    },
  },
  {
    name: 'tokenzip_optimize',
    description: 'Resize an image to the exact size the provider model sees (same token bill, far fewer bytes) OR into a token budget (--max-tokens equivalent). Writes the output file and returns token/byte deltas.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        out: { type: 'string', description: 'output path (png/jpg); defaults to sibling .tokenzip.jpg' },
        provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini'], default: 'anthropic' },
        maxTokens: { type: 'number', description: 'budget cap; omit = exact (lossless-to-model) mode' },
        quality: { type: 'number', minimum: 1, maximum: 100, default: 85 },
      },
      required: ['path'],
    },
  },
  {
    name: 'tokenzip_batch_dir',
    description: 'Analyze every png/jpg in a directory: per-image tokens, effective size, total bytes saved if optimized. Reads only — writes nothing.',
    inputSchema: {
      type: 'object',
      properties: { dir: { type: 'string' }, provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini'], default: 'anthropic' } },
      required: ['dir'],
    },
  },
];

function dimsOf(file) {
  const buf = readFileSync(file);
  const ext = extname(file).toLowerCase();
  if (ext === '.png') {
    const img = readPng(buf);
    return { w: img.width, h: img.height, img };
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const img = decodeJpeg(buf);
    return { w: img.width, h: img.height, img };
  }
  throw new Error('unsupported format: ' + ext);
}

function callTool(name, args) {
  if (name === 'tokenzip_estimate') {
    let { width: w, height: h } = args;
    if (args.path && (!w || !h)) {
      const d = dimsOf(args.path);
      w = d.w; h = d.h;
    }
    if (!w || !h) throw new Error('give path or width+height');
    const providers = !args.provider || args.provider === 'all' ? Object.keys(PROVIDERS) : [args.provider];
    return { width: w, height: h, tokens: Object.fromEntries(providers.map((p) => [p, tokensAt(p, w, h)])) };
  }

  if (name === 'tokenzip_optimize') {
    const { w, h, img } = dimsOf(args.path);
    const r = optimize(args.provider || 'anthropic', w, h, { maxTokens: args.maxTokens || null });
    if (r.best.w === w && r.best.h === h) {
      return { ...r, wrote: null, note: 'already at the size the model sees — nothing to do' };
    }
    const resized = resizeNearest({ width: w, height: h, channels: img.channels, data: img.data }, r.best.w, r.best.h);
    const out = args.out || join(dirname(args.path), basename(args.path, extname(args.path)) + '.tokenzip.jpg');
    const buf = /\.jpe?g$/i.test(out) ? encodeJpeg(resized, { quality: args.quality || 85 }) : writePng(resized);
    writeFileSync(out, buf);
    const before = readFileSync(args.path).length;
    return { ...r, wrote: out, bytesBefore: before, bytesAfter: buf.length, byteSaving: (1 - buf.length / before).toFixed(2) };
  }

  if (name === 'tokenzip_batch_dir') {
    const p = args.provider || 'anthropic';
    const files = readdirSync(args.dir).filter((f) => /\.(png|jpe?g)$/i.test(f));
    const rows = [];
    let bytesNow = 0, bytesOpt = 0;
    for (const f of files) {
      try {
        const { w, h, img } = dimsOf(join(args.dir, f));
        const r = optimize(p, w, h);
        const src = readFileSync(join(args.dir, f)).length;
        let opt = src;
        if (r.best.w !== w || r.best.h !== h) {
          const resized = resizeNearest({ width: w, height: h, channels: img.channels, data: img.data }, r.best.w, r.best.h);
          opt = encodeJpeg(resized, { quality: 85 }).length;
        }
        bytesNow += src; bytesOpt += opt;
        rows.push({ file: f, size: `${w}x${h}`, tokens: r.original.tokens, exact: `${r.best.w}x${r.best.h}`, bytes: src, bytesIfOptimized: opt });
      } catch (e) {
        rows.push({ file: f, error: e.message });
      }
    }
    return { provider: p, count: files.length, rows, totalBytes: bytesNow, totalBytesIfOptimized: bytesOpt };
  }
  throw new Error('unknown tool ' + name);
}

// ---- JSON-RPC over stdio ----
const RPC_VERSION = '2.0';
function send(msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: RPC_VERSION, ...msg }) + '\n');
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    handle(req);
  }
});
process.stdin.on('end', () => process.exit(0));

function handle(req) {
  const { id, method, params } = req;
  if (method === 'initialize') {
    send({ id, result: {
      protocolVersion: params?.protocolVersion || '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'tokenzip', version: '0.3.1' },
    } });
  } else if (method === 'notifications/initialized' || method === 'initialized') {
    // notification, no reply
  } else if (method === 'tools/list') {
    send({ id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    try {
      const result = callTool(params.name, params.arguments || {});
      send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    } catch (e) {
      send({ id, result: { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true } });
    }
  } else if (method === 'ping') {
    send({ id, result: {} });
  } else if (id !== undefined) {
    send({ id, error: { code: -32601, message: 'method not found: ' + method } });
  }
}
