const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const guardSource = fs.readFileSync(new URL('../sticker-core.js', `file://${__filename}`), 'utf8');
const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');

function createSharedStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    dump() { return Object.fromEntries(values); },
  };
}

function createRuntime(sessionId, storage) {
  const listeners = Object.create(null);
  const document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById() { return null; },
  };
  const root = {
    SESSION_ID: sessionId,
    localStorage: storage,
    document,
    console: { warn() {} },
    confirm() { return true; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { (listeners[event && event.type] || []).forEach(fn => fn(event)); },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Event: function Event(type) { this.type = type; },
  };
  vm.runInNewContext(guardSource, { window: root }, { filename: 'sticker-core.js' });
  return root;
}

function createStore(root, initialPool, initialUploads = []) {
  let pool = initialPool.slice();
  let uploads = initialUploads.slice();
  const hidden = new Set();
  const calls = { register: [], send: [] };
  const idFor = src => root.XiaoshuStickerCore.stickerId(src);
  const store = {
    calls,
    getUploads() { return uploads.slice(); },
    getPool() { return pool.filter(src => !hidden.has(src)); },
    removeUpload(src) {
      const before = uploads.length;
      uploads = uploads.filter(item => item !== src);
      pool = pool.filter(item => item !== src);
      return uploads.length !== before;
    },
    clearUploads() { uploads = []; pool = pool.filter(src => !initialUploads.includes(src)); return true; },
    hide(src) { hidden.add(src); return true; },
    send(src) { calls.send.push(src); return true; },
    hydrate() { return Promise.resolve(true); },
    sync() { return pool.slice(); },
    openAdmin() {},
    addFiles(files) {
      const source = Array.isArray(files) && typeof files[0] === 'string' ? files[0] : '';
      if (source && !uploads.includes(source)) { uploads.push(source); pool.push(source); }
      return Promise.resolve(source ? 1 : 0);
    },
    register(src) { calls.register.push(src); return idFor(src); },
    resolve(id) { return pool.find(src => idFor(src) === id) || ''; },
    getMigrationState() { return { hydrated: true }; },
  };
  root.xiaoshuStickerStore = store;
  return store;
}

const deletedSource = 'https://cdn.example/stickers/deleted.gif';
const validSource = 'https://cdn.example/stickers/valid.gif';

test('register only accepts a source in the current, visible shared pool', () => {
  const storage = createSharedStorage();
  const root = createRuntime('session-one', storage);
  const store = createStore(root, [validSource, deletedSource], [validSource, deletedSource]);

  assert.equal(store.register(validSource), root.XiaoshuStickerCore.stickerId(validSource));
  assert.equal(store.register('https://cdn.example/stickers/not-in-pool.gif'), '');
  store.hide(deletedSource);
  assert.equal(store.register(deletedSource), '');
  assert.deepEqual(store.calls.register, [validSource]);
});

test('a deletion in one tab invalidates stale pool and registration in another tab', () => {
  const storage = createSharedStorage();
  const firstTab = createRuntime('shared-session', storage);
  const secondTab = createRuntime('shared-session', storage);
  const firstStore = createStore(firstTab, [deletedSource, validSource], [deletedSource, validSource]);
  const secondStore = createStore(secondTab, [deletedSource, validSource], [deletedSource, validSource]);

  assert.equal(firstStore.removeUpload(deletedSource, false), true);
  assert.equal(secondStore.register(deletedSource), '');
  assert.equal(secondStore.getPool().includes(deletedSource), false);
  assert.equal(secondStore.send(deletedSource), false);
  assert.equal(secondStore.register(validSource), secondTab.XiaoshuStickerCore.stickerId(validSource));
  assert.equal(secondStore.send(validSource), true);
  assert.deepEqual(secondStore.calls.register, [validSource]);
  assert.deepEqual(secondStore.calls.send, [validSource]);
});

test('deletion tombstones are scoped to their session', () => {
  const storage = createSharedStorage();
  const sessionA = createRuntime('session-a', storage);
  const sessionB = createRuntime('session-b', storage);
  const storeA = createStore(sessionA, [deletedSource], [deletedSource]);
  const storeB = createStore(sessionB, [deletedSource], [deletedSource]);

  storeA.removeUpload(deletedSource, false);
  assert.equal(storeB.register(deletedSource), sessionB.XiaoshuStickerCore.stickerId(deletedSource));
  assert.ok(storage.dump()['xiaoshu_deleted_upload_hashes_v1_session-a']);
  assert.equal(storage.dump()['xiaoshu_deleted_upload_hashes_v1_session-b'], undefined);
});

