#!/usr/bin/env python3
from pathlib import Path
import re

html=Path('index.html').read_text(encoding='utf-8')
domains=('s3.bmp.ovh','i.postimg.cc','img.heliar.top','nos.netease.com')
scripts=[]
for idx,m in enumerate(re.finditer(r'<script\b([^>]*)>(.*?)</script>',html,re.I|re.S),1):
    scripts.append((idx,m.start(),m.end(),m.group(1),m.group(2)))

def script_for(pos):
    for idx,start,end,attrs,body in scripts:
        if start <= pos < end:
            return idx,attrs,body,start
    return None

def nearest_anchor(body,rel):
    left=body[max(0,rel-5000):rel]
    pats=[
        r'(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]{0,120}$',
        r'function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[^{}]{0,3000}$',
        r'window\.([A-Za-z_$][\w$]*)\s*=\s*[^;\n]{0,120}$',
    ]
    candidates=[]
    for pat in pats:
        for m in re.finditer(pat,left,re.S|re.M):
            candidates.append((m.start(),m.group(1),m.group(0)[-260:]))
    if not candidates:
        return '(no nearby assignment/function anchor)'
    _,name,text=max(candidates,key=lambda x:x[0])
    return f'{name}: '+re.sub(r'\s+',' ',text)

for domain in domains:
    print(f'=== {domain} ===')
    pos=0; n=0
    while True:
        i=html.find(domain,pos)
        if i<0: break
        n+=1
        sf=script_for(i)
        if sf:
            idx,attrs,body,start=sf
            tag_end=html.find('>',start)+1
            rel=i-tag_end
            idm=re.search(r'\bid=["\']([^"\']+)',attrs,re.I)
            sid=idm.group(1) if idm else '(no id)'
            anchor=nearest_anchor(body,rel)
            snippet=re.sub(r'\s+',' ',body[max(0,rel-500):min(len(body),rel+500)])
            print(f'#{n} script={idx} id={sid} attrs={attrs.strip()} anchor={anchor}')
            print('SNIP:',snippet[:1000])
        else:
            snippet=re.sub(r'\s+',' ',html[max(0,i-500):i+500])
            print(f'#{n} outside-script SNIP:',snippet[:1000])
        pos=i+len(domain)
    print(f'count={n}')

for term in ('xiaoshu-builtin-bubble-css-data','BUILTIN_KEYBOARD_BEAUTY_STYLES'):
    print(f'=== USAGE {term} ===')
    pos=0; n=0
    while True:
        i=html.find(term,pos)
        if i<0: break
        n+=1
        snippet=re.sub(r'\s+',' ',html[max(0,i-900):min(len(html),i+1300)])
        print(f'#{n}: {snippet[:2200]}')
        pos=i+len(term)
    print(f'count={n}')
