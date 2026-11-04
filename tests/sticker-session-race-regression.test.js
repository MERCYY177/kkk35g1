'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script id="xiaoshu-shared-sticker-controller-v6">([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'shared sticker controller script must exist');
const controllerSource = scriptMatch[1];

function memoryStorage(seed) {
  const values = new Map(Object.entries(seed || {}));
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    key(index) { return Array.from(values.keys())[index] || null; },
    get length() { return values.size; },
    _values: values
  };
}

function createHarness(options) {
  options = options || {};
  const db = new Map(Object.entries(options.db || {}));
  const calls = [];
  const deferredGets = new Map();
  const timerCallbacks = new Map();
  let nextTimerId = 1;

  function deferNextGet(key) {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const queue = deferredGets.get(key) || [];
    queue.push({ promise, resolve, reject });
    deferredGets.set(key, queue);
    return { resolve, reject, promise };
  }

  const localforage = {
    getItem(key) {
      key = String(key);
      calls.push({ method: 'getItem', key });
      const queue = deferredGets.get(key);
      if (queue && queue.length) return queue.shift().promise;
      return Promise.resolve(db.has(key) ? db.get(key) : null);
    },
    setItem(key, value) {
      key = String(key);
      calls.push({ method: 'setItem', key, value });
      db.set(key, value);
      return Promise.resolve(value);
    },
    removeItem(key) {
      key = String(key);
      calls.push({ method: 'removeItem', key });
      db.delete(key);
      return Promise.resolve();
    },
    keys() {
      calls.push({ method: 'keys' });
      return Promise.resolve(Array.from(db.keys()));
    }
  };

  const localStorage = memoryStorage(options.localStorage || {});
  const sessionStorage = memoryStorage(options.sessionStorage || {});
  const listeners = Object.create(null);
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };

  const window = {
    SESSION_ID: options.sessionId || 'A',
    __xiaoshuSessionDataReady: options.sessionId || 'A',
    APP_PREFIX: 'APP_',
    localforage,
    localStorage,
    sessionStorage,
    document,
    myStickerLibrary: [],
    stickerLibrary: [],
    customStickerGroups: [],
    xiaoshuBuiltinStickerPacks: [],
    XiaoshuImageFormat: {
      inspectFile(file) {
        const ext = String(file && file.name || '').toLowerCase().split('.').pop();
        const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', apng: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };
        const mime = types[ext] || (String(file && file.type || '').startsWith('image/') ? file.type : '');
        return Promise.resolve({ mime, detected: !!types[ext], animated: ext === 'gif', isJpeg: ext === 'jpg' || ext === 'jpeg' });
      },
      normalizeDataUrl(value, info, file) {
        value = String(value || '');
        const mime = info && info.mime ? info.mime : (String(file && file.name || '').toLowerCase().endsWith('.gif') ? 'image/gif' : String(file && file.type || ''));
        return mime && /^data:[^;,]+(?:;[^,]*)?,/i.test(value) ? value.replace(/^data:[^;,]+/i, 'data:' + mime) : value;
      },
      byteLength(value) {
        const match = String(value || '').match(/^data:[^,]*;base64,([\s\S]*)$/i);
        if (!match) return 0;
        const payload = match[1].replace(/\s/g, '');
        const padding = payload.endsWith('==') ? 2 : (payload.endsWith('=') ? 1 : 0);
        return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
      }
    },
    XiaoshuStickerCore: {
      safeResourceUrl(src) {
        src = String(src || '');
        return /^(https?:\/\/|data:image\/|blob:)/i.test(src) ? src : '';
      },
      stickerId(src) {
        return 'stk_test_' + String(src).length;
      },
      rebuildResourceMap(messages, existing, catalog) {
        return { map: Object.assign(Object.create(null), existing || {}), missing: [] };
      }
    },
    addEventListener(type, callback) {
      (listeners[type] || (listeners[type] = [])).push(callback);
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).forEach((callback) => callback(event));
      return true;
    },
    confirm() { return true; },
    showNotification() {}
  };

  function fakeSetTimeout(callback, delay) {
    const id = nextTimerId++;
    timerCallbacks.set(id, { callback, delay: Number(delay) || 0 });
    return id;
  }
  function fakeClearTimeout(id) {
    timerCallbacks.delete(id);
  }

  const sandbox = {
    window,
    document,
    localforage,
    myStickerLibrary: [],
    stickerLibrary: [],
    customStickerGroups: [],
    messages: [],
    optimizeImage: options.optimizeImage || (() => Promise.resolve('https://cdn.test/default.png')),
    console: { log() {}, warn() {}, error() {} },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = (init && init.detail) || {}; }
    },
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetTimeout,
    clearInterval: fakeClearTimeout,
    Promise,
    Set,
    Map,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    RegExp,
    JSON
  };

  vm.createContext(sandbox);
  const marker = '})();';
  const injectionAt = controllerSource.lastIndexOf(marker);
  assert.ok(injectionAt >= 0, 'controller IIFE boundary must exist');
  const instrumentedControllerSource = controllerSource.slice(0, injectionAt) + 'window.__testStickerAdminOps={toggle:toggleAdminSelection,batchDelete:batchDeleteSelected,prepare:function(){adminVisibleSessionId=currentSessionId();adminSelectedSessionId=currentSessionId();}};' + String.fromCharCode(10) + controllerSource.slice(injectionAt);
  vm.runInContext(instrumentedControllerSource, sandbox, { filename: 'shared-sticker-controller-v6.js' });

  return {
    window,
    sandbox,
    store: window.xiaoshuStickerStore,
    db,
    calls,
    timerCallbacks,
    deferNextGet,
    setSession(sessionId) {
      window.SESSION_ID = sessionId;
      window.__xiaoshuSessionDataReady = sessionId;
      window.myStickerLibrary = [];
      sandbox.myStickerLibrary = [];
    },
    runTimer(timer) {
      timer.callback();
    }
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}

