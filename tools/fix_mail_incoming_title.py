#!/usr/bin/env python3
from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

old = "function makeIncoming(){var n=names(),cards=selectCards(''),body=cardBody(cards);return{title:pick(['今天也想起你','寄给'+n.me+'的一点心情','想和你说几句话','一封没有特别理由的信']),content:body,cardFragments:cards}}"
new = "function makeIncoming(){var cards=selectCards(''),body=cardBody(cards);return{title:'一封来信',content:body,cardFragments:cards}}"

count = text.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one old makeIncoming(), found {count}')

text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
print('patched proactive incoming mail title')
