#!/usr/bin/env python3
"""Static audit of local Android packaging and cross-document font coverage."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
FONT = (ROOT / "custom-font-manager.js").read_text(encoding="utf-8")
ACTIVITY = (ROOT / "android-apps/app/src/main/java/com/mercyy/transmission/MainActivity.java").read_text(encoding="utf-8")
GRADLE = (ROOT / "android-apps/app/build.gradle.kts").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github/workflows/build-transmission-apps.yml").read_text(encoding="utf-8")
LEGACY_WORKFLOW = (ROOT / ".github/workflows/build-two-apps.yml").read_text(encoding="utf-8")

checks = {
    "main HTML loads local font module": '<script src="custom-font-manager.js"></script>' in INDEX,
    "Chat 2 srcdoc independently loads font module": 'xiaoshuChat2Source' in INDEX and 'custom-font-manager.js' in INDEX[INDEX.index('id="xiaoshuChat2Source"'):INDEX.index('</script>', INDEX.index('id="xiaoshuChat2Source"'))],
    "Moments srcdoc independently loads font module": 'xiaoshuCircleSource' in INDEX and 'custom-font-manager.js' in INDEX[INDEX.index('id="xiaoshuCircleSource"'):INDEX.index('</script>', INDEX.index('id="xiaoshuCircleSource"'))],
    "font manager uses IndexedDB": 'indexedDB.open(DB_NAME, DB_VERSION)' in FONT,
    "font manager stores Blob data and metadata": 'blob: blob' in FONT and 'mimeType: MIME_BY_FORMAT[format]' in FONT and "key: CURRENT_KEY" in FONT,
    "font manager validates all four formats": all(x in FONT for x in ["'ttf'", "'otf'", "'woff'", "'woff2'"]),
    "font manager re-applies and broadcasts changes": 'BroadcastChannel' in FONT and 'restoreCurrent' in FONT,
    "packaged app skips legacy remote font URLs": "location.hostname !== 'appassets.androidplatform.net'" in INDEX,
    "Android entry uses WebViewAssetLoader": 'WebViewAssetLoader.Builder()' in ACTIVITY and 'HOME_URL = "https://" + APP_HOST' in ACTIVITY,
    "Android entry is local, not GitHub Pages": 'github.io/kkk35g1' not in ACTIVITY and '/assets/site/index.html' in ACTIVITY,
    "Android blocks direct file URL access": 'settings.setAllowFileAccess(false)' in ACTIVITY,
    "Android file chooser implemented": 'onShowFileChooser' in ACTIVITY and 'params.createIntent()' in ACTIVITY,
    "Gradle packages full assets and root JS": 'include("*.html")' in GRADLE and 'include("*.js")' in GRADLE and 'include("assets/**")' in GRADLE and 'stageWebProject' in GRADLE,
    "three different app IDs configured": all(x in GRADLE for x in ['com.mercyy.transmission"', 'com.mercyy.transmission.new', 'com.mercyy177.chuanxun.three']),
    "one workflow builds all three": all(x in WORKFLOW for x in ['assembleChuanxun1Debug', 'assembleChuanxun2Debug', 'assembleChuanxun3Debug']),
    "legacy workflow entry reuses local three-app builder": 'build-transmission-apps.yml' in LEGACY_WORKFLOW and 'github.io/kkk35g1' not in LEGACY_WORKFLOW,
    "previous sticker deletion guard retained": '__xiaoshuStickerDeleteGuardV1' in (ROOT / 'sticker-core.js').read_text(encoding='utf-8'),
}

failed = []
for label, ok in checks.items():
    print(('PASS' if ok else 'FAIL') + '  ' + label)
    if not ok:
        failed.append(label)

sticker_count = sum(1 for p in (ROOT / 'assets/stickers').rglob('*') if p.is_file())
theme_count = sum(1 for p in (ROOT / 'assets/builtin-theme').rglob('*') if p.is_file())
print(f"INFO  source sticker resources: {sticker_count}; built-in theme resources: {theme_count}")
if sticker_count < 300 or theme_count < 10:
    failed.append('bundled image resources are incomplete')
if failed:
    print('Audit failed:', '; '.join(failed), file=sys.stderr)
    raise SystemExit(1)
print(f"All {len(checks)} local Android/font checks passed.")
