'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const integritySource = fs.readFileSync(path.join(root, 'font-integrity.js'), 'utf8');
const managerSource = fs.readFileSync(path.join(root, 'custom-font-manager.js'), 'utf8');
const codecSource = fs.readFileSync(path.join(root, 'font-backup-codec.js'), 'utf8');
const rescueStart = html.indexOf('function rescueTypesOk(data)');
const panelStart = html.indexOf('function rescuePanel(', rescueStart);
const exportStart = html.indexOf('global.xiaoshuEmergencyRescueExport=function(meta)', panelStart);
const chooseStart = html.indexOf('async function chooseCategories(', exportStart);
assert.ok(rescueStart >= 0 && panelStart > rescueStart && exportStart > panelStart && chooseStart > exportStart,
  'V99 emergency rescue production source must be present');
const rescueSource = html.slice(rescueStart, panelStart);
const rescueEntrypoints = html.slice(exportStart, chooseStart);
const restoreStart = html.indexOf('function normalizeV99BackupKey(');
const restoreEnd = html.indexOf('// ---------- 两级灾难抢救', restoreStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart, 'V99 production restore source must be present');
const restoreSource = html.slice(restoreStart, restoreEnd);

function makeFontBytes() {
  const bytes = new Uint8Array(48);
  bytes.set([0, 1, 0, 0], 0);
  bytes.fill(37, 4);
  return bytes;
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
async function seedFont(manager) {
  const db = await openFontDb(manager.__testIndexedDB);
  const bytes = makeFontBytes();
  const record = {
    id: 'rescue-font', name: 'Rescue Font', fileName: 'rescue-font.ttf',
    format: 'ttf', mimeType: 'font/ttf', size: bytes.length,
    blob: new Blob([bytes], { type: 'font/ttf' }), createdAt: 123
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['fonts', 'meta'], 'readwrite');
    tx.objectStore('fonts').put(record);
    tx.objectStore('meta').put({ key: 'currentFontId', value: record.id });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  return bytes;
}
function makeHarness(options = {}) {
  const indexedDB = new IDBFactory();
  const document = { readyState: 'loading', addEventListener() {}, documentElement: { classList: { contains() { return false; } } } };
  const window = { document, indexedDB, crypto: webcrypto, btoa, atob, addEventListener() {} };
  const base = { window, console, Uint8Array, ArrayBuffer, Promise, Error, Math, Date, Blob, TextEncoder,
    setTimeout, clearTimeout, btoa, atob };
  vm.runInNewContext(integritySource, base, { filename: 'font-integrity.js' });
  vm.runInNewContext(codecSource, base, { filename: 'font-backup-codec.js' });
  vm.runInNewContext(managerSource, base, { filename: 'custom-font-manager.js' });
  const manager = window.ChuanXunFontManager;
  Object.defineProperty(manager, '__testIndexedDB', { value: indexedDB });

  const lfData = new Map([['CHAT_APP_V3_s1_chatMessages', [{ id: 'live-message' }]]]);
  const localforage = {
    async keys() { if (options.keysFailure) throw new Error('injected IndexedDB unavailable'); return Array.from(lfData.keys()); },
    async getItem(key) { if (options.readFailure) throw new Error('injected IndexedDB read failure'); return lfData.get(key); }
  };
  const lsData = new Map([['CHAT_APP_V3_profile', '{"live":true}']]);
  const localStorage = {
    get length() { return lsData.size; },
    key(i) { return Array.from(lsData.keys())[i] ?? null; },
    getItem(k) { return lsData.get(String(k)) ?? null; }
  };
  const captured = { full: null, errors: null };
  const sandbox = {
    window, console, Blob, Promise, Error, String, Number, Object, Array, Math, Date, Uint8Array,
    setTimeout, clearTimeout, btoa, atob, TextEncoder,
    V99: { backupTimeout: options.timeoutMs || 1000 },
    localforage, localStorage,
    clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); },
    timeoutPromise(promise, ms, label) {
      let timer;
      return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + '超时')), ms);
      })]).finally(() => clearTimeout(timer));
    },
    errText(error) { return error && error.message ? error.message : String(error); },
    currentPrefix() { return 'CHAT_APP_V3_'; },
    currentSid() { return 's1'; },
    nowStamp() { return 'test-stamp'; },
    humanBytes(n) { return String(n) + ' B'; },
    captureMain() { return { appPrefix: 'CHAT_APP_V3_', sessionId: 's1', sessionList: [{ id: 's1' }], messages: [{ id: 'live' }] }; },
    captureFrames() { return { moments: {}, chat2: {}, interaction: {}, interactionMedia: {} }; },
    captureModuleMemory() { return { mailMedia: {}, stickerMessageResources: {}, beautify: {}, callRecords: [] }; },
    captureCriticalLocalStorage() { return { CHAT_APP_V3_profile: '{"live":true}' }; },
    captureSessionStorage() { return {}; },
    ensureRegistryForKeys() {},
    ChatBackup: {
      getActiveCategories() { return [{ id: 'chat', label: '聊天' }]; },
      async preflightBackup(data) {
        try {
          if (data.fontBackup) await manager.validateBackupSnapshot(data.fontBackup);
          return { ok: true, data, availableCategoryIds: ['chat'], errors: [], warnings: [] };
        } catch (error) {
          return { ok: false, data, availableCategoryIds: ['chat'], errors: [error.message], warnings: [] };
        }
      }
    },
    confirm() { return true; },
    alert() {},
    chooseCategories: async () => ['chat'],
    rescuePanel() {
      return { addFull(blob, name, text, errors, complete) {
        captured.full = { blob, name, text, errors, complete };
      }, fullError(error) { captured.panelError = String(error); } };
    },
    global: null
  };
  sandbox.global = sandbox;
  sandbox.ChuanXunFontManager = manager;
  sandbox.ChuanXunFontBackupCodec = window.ChuanXunFontBackupCodec;
  sandbox.window.ChuanXunFontManager = manager;
  sandbox.window.ChuanXunFontBackupCodec = window.ChuanXunFontBackupCodec;
  if (options.fontExport) manager.exportBackupSnapshot = options.fontExport;
  vm.runInNewContext(rescueSource, sandbox, { filename: 'V99-emergency-rescue-production.js' });
  vm.runInNewContext(rescueEntrypoints, sandbox, { filename: 'V99-emergency-rescue-entrypoints.js' });
  return { sandbox, manager, captured, lfData, localStorage, window };
}

