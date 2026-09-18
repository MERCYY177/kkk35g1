from pathlib import Path
import re

path = Path('index.html')
text = path.read_text(encoding='utf-8')
original = text


def replace_all(old: str, new: str, label: str, minimum: int = 1):
    global text
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f'{label}: expected at least {minimum} occurrence(s), found {count}')
    text = text.replace(old, new)
    print(f'{label}: replaced {count}')


def regex_once(pattern: str, repl: str, label: str):
    global text
    text2, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 regex match, found {count}')
    text = text2
    print(f'{label}: replaced')

# 1) Chat behavior defaults.
replace_all(
    "autoSendEnabled: false,\nautoSendInterval: 5,",
    "autoSendEnabled: false,\nautoSendInterval: 5,\nautoStickerEnabled: false,\nautoStickerChance: 25,\nrandomCardComboEnabled: true,\nrandomCardComboMax: 3,",
    'chat behavior defaults'
)

# 2) Active sending can independently choose a sticker instead of a text/card reply.
replace_all(
    "if (!document.body.classList.contains('batch-favorite-mode')) {\nsimulateReply();\n}",
    "if (!document.body.classList.contains('batch-favorite-mode')) {\nconst __xsAutoStickerChance = Math.max(0, Math.min(100, Number(settings.autoStickerChance == null ? 25 : settings.autoStickerChance))) / 100;\nif (settings.autoStickerEnabled && Math.random() < __xsAutoStickerChance && window.xiaoshuSendPartnerStickerNow && window.xiaoshuSendPartnerStickerNow()) return;\nsimulateReply();\n}",
    'auto sticker timer wiring'
)

# 3) Random card combination can be disabled and capped at 2 or 3 cards.
replace_all(
    "const replyCount = Math.random() < 0.75 ? 1 : (Math.random() < 0.95 ? 2 : 3);",
    "let replyCount = 1;\n            if(!settings.randomCardComboEnabled) {\n                replyCount = 1;\n            } else {\n                const __xsComboMax = Math.max(2, Math.min(3, Number(settings.randomCardComboMax) || 3));\n                replyCount = Math.min(__xsComboMax, Math.random() < 0.75 ? 1 : (Math.random() < 0.95 ? 2 : 3));\n            }",
    'random card combo wiring'
)

# 4) Mailbox settings UI.
mail_old = """      <div class=\"xs-mail-settings-title\" id=\"xsMailSettingsTitle\">信箱设置</div>
      <div class=\"xs-mail-settings-sub\">设置只影响以后新生成的主动来信和自动回信。</div>
      <label class=\"xs-mail-settings-row\"><span>每封信最少使用</span><span><input id=\"xsMailCardMin\" type=\"number\" min=\"1\" max=\"10\" step=\"1\" inputmode=\"numeric\"/><span class=\"xs-mail-settings-unit\"> 张字卡</span></span></label>"""
mail_new = """      <div class=\"xs-mail-settings-title\" id=\"xsMailSettingsTitle\">信箱设置</div>
      <div class=\"xs-mail-settings-sub\">设置只影响以后新生成的主动来信和自动回信。</div>
      <label class=\"xs-mail-settings-row\"><span>允许主动来信</span><input id=\"xsMailIncomingEnabled\" type=\"checkbox\"/></label>
      <label class=\"xs-mail-settings-row\"><span>主动来信间隔</span><span><input id=\"xsMailIncomingMin\" type=\"number\" min=\"1\" max=\"168\" step=\"1\" inputmode=\"numeric\"/><span class=\"xs-mail-settings-unit\"> ～ </span><input id=\"xsMailIncomingMax\" type=\"number\" min=\"1\" max=\"168\" step=\"1\" inputmode=\"numeric\"/><span class=\"xs-mail-settings-unit\"> 小时</span></span></label>
      <label class=\"xs-mail-settings-row\"><span>自动回信</span><input id=\"xsMailAutoReplyEnabled\" type=\"checkbox\"/></label>
      <label class=\"xs-mail-settings-row\"><span>自动回信等待</span><span><input id=\"xsMailReplyMin\" type=\"number\" min=\"1\" max=\"1440\" step=\"1\" inputmode=\"numeric\"/><span class=\"xs-mail-settings-unit\"> ～ </span><input id=\"xsMailReplyMax\" type=\"number\" min=\"1\" max=\"1440\" step=\"1\" inputmode=\"numeric\"/><span class=\"xs-mail-settings-unit\"> 分钟</span></span></label>
      <label class=\"xs-mail-settings-row\"><span>每封信最少使用</span><span><input id=\"xsMailCardMin\" type=\"number\" min=\"1\" max=\"10\" step=\"1\" inputmode=\"numeric\"/><span class=\"xs-mail-settings-unit\"> 张字卡</span></span></label>"""
