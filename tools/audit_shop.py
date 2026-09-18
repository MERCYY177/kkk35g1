from pathlib import Path

s = Path('index.html').read_text(encoding='utf-8')
patterns = [
    'ShopDB','shopDB','openShopDb','readShopStrict','writeShopStrict','clearShopStrict',
    'openShopV99','shopReadMap','shopReplaceMap','captureShop','captureShopCore',
    'normalizeShopData','normalizeRescueShopRaw','shop_gift_cabinet','xiaoshu_coupon_wallet_v1',
    'gift_cabinet','礼物柜','卡包','商城','.shop-modal','inclShop','sel.shop','seen.shop',
    "id:'shop'","shop:{id:'shop'"
]
for pat in patterns:
    count = s.count(pat)
    print(f'COUNT\t{pat}\t{count}')
    start = 0
    shown = 0
    while count and shown < 5:
        i = s.find(pat, start)
        if i < 0:
            break
        a = max(0, i-140)
        b = min(len(s), i+len(pat)+220)
        excerpt = s[a:b].replace('\n','\\n')
        print(f'HIT\t{pat}\t{excerpt}')
        start = i + len(pat)
        shown += 1