function resourceKey(sessionId) {
  return 'APP_' + sessionId + '_stickerMessageResourcesV1';
}
function uploadsKey(sessionId) {
  return 'APP_' + sessionId + '_myStickerLibrary';
}

test('T1: a late A resource-map read cannot enter B', async () => {
  const aResource = deferValue();
  const h = createHarness({
    db: {
      [uploadsKey('A')]: [],
      [uploadsKey('B')]: [],
      [resourceKey('B')]: { stk_B: 'https://cdn.test/B.png' }
    }
  });
  const held = h.deferNextGet(resourceKey('A'));
  const promiseA = h.store.hydrate(true);
  await flushMicrotasks();

  h.setSession('B');
  const promiseB = h.store.hydrate(true);
  assert.equal(await promiseB, true);
  held.resolve({ stk_A: 'https://cdn.test/A.png' });
  await promiseA;

  const resources = h.store.getMessageResources();
  assert.equal(Object.values(resources).includes('https://cdn.test/B.png'), true);
  assert.equal(Object.values(resources).includes('https://cdn.test/A.png'), false);
});

test('T2: a late A hidden-marker read cannot mutate B hidden state', async () => {
  const h = createHarness({
    db: {
      [uploadsKey('A')]: [],
      [uploadsKey('B')]: [],
      disabledStickerItems: []
    }
  });
  const held = h.deferNextGet('disabledStickerItems');
  const promiseA = h.store.hydrate(true);
  await flushMicrotasks();

  h.setSession('B');
  const promiseB = h.store.hydrate(true);
  assert.equal(await promiseB, true);
  held.resolve(['https://cdn.test/A-hidden.png']);
  await promiseA;

  assert.equal(h.store.getHidden().includes('https://cdn.test/A-hidden.png'), false);
});

test('T3: A legacy-group migration never reads or removes B group keys', async () => {
  const bGroupKey = 'APP_B_customStickerGroups';
  const h = createHarness({
    db: {
      [bGroupKey]: [{ name: 'B group', items: ['https://cdn.test/B-only.png'] }]
    }
  });

  assert.equal(await h.store.hydrate(true), true);
  assert.equal(h.db.has(bGroupKey), true);
  assert.equal(h.calls.some((call) => call.method === 'getItem' && call.key === bGroupKey), false);
  assert.equal(h.calls.some((call) => call.method === 'removeItem' && call.key === bGroupKey), false);
  assert.equal(h.calls.some((call) => call.method === 'keys'), false);
});