replace_all(mail_old, mail_new, 'mailbox settings UI')

# 5) Mailbox state gains persisted timing/enable fields while preserving legacy mail data.
replace_all(
    "var KEY='mailboxLettersV1',DEFAULT_CARD_MIN=2,DEFAULT_CARD_MAX=4,state={version:4,items:[],pending:[],nextIncomingAt:0,recentCardKeys:[],cardCountMin:DEFAULT_CARD_MIN,cardCountMax:DEFAULT_CARD_MAX}",
    "var KEY='mailboxLettersV1',DEFAULT_CARD_MIN=2,DEFAULT_CARD_MAX=4,state={version:5,items:[],pending:[],nextIncomingAt:0,recentCardKeys:[],cardCountMin:DEFAULT_CARD_MIN,cardCountMax:DEFAULT_CARD_MAX,allowIncomingLetters:true,incomingDelayMinMinutes:720,incomingDelayMaxMinutes:2160,autoReplyEnabled:true,replyDelayMinMinutes:2,replyDelayMaxMinutes:15}",
    'mailbox initial state'
)

regex_once(
    r"function safeState\(v\)\{.*?\}\nasync function load",
    """function safeState(v){
var items=v&&Array.isArray(v.items)?v.items:[],pending=v&&Array.isArray(v.pending)?v.pending:[],min=validCardCount(v&&v.cardCountMin,DEFAULT_CARD_MIN),max=validCardCount(v&&v.cardCountMax,DEFAULT_CARD_MAX);
if(min>max){min=DEFAULT_CARD_MIN;max=DEFAULT_CARD_MAX}
var incomingMin=Math.max(60,Math.min(10080,Number(v&&v.incomingDelayMinMinutes)||720)),incomingMax=Math.max(60,Math.min(10080,Number(v&&v.incomingDelayMaxMinutes)||2160));
if(incomingMin>incomingMax){incomingMin=720;incomingMax=2160}
var replyMin=Math.max(1,Math.min(1440,Number(v&&v.replyDelayMinMinutes)||2)),replyMax=Math.max(1,Math.min(1440,Number(v&&v.replyDelayMaxMinutes)||15));
if(replyMin>replyMax){replyMin=2;replyMax=15}
return{version:5,items:items.filter(function(x){return x&&x.id&&(x.type==='sent'||x.type==='received')}).map(function(x){return{id:String(x.id),type:x.type,title:String(x.title||''),content:String(x.content||''),createdAt:Number(x.createdAt)||Date.now(),read:x.type==='sent'?true:!!x.read,originalContent:String(x.originalContent||''),replyToId:String(x.replyToId||''),cardFragments:(Array.isArray(x.cardFragments)?x.cardFragments:[]).map(function(t){return String(t||'').trim()}).filter(Boolean).slice(0,10)}}),pending:pending.filter(function(x){return x&&x.id&&x.kind==='reply'&&x.sourceId&&Number(x.dueAt)>0}).map(function(x){return{id:String(x.id),kind:'reply',sourceId:String(x.sourceId),dueAt:Number(x.dueAt)}}),nextIncomingAt:Number(v&&v.nextIncomingAt)||0,recentCardKeys:(Array.isArray(v&&v.recentCardKeys)?v.recentCardKeys:[]).map(function(t){return String(t||'')}).filter(Boolean).slice(-24),cardCountMin:min,cardCountMax:max,allowIncomingLetters:!(v&&v.allowIncomingLetters===false),incomingDelayMinMinutes:incomingMin,incomingDelayMaxMinutes:incomingMax,autoReplyEnabled:!(v&&v.autoReplyEnabled===false),replyDelayMinMinutes:replyMin,replyDelayMaxMinutes:replyMax}}
async function load""",
    'mailbox safeState'
)

replace_all(
    "function ensureIncomingPlan(){if(state.nextIncomingAt)return false;state.nextIncomingAt=Date.now()+randomBetween(20*60000,90*60000);return true}",
    "function ensureIncomingPlan(){if(!state.allowIncomingLetters){state.nextIncomingAt=0;return false}if(state.nextIncomingAt)return false;state.nextIncomingAt=Date.now()+randomBetween(state.incomingDelayMinMinutes*60000,state.incomingDelayMaxMinutes*60000);return true}",
    'mailbox incoming planner'
)

