#!/usr/bin/env python3
from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

old = "function punctuate(text){text=String(text||'').trim();if(!text)return'';if(/[。！？!?…]$/.test(text))return text;return text+randomCardPunctuation()}"
new = "function punctuate(text){text=String(text||'').trim();if(!text)return'';if(/[。！？!?….]$/.test(text))return text;return text+randomCardPunctuation()}"

count = text.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one old punctuate(), found {count}')

text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
print('patched mailbox punctuation handling')
