const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');

const source = fs.readFileSync(path.join(__dirname, '..', 'custom-font-manager.js'), 'utf8');

function loadManager() {
  const listeners = {};
  const document = {
    readyState: 'loading',
    addEventListener(type, callback) { listeners[type] = callback; },
    documentElement: { classList: { contains() { return false; } } }
  };
  const indexedDB = new IDBFactory();
  const window = { document, indexedDB, addEventListener() {} };
  const context = { window, console, Uint8Array, ArrayBuffer, Promise, Error, Math, Date, Blob, setTimeout, clearTimeout };
  vm.runInNewContext(source, context, { filename: 'custom-font-manager.js' });
  const manager = window.ChuanXunFontManager;
  Object.defineProperty(manager, '__testIndexedDB', { value: indexedDB, enumerable: false });
  return manager;
}

function signature(text) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 4; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

test('detects TTF, OTF, WOFF and WOFF2 from file signatures', () => {
  const manager = loadManager();
  assert.equal(manager._detectFormat(signature('\x00\x01\x00\x00'), 'font.ttf'), 'ttf');
  assert.equal(manager._detectFormat(signature('OTTO'), 'font.otf'), 'otf');
  assert.equal(manager._detectFormat(signature('wOFF'), 'font.woff'), 'woff');
  assert.equal(manager._detectFormat(signature('wOF2'), 'font.woff2'), 'woff2');
});

test('rejects extension/signature mismatches and unsupported suffixes', () => {
  const manager = loadManager();
  assert.throws(() => manager._detectFormat(signature('OTTO'), 'font.ttf'), /扩展名与字体实际格式不一致/);
  assert.throws(() => manager._detectFormat(signature('OTTO'), 'font.pfm'), /不支持/);
});

test('rejects corrupted or truncated font bytes', () => {
  const manager = loadManager();
  assert.throws(() => manager._detectFormat(signature('NOPE'), 'broken.ttf'), /无法识别字体文件内容/);
  assert.throws(() => manager._detectFormat(new ArrayBuffer(4), 'short.ttf'), /过短/);
});

