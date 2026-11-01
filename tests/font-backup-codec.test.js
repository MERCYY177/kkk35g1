const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const JSZip = require('jszip');

const source = fs.readFileSync(path.join(__dirname, '..', 'font-backup-codec.js'), 'utf8');
function loadCodec() {
  const window = { btoa, atob };
  vm.runInNewContext(source, { window, Blob, Uint8Array, ArrayBuffer, Promise, Math, Error, String, Number, Object, RegExp }, { filename: 'font-backup-codec.js' });
  return window.ChuanXunFontBackupCodec;
}
function checksum(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function record(id, format, sig) {
  const bytes = new Uint8Array(24);
  bytes.set(sig);
  for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 17 + format.length) & 255;
  const mimeType = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' }[format];
  return { id, name: id, fileName: id + '.' + format, format, mimeType, size: bytes.length, createdAt: 123, checksum: checksum(bytes), blob: new Blob([bytes], { type: mimeType }) };
}
const snapshot = () => ({
  schema: 'chuanxun-font-library-backup',
  formatVersion: 1,
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
