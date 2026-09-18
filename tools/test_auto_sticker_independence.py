#!/usr/bin/env python3
from pathlib import Path
import subprocess
import tempfile

html = Path('index.html').read_text(encoding='utf-8')


def extract_function(name: str) -> str:
    marker = f'function {name}('
    start = html.find(marker)
    if start < 0:
        raise AssertionError(f'missing function: {name}')
    brace = html.find('{', start)
    depth = 0
    quote = None
    escaped = False
    for i in range(brace, len(html)):
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
    raise AssertionError(f'unclosed function body: {name}')

manage = extract_function('manageAutoSendTimer')

node = f"""
const assert = require('assert');
let autoSendTimer = null;
let settings = {{autoSendEnabled:false, autoSendInterval:5, autoStickerEnabled:false, autoStickerChance:25}};
let intervalCallback = null;
let textCount = 0;
let stickerCount = 0;
function clearInterval() {{ intervalCallback = null; }}
function setInterval(cb, ms) {{ intervalCallback = cb; return 123; }}
function simulateReply() {{ textCount++; }}
const document = {{body:{{classList:{{contains:()=>false}}}}}};
const window = {{xiaoshuSendPartnerStickerNow:()=>{{stickerCount++; return true;}}}};
Math.random = () => 0;
{manage}

function run(autoText, autoSticker, chance) {{
  autoSendTimer = null;
  intervalCallback = null;
  textCount = 0;
  stickerCount = 0;
  settings = {{autoSendEnabled:autoText, autoSendInterval:5, autoStickerEnabled:autoSticker, autoStickerChance:chance}};
  manageAutoSendTimer();
  return {{scheduled: typeof intervalCallback === 'function', fire:()=>intervalCallback && intervalCallback(), text:()=>textCount, sticker:()=>stickerCount}};
}}

let s = run(false, false, 100);
assert.strictEqual(s.scheduled, false, 'both proactive channels off must not schedule a timer');

s = run(true, false, 100);
assert.strictEqual(s.scheduled, true, 'text proactive on must schedule a timer');
s.fire();
assert.strictEqual(s.text(), 1, 'text-only mode must send text');
assert.strictEqual(s.sticker(), 0, 'text-only mode must not send a sticker');

s = run(false, true, 100);
assert.strictEqual(s.scheduled, true, 'sticker-only mode must schedule a timer independently of proactive text');
s.fire();
assert.strictEqual(s.sticker(), 1, 'sticker-only mode at 100% must send a sticker');
assert.strictEqual(s.text(), 0, 'sticker-only mode must never fall back to text');

s = run(false, true, 0);
assert.strictEqual(s.scheduled, true, 'sticker-only mode must remain scheduled even at 0% chance');
s.fire();
assert.strictEqual(s.sticker(), 0, '0% sticker chance must not send a sticker');
assert.strictEqual(s.text(), 0, 'failed sticker chance in sticker-only mode must not send text');

s = run(true, true, 100);
assert.strictEqual(s.scheduled, true, 'combined mode must schedule a timer');
s.fire();
assert.strictEqual(s.sticker(), 1, 'combined mode should try sticker first');
assert.strictEqual(s.text(), 0, 'successful sticker send should end that timer round');

assert '(settings.autoSendEnabled || settings.autoStickerEnabled)' in html, 'timer/UI logic must recognize either proactive channel as active'
assert 'autoSendControl.style.display = (settings.autoSendEnabled || settings.autoStickerEnabled) ? "flex" : "none";' in html, 'shared interval control must stay visible when sticker-only mode is enabled'
print('auto sticker independence regression checks passed')
"""

with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8', delete=False) as f:
    f.write(node)
    js_path = f.name

result = subprocess.run(['node', js_path], text=True, capture_output=True)
if result.stdout:
    print(result.stdout, end='')
if result.stderr:
    print(result.stderr, end='')
raise SystemExit(result.returncode)
