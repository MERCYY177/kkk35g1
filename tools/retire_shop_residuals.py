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

# A. Remove the old normal-backup ShopDB helper cluster entirely.
rx(r"\nfunction openShopDb\(\)\{.*?\nfunction categoryIdsPresent\(lf,ls,shop\)\{",
   "\nfunction categoryIdsPresent(lf,ls){",
   'remove normal ShopDB helper cluster',max_count=1,flags=re.S)

# B. Remove old shop normalization/import plumbing.
rx(r"\nfunction normalizeShopData\(shop\)\{.*?\nfunction getLfSource\(data\)\{",
   "\nfunction getLfSource(data){",
   'remove normalizeShopData',max_count=1,flags=re.S)
exact(" || !!d.shopDB","",'legacy backup detection ignores shopDB',max_count=1)
exact(" collectRefs(data.shopDB||{},refs);","",'media validation ignores shopDB',max_count=1)
exact("  var shop=normalizeShopData((data.shopDB&&typeof data.shopDB==='object')?cloneJson(data.shopDB):{});\n","",'preflight drops shopDB normalization',max_count=1)
exact("    localforage:lf,localStorage:ls,shopDB:shop,","    localforage:lf,localStorage:ls,",'preflight clean object drops shopDB',max_count=1)
rx(r"\n\s*var actualShopStores=Object\.keys\(\(data\.shopDB&&typeof data\.shopDB==='object'\)\?data\.shopDB:\{\}\)\.filter\(safeKey\)\.sort\(\);\n\s*if\(!Array\.isArray\(mf\.shopStores\)\|\|mf\.shopStores\.slice\(\)\.sort\(\)\.join\('\|'\)!==actualShopStores\.join\('\|'\)\)errors\.push\('manifest 的 ShopDB 仓库清单不一致'\);",
   "",'remove old manifest ShopDB validation',max_count=1)
exact("categoryIdsPresent(data.localforage||{},data.localStorage||{},normalizeShopData(data.shopDB||{}))","categoryIdsPresent(data.localforage||{},data.localStorage||{})",'old manifest category check ignores shopDB',max_count=1)

# C. Strip Shop from selection/snapshot/restore paths in the older backup layer.
rx(r"return \{lf:filterIncomingObject\(clean\.localforage\|\|\{\},'lf',ids,stats\),ls:filterIncomingObject\(clean\.localStorage\|\|\{\},'ls',ids,stats\),shop:\(ids\.indexOf\('shop'\)!==-1\?normalizeShopData\(cloneJson\(clean\.shopDB\|\|\{\}\)\):normalizeShopData\(\{\}\)\),stats:stats\};",
   "return {lf:filterIncomingObject(clean.localforage||{},'lf',ids,stats),ls:filterIncomingObject(clean.localStorage||{},'ls',ids,stats),stats:stats};",
   'remove shop from filterForSelected',max_count=1)
rx(r"\n\s*var shop=\{\};if\(sel\.shop\)\{try\{shop=await readShopStrict\(\);\}catch\(e2\)\{errors\.push\('无法建立商城回滚点: '\+stringErr\(e2\)\);\}\}","",'remove old Shop snapshot read',max_count=1)
exact("return {lf:lf,ls:ls,shop:shop};","return {lf:lf,ls:ls};",'old snapshot drops shop field',max_count=1)
rx(r"\n\s*if\(sel\.shop\)\{try\{await clearShopStrict\(\);\}catch\(e2\)\{errors\.push\('清理商城失败: '\+stringErr\(e2\)\);\}\}","",'remove old Shop clear path',max_count=1)
rx(r"\n\s*if\(ids\.indexOf\('shop'\)!==-1\)\{try\{await writeShopStrict\(snap\.shop\|\|\{\}\);\}catch\(e2\)\{errors\.push\('ShopDB: '\+stringErr\(e2\)\);\}\}","",'remove old Shop rollback restore',max_count=1)
rx(r"\n\s*if\(expectedShop\)\{try\{var gotShop=await readShopStrict\(\);if\(fingerprint\(gotShop\)!==fingerprint\(expectedShop\)\)errors\.push\('商城数据库校验不一致'\);\}catch\(e2\)\{errors\.push\('商城数据库无法复读'\);\}\}","",'remove old Shop write verification',max_count=1)
rx(r"\n\s*if\(ids\.indexOf\('shop'\)!==-1\)\{shopExpected=normalizeShopData\(\{\}\);Object\.keys\(filtered\.shop\|\|\{\}\)\.forEach\(function\(s\)\{shopExpected\[s\]=inlineMediaTreeStrict\(filtered\.shop\[s\],mediaStore\);\}\);await writeShopStrict\(shopExpected\);\}","",'remove old selective Shop restore',max_count=1)

