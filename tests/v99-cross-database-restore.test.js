'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const integritySource = fs.readFileSync(path.join(root, 'font-integrity.js'), 'utf8');
const managerSource = fs.readFileSync(path.join(root, 'custom-font-manager.js'), 'utf8');
const helperStart = html.indexOf('function normalizeV99BackupKey(');
const helperEnd = html.indexOf('// ---------- 两级灾难抢救', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'V99 production restore source must be present');

function makeFont(id, fill) {
  const bytes = new Uint8Array(32);
  bytes.set([0, 1, 0, 0], 0);
  bytes.fill(fill, 4);
  return { id, name: id, fileName: id + '.ttf', format: 'ttf', mimeType: 'font/ttf',
    size: bytes.length, blob: new Blob([bytes], { type: 'font/ttf' }), createdAt: 123 };
}
function openFontDb(indexedDB) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('chuanxun-local-font-library', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('fonts', { keyPath: 'id' });
      req.result.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function seedFontDb(indexedDB, records, currentFontId) {
  const db = await openFontDb(indexedDB);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['fonts', 'meta'], 'readwrite');
    records.forEach(record => tx.objectStore('fonts').put(record));
    tx.objectStore('meta').put({ key: 'currentFontId', value: currentFontId || null });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
function loadFontManager() {
  const indexedDB = new IDBFactory();
  const listeners = {};
  const document = {
    readyState: 'loading',
    addEventListener(type, callback) { listeners[type] = callback; },
    documentElement: { classList: { contains() { return false; } } }
  };
  const window = { document, indexedDB, crypto: webcrypto, addEventListener() {} };
  const context = { window, console, Uint8Array, ArrayBuffer, Promise, Error, Math, Date, Blob,
    setTimeout, clearTimeout, TextEncoder };
  vm.runInNewContext(integritySource, context, { filename: 'font-integrity.js' });
  vm.runInNewContext(managerSource, context, { filename: 'custom-font-manager.js' });
  Object.defineProperty(window.ChuanXunFontManager, '__testIndexedDB', { value: indexedDB });
  return window.ChuanXunFontManager;
}
class TestLocalStorage {
  constructor(entries, fault) { this.data = new Map(Object.entries(entries || {})); this.fault = fault || {}; }
  get length() { return this.data.size; }
  key(index) { return Array.from(this.data.keys())[index] ?? null; }
  getItem(key) { if (this.fault.get) this.fault.get(key); return this.data.has(String(key)) ? this.data.get(String(key)) : null; }
  setItem(key, value) { if (this.fault.set) this.fault.set(String(key), String(value)); this.data.set(String(key), String(value)); }
  removeItem(key) { if (this.fault.remove) this.fault.remove(String(key)); this.data.delete(String(key)); }
  snapshot() { return Object.fromEntries(this.data); }
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function checksum(value) { return JSON.stringify(value); }
function timeoutPromise(promise, ms, label) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + '超时')), ms);
  })]).finally(() => clearTimeout(timer));
}
async function makeFixture(options = {}) {
  const targetFonts = options.targetFonts || [makeFont('font-old', 11)];
  const targetCurrent = options.targetCurrent === undefined ? 'font-old' : options.targetCurrent;
  const incomingFonts = options.incomingFonts || [makeFont('font-new', 22)];
  const incomingCurrent = options.incomingCurrent === undefined ? incomingFonts[0]?.id || null : options.incomingCurrent;
  const manager = loadFontManager();
  await seedFontDb(manager.__testIndexedDB, targetFonts, targetCurrent);
  const sourceManager = loadFontManager();
  await seedFontDb(sourceManager.__testIndexedDB, incomingFonts, incomingCurrent);
  const fontBackup = await sourceManager.exportBackupSnapshot();

  const initialLf = {
    TEST_sessionList: [{ id: 'old-session' }],
    TEST_lastSessionId: 'old-session',
    TEST_s1_chatMessages: [{ id: 'old-message' }],
    TEST_obsolete_chatSettings: { old: true }
  };
  const backupLf = {
    TEST_sessionList: [{ id: 's1' }],
    TEST_lastSessionId: 's1',
    TEST_s1_chatMessages: [{ id: 'new-message' }]
  };
  const lfData = new Map(Object.entries(initialLf));
  const fault = { lfSet: null, lfGet: null, lsSet: null };
  const localforage = {
    async keys() { return Array.from(lfData.keys()); },
    async getItem(key) { if (fault.lfGet) fault.lfGet(String(key)); return lfData.has(String(key)) ? clone(lfData.get(String(key))) : null; },
    async setItem(key, value) { if (fault.lfSet) fault.lfSet(String(key), value); lfData.set(String(key), clone(value)); return value; },
    async removeItem(key) { lfData.delete(String(key)); },
    __data: lfData
  };
  const localStorage = new TestLocalStorage({ TEST_profile: '{"version":"old"}' });
  const originalProfile = localStorage.getItem('TEST_profile');

  const ChatBackup = {
    classifyKey() { return 'chat'; },
    inlineMediaTree(value) { return value; },
    async preflightBackup(data) {
      try {
        if (data.fontBackup) await manager.validateBackupSnapshot(data.fontBackup);
        return { ok: true, data, availableCategoryIds: ['chat'], errors: [], warnings: [] };
      } catch (error) {
        return { ok: false, data, availableCategoryIds: ['chat'], errors: [error.message], warnings: [] };
      }
    }
  };
  const sandbox = {
    ChatBackup, localforage, localStorage, V99: { readTimeout: 1000, writeTimeout: 1000 },
    currentPrefix: () => 'TEST_', currentSid: () => 's1',
    ensureRegistryForData() {}, own: (o, k) => Object.prototype.hasOwnProperty.call(o, k),
    clone, checksum, timeoutPromise, errText: e => e && e.message ? e.message : String(e),
    setTimeout, clearTimeout, Promise, Error, String, Number, Object, Array, Math, Date,
    console, global: null
  };
  sandbox.global = sandbox;
  sandbox.ChuanXunFontManager = manager;
  vm.runInNewContext(html.slice(helperStart, helperEnd), sandbox, { filename: 'V99-production-restore.js' });
  const data = {
    type: 'full', appName: 'ChatApp', appPrefix: 'TEST_', sessionId: 's1',
    localforage: backupLf, localStorage: { TEST_profile: '{"version":"new"}' },
    mediaStore: {}, fontBackup
  };
  return {
    manager, data, fault, lfData, localforage, localStorage, initialLf,
    originalProfile, async apply() { return sandbox.ChatBackup.applyBackupToStorage(data); },
    snapshotMain() { return { lf: Object.fromEntries(lfData), ls: localStorage.snapshot() }; }
  };
}
async function assertOriginalMain(fixture) {
  const after = fixture.snapshotMain();
  assert.deepEqual(after.lf, fixture.initialLf);
  assert.equal(after.ls.TEST_profile, fixture.originalProfile);
}
async function fontIds(manager) {
  const snapshot = await manager.exportBackupSnapshot();
  return { ids: snapshot.fonts.map(x => x.id).sort(), current: snapshot.currentFontId, snapshot };
}

