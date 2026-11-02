import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

const indexHtml = fs.readFileSync('index.html', 'utf8');
const coreSource = fs.readFileSync('sticker-core.js', 'utf8');

function scriptById(id) {
  const match = indexHtml.match(new RegExp("<script[^>]+id=['\\\"]" + id + "['\\\"][^>]*>([\\s\\S]*?)</script>", "i"));
  assert.ok(match, 'script tag not found: ' + id);
  return match[1];
}

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, 'missing source marker: ' + start);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, 'missing end marker: ' + end);
  return source.slice(a, b);
}

const localForageSource = scriptById('xiaoshu-offline-localforage-compatible-v1');
const controllerSource = scriptById('xiaoshu-shared-sticker-controller-v6');
const chat2Source = scriptById('xiaoshuChat2Source');
const chat2SendFunctions =
  between(chat2Source, 'function chat2StickerHash(src){', 'function resolveChat2Sticker(id){') +
  between(chat2Source, 'function sendSharedSticker(src){', 'function load(){');
const batchSendFunction = between(
  indexHtml,
  'function sendBatchMessages() {',
  '\n\n        window.simulateReply = function(targetConversationId) {'
);

const fixtureHtml = [
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
  '<script>window.SESSION_ID="sticker-browser-e2e";window.APP_PREFIX="E2E_";window.__xiaoshuSessionDataReady="sticker-browser-e2e";window.__sentMessages=[];window.addMessage=function(message){window.__sentMessages.push(message);};window.showNotification=function(){};window.confirm=function(){return true;};</script>',
  '<script>', coreSource, '</script>',
  '<script>', localForageSource, '</script>',
  '<script>', controllerSource, '</script>',
  '</head><body><main id="fixture">sticker browser e2e</main></body></html>'
].join('');

const pngData = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
));

async function waitForStore(page) {
  await page.waitForFunction(() => {
    const store = window.xiaoshuStickerStore;
    return !!(store && store.getMigrationState && store.getMigrationState().hydrated);
  }, null, { timeout: 20000 });
}

async function addSticker(page, bytes, name) {
  return page.evaluate(async ({ bytes, name }) => {
    const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' });
    const count = await window.xiaoshuStickerStore.addFiles([file]);
    const source = window.xiaoshuStickerStore.getUploads().slice(-1)[0];
    if (!count || !source) throw new Error('test sticker upload failed');
    const id = window.xiaoshuStickerStore.register(source);
    if (!id) throw new Error('test sticker registration failed');
    const persisted = await window.xiaoshuStickerStore.flushMessageResources();
    if (!persisted) throw new Error('message resource mapping was not persisted');
    return { source, id, count };
  }, { bytes: Array.from(bytes), name: name || 'e2e-sticker.png' });
}

async function installChat2SendHarness(page, functions) {
  await page.evaluate((source) => {
    const frame = document.createElement('iframe');
    frame.id = 'e2e-chat2';
    frame.srcdoc = [
      '<script>',
      'function safeResourceUrl(value, kind){const text=String(value||"").trim();return kind==="image"&&/^data:image\\//i.test(text)?text:"";}',
      'const state={stickerResources:Object.create(null),autoReply:"off"};',
      'const sharedStickerCatalog=Object.create(null);',
      'let sharedStickerPool=[];',
      'const sent=[];',
      'function addMessage(){sent.push(Array.from(arguments));}',
      'function closeSharedStickers(){}',
      source,
      'window.__sendSharedSticker=sendSharedSticker;window.__chat2Sent=sent;',
      '</script>'
    ].join('');
    document.body.appendChild(frame);
  }, functions);
  const frame = page.frameLocator('#e2e-chat2');
  await frame.locator('body').waitFor({ state: 'attached' });
  await frame.locator('body').evaluate(() => { if (typeof window.__sendSharedSticker !== 'function') throw new Error('Chat 2 send function did not initialize'); });
  return frame;
}

