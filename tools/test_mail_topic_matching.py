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

card_score = extract_function('cardScore')

node = f"""
const assert = require('assert');
Math.random = () => 0;
var state = {{ recentCardKeys: [] }};
{card_score}

// A generic single-character cross-match must not count as a topic match.
let score = cardScore({{text:'你'}}, '想');
assert.strictEqual(score, 0, 'single characters 想/你 must not trigger the 想念 topic bonus');

// Full words/phrases in the same topic should still receive the topic bonus.
score = cardScore({{text:'我也很想你'}}, '最近一直很想你');
assert.ok(score >= 4, 'full phrase 想你 should receive the 想念 topic bonus');

// Different full words inside the same semantic topic should still connect.
score = cardScore({{text:'其实有一点委屈'}}, '今天真的很难过');
assert.ok(score >= 4, '难过/委屈 should still connect through the 情绪 topic');

console.log('mail topic matching regression checks passed');
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
