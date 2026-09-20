from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'
text = INDEX.read_text(encoding='utf-8')

# 1) Make the built-in pack cover every local sticker file already present in the repo.
pack_re = re.compile(
    r'(<script[^>]+id=["\']xiaoshu-builtin-sticker-packs-data-v1["\'][^>]*>)(.*?)(</script>)',
    re.S | re.I,
)
m = pack_re.search(text)
if not m:
    raise SystemExit('built-in sticker pack data block not found')

data = json.loads(m.group(2).strip() or '[]')
if not isinstance(data, list):
    raise SystemExit('built-in sticker pack data is not a list')
if not data:
    data = [{'id': 'all-local-stickers', 'name': '全部本地表情', 'items': []}]
pack = data[0]
if not isinstance(pack, dict):
    raise SystemExit('first sticker pack is not an object')
items = pack.setdefault('items', [])
if not isinstance(items, list):
    raise SystemExit('sticker pack items is not a list')

assets = sorted(
    p.relative_to(ROOT).as_posix()
    for p in (ROOT / 'assets' / 'stickers').rglob('*')
    if p.is_file()
)
existing = {
    str(item.get('src', '')).strip()
    for item in items
    if isinstance(item, dict) and str(item.get('src', '')).strip()
}
missing = [src for src in assets if src not in existing]
for src in missing:
    name = Path(src).stem
    items.append({'src': src, 'label': f'本地表情 {name}'})

# De-duplicate by src while preserving the current visible order, then append recovered items.
seen = set()
clean_items = []
for item in items:
    if not isinstance(item, dict):
        continue
    src = str(item.get('src', '')).strip()
    if not src or src in seen:
        continue
    seen.add(src)
    clean_items.append(item)
pack['items'] = clean_items
pack['name'] = pack.get('name') or '全部本地表情'

new_pack_json = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
text = text[:m.start()] + m.group(1) + new_pack_json + m.group(3) + text[m.end():]

# 2) Chat2 receives the pool correctly but used to reject local relative sticker URLs.
source_re = re.compile(
    r'(<script[^>]+id=["\']xiaoshuChat2Source["\'][^>]*>)(.*?)(</script>)',
    re.S | re.I,
)
sm = source_re.search(text)
if not sm:
    raise SystemExit('Chat2 source block not found')
source = sm.group(2)
fn_start = source.find("function safeResourceUrl(value,kind='image'){")
if fn_start < 0:
    raise SystemExit('Chat2 safeResourceUrl not found')
fn_end = source.find("\nfunction safeCssUrl", fn_start)
if fn_end < 0:
    raise SystemExit('Chat2 safeResourceUrl end marker not found')
fn = source[fn_start:fn_end]

local_guard = "if((raw.startsWith('assets/stickers/')||raw.startsWith('./assets/stickers/'))&&!raw.includes('..')&&/\\.(?:png|jpe?g|gif|webp)(?:[?#][^\\s]*)?$/i.test(raw))return raw;"
if "assets/stickers/" not in fn:
    needle = "if(/^data:image\\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(raw))return raw;\nreturn'';"
    replacement = "if(/^data:image\\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(raw))return raw;\n" + local_guard + "\nreturn'';"
    if needle not in fn:
        raise SystemExit('Chat2 safeResourceUrl expected tail not found')
    fn = fn.replace(needle, replacement, 1)
    source = source[:fn_start] + fn + source[fn_end:]
    text = text[:sm.start()] + sm.group(1) + source + sm.group(3) + text[sm.end():]

INDEX.write_text(text, encoding='utf-8')
print('recovered pack items:', len(missing))
print('final pack items:', len(clean_items))
print('Chat2 local sticker URL guard present:', 'assets/stickers/' in fn)