replace_all(
    "if(ensureIncomingPlan())changed=true;if(state.nextIncomingAt<=now){",
    "if(ensureIncomingPlan())changed=true;if(state.allowIncomingLetters&&state.nextIncomingAt&&state.nextIncomingAt<=now){",
    'mailbox incoming due gate'
)
replace_all(
    "state.nextIncomingAt=now+randomBetween(12*60*60000,36*60*60000);",
    "state.nextIncomingAt=now+randomBetween(state.incomingDelayMinMinutes*60000,state.incomingDelayMaxMinutes*60000);",
    'mailbox recurring incoming delay'
)
replace_all(
    "state.pending.push({id:makeId('mail_job'),kind:'reply',sourceId:letter.id,dueAt:now+randomBetween(2*60000,15*60000)});ensureIncomingPlan();",
    "if(state.autoReplyEnabled)state.pending.push({id:makeId('mail_job'),kind:'reply',sourceId:letter.id,dueAt:now+randomBetween(state.replyDelayMinMinutes*60000,state.replyDelayMaxMinutes*60000)});ensureIncomingPlan();",
    'mailbox reply scheduling'
)
replace_all(
    "toast('信已寄出，对方会在稍后回信')",
    "toast(state.autoReplyEnabled?'信已寄出，对方会在稍后回信':'信已寄出')",
    'mailbox send toast'
)

regex_once(
    r"function openSettings\(\)\{el\('xsMailCardMin'\).*?function restoreCardCountDefaults\(\)\{.*?\}\nfunction emptyHtml",
    """function openSettings(){
el('xsMailIncomingEnabled').checked=!!state.allowIncomingLetters;
el('xsMailIncomingMin').value=Math.round(state.incomingDelayMinMinutes/60);
el('xsMailIncomingMax').value=Math.round(state.incomingDelayMaxMinutes/60);
el('xsMailAutoReplyEnabled').checked=!!state.autoReplyEnabled;
el('xsMailReplyMin').value=state.replyDelayMinMinutes;
el('xsMailReplyMax').value=state.replyDelayMaxMinutes;
el('xsMailCardMin').value=state.cardCountMin;el('xsMailCardMax').value=state.cardCountMax;el('xsMailSettingsError').textContent='';el('xsMailSettings').classList.add('show');el('xsMailSettings').setAttribute('aria-hidden','false');setTimeout(function(){try{el('xsMailIncomingEnabled').focus()}catch(e){}},50)}
function closeSettings(){var p=el('xsMailSettings');if(!p)return;p.classList.remove('show');p.setAttribute('aria-hidden','true');el('xsMailSettingsError').textContent=''}
function readMailboxSettings(){
var minRaw=String(el('xsMailCardMin').value||'').trim(),maxRaw=String(el('xsMailCardMax').value||'').trim();if(!/^(?:10|[1-9])$/.test(minRaw)||!/^(?:10|[1-9])$/.test(maxRaw))throw new Error('请输入 1～10 之间的字卡数量');var min=Number(minRaw),max=Number(maxRaw);if(min>max)throw new Error('最少字卡数不能大于最多字卡数');
var inMin=Number(el('xsMailIncomingMin').value),inMax=Number(el('xsMailIncomingMax').value),replyMin=Number(el('xsMailReplyMin').value),replyMax=Number(el('xsMailReplyMax').value);
if(!Number.isFinite(inMin)||!Number.isFinite(inMax)||inMin<1||inMax>168||inMin>inMax)throw new Error('主动来信间隔请输入 1～168 小时，且最短不能大于最长');
if(!Number.isFinite(replyMin)||!Number.isFinite(replyMax)||replyMin<1||replyMax>1440||replyMin>replyMax)throw new Error('自动回信等待请输入 1～1440 分钟，且最短不能大于最长');
return{min:min,max:max,allowIncomingLetters:el('xsMailIncomingEnabled').checked,incomingDelayMinMinutes:Math.round(inMin*60),incomingDelayMaxMinutes:Math.round(inMax*60),autoReplyEnabled:el('xsMailAutoReplyEnabled').checked,replyDelayMinMinutes:Math.round(replyMin),replyDelayMaxMinutes:Math.round(replyMax)}}
async function saveMailboxSettings(value,message){try{var saved=await queueState(async function(sid){var incomingChanged=state.allowIncomingLetters!==value.allowIncomingLetters||state.incomingDelayMinMinutes!==value.incomingDelayMinMinutes||state.incomingDelayMaxMinutes!==value.incomingDelayMaxMinutes;state.cardCountMin=value.min;state.cardCountMax=value.max;state.allowIncomingLetters=value.allowIncomingLetters;state.incomingDelayMinMinutes=value.incomingDelayMinMinutes;state.incomingDelayMaxMinutes=value.incomingDelayMaxMinutes;state.autoReplyEnabled=value.autoReplyEnabled;state.replyDelayMinMinutes=value.replyDelayMinMinutes;state.replyDelayMaxMinutes=value.replyDelayMaxMinutes;if(incomingChanged)state.nextIncomingAt=0;if(!state.autoReplyEnabled)state.pending=[];ensureIncomingPlan();await save(sid);return true});if(!saved)throw new Error('当前会话已经切换');closeSettings();toast(message||'信箱设置已保存')}catch(e){el('xsMailSettingsError').textContent='保存失败：'+(e.message||'未知错误')}}
function submitCardCountSettings(){try{saveMailboxSettings(readMailboxSettings())}catch(e){el('xsMailSettingsError').textContent=e.message}}
function restoreCardCountDefaults(){el('xsMailIncomingEnabled').checked=true;el('xsMailIncomingMin').value=12;el('xsMailIncomingMax').value=36;el('xsMailAutoReplyEnabled').checked=true;el('xsMailReplyMin').value=2;el('xsMailReplyMax').value=15;el('xsMailCardMin').value=DEFAULT_CARD_MIN;el('xsMailCardMax').value=DEFAULT_CARD_MAX;el('xsMailSettingsError').textContent='';saveMailboxSettings({min:DEFAULT_CARD_MIN,max:DEFAULT_CARD_MAX,allowIncomingLetters:true,incomingDelayMinMinutes:720,incomingDelayMaxMinutes:2160,autoReplyEnabled:true,replyDelayMinMinutes:2,replyDelayMaxMinutes:15},'信箱设置已恢复默认')}
function emptyHtml""",
    'mailbox settings handlers'
)

