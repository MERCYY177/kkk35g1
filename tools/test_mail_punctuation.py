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
    if brace < 0:
        raise AssertionError(f'missing function body: {name}')
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

random_punctuation = extract_function('randomCardPunctuation')
punctuate = extract_function('punctuate')

node = f"""
const assert = require('assert');
Math.random = () => 0.9;
{random_punctuation}
{punctuate}

assert.strictEqual(punctuate('我不知道...'), '我不知道...', 'ASCII ellipsis must be preserved without appending punctuation');
assert.strictEqual(punctuate('我不知道.'), '我不知道.', 'ASCII period must be preserved without appending punctuation');
assert.strictEqual(punctuate('我不知道……'), '我不知道……', 'Chinese ellipsis must remain preserved');
assert.strictEqual(punctuate('我不知道。'), '我不知道。', 'existing Chinese sentence punctuation must remain preserved');
assert.strictEqual(punctuate('我不知道'), '我不知道。', 'text without terminal punctuation should still receive random punctuation');
assert.strictEqual(punctuate('   '), '', 'blank text should stay blank');
console.log('mail punctuation regression checks passed');
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
