from pathlib import Path
import re, json

src=Path('index.html')
s=src.read_text(encoding='utf-8')
before=s

def replace_once(old,new,label=None):
    global s
    c=s.count(old)
    if c!=1:
        raise AssertionError(f'{label or old[:80]} expected once, got {c}')
    s=s.replace(old,new,1)

def remove_once(old,label=None):
    replace_once(old,'',label)

def split_selectors(prelude):
    out=[]; cur=[]; par=br=0; quote=None; esc=False
    for ch in prelude:
        if quote:
            cur.append(ch)
            if esc: esc=False
            elif ch=='\\': esc=True
            elif ch==quote: quote=None
            continue
        if ch in "'\"": quote=ch; cur.append(ch); continue
        if ch=='(': par+=1
        elif ch==')' and par: par-=1
        elif ch=='[': br+=1
        elif ch==']' and br: br-=1
        if ch==',' and par==0 and br==0:
            out.append(''.join(cur)); cur=[]
        else:
            cur.append(ch)
    out.append(''.join(cur))
    return out

def scrub_css(css, markers):
    out=[]; pos=0; removed=0; L=len(css)
    while pos<L:
        op=css.find('{',pos)
        if op<0:
            out.append(css[pos:]); break
        pre=css[pos:op]
        i=op+1; quote=None; esc=False
        while i<L:
            ch=css[i]
            if quote:
                if esc: esc=False
                elif ch=='\\': esc=True
                elif ch==quote: quote=None
            else:
                if ch in "'\"": quote=ch
                elif ch=='}': break
                elif ch=='{': raise ValueError('nested brace in expected-flat CSS')
            i+=1
        if i>=L: raise ValueError('unclosed CSS rule')
        keep=[]
        for sel in split_selectors(pre):
            if any(m in sel for m in markers): removed+=1
            else: keep.append(sel)
        if keep:
            out.append(','.join(keep)); out.append(css[op:i+1])
        pos=i+1
    return ''.join(out),removed

# 1) Transfer persistence/backup: remove the unused transferData state completely.
replace_once("id:'coreExtra', label:'颜文字 / 语音 / 转账等扩展数据', flag:'coreExtra',",
             "id:'coreExtra', label:'颜文字 / 语音等扩展数据', flag:'coreExtra',", 'coreExtra label')
replace_once("lfNeedles:['kaomojiGroups','kaomojiLibrary','customVoices','customVoiceGroups','transferData'],",
             "lfNeedles:['kaomojiGroups','kaomojiLibrary','customVoices','customVoiceGroups'],", 'coreExtra needles')
replace_once(",'customVoices','customVoiceGroups','transferData'];", ",'customVoices','customVoiceGroups'];", 'backup suffix transferData')
remove_once("window.transferData = null; // 转账数据 { myBalance, systemBalance, records[] }\n", 'transferData global')
remove_once("localforage.getItem(getStorageKey('transferData')),\n", 'transferData load')
remove_once("const savedTransferData = getVal(23);\n", 'savedTransferData binding')
replace_once("const savedVoices = getVal(24);\nconst savedVoiceGroups = getVal(25);\nconst savedRecentDrawnReplies = getVal(26);",
             "const savedVoices = getVal(23);\nconst savedVoiceGroups = getVal(24);\nconst savedRecentDrawnReplies = getVal(25);", 'load indexes after transfer removal')
remove_once("if (savedTransferData) transferData = savedTransferData;\n", 'transferData restore')
remove_once("{ key: 'transferData',           val: () => localforage.setItem(getStorageKey('transferData'), transferData) },\n", 'transferData save')
replace_once("'groupChatSettings','chat_streak_data','kaomojiGroups','kaomojiLibrary','customVoices','customVoiceGroups','transferData',",
             "'groupChatSettings','chat_streak_data','kaomojiGroups','kaomojiLibrary','customVoices','customVoiceGroups',", 'owned key fragments')
s=s.replace(",[\'transferData\',function(){return typeof transferData!==\'undefined\'?transferData:null}]","")
s=s.replace(",transferData:'transferData'","")
s=s.replace("take('transferData',function(){return typeof transferData!=='undefined'?transferData:null;});","")

