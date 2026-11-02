const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const JSZip = require('jszip');
const { IDBFactory } = require('fake-indexeddb');
const { webcrypto, createHash } = require('node:crypto');
const integritySource = fs.readFileSync(path.join(__dirname, '..', 'font-integrity.js'), 'utf8');
const managerSource = fs.readFileSync(path.join(__dirname, '..', 'custom-font-manager.js'), 'utf8');

const source = fs.readFileSync(path.join(__dirname, '..', 'font-backup-codec.js'), 'utf8');

function loadManager() {
  const document = { readyState: 'loading', addEventListener() {}, documentElement: { classList: { contains() { return false; } } } };
  const indexedDB = new IDBFactory();
  const window = { document, indexedDB, crypto: webcrypto, addEventListener() {} };
  const context = { window, console, Uint8Array, ArrayBuffer, Promise, Error, Math, Date, Blob, setTimeout, clearTimeout };
  vm.runInNewContext(integritySource, context, { filename: 'font-integrity.js' });
  vm.runInNewContext(managerSource, context, { filename: 'custom-font-manager.js' });
  Object.defineProperty(window.ChuanXunFontManager, '__testIndexedDB', { value: indexedDB });
  return window.ChuanXunFontManager;
}
async function seedManager(manager, records, currentFontId) {
  const request = manager.__testIndexedDB.open('chuanxun-local-font-library', 1);
  const db = await new Promise((resolve, reject) => { request.onupgradeneeded = () => { request.result.createObjectStore('fonts', { keyPath: 'id' }); request.result.createObjectStore('meta', { keyPath: 'key' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['fonts', 'meta'], 'readwrite');
    records.forEach(record => tx.objectStore('fonts').put(record));
    tx.objectStore('meta').put({ key: 'currentFontId', value: currentFontId });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
function loadCodec(cryptoObject = webcrypto) {
  const window = { btoa, atob, crypto: cryptoObject };
  const context = { window, Blob, Uint8Array, ArrayBuffer, Promise, Math, Error, String, Number, Object, RegExp };
  vm.runInNewContext(integritySource, context, { filename: 'font-integrity.js' });
  vm.runInNewContext(source, context, { filename: 'font-backup-codec.js' });
  return window.ChuanXunFontBackupCodec;
}
function checksum(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function record(id, format, sig) {
  const bytes = new Uint8Array(24);
  bytes.set(sig);
  for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 17 + format.length) & 255;
  const mimeType = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' }[format];
  return { id, name: id, fileName: id + '.' + format, format, mimeType, size: bytes.length, createdAt: 123, checksum: checksum(bytes), blob: new Blob([bytes], { type: mimeType }) };
}
const snapshot = () => ({
  schema: 'chuanxun-font-library-backup',
  formatVersion: 2,
  currentFontId: 'woff2-id',
  fonts: [
    record('ttf-id', 'ttf', [0, 1, 0, 0]),
    record('otf-id', 'otf', [0x4f, 0x54, 0x54, 0x4f]),
    record('woff-id', 'woff', [0x77, 0x4f, 0x46, 0x46]),
    record('woff2-id', 'woff2', [0x77, 0x4f, 0x46, 0x32])
  ]
});
async function bytes(blob) { return Array.from(new Uint8Array(await blob.arrayBuffer())); }

test('JSON codec preserves all four font binaries and metadata', async () => {
  const codec = loadCodec(), original = snapshot();
  const jsonSafe = await codec.toJsonSnapshot(original);
  assert.ok(jsonSafe.fonts.every(x => typeof x.dataBase64 === 'string' && !('blob' in x)));
  const restored = await codec.fromJsonSnapshot(JSON.parse(JSON.stringify(jsonSafe)));
  assert.equal(restored.currentFontId, original.currentFontId);
  assert.deepEqual(restored.fonts.map(x => x.id), original.fonts.map(x => x.id));
  for (let i = 0; i < original.fonts.length; i++) {
    assert.deepEqual(await bytes(restored.fonts[i].blob), await bytes(original.fonts[i].blob));
  }
});

test('ZIP codec stores independent font files and restores exact binary bytes', async () => {
  const codec = loadCodec(), original = snapshot(), zip = new JSZip();
  const manifest = await codec.toZipSnapshot(original, zip);
  assert.ok(manifest.fonts.every(x => /^fonts\/font-[0-9]{5}\./.test(x.zipPath)));
  assert.ok(manifest.fonts.every(x => !('blob' in x)));
  zip.file('backup.json', JSON.stringify({ fontBackup: manifest }));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'arraybuffer' }));
  const parsed = JSON.parse(await loaded.file('backup.json').async('string'));
  const restored = await codec.fromZipSnapshot(parsed.fontBackup, loaded);
  assert.equal(restored.currentFontId, original.currentFontId);
  for (let i = 0; i < original.fonts.length; i++) {
    assert.deepEqual(await bytes(restored.fonts[i].blob), await bytes(original.fonts[i].blob));
  }
});

test('JSON and ZIP codecs reject damaged bytes and unsafe ZIP paths', async () => {
  const codec = loadCodec(), original = snapshot();
  const jsonSafe = await codec.toJsonSnapshot(original);
  jsonSafe.fonts[0].dataBase64 = Buffer.from('tampered-font-data').toString('base64');
  await assert.rejects(codec.fromJsonSnapshot(jsonSafe), /大小不一致|校验失败/);

  const zip = new JSZip(), manifest = await codec.toZipSnapshot(original, zip);
  manifest.fonts[0].zipPath = 'fonts/../../escape.ttf';
  await assert.rejects(codec.fromZipSnapshot(manifest, zip), /路径不安全/);
});


test('font manager to JSON/ZIP codec to font manager restores four real IndexedDB font records', async () => {
  const codec = loadCodec(), sourceManager = loadManager();
  const records = snapshot().fonts;
  await seedManager(sourceManager, records, 'woff2-id');
  const sourceSnapshot = await sourceManager.exportBackupSnapshot();

  const jsonSnapshot = await codec.toJsonSnapshot(sourceSnapshot);
  const jsonRestored = await codec.fromJsonSnapshot(JSON.parse(JSON.stringify(jsonSnapshot)));
  const jsonTarget = loadManager();
  await jsonTarget.restoreBackupSnapshot(jsonRestored);
  const afterJson = await jsonTarget.exportBackupSnapshot();
  assert.equal(afterJson.currentFontId, 'woff2-id');
  for (let i = 0; i < records.length; i++) {
    const restored = afterJson.fonts.find(x => x.id === records[i].id);
    assert.ok(restored);
    assert.deepEqual(await bytes(restored.blob), await bytes(records[i].blob));
  }

  const zip = new JSZip();
  const zipManifest = await codec.toZipSnapshot(sourceSnapshot, zip);
  const loadedZip = await JSZip.loadAsync(await zip.generateAsync({ type: 'arraybuffer' }));
  const zipRestored = await codec.fromZipSnapshot(zipManifest, loadedZip);
  const zipTarget = loadManager();
  await zipTarget.restoreBackupSnapshot(zipRestored);
  const afterZip = await zipTarget.exportBackupSnapshot();
  assert.equal(afterZip.currentFontId, 'woff2-id');
  for (let i = 0; i < records.length; i++) {
    const restored = afterZip.fonts.find(x => x.id === records[i].id);
    assert.ok(restored);
    assert.deepEqual(await bytes(restored.blob), await bytes(records[i].blob));
  }
});

test('SHA-256 version 2 digest is 64 hex characters and corrupted JSON bytes are rejected', async () => {
  const codec = loadCodec(), original = snapshot();
  const safe = await codec.toJsonSnapshot(original);
  assert.equal(safe.formatVersion, 2);
  assert.ok(safe.fonts.every(x => /^[0-9a-f]{64}$/.test(x.checksum)));
  safe.fonts[0].dataBase64 = safe.fonts[0].dataBase64.slice(0, -4) + 'AAAA';
  await assert.rejects(codec.fromJsonSnapshot(safe), /大小校验失败|二进制校验失败/);
});

test('legacy version 1 FNV snapshots remain readable without reinterpreting their digest', async () => {
  const codec = loadCodec(), original = snapshot();
  original.formatVersion = 1;
  for (const font of original.fonts) {
    const data = new Uint8Array(await font.blob.arrayBuffer());
    font.checksum = (function(bytes) { let h=2166136261; for(const b of bytes){h^=b;h=Math.imul(h,16777619);} return (h>>>0).toString(16).padStart(8,'0'); })(data);
  }
  const safe = await codec.toJsonSnapshot(original);
  assert.ok(safe.fonts.every(x => /^[0-9a-f]{8}$/.test(x.checksum)));
  const restored = await codec.fromJsonSnapshot(JSON.parse(JSON.stringify(safe)));
  assert.equal(restored.formatVersion, 1);
  assert.deepEqual(await bytes(restored.fonts[0].blob), await bytes(original.fonts[0].blob));
});

test('codec blocks version 2 integrity checks when WebCrypto SHA-256 is unavailable', async () => {
  const codec = loadCodec(null);
  await assert.rejects(codec.toJsonSnapshot(snapshot()), /不支持 WebCrypto SHA-256/);
});

test('font count and cumulative binary size limits are enforced before decode', async () => {
  const codec = loadCodec(), base = snapshot();
  await assert.rejects(codec.fromJsonSnapshot({ ...base, fonts: Array.from({length:101},(_,i)=>({...base.fonts[0],id:'x'+i})) }), /数量超过 100/);
  await assert.rejects(codec.fromJsonSnapshot({ ...base, fonts: [ {...base.fonts[0],size: 150*1024*1024}, {...base.fonts[1],id:'second',size: 60*1024*1024} ] }), /总大小超过 200 MB/);
});

test('codec rejects a font whose actual signature conflicts with its declared format', async () => {
  const codec = loadCodec(), bad = snapshot();
  const rec = bad.fonts[0], bytesValue = new Uint8Array(await rec.blob.arrayBuffer());
  bytesValue.set([0x4f,0x54,0x54,0x4f],0);
  rec.blob = new Blob([bytesValue], {type:rec.mimeType});
  rec.checksum = createHash('sha256').update(bytesValue).digest('hex');
  await assert.rejects(codec.toJsonSnapshot(bad), /实际签名与格式声明不一致/);
});
