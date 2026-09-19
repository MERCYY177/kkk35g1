#!/usr/bin/env python3
from pathlib import Path
from html.parser import HTMLParser
import collections,re

ROOT=Path('.')
INDEX=ROOT/'index.html'
html=INDEX.read_text(encoding='utf-8')
errors=[]; warnings=[]

def require(ok,msg):
    if not ok: errors.append(msg)

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids=[]; self.refs=[]; self.style_depth=0; self.styles=[]; self.style_attrs=[]
    def handle_starttag(self,tag,attrs):
        d=dict(attrs)
        if d.get('id'): self.ids.append(d['id'])
        if d.get('style'): self.style_attrs.append(d['style'])
        if tag.lower()=='style': self.style_depth+=1
        for a in ('src','href'):
            if d.get(a): self.refs.append((tag,a,d[a]))
    def handle_endtag(self,tag):
        if tag.lower()=='style' and self.style_depth: self.style_depth-=1
    def handle_data(self,data):
        if self.style_depth: self.styles.append(data)

p=Parser(); p.feed(html)
counts=collections.Counter(p.ids)
require(not {k:v for k,v in counts.items() if v>1},'duplicate static DOM ids found')

def local(v):
    v=str(v or '').strip().strip('"\'')
    if not v or v.startswith(('#','data:','blob:','javascript:','mailto:','tel:','http://','https://','//')): return None
    v=v.split('#',1)[0].split('?',1)[0]
    return v.lstrip('/') if v else None

for tag,a,v in p.refs:
    x=local(v)
    if x: require((ROOT/x).exists(),f'missing local {tag}[{a}] resource: {v}')
for raw in re.findall(r'url\(([^)]+)\)','\n'.join(p.styles+p.style_attrs),re.I):
    x=local(raw)
    if x: require((ROOT/x).exists(),f'missing local CSS resource: {raw.strip()}')

for domain in ('s3.bmp.ovh','i.postimg.cc','img.heliar.top','nos.netease.com'):
    require(domain not in html,f'old remote image host remains: {domain}')

start=html.find('const BUILTIN_KEYBOARD_BEAUTY_STYLES='); end=html.find('let editingKeyboardBeautyId',start)
require(start>=0 and end>start,'built-in theme registry missing')
if start>=0 and end>start:
    region=html[start:end]
    refs=re.findall(r'assets/builtin-theme/theme-[0-9a-f]{16}\.(?:png|jpg|jpeg|gif|webp|svg)',region)
    require(len(refs)==28,f'built-in theme ref count changed: {len(refs)}')
    require(len(set(refs))==18,f'built-in theme unique asset count changed: {len(set(refs))}')
    require('data:image/' not in region,'built-in theme data URI bloat returned')
    for ref in set(refs): require((ROOT/ref).is_file(),f'missing theme asset: {ref}')

critical={
 'mail empty-pool guard':'if(!pool.length)return[]',
 'mail phrase topic matching':'terms.some(function(term){return text.indexOf(term)>=0})',
 'mail punctuation preservation':'if(/[。！？!?….]$/.test(text))return text',
 'neutral incoming title':"title:'一封来信'",
 'adaptive mail grouping':'buf.length+line.length>70',
 'sticker-only scheduler':'if (settings.autoSendEnabled || settings.autoStickerEnabled)',
 'sticker miss text guard':'if (settings.autoSendEnabled) simulateReply();',
 'legacy call owner helper':'function legacyRecordsForSession',
 'voice incoming guard':"requestedKind==='voice'&&!cfg.allowVoiceIncoming",
 'video incoming guard':"requestedKind==='video'&&!cfg.allowVideoIncoming",
 'menu aria':"b.setAttribute('aria-haspopup','menu')",
 'menu escape':"e.key==='Escape'",
 'original-image fallback uses src':'<img src="\'+src+\'">',
}
for label,token in critical.items(): require(token in html,f'critical regression: {label}')
for key in ('mailboxLettersV1','callRecordsV2','callSettingsV2'):
    require(key in html,f'persistence key missing: {key}')

size=INDEX.stat().st_size
require(size<2_500_000,f'index.html size regression: {size}')
new_function=len(re.findall(r'\bnew\s+Function\s*\(',html))
if new_function: warnings.append(f'new Function compatibility polyfill: {new_function}')
console_calls=len(re.findall(r'console\.(?:log|debug|warn|error)\s*\(',html))
if console_calls: warnings.append(f'console diagnostics: {console_calls}')

print('FINAL REAUDIT')
print(f'index_bytes={size}')
print(f'static_ids={len(p.ids)} unique_static_ids={len(set(p.ids))}')
print(f'html_refs={len(p.refs)}')
print(f'errors={len(errors)} warnings={len(warnings)}')
for x in errors: print('ERROR:',x)
for x in warnings: print('WARNING:',x)
if errors: raise SystemExit(1)
print('FINAL_REAUDIT_OK')
