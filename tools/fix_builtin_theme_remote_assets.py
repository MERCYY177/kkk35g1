#!/usr/bin/env python3
from pathlib import Path
import base64
import mimetypes
import re
import urllib.request

path = Path('index.html')
html = path.read_text(encoding='utf-8')
start = html.find('const BUILTIN_KEYBOARD_BEAUTY_STYLES=')
end = html.find('let editingKeyboardBeautyId', start)
if start < 0 or end < 0:
    raise SystemExit('cannot locate built-in keyboard beauty style registry')
region = html[start:end]
forbidden = ('s3.bmp.ovh', 'i.postimg.cc', 'img.heliar.top', 'nos.netease.com')
urls = re.findall(r'https://[^"\\)]+', region)
urls = sorted({u for u in urls if any(domain in u for domain in forbidden)})
if not urls:
    raise SystemExit('expected remote built-in theme image URLs to localize')

opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'Mozilla/5.0 (GitHub Actions; kkk35g1 asset localization)')]
replacements = {}
total = 0
for url in urls:
    print('fetching', url)
    with opener.open(url, timeout=30) as response:
        data = response.read(2 * 1024 * 1024 + 1)
        content_type = (response.headers.get_content_type() or '').lower()
    if len(data) > 2 * 1024 * 1024:
        raise SystemExit(f'asset too large (>2 MiB): {url}')
    if not data:
        raise SystemExit(f'empty asset: {url}')
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif data.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif data[:6] in (b'GIF87a', b'GIF89a'):
        mime = 'image/gif'
    elif data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        mime = 'image/webp'
    elif content_type.startswith('image/'):
        mime = content_type
    else:
        mime = mimetypes.guess_type(url)[0] or ''
    if not mime.startswith('image/'):
        raise SystemExit(f'non-image response ({mime or "unknown"}): {url}')
    total += len(data)
    replacements[url] = f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')
    print(f'  {len(data)} bytes -> {mime}')

for url, data_uri in replacements.items():
    count = region.count(url)
    if count < 1:
        raise SystemExit(f'URL disappeared before replacement: {url}')
    region = region.replace(url, data_uri)

if any(domain in region for domain in forbidden):
    raise SystemExit('forbidden remote domains remain inside built-in theme registry after replacement')
html = html[:start] + region + html[end:]
path.write_text(html, encoding='utf-8')
print(f'localized {len(replacements)} unique built-in theme images, {total} source bytes total')