# 6) Call settings: voice/video incoming are independently controllable.
replace_all(
    "function defaultSettings(){return {version:2,enabled:true,allowIncoming:true,frequency:'low',nextIncomingAt:0,plannedSessionId:''}}",
    "function defaultSettings(){return {version:3,enabled:true,allowIncoming:true,allowVoiceIncoming:true,allowVideoIncoming:true,frequency:'low',nextIncomingAt:0,plannedSessionId:''}}",
    'call defaults'
)
replace_all(
    "function validSettings(v){var d=defaultSettings(),x=v&&typeof v==='object'?v:{};d.enabled=x.enabled!==false;d.allowIncoming=x.allowIncoming!==false;d.frequency=/^(low|medium|high)$/.test(x.frequency)?x.frequency:'low';d.nextIncomingAt=Math.max(0,Number(x.nextIncomingAt||0));d.plannedSessionId=String(x.plannedSessionId||'');return d}",
    "function validSettings(v){var d=defaultSettings(),x=v&&typeof v==='object'?v:{};d.enabled=x.enabled!==false;d.allowIncoming=x.allowIncoming!==false;d.allowVoiceIncoming=x.allowVoiceIncoming!==false;d.allowVideoIncoming=x.allowVideoIncoming!==false;d.frequency=/^(low|medium|high)$/.test(x.frequency)?x.frequency:'low';d.nextIncomingAt=Math.max(0,Number(x.nextIncomingAt||0));d.plannedSessionId=String(x.plannedSessionId||'');return d}",
    'call validation'
)
replace_all(
    "function frequencyDelay(f){var range=f==='high'?[10,30]:f==='medium'?[30,90]:[60,180];return (range[0]+Math.random()*(range[1]-range[0]))*60000}",
    "function frequencyDelay(f){var range=f==='high'?[10,30]:f==='medium'?[30,90]:[60,180];return (range[0]+Math.random()*(range[1]-range[0]))*60000}\nfunction pickIncomingKind(c){if(!c||!c.allowIncoming)return null;if(c.allowVoiceIncoming&&c.allowVideoIncoming)return Math.random()<.25?'video':'voice';if(c.allowVideoIncoming)return 'video';if(c.allowVoiceIncoming)return 'voice';return null}",
    'call incoming kind selector'
)
replace_all(
    "function scheduleIncoming(force){if(incomingTimer){clearTimeout(incomingTimer);incomingTimer=null}var sessionId=sid();if(!sessionId)return;var cfg=settingsFor(sessionId);if(!cfg.enabled||!cfg.allowIncoming)return;if(force||cfg.plannedSessionId!==sessionId||!cfg.nextIncomingAt){cfg.plannedSessionId=sessionId;cfg.nextIncomingAt=Date.now()+frequencyDelay(cfg.frequency);saveSettingsQuiet(sessionId,cfg)}var wait=Math.max(0,cfg.nextIncomingAt-Date.now());incomingTimer=setTimeout(function(){incomingTimer=null;if(document.hidden)return;if(sid()!==cfg.plannedSessionId){scheduleIncoming(true);return}if(active||incoming){scheduleIncoming(true);return}cfg.nextIncomingAt=0;saveSettingsQuiet(sessionId,cfg);showIncoming(Math.random()<.25?'video':'voice',sessionId)},Math.min(wait,2147483000))}",
    "function scheduleIncoming(force){if(incomingTimer){clearTimeout(incomingTimer);incomingTimer=null}var sessionId=sid();if(!sessionId)return;var cfg=settingsFor(sessionId);if(!cfg.enabled||!cfg.allowIncoming||!pickIncomingKind(cfg))return;if(force||cfg.plannedSessionId!==sessionId||!cfg.nextIncomingAt){cfg.plannedSessionId=sessionId;cfg.nextIncomingAt=Date.now()+frequencyDelay(cfg.frequency);saveSettingsQuiet(sessionId,cfg)}var wait=Math.max(0,cfg.nextIncomingAt-Date.now());incomingTimer=setTimeout(function(){incomingTimer=null;if(document.hidden)return;if(sid()!==cfg.plannedSessionId){scheduleIncoming(true);return}if(active||incoming){scheduleIncoming(true);return}cfg.nextIncomingAt=0;saveSettingsQuiet(sessionId,cfg);var kind=pickIncomingKind(cfg);if(kind)showIncoming(kind,sessionId)},Math.min(wait,2147483000))}",
    'call scheduler'
)