# D. Remove dead shop locals from normal backup building.
exact("  var shop={};\n","",'remove dead normal shop local',max_count=1)
exact("var state={store:{},map:new Map(),n:0},lfOut={},lsOut={},shopOut={};","var state={store:{},map:new Map(),n:0},lfOut={},lsOut={};",'remove dead shopOut',max_count=1)
exact("categoryIdsPresent(lfOut,lsOut,shopOut)","categoryIdsPresent(lfOut,lsOut)",'normal category list drops shop arg',max_count=1)

# E. Remove obsolete export flag branch.
exact("    case 'shop': return flags.inclShop!==false;\n","",'remove inclShop flag branch',max_count=1)

# F. Remove legacy emergency Shop capture helpers/conversion.
rx(r"\nasync function captureShopCore\(errors\)\{.*?\nfunction captureMainMemory\(errors\)\{",
   "\nfunction captureMainMemory(errors){",
   'remove legacy rescue Shop capture helpers',max_count=1,flags=re.S)
exact(",shop=strictClone('抢救包 ShopDB',raw.shopDB||{},[])||{}","",'old rescue conversion drops ShopDB clone',max_count=1)
exact(",shopDB:shop};","};",'old rescue conversion drops shopDB field',min_count=1,max_count=2)

# G. Remove V99 ShopDB helpers and all remaining sel.shop execution branches.
rx(r"\nfunction openShopV99\(\)\{.*?\nasync function snapshotSelected\(ids\)\{",
   "\nasync function snapshotSelected(ids){",
   'remove v99 ShopDB helper cluster',max_count=1,flags=re.S)
exact("var shop=null;","",'remove dead v99 shop snapshot local',max_count=1)
exact(",shop:shop,lfKeys:",",lfKeys:",'v99 snapshot drops shop field',max_count=1)
exact("var desiredShop=null,snap=","var snap=",'remove dead desiredShop',max_count=1)
exact("   if(sel.shop&&desiredShop)await shopReplaceMap(desiredShop);\n","",'remove v99 Shop write branch',max_count=1)
exact("   if(sel.shop&&desiredShop){var gotShop=await shopReadMap();if(checksum(gotShop)!==checksum(desiredShop))throw new Error('商城数据库写后校验不一致');}\n","",'remove v99 Shop verification branch',max_count=1)
exact(",shopRestored:!!sel.shop","",'remove v99 shopRestored result',max_count=1)

# H. Remove V99 rescue Shop normalization.
rx(r"\nfunction normalizeRescueShopRaw\(shop\)\{.*?\nfunction buildRescueLegacyV99\(data\)\{",
   "\nfunction buildRescueLegacyV99(data){",
   'remove rescue Shop normalizer',max_count=1,flags=re.S)
exact(",shop=normalizeRescueShopRaw(raw.shopDB||{})","",'v99 rescue conversion ignores raw shopDB',max_count=1)

# I. Any now-dead ShopDB presence in old preflight payload checks is removed.
exact("collectRefs(data.localforage||{},refs); collectRefs(data.localStorage||{},refs);","collectRefs(data.localforage||{},refs); collectRefs(data.localStorage||{},refs);",'anchor validation retained',min_count=1,max_count=1)

# J. Make physical deletion retry until ShopDB deletion actually succeeds.
old="try{if(window.indexedDB){var r=indexedDB.deleteDatabase('ShopDB');r.onsuccess=r.onerror=r.onblocked=function(){try{localStorage.setItem(marker,'1');}catch(e){}};}else localStorage.setItem(marker,'1');}catch(e){try{localStorage.setItem(marker,'1');}catch(_e){}}"
new="try{if(window.indexedDB){var r=indexedDB.deleteDatabase('ShopDB');r.onsuccess=function(){try{localStorage.setItem(marker,'1');}catch(e){}};r.onerror=r.onblocked=function(){};}else localStorage.setItem(marker,'1');}catch(e){}"
exact(old,new,'make ShopDB retirement retry-safe',max_count=1)

if s==orig: raise SystemExit('no residual changes produced')
p.write_text(s,encoding='utf-8')
print('Applied',len(changes),'residual cleanup groups')
for i,(label,count) in enumerate(changes,1): print(f'{i:02d}. {label} (x{count})')
