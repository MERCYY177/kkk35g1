import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function createStaticServer() {
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (error, bytes) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(bytes);
    });
  });
}

test('full production index.html boots in an isolated real Chromium browser', async () => {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = 'http://127.0.0.1:' + address.port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    const pageErrors = [];
    const failedLocalRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => {
      if (request.url().startsWith(origin)) failedLocalRequests.push(request.url());
    });

    const response = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.equal(response?.status(), 200, 'production index.html must be served successfully');

    await page.waitForFunction(() => {
      const sid = window.__xiaoshuSessionDataReady;
      return !!(sid && window.SESSION_ID && String(sid) === String(window.SESSION_ID));
    }, null, { timeout: 60000 });

    await page.waitForFunction(() => {
      const store = window.xiaoshuStickerStore;
      return !!(store && typeof store.getMigrationState === 'function' &&
        store.getMigrationState().hydrated === true);
    }, null, { timeout: 30000 });

    const bootState = await page.evaluate(() => ({
      title: document.title,
      sessionId: String(window.SESSION_ID || ''),
      sessionReady: String(window.__xiaoshuSessionDataReady || ''),
      stickerStore: !!window.xiaoshuStickerStore,
      stickerHydrated: !!(window.xiaoshuStickerStore &&
        window.xiaoshuStickerStore.getMigrationState().hydrated),
      chat2SourcePresent: !!document.getElementById('xiaoshuChat2Source'),
      chat2FramePresent: !!document.getElementById('xiaoshuBigKeyboardFrame'),
      stickerAdminCardPresent: !!document.getElementById('xiaoshu-sticker-admin-card'),
      stickerAdminModalPresent: !!document.getElementById('xiaoshu-sticker-admin-modal')
    }));

    assert.ok(bootState.sessionId, 'production boot must establish a session');
    assert.equal(bootState.sessionReady, bootState.sessionId);
    assert.equal(bootState.stickerStore, true);
    assert.equal(bootState.stickerHydrated, true);
    assert.equal(bootState.chat2SourcePresent, true);
    assert.equal(bootState.chat2FramePresent, true);
    assert.equal(bootState.stickerAdminCardPresent, true);
    assert.equal(bootState.stickerAdminModalPresent, true);
    assert.deepEqual(failedLocalRequests, [], 'all requested local production assets must load');
    assert.deepEqual(pageErrors, [], 'production page must not emit uncaught JavaScript errors during boot');

    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