# Header phone button becomes a three-dot menu button.
replace_all('#xs-chat-call-button', '#xs-chat-more-button', 'call header CSS selector')
replace_all(
    "function ensureCallButton(){var right=$('xs-stable-right');if(!right)return null;var b=$('xs-chat-more-button');if(!b){b=document.createElement('button');b.id='xs-chat-more-button';b.type='button';b.setAttribute('aria-label','发起通话');b.setAttribute('title','发起通话');b.innerHTML='<i class=\"fas fa-phone\"></i>';right.appendChild(b)}return b}",
    "function ensureCallButton(){var right=$('xs-stable-right');if(!right)return null;var b=$('xs-chat-more-button');if(!b){b=document.createElement('button');b.id='xs-chat-more-button';b.type='button';b.setAttribute('aria-label','更多');b.setAttribute('title','更多');b.innerHTML='<i class=\"fas fa-ellipsis-h\"></i>';right.appendChild(b)}return b}",
    'three-dot header button'
)
replace_all(
    "function updateCallButton(){var b=ensureCallButton();if(b)b.hidden=!settingsFor(sid()).enabled}",
    "function updateCallButton(){var b=ensureCallButton();if(b)b.hidden=false}",
    'three-dot visibility'
)
replace_all(
    "function openSettings(){var c=settingsFor(sid()),h=settingsPanel();h.innerHTML='<div class=\"xs-call-setting-card\" role=\"dialog\" aria-label=\"模拟通话设置\"><div class=\"xs-call-setting-title\">模拟通话</div><div class=\"xs-call-setting-row\"><div><label for=\"xs-call-enabled\">启用模拟通话</label><small>关闭后隐藏聊天顶部电话按钮</small></div><input id=\"xs-call-enabled\" type=\"checkbox\" '+(c.enabled?'checked':'')+'></div><div class=\"xs-call-setting-row\"><div><label for=\"xs-call-incoming-enabled\">允许对方主动来电</label><small>全局显示模拟来电浮层</small></div><input id=\"xs-call-incoming-enabled\" type=\"checkbox\" '+(c.allowIncoming?'checked':'')+'></div><div class=\"xs-call-setting-row\"><div><label for=\"xs-call-frequency\">来电频率</label><small>低 60～180 分钟 · 中 30～90 分钟 · 高 10～30 分钟</small></div><select id=\"xs-call-frequency\"><option value=\"low\" '+(c.frequency==='low'?'selected':'')+'>低</option><option value=\"medium\" '+(c.frequency==='medium'?'selected':'')+'>中</option><option value=\"high\" '+(c.frequency==='high'?'selected':'')+'>高</option></select></div><div class=\"xs-call-setting-actions\"><button type=\"button\" data-v118-settings-cancel>取消</button><button type=\"button\" class=\"primary\" data-v118-settings-save>保存</button></div></div>';h.classList.add('show');return false}",
    "function openSettings(){var c=settingsFor(sid()),h=settingsPanel();h.innerHTML='<div class=\"xs-call-setting-card\" role=\"dialog\" aria-label=\"模拟通话设置\"><div class=\"xs-call-setting-title\">模拟通话</div><div class=\"xs-call-setting-row\"><div><label for=\"xs-call-enabled\">启用模拟通话</label><small>控制语音和视频通话功能</small></div><input id=\"xs-call-enabled\" type=\"checkbox\" '+(c.enabled?'checked':'')+'></div><div class=\"xs-call-setting-row\"><div><label for=\"xs-call-incoming-enabled\">允许对方主动来电</label><small>关闭后不会出现主动来电</small></div><input id=\"xs-call-incoming-enabled\" type=\"checkbox\" '+(c.allowIncoming?'checked':'')+'></div><div class=\"xs-call-setting-row\"><div><label for=\"xs-call-voice-incoming\">允许主动语音来电</label></div><input id=\"xs-call-voice-incoming\" type=\"checkbox\" '+(c.allowVoiceIncoming?'checked':'')+'></div><div class=\"xs-call-setting-row\"><div><label for=\"xs-call-video-incoming\">允许主动视频来电</label></div><input id=\"xs-call-video-incoming\" type=\"checkbox\" '+(c.allowVideoIncoming?'checked':'')+'></div><div class=\"xs-call-setting-row\"><div><label for=\"xs-call-frequency\">来电频率</label><small>低 60～180 分钟 · 中 30～90 分钟 · 高 10～30 分钟</small></div><select id=\"xs-call-frequency\"><option value=\"low\" '+(c.frequency==='low'?'selected':'')+'>低</option><option value=\"medium\" '+(c.frequency==='medium'?'selected':'')+'>中</option><option value=\"high\" '+(c.frequency==='high'?'selected':'')+'>高</option></select></div><div class=\"xs-call-setting-actions\"><button type=\"button\" data-v118-settings-cancel>取消</button><button type=\"button\" class=\"primary\" data-v118-settings-save>保存</button></div></div>';h.classList.add('show');return false}",
    'call settings panel'
)
replace_all(
    "function saveSettingsFromPanel(){var sessionId=sid(),old=settingsFor(sessionId),enabled=$('xs-call-enabled').checked,allow=$('xs-call-incoming-enabled').checked,f=$('xs-call-frequency').value;saveSettings(sessionId,{version:2,enabled:enabled,allowIncoming:allow,frequency:f,nextIncomingAt:(old.frequency===f?old.nextIncomingAt:0),plannedSessionId:(old.frequency===f?old.plannedSessionId:'')});closeSettings();if(!enabled){if(incoming)rejectIncoming();if(active)completeCall('disabled');if(incomingTimer){clearTimeout(incomingTimer);incomingTimer=null}}toast('模拟通话设置已保存');return false}",
    "function saveSettingsFromPanel(){var sessionId=sid(),old=settingsFor(sessionId),enabled=$('xs-call-enabled').checked,allow=$('xs-call-incoming-enabled').checked,voice=$('xs-call-voice-incoming').checked,video=$('xs-call-video-incoming').checked,f=$('xs-call-frequency').value;var scheduleSame=old.frequency===f&&old.allowIncoming===allow&&old.allowVoiceIncoming===voice&&old.allowVideoIncoming===video;saveSettings(sessionId,{version:3,enabled:enabled,allowIncoming:allow,allowVoiceIncoming:voice,allowVideoIncoming:video,frequency:f,nextIncomingAt:(scheduleSame?old.nextIncomingAt:0),plannedSessionId:(scheduleSame?old.plannedSessionId:'')});closeSettings();if(!enabled){if(incoming)rejectIncoming();if(active)completeCall('disabled');if(incomingTimer){clearTimeout(incomingTimer);incomingTimer=null}}toast('模拟通话设置已保存');return false}",
    'call settings save'
)