test('V99 production restore commits LocalForage, LocalStorage and font IndexedDB together', async () => {
  const f = await makeFixture();
  const result = await f.apply();
  assert.equal(result.ok, true);
  assert.deepEqual(f.snapshotMain().lf.TEST_sessionList, [{ id: 's1' }]);
  assert.equal(f.snapshotMain().ls.TEST_profile, '{"version":"new"}');
  assert.equal(f.snapshotMain().lf.TEST_obsolete_chatSettings, undefined);
  const fonts = await fontIds(f.manager);
  assert.deepEqual(fonts.ids, ['font-new', 'font-old']);
  assert.equal(fonts.current, 'font-new');
  assert.deepEqual(Array.from(new Uint8Array(await fonts.snapshot.fonts.find(x => x.id === 'font-new').blob.arrayBuffer())),
    Array.from(new Uint8Array(await f.data.fontBackup.fonts[0].blob.arrayBuffer())));
});

test('same ID and same bytes with different labels are skipped without replacing existing metadata', async () => {
  const shared = makeFont('font-shared', 33);
  const f = await makeFixture({ targetFonts: [shared], targetCurrent: 'font-shared',
    incomingFonts: [makeFont('font-shared', 33)], incomingCurrent: 'font-shared' });
  f.data.fontBackup.fonts[0].name = 'Incoming label';
  f.data.fontBackup.fonts[0].fileName = 'renamed-shared.ttf';
  const before = await fontIds(f.manager);
  const result = await f.apply();
  assert.equal(result.ok, true);
  assert.equal(result.restoredFonts, 1);
  const after = await fontIds(f.manager);
  assert.deepEqual(after.ids, ['font-shared']);
  assert.equal(after.snapshot.fonts[0].name, before.snapshot.fonts[0].name);
  assert.equal(after.snapshot.fonts[0].fileName, before.snapshot.fonts[0].fileName);
  assert.equal(f.snapshotMain().ls.TEST_profile, '{"version":"new"}');
});

