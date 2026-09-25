const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sticker-core.js'), 'utf8');
const sandbox = { window: {}, URL, setTimeout, clearTimeout };
vm.runInNewContext(source, sandbox, { filename: 'sticker-core.js' });
const core = sandbox.window.XiaoshuStickerCore;
assert.ok(core, 'sticker core must be exported');

assert.equal(core.safeResourceUrl('assets/stickers/embedded/embedded_001.gif', 'image'), 'assets/stickers/embedded/embedded_001.gif');
for (const unsafe of [
  'assets/stickers/../secret.gif',
  'assets/stickers/embedded\\evil.gif',
  'assets/stickers/embedded/%2e%2e/evil.gif',
  'assets/stickers/embedded/a\u0000.gif',
  'javascript:alert(1)',
]) assert.equal(core.safeResourceUrl(unsafe, 'image'), '', `must reject ${JSON.stringify(unsafe)}`);

assert.equal(
  core.withRetryToken('assets/stickers/a.gif?size=large#preview', 7),
  'assets/stickers/a.gif?size=large&__xs_sticker_retry=7#preview',
  'retry token must preserve query and hash',
);
assert.equal(core.requestUrl('assets/stickers/a.gif', 0, false), 'assets/stickers/a.gif', 'first load must use the original cacheable URL');
assert.equal(core.requestUrl('assets/stickers/a.gif', 1, true), 'assets/stickers/a.gif?__xs_sticker_retry=1');

const scheduled = [];
const states = [];
const machine = core.createLoadMachine({
  resolve: () => 'assets/stickers/phone_098.gif',
  request: (url, handlers) => { scheduled.push({ url, handlers }); },
  schedule: (fn, ms) => ({ fn, ms }),
  cancel: () => {},
  onState: (state) => states.push(state),
  timeoutMs: 20000,
});
machine.start('stk_large');
assert.equal(machine.state(), 'loading');
assert.equal(scheduled.length, 1);
assert.equal(scheduled[0].url, 'assets/stickers/phone_098.gif');
machine.start('stk_large');
assert.equal(scheduled.length, 1, 'a loading sticker must not create a duplicate request');
assert.notEqual(machine.state(), 'load-failed', 'a load lasting beyond 1200ms is still loading');
scheduled[0].handlers.load();
assert.equal(machine.state(), 'loaded');

let source = '';
const pendingSchedules = [];
const pending = core.createLoadMachine({
  resolve: () => source,
  request: () => { throw new Error('must not request without a resource'); },
  schedule: (fn, ms) => { const task = { fn, ms }; pendingSchedules.push(task); return task; },
  cancel: () => {},
  onState: () => {},
  maxResolveAttempts: 2,
  resolveDelayMs: 10,
});
pending.start('stk_missing');
assert.equal(pending.state(), 'pending-resource');
pendingSchedules.shift().fn();
pendingSchedules.shift().fn();
assert.equal(pending.state(), 'resource-missing', 'missing resources must reach a terminal recoverable state');
source = 'assets/stickers/embedded/embedded_001.gif';
let retriedUrl = '';
const retryable = core.createLoadMachine({
  resolve: () => source,
  request: (url, handlers) => { retriedUrl = url; retryable.handlers = handlers; },
  schedule: (fn) => ({ fn }), cancel: () => {}, onState: () => {},
});
retryable.start('stk_missing');
retryable.handlers.error();
assert.equal(retryable.state(), 'load-failed');
retryable.retry();
assert.match(retriedUrl, /__xs_sticker_retry=1/);
retryable.handlers.load();
assert.equal(retryable.state(), 'loaded', 'explicit retry can recover from a real error');

const catalog = ['assets/stickers/embedded/embedded_001.gif', 'assets/stickers/phone_098.gif'];
const id = core.stickerId(catalog[0]);
const repaired = core.rebuildResourceMap([{ stickerId: id, messageKind: 'sticker' }], {}, catalog);
assert.equal(repaired.map[id], catalog[0]);
assert.equal(repaired.missing.length, 0);
const broken = core.rebuildResourceMap([{ stickerId: 'stk_unknown', messageKind: 'sticker' }], {}, catalog);
assert.equal(broken.missing[0], 'stk_unknown');

const largeGif = path.join(__dirname, '..', 'assets', 'stickers', 'phone_098.gif');
assert.ok(fs.statSync(largeGif).size >= 2 * 1024 * 1024, 'fixture must be a real 2-5MB+ GIF');
assert.equal(fs.readFileSync(largeGif, { encoding: null }).subarray(0, 3).toString('ascii'), 'GIF');

console.log('sticker core regression: PASS');
