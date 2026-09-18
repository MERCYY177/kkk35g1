#!/usr/bin/env python3
from pathlib import Path
import subprocess
import tempfile

html = Path('index.html').read_text(encoding='utf-8')


def extract_function(name: str) -> str:
    async_marker = f'async function {name}('
    plain_marker = f'function {name}('
    start = html.find(async_marker)
    if start < 0:
        start = html.find(plain_marker)
    if start < 0:
        raise AssertionError(f'missing function: {name}')
    brace = html.find('{', start)
    if brace < 0:
        raise AssertionError(f'missing function body: {name}')
    depth = 0
    quote = None
    escaped = False
    i = brace
    while i < len(html):
        ch = html[i]
        if quote:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == quote:
                quote = None
        else:
            if ch in "'\"`":
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return html[start:i + 1]
        i += 1
    raise AssertionError(f'unclosed function body: {name}')

select_cards = extract_function('selectCards')
process_due = extract_function('processDue')

node = f"""
const assert = require('assert');

// Real selectCards() from production, with deterministic collaborators.
var state = {{cardCountMin:4, cardCountMax:4, recentCardKeys:[]}};
var DEFAULT_CARD_MIN = 2, DEFAULT_CARD_MAX = 4;
let testPool = [{{text:'甲乙'}}, {{text:'丙丁'}}, {{text:'戊己'}}];
function cardPool() {{ return testPool.map(x => ({{...x}})); }}
function validCardCount(v,d) {{ return Number.isFinite(v) ? v : d; }}
function cardScore() {{ return 0; }}
function randomBetween(min,max) {{ return max; }}
{select_cards}
let picked = selectCards('');
assert.strictEqual(picked.length, 3, 'when 3 cards are available and min=4, use all 3 instead of returning none');
testPool = [];
picked = selectCards('');
assert.deepStrictEqual(picked, [], 'zero available cards should still return an empty selection');

// Real processDue() from production. Empty generated bodies must never become received letters.
var processing = false;
var mailboxInitializedSessionId = 'sid';
var notices = [];
function readySessionId(s) {{ return s; }}
function makeId() {{ return 'generated'; }}
function ensureIncomingPlan() {{ return false; }}
function makeReply() {{ return {{title:'reply', content:'', cardFragments:[]}}; }}
function makeIncoming() {{ return {{title:'incoming', content:'', cardFragments:[]}}; }}
async function save() {{}}
function updateBadges() {{}}
function notifyLetter(letter) {{ notices.push(letter); }}
function el() {{ return {{classList:{{contains(){{return false;}}}}}}; }}
function renderList() {{}}

{process_due}

(async () => {{
  state = {{
    pending:[{{dueAt:0,sourceId:'sent1'}}],
    items:[{{id:'sent1',type:'sent',content:'hello'}}],
    allowIncomingLetters:false,
    nextIncomingAt:0,
    incomingDelayMinMinutes:10,
    incomingDelayMaxMinutes:20
  }};
  notices = [];
  await processDue('sid');
  assert.strictEqual(state.items.filter(x => x.type === 'received').length, 0, 'an empty reply body must not create a received letter');
  assert.strictEqual(notices.length, 0, 'an empty reply body must not emit a mailbox notification');

  processing = false;
  const before = Date.now();
  state = {{
    pending:[],
    items:[],
    allowIncomingLetters:true,
    nextIncomingAt:1,
    incomingDelayMinMinutes:10,
    incomingDelayMaxMinutes:20
  }};
  notices = [];
  await processDue('sid');
  assert.strictEqual(state.items.length, 0, 'an empty proactive body must not create a received letter');
  assert.strictEqual(notices.length, 0, 'an empty proactive body must not emit a mailbox notification');
  assert.ok(state.nextIncomingAt > before, 'after skipping an empty proactive letter, schedule the next attempt instead of retrying immediately');
  console.log('empty-mail regression checks passed');
}})().catch(err => {{ console.error(err); process.exit(1); }});
"""

with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8', delete=False) as f:
    f.write(node)
    js_path = f.name

result = subprocess.run(['node', js_path], text=True, capture_output=True)
if result.stdout:
    print(result.stdout, end='')
if result.stderr:
    print(result.stderr, end='')
if result.returncode != 0:
    raise SystemExit(result.returncode)
