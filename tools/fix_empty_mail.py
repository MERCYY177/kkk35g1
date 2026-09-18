#!/usr/bin/env python3
from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "if(!pool.length||pool.length<min)return[];",
        "if(!pool.length)return[];",
        'allow a non-empty pool smaller than the configured minimum',
    ),
    (
        "var reply=makeReply(source),letter={",
        "var reply=makeReply(source);if(!reply.content)return;var letter={",
        'skip an empty automatic reply before creating a received letter',
    ),
    (
        "var fresh=makeIncoming(),incoming={",
        "var fresh=makeIncoming();if(fresh.content){var incoming={",
        'guard proactive incoming letter creation on non-empty content',
    ),
    (
        "state.items.push(incoming);arrived.push(incoming);state.nextIncomingAt=",
        "state.items.push(incoming);arrived.push(incoming)}state.nextIncomingAt=",
        'close proactive content guard while preserving rescheduling',
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('patched empty-mail handling')