test('core rescue package is immediate and explicitly never claims font or full-backup completeness', async () => {
  const h = makeHarness();
  let fontReads = 0;
  h.manager.exportBackupSnapshot = async () => { fontReads++; throw new Error('core must not read fonts'); };
  const result = h.sandbox.rescueCorePayload({ reason: 'test' });
  assert.equal(result.stage, 'core');
  assert.equal(result.fontBackupComplete, false);
  assert.equal(result.complete, false);
  assert.equal(result.isFullBackup, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'fontBackup'), false);
  assert.equal(fontReads, 0);
});

test('successful emergency export produces a validated full extension with Base64 font bytes', async () => {
  const h = makeHarness();
  const expectedBytes = await seedFont(h.manager);
  const result = await h.sandbox.xiaoshuEmergencyRescueExport({ reason: 'test-success' });
  assert.equal(result.ok, true);
  const extended = await result.extendedPromise;
  if (!extended.ok) console.error('[V99 emergency export diagnostic]', JSON.stringify({ errors: extended.errors || [], payload: extended.payload || null, panelError: h.captured.panelError || null }));
  assert.equal(extended.ok, true);
  assert.equal(extended.payload.stage, 'full');
  assert.equal(extended.payload.complete, true);
  assert.equal(extended.payload.isFullBackup, true);
  assert.equal(extended.payload.fontBackupComplete, true);
  assert.equal(extended.payload.fontBackupStatus, 'included-and-validated');
  assert.equal(typeof extended.payload.fontBackup.fonts[0].dataBase64, 'string');
  assert.ok(h.captured.full && h.captured.full.text, 'the generated extension JSON must be captured by the production panel callback');
  const parsed = JSON.parse(h.captured.full.text.replace(/^\uFEFF/, ''));
  const legacy = await h.sandbox.buildRescueLegacyV99(parsed);
  assert.equal(legacy.fontBackup.fonts[0].blob.size, expectedBytes.length);
  assert.deepEqual(Array.from(new Uint8Array(await legacy.fontBackup.fonts[0].blob.arrayBuffer())), Array.from(expectedBytes));
  const db = await openFontDb(h.manager.__testIndexedDB);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['fonts', 'meta'], 'readwrite');
    tx.objectStore('fonts').clear();
    tx.objectStore('meta').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  const initialLf = new Map([['CHAT_APP_V3_s1_chatMessages', [{ id: 'old-message' }]]]);
  const initialLs = new Map([['CHAT_APP_V3_profile', '{"old":true}']]);
  const localforage = {
    async keys() { return Array.from(initialLf.keys()); },
    async getItem(key) { return initialLf.has(key) ? initialLf.get(key) : null; },
    async setItem(key, value) { initialLf.set(key, value); return value; },
    async removeItem(key) { initialLf.delete(key); }
  };
  const localStorage = {
    get length() { return initialLs.size; },
    key(i) { return Array.from(initialLs.keys())[i] ?? null; },
    getItem(key) { return initialLs.has(String(key)) ? initialLs.get(String(key)) : null; },
    setItem(key, value) { initialLs.set(String(key), String(value)); },
    removeItem(key) { initialLs.delete(String(key)); }
  };
  const restoreSandbox = {
    ChatBackup: {
      classifyKey() { return 'chat'; },
      inlineMediaTree(value) { return value; },
      async preflightBackup(data) {
        try {
          if (data.fontBackup) await h.manager.validateBackupSnapshot(data.fontBackup);
          return { ok: true, data, availableCategoryIds: ['chat'], errors: [], warnings: [] };
        } catch (error) {
          return { ok: false, data, availableCategoryIds: ['chat'], errors: [error.message], warnings: [] };
        }
      }
    },
    localforage, localStorage, V99: { readTimeout: 1000, writeTimeout: 1000 },
    ChuanXunFontManager: h.manager, global: null,
    currentPrefix() { return 'CHAT_APP_V3_'; }, currentSid() { return 's1'; },
    ensureRegistryForData() {}, own: (o, k) => Object.prototype.hasOwnProperty.call(o, k),
    clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); },
    checksum(value) { return JSON.stringify(value); },
    timeoutPromise(promise, ms, label) {
      let timer;
      return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + '超时')), ms);
      })]).finally(() => clearTimeout(timer));
    },
    errText(error) { return error && error.message ? error.message : String(error); },
    setTimeout, clearTimeout, Promise, Error, String, Number, Object, Array, Math, Date, console
  };
  restoreSandbox.global = restoreSandbox;
  vm.runInNewContext(restoreSource, restoreSandbox, { filename: 'V99-production-restore.js' });
  const preflight = await restoreSandbox.ChatBackup.preflightBackup(legacy);
  assert.equal(preflight.ok, true);
  const report = await restoreSandbox.ChatBackup.applyBackupToStorage(legacy, {
    preflight, selectedCategoryIds: ['chat'], restoreFonts: true
  });
  assert.equal(report.ok, true);
  assert.deepEqual(initialLf.get('CHAT_APP_V3_s1_chatMessages'), [{ id: 'live' }]);
  assert.deepEqual(initialLf.get('CHAT_APP_V3_sessionList'), [{ id: 's1' }]);
  assert.equal(initialLs.get('CHAT_APP_V3_profile'), '{"live":true}');
  const readback = await h.manager.exportBackupSnapshot();
  assert.equal(readback.currentFontId, 'rescue-font');
  assert.equal(readback.fonts.some(font => font.id === 'rescue-font'), true);
});

