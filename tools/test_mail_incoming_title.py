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

make_incoming = extract_function('makeIncoming')

node = f"""
const assert = require('assert');
function names(){{return {{me:'小树'}}}}
function selectCards(){{return ['字卡正文']}}
function cardBody(cards){{return cards.join('')}}
function pick(items){{return items[0]}}
{make_incoming}
const letter = makeIncoming();
assert.strictEqual(letter.title, '一封来信', 'proactive incoming mail title must be neutral and must not invent sentiment');
assert.strictEqual(letter.content, '字卡正文', 'changing the title must not alter card-composed body');
assert.deepStrictEqual(letter.cardFragments, ['字卡正文'], 'changing the title must not alter stored card fragments');
console.log('mail incoming title regression checks passed');
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