test('T4: an A hydrate that finishes after B cannot replace B uploads', async () => {
  const h = createHarness({
    db: {
      [uploadsKey('B')]: ['https://cdn.test/B-upload.png']
    }
  });
  const held = h.deferNextGet(uploadsKey('A'));
  const promiseA = h.store.hydrate(true);
  await flushMicrotasks();

  h.setSession('B');
  assert.equal(await h.store.hydrate(true), true);
  held.resolve(['https://cdn.test/A-upload.png']);
  await promiseA;

  const uploads = h.store.getUploads();
  assert.equal(uploads.includes('https://cdn.test/B-upload.png'), true);
  assert.equal(uploads.includes('https://cdn.test/A-upload.png'), false);
});

test('T5: A finally cannot clear B hydratePromise', async () => {
  const h = createHarness({
    db: {
      [uploadsKey('A')]: [],
      [uploadsKey('B')]: []
    }
  });
  const heldA = h.deferNextGet(resourceKey('A'));
  const promiseA = h.store.hydrate(true);
  await flushMicrotasks();

  h.setSession('B');
  const heldB = h.deferNextGet(resourceKey('B'));
  const promiseB = h.store.hydrate(true);
  await flushMicrotasks();

  heldA.resolve({});
  await promiseA;
  const bReadCountBefore = h.calls.filter((call) => call.method === 'getItem' && call.key === resourceKey('B')).length;
  const secondBCall = h.store.hydrate(false);
  const bReadCountAfter = h.calls.filter((call) => call.method === 'getItem' && call.key === resourceKey('B')).length;
  assert.equal(bReadCountAfter, bReadCountBefore, 'second B call must reuse B in-flight work');

  heldB.resolve({});
  assert.equal(await promiseB, true);
  assert.equal(await secondBCall, true);
});

test('T6: a delayed A resource timer does not write using B current state', async () => {
  const h = createHarness({
    db: {
      [uploadsKey('A')]: [],
      [uploadsKey('B')]: []
    }
  });
  assert.equal(await h.store.hydrate(true), true);
  assert.ok(h.store.register('https://cdn.test/A-message.png'));

  const scheduled = Array.from(h.timerCallbacks.values()).find((timer) => timer.delay === 120);
  assert.ok(scheduled, 'resource persistence timer should be scheduled');

  h.setSession('B');
  h.runTimer(scheduled);

  await flushMicrotasks();
  assert.equal(h.calls.some((call) => call.method === 'setItem' && call.key === resourceKey('B')), false);
  assert.equal(h.db.has(resourceKey('B')), false);
});

test('T7: upload completion from A is discarded after switching to B', async () => {
  let finishOptimization;
  const optimization = new Promise((resolve) => { finishOptimization = resolve; });
  const h = createHarness({
    db: {
      [uploadsKey('A')]: [],
      [uploadsKey('B')]: []
    },
    optimizeImage: () => optimization
  });
  assert.equal(await h.store.hydrate(true), true);

  const uploadPromise = h.store.addFiles([{ type: 'image/png', size: 1024, name: 'A.png' }]);
  await flushMicrotasks();
  h.setSession('B');
  assert.equal(await h.store.hydrate(true), true);
  finishOptimization('https://cdn.test/A-upload.png');
  assert.equal(await uploadPromise, 0);

  assert.equal(h.store.getUploads().includes('https://cdn.test/A-upload.png'), false);
  assert.equal((h.db.get(uploadsKey('B')) || []).includes('https://cdn.test/A-upload.png'), false);
});

