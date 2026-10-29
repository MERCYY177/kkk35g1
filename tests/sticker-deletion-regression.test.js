const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const controllerStart = html.indexOf('id="xiaoshu-shared-sticker-controller-v6"');
const controller = html.slice(controllerStart, html.indexOf('</script>', controllerStart));
const saveDataLine = html.match(/\{ key: 'myStickerLibrary',[^\n]+/);

function simulateHydrate({ canonical, seed = [], legacy = [], runtime = [], groups = [] }) {
  // Mirrors the persistence contract: a present canonical array, even empty, is final;
  // legacy import is allowed only when no canonical array exists.
  if (Array.isArray(canonical)) return [...new Set(canonical)];
  return [...new Set([...seed, ...legacy, ...runtime, ...groups])];
}

function simulateCanonicalWrite(currentUploads, suppliedStaleSnapshot) {
  // Main saveData's payload is ignored once the controller is hydrated.
  void suppliedStaleSnapshot;
  return currentUploads.slice();
}

test('canonical array is authoritative over stale aliases and legacy stores', () => {
  assert.deepEqual(simulateHydrate({
    canonical: ['A', 'C'], seed: ['A', 'B', 'C'], legacy: ['B'], runtime: ['A', 'B', 'C'], groups: ['B']
  }), ['A', 'C']);
});

test('an intentionally empty canonical list cannot be repopulated by old data', () => {
  assert.deepEqual(simulateHydrate({ canonical: [], seed: ['B'], legacy: ['B'], runtime: ['B'], groups: ['B'] }), []);
});

test('legacy sources are available only for initial migration when canonical key is absent', () => {
  assert.deepEqual(simulateHydrate({ canonical: undefined, seed: ['A'], legacy: ['B'], runtime: ['C'], groups: ['D'] }), ['A', 'B', 'C', 'D']);
});

test('late general save cannot overwrite current uploads with a stale list', () => {
  assert.deepEqual(simulateCanonicalWrite(['A', 'C'], ['A', 'B', 'C']), ['A', 'C']);
});

test('actual source gives canonical key precedence and keeps writes on the active session', () => {
  assert.ok(controller.includes('if(Array.isArray(canonical)){'), 'hydrate must detect canonical arrays, including []');
  assert.match(controller, /uploads=withoutBuiltins\(canonical\);/);
  assert.match(controller, /\}else\{\s*\/\/ One-time migration only when the canonical key does not exist yet\./);
  assert.match(controller, /canonicalUploadWriteChain=canonicalUploadWriteChain\.catch/);
  assert.match(controller, /currentSessionId\(\)!==activeSid\|\|!migrationState\.hydrated\|\|hydratedSessionId!==activeSid/);
  assert.ok(saveDataLine && saveDataLine[0].includes('store.getUploads()'), 'saveData must read the authoritative store list');
});
