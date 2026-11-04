 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script id="xiaoshu-image-format-core-v1">([\s\S]*?)<\/script>/);
assert.ok(match, 'shared image format core must be embedded before image upload modules');
const context = { window: {}, Uint8Array, ArrayBuffer, Promise, String, Math, TextEncoder, decodeURIComponent, unescape };
vm.createContext(context);
vm.runInContext(match[1], context, { filename: 'xiaoshu-image-format-core-v1.js' });
const core = context.window.XiaoshuImageFormat;

function bytes(text) { return Uint8Array.from(Array.from(text, c => c.charCodeAt(0))); }
function concat(...parts) { return Uint8Array.from(parts.flatMap(part => Array.from(part))); }

test('detects file signatures instead of trusting a conflicting MIME or extension', () => {
  const gif = core.detectBytes(bytes('GIF89a\x01\x00\x01\x00'), 'wrong.jpg', 'image/jpeg');
  assert.equal(gif.mime, 'image/gif');
  assert.equal(gif.detected, true);
  assert.equal(gif.isJpeg, false);

  const jpeg = core.detectBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'wrong.gif', 'image/gif');
  assert.equal(jpeg.mime, 'image/jpeg');
  assert.equal(jpeg.isJpeg, true);
});

test('recognizes PNG/APNG, WebP, AVIF, BMP, and SVG source formats', () => {
  const pngHeader = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = core.detectBytes(pngHeader, 'sticker.png', '');
  assert.equal(png.mime, 'image/png');
  assert.equal(png.detected, true);

  const apng = core.detectBytes(concat(pngHeader, Uint8Array.from([0,0,0,8]), bytes('acTL'), new Uint8Array(8)), 'animated.png', '');
  assert.equal(apng.mime, 'image/png');
  assert.equal(apng.animated, true);

  const webp = core.detectBytes(concat(bytes('RIFF'), Uint8Array.from([20,0,0,0]), bytes('WEBP'), bytes('ANIM'), Uint8Array.from([0,0,0,0])), 'sticker.webp', '');
  assert.equal(webp.mime, 'image/webp');
  assert.equal(webp.animated, true);

  const avif = core.detectBytes(concat(Uint8Array.from([0,0,0,24]), bytes('ftypavif'), new Uint8Array(8)), 'photo.bin', 'application/octet-stream');
  assert.equal(avif.mime, 'image/avif');
  assert.equal(avif.detected, true);

  assert.equal(core.detectBytes(bytes('BM\x00\x00'), 'photo.bmp', '').mime, 'image/bmp');
  assert.equal(core.detectBytes(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'drawing.bin', '').mime, 'image/svg+xml');
});

test('inspectFile reads a real Blob prefix and overrides incorrect browser MIME metadata', async () => {
  const payload = Buffer.from('GIF89a\x01\x00\x01\x00', 'binary');
  const blob = new Blob([payload], { type: 'image/jpeg' });
  const file = {
    name: 'misleading.jpg',
    type: 'image/jpeg',
    size: blob.size,
    slice(start, end) { return blob.slice(start, end); }
  };
  const info = await core.inspectFile(file);
  assert.equal(info.mime, 'image/gif');
  assert.equal(info.detected, true);
  assert.equal(info.animated, true);
  assert.equal(info.isJpeg, false);
});

test('falls back to FileReader when Blob.arrayBuffer rejects', async () => {
  class FallbackReader {
    readAsArrayBuffer() {
      this.result = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
      queueMicrotask(() => this.onload && this.onload());
    }
  }
  const fallbackContext = { window: { FileReader: FallbackReader }, Uint8Array, ArrayBuffer, Promise, String, Math, TextEncoder, decodeURIComponent, unescape };
  vm.createContext(fallbackContext);
  vm.runInContext(match[1], fallbackContext, { filename: 'xiaoshu-image-format-core-fallback.js' });
  const file = {
    name: 'photo.jpg',
    type: 'application/octet-stream',
    slice() { return { arrayBuffer() { return Promise.reject(new Error('arrayBuffer unavailable')); } }; }
  };
  const info = await fallbackContext.window.XiaoshuImageFormat.inspectFile(file);
  assert.equal(info.mime, 'image/jpeg');
  assert.equal(info.detected, true);
  assert.equal(info.isJpeg, true);
});

