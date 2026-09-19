#!/usr/bin/env python3
from pathlib import Path
import json,re

html=Path('index.html').read_text(encoding='utf-8')
m=re.search(r'<script\b[^>]*id=["\']xiaoshu-builtin-bubble-css-data["\'][^>]*>(.*?)</script>',html,re.I|re.S)
if not m: raise SystemExit('bubble JSON block missing')
bubbles=json.loads(m.group(1))
km=re.search(r'const BUILTIN_KEYBOARD_BEAUTY_STYLES=(\[.*?\]);\s*let editingKeyboardBeautyId',html,re.S)
if not km: raise SystemExit('keyboard styles array missing')
keyboard=json.loads(km.group(1))

def key(name):
    s=str(name or '').split('/')[-1]
    s=re.sub(r'\.css$','',s,flags=re.I).strip().lower()
    s=re.sub(r'^\d+[\s_\-]*','',s)
    s=re.sub(r'[\s_\-（）()【】\[\]]+','',s)
    return s

bykey={}
for k in keyboard: bykey.setdefault(key(k.get('name')),[]).append(k)
remote_re=re.compile(r'https://(?:s3\.bmp\.ovh|i\.postimg\.cc|img\.heliar\.top|nos\.netease\.com)[^"\\)]+')
local_re=re.compile(r'assets/builtin-theme/theme-[0-9a-f]{16}\.(?:png|jpg|jpeg|gif|webp|svg)')
print('bubble_entries',len(bubbles),'keyboard_entries',len(keyboard))
for b in bubbles:
    fields=[]
    for fld in ('chatCss','keyboardCss'):
        val=str(b.get(fld) or '')
        urls=remote_re.findall(val)
        if urls: fields.append((fld,urls))
    if not fields: continue
    candidates=bykey.get(key(b.get('name')),[])
    print('\nBUBBLE',b.get('id'),b.get('name'),'key=',key(b.get('name')))
    print('FIELDS',[(f,len(u)) for f,u in fields])
    for fld,urls in fields:
        for u in urls: print(' REMOTE',fld,u)
    print('CANDIDATES',len(candidates))
    for c in candidates:
        refs=local_re.findall(str(c.get('css') or ''))
        print(' KEYBOARD',c.get('id'),c.get('name'),'local_refs=',refs)