test('unavailable font database creates a partial extension, never a full package', async () => {
  const h = makeHarness({ fontExport: async () => { throw new Error('injected font database unavailable'); } });
  const result = await h.sandbox.xiaoshuEmergencyRescueExport({ reason: 'font-db-unavailable' });
  const extended = await result.extendedPromise;
  assert.equal(extended.ok, false);
  assert.equal(extended.payload.stage, 'partial');
  assert.equal(extended.payload.complete, false);
  assert.equal(extended.payload.isFullBackup, false);
  assert.equal(extended.payload.fontBackup, null);
  assert.equal(extended.payload.fontBackupComplete, false);
  assert.equal(extended.payload.fontBackupStatus, 'failed-or-unavailable');
  assert.match(extended.errors.join(' '), /injected font database unavailable/);
});

test('font snapshot timeout creates a partial extension and preserves the core package', async () => {
  const h = makeHarness({ timeoutMs: 15, fontExport: () => new Promise(() => {}) });
  const result = await h.sandbox.xiaoshuEmergencyRescueExport({ reason: 'font-timeout' });
  assert.equal(result.ok, true);
  assert.equal(result.payload.stage, 'core');
  const extended = await result.extendedPromise;
  assert.equal(extended.ok, false);
  assert.equal(extended.payload.stage, 'partial');
  assert.equal(extended.payload.complete, false);
  assert.equal(extended.payload.fontBackupComplete, false);
  assert.match(extended.errors.join(' '), /超时/);
});