test('same ID with different bytes rejects import and restores both main stores', async () => {
  const f = await makeFixture({ targetFonts: [makeFont('font-new', 44)], targetCurrent: 'font-new',
    incomingFonts: [makeFont('font-new', 22)], incomingCurrent: 'font-new' });
  const before = await fontIds(f.manager);
  await assert.rejects(f.apply(), /字体 ID 冲突，拒绝覆盖现有字体/);
  await assertOriginalMain(f);
  const after = await fontIds(f.manager);
  assert.deepEqual(after.ids, before.ids);
  assert.equal(after.snapshot.fonts[0].checksum, before.snapshot.fonts[0].checksum);
  assert.equal(after.current, 'font-new');
});

test('font preflight failure happens before any persistent write', async () => {
  const f = await makeFixture();
  f.data.fontBackup.fonts[0].checksum = '0'.repeat(64);
  const before = f.snapshotMain();
  const fontBefore = await fontIds(f.manager);
  await assert.rejects(f.apply(), /备份预检失败/);
  assert.deepEqual(f.snapshotMain(), before);
  const fontAfter = await fontIds(f.manager);
  assert.deepEqual(fontAfter.ids, fontBefore.ids);
  assert.equal(fontAfter.current, fontBefore.current);
});

test('LocalForage mid-write failure rolls back all three stores', async () => {
  const f = await makeFixture();
  let failed = false;
  f.fault.lfSet = key => { if (!failed && key === 'TEST_sessionList') { failed = true; throw new Error('injected LocalForage write failure'); } };
  await assert.rejects(f.apply(), /恢复失败，主存储与字体库均已回滚/);
  await assertOriginalMain(f);
  assert.deepEqual((await fontIds(f.manager)).ids, ['font-old']);
});

test('LocalStorage write failure rolls back LocalForage and leaves font IndexedDB untouched', async () => {
  const f = await makeFixture();
  let failed = false;
  f.localStorage.fault.set = key => { if (!failed && key === 'TEST_profile') { failed = true; throw new Error('injected LocalStorage write failure'); } };
  await assert.rejects(f.apply(), /恢复失败，主存储与字体库均已回滚/);
  await assertOriginalMain(f);
  assert.deepEqual((await fontIds(f.manager)).ids, ['font-old']);
});

test('font IndexedDB transaction failure rolls back main stores atomically', async () => {
  const f = await makeFixture();
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function(record) {
    if (this.name === 'fonts' && record && record.id === 'font-new') throw new Error('injected font transaction failure');
    return originalAdd.apply(this, arguments);
  };
  try {
    await assert.rejects(f.apply(), /字体库事务写入失败/);
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }
  await assertOriginalMain(f);
  assert.deepEqual((await fontIds(f.manager)).ids, ['font-old']);
  assert.equal((await fontIds(f.manager)).current, 'font-old');
});

