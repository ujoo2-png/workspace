import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// ESM import는 NODE_PATH를 무시하므로 require로 불러온다(NODE_PATH=<playwright가 있는 node_modules>로 실행).
const { chromium } = createRequire(import.meta.url)('playwright');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
export function serve(root, port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
export async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
}
// 로컬 모드 계정을 만들고 로그인 상태(로그인 유지)로 앱을 연다.
export async function login(page, base, { nav = 'side', home = 'classic' } = {}) {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  // 기존 e2e는 사이드바(.nav-item) 기준이라 기본은 사이드바로 고정한다(상단바는 v724-e2e에서 별도 검증).
  await page.evaluate(([n, h]) => { try { localStorage.setItem('workspace:navStyle', n); localStorage.setItem('workspace:homeStyle', h); } catch (e) { /* 무시 */ } }, [nav, home]);
  await page.waitForSelector('.lo-card');
  await page.evaluate(async () => {
    const s = window.getStore();
    await s.signUp({ username: 'tester', password: 'pw1234' });
    await s.signIn('tester', 'pw1234', true);
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.app-shell', { timeout: 10000 });
  await page.waitForSelector('.briefing-modal', { timeout: 5000 }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => { document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()); });
}
