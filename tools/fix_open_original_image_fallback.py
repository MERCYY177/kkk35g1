#!/usr/bin/env python3
from pathlib import Path

path=Path('index.html')
html=path.read_text(encoding='utf-8')
marker='async function openOriginalImage(src){'
start=html.find(marker)
if start<0:
    raise SystemExit('openOriginalImage not found')

# Extract exactly this function with a small JS-aware brace scanner.
brace=html.find('{',start)
depth=0; quote=None; esc=False; line_comment=False; block_comment=False; end=None
i=brace
while i<len(html):
    ch=html[i]; nxt=html[i+1] if i+1<len(html) else ''
    if line_comment:
        if ch=='\n': line_comment=False
        i+=1; continue
    if block_comment:
        if ch=='*' and nxt=='/': block_comment=False; i+=2; continue
        i+=1; continue
    if quote:
        if esc: esc=False
        elif ch=='\\': esc=True
        elif ch==quote: quote=None
        i+=1; continue
    if ch=='/' and nxt=='/': line_comment=True; i+=2; continue
    if ch=='/' and nxt=='*': block_comment=True; i+=2; continue
    if ch in ("'",'"','`'): quote=ch; i+=1; continue
    if ch=='{': depth+=1
    elif ch=='}':
        depth-=1
        if depth==0:
            end=i+1; break
    i+=1
if end is None:
    raise SystemExit('unterminated openOriginalImage')
fn=html[start:end]
catch_pos=fn.find('}catch(e){')
if catch_pos<0:
    raise SystemExit('openOriginalImage catch block not found')
head=fn[:catch_pos]
tail=fn[catch_pos:]
old="'+url+'"
new="'+src+'"
# Fallback currently references the out-of-scope Blob URL twice: image src and pagehide cleanup.
# Both must use the in-scope original src so constructing the HTML cannot throw ReferenceError.
if tail.count(old)!=2:
    raise SystemExit(f'unexpected fallback url interpolation count: {tail.count(old)}')
tail=tail.replace(old,new)
patched=head+tail
if patched==fn:
    raise SystemExit('patch made no change')
html=html[:start]+patched+html[end:]
path.write_text(html,encoding='utf-8')
print('patched both out-of-scope fallback URL interpolations to original src')
