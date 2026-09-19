#!/usr/bin/env python3
from pathlib import Path
import json,re

path=Path('index.html')
html=path.read_text(encoding='utf-8')
pattern=re.compile(r'(<script\b[^>]*id=["\']xiaoshu-builtin-bubble-css-data["\'][^>]*>)(.*?)(</script>)',re.I|re.S)
m=pattern.search(html)
if not m:
    raise SystemExit('ordinary chat built-in bubble data block is missing')
raw=m.group(2)
try:
    data=json.loads(raw)
except Exception as exc:
    raise SystemExit(f'ordinary chat built-in bubble JSON invalid before patch: {exc}')
if len(data)!=29:
    raise SystemExit(f'unexpected ordinary chat built-in bubble entry count: {len(data)}')

mapping={
    'https://s3.bmp.ovh/2026/02/21/VFe4gR13.png':'assets/builtin-theme/theme-a6ed65bd3de7d61a.png',
    'https://s3.bmp.ovh/2026/02/21/6RqfRr7L.png':'assets/builtin-theme/theme-6c6ac06a60eaaf38.png',
    'https://i.postimg.cc/J4fLQ45D/wu-biao-ti6-20260217025406.png':'assets/builtin-theme/theme-cee82cfeab1103e4.png',
    'https://s3.bmp.ovh/2026/02/21/7t67AAtM.png':'assets/builtin-theme/theme-9d387b019e34063a.png',
    'https://img.heliar.top/file/1771772672460_%E6%97%A0%E6%A0%87%E9%A2%986_20260219021858.png':'assets/builtin-theme/theme-a559ffc20c358860.svg',
    'https://s3.bmp.ovh/2026/02/22/9irEl6iE.png':'assets/builtin-theme/theme-607e5703516d09dc.png',
    'https://img.heliar.top/file/1771772664958_%E6%97%A0%E6%A0%87%E9%A2%986_20260219021927.png':'assets/builtin-theme/theme-864cd155a6b5d78b.svg',
    'https://img.heliar.top/file/1772885841149_%E6%97%A0%E6%A0%87%E9%A2%9827_20260307201645.png':'assets/builtin-theme/theme-85df88bdc8af85cf.svg',
    'https://img.heliar.top/file/1772885844170_%E6%97%A0%E6%A0%87%E9%A2%9827_20260307201633.png':'assets/builtin-theme/theme-b6165ed8c7b56a51.svg',
    'https://nos.netease.com/ysf/3ff3e8b445a918ba4d42d3fbaaf7d05f.png':'assets/builtin-theme/theme-610cf1401f2fd587.png',
    'https://img.heliar.top/file/1772553939061_%E6%97%A0%E6%A0%87%E9%A2%9819_20260304000452.png':'assets/builtin-theme/theme-59688c6ea6707c2c.svg',
    'https://img.heliar.top/file/1772553916921_%E6%97%A0%E6%A0%87%E9%A2%9819_20260304000437.png':'assets/builtin-theme/theme-65fae7d70e44817b.svg',
    'https://nos.netease.com/ysf/57f3981521c5483848f4b96936cafba8.png':'assets/builtin-theme/theme-fd9beb0e72b310ee.png',
    'https://nos.netease.com/ysf/ac268fb068f931bc48e05e570be52de1.png':'assets/builtin-theme/theme-14288d5b11c26732.png',
    'https://nos.netease.com/ysf/027a8aa98eb5025f2490ec1d6996b43e.png':'assets/builtin-theme/theme-6a408c66f8c25177.png',
    'https://nos.netease.com/ysf/2733f1e8209ca293a72c92a599aa19c4.png':'assets/builtin-theme/theme-d34a32d61f2f3f9f.png',
}

before_total=sum(raw.count(old) for old in mapping)
if before_total!=24:
    raise SystemExit(f'expected 24 old-host references before patch, got {before_total}')
missing=[old for old in mapping if old not in raw]
if missing:
    raise SystemExit('expected old URLs missing before patch: '+' | '.join(missing))
for local in mapping.values():
    p=Path(local)
    if not p.is_file() or p.stat().st_size<=0:
        raise SystemExit(f'local replacement asset missing or empty: {local}')

patched=raw
for old,new in mapping.items():
    patched=patched.replace(old,new)
for domain in ('s3.bmp.ovh','i.postimg.cc','img.heliar.top','nos.netease.com'):
    if domain in patched:
        raise SystemExit(f'third-party bubble host remains after patch: {domain}')
try:
    after=json.loads(patched)
except Exception as exc:
    raise SystemExit(f'ordinary chat built-in bubble JSON invalid after patch: {exc}')
if len(after)!=len(data):
    raise SystemExit('bubble entry count changed during patch')
# Apart from URL substitutions, the block is deliberately untouched.
new_html=html[:m.start(2)]+patched+html[m.end(2):]
path.write_text(new_html,encoding='utf-8')
print(f'localized ordinary chat bubble assets: replacements={before_total}, unique_urls={len(mapping)}')