test('font manager source uses IndexedDB Blobs and independent document FontFace registration', () => {
  assert.match(source, /indexedDB\.open\(DB_NAME, DB_VERSION\)/);
  assert.match(source, /blob:\s*blob/);
  assert.match(source, /new global\.FontFace\(family/);
  assert.match(source, /global\.document\.fonts\.add\(loaded\.face\)/);
  assert.match(source, /BroadcastChannel/);
});

test('font UI accepts all four requested local file types', () => {
  assert.match(source, /\.ttf,\.otf,\.woff,\.woff2/);
  assert.match(source, /font\/woff2/);
});


function openFontDb(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('chuanxun-local-font-library', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('fonts', { keyPath: 'id' });
      request.result.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function seedFonts(indexedDB, records, currentFontId) {
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

function makeFontRecord(id, format, signatureText) {
  const bytes = new Uint8Array(32);
  if (format === 'ttf') { bytes.set([0, 1, 0, 0], 0); }
  else { for (let i = 0; i < 4; i++) bytes[i] = signatureText.charCodeAt(i); }
  const mime = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' }[format];
  return {
    id,
    name: id,
    fileName: id + '.' + format,
    format,
    mimeType: mime,
    size: bytes.length,
    blob: new Blob([bytes], { type: mime }),
    createdAt: 123456
  };
}

test('exports and restores all four font formats with exact binary data and current selection', async () => {
  const sourceContext = loadManager();
  const targetContext = loadManager();
  const records = [
    makeFontRecord('font-ttf', 'ttf'),
    makeFontRecord('font-otf', 'otf', 'OTTO'),
    makeFontRecord('font-woff', 'woff', 'wOFF'),
    makeFontRecord('font-woff2', 'woff2', 'wOF2')
  ];
  await seedFonts(sourceContext.__testIndexedDB, records, 'font-woff2');
  const snapshot = await sourceContext.exportBackupSnapshot();
  assert.equal(snapshot.fonts.length, 4);
  assert.equal(snapshot.currentFontId, 'font-woff2');
  const restored = await targetContext.restoreBackupSnapshot(snapshot);
  assert.equal(restored.added, 4);
  assert.equal(restored.skipped, 0);
  const targetSnapshot = await targetContext.exportBackupSnapshot();
  assert.equal(targetSnapshot.currentFontId, 'font-woff2');
  assert.deepEqual(targetSnapshot.fonts.map(x => x.id).sort(), ['font-otf', 'font-ttf', 'font-woff', 'font-woff2']);
  for (const expected of snapshot.fonts) {
    const actual = targetSnapshot.fonts.find(x => x.id === expected.id);
    assert.equal(actual.checksum, expected.checksum);
    assert.deepEqual(
      Array.from(new Uint8Array(await actual.blob.arrayBuffer())),
      Array.from(new Uint8Array(await expected.blob.arrayBuffer()))
    );
  }
});

test('font restore is idempotent and refuses to overwrite a conflicting existing ID', async () => {
  const sourceContext = loadManager();
  const targetContext = loadManager();
  const incoming = makeFontRecord('font-shared', 'ttf');
  await seedFonts(sourceContext.__testIndexedDB, [incoming], 'font-shared');
  const snapshot = await sourceContext.exportBackupSnapshot();
  assert.equal((await targetContext.restoreBackupSnapshot(snapshot)).added, 1);
  const second = await targetContext.restoreBackupSnapshot(snapshot);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 1);

  const conflictContext = loadManager();
  const conflict = makeFontRecord('font-shared', 'ttf');
  const conflictingBytes = new Uint8Array(32).fill(9);
  conflictingBytes.set([0, 1, 0, 0], 0);
  conflict.blob = new Blob([conflictingBytes], { type: 'font/ttf' });
  await seedFonts(conflictContext.__testIndexedDB, [conflict], 'font-shared');
  await assert.rejects(
    conflictContext.restoreBackupSnapshot(snapshot),
    /ID 冲突，拒绝覆盖/
  );
  const after = await conflictContext.exportBackupSnapshot();
  assert.equal(after.fonts.length, 1);
  assert.notEqual(after.fonts[0].checksum, snapshot.fonts[0].checksum);
});

test('font rollback removes only this restore operation additions and restores previous selection', async () => {
  const sourceContext = loadManager();
  const targetContext = loadManager();
  const oldRecord = makeFontRecord('font-old', 'ttf');
  await seedFonts(sourceContext.__testIndexedDB, [oldRecord, makeFontRecord('font-new', 'otf', 'OTTO')], 'font-new');
  await seedFonts(targetContext.__testIndexedDB, [oldRecord], 'font-old');
  const before = await targetContext.exportBackupSnapshot();
  const incoming = await sourceContext.exportBackupSnapshot();
  const restored = await targetContext.restoreBackupSnapshot(incoming);
  assert.deepEqual(Array.from(restored.addedIds), ['font-new']);
  await targetContext.rollbackBackupRestore(before, restored.addedIds);
  await assert.rejects(targetContext.rollbackBackupRestore(before, ['font-old']), /拒绝回滚删除恢复前已存在的字体/);
  const after = await targetContext.exportBackupSnapshot();
  assert.deepEqual(after.fonts.map(x => x.id), ['font-old']);
  assert.equal(after.currentFontId, 'font-old');
});


test('a synchronous IndexedDB add failure aborts the entire font restore transaction', async () => {
  const sourceContext = loadManager();
  const targetContext = loadManager();
  const records = [
    makeFontRecord('font-ttf', 'ttf'),
    makeFontRecord('font-otf', 'otf', 'OTTO'),
    makeFontRecord('font-woff', 'woff', 'wOFF'),
    makeFontRecord('font-woff2', 'woff2', 'wOF2')
  ];
  await seedFonts(sourceContext.__testIndexedDB, records, 'font-woff2');
  const snapshot = await sourceContext.exportBackupSnapshot();
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (record) {
    if (this.name === 'fonts' && record && record.id === 'font-woff') throw new Error('injected synchronous add failure');
    return originalAdd.apply(this, arguments);
  };
  try {
    await assert.rejects(targetContext.restoreBackupSnapshot(snapshot), /字体库事务写入失败/);
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }
  const after = await targetContext.exportBackupSnapshot();
  assert.equal(after.fonts.length, 0);
  assert.equal(after.currentFontId, null);
});

test('font snapshot validation rejects duplicate IDs, invalid formats and damaged bytes', async () => {
  const context = loadManager();
  const record = makeFontRecord('font-one', 'ttf');
  await seedFonts(context.__testIndexedDB, [record], 'font-one');
  const good = await context.exportBackupSnapshot();
  assert.equal((await context.validateBackupSnapshot(good)).fonts.length, 1);
  await assert.rejects(
    context.validateBackupSnapshot({ ...good, fonts: [record, record] }),
    /重复字体 ID/
  );
  await assert.rejects(
    context.validateBackupSnapshot({ ...good, fonts: [{ ...record, format: 'woff' }] }),
    /格式声明与文件内容不一致/
  );
  await assert.rejects(
    context.validateBackupSnapshot({ ...good, fonts: [{ ...record, size: 99 }] }),
    /文件大小与记录不一致/
  );
});
