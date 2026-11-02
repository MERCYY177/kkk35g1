'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const activitySource = fs.readFileSync(path.join(__dirname, '..',
  'android-apps/app/src/main/java/com/mercyy/transmission/MainActivity.java'), 'utf8');
const bridgeMatch = activitySource.match(
  /INSTALL_BACKUP_DOWNLOAD_BRIDGE_JS\s*=\s*"""([\s\S]*?)\n\s*""";/
);
assert.ok(bridgeMatch, 'Android native save bridge JavaScript must be present');

function makeHarness(options = {}) {
  const calls = { requests: [], chunks: [], finishes: [], cancellations: [], alerts: [] };
  let resolveFinish;
  let resolveCancel;
  const finishObserved = new Promise(resolve => { resolveFinish = resolve; });
  const cancelObserved = new Promise(resolve => { resolveCancel = resolve; });
  const link = {
    dataset: {},
    textContent: '',
    onclick: null,
    removeAttribute() {},
    getAttribute(name) { return name === 'data-panel-id' ? null : null; },
    closest(selector) {
      if (selector === '#v99-emergency-rescue-panel') {
        return { id: 'v99-emergency-rescue-panel', getAttribute() { return null; } };
      }
      return null;
    }
  };
  const bridge = {
    requestSave(...args) { calls.requests.push(args); },
    writeChunk(requestId, panelId, base64) {
      calls.chunks.push({ requestId, panelId, bytes: Buffer.from(base64, 'base64') });
      return options.failChunk !== true;
    },
    finishSave(requestId, panelId) {
      calls.finishes.push({ requestId, panelId });
      resolveFinish({ requestId, panelId });
      return true;
    },
    cancelSave(requestId, panelId) {
      calls.cancellations.push({ requestId, panelId });
      resolveCancel({ requestId, panelId });
    }
  };
  const window = {
    ChuanXunBackupBridge: bridge,
    xiaoshuOfferBlobDownload() { return 'original-result'; },
    showNotification() {}
  };
  const document = { getElementById(id) { return id === 'xiaoshu-rescue-save-link' ? link : null; } };
  vm.runInNewContext(bridgeMatch[1], {
    window, document, Blob, Date, setTimeout, Number, String, Object, btoa,
    alert(message) { calls.alerts.push(message); }
  }, { filename: 'android-native-save-bridge.js' });
  return { calls, link, window, finishObserved, cancelObserved };
}

async function saveThroughPanel(panelId, bytes) {
  const h = makeHarness();
  const blob = new Blob([Uint8Array.from(bytes)], { type: 'application/json' });
  h.window.xiaoshuOfferBlobDownload(blob, panelId + '.json', { panelId });
  assert.equal(typeof h.link.onclick, 'function');
  h.link.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(h.calls.requests.length, 1);
  const [requestId, actualPanelId, , , expectedBytes] = h.calls.requests[0];
  assert.equal(actualPanelId, panelId);
  assert.equal(expectedBytes, bytes.length);
  h.window.__chuanxunBackupPickerResults[requestId](true, '');
  await h.finishObserved;
  assert.deepEqual(Buffer.concat(h.calls.chunks.map(chunk => chunk.bytes)), Buffer.from(bytes));
  assert.ok(h.calls.chunks.every(chunk => chunk.requestId === requestId && chunk.panelId === panelId));
  assert.deepEqual(h.calls.finishes, [{ requestId, panelId }]);
  assert.equal(h.link.dataset.saving, undefined);
  return h;
}

test('core rescue package uses the native bridge and preserves ordered 32 KiB chunks', async () => {
  const bytes = Array.from({ length: 70013 }, (_, i) => i % 251);
  const h = await saveThroughPanel('core-rescue-panel', bytes);
  assert.deepEqual(h.calls.chunks.map(chunk => chunk.bytes.length), [32768, 32768, 4477]);
});

test('full rescue package uses the same native bridge with its own panel identity', async () => {
  const bytes = Array.from({ length: 65539 }, (_, i) => (i * 7) % 256);
  const h = await saveThroughPanel('full-rescue-panel', bytes);
  assert.deepEqual(h.calls.chunks.map(chunk => chunk.bytes.length), [32768, 32768, 3]);
});

test('rescue panel DOM identity is used when export metadata omits a panel ID', async () => {
  const h = makeHarness();
  h.window.xiaoshuOfferBlobDownload(new Blob(['core']), 'core.json');
  h.link.onclick({ preventDefault() {}, stopPropagation() {} });
  const [requestId, panelId] = h.calls.requests[0];
  assert.equal(panelId, 'v99-emergency-rescue-panel');
  h.window.__chuanxunBackupPickerResults[requestId](true, '');
  await h.finishObserved;
  assert.deepEqual(h.calls.finishes, [{ requestId, panelId }]);
});

test('repeated clicks on one saving link do not start duplicate native requests', () => {
  const h = makeHarness();
  h.window.xiaoshuOfferBlobDownload(new Blob(['backup']), 'backup.json', { panelId: 'panel-a' });
  h.link.onclick({ preventDefault() {}, stopPropagation() {} });
  h.link.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(h.calls.requests.length, 1);
});

test('a failed chunk cancels only the matching request and panel', async () => {
  const h = makeHarness({ failChunk: true });
  h.window.xiaoshuOfferBlobDownload(new Blob(['backup-data']), 'backup.json', { panelId: 'panel-failure' });
  h.link.onclick({ preventDefault() {}, stopPropagation() {} });
  const [requestId, panelId] = h.calls.requests[0];
  h.window.__chuanxunBackupPickerResults[requestId](true, '');
  await h.cancelObserved;
  assert.deepEqual(h.calls.cancellations, [{ requestId, panelId }]);
  assert.equal(h.calls.finishes.length, 0);
  assert.equal(h.link.dataset.saving, undefined);
});
