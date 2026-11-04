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
  vm.runInContext(controllerSource, sandbox, { filename: 'shared-sticker-controller-v6.js' });

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
  for (let i = 0; i < 12; i++) await Promise.resolve();
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
  const batchStart = controllerSource.indexOf('function batchDeleteSelected(ask){');
  const batchEnd = controllerSource.indexOf('function downloadText(', batchStart);
  assert.ok(batchStart >= 0 && batchEnd > batchStart);
  const batchBody = controllerSource.slice(batchStart, batchEnd);
  const sessionCheck = batchBody.indexOf('adminSelectedSessionId!==owner.sid');
  const deleteMutation = batchBody.indexOf('uploads=uploads.filter');
  assert.ok(sessionCheck >= 0 && sessionCheck < deleteMutation, 'batch delete must reject a selection from another session');

  const guard = fs.readFileSync(path.join(__dirname, '..', 'sticker-core.js'), 'utf8');
  const hydrateGuard = guard.slice(guard.indexOf('api.hydrate = function ()'), guard.indexOf('api.openAdmin = function ()'));
  const uploadGuard = guard.slice(guard.indexOf('api.addFiles = function ()'), guard.indexOf('// Final guard for the picker renderer'));
  assert.match(hydrateGuard, /ownerSessionId\s*=\s*activeSessionId/);
  assert.match(hydrateGuard, /activeSessionId\(\)\s*!==\s*ownerSessionId/);
  assert.match(uploadGuard, /ownerSessionId\s*=\s*activeSessionId/);
  assert.match(uploadGuard, /activeSessionId\(\)\s*!==\s*ownerSessionId/);
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
