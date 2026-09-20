from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')


def fail(msg):
    print('FAIL:', msg)
    return False


def ok(msg):
    print('PASS:', msg)
    return True


def main():
    passed = True

    assets = {
        p.relative_to(ROOT).as_posix()
        for p in (ROOT / 'assets' / 'stickers').rglob('*')
        if p.is_file()
    }
    if len(assets) != 615:
        passed = fail(f'expected 615 sticker asset files, found {len(assets)}') and passed
    else:
        passed = ok('all 615 sticker asset files exist') and passed

    m = re.search(
        r'<script[^>]+id=["\']xiaoshu-builtin-sticker-packs-data-v1["\'][^>]*>(.*?)</script>',
        HTML,
        re.S | re.I,
    )
    if not m:
        passed = fail('built-in sticker pack data block is missing') and passed
        pack_refs = set()
    else:
        data = json.loads(m.group(1).strip() or '[]')
        pack_refs = {
            str(item.get('src', '')).strip()
            for pack in (data if isinstance(data, list) else [])
            if isinstance(pack, dict)
            for item in (pack.get('items') or [])
            if isinstance(item, dict) and str(item.get('src', '')).strip()
        }
        missing = sorted(assets - pack_refs)
        extra = sorted(pack_refs - assets)
        if missing or extra:
            passed = fail(
                f'built-in sticker pack must cover every local sticker asset; '
                f'missing={len(missing)} extra={len(extra)} '
                f'missing_sample={missing[:8]} extra_sample={extra[:8]}'
            ) and passed
        else:
            passed = ok(f'built-in sticker pack covers all {len(assets)} local assets') and passed

    source_match = re.search(
        r'<script[^>]+id=["\']xiaoshuChat2Source["\'][^>]*>(.*?)</script>',
        HTML,
        re.S | re.I,
    )
    if not source_match:
        passed = fail('Chat2 source block is missing') and passed
    else:
        chat2 = source_match.group(1)
        fn_pos = chat2.find('function safeResourceUrl')
        if fn_pos < 0:
            passed = fail('Chat2 safeResourceUrl function is missing') and passed
        else:
            fn_slice = chat2[fn_pos:fn_pos + 1400]
            if 'assets/stickers/' not in fn_slice:
                passed = fail('Chat2 safeResourceUrl rejects local assets/stickers paths') and passed
            else:
                passed = ok('Chat2 safeResourceUrl accepts local assets/stickers paths') and passed

    required_bridge = [
        "type:'xiaoshu-big-keyboard-stickers-request'",
        "d.type==='xiaoshu-big-keyboard-stickers-request'",
        "type:'xiaoshu-big-keyboard-stickers-state'",
        "data.type==='xiaoshu-big-keyboard-stickers-state'",
        'sendBigKeyboardStickers(frame)',
        'normalizeSharedStickerPool(data.stickers)',
    ]
    missing_bridge = [x for x in required_bridge if x not in HTML]
    if missing_bridge:
        passed = fail(f'Chat2 sticker bridge is incomplete: {missing_bridge}') and passed
    else:
        passed = ok('Chat2 parent/frame sticker bridge is complete') and passed

    if not passed:
        sys.exit(1)
    print('STICKER RECOVERY REGRESSION GREEN')


if __name__ == '__main__':
    main()
