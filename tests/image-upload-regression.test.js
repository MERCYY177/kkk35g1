'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function optimizeImage(file, maxWidth = 800, quality = 0.7, knownFormatInfo = null) {');
const end = html.indexOf('window.updateReplyPreview = function()', start);
assert.ok(start >= 0 && end > start, 'ordinary image optimizer must exist');
const optimizerSource = html.slice(start, end);

function loadOptimizer(options = {}) {
  const state = { readerCalls: 0, canvasCalls: 0, draw: null, revoked: [], created: 0 };
  class FakeFileReader {
    readAsDataURL(file) {
      state.readerCalls++;
      if (options.readerError) {
        this.error = new Error('FileReader blocked');
        queueMicrotask(() => this.onerror && this.onerror());
        return;
      }
      this.result = file.dataUrl || 'data:image/jpeg;base64,ORIGINAL';
      queueMicrotask(() => this.onload && this.onload({ target: { result: this.result } }));
    }
  }
  class FakeImage {
    constructor() {
      this.naturalWidth = options.width == null ? 1600 : options.width;
      this.naturalHeight = options.height == null ? 900 : options.height;
      this.width = this.naturalWidth;
      this.height = this.naturalHeight;
    }
    set src(value) {
      this._src = value;
      queueMicrotask(() => {
        if (options.imageError) this.onerror && this.onerror(new Error('decode failed'));
        else this.onload && this.onload();
      });
    }
    get src() { return this._src; }
  }
  const formatCore = {
    inspectFile(file) {
      const extension = String(file && file.name || '').toLowerCase().split('.').pop();
      const byExtension = { jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', png: 'image/png', apng: 'image/png', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };
      const fallbackMime = byExtension[extension] || String(file && file.type || '');
      const info = file && file.formatInfo;
      if (info) return Promise.resolve(info);
      return Promise.resolve({ mime: fallbackMime, detected: true, isJpeg: fallbackMime === 'image/jpeg' });
    },
    normalizeDataUrl(value, info) {
      value = String(value || '');
      if (info && info.mime && /^data:[^;,]+(?:;[^,]*)?,/i.test(value)) value = value.replace(/^data:[^;,]+/i, 'data:' + info.mime);
      return /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value) ? value : '';
    },
    byteLength(value) {
      const match = String(value || '').match(/^data:[^,]*;base64,([\s\S]*)$/i);
      if (!match) return 0;
      const payload = match[1].replace(/\s/g, '');
      const padding = payload.endsWith('==') ? 2 : (payload.endsWith('=') ? 1 : 0);
      return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
    }
  };
  const context = {
    MAX_IMAGE_SOURCE_SIZE: 20 * 1024 * 1024,
    MAX_IMAGE_SIZE: 5 * 1024 * 1024,
    window: { XiaoshuImageFormat: formatCore },
    XiaoshuImageFormat: formatCore,
    FileReader: FakeFileReader,
    Image: FakeImage,
    URL: {
      createObjectURL() { state.created++; return 'blob:test-' + state.created; },
      revokeObjectURL(value) { state.revoked.push(value); }
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        state.canvasCalls++;
        return {
          width: 0,
          height: 0,
          getContext() {
            if (options.noContext) return null;
            return { drawImage(_image, _x, _y, width, height) { state.draw = { width, height }; } };
          },
          toDataURL() {
            if (options.canvasThrow) throw new Error('canvas export failed');
            return options.canvasResult === undefined ? 'data:image/jpeg;base64,COMPRESSED' : options.canvasResult;
          }
        };
      }
    },
    Promise,
    Number,
    Math,
    String,
    Error,
    console
  };
  vm.createContext(context);
  vm.runInContext(optimizerSource + '\nthis.__optimizer = optimizeImage; this.__prepare = prepareImageForLimit;', context, { filename: 'optimizeImage-extracted.js' });
  return { optimize: context.__optimizer, prepare: context.__prepare, state };
}

function jpegFile(overrides = {}) {
  return Object.assign({
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: 500 * 1024,
    dataUrl: 'data:image/jpeg;base64,ORIGINAL'
  }, overrides);
}

test('large GIF files bypass Canvas and preserve their original animated payload', async () => {
  const { optimize, state } = loadOptimizer();
  const source = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP';
  const result = await optimize(jpegFile({ name: 'animated.gif', type: 'image/gif', dataUrl: source }));
  assert.equal(result, source);
  assert.equal(state.canvasCalls, 0);
  assert.equal(state.readerCalls, 1);
});

test('PNG/APNG and WebP files bypass JPEG conversion to preserve alpha and animation', async () => {
  for (const file of [
    jpegFile({ name: 'alpha.png', type: 'image/png', dataUrl: 'data:image/png;base64,PNG' }),
    jpegFile({ name: 'animated.webp', type: 'image/webp', dataUrl: 'data:image/webp;base64,WEBP' }),
    jpegFile({ name: 'animated.apng', type: 'image/apng', dataUrl: 'data:image/png;base64,APNG' })
  ]) {
    const { optimize, state } = loadOptimizer();
    assert.equal(await optimize(file), file.dataUrl);
    assert.equal(state.canvasCalls, 0);
  }
});

