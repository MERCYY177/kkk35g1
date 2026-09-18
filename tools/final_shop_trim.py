from pathlib import Path
import re

p=Path('index.html')
s=p.read_text(encoding='utf-8')
orig=s
changes=[]

def exact(old,new,label,min_count=1,max_count=None):
    global s
    c=s.count(old)
    if c<min_count: raise SystemExit(f'{label}: expected >= {min_count}, got {c}')
    if max_count is not None and c>max_count: raise SystemExit(f'{label}: expected <= {max_count}, got {c}')
    s=s.replace(old,new)
    changes.append((label,c))

def rx(pattern,repl,label,min_count=1,max_count=None,flags=0):
    global s
    ns,c=re.subn(pattern,repl,s,flags=flags)
    if c<min_count: raise SystemExit(f'{label}: expected >= {min_count}, got {c}')
    if max_count is not None and c>max_count: raise SystemExit(f'{label}: expected <= {max_count}, got {c}')
    s=ns
    changes.append((label,c))

# Dead remnants in the older restore wrapper.
exact("function verifyWritten(expectedLf,expectedLs,expectedShop){","function verifyWritten(expectedLf,expectedLs){",'drop dead expectedShop parameter',max_count=1)
exact(",shopExpected=null,legacyHome=[]",",legacyHome=[]",'drop dead shopExpected local',max_count=1)
exact("await verifyWritten(writtenLf,writtenLs,shopExpected);","await verifyWritten(writtenLf,writtenLs);",'drop dead shopExpected call arg',max_count=1)
exact(",shopRestored:ids.indexOf('shop')!==-1","",'drop dead shopRestored result',max_count=1)

# Outdated rescue wording; the only remaining literal ShopDB should be the one-time deletion migration.
exact("// 第一时间同步抓住仍在运行的内存与 localStorage；后面的 IndexedDB/ShopDB 都有硬超时，不能拖死抢救通道。","// 第一时间同步抓住仍在运行的内存与 localStorage；后面的 IndexedDB 有硬超时，不能拖死抢救通道。",'fix legacy rescue comment',max_count=1)
exact("这份核心包不等待 IndexedDB/ShopDB，先抓住当前内存。","这份核心包不等待 IndexedDB，先抓住当前内存。",'fix v99 rescue panel copy',max_count=1)

# Clarify preserved read-only historical-card compatibility without implying an active Shop feature.
exact("// 当前正式卡片：关系券、商城分享/代付、红包。","// 当前正式卡片：关系券、红包；旧分享/代付卡仅用于历史消息回显。",'clarify current card comment',max_count=1)
exact("// 兼容历史聊天里已经保存过的转账和旧商城卡，但不把通用 product-card/data-card 当卡片。","// 兼容历史聊天里已经保存过的转账和旧商品卡，但不把通用 product-card/data-card 当卡片。",'clarify historical card comment',max_count=1)

# Remove commerce-looking FontAwesome masks proven to have zero class usage.
for cls in ['fa-shopping-cart','fa-store','fa-wallet','fa-cart-plus','fa-ticket-alt']:
    rx(r'\.'+re.escape(cls)+r'::before\{[^}]*\}', '', f'remove unused {cls} icon mask', max_count=1)

if s==orig: raise SystemExit('no final trim produced')
p.write_text(s,encoding='utf-8')
print('Applied',len(changes),'final trim groups')
for i,(label,count) in enumerate(changes,1): print(f'{i:02d}. {label} (x{count})')