test('normalizes a mislabeled data URL to the detected file signature', () => {
  const info = core.detectBytes(bytes('GIF89a\x01\x00\x01\x00'), 'wrong.jpg', 'image/jpeg');
  assert.equal(core.normalizeDataUrl('data:image/jpeg;base64,R0lGODlh', info, { name: 'wrong.jpg', type: 'image/jpeg' }), 'data:image/gif;base64,R0lGODlh');
});

test('background gallery upload derives the stored Data URL MIME from file bytes', () => {
  const start = html.indexOf("const bgInput = document.getElementById('bg-gallery-input');");
  const end = html.indexOf("const autoSendToggle", start);
  assert.ok(start >= 0 && end > start);
  const body = html.slice(start, end);
  assert.match(body, /await formatCore\.inspectFile\(file\)/);
  assert.match(body, /formatCore\.normalizeDataUrl\(event\.target\.result, info, file\)/);
  assert.match(body, /type: info\.mime === 'image\/gif' \? 'gif' : 'image'/);
});

test('counts base64 data URL bytes accurately for post-optimization size checks', () => {
  assert.equal(core.byteLength('data:image/gif;base64,R0lGODlh'), 6);
  assert.equal(core.byteLength('data:image/png;base64,iVBORw0KGgo='), 8);
  assert.equal(core.byteLength('data:image/svg+xml,%3Csvg%3E'), 5);
});


test('shared mail/leaf media compressor preserves GIF bytes without decoding to Canvas', async () => {
  const runtimeMatch = html.match(/<script id="xiaoshu-strict-media-runtime-v1">([\s\S]*?)<\/script>/);
  assert.ok(runtimeMatch, 'strict media runtime must exist');
  const gifData = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP';
  let imageDecodeCalls = 0;
  class FakeFileReader {
    readAsDataURL() { this.result = gifData; queueMicrotask(() => this.onload && this.onload()); }
  }
  class FakeImage { constructor() { imageDecodeCalls++; } }
  const formatCore = {
    inspectFile: async () => ({ mime: 'image/gif', detected: true, isJpeg: false }),
    normalizeDataUrl: value => String(value || '').replace(/^data:[^;,]+/i, 'data:image/gif'),
    byteLength: () => 16
  };
  const mediaCore = {
    MediaError(code, stage, cause, context) { const error = new Error(String(cause && cause.message || cause)); error.code = code; error.stage = stage; error.context = context; return error; },
    classifyMediaError(error) { return error; },
    isDataImage(value) { return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || '')); }
  };
  const context = { window: { XiaoshuImageFormat: formatCore, XiaoshuMediaCore: mediaCore }, FileReader: FakeFileReader, Image: FakeImage, WeakMap, Promise, String, Object, console };
  vm.createContext(context);
  vm.runInContext(runtimeMatch[1], context, { filename: 'strict-media-runtime.js' });
  const result = await context.window.XiaoshuMediaStorage.compressImage({ name: 'animation.gif', type: 'application/octet-stream', size: 2000 }, { kind: 'mail' });
  assert.equal(result, gifData);
  assert.equal(imageDecodeCalls, 0);
});

test('other generic image compressor preserves non-JPEG data and does not create Canvas', async () => {
  const start = html.indexOf('function compressImage(file, max=900, quality=.82, knownFormatInfo=null){');
  const end = html.indexOf('function readFileAsDataURL(file){', start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  const gifData = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP';
  let imageCalls = 0;
  class FakeFileReader { readAsDataURL() { this.result = gifData; queueMicrotask(() => this.onload && this.onload()); } }
  class FakeImage { constructor() { imageCalls++; } }
  const core = {
    inspectFile: async () => ({ mime: 'image/gif', detected: true, isJpeg: false }),
    normalizeDataUrl: value => String(value || '').replace(/^data:[^;,]+/i, 'data:image/gif'),
    byteLength: () => 16
  };
  const context = { window: { XiaoshuImageFormat: core }, FileReader: FakeFileReader, Image: FakeImage, Promise, Number, Math, String, Error };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__compress = compressImage;', context, { filename: 'generic-image-compressor.js' });
  const result = await context.__compress({ name: 'animation.gif', type: 'image/jpeg', size: 1200 });
  assert.equal(result, gifData);
  assert.equal(imageCalls, 0);
});
