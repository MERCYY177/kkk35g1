#!/usr/bin/env python3
from pathlib import Path
import base64
import hashlib
import re

index_path = Path('index.html')
html = index_path.read_text(encoding='utf-8')
start = html.find('const BUILTIN_KEYBOARD_BEAUTY_STYLES=')
end = html.find('let editingKeyboardBeautyId', start)
if start < 0 or end < 0:
    raise SystemExit('cannot locate built-in keyboard beauty style registry')

region = html[start:end]
pattern = re.compile(r'data:image/([^;]+);base64,([A-Za-z0-9+/=]+)')
matches = list(pattern.finditer(region))
if not matches:
    raise SystemExit('expected built-in theme image data URIs to extract')

ext_for_mime = {
    'png': 'png',
    'jpeg': 'jpg',
    'jpg': 'jpg',
    'gif': 'gif',
    'webp': 'webp',
    'svg+xml': 'svg',
}
asset_dir = Path('assets/builtin-theme')
asset_dir.mkdir(parents=True, exist_ok=True)

replacement_for_uri = {}
written = {}
for m in matches:
    full = m.group(0)
    if full in replacement_for_uri:
        continue
    mime = m.group(1).lower()
    ext = ext_for_mime.get(mime)
    if not ext:
        raise SystemExit(f'unsupported built-in theme image mime: image/{mime}')
    try:
        data = base64.b64decode(m.group(2), validate=True)
    except Exception as exc:
        raise SystemExit(f'invalid built-in theme image data URI: {exc}')
    if not data:
        raise SystemExit('empty built-in theme image data URI')
    digest = hashlib.sha256(data).hexdigest()[:16]
    filename = f'theme-{digest}.{ext}'
    path = asset_dir / filename
    if path.exists() and path.read_bytes() != data:
        raise SystemExit(f'hash collision or mismatched existing asset: {path}')
    path.write_bytes(data)
    replacement_for_uri[full] = path.as_posix()
    written[path.as_posix()] = len(data)

for data_uri, ref in replacement_for_uri.items():
    region = region.replace(data_uri, ref)

if 'data:image/' in region:
    raise SystemExit('built-in theme data URI remained after extraction')

html = html[:start] + region + html[end:]
index_path.write_text(html, encoding='utf-8')

print(f'extracted {len(replacement_for_uri)} unique data URIs from {len(matches)} references')
print(f'wrote {len(written)} unique files, {sum(written.values())} bytes total')
print(f'index.html now {index_path.stat().st_size} bytes')