test('the canonical hidden list stored by another tab blocks registration', () => {
  const storage = createSharedStorage();
  storage.setItem('disabledStickerItems', JSON.stringify([deletedSource]));
  const root = createRuntime('session-one', storage);
  const store = createStore(root, [deletedSource, validSource], [deletedSource, validSource]);

  assert.equal(store.register(deletedSource), '');
  assert.equal(store.register(validSource), root.XiaoshuStickerCore.stickerId(validSource));
});

test('newly uploaded valid sources remain registrable after the upload path completes', async () => {
  const storage = createSharedStorage();
  const root = createRuntime('session-one', storage);
  const store = createStore(root, [validSource], []);
  const newSource = 'https://cdn.example/stickers/new.gif';

  await store.addFiles([newSource]);
  // Exercise the guarded public addFiles/register path used by the upload completion flow.
  assert.equal(store.register(newSource), root.XiaoshuStickerCore.stickerId(newSource));
});

test('Chat 2 and delayed automatic sticker sends revalidate through the parent store', () => {
  assert.match(html, /function registerLiveSharedSticker\(src\)/);
  const chat2Start = html.indexOf('function scheduleHisStickerReply(sentSrc)');
  const chat2End = html.indexOf('function load(){', chat2Start);
  assert.notEqual(chat2Start, -1);
  assert.notEqual(chat2End, -1);
  const chat2SendCode = html.slice(chat2Start, chat2End);
  assert.match(chat2SendCode, /setTimeout\(\(\)=>\{\s*const liveId=registerLiveSharedSticker\(sticker\)/);
  assert.match(chat2SendCode, /function sendSharedSticker\(src\)[\s\S]*?registerLiveSharedSticker\(src\)/);

  const proactiveStart = html.indexOf('window.xiaoshuSendPartnerStickerNow=function()');
  const proactiveEnd = html.indexOf('function sync(){', proactiveStart);
  const proactive = html.slice(proactiveStart, proactiveEnd);
  assert.match(proactive, /store\.register\(src\)!==stickerId/);

  const delayedStart = html.indexOf('if (shouldSendSticker) {', html.indexOf('function simulateReply'));
  const delayedEnd = html.indexOf('if (separateEmoji)', delayedStart);
  const delayedReply = html.slice(delayedStart, delayedEnd);
  assert.match(delayedReply, /stickerStore\.register\(randomSticker\) !== randomStickerId/);
});

test('the private history migration registration remains separate from the guarded public API', () => {
  assert.match(html, /m\.stickerId=registerMessageResource\(src\)/);
  assert.match(guardSource, /api\.register\s*=\s*function\s*\(src\)/);
});

test('clear-all persists deletion tombstones before removing uploads for other tabs', () => {
  const storage = createSharedStorage();
  const firstTab = createRuntime('shared-clear-session', storage);
  const secondTab = createRuntime('shared-clear-session', storage);
  const firstStore = createStore(firstTab, [deletedSource, validSource], [deletedSource, validSource]);
  const secondStore = createStore(secondTab, [deletedSource, validSource], [deletedSource, validSource]);

  assert.equal(firstStore.clearUploads(false), true);
  assert.equal(secondStore.register(deletedSource), '');
  assert.equal(secondStore.register(validSource), '');
  assert.deepEqual(secondStore.getPool(), []);
});

test('a stale tab purges tombstoned uploads again after hydrate', async () => {
  const storage = createSharedStorage();
  const firstTab = createRuntime('shared-hydrate-session', storage);
  const secondTab = createRuntime('shared-hydrate-session', storage);
  const firstStore = createStore(firstTab, [deletedSource, validSource], [deletedSource, validSource]);
  const secondStore = createStore(secondTab, [deletedSource, validSource], [deletedSource, validSource]);

  firstStore.removeUpload(deletedSource, false);
  await secondStore.hydrate();

  assert.equal(secondStore.getUploads().includes(deletedSource), false);
  assert.equal(secondStore.getPool().includes(deletedSource), false);
  assert.equal(secondStore.register(deletedSource), '');
});

test('batch-delete UI persists upload tombstones before mutating its private uploads array', () => {
  const start = html.indexOf('function batchDeleteSelected(ask)');
  const end = html.indexOf('function downloadText(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = html.slice(start, end);
  const markAt = body.indexOf('guardedStore.markUploadsDeleted(uploadedChosen)');
  const mutationAt = body.indexOf('uploads=uploads.filter');
  assert.ok(markAt >= 0 && mutationAt > markAt, 'tombstones must be stored before the closure-level upload list is changed');
});

test('clear-all UI routes through the guarded public store API', () => {
  assert.match(html, /#xs-clear-upload-stickers[^\n]*[\s\S]{0,250}xiaoshuStickerStore\.clearUploads\(true\)/);
});

test('legacy global aliases point to the guarded public methods, not private raw methods', () => {
  assert.match(html, /window\.xiaoshuGetSharedStickerPool=api\.getPool/);
  assert.match(html, /window\.xiaoshuSendSharedSticker=api\.send/);
  assert.match(html, /window\.xiaoshuHideStickerNow=api\.hide/);
  const gridStart = html.indexOf('function sendStickerFromGrid(src)');
  const gridEnd = html.indexOf('function bindStickerGrid(', gridStart);
  assert.notEqual(gridStart, -1);
  assert.match(html.slice(gridStart, gridEnd), /xiaoshuStickerStore\.send\(src\)/);
});

test('failed tombstone persistence cancels single and clear-all deletion', () => {
  const storage = createSharedStorage();
  storage.setItem = function () { throw new Error('storage blocked'); };
  const firstTab = createRuntime('storage-failure-session', storage);
  const firstStore = createStore(firstTab, [deletedSource, validSource], [deletedSource, validSource]);

  assert.equal(firstStore.removeUpload(deletedSource, false), false);
  assert.equal(firstStore.getUploads().includes(deletedSource), true);
  assert.equal(firstStore.clearUploads(false), false);
  assert.deepEqual(firstStore.getUploads(), [deletedSource, validSource]);
});

test('batch deletion fails closed when the public deletion-marker helper is unavailable or fails', () => {
  const start = html.indexOf('function batchDeleteSelected(ask)');
  const end = html.indexOf('function downloadText(', start);
  const body = html.slice(start, end);
  const persistAt = body.indexOf('guardedStore.markUploadsDeleted(uploadedChosen)!==true');
  const abortAt = body.indexOf('return false;', persistAt);
  const mutationAt = body.indexOf('uploads=uploads.filter');
  assert.ok(persistAt >= 0 && abortAt > persistAt && mutationAt > abortAt);
});

test('immediate automatic sticker replies use the guarded register before creating a message', () => {
  const replyAt = html.indexOf('const replySticker = enabledStickerPool');
  const replyEnd = html.indexOf('let finalText = replyText', replyAt);
  assert.notEqual(replyAt, -1);
  assert.notEqual(replyEnd, -1);
  const replyPath = html.slice(replyAt, replyEnd);
  assert.match(replyPath, /xiaoshuStickerStore\.register\(replySticker\)/);
  assert.match(replyPath, /if\s*\(replyStickerId\)\s*\{[\s\S]*?addMessage\(/);
});

test('queued sticker IDs are rejected after deletion and valid IDs remain sendable', () => {
  const storage = createSharedStorage();
  const root = createRuntime('batch-delete-session', storage);
  const store = createStore(root, [deletedSource, validSource], [deletedSource, validSource]);
  const deletedId = root.XiaoshuStickerCore.stickerId(deletedSource);
  const validId = root.XiaoshuStickerCore.stickerId(validSource);

  assert.equal(store.authorizeSendId(deletedId), deletedId);
  assert.equal(store.removeUpload(deletedSource, false), true);
  assert.equal(store.authorizeSendId(deletedId), '');
  assert.equal(store.authorizeSendId(validId), validId);
});

test('queued sticker authorization fails closed when deletion-marker storage cannot be read', () => {
  const storage = createSharedStorage();
  const root = createRuntime('batch-storage-failure-session', storage);
  const store = createStore(root, [validSource], [validSource]);
  const validId = root.XiaoshuStickerCore.stickerId(validSource);
  storage.getItem = function () { throw new Error('storage blocked'); };

  assert.equal(store.authorizeSendId(validId), '');
});

test('queued sticker authorization fails closed when hidden-list storage cannot be read', () => {
  const storage = createSharedStorage();
  const originalGetItem = storage.getItem.bind(storage);
  const root = createRuntime('batch-hidden-failure-session', storage);
  const store = createStore(root, [validSource], [validSource]);
  const validId = root.XiaoshuStickerCore.stickerId(validSource);
  storage.getItem = function (key) {
    if (key === 'disabledStickerItems') throw new Error('hidden storage blocked');
    return originalGetItem(key);
  };

  assert.equal(store.authorizeSendId(validId), '');
});

test('batch message creation revalidates every sticker ID immediately before addMessage', () => {
  const start = html.indexOf('function sendBatchMessages()');
  const end = html.indexOf('window.simulateReply =', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = html.slice(start, end);
  const authorizeAt = body.indexOf('store.authorizeSendId(msg.stickerId)');
  const addAt = body.indexOf('addMessage({');
  assert.ok(authorizeAt >= 0 && addAt > authorizeAt, 'sticker authorization must precede new message creation');
  assert.match(body, /if\s*\(authorizedId !== msg\.stickerId\)\s*\{/);
  assert.match(body, /rejectedStickerCount/);
  assert.match(body, /if\s*\(sentCount\)\s*\{/);
});

test('history resource resolution remains available and separate from send authorization', () => {
  assert.match(html, /function resolveMessageResource\(id\)/);
  assert.match(html, /resolve:resolveMessageResource/);
  assert.match(guardSource, /api\.authorizeSendId\s*=\s*function\s*\(id\)/);
  assert.match(guardSource, /api\.resolve\(id\)/);
});

test('batch send skips deleted sticker IDs but still sends valid stickers and ordinary messages', () => {
  const start = html.indexOf('function sendBatchMessages()');
  const end = html.indexOf('\n\n        window.simulateReply =', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const sender = html.slice(start, end);
  const added = [];
  const notices = [];
  let saved = 0;
  let replies = 0;
  const context = {
    batchMessages: [
      { text: '', stickerId: 'deleted-id' },
      { text: '', stickerId: 'valid-id' },
      { text: 'ordinary text', stickerId: '' },
    ],
    window: {
      xiaoshuStickerStore: {
        authorizeSendId(id) { return id === 'valid-id' ? id : ''; },
      },
    },
    showNotification(message) { notices.push(message); },
    addMessage(message) { added.push(message); },
    playSound() {},
    xsQueueChatMessagesSave() { saved += 1; },
    simulateReply() { replies += 1; },
    isBatchMode: true,
    DOMElements: {
      batchBtn: { classList: { remove() {} } },
      batchPreview: { style: {} },
      messageInput: { placeholder: '' },
    },
  };

  vm.runInNewContext(sender + '; sendBatchMessages();', context);

  assert.deepEqual(added.map(message => message.stickerId || message.text), ['valid-id', 'ordinary text']);
  assert.equal(saved, 1);
  assert.equal(replies, 1);
  assert.equal(context.batchMessages.length, 0);
  assert.ok(notices.some(message => String(message).includes('已跳过 1 张')));
});


test('a queued sticker hidden after selection is rejected at final authorization', () => {
  const storage = createSharedStorage();
  const root = createRuntime('batch-hidden-after-queue-session', storage);
  const store = createStore(root, [validSource], [validSource]);
  const validId = root.XiaoshuStickerCore.stickerId(validSource);
  storage.setItem('disabledStickerItems', JSON.stringify([validSource]));
  assert.equal(store.authorizeSendId(validId), '');
  assert.equal(store.getPool().includes(validSource), false);
});

test('final authorization rejects malformed deletion and hidden state instead of treating it as empty', () => {
  for (const key of ['xiaoshu_deleted_upload_hashes_v1_malformed-session', 'disabledStickerItems']) {
    const storage = createSharedStorage();
    const root = createRuntime('malformed-session', storage);
    const store = createStore(root, [validSource], [validSource]);
    const validId = root.XiaoshuStickerCore.stickerId(validSource);
    storage.setItem(key, JSON.stringify({ unexpected: true }));
    assert.equal(store.authorizeSendId(validId), '', key + ' must fail closed');
  }
});

test('a deletion arriving during final resolution is observed before authorization returns', () => {
  const storage = createSharedStorage();
  const root = createRuntime('interleaved-delete-session', storage);
  const store = createStore(root, [deletedSource, validSource], [deletedSource, validSource]);
  const deletedId = root.XiaoshuStickerCore.stickerId(deletedSource);
  const tombstoneKey = 'xiaoshu_deleted_upload_hashes_v1_interleaved-delete-session';
  const originalResolve = store.resolve.bind(store);
  store.resolve = function (id) {
    const source = originalResolve(id);
    if (id === deletedId) storage.setItem(tombstoneKey, JSON.stringify([deletedId]));
    return source;
  };
  assert.equal(store.authorizeSendId(deletedId), '');
  const validId = root.XiaoshuStickerCore.stickerId(validSource);
  assert.equal(store.authorizeSendId(validId), validId);
});

test('queued sticker authorization waits for migration hydration', () => {
  const storage = createSharedStorage();
  const root = createRuntime('migration-pending-session', storage);
  const store = createStore(root, [validSource], [validSource]);
  const validId = root.XiaoshuStickerCore.stickerId(validSource);
  store.getMigrationState = () => ({ hydrated: false });
  assert.equal(store.authorizeSendId(validId), '');
});

test('a stale queued sticker cannot reappear after reload and IndexedDB hydration', async () => {
  const storage = createSharedStorage();
  const firstTab = createRuntime('reload-session', storage);
  const firstStore = createStore(firstTab, [deletedSource, validSource], [deletedSource, validSource]);
  const deletedId = firstTab.XiaoshuStickerCore.stickerId(deletedSource);
  assert.equal(firstStore.removeUpload(deletedSource, false), true);
  const reloadedTab = createRuntime('reload-session', storage);
  const reloadedStore = createStore(reloadedTab, [deletedSource, validSource], [deletedSource, validSource]);
  await reloadedStore.hydrate();
  assert.equal(reloadedStore.getUploads().includes(deletedSource), false);
  assert.equal(reloadedStore.getPool().includes(deletedSource), false);
  assert.equal(reloadedStore.authorizeSendId(deletedId), '');
  const validId = reloadedTab.XiaoshuStickerCore.stickerId(validSource);
  assert.equal(reloadedStore.authorizeSendId(validId), validId);
});

test('failed deletion persistence preserves the still-valid sticker send authorization', () => {
  const storage = createSharedStorage();
  const root = createRuntime('delete-write-failure-session', storage);
  const store = createStore(root, [deletedSource, validSource], [deletedSource, validSource]);
  const deletedId = root.XiaoshuStickerCore.stickerId(deletedSource);
  storage.setItem = function () { throw new Error('storage blocked'); };
  assert.equal(store.removeUpload(deletedSource, false), false);
  assert.equal(store.getUploads().includes(deletedSource), true);
  assert.equal(store.authorizeSendId(deletedId), deletedId);
});

test('each queued sticker is reauthorized independently during a repeated batch send', () => {
  const start = html.indexOf('function sendBatchMessages()');
  const end = html.indexOf('window.simulateReply =', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const sender = html.slice(start, end);
  const added = [];
  let authorizationCalls = 0;
  const context = {
    batchMessages: [
      { text: '', stickerId: 'same-id' },
      { text: '', stickerId: 'same-id' },
      { text: 'keep this text', stickerId: '' },
    ],
    window: { xiaoshuStickerStore: { authorizeSendId(id) {
      authorizationCalls += 1;
      return authorizationCalls === 1 ? id : '';
    } } },
    showNotification() {},
    addMessage(message) { added.push(message); },
    playSound() {},
    xsQueueChatMessagesSave() {},
    simulateReply() {},
    isBatchMode: true,
    DOMElements: {
      batchBtn: { classList: { remove() {} } },
      batchPreview: { style: {} },
      messageInput: { placeholder: '' },
    },
  };
  vm.runInNewContext(sender + '; sendBatchMessages();', context);
  assert.equal(authorizationCalls, 2);
  assert.deepEqual(added.map(message => message.stickerId || message.text), ['same-id', 'keep this text']);
});

test('a batch containing only rejected stickers does not save an empty message set or simulate a reply', () => {
  const start = html.indexOf('function sendBatchMessages()');
  const end = html.indexOf('window.simulateReply =', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const sender = html.slice(start, end);
  let saved = 0;
  let replies = 0;
  const context = {
    batchMessages: [
      { text: '', stickerId: 'deleted-one' },
      { text: '', stickerId: 'deleted-two' },
    ],
    window: { xiaoshuStickerStore: { authorizeSendId() { return ''; } } },
    showNotification() {},
    addMessage() { assert.fail('rejected stickers must not create messages'); },
    playSound() {},
    xsQueueChatMessagesSave() { saved += 1; },
    simulateReply() { replies += 1; },
    isBatchMode: true,
    DOMElements: {
      batchBtn: { classList: { remove() {} } },
      batchPreview: { style: {} },
      messageInput: { placeholder: '' },
    },
  };
  vm.runInNewContext(sender + '; sendBatchMessages();', context);
  assert.equal(saved, 0);
  assert.equal(replies, 0);
  assert.equal(context.batchMessages.length, 0);
});

test('historical message resource mappings remain readable after upload deletion', () => {
  const storage = createSharedStorage();
  const root = createRuntime('history-retention-session', storage);
  const store = createStore(root, [deletedSource], [deletedSource]);
  const deletedId = root.XiaoshuStickerCore.stickerId(deletedSource);
  const historical = root.XiaoshuStickerCore.rebuildResourceMap(
    [{ stickerId: deletedId }],
    { [deletedId]: deletedSource },
    []
  );
  assert.equal(store.removeUpload(deletedSource, false), true);
  assert.equal(historical.map[deletedId], deletedSource);
  assert.equal(historical.missing.length, 0);
});