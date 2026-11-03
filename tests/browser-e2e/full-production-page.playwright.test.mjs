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


    // Exercise the actual production picker -> management modal -> upload/delete UI.
    await page.locator('#combo-btn').click();
    await page.locator('#user-sticker-picker [data-xs-tab="stickers"]').click();
    await page.locator('#combo-content-area [data-xs-final-manage-sticker]').click();
    await page.locator('#xiaoshu-sticker-admin-modal').waitFor({ state: 'visible', timeout: 15000 });

    const initialUploads = await page.evaluate(() => window.xiaoshuStickerStore.getUploads().length);
    assert.equal(initialUploads, 0, 'isolated production browser must start with no user-uploaded stickers');

    page.on('dialog', dialog => dialog.accept());
    await page.locator('#xs-admin-upload-stickers').click();
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pWQAAAAASUVORK5CYII=',
      'base64'
    );
    await page.locator('#my-sticker-quick-upload').setInputFiles({
      name: 'production-ui-upload.png',
      mimeType: 'image/png',
      buffer: tinyPng
    });

    await page.waitForFunction(() => window.xiaoshuStickerStore.getUploads().length === 1, null, { timeout: 20000 });
    const uploadedSrc = await page.evaluate(() => window.xiaoshuStickerStore.getUploads()[0]);
    assert.match(uploadedSrc, /^data:image\\//, 'production upload must produce an image data URL');
    await page.locator('#xs-sticker-upload-grid [data-xs-remove-upload]').waitFor({ state: 'visible' });

    // Delete using the real per-upload × control and accept its confirmation dialog.
    await page.locator('#xs-sticker-upload-grid [data-xs-remove-upload]').click();
    await page.waitForFunction(() => window.xiaoshuStickerStore.getUploads().length === 0, null, { timeout: 20000 });
    await page.waitForFunction(() => {
      const grid = document.getElementById('xs-sticker-upload-grid');
      return !!grid && !grid.querySelector('[data-xs-remove-upload]');
    }, null, { timeout: 10000 });

    const persistedUploads = await page.evaluate(async () => {
      const sid = String(window.SESSION_ID || '');
      const prefix = String(window.APP_PREFIX || 'CHAT_APP_V3_');
      return await window.localforage.getItem(prefix + sid + '_myStickerLibrary');
    });
    assert.deepEqual(persistedUploads, [], 'deleted upload must be absent from the canonical IndexedDB upload key');

    const staleSendResult = await page.evaluate(src => window.xiaoshuStickerStore.send(src), uploadedSrc);
    assert.equal(staleSendResult, false, 'production send API must reject the just-deleted upload');
    await page.locator('#xs-close-sticker-admin').click();

    // Re-open the visible sticker picker and verify the deleted image is not rendered.
    await page.locator('#combo-btn').click();
    await page.locator('#user-sticker-picker [data-xs-tab="stickers"]').click();
    const staleVisible = await page.locator('#combo-content-area img').evaluateAll((imgs, src) =>
      imgs.some(img => img.src === src), uploadedSrc
    );
    assert.equal(staleVisible, false, 'deleted upload must not reappear in the production sticker picker');
    assert.deepEqual(failedLocalRequests, [], 'production UI interactions must not fail local asset requests');
    assert.deepEqual(pageErrors, [], 'production UI interactions must not emit uncaught JavaScript errors');

    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