test('T8: delete selections and deletion-guard completions are session-bound', () => {
  const batchStart = controllerSource.indexOf('function batchDeleteSelected(ask,expectedSessionId){');
  const batchEnd = controllerSource.indexOf('function downloadText(', batchStart);
  assert.ok(batchStart >= 0 && batchEnd > batchStart);
  const batchBody = controllerSource.slice(batchStart, batchEnd);
  const sessionCheck = batchBody.indexOf('adminSelectedSessionId!==owner.sid');
  const deleteMutation = batchBody.indexOf('uploads=uploads.filter');
  assert.ok(sessionCheck >= 0 && sessionCheck < deleteMutation, 'batch delete must reject a selection from another session');

  const adminStart = controllerSource.indexOf('function ensureModal(){');
  const adminEnd = controllerSource.indexOf('function renderAdmin(){', adminStart);
  const adminBody = controllerSource.slice(adminStart, adminEnd);
  assert.match(adminBody, /isAdminViewCurrent\(\)\)return/);
  assert.match(adminBody, /removeUpload\([^\n]+adminVisibleSessionId/);
  assert.match(adminBody, /clearUploads\(true,adminVisibleSessionId\)/);
  assert.match(adminBody, /batchDeleteSelected\(true,adminVisibleSessionId\)/);

  const inputStart = controllerSource.indexOf('function ensureInput(id){');
  const inputEnd = controllerSource.indexOf('function ensureInputs(){', inputStart);
  const inputBody = controllerSource.slice(inputStart, inputEnd);
  assert.match(inputBody, /input\.__xsUploadOwner\s*\|\|\s*null/);
  assert.match(inputBody, /isSessionContextCurrent\(owner\)/);
  assert.match(inputBody, /addFiles\(files,owner\)/);

  const guard = fs.readFileSync(path.join(__dirname, '..', 'sticker-core.js'), 'utf8');
  const hydrateGuard = guard.slice(guard.indexOf('api.hydrate = function ()'), guard.indexOf('api.openAdmin = function ()'));
  const uploadGuard = guard.slice(guard.indexOf('api.addFiles = function (files, expectedContext)'), guard.indexOf('// Final guard for the picker renderer'));
  const deleteGuard = guard.slice(guard.indexOf('api.removeUpload = function (src, ask, expectedSessionId)'), guard.indexOf('api.send = function (src)'));
  assert.match(hydrateGuard, /ownerSessionId\s*=\s*activeSessionId/);
  assert.match(hydrateGuard, /activeSessionId\(\)\s*!==\s*ownerSessionId/);
  assert.match(uploadGuard, /expectedContext/);
  assert.match(uploadGuard, /expectedSid\s*!==\s*ownerSessionId/);
  assert.match(uploadGuard, /activeSessionId\(\)\s*!==\s*ownerSessionId/);
  assert.match(deleteGuard, /expectedSessionId\s*&&\s*String\(expectedSessionId\)\s*!==\s*ownerSessionId/);
  assert.match(deleteGuard, /!matches\(currentUploads, src\)\)\s*return false/);
  assert.doesNotMatch(deleteGuard, /if\s*\(!exists\)\s*return rawRemoveUpload/);
});

function deferValue() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('controller script parses after session-race hardening', () => {
  assert.doesNotThrow(() => new Function(controllerSource));
});


test('T3b: a delayed A legacy-group writer cannot merge into B uploads', async () => {
  const h = createHarness({ sessionId: 'B', db: { [uploadsKey('B')]: [] } });
  assert.equal(await h.store.hydrate(true), true);
  h.store.installWriteGuard();

  const aKey = 'APP_A_customStickerGroups';
  await h.window.localforage.setItem(aKey, [{ name: 'A group', items: ['https://cdn.test/A-only.png'] }]);
  assert.equal(h.store.getUploads().includes('https://cdn.test/A-only.png'), false);
  assert.equal(h.db.has(aKey), true, 'A data remains under A key until A owns the session again');

  const bKey = 'APP_B_customStickerGroups';
  await h.window.localforage.setItem(bKey, [{ name: 'B group', items: ['https://cdn.test/B-only.png'] }]);
  assert.equal(h.store.getUploads().includes('https://cdn.test/B-only.png'), true);
  assert.equal(h.db.has(bKey), false, 'the active B legacy key is migrated into B uploads');
});


