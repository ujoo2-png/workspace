import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.26.0 Refero 프록시(api/refero.js)를 가짜 MCP 서버로 검증 + 클라이언트 도구 선택/결과 평탄화.
const require = createRequire(import.meta.url);
const handler = require('../api/refero.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
(0, eval)(fs.readFileSync(path.join(__dirname, '../js/services/referoService.js'), 'utf8'));

function mkRes() { const r = { code: 200, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; return r; } }; return r; }
function mockUpstream({ sse = true, status = 200, tools = [{ name: 'search_screens', inputSchema: { properties: { query: {} } } }] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, init, body });
    const reply = (obj, extra = {}) => ({ status, headers: { get: (h) => ({ 'content-type': sse ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'S1', ...extra }[h.toLowerCase()] || null) }, text: async () => (sse ? `event: message\ndata: ${JSON.stringify(obj)}\n\n` : JSON.stringify(obj)) });
    if (body.method === 'initialize') return reply({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } });
    if (body.method === 'notifications/initialized') return { status: 202, headers: { get: () => null }, text: async () => '' };
    if (body.method === 'tools/list') return reply({ jsonrpc: '2.0', id: body.id, result: { tools } });
    if (body.method === 'tools/call') return reply({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `found ${body.params.arguments.query} https://img.refero.design/a.png https://refero.design/s/1` }] } });
    return reply({ jsonrpc: '2.0', id: body.id, error: { message: 'x' } });
  };
  return calls;
}

test('프록시: 토큰/메서드/action 검증', async () => {
  let r = mkRes(); await handler({ method: 'GET', headers: {} }, r); assert.equal(r.code, 405);
  r = mkRes(); await handler({ method: 'POST', headers: {}, body: { action: 'tools' } }, r); assert.equal(r.code, 400);
  r = mkRes(); await handler({ method: 'POST', headers: { 'x-refero-token': 'abcdefgh1234' }, body: { action: 'evil' } }, r); assert.equal(r.code, 400);
  r = mkRes(); await handler({ method: 'POST', headers: { 'x-refero-token': 'abcdefgh1234' }, body: { action: 'call', name: '../x' } }, r); assert.equal(r.code, 400);
});
test('프록시: initialize → initialized → tools/list (SSE 응답, 세션 전달, 고정 대상, Bearer)', async () => {
  const calls = mockUpstream();
  const r = mkRes(); await handler({ method: 'POST', headers: { 'x-refero-token': 'tok-123456789' }, body: { action: 'tools' } }, r);
  assert.equal(r.code, 200); assert.equal(r.body.ok, true); assert.equal(r.body.result.tools[0].name, 'search_screens');
  assert.deepEqual(calls.map((c) => c.body.method), ['initialize', 'notifications/initialized', 'tools/list']);
  assert.ok(calls.every((c) => c.url === 'https://api.refero.design/mcp'));
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-123456789');
  assert.equal(calls[2].init.headers['Mcp-Session-Id'], 'S1');
  assert.equal(r.headers['Cache-Control'], 'no-store');
});
test('프록시: tools/call(JSON 응답) + 401 매핑', async () => {
  mockUpstream({ sse: false });
  let r = mkRes(); await handler({ method: 'POST', headers: { 'x-refero-token': 'tok-123456789' }, body: { action: 'call', name: 'search_screens', args: { query: '대시보드' } } }, r);
  assert.equal(r.body.ok, true); assert.match(r.body.result.content[0].text, /대시보드/);
  mockUpstream({ status: 401 });
  r = mkRes(); await handler({ method: 'POST', headers: { 'x-refero-token': 'tok-123456789' }, body: { action: 'tools' } }, r);
  assert.equal(r.code, 401); assert.match(r.body.error, /토큰/);
});
test('클라이언트: 검색 도구 선택 + 결과 평탄화', () => {
  const R = globalThis.ReferoService;
  const pick = R.pickSearchTool([{ name: 'get_style', inputSchema: { properties: { id: {} } } }, { name: 'search_screens', inputSchema: { properties: { query: {} } } }, { name: 'find_similar', inputSchema: { properties: { q: {} } } }]);
  assert.equal(pick.tool.name, 'search_screens'); assert.equal(pick.key, 'query');
  assert.equal(R.pickSearchTool([{ name: 'x', inputSchema: { properties: { id: {} } } }]), null);
  const f = R.flatten({ content: [{ type: 'text', text: 'a https://x.com/p.png b https://x.com/page' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] });
  assert.deepEqual(f.images, ['https://x.com/p.png', 'data:image/jpeg;base64,AAAA']); assert.deepEqual(f.links, ['https://x.com/page']);
});
