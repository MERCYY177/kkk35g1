const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const loaderMatch = html.match(/<script id="xiaoshu-chat1-sticker-loader-v1-js">([\s\S]*?)<\/script>/);
assert.ok(loaderMatch, 'chat sticker loader script must exist');
const loaderSource = loaderMatch[1];

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
}
class FakeImage {
  constructor() { this.attrs = new Map(); this.handlers = {}; this.requests = []; this.complete = false; this.naturalWidth = 0; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.has(key) ? this.attrs.get(key) : null; }
  removeAttribute(key) { this.attrs.delete(key); }
  addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
  set src(value) { this._src = value; this.requests.push(value); }
  get src() { return this._src || ''; }
}
class FakeFrame {
  constructor(attrs, img) {
    this.attrs = new Map(Object.entries(attrs)); this.img = img; this.handlers = {}; this.dataset = {};
    this.classList = new FakeClassList(); this.isConnected = true;
  }
  getAttribute(key) { return this.attrs.has(key) ? this.attrs.get(key) : null; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  removeAttribute(key) { this.attrs.delete(key); }
  querySelector(selector) { return selector === 'img' ? this.img : null; }
  addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
  click() { (this.handlers.click || []).forEach((fn) => fn({ preventDefault() {} })); }
}
function setup({ resolve, attrs }) {
  const img = new FakeImage();
  const frame = new FakeFrame(attrs, img);
  const window = {
    xiaoshuStickerStore: { resolve: () => resolve() },
    XiaoshuStickerCore: {
      safeResourceUrl(value) { return /^(?:https?:\/\/|blob:|data:image\/)/i.test(String(value || '').trim()) ? String(value).trim() : ''; },
      withRetryToken(src, attempt) { return `${src}${src.includes('?') ? '&' : '?'}__xs_sticker_retry=${attempt}`; },
    },
    addEventListener() {},
  };
  const document = { querySelectorAll() { return []; } };
  const context = {
    window, document,
    requestAnimationFrame(fn) { fn(); return 1; },
    setTimeout(fn) { return 1; }, clearTimeout() {},
  };
  vm.runInNewContext(loaderSource, context, { filename: 'chat-sticker-loader.js' });
  window.xiaoshuBindChatStickerFrame(frame);
  return { frame, img, window };
}

test('chat sticker rendering prefers the live resource store over stale stickerPreview', () => {
  assert.match(html, /__xsStickerResolvedSrc\s*\|\|\s*msg\.stickerPreview/);
  assert.match(html, /data-sticker-preview="\$\{xsQuoteEscape\(__xsStickerFallbackSrc\)\}"/);
});

test('failed current resource falls back to a different legacy preview source', () => {
  const { frame, img } = setup({
    resolve: () => 'https://cdn.example/new.gif',
    attrs: {
      'data-sticker-id': 'stk_test',
      'data-sticker-src': 'https://cdn.example/new.gif',
      'data-sticker-preview': 'https://cdn.example/legacy.gif',
    },
  });
  assert.equal(img.requests[0], 'https://cdn.example/new.gif');
  img.onerror();
  assert.equal(img.requests[1], 'https://cdn.example/legacy.gif');
  img.naturalWidth = 100;
  img.onload();
  assert.equal(frame.dataset.stickerState, 'loaded');
  assert.equal(img.getAttribute('data-view-src'), 'https://cdn.example/legacy.gif');
});

test('manual retries advance the cache-busting token instead of resetting to one', () => {
  const { frame, img } = setup({
    resolve: () => 'https://cdn.example/fails.gif',
    attrs: { 'data-sticker-id': 'stk_test', 'data-sticker-src': 'https://cdn.example/fails.gif' },
  });
  img.onerror(); // Initial request fails; automatic cache-busted attempt starts.
  assert.match(img.requests.at(-1), /__xs_sticker_retry=1$/);
  img.onerror(); // Automatic cache-busted attempt fails.
  assert.equal(frame.dataset.stickerState, 'load-failed');
  frame.click();
  assert.match(img.requests.at(-1), /__xs_sticker_retry=2$/);
  img.onerror();
  assert.equal(frame.dataset.stickerState, 'load-failed');
  frame.click();
  assert.match(img.requests.at(-1), /__xs_sticker_retry=3$/);
});

test('resource-ready refresh re-resolves even a load-failed frame', () => {
  let current = 'https://cdn.example/old.gif';
  const { frame, img } = setup({
    resolve: () => current,
    attrs: { 'data-sticker-id': 'stk_test', 'data-sticker-src': 'https://cdn.example/old.gif' },
  });
  img.onerror();
  img.onerror();
  assert.equal(frame.dataset.stickerState, 'load-failed');
  const before = img.requests.length;
  current = 'https://cdn.example/new.gif';
  frame.__xsStickerRefresh();
  assert.ok(img.requests.length > before);
  assert.ok(img.requests.at(-1).startsWith('https://cdn.example/new.gif'));
});