test('real Chromium: Chat 1, Chat 2 iframe, two tabs, IndexedDB reload and history mapping', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fixtureHtml);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = 'http://127.0.0.1:' + address.port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const chat1 = await context.newPage();
    await chat1.goto(origin);
    await waitForStore(chat1);

    const { source, id } = await addSticker(chat1, Array.from(pngData), 'deleted-sticker.png');
    const secondPngData = Array.from(pngData);
    secondPngData[secondPngData.length - 1] = (secondPngData[secondPngData.length - 1] + 1) & 255;
    const { source: validSource, id: validId } = await addSticker(chat1, secondPngData, 'valid-sticker.png');

    // Chat 2 hydrates the real IndexedDB upload before Chat 1 deletes it.
    const chat2 = await context.newPage();
    await chat2.goto(origin);
    await waitForStore(chat2);
    assert.equal(await chat2.evaluate((src) => window.xiaoshuStickerStore.getPool().includes(src), source), true);
    assert.equal(await chat2.evaluate((src) => window.xiaoshuStickerStore.getPool().includes(src), validSource), true);

    // Chat 1's actual single-sticker send path works before deletion.
    assert.equal(await chat1.evaluate((src) => window.xiaoshuStickerStore.send(src), source), true);
    assert.equal(await chat1.evaluate(() => window.__sentMessages.length), 1);

    // The actual Chat 2 iframe send functions call the parent controller's guarded register().
    const frame = await installChat2SendHarness(chat2, chat2SendFunctions);
    assert.equal(await frame.locator('body').evaluate((_, src) => window.__sendSharedSticker(src), source), true);
    assert.equal(await frame.locator('body').evaluate(() => window.__chat2Sent.length), 1);

    assert.equal(await chat1.evaluate((stickerId) => window.xiaoshuStickerStore.authorizeSendId(stickerId), id), id);

    // Delete in Chat 1 while Chat 2 still has a pre-delete in-memory pool snapshot.
    assert.equal(await chat1.evaluate((src) => window.xiaoshuStickerStore.removeUpload(src, false), source), true);
    assert.equal(await chat2.evaluate((stickerId) => window.xiaoshuStickerStore.authorizeSendId(stickerId), id), '');
    assert.equal(await chat2.evaluate((src) => window.xiaoshuStickerStore.send(src), source), false);
    assert.equal(await frame.locator('body').evaluate((_, src) => window.__sendSharedSticker(src), source), false);
    assert.equal(await frame.locator('body').evaluate(() => window.__chat2Sent.length), 1);

    // Run the real Chat 1 batch sender in Chromium: reject the deleted ID while
    // keeping a second valid sticker and ordinary text in the same batch.
    const batchResult = await chat1.evaluate(({ senderSource, deletedId, allowedId }) => {
      const sent = [];
      let saves = 0;
      let replies = 0;
      const runFactory = new Function(
        'window', 'batchMessages', 'showNotification', 'addMessage', 'playSound',
        'xsQueueChatMessagesSave', 'simulateReply', 'DOMElements',
        'let isBatchMode = true;\n' + senderSource + '\nreturn sendBatchMessages;'
      );
      const run = runFactory(
        window,
        [
          { text: '', stickerId: deletedId },
          { text: '', stickerId: allowedId },
          { text: 'ordinary text survives', stickerId: '' }
        ],
        function() {},
        function(message) { sent.push(message); },
        function() {},
        function() { saves += 1; },
        function() { replies += 1; },
        {
          batchBtn: { classList: { remove() {} } },
          batchPreview: { style: {} },
          messageInput: { placeholder: '' }
        }
      );
      run();
      return {
        sent: sent.map(message => message.stickerId || message.text),
        saves,
        replies
      };
    }, { senderSource: batchSendFunction, deletedId: id, allowedId: validId });
    assert.deepEqual(batchResult.sent, [validId, 'ordinary text survives']);
    assert.equal(batchResult.saves, 1);
    assert.equal(batchResult.replies, 1);

    // Deletion must not destroy a mapping already referenced by historical messages.
    assert.equal(await chat1.evaluate((stickerId) => window.xiaoshuStickerStore.resolve(stickerId), id), source);

    await chat1.reload();
    await waitForStore(chat1);
    assert.equal(await chat1.evaluate((src) => window.xiaoshuStickerStore.getUploads().includes(src), source), false);
    assert.equal(await chat1.evaluate((src) => window.xiaoshuStickerStore.getPool().includes(src), source), false);
    assert.equal(await chat1.evaluate((stickerId) => window.xiaoshuStickerStore.authorizeSendId(stickerId), id), '');
    assert.equal(await chat1.evaluate((stickerId) => window.xiaoshuStickerStore.resolve(stickerId), id), source);

    await chat2.reload();
    await waitForStore(chat2);
    assert.equal(await chat2.evaluate((src) => window.xiaoshuStickerStore.getUploads().includes(src), source), false);
    assert.equal(await chat2.evaluate((src) => window.xiaoshuStickerStore.getPool().includes(src), source), false);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
