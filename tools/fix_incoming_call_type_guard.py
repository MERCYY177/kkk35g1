#!/usr/bin/env python3
from pathlib import Path

path=Path('index.html')
text=path.read_text(encoding='utf-8')
old="function showIncoming(kind,sessionId){if(active||incoming)return false;sessionId=String(sessionId||sid());if(sessionId!==sid())return false;var cfg=settingsFor(sessionId);if(!cfg.enabled||!cfg.allowIncoming)return false;var p=profile(sessionId),now=Date.now();incoming={id:'incoming_'+now+'_'+Math.random().toString(36).slice(2),sessionId:sessionId,kind:kind==='video'?'video':'voice',profile:p,startedAt:now,eventWritten:false};"
new="function showIncoming(kind,sessionId){if(active||incoming)return false;sessionId=String(sessionId||sid());if(sessionId!==sid())return false;var cfg=settingsFor(sessionId),requestedKind=kind==='video'?'video':'voice';if(!cfg.enabled||!cfg.allowIncoming||(requestedKind==='voice'&&!cfg.allowVoiceIncoming)||(requestedKind==='video'&&!cfg.allowVideoIncoming))return false;var p=profile(sessionId),now=Date.now();incoming={id:'incoming_'+now+'_'+Math.random().toString(36).slice(2),sessionId:sessionId,kind:requestedKind,profile:p,startedAt:now,eventWritten:false};"
if text.count(old)!=1: raise SystemExit(f'expected one showIncoming prefix, found {text.count(old)}')
text=text.replace(old,new,1)
path.write_text(text,encoding='utf-8')
print('patched incoming call type guard')
