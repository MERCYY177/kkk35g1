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


def svg_uri(svg: str) -> str:
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode('utf-8')).decode('ascii')


def tail_svg(color: str, side: str = 'right', size: int = 20) -> str:
    path_d = 'M2 2 C8 3 12 6 15 11 C16.8 14 18.2 16.2 20 18 C14.5 18.2 10.2 16.3 7.2 13.2 C4.4 10.2 3 6.6 2 2 Z'
    transform = '' if side == 'right' else ' transform="translate(20 0) scale(-1 1)"'
    return svg_uri(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="{size}" height="{size}"><path d="{path_d}" fill="{color}"{transform}/></svg>')


def triangle_svg(color: str, side: str = 'right') -> str:
    pts = '1,1 13,6.5 1,12' if side == 'right' else '12,1 0,6.5 12,12'
    return svg_uri(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 13"><polygon points="{pts}" fill="{color}"/></svg>')


def bunny_svg(pink: bool) -> str:
    fill = '#FFF8FD' if pink else '#FFFCF3'
    stroke = '#D8B7C6' if pink else '#C8B79C'
    accent = '#EFAFC9' if pink else '#E6C98F'
    return svg_uri(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 40">
<g fill="{fill}" stroke="{stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
<ellipse cx="27" cy="10" rx="5" ry="9" transform="rotate(-16 27 10)"/><ellipse cx="43" cy="10" rx="5" ry="9" transform="rotate(16 43 10)"/>
<rect x="20" y="12" width="30" height="24" rx="13"/>
</g><circle cx="30" cy="24" r="1.5" fill="#5A4A50"/><circle cx="40" cy="24" r="1.5" fill="#5A4A50"/>
<path d="M34 28 Q35 29 36 28" fill="none" stroke="#5A4A50" stroke-width="1.2" stroke-linecap="round"/>
<circle cx="25.5" cy="28" r="2.2" fill="{accent}" opacity=".55"/><circle cx="44.5" cy="28" r="2.2" fill="{accent}" opacity=".55"/>
<path d="M54 19 l3 2.2 3-2.2-1.1 3.5 2.8 2-3.5.1-1.2 3.4-1.2-3.4-3.5-.1 2.8-2z" fill="{accent}" opacity=".75"/>
</svg>''')


def kitty_svg(accent: str = '#0C0C0C') -> str:
    return svg_uri(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">
<path d="M5 8 L4 3 L8 6 Q11 4.8 14 6 L18 3 L17 8 Q19 10 18 14 Q17 19 11 19 Q5 19 4 14 Q3 10 5 8Z" fill="#fff" stroke="{accent}" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="8" cy="12" r="1" fill="{accent}"/><circle cx="14" cy="12" r="1" fill="{accent}"/>
<path d="M10 15 Q11 16 12 15 M3 13 H7 M15 13 H19" fill="none" stroke="{accent}" stroke-width="1.1" stroke-linecap="round"/>
</svg>''')


def fallback_for(url: str) -> str:
    # iMessage / 一起听的小尾巴
    if 'J4fLQ45D' in url: return tail_svg('#A0A0A0', 'left')
    if 'VFe4gR13' in url: return tail_svg('#F0F0F0', 'left')
    if '6RqfRr7L' in url: return tail_svg('#000000', 'right')
    if '7t67AAtM' in url: return tail_svg('#FBF2F8', 'right')
    if '9irEl6iE' in url: return tail_svg('#007AFF', 'right')
    if '1771772672460' in url: return tail_svg('#E5E5EA', 'left')
    if '1771772664958' in url: return tail_svg('#27DF66', 'right')
    # 微信式顶部小尾巴
    if '1772885841149' in url: return triangle_svg('#95EC69', 'right')
    if '1772885844170' in url: return triangle_svg('#FFFFFF', 'left')
    if '3ff3e8b445a918ba4d42d3fbaaf7d05f' in url: return triangle_svg('#DFE7F5', 'right')
    if 'dd8974edf7ebf380c86de5afdc416eeb' in url: return triangle_svg('#FCF3F9', 'right')
    if '7d45639581a17b57cb60b20cf3d4792d' in url: return triangle_svg('#E5EAFF', 'right')
    # 兔丸装饰
    if '1772553939061' in url: return bunny_svg(True)
    if '1772553916921' in url: return bunny_svg(False)
    # Line Kitty 四个角装饰；能下载时仍优先原图
    if any(x in url for x in ('57f3981521c5483848f4b96936cafba8','ac268fb068f931bc48e05e570be52de1','027a8aa98eb5025f2490ec1d6996b43e','2733f1e8209ca293a72c92a599aa19c4')):
        return kitty_svg()
    raise SystemExit(f'no local fallback defined for: {url}')


def fetched_data_uri(url: str):
    # 这个域名在 CI 已确认无法解析，直接走本地兜底，避免反复等待 DNS 超时。
    if 'img.heliar.top' in url:
        return None
    opener = urllib.request.build_opener()
    opener.addheaders = [('User-Agent', 'Mozilla/5.0 (GitHub Actions; kkk35g1 asset localization)')]
    try:
        with opener.open(url, timeout=12) as response:
            data = response.read(2 * 1024 * 1024 + 1)
            content_type = (response.headers.get_content_type() or '').lower()
    except Exception as exc:
        print(f'  original unavailable: {type(exc).__name__}: {exc}')
        return None
    if not data or len(data) > 2 * 1024 * 1024:
        return None
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
        return None
    print(f'  original embedded: {len(data)} bytes ({mime})')
    return f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')

replacements = {}
original_count = 0
fallback_count = 0
for url in urls:
    print('localizing', url)
    data_uri = fetched_data_uri(url)
    if data_uri:
        original_count += 1
    else:
        data_uri = fallback_for(url)
        fallback_count += 1
        print('  using local SVG fallback')
    replacements[url] = data_uri

for url, data_uri in replacements.items():
    count = region.count(url)
    if count < 1:
        raise SystemExit(f'URL disappeared before replacement: {url}')
    region = region.replace(url, data_uri)

if any(domain in region for domain in forbidden):
    raise SystemExit('forbidden remote domains remain inside built-in theme registry after replacement')
html = html[:start] + region + html[end:]
path.write_text(html, encoding='utf-8')
print(f'localized {len(replacements)} unique built-in theme images: {original_count} original, {fallback_count} SVG fallback')
