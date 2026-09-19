#!/usr/bin/env python3
from pathlib import Path
from html.parser import HTMLParser
import collections, json, re

ROOT=Path('.')
INDEX=ROOT/'index.html'
html=INDEX.read_text(encoding='utf-8')
errors=[]; warnings=[]

def err(msg): errors.append(msg)
def warn(msg): warnings.append(msg)

class AuditParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids=[]; self.refs=[]; self.external_runtime=[]; self.style_attrs=[]
        self.style_depth=0; self.style_chunks=[]
    def handle_starttag(self, tag, attrs):
        d=dict(attrs)
        if d.get('id'): self.ids.append(d['id'])
        if d.get('style'): self.style_attrs.append(d['style'])
        if tag.lower()=='style': self.style_depth+=1
        for attr in ('src','href'):
            v=d.get(attr)
            if not v: continue
            self.refs.append((tag,attr,v))
            if v.startswith(('http://','https://')):
                rel=d.get('rel') or ''
                if tag=='script' or (tag=='link' and 'stylesheet' in rel):
                    self.external_runtime.append((tag,v))
    def handle_endtag(self, tag):
        if tag.lower()=='style' and self.style_depth:
            self.style_depth-=1
    def handle_data(self, data):
        if self.style_depth:
            self.style_chunks.append(data)

p=AuditParser(); p.feed(html)

# Static DOM duplicate IDs.
c=collections.Counter(p.ids)
dups={k:v for k,v in c.items() if v>1}
if dups: err('duplicate static DOM ids: '+', '.join(f'{k} x{v}' for k,v in sorted(dups.items())))

# Local src/href references must exist. Ignore fragments/protocol URLs/data/blob/javascript/mail/tel.
def clean_local(v):
    v=v.strip().strip('"\'')
    if not v or v.startswith(('#','data:','blob:','javascript:','mailto:','tel:','http://','https://','//')): return None
    v=v.split('#',1)[0].split('?',1)[0]
    if not v: return None
    if v.startswith('/'):
        warn(f'root-absolute local reference may bypass project base path: {v}')
        v=v.lstrip('/')
    return v

seen_missing=set()
for tag,attr,v in p.refs:
    local=clean_local(v)
    if local and not (ROOT/local).exists():
        key=(tag,attr,v)
        if key not in seen_missing:
            seen_missing.add(key); err(f'missing local {tag}[{attr}] resource: {v}')

# Scan only CSS parsed from real <style> nodes and literal style attributes.
css_text='\n'.join(p.style_chunks+p.style_attrs)
for raw in re.findall(r'url\(([^)]+)\)',css_text,re.I):
    local=clean_local(raw)
    if local and not (ROOT/local).exists():
        err(f'missing local CSS url resource: {raw.strip()}')

forbidden=('s3.bmp.ovh','i.postimg.cc','img.heliar.top','nos.netease.com')
asset_re=r'assets/builtin-theme/theme-[0-9a-f]{16}\.(?:png|jpg|jpeg|gif|webp|svg)'

# Large-keyboard built-in theme localization invariants.
start=html.find('const BUILTIN_KEYBOARD_BEAUTY_STYLES='); end=html.find('let editingKeyboardBeautyId',start)
if start<0 or end<=start: err('cannot locate large-keyboard built-in theme registry')
else:
    region=html[start:end]
    for domain in forbidden:
        if domain in region: err(f'large-keyboard built-in theme still depends on {domain}')
    if 'data:image/' in region: err('large-keyboard built-in theme data URI bloat returned')
    refs=re.findall(asset_re,region)
    if len(refs)!=28: err(f'large-keyboard local ref count changed: {len(refs)} (expected 28)')
    if len(set(refs))!=18: err(f'large-keyboard unique asset count changed: {len(set(refs))} (expected 18)')
    for ref in sorted(set(refs)):
        if not (ROOT/ref).is_file(): err(f'large-keyboard theme asset missing: {ref}')

# Ordinary-chat built-in bubble JSON must use the same local asset pool.
bm=re.search(r'<script\b[^>]*id=["\']xiaoshu-builtin-bubble-css-data["\'][^>]*>(.*?)</script>',html,re.I|re.S)
if not bm:
    err('cannot locate ordinary-chat built-in bubble registry')
