#!/usr/bin/env python3
from pathlib import Path
import re

html_path = Path('index.html')
html = html_path.read_text(encoding='utf-8')
failures = []

def require(cond, label):
    if not cond:
        failures.append(label)

# 1) Mailbox regressions fixed in this pass.
require('if(!pool.length)return[]' in html, 'mailbox: empty card pool guard missing')
require('pool.length < min' not in html, 'mailbox: old min-card blank-letter guard returned')
require("terms.some(function(term){return text.indexOf(term)>=0})" in html, 'mailbox: phrase/topic matching missing')
require("if(/[。！？!?….]$/.test(text))return text" in html, 'mailbox: existing ASCII/Chinese punctuation preservation missing')
require("title:'一封来信'" in html, 'mailbox: proactive incoming title is not neutral')
require('if(line.length>55)' in html and 'buf.length+line.length>70' in html, 'mailbox: adaptive paragraph grouping missing')
require("return paras.join('\\n\\n')" in html or "return paras.join('\\\n\\\n')" in html or "return paras.join('\n\n')" in html, 'mailbox: paragraph separator missing')

# 2) Proactive stickers are independently schedulable and do not fall through to text.
require('if (settings.autoSendEnabled || settings.autoStickerEnabled)' in html, 'auto-sticker: shared scheduler does not start for sticker-only mode')
require('settings.autoStickerEnabled && Math.random() < __xsAutoStickerChance' in html, 'auto-sticker: probability branch missing')
require('if (settings.autoSendEnabled) simulateReply();' in html, 'auto-sticker: sticker-only miss can fall through to text')
require("sharedInterval.style.display=(s.autoSendEnabled||s.autoStickerEnabled)?'flex':'none'" in html, 'auto-sticker: shared interval control not visible in sticker-only mode')

# 3) Call migration/type guards.
require('function legacyRecordsForSession' in html, 'calls: scoped legacy migration helper missing')
require('var allowUnscoped=ids.length===1&&ids[0]===sessionId' in html, 'calls: unscoped legacy records are not restricted to single-session migration')
require('return owner?owner===sessionId:allowUnscoped' in html, 'calls: legacy owner filter missing')
require("(requestedKind==='voice'&&!cfg.allowVoiceIncoming)" in html, 'calls: voice incoming guard missing')
require("(requestedKind==='video'&&!cfg.allowVideoIncoming)" in html, 'calls: video incoming guard missing')

# 4) Three-dot menu semantics and keyboard support.
for token, label in [
    ("b.setAttribute('aria-haspopup','menu')", 'menu: aria-haspopup missing'),
    ("b.setAttribute('aria-expanded','false')", 'menu: aria-expanded initialization missing'),
    ("h.setAttribute('role','menu')", 'menu: role=menu missing'),
    ("e.key==='ArrowDown'", 'menu: ArrowDown handling missing'),
    ("e.key==='ArrowUp'", 'menu: ArrowUp handling missing'),
    ("e.key==='Home'", 'menu: Home handling missing'),
    ("e.key==='End'", 'menu: End handling missing'),
    ("e.key==='Escape'", 'menu: Escape handling missing'),
    ('closeMoreMenu(true)', 'menu: Escape focus restoration missing'),
]:
    require(token in html, label)
require(re.search(r'role=\\?"menuitem\\?"', html) is not None, 'menu: role=menuitem missing')

# 5) Built-in theme assets: no third-party runtime dependency, no data-URI bloat.
start = html.find('const BUILTIN_KEYBOARD_BEAUTY_STYLES=')
end = html.find('let editingKeyboardBeautyId', start)
require(start >= 0 and end > start, 'themes: cannot locate built-in style registry')
if start >= 0 and end > start:
    region = html[start:end]
    forbidden = ('s3.bmp.ovh', 'i.postimg.cc', 'img.heliar.top', 'nos.netease.com')
    require(not any(domain in region for domain in forbidden), 'themes: third-party image host remains')
    require('data:image/' not in region, 'themes: data URI bloat remains in index.html')
    refs = re.findall(r'assets/builtin-theme/theme-[0-9a-f]{16}\.(?:png|jpg|gif|webp|svg)', region)
    unique_refs = sorted(set(refs))
    require(len(refs) == 28, f'themes: expected 28 local refs, got {len(refs)}')
    require(len(unique_refs) == 18, f'themes: expected 18 unique local assets, got {len(unique_refs)}')
    for ref in unique_refs:
        p = Path(ref)
        require(p.is_file(), f'themes: missing {ref}')
        if p.is_file():
            require(p.stat().st_size > 0, f'themes: empty {ref}')

# Keep index itself near its pre-localization scale.
index_size = html_path.stat().st_size
require(index_size < 2_500_000, f'performance: index.html too large ({index_size} bytes)')

# 6) Intentional placeholder must remain intact; it is text/plain source, not an error.
require('__XIAOSHU_CIRCLE_SCRIPT_CLOSE__' in html, 'intentional circle text/plain placeholder unexpectedly removed')

if failures:
    print('FINAL REGRESSION FAILED:')
    for item in failures:
        print(' -', item)
    raise SystemExit(1)

asset_dir = Path('assets/builtin-theme')
asset_files = [p for p in asset_dir.iterdir() if p.is_file()] if asset_dir.is_dir() else []
asset_bytes = sum(p.stat().st_size for p in asset_files)
print('FINAL REGRESSION PASSED')
print(f'index_bytes={index_size}')
print(f'builtin_theme_files={len(asset_files)}')
print(f'builtin_theme_bytes={asset_bytes}')
print('mailbox=ok auto_sticker=ok calls=ok menu=ok themes=ok')
