const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const integritySource = fs.readFileSync(path.join(root, 'font-integrity.js'), 'utf8');
const fontManagerSource = fs.readFileSync(path.join(root, 'custom-font-manager.js'), 'utf8');
const APPLY_START = 'async function v99ApplyBackup(data,opt){';
const APPLY_END = 'if(global.ChatBackup)global.ChatBackup.applyBackupToStorage=v99ApplyBackup;';
const applyStart = indexSource.indexOf(APPLY_START);
const applyEnd = indexSource.indexOf(APPLY_END, applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart, 'production V99 apply function must exist in index.html');
const productionApplySource = indexSource.slice(applyStart, applyEnd) + '\nglobal.__v99ApplyBackup = v99ApplyBackup;';

function makeRecord(id, suffix, name = id, fileName = id + '.ttf') {
  const bytes = new Uint8Array(32);
  bytes.set([0, 1, 0, 0]);
  for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 13 + suffix) & 255;
  return { id, name, fileName, format: 'ttf', mimeType: 'font/ttf', size: bytes.length,
    blob: new Blob([bytes], { type: 'font/ttf' }), createdAt: 1234 };
}
async function seed(manager, records, currentFontId) {
  const idb = manager.__testIndexedDB;
  const req = idb.open('chuanxun-local-font-library', 1);
  const db = await new Promise((resolve, reject) => {
    req.onupgradeneeded = () => {
      req.result.createObjectStore('fonts', { keyPath: 'id' });
      req.result.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['fonts', 'meta'], 'readwrite');
    records.forEach(r => tx.objectStore('fonts').put(r));
    tx.objectStore('meta').put({ key: 'currentFontId', value: currentFontId });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
function makeManager() {
  const idb = new IDBFactory();
  const document = { readyState: 'loading', addEventListener() {},
    documentElement: { classList: { contains() { return false; } } } };
  const window = { document, indexedDB: idb, crypto: webcrypto, addEventListener() {} };
  const context = { window, console, Uint8Array, ArrayBuffer, Promise, Error, Math, Date, Blob,
    setTimeout, clearTimeout };
  vm.runInNewContext(integritySource, context, { filename: 'font-integrity.js' });
  vm.runInNewContext(fontManagerSource, context, { filename: 'custom-font-manager.js' });
  Object.defineProperty(window.ChuanXunFontManager, '__testIndexedDB', { value: idb });
  return window.ChuanXunFontManager;
}
function makeLocalStorage(initial) {
  const values = new Map(Object.entries(initial || {}).map(([k, v]) => [k, String(v)]));
  return {
    get length() { return values.size; },
    key(i) { return Array.from(values.keys())[i] ?? null; },
    getItem(k) { return values.has(String(k)) ? values.get(String(k)) : null; },
    setItem(k, v) { values.set(String(k), String(v)); },
    removeItem(k) { values.delete(String(k)); },
    clear() { values.clear(); },
    snapshot() { return Object.fromEntries(values); }
  };
}
function makeHarness({ manager, failLfAt, failLsAt, failCleanup = false,
  failMainRollback = false } = {}) {
  const lf = new Map([['test:old-lf', { value: 'before-lf' }]]);
  const ls = makeLocalStorage({ 'test:old-ls': 'before-ls' });
  let rollbackCalls = 0;
  const window = { ChuanXunFontManager: manager };
  const ChatBackup = {
    async preflightBackup(data) { return { ok: true, data, availableCategoryIds: ['test'], warnings: [] }; },
    classifyKey(key) { return String(key).startsWith('test:') ? 'test' : null; },
    inlineMediaTree(value) { return value; }
  };
  const context = {
    global: window, window, ChatBackup, localStorage: ls,
    V99: { writeTimeout: 5000 }, console,
    ensureRegistryForData() {}, selectedSet(ids) { return Object.fromEntries(ids.map(x => [x, true])); },
    currentPrefix() { return 'app:'; }, inferSid() { return null; }, currentSid() { return null; },
    own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); },
    normalizeV99BackupKey(key) { return key; }, importLsValue(value) { return value; },
    timeoutPromise(p) { return Promise.resolve(p); },
    checksum(value) { return JSON.stringify(value); },
    errText(e) { return e && e.message ? e.message : String(e); },
    lfSetStrict: async (key, value) => {
      if (key === failLfAt) throw new Error('injected LocalForage write failure');
      lf.set(key, structuredClone(value));
    },
    lfGetStrict: async key => lf.has(key) ? structuredClone(lf.get(key)) : undefined,
    lfKeysStrict: async () => Array.from(lf.keys()),
    lfRemoveStrict: async key => { lf.delete(key); },
    lsSetStrict: (key, value) => {
      if (key === failLsAt) throw new Error('injected LocalStorage write failure');
      ls.setItem(key, value);
    },
    snapshotSelected: async () => ({ lf: Object.fromEntries(lf), ls: ls.snapshot() }),
    rollbackSnapshot: async snapshot => {
      rollbackCalls++;
      if (failMainRollback) throw new Error('injected main-storage rollback failure');
      lf.clear();
      Object.entries(snapshot.lf).forEach(([k, v]) => lf.set(k, structuredClone(v)));
      ls.clear();
      Object.entries(snapshot.ls).forEach(([k, v]) => ls.setItem(k, v));
    },
    cleanupRetiredV99: async () => { if (failCleanup) throw new Error('injected post-font cleanup failure'); },
    strictLfApi: () => ({ setItem: async (k, v) => lf.set(k, structuredClone(v)),
      removeItem: async k => lf.delete(k), getItem: async k => lf.get(k) }),
    localforage: { setItem: async (k, v) => lf.set(k, structuredClone(v)) }
  };
  vm.runInNewContext(productionApplySource, context, { filename: 'production-v99-apply.js' });
  return { apply: context.window.__v99ApplyBackup, lf, ls, rollbackCount: () => rollbackCalls };
}
function backup(fontBackup) {
  return { appPrefix: 'app:', localforage: { 'test:new-lf': { value: 'after-lf' } },
    localStorage: { 'test:new-ls': 'after-ls' }, mediaStore: {}, fontBackup };
}
async function sourceSnapshot(records, currentId) {
  const manager = makeManager();
  await seed(manager, records, currentId);
  return manager.exportBackupSnapshot();
}
async function ids(manager) {
  return (await manager.listFonts()).map(x => x.id).sort();
}

test('actual V99 apply restores LocalForage, LocalStorage and the isolated font IndexedDB together', async () => {
  const old = makeRecord('shared', 3, 'Original label');
  const incomingSame = makeRecord('shared', 3, 'Backup label', 'backup-name.ttf');
  const incomingNew = makeRecord('new-font', 9);
  const incoming = await sourceSnapshot([incomingSame, incomingNew], 'new-font');
  const manager = makeManager();
  await seed(manager, [old], 'shared');
  const harness = makeHarness({ manager });
  const result = await harness.apply(backup(incoming), { selectedCategoryIds: ['test'] });
  assert.equal(result.ok, true);
  assert.deepEqual(harness.lf.get('test:new-lf'), { value: 'after-lf' });
  assert.equal(harness.ls.getItem('test:new-ls'), 'after-ls');
  assert.deepEqual(await ids(manager), ['new-font', 'shared']);
  assert.equal((await manager.exportBackupSnapshot()).currentFontId, 'new-font');
  assert.equal((await manager.listFonts()).find(x => x.id === 'shared').name, 'Original label');
});

test('same ID with different bytes is rejected and all three stores remain at their pre-import state', async () => {
  const incoming = await sourceSnapshot([makeRecord('shared', 99)], 'shared');
  const manager = makeManager();
  await seed(manager, [makeRecord('shared', 3, 'Keep me')], 'shared');
  const beforeFonts = await manager.exportBackupSnapshot();
  const harness = makeHarness({ manager });
  await assert.rejects(harness.apply(backup(incoming), { selectedCategoryIds: ['test'] }), /ID 冲突，拒绝覆盖/);
  assert.deepEqual(harness.lf.get('test:old-lf'), { value: 'before-lf' });
  assert.equal(harness.ls.getItem('test:old-ls'), 'before-ls');
  assert.deepEqual(await ids(manager), ['shared']);
  assert.equal((await manager.exportBackupSnapshot()).fonts[0].checksum, beforeFonts.fonts[0].checksum);
  assert.equal((await manager.exportBackupSnapshot()).currentFontId, 'shared');
});

test('LocalForage mid-write failure occurs before fonts and rolls back LocalStorage and LocalForage', async () => {
  const incoming = await sourceSnapshot([makeRecord('new-font', 8)], 'new-font');
  const manager = makeManager();
  await seed(manager, [makeRecord('old-font', 2)], 'old-font');
  const beforeFonts = await manager.exportBackupSnapshot();
  const harness = makeHarness({ manager, failLfAt: 'test:new-lf' });
  await assert.rejects(harness.apply(backup(incoming), { selectedCategoryIds: ['test'] }), /LocalForage write failure/);
  assert.deepEqual(await ids(manager), ['old-font']);
  assert.equal((await manager.exportBackupSnapshot()).currentFontId, beforeFonts.currentFontId);
  assert.deepEqual(harness.lf.get('test:old-lf'), { value: 'before-lf' });
  assert.equal(harness.ls.getItem('test:old-ls'), 'before-ls');
});

test('LocalStorage write failure rolls back the earlier LocalForage write before font mutation', async () => {
  const incoming = await sourceSnapshot([makeRecord('new-font', 8)], 'new-font');
  const manager = makeManager();
  await seed(manager, [makeRecord('old-font', 2)], 'old-font');
  const harness = makeHarness({ manager, failLsAt: 'test:new-ls' });
  await assert.rejects(harness.apply(backup(incoming), { selectedCategoryIds: ['test'] }), /LocalStorage write failure/);
  assert.deepEqual(await ids(manager), ['old-font']);
  assert.deepEqual(harness.lf.get('test:old-lf'), { value: 'before-lf' });
  assert.equal(harness.ls.getItem('test:old-ls'), 'before-ls');
});

test('font IndexedDB transaction failure leaves the main stores rolled back', async () => {
  const incoming = await sourceSnapshot([makeRecord('new-font', 8)], 'new-font');
  const manager = makeManager();
  await seed(manager, [makeRecord('old-font', 2)], 'old-font');
  const harness = makeHarness({ manager });
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (record) {
    if (this.name === 'fonts' && record && record.id === 'new-font') throw new Error('injected IndexedDB add failure');
    return originalAdd.apply(this, arguments);
  };
  try {
    await assert.rejects(harness.apply(backup(incoming), { selectedCategoryIds: ['test'] }), /字体库事务写入失败/);
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }
  assert.deepEqual(await ids(manager), ['old-font']);
  assert.deepEqual(harness.lf.get('test:old-lf'), { value: 'before-lf' });
  assert.equal(harness.ls.getItem('test:old-ls'), 'before-ls');
});

test('font readback failure after a successful font commit rolls back all three stores', async () => {
  const incoming = await sourceSnapshot([makeRecord('new-font', 8)], 'new-font');
  const manager = makeManager();
  await seed(manager, [makeRecord('old-font', 2)], 'old-font');
  const originalExport = manager.exportBackupSnapshot.bind(manager);
  let calls = 0;
  manager.exportBackupSnapshot = async () => {
    calls++;
    if (calls === 2) throw new Error('injected font readback failure');
    return originalExport();
  };
  const harness = makeHarness({ manager });
  await assert.rejects(harness.apply(backup(incoming), { selectedCategoryIds: ['test'] }), /font readback failure/);
  assert.deepEqual(await ids(manager), ['old-font']);
  assert.equal((await originalExport()).currentFontId, 'old-font');
  assert.deepEqual(harness.lf.get('test:old-lf'), { value: 'before-lf' });
  assert.equal(harness.ls.getItem('test:old-ls'), 'before-ls');
});

test('a later V99 failure after font commit deletes only new fonts and restores the old current selection', async () => {
  const incoming = await sourceSnapshot([makeRecord('old-font', 2, 'Old label'), makeRecord('new-font', 8)], 'new-font');
  const manager = makeManager();
  await seed(manager, [makeRecord('old-font', 2, 'Old label')], 'old-font');
  const harness = makeHarness({ manager, failCleanup: true });
  await assert.rejects(harness.apply(backup(incoming), { selectedCategoryIds: ['test'] }), /均已回滚到导入前状态/);
  assert.deepEqual(await ids(manager), ['old-font']);
  assert.equal((await manager.exportBackupSnapshot()).currentFontId, 'old-font');
  assert.deepEqual(harness.lf.get('test:old-lf'), { value: 'before-lf' });
  assert.equal(harness.ls.getItem('test:old-ls'), 'before-ls');
});

test('font rollback failure is surfaced and never reported as a full rollback', async () => {
  const incoming = await sourceSnapshot([makeRecord('new-font', 8)], 'new-font');
  const manager = makeManager();
  await seed(manager, [makeRecord('old-font', 2)], 'old-font');
  const originalRollback = manager.rollbackBackupRestore.bind(manager);
  manager.rollbackBackupRestore = async () => { throw new Error('injected font rollback failure'); };
  const harness = makeHarness({ manager, failCleanup: true });
  await assert.rejects(harness.apply(backup(incoming), { selectedCategoryIds: ['test'] }), /字体库回滚失败/);
  assert.deepEqual(harness.lf.get('test:old-lf'), { value: 'before-lf' });
  assert.equal(harness.ls.getItem('test:old-ls'), 'before-ls');
  assert.deepEqual(await ids(manager), ['new-font', 'old-font']);
  manager.rollbackBackupRestore = originalRollback;
});

test('main storage rollback failure is surfaced even when font rollback succeeds', async () => {
  const incoming = await sourceSnapshot([makeRecord('new-font', 8)], 'new-font');
  const manager = makeManager();
  await seed(manager, [makeRecord('old-font', 2)], 'old-font');
  const harness = makeHarness({ manager, failCleanup: true, failMainRollback: true });
  await assert.rejects(harness.apply(backup(incoming), { selectedCategoryIds: ['test'] }), /主存储回滚失败/);
  assert.deepEqual(await ids(manager), ['old-font']);
  assert.deepEqual(harness.lf.get('test:new-lf'), { value: 'after-lf' });
  assert.equal(harness.ls.getItem('test:new-ls'), 'after-ls');
});