else:
    bubble_raw=bm.group(1)
    try:
        bubble_data=json.loads(bubble_raw)
    except Exception as exc:
        bubble_data=[]; err(f'ordinary-chat built-in bubble JSON invalid: {exc}')
    if bubble_data and len(bubble_data)!=29:
        err(f'ordinary-chat bubble entry count changed: {len(bubble_data)} (expected 29)')
    for domain in forbidden:
        if domain in bubble_raw: err(f'ordinary-chat built-in bubble still depends on {domain}')
    bubble_refs=re.findall(asset_re,bubble_raw)
    if len(bubble_refs)!=24: err(f'ordinary-chat local ref count changed: {len(bubble_refs)} (expected 24)')
    if len(set(bubble_refs))!=16: err(f'ordinary-chat unique asset count changed: {len(set(bubble_refs))} (expected 16)')
    for ref in sorted(set(bubble_refs)):
        if not (ROOT/ref).is_file(): err(f'ordinary-chat bubble asset missing: {ref}')

# Size regression.
size=INDEX.stat().st_size
if size>=2_500_000: err(f'index.html size regression: {size} bytes')

# Critical fixes from the previous pass must still exist.
required={
 'mail empty-pool guard':'if(!pool.length)return[]',
 'mail phrase-topic matching':'terms.some(function(term){return text.indexOf(term)>=0})',
 'mail punctuation preservation':'if(/[。！？!?….]$/.test(text))return text',
 'neutral proactive letter title':"title:'一封来信'",
 'adaptive letter grouping':'buf.length+line.length>70',
 'sticker-only scheduler':'if (settings.autoSendEnabled || settings.autoStickerEnabled)',
 'sticker miss does not fall through to text':'if (settings.autoSendEnabled) simulateReply();',
 'legacy call ownership helper':'function legacyRecordsForSession',
 'voice incoming guard':"requestedKind==='voice'&&!cfg.allowVoiceIncoming",
 'video incoming guard':"requestedKind==='video'&&!cfg.allowVideoIncoming",
 'menu aria semantics':"b.setAttribute('aria-haspopup','menu')",
 'menu Escape handling':"e.key==='Escape'",
}
for label,token in required.items():
    if token not in html: err(f'critical regression: {label}')

# Persistence/backup-related state must still be represented in source.
for token in ('mailboxLettersV1','callRecordsV2','callSettingsV2'):
    if token not in html: err(f'expected persistence/backup key missing from source: {token}')

# Suspicious production leftovers / dynamic-code primitives.
for pat,label in [
    (r'\beval\s*\(', 'eval() present'),
    (r'\bnew\s+Function\s*\(', 'new Function() present'),
    (r'document\.write\s*\(', 'document.write() present'),
]:
    n=len(re.findall(pat,html))
    if n: warn(f'{label}: {n} occurrence(s)')

# External runtime dependencies are reported rather than auto-failed.
if p.external_runtime:
    uniq=[]
    for x in p.external_runtime:
        if x not in uniq: uniq.append(x)
    warn('external runtime script/stylesheet dependencies: '+ ' | '.join(v for _,v in uniq))

for term in ('TODO','FIXME'):
    n=html.count(term)
    if n: warn(f'{term} markers in production HTML: {n}')
console_n=len(re.findall(r'console\.(?:log|debug|warn|error)\s*\(',html))
if console_n: warn(f'console calls in production HTML: {console_n}')

# Print bounded contexts for manual classification of suspicious remnants.
def contexts(needle):
    out=[]; pos=0
    while True:
        i=html.find(needle,pos)
        if i<0: break
        snippet=html[max(0,i-220):min(len(html),i+420)]
        snippet=re.sub(r'\s+',' ',snippet)
        if len(snippet)>700: snippet=snippet[:700]
        out.append(snippet)
        pos=i+len(needle)
    return out

print('REAUDIT SUMMARY')
print(f'index_bytes={size}')
print(f'static_ids={len(p.ids)} unique_static_ids={len(set(p.ids))}')
print(f'html_src_href_refs={len(p.refs)}')
print(f'parsed_style_chunks={len(p.style_chunks)} style_attrs={len(p.style_attrs)}')
print(f'errors={len(errors)} warnings={len(warnings)}')
for x in errors: print('ERROR:',x)
for x in warnings: print('WARNING:',x)
for needle in ('new Function','document.write','s3.bmp.ovh','i.postimg.cc','img.heliar.top','nos.netease.com'):
    found=contexts(needle)
    print(f'CONTEXT_COUNT {needle}={len(found)}')
    for idx,snippet in enumerate(found,1):
        print(f'CONTEXT {needle} #{idx}: {snippet}')
if errors: raise SystemExit(1)