# 2) Message backup/fingerprint: no red packet or transfer payload semantics.
replace_once("if (m.stickerId || m.image || m.imageData || m.video || m.videoBlobKey || m.voiceUrl || m.audioUrl || m.fileUrl || m.redPacket || m.transfer) return true;",
             "if (m.stickerId || m.image || m.imageData || m.video || m.videoBlobKey || m.voiceUrl || m.audioUrl || m.fileUrl) return true;", 'message real content')
replace_once("xsFingerprintValue(m.redPacket || m.transfer || '')", "xsFingerprintValue('')", 'message commerce fingerprint')

# 3) Remove coupon/transfer/red-packet whitelist/sanitizer functions.
start=s.index('function xsSanitizeWhitelistedCardHtml(raw, kind) {')
end=s.index('function xsQuoteTime(timestamp) {', start)
s=s[:start]+s[end:]
start=s.index('function xsWhitelistedChatCardKind(raw) {')
end=s.index('function xsIsNonQuotableCardMessage(message) {', start)
s=s[:start]+s[end:]
remove_once("if (xsGetChatCardKind(message)) return true;\n", 'card-kind nonquotable gate')

# 4) Main message renderer: ordinary text/media/voice only; remove special commerce-card branches.
start=s.index("const __chatCardText = String(msg.text || '');")
end=s.index('if (isVoice) {', start)
s=s[:start]+"let content = '';\nif (msg.text) {\ncontent = `<div>${xsQuoteEscape(String(msg.text || '')).replace(/\\n/g, '<br>')}</div>`;\n}\n"+s[end:]
start=s.index('} else if (isRedPacket) {')
end=s.index('} else if (isStickerMessage || msg.image) {',start)
s=s[:start]+s[end:]
replace_once("if (isWhitelistedCardMessage || isImageOnly || isVideoOnly) {", "if (isImageOnly || isVideoOnly) {", 'special card outer bubble')
remove_once("""    if (isWhitelistedCardMessage) {
        messageDiv.classList.add('xiaoshu-card-message-outer');
        messageDiv.dataset.chatCardKind = __chatCardKind;
        wrapper.classList.add('card-message-wrapper');

    }
""", 'special card wrapper metadata')
remove_once("""    // 红包卡片点击事件
    if (isRedPacket) {
        const rpCard = messageDiv.querySelector('.red-packet-card');
        if (rpCard) {
            const rpId = rpCard.dataset.rpId || (msg.redPacket && msg.redPacket.id) || msg.id;
            rpCard.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof window.showRedPacketReceiveModal === 'function') {
                    window.showRedPacketReceiveModal(rpId);
                }
            });
        }
    }

""", 'red packet click handler')

# 5) Remove orphan red-packet post-reply hooks.
remove_once("""                        // 系统随机发红包（在回复完成后触发）
                        if (typeof window.trySystemRedPacket === 'function') {
                            setTimeout(function() { window.trySystemRedPacket(); }, 800 + Math.random() * 1200);
                        }
                        // 系统随机收取待领取红包
                        if (typeof window.tryCollectPendingRedPacket === 'function') {
                            setTimeout(function() { window.tryCollectPendingRedPacket(); }, 1200 + Math.random() * 1500);
                        }
                        // 检查24小时过期红包
                        if (typeof window.checkRedPacketExpiry === 'function') {
                            setTimeout(function() { window.checkRedPacketExpiry(); }, 500);
                        }
""", 'orphan red-packet hooks')

# 6) TA-phone message classification: keep generic card handling only; drop coupon/transfer/red special semantics.
remove_once("    try { if (typeof window.xsGetChatCardKind === 'function' && window.xsGetChatCardKind(m)) return true; } catch(e) {}\n", 'TA phone special-card hook')
replace_once("    return /card|coupon|transfer|red/.test(String(m.type || '').toLowerCase());",
             "    return /card/.test(String(m.type || '').toLowerCase());", 'TA phone card type regex')

# 7) Relationship-coupon style: retain exit-button CSS, remove coupon CSS, rename style id.
pat=re.compile(r'<style id="xiaoshu-exit-button-and-relation-coupon-style">(.*?)</style>',re.S)
m=pat.search(s)
if not m: raise AssertionError('relation coupon style not found')
css=m.group(1)
pos=css.find('.xiaoshu-coupon-chat-card')
if pos<0: raise AssertionError('coupon CSS start not found')
exit_css=css[:pos]
s=s[:m.start()]+f'<style id="xiaoshu-exit-button-style">{exit_css}</style>'+s[m.end():]

