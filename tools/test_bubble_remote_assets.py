#!/usr/bin/env python3
from pathlib import Path
import json,re

html=Path('index.html').read_text(encoding='utf-8')
m=re.search(r'<script\b[^>]*id=["\']xiaoshu-builtin-bubble-css-data["\'][^>]*>(.*?)</script>',html,re.I|re.S)
if not m:
    raise AssertionError('ordinary chat built-in bubble data block is missing')
raw=m.group(1)
try:
    data=json.loads(raw)
except Exception as exc:
    raise AssertionError(f'ordinary chat built-in bubble data is invalid JSON: {exc}')

if len(data)!=29:
    raise AssertionError(f'ordinary chat built-in bubble entry count changed: {len(data)} (expected 29)')

forbidden=('s3.bmp.ovh','i.postimg.cc','img.heliar.top','nos.netease.com')
remote_re=re.compile(r'https://(?:s3\.bmp\.ovh|i\.postimg\.cc|img\.heliar\.top|nos\.netease\.com)[^"\\)]+')
hits=remote_re.findall(raw)
if hits:
    raise AssertionError(f'ordinary chat built-in bubble data still contains {len(hits)} third-party image references ({len(set(hits))} unique)')

local_re=re.compile(r'assets/builtin-theme/theme-[0-9a-f]{16}\.(?:png|jpg|jpeg|gif|webp|svg)')
refs=[]
for entry in data:
    for field in ('chatCss','keyboardCss'):
        css=str(entry.get(field) or '')
        refs.extend(local_re.findall(css))
        for ref in local_re.findall(css):
            p=Path(ref)
            if not p.is_file():
                raise AssertionError(f'ordinary chat built-in bubble references missing local asset: {ref}')
            if p.stat().st_size<=0:
                raise AssertionError(f'ordinary chat built-in bubble references empty local asset: {ref}')

if len(refs)<24:
    raise AssertionError(f'expected at least 24 localized ordinary-chat bubble image references, got {len(refs)}')

print(f'ordinary chat bubble asset regression passed: entries={len(data)}, local_refs={len(refs)}, unique_local={len(set(refs))}')