test('T1c: public store reads, sends, admin and sync stop exposing A after switching to B', async () => {
  const aSource = 'https://cdn.test/A-only.png';
  const aId = 'stk_A';
  const h = createHarness({
    sessionId: 'A',
    db: {
      [uploadsKey('A')]: [aSource],
      [resourceKey('A')]: { [aId]: aSource },
      [uploadsKey('B')]: []
    }
  });
  assert.equal(await h.store.hydrate(true), true);
  assert.equal(h.store.getUploads().includes(aSource), true);
  assert.equal(h.store.resolve(aId), aSource);
  assert.ok(h.window._stickerLibrary.includes(aSource), 'A pool is published for compatibility consumers while A is active');
  h.window.customStickerGroups = [{ name: 'A retired group', items: [aSource] }];
  h.sandbox.customStickerGroups = [{ name: 'A retired group', items: [aSource] }];

  h.setSession('B');
  assert.deepEqual(Array.from(h.store.getUploads()), []);
  assert.deepEqual(Array.from(h.store.getPool()), []);
  assert.deepEqual(Array.from(h.window._stickerLibrary), [], 'legacy fallback pool must not retain A stickers');
  assert.deepEqual(Array.from(h.window.customStickerGroups), [], 'retired window group alias must be cleared');
  assert.deepEqual(Array.from(h.sandbox.customStickerGroups), [], 'retired lexical group alias must be cleared');
  assert.equal(h.store.resolve(aId), '');
  assert.equal(h.store.send(aSource), false);
  assert.deepEqual(Array.from(h.store.sync()), []);
  assert.equal(h.store.openAdmin(), false);
  assert.equal(h.store.getMessageResources(), null, 'backup consumers must not persist an empty map before B hydrates');
});


test('T8b: a batch deletion selected in A cannot remove B uploads after switching', async () => {
  const aSource = 'https://cdn.test/A-selected.png';
  const bSource = 'https://cdn.test/B-only.png';
  const h = createHarness({
    sessionId: 'A',
    db: {
      [uploadsKey('A')]: [aSource],
      [uploadsKey('B')]: [bSource]
    }
  });
  assert.equal(await h.store.hydrate(true), true);
  h.store.markUploadsDeleted = () => true;
  h.window.__testStickerAdminOps.prepare();
  assert.equal(h.window.__testStickerAdminOps.toggle(aSource), true);

  h.setSession('B');
  assert.equal(h.window.__testStickerAdminOps.batchDelete(false), false);
  assert.equal(h.db.get(uploadsKey('B')).includes(bSource), true);
  assert.equal(h.db.get(uploadsKey('A')).includes(aSource), true);

  assert.equal(await h.store.hydrate(true), true);
  assert.deepEqual(Array.from(h.store.getUploads()), [bSource]);
});

test('sticker upload reports success only after canonical storage resolves', async () => {
  const source = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP';
  const h = createHarness({ optimizeImage: file => Promise.resolve(file.dataUrl) });
  assert.equal(await h.store.hydrate(true), true);
  await flushMicrotasks();

  const originalSetItem = h.window.localforage.setItem.bind(h.window.localforage);
  let releaseWrite;
  let writeStarted = false;
  h.window.localforage.setItem = function (key, value) {
    if (String(key) === uploadsKey('A')) {
      writeStarted = true;
      return new Promise((resolve, reject) => {
        releaseWrite = () => originalSetItem(key, value).then(resolve, reject);
      });
    }
    return originalSetItem(key, value);
  };
  const notifications = [];
  h.sandbox.showNotification = (message, type) => notifications.push({ message, type });

  let settled = false;
  const uploadPromise = h.store.addFiles([{
    name: 'animated.gif', type: 'image/gif', size: 1024, dataUrl: source
  }]).then(value => { settled = true; return value; });
  await flushMicrotasks();
  assert.equal(writeStarted, true, 'the canonical database write should have started');
  assert.equal(settled, false, 'addFiles must remain pending while IndexedDB is pending');
  assert.deepEqual(Array.from(h.db.get(uploadsKey('A')) || []), [], 'the canonical value must not be visible before commit');
  assert.equal(notifications.some(item => /已保存并加入共享表情包/.test(item.message)), false, 'success must not be announced before commit');

  releaseWrite();
  assert.equal(await uploadPromise, 1);
  assert.deepEqual(Array.from(h.db.get(uploadsKey('A')) || []), [source]);
  assert.equal(notifications.some(item => /已保存并加入共享表情包/.test(item.message) && item.type === 'success'), true);
});