# Add three-dot menu functions immediately before the call binder.
more_funcs = """function moreMenu(){var h=$('xs-chat-more-menu');if(!h){h=document.createElement('div');h.id='xs-chat-more-menu';h.className='xs-chat-more-menu';document.body.appendChild(h)}return h}
function closeMoreMenu(){var h=$('xs-chat-more-menu');if(h){h.classList.remove('show');h.innerHTML=''}return false}
function toggleMoreMenu(){var b=ensureCallButton(),h=moreMenu();if(h.classList.contains('show'))return closeMoreMenu();var c=settingsFor(sid()),r=b.getBoundingClientRect();h.innerHTML='<button type=\"button\" data-v118-more-call=\"voice\" '+(c.enabled?'':'disabled')+'><i class=\"fas fa-phone\"></i><span>语音通话</span></button><button type=\"button\" data-v118-more-call=\"video\" '+(c.enabled?'':'disabled')+'><i class=\"fas fa-video\"></i><span>视频通话</span></button><button type=\"button\" data-v118-more-settings><i class=\"fas fa-cog\"></i><span>通话设置</span></button>';h.style.top=Math.min(innerHeight-170,r.bottom+6)+'px';h.style.right=Math.max(8,innerWidth-r.right)+'px';h.classList.add('show');return false}
"""
replace_all('function bind(){document.addEventListener(\'click\',function(e){var t=e.target&&e.target.closest;if(!t)return;', more_funcs + "function bind(){document.addEventListener('click',function(e){var t=e.target&&e.target.closest;if(!t)return;", 'call three-dot menu functions')
replace_all(
    "var b=t.call(e.target,'#xs-chat-more-button');if(b){e.preventDefault();return restoreOrOpen()}if(t.call(e.target,'[data-v118-call-close]'))return closeChoice();",
    "var b=t.call(e.target,'#xs-chat-more-button');if(b){e.preventDefault();e.stopPropagation();return toggleMoreMenu()}var mc=t.call(e.target,'[data-v118-more-call]');if(mc){e.preventDefault();closeMoreMenu();return startOutgoing(mc.getAttribute('data-v118-more-call'))}if(t.call(e.target,'[data-v118-more-settings]')){e.preventDefault();closeMoreMenu();return openSettings()}if(!t.call(e.target,'#xs-chat-more-menu'))closeMoreMenu();if(t.call(e.target,'[data-v118-call-close]'))return closeChoice();",
    'call three-dot click handling'
)
replace_all(
    "if(c.nextIncomingAt&&c.nextIncomingAt<=Date.now()&&!active&&!incoming)showIncoming(Math.random()<.25?'video':'voice',sid());else scheduleIncoming(false)",
    "if(c.nextIncomingAt&&c.nextIncomingAt<=Date.now()&&!active&&!incoming){var kind=pickIncomingKind(c);if(kind)showIncoming(kind,sid())}else scheduleIncoming(false)",
    'call foreground incoming type'
)

