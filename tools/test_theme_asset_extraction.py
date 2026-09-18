#!/usr/bin/env python3
from pathlib import Path
import re

html_path = Path('index.html')
html = html_path.read_text(encoding='utf-8')
start = html.find('const BUILTIN_KEYBOARD_BEAUTY_STYLES=')
end = html.find('let editingKeyboardBeautyId', start)
if start < 0 or end < 0:
    raise AssertionError('cannot locate built-in keyboard beauty style registry')
region = html[start:end]

forbidden = ('s3.bmp.ovh', 'i.postimg.cc', 'img.heliar.top', 'nos.netease.com')
if any(domain in region for domain in forbidden):
    raise AssertionError('built-in theme registry still contains third-party image hosts')

if 'data:image/' in region:
    raise AssertionError('built-in theme registry still embeds image data URIs inside index.html')

refs = re.findall(r'assets/builtin-theme/theme-[0-9a-f]{16}\.(?:png|jpg|gif|webp|svg)', region)
if len(refs) != 28:
    raise AssertionError(f'expected 28 local built-in theme asset references, got {len(refs)}')
unique_refs = sorted(set(refs))
if len(unique_refs) != 18:
    raise AssertionError(f'expected 18 unique local built-in theme assets, got {len(unique_refs)}')

for ref in unique_refs:
    p = Path(ref)
    if not p.is_file():
        raise AssertionError(f'missing localized built-in theme asset: {ref}')
    if p.stat().st_size <= 0:
        raise AssertionError(f'empty localized built-in theme asset: {ref}')

size = html_path.stat().st_size
if size >= 2_500_000:
    raise AssertionError(f'index.html is still unexpectedly large after extraction: {size} bytes')

print(f'theme asset extraction regression passed: index={size} bytes, refs={len(refs)}, unique={len(unique_refs)}')
