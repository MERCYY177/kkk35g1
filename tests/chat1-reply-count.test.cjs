const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'behavior-core.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'behavior-core.js' });
const core = sandbox.window.XiaoshuBehaviorCore;

assert.ok(core, 'behavior core must be exported');

const fixed = core.buildCardReplyPayloads(
  { randomCardComboEnabled: false, fixedCardReplyCount: 4 },
  ['甲', '乙', '丙', '丁', '戊'],
  () => 0,
);
assert.equal(fixed.length, 4, 'fixed count 4 must create four bubbles');
assert.equal(new Set(fixed.map((item) => item.cardFragments[0])).size, 4);

for (const randomValue of [0, 0.2, 0.74, 0.99]) {
  const combo = core.buildCardReplyPayloads(
    { randomCardComboEnabled: true, randomCardComboMin: 2, randomCardComboMax: 3 },
    ['甲。', '乙！', '丙'],
    () => randomValue,
  );
  assert.equal(combo.length, 1, 'random combination must create one bubble');
  assert.ok(combo[0].cardFragments.length >= 2, 'random combination must never use the legacy single-card result');
  assert.ok(combo[0].cardFragments.length <= 3);
}

assert.equal(
  core.buildCardReplyPayloads(
    { randomCardComboEnabled: false, fixedCardReplyCount: 4 },
    ['', '仅有一张', ' '],
    () => 0,
  ).length,
  1,
  'insufficient cards must not create blank bubbles',
);

const compose = core.buildReplyComposeState({ id: 'letter-1', title: '原信', content: '全文' });
assert.deepEqual(JSON.parse(JSON.stringify(compose)), { replyToId: 'letter-1', subject: '回复 · 原信' });

console.log('chat behavior regression: PASS');