# 7) Add chat behavior controls + standalone partner sticker sender and menu styling.
addon = r'''
<style id="xiaoshu-behavior-settings-v1-css">
#xs-chat-more-button{position:relative}
.xs-chat-more-menu{position:fixed;z-index:1000010;display:none;min-width:168px;padding:8px;border:1px solid var(--border-color);border-radius:16px;background:var(--secondary-bg);box-shadow:0 14px 40px rgba(0,0,0,.22);font-family:var(--font-family)}
.xs-chat-more-menu.show{display:grid;gap:4px}.xs-chat-more-menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:0 12px;border:0;border-radius:11px;background:transparent;color:var(--text-primary);font:inherit;text-align:left;cursor:pointer}.xs-chat-more-menu button:hover{background:var(--primary-bg)}.xs-chat-more-menu button:disabled{opacity:.4;cursor:not-allowed}.xs-chat-more-menu i{width:18px;text-align:center}
.xs-behavior-inline{margin-top:10px;border-top:1px solid var(--border-color);padding-top:8px}.xs-behavior-select{min-width:88px;height:36px;border:1px solid var(--border-color);border-radius:10px;background:var(--primary-bg);color:var(--text-primary);padding:0 8px}
</style>
<script id="xiaoshu-behavior-settings-v1">(function(){
'use strict';
if(window.__xiaoshuBehaviorSettingsV1)return;window.__xiaoshuBehaviorSettingsV1=true;
function S(){try{return settings}catch(e){return window.settings||{}}}
function persist(){try{if(typeof throttledSaveData==='function')return throttledSaveData()}catch(e){}try{if(window.saveData)return window.saveData()}catch(e){}}
function normalize(){var s=S();if(typeof s.autoStickerEnabled!=='boolean')s.autoStickerEnabled=false;if(!Number.isFinite(Number(s.autoStickerChance)))s.autoStickerChance=25;s.autoStickerChance=Math.max(0,Math.min(100,Number(s.autoStickerChance)));if(typeof s.randomCardComboEnabled!=='boolean')s.randomCardComboEnabled=true;s.randomCardComboMax=Math.max(2,Math.min(3,Number(s.randomCardComboMax)||3));return s}
window.xiaoshuSendPartnerStickerNow=function(){var s=normalize(),pool=[];try{if(window.xiaoshuStickerStore&&typeof window.xiaoshuStickerStore.getPool==='function')pool=window.xiaoshuStickerStore.getPool()||[];else if(typeof window.xiaoshuGetSharedStickerPool==='function')pool=window.xiaoshuGetSharedStickerPool()||[]}catch(e){pool=[]}pool=pool.filter(Boolean);if(!pool.length)return false;var raw=pool[Math.floor(Math.random()*pool.length)],stickerId='';try{if(window.xiaoshuStickerStore&&typeof window.xiaoshuStickerStore.register==='function')stickerId=window.xiaoshuStickerStore.register(raw)||''}catch(e){}if(!stickerId)return false;try{if(typeof addMessage!=='function')return false;addMessage({id:'auto_sticker_'+Date.now()+'_'+Math.random().toString(36).slice(2),sender:s.partnerName||'对方',text:'',timestamp:new Date(),stickerId:stickerId,messageKind:'sticker',status:'received',favorited:false,note:null,type:'normal',conversationId:'card'});try{if(typeof playSound==='function')playSound('message')}catch(e){}try{if(typeof window._sendPartnerNotification==='function')window._sendPartnerNotification(s.partnerName||'对方','[表情包]')}catch(e){}return true}catch(e){console.warn('[auto-sticker] 发送失败',e);return false}}
function mount(){var s=normalize(),auto=document.getElementById('auto-send-control'),autoCard=auto&&auto.closest('.cs-card');if(autoCard&&!document.getElementById('xs-auto-sticker-toggle')){var wrap=document.createElement('div');wrap.className='xs-behavior-inline';wrap.innerHTML='<div class="setting-pill-row" id="xs-auto-sticker-toggle"><span class="setting-pill-icon"><i class="fas fa-icons"></i></span><span class="setting-pill-label">主动发表情包</span><div class="setting-pill-switch"><div class="setting-pill-knob"></div></div></div><div id="xs-auto-sticker-control" class="cs-slider-row" style="display:none"><span class="cs-slider-label">出现概率</span><input class="font-size-slider" id="xs-auto-sticker-chance" max="100" min="0" step="5" type="range"><span class="cs-slider-val" id="xs-auto-sticker-chance-value"></span></div>';autoCard.appendChild(wrap);var toggle=wrap.querySelector('#xs-auto-sticker-toggle'),control=wrap.querySelector('#xs-auto-sticker-control'),slider=wrap.querySelector('#xs-auto-sticker-chance'),value=wrap.querySelector('#xs-auto-sticker-chance-value');function sync(){s=normalize();toggle.classList.toggle('active',!!s.autoStickerEnabled);control.style.display=s.autoStickerEnabled?'flex':'none';slider.value=s.autoStickerChance;value.textContent=s.autoStickerChance+'%'}toggle.addEventListener('click',function(){s.autoStickerEnabled=!s.autoStickerEnabled;sync();persist();try{if(typeof manageAutoSendTimer==='function')manageAutoSendTimer()}catch(e){}});slider.addEventListener('input',function(){s.autoStickerChance=Number(this.value);value.textContent=this.value+'%'});slider.addEventListener('change',persist);sync()}
if(autoCard&&!document.getElementById('xs-random-card-combo')){var label=document.createElement('p');label.className='cs-group-label';label.style.marginTop='4px';label.textContent='字卡回复';var card=document.createElement('div');card.className='cs-card';card.id='xs-random-card-combo';card.innerHTML='<div class="setting-pill-row" id="xs-random-card-combo-toggle"><span class="setting-pill-icon"><i class="fas fa-layer-group"></i></span><span class="setting-pill-label">随机组合字卡</span><div class="setting-pill-switch"><div class="setting-pill-knob"></div></div></div><div class="cs-slider-row" id="xs-random-card-combo-control"><span class="cs-slider-label">最多组合</span><select class="xs-behavior-select" id="xs-random-card-combo-max"><option value="2">2 张</option><option value="3">3 张</option></select></div>';var parent=autoCard.parentNode,ref=autoCard.nextSibling;parent.insertBefore(label,ref);parent.insertBefore(card,label.nextSibling);var ct=card.querySelector('#xs-random-card-combo-toggle'),cc=card.querySelector('#xs-random-card-combo-control'),cm=card.querySelector('#xs-random-card-combo-max');function syncCombo(){s=normalize();ct.classList.toggle('active',!!s.randomCardComboEnabled);cc.style.display=s.randomCardComboEnabled?'flex':'none';cm.value=String(s.randomCardComboMax)}ct.addEventListener('click',function(){s.randomCardComboEnabled=!s.randomCardComboEnabled;syncCombo();persist()});cm.addEventListener('change',function(){s.randomCardComboMax=Number(this.value);persist()});syncCombo()}}
function boot(){mount()}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();window.addEventListener('xiaoshu-session-data-ready',function(){setTimeout(mount,0)})
})();</script>
'''
if 'xiaoshu-behavior-settings-v1' in text:
    raise SystemExit('behavior addon already exists')
if '</body>' not in text:
    raise SystemExit('missing </body>')
text = text.replace('</body>', addon + '\n</body>', 1)
print('behavior addon: inserted')

if text == original:
    raise SystemExit('no changes made')
path.write_text(text, encoding='utf-8')
print('APPLY_BEHAVIOR_SETTINGS_OK')
