from pathlib import Path
import re

s = Path('index.html').read_text(encoding='utf-8')
patterns = [
    'ShopDB','shopDB','openShopDb','readShopStrict','writeShopStrict','clearShopStrict',
    'openShopV99','shopReadMap','shopReplaceMap','captureShop','captureShopCore',
    'normalizeShopData','normalizeRescueShopRaw','shopExpected','filtered.shop','shopOut','desiredShop','shopRestored',
    'shop_gift_cabinet','xiaoshu_coupon_wallet_v1','coupon_wallet','gift_cabinet','礼物柜','卡包','商城',
    '.shop-modal','inclShop','sel.shop','seen.shop',"id:'shop'","shop:{id:'shop'","case 'shop'",'raw.shopDB','data.shopDB',
    '.fa-shopping-cart::before','.fa-store::before','.fa-wallet::before','.fa-cart-plus::before','.fa-ticket-alt::before'
]
for pat in patterns:
    count = s.count(pat)
    print(f'COUNT\t{pat}\t{count}')
    start = 0
    shown = 0
    while count and shown < 5:
        i = s.find(pat, start)
        if i < 0: break
        a=max(0,i-140); b=min(len(s),i+len(pat)+220)
        print(f'HIT\t{pat}\t'+s[a:b].replace('\n','\\n'))
        start=i+len(pat); shown+=1

# Class usage audit for commerce-looking FontAwesome glyphs. Definition itself is not usage.
for cls in ['fa-shopping-cart','fa-store','fa-wallet','fa-cart-plus','fa-ticket-alt']:
    uses=len(re.findall(r'class=["\'][^"\']*\\b'+re.escape(cls)+r'\\b',s))
    print(f'CLASSUSE\t{cls}\t{uses}')

# Critical feature guards.
for marker in ['收藏','朋友圈','相册','相机','电话','短信','callRecordsV2','productFromItem','productRow','xiaoshu-retired-commerce-cleanup-v1']:
    print(f'REQUIRED\t{marker}\t{s.count(marker)}')
