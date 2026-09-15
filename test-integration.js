// Integration tests: spawn the CLI the way hosts do.
//  - MCP: JSON-RPC over stdio (initialize → tools/list → tools/call estimate)
//  - hook: Claude Code PreToolUse stdin/stdout contract, incl. no-op cases
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { writePng } from './lib/png.js';

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) pass++;
  else { fail++; console.error('FAIL ' + name); }
};

mkdirSync('fixtures', { recursive: true });
// oversized png (3000×2000) for hook testing — big enough to optimize
{
  const W = 3000, H = 2000;
  const data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    data[i] = x & 0xff; data[i + 1] = y & 0xff; data[i + 2] = (x ^ y) & 0xff;
  }
  writeFileSync('fixtures/hook-big.png', writePng({ width: W, height: H, channels: 3, data }));
}
const SMALL = { width: 200, height: 150, channels: 3, data: Buffer.alloc(200 * 150 * 3, 7) };
writeFileSync('fixtures/hook-small.png', writePng(SMALL));

const run = (args, stdin) =>
  new Promise((res) => {
    const p = spawn('node', ['tokenzip.js', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => res({ out, err, code }));
    if (stdin) p.stdin.end(stdin);
  });

// ---- MCP ----
{
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tokenzip_estimate', arguments: { width: 3000, height: 2000 } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tokenzip_estimate', arguments: { path: 'fixtures/hook-big.png' } } },
  ];
  const { out } = await run(['mcp'], msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  ok(lines[0].result.serverInfo.name === 'tokenzip', 'mcp initialize');
  const tools = lines[1].result.tools.map((t) => t.name);
  ok(tools.length === 3 && tools.includes('tokenzip_optimize'), 'mcp tools/list');
  ok(JSON.parse(lines[2].result.content[0].text).tokens.anthropic === 1568, 'mcp estimate 3000×2000 = 1568');
  ok(JSON.parse(lines[3].result.content[0].text).tokens.gemini === 3096, 'mcp estimate via file path');
}

// ---- hook: oversized → rewritten Read ----
{
  const stdin = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'fixtures/hook-big.png' } });
  const { out, code } = await run(['hook', 'claude-code'], stdin);
  ok(code === 0 && out.length > 0, 'hook responds for oversized image');
  const j = JSON.parse(out);
  ok(j.hookSpecificOutput.permissionDecision === 'allow', 'hook allow');
  const np = j.hookSpecificOutput.updatedInput.file_path;
  ok(np !== 'fixtures/hook-big.png' && existsSync(np), 'hook rewrote to real cached file: ' + np);
  const { decodeJpeg } = await import('./lib/jpeg.js');
  const { readPng } = await import('./lib/png.js');
  const copy = np.endsWith('.png') ? readPng(readFileSync(np)) : decodeJpeg(readFileSync(np));
  ok(copy.width === 1328 && copy.height === 885, 'cached copy is exact-mode size 1328×885');
}

// ---- hook: already-optimal → silence, no opinion ----
{
  const stdin = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'fixtures/hook-small.png' } });
  const { out, code } = await run(['hook', 'claude-code'], stdin);
  ok(code === 0 && out.trim() === '', 'hook stays silent on small image');
}

// ---- hook: text file / non-Read / garbage → silent exit 0, never block ----
{
  const r1 = await run(['hook', 'claude-code'], JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'README.md' } }));
  const r2 = await run(['hook', 'claude-code'], JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  const r3 = await run(['hook', 'claude-code'], 'not json at all');
  const r4 = await run(['hook', 'claude-code'], JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'fixtures/nope.png' } }));
  ok(r1.code === 0 && !r1.out.trim(), 'hook silent: non-image');
  ok(r2.code === 0 && !r2.out.trim(), 'hook silent: other tool');
  ok(r3.code === 0 && !r3.out.trim(), 'hook silent: garbage stdin (never block)');
  ok(r4.code === 0 && !r4.out.trim(), 'hook silent: missing file');
}

console.log(`\n${fail === 0 ? '✔' : '✖'} ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