test('protected image extensions override a conflicting JPEG MIME declaration', async () => {
  for (const file of [
    jpegFile({ name: 'mislabeled.gif', type: 'image/jpeg', dataUrl: 'data:image/gif;base64,R0lGODlh' }),
    jpegFile({ name: 'mislabeled.png', type: 'image/jpeg', dataUrl: 'data:image/png;base64,PNG' })
  ]) {
    const { optimize, state } = loadOptimizer();
    assert.equal(await optimize(file), file.dataUrl);
    assert.equal(state.canvasCalls, 0);
  }
});

test('detected GIF bytes override image/jpeg metadata and never enter JPEG Canvas', async () => {
  const { optimize, state } = loadOptimizer();
  const file = jpegFile({
    name: 'mislabeled.jpg',
    type: 'image/jpeg',
    formatInfo: { mime: 'image/gif', detected: true, isJpeg: false },
    dataUrl: 'data:image/jpeg;base64,R0lGODlhAQABAIAAAAAAAP'
  });
  assert.equal(await optimize(file), 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP');
  assert.equal(state.canvasCalls, 0);
});

test('generic FileReader MIME is normalized from a known image extension', async () => {
  const jpg = loadOptimizer();
  const jpgFile = jpegFile({
    name: 'phone.jpg', type: '', size: 10 * 1024,
    dataUrl: 'data:application/octet-stream;base64,/9j/4AAQSkZJRg=='
  });
  assert.equal(await jpg.optimize(jpgFile), 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');

  const gif = loadOptimizer();
  const gifFile = jpegFile({
    name: 'animation.gif', type: 'application/octet-stream', size: 700 * 1024,
    dataUrl: 'data:application/octet-stream;base64,R0lGODlhAQABAIAAAAAAAP'
  });
  assert.equal(await gif.optimize(gifFile), 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP');
  assert.equal(gif.state.canvasCalls, 0);
});

test('large JPEG is resized proportionally and compressed only when Canvas output is valid', async () => {
  const { optimize, state } = loadOptimizer();
  const output = await optimize(jpegFile(), 800, 0.7);
  assert.equal(output, 'data:image/jpeg;base64,COMPRESSED');
  assert.deepEqual(state.draw, { width: 800, height: 450 });
  assert.equal(state.readerCalls, 0);
  assert.equal(state.revoked.length, 1);
});

test('Canvas context failure falls back to the original image instead of hanging', async () => {
  const { optimize, state } = loadOptimizer({ noContext: true });
  const file = jpegFile();
  assert.equal(await optimize(file), file.dataUrl);
  assert.equal(state.readerCalls, 1);
  assert.equal(state.revoked.length, 1);
});

test('invalid Canvas data URL falls back to the original file', async () => {
  const { optimize, state } = loadOptimizer({ canvasResult: 'data:,' });
  const file = jpegFile();
  assert.equal(await optimize(file), file.dataUrl);
  assert.equal(state.readerCalls, 1);
  assert.equal(state.revoked.length, 1);
});

test('Canvas export exception falls back to the original file', async () => {
  const { optimize, state } = loadOptimizer({ canvasThrow: true });
  const file = jpegFile();
  assert.equal(await optimize(file), file.dataUrl);
  assert.equal(state.readerCalls, 1);
  assert.equal(state.revoked.length, 1);
});

test('zero or extreme dimensions never create an oversized Canvas and fall back safely', async () => {
  const zero = loadOptimizer({ width: 0, height: 0 });
  const file = jpegFile();
  assert.equal(await zero.optimize(file), file.dataUrl);
  assert.equal(zero.state.readerCalls, 1);

  const tall = loadOptimizer({ width: 100, height: 100000 });
  assert.equal(await tall.optimize(file, 800, 0.7), 'data:image/jpeg;base64,COMPRESSED');
  assert.ok(tall.state.draw.width <= 8192);
  assert.ok(tall.state.draw.height <= 8192);
  assert.ok(tall.state.draw.width * tall.state.draw.height <= 16000000);
});

test('image decode failure falls back to a readable original file', async () => {
  const { optimize, state } = loadOptimizer({ imageError: true });
  const file = jpegFile();
  assert.equal(await optimize(file), file.dataUrl);
  assert.equal(state.readerCalls, 1);
  assert.equal(state.revoked.length, 1);
});

test('small images bypass Canvas and FileReader errors reject explicitly', async () => {
  const small = loadOptimizer();
  const file = jpegFile({ size: 20 * 1024 });
  assert.equal(await small.optimize(file), file.dataUrl);
  assert.equal(small.state.canvasCalls, 0);

  const failed = loadOptimizer({ readerError: true });
  await assert.rejects(failed.optimize(file), /FileReader blocked/);
});

test('ordinary and batch image send paths handle each file independently and enforce size after optimization', () => {
  assert.match(html, /const imageTasks = imageFiles\.map/);
  assert.match(html, /prepareImageForLimit\(file, 800, 0\.7, MAX_IMAGE_SIZE\)/);
  assert.match(html, /Promise\.all\(imageTasks\)/);
  assert.doesNotMatch(html, /imageFiles\.some\(file => file\.size > MAX_IMAGE_SIZE\)/);
  assert.match(html, /outputBytes > maxOutputBytes/);
  assert.match(html, /原图超过20MB安全上限/);
  assert.match(html, /图片发送\] 第 '\s*\+ \(result\.index \+ 1\) \+ ' 张写入消息失败/);
  const batchAt = html.indexOf("input.addEventListener('change', async (e) => {");
  const batchEnd = html.indexOf('function sendBatchMessages()', batchAt);
  assert.ok(batchAt >= 0 && batchEnd > batchAt);
  const batchBody = html.slice(batchAt, batchEnd);
  assert.match(batchBody, /Promise\.all\(files\.map/);
  assert.match(batchBody, /prepareImageForLimit\(file, 600, 0\.8, MAX_IMAGE_SIZE\)/);
  assert.match(batchBody, /result\.ok/);
  assert.doesNotMatch(batchBody, /files\.some\(file => file\.size > MAX_IMAGE_SIZE\)/);
});

test('JPEGs above the final limit get a chance to compress; non-JPEGs are preserved and preflighted', async () => {
  const jpeg = loadOptimizer();
  const largeJpeg = jpegFile({ size: 6 * 1024 * 1024 });
  const accepted = await jpeg.prepare(largeJpeg, 800, 0.7, 5 * 1024 * 1024);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.image, 'data:image/jpeg;base64,COMPRESSED');
  assert.equal(jpeg.state.canvasCalls, 1);

  const gif = loadOptimizer();
  const largeGif = jpegFile({ name: 'large.gif', type: 'image/gif', size: 6 * 1024 * 1024, dataUrl: 'data:image/gif;base64,R0lGODlh' });
  const rejectedGif = await gif.prepare(largeGif, 800, 0.7, 5 * 1024 * 1024);
  assert.equal(rejectedGif.ok, false);
  assert.equal(rejectedGif.oversize, true);
  assert.equal(gif.state.readerCalls, 0);
  assert.equal(gif.state.canvasCalls, 0);

  const tooLarge = loadOptimizer();
  const rejectedSource = await tooLarge.prepare(jpegFile({ size: 21 * 1024 * 1024 }), 800, 0.7, 5 * 1024 * 1024);
  assert.equal(rejectedSource.sourceOversize, true);
  assert.equal(tooLarge.state.readerCalls, 0);
  assert.equal(tooLarge.state.canvasCalls, 0);
});

test('sticker uploads await persisted data and roll back when persistence fails', () => {
  const startAt = html.indexOf('async function addFiles(files,expectedContext)');
  const endAt = html.indexOf('function openUpload(', startAt);
  assert.ok(startAt >= 0 && endAt > startAt);
  const body = html.slice(startAt, endAt);
  assert.match(body, /var saved=await persistUploads\(owner\)/);
  assert.match(body, /if\(!saved\)/);
  assert.match(body, /uploads=uploads\.filter/);
  assert.match(body, /表情包保存失败，未完成添加/);
  assert.match(body, /syncRuntime\(true,owner\)/);
});

test('sticker upload applies the 2 MiB limit to the optimized payload rather than the source File size', () => {
  const startAt = html.indexOf('  function readFile(file){', html.indexOf('var uploadAddFilesChains'));
  const endAt = html.indexOf('  async function addFiles(files,expectedContext){', startAt);
  assert.ok(startAt >= 0 && endAt > startAt);
  const body = html.slice(startAt, endAt);
  assert.match(body, /if\(\!\(info&&info\.isJpeg\)\&\&sourceBytes>2\*1024\*1024\)/);
  assert.match(body, /if\(sourceBytes>20\*1024\*1024\)/);
  assert.match(body, /optimizeImage\(file,300,0\.8,info\)/);
  assert.match(body, /core\.byteLength\(src\)/);
  assert.match(body, /bytes>2\*1024\*1024/);
});

test('persistUploads verifies the canonical IndexedDB value before clearing its pending flag', () => {
  const startAt = html.indexOf('function persistUploads(expectedContext)');
  const endAt = html.indexOf('var fullPoolPublished=false', startAt);
  assert.ok(startAt >= 0 && endAt > startAt);
  const body = html.slice(startAt, endAt);
  assert.match(body, /localforage\.getItem\(uploadKey\)/);
  assert.match(body, /sameUploadList\(stored,snapshot\)/);
  assert.ok(body.indexOf('sameUploadList(stored,snapshot)') < body.indexOf('pendingUploadPersist=false'));
});
