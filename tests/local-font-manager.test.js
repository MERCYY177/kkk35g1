const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'custom-font-manager.js'), 'utf8');

function loadManager() {
  const listeners = {};
  const document = {
    readyState: 'loading',
    addEventListener(type, callback) { listeners[type] = callback; },
    documentElement: { classList: { contains() { return false; } } }
  };
  const window = { document, addEventListener() {} };
  const context = { window, console, Uint8Array, ArrayBuffer, Promise, Error, Math, Date };
  vm.runInNewContext(source, context, { filename: 'custom-font-manager.js' });
  return window.ChuanXunFontManager;
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