# 8) Remove retired commerce-card selectors from built-in theme CSS safely.
markers=('.red-packet-card','.transfer-bubble','.xiaoshu-card-message-outer')
pat=re.compile(r'<script id="xiaoshu-builtin-bubble-css-data" type="application/json">(.*?)</script>',re.S)
m=pat.search(s)
if not m: raise AssertionError('builtin bubble json not found')
data=json.loads(m.group(1)); removed=0
for item in data:
    cleaned,n=scrub_css(item.get('chatCss',''),markers)
    item['chatCss']=cleaned; removed+=n
if removed<1: raise AssertionError('no built-in bubble selectors removed')
blob=json.dumps(data,ensure_ascii=False,separators=(',',':'))
s=s[:m.start(1)]+blob+s[m.end(1):]

pat2=re.compile(r'const BUILTIN_KEYBOARD_BEAUTY_STYLES=(\[.*?\]);',re.S)
m=pat2.search(s)
if not m: raise AssertionError('builtin keyboard styles not found')
data=json.loads(m.group(1)); removed2=0
for item in data:
    cleaned,n=scrub_css(item.get('css',''),markers)
    item['css']=cleaned; removed2+=n
if removed2<1: raise AssertionError('no keyboard selectors removed')
blob=json.dumps(data,ensure_ascii=False,separators=(',',':'))
s=s[:m.start(1)]+blob+s[m.end(1):]

# 9) Core media/voice style still had the dead special-card wrapper selectors.
pat3=re.compile(r'<style id="xiaoshu-chat-card-whitelist-v2">(.*?)</style>',re.S)
m=pat3.search(s)
if not m: raise AssertionError('chat card/media style not found')
css3,n3=scrub_css(m.group(1),('.xiaoshu-card-message-outer',))
if n3<1: raise AssertionError('no special-card wrapper selectors removed from core style')
s=s[:m.start()]+f'<style id="xiaoshu-chat-media-whitelist-v2">{css3}</style>'+s[m.end():]

# 10) Runtime empty-wrapper checks no longer need special-card wrapper.
s=s.replace(', .xiaoshu-card-message-outer, .xiaoshu-media-message-outer', ', .xiaoshu-media-message-outer')

# 11) Theme compatibility EXCLUDE: remove the three retired card classes only.
replace_once(".voice-message-bubble,.red-packet-card,.transfer-bubble,.message-card", ".voice-message-bubble,.message-card", 'theme EXCLUDE commerce cards')
replace_once(",.xiaoshu-coupon-chat-card,[data-chat-card]", ",[data-chat-card]", 'theme EXCLUDE coupon card')

s=re.sub(r'\n{4,}','\n\n\n',s)

forbidden=[
    'transferData','savedTransferData','redPacket','red-packet','red-packet-card','transfer-bubble',
    'xiaoshu-coupon-chat-card','relation-coupon','renderRedPacketMessage','showRedPacketReceiveModal',
    'trySystemRedPacket','tryCollectPendingRedPacket','checkRedPacketExpiry',
    "kind === 'coupon'","kind === 'transfer'","return 'coupon'","return 'transfer'",
    "type === 'red-packet'",'红包','转账','xsGetChatCardKind','xsWhitelistedChatCardKind','xsSanitizeWhitelistedCardHtml',
    'xiaoshu-card-message-outer','card-message-wrapper'
]
rem={x:s.count(x) for x in forbidden if s.count(x)}
if rem:
    print('FORBIDDEN RESIDUES',rem)
    for n,line in enumerate(s.splitlines(),1):
        hits=[x for x in rem if x in line]
        if hits: print(n,hits,line[:2000])
    raise SystemExit(1)

required=['voice-message-bubble','message-image','message-video','xs-quote-box','收藏','朋友圈','相册','相机','电话','短信','callRecordsV2','xiaoshu-exit-button-style']
missing=[x for x in required if x not in s]
if missing: raise SystemExit('missing required features '+repr(missing))

src.write_text(s,encoding='utf-8')
print('OK bytes',len(before.encode()),'->',len(s.encode()))
print('theme selectors removed',removed,'keyboard',removed2,'core-style',n3)
print('transferData count',s.count('transferData'),'redPacket',s.count('redPacket'),'coupon lower',s.lower().count('coupon'),'红包',s.count('红包'),'转账',s.count('转账'))