test('IndexedDB read failure is recorded and prevents full completeness', async () => {
  const h = makeHarness({ readFailure: true });
  await seedFont(h.manager);
  const result = await h.sandbox.xiaoshuEmergencyRescueExport({ reason: 'storage-read-failure' });
  const extended = await result.extendedPromise;
  assert.equal(extended.ok, false);
  assert.equal(extended.payload.stage, 'partial');
  assert.equal(extended.payload.complete, false);
  assert.ok(extended.errors.some(error => /injected IndexedDB read failure/.test(error)));
});


test('corrupt font bytes or checksum prevent the extension from being marked complete', async () => {
  const h = makeHarness();
  await seedFont(h.manager);
  const invalid = await h.manager.exportBackupSnapshot();
  invalid.fonts[0].checksum = '0'.repeat(64);
  h.manager.exportBackupSnapshot = async () => invalid;
  const result = await h.sandbox.xiaoshuEmergencyRescueExport({ reason: 'corrupt-font-snapshot' });
  const extended = await result.extendedPromise;
  assert.equal(extended.ok, false);
  assert.equal(extended.payload.stage, 'partial');
  assert.equal(extended.payload.complete, false);
  assert.equal(extended.payload.fontBackup, null);
  assert.equal(extended.payload.fontBackupComplete, false);
  assert.ok(extended.errors.some(error => /校验失败|校验值/.test(error)));
});

test('legacy emergency package without fontBackup remains importable without a font restore', async () => {
  const h = makeHarness();
  const legacy = await h.sandbox.buildRescueLegacyV99({
    type: 'xiaoshu-emergency-rescue-v1', stage: 'core', appPrefix: 'CHAT_APP_V3_',
    mainMemory: { sessionId: 's1', appPrefix: 'CHAT_APP_V3_', sessionList: [{ id: 's1' }], messages: [{ id: 'legacy' }] },
    rawStorage: { localforage: {}, localStorage: {}, sessionStorage: {} },
    frameMemory: {}, moduleMemory: {}
  });
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'fontBackup'), false);
  assert.equal(legacy.sessionId, 's1');
});
