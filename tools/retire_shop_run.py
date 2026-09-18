from pathlib import Path

src = Path('tools/retire_shop.py').read_text(encoding='utf-8')
needle = "exact(\",shopDB:payload.shopDB,mediaIndex:idx\", \",mediaIndex:idx\", 'remove v99 ZIP ShopDB field')\n"
if needle not in src:
    raise SystemExit('expected duplicate v99 ZIP assertion not found in patch source')
src = src.replace(needle, '')
exec(compile(src, 'tools/retire_shop.py', 'exec'), {'__name__': '__main__'})