test('sticker upload rolls back and reports failure when canonical storage rejects', async () => {
  const source = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP';
  const h = createHarness({ optimizeImage: file => Promise.resolve(file.dataUrl) });
  assert.equal(await h.store.hydrate(true), true);
  await flushMicrotasks();

  const originalSetItem = h.window.localforage.setItem.bind(h.window.localforage);
  h.window.localforage.setItem = function (key, value) {
    if (String(key) === uploadsKey('A')) return Promise.reject(new Error('simulated IndexedDB quota error'));
    return originalSetItem(key, value);
  };
  const notifications = [];
  h.sandbox.showNotification = (message, type) => notifications.push({ message, type });

  const result = await h.store.addFiles([{
    name: 'animated.gif', type: 'image/gif', size: 1024, dataUrl: source
  }]);
  assert.equal(result, 0);
  assert.deepEqual(Array.from(h.store.getUploads()), [], 'failed upload must be removed from the live pool');
  assert.deepEqual(Array.from(h.db.get(uploadsKey('A')) || []), [], 'failed upload must not replace the durable canonical value');
  assert.equal(notifications.some(item => /保存失败，未完成添加/.test(item.message) && item.type === 'warning'), true);
});

test('concurrent sticker batches do not persist a batch that has rolled back', async () => {
  const sourceA = 'data:image/gif;base64,R0lGODlhA';
  const sourceB = 'data:image/gif;base64,R0lGODlhB';
  const h = createHarness({ optimizeImage: file => Promise.resolve(file.dataUrl) });
  assert.equal(await h.store.hydrate(true), true);
  await flushMicrotasks();
  h.store.installWriteGuard();

  const guardedSetter = h.window.localforage.setItem;
  const rawSetter = guardedSetter.__xsStickerGroupRawSetItem;
  assert.equal(typeof rawSetter, 'function', 'the canonical write guard must be installed');
  let canonicalWrites = 0;
  let rejectFirstWrite;
  guardedSetter.__xsStickerGroupRawSetItem = function (key, value) {
    if (String(key) === uploadsKey('A') && canonicalWrites++ === 0) {
      return new Promise((_resolve, reject) => {
        rejectFirstWrite = () => reject(new Error('simulated first-batch quota failure'));
      });
    }
    return rawSetter(key, value);
  };

  const first = h.store.addFiles([{ name: 'first.gif', type: 'image/gif', size: 100, dataUrl: sourceA }]);
  const second = h.store.addFiles([{ name: 'second.gif', type: 'image/gif', size: 100, dataUrl: sourceB }]);
  await flushMicrotasks();
  assert.equal(canonicalWrites, 1, 'second batch must wait for the first transaction to finish');
  assert.deepEqual(Array.from(h.store.getUploads()), [sourceA], 'second batch must not enter the live snapshot while first is pending');

  rejectFirstWrite();
  assert.equal(await first, 0, 'the first batch should report its failed commit');
  assert.equal(await second, 1, 'the second batch should commit independently after rollback');
  assert.deepEqual(Array.from(h.store.getUploads()), [sourceB]);
  assert.deepEqual(Array.from(h.db.get(uploadsKey('A')) || []), [sourceB], 'rolled-back first source must not leak into the later committed snapshot');
});

test('sticker upload restores an image MIME from generic Android file-provider data', async () => {
  const source = 'data:application/octet-stream;base64,R0lGODlhAQABAIAAAAAAAP';
  const expected = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP';
  const h = createHarness({ optimizeImage: () => Promise.resolve(source) });
  assert.equal(await h.store.hydrate(true), true);
  await flushMicrotasks();

  assert.equal(await h.store.addFiles([{
    name: 'animation.gif', type: 'application/octet-stream', size: 1024
  }]), 1);
  assert.deepEqual(Array.from(h.db.get(uploadsKey('A')) || []), [expected]);
});