test('font write followed by font readback failure removes only new fonts and restores selection', async () => {
  const f = await makeFixture();
  const originalExport = f.manager.exportBackupSnapshot.bind(f.manager);
  let calls = 0;
  f.manager.exportBackupSnapshot = async function() {
    calls++;
    if (calls === 2) throw new Error('injected font readback failure');
    return originalExport();
  };
  try {
    await assert.rejects(f.apply(), /字体恢复后回读/);
  } finally {
    f.manager.exportBackupSnapshot = originalExport;
  }
  await assertOriginalMain(f);
  const after = await fontIds(f.manager);
  assert.deepEqual(after.ids, ['font-old']);
  assert.equal(after.current, 'font-old');
});

test('font write followed by later V99 failure rolls back all stores', async () => {
  const f = await makeFixture();
  let fontWritten = false;
  const restore = f.manager.restoreBackupSnapshot.bind(f.manager);
  f.manager.restoreBackupSnapshot = async function(snapshot) {
    const result = await restore(snapshot);
    fontWritten = true;
    return result;
  };
  let failed = false;
  f.fault.lfGet = key => { if (fontWritten && !failed && key === 'TEST_lastSessionId') { failed = true; throw new Error('injected post-font verification failure'); } };
  await assert.rejects(f.apply(), /恢复失败，主存储与字体库均已回滚/);
  await assertOriginalMain(f);
  const after = await fontIds(f.manager);
  assert.deepEqual(after.ids, ['font-old']);
  assert.equal(after.current, 'font-old');
});

test('font rollback failure is reported as partial rollback, never as full rollback', async () => {
  const f = await makeFixture();
  let fontWritten = false;
  const restore = f.manager.restoreBackupSnapshot.bind(f.manager);
  f.manager.restoreBackupSnapshot = async function(snapshot) {
    const result = await restore(snapshot);
    fontWritten = true;
    return result;
  };
  f.manager.rollbackBackupRestore = async function() { throw new Error('injected font rollback failure'); };
  let failed = false;
  f.fault.lfGet = key => { if (fontWritten && !failed && key === 'TEST_lastSessionId') { failed = true; throw new Error('injected post-font failure'); } };
  await assert.rejects(f.apply(), error => {
    assert.match(error.message, /至少一个数据库自动回滚失败/);
    assert.match(error.message, /字体库回滚失败/);
    assert.doesNotMatch(error.message, /均已回滚到导入前状态/);
    return true;
  });
  await assertOriginalMain(f);
  assert.deepEqual((await fontIds(f.manager)).ids, ['font-new', 'font-old']);
});

test('main-store rollback failure is reported and remaining rollback steps still run', async () => {
  const f = await makeFixture();
  let fontWritten = false;
  const restore = f.manager.restoreBackupSnapshot.bind(f.manager);
  f.manager.restoreBackupSnapshot = async function(snapshot) {
    const result = await restore(snapshot);
    fontWritten = true;
    return result;
  };
  let verificationFailed = false;
  f.fault.lfGet = key => {
    if (fontWritten && !verificationFailed && key === 'TEST_lastSessionId') {
      verificationFailed = true;
      throw new Error('injected post-font failure');
    }
  };
  let rollbackFailed = false;
  f.fault.lfSet = (key, value) => {
    if (verificationFailed && !rollbackFailed && key === 'TEST_sessionList' &&
        Array.isArray(value) && value[0] && value[0].id === 'old-session') {
      rollbackFailed = true;
      throw new Error('injected main rollback failure');
    }
  };
  await assert.rejects(f.apply(), error => {
    assert.match(error.message, /至少一个数据库自动回滚失败/);
    assert.match(error.message, /主存储回滚失败/);
    assert.doesNotMatch(error.message, /均已回滚到导入前状态/);
    return true;
  });
  assert.equal(f.snapshotMain().ls.TEST_profile, '{"version":"old"}');
  assert.deepEqual(f.snapshotMain().lf.TEST_lastSessionId, 'old-session');
  assert.deepEqual(f.snapshotMain().lf.TEST_s1_chatMessages, [{ id: 'old-message' }]);
  assert.deepEqual(f.snapshotMain().lf.TEST_sessionList, [{ id: 's1' }]);
  const after = await fontIds(f.manager);
  assert.deepEqual(after.ids, ['font-old']);
  assert.equal(after.current, 'font-old');
});
