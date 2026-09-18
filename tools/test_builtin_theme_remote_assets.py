#!/usr/bin/env python3
from pathlib import Path
import re

html = Path('index.html').read_text(encoding='utf-8')
start = html.find('const BUILTIN_KEYBOARD_BEAUTY_STYLES=')
end = html.find('let editingKeyboardBeautyId', start)
if start < 0 or end < 0:
    raise AssertionError('cannot locate built-in keyboard beauty style registry')
region = html[start:end]
forbidden = ('s3.bmp.ovh', 'i.postimg.cc', 'img.heliar.top', 'nos.netease.com')
remote = re.findall(r'https://[^"\\)]+', region)
hits = [u for u in remote if any(domain in u for domain in forbidden)]
if hits:
    unique = sorted(set(hits))
    raise AssertionError(f'built-in themes still depend on {len(hits)} remote image references ({len(unique)} unique): ' + ' | '.join(unique))
if 'data:image/' not in region:
    raise AssertionError('expected localized built-in theme images as data URIs')
print('built-in theme remote asset regression checks passed')
