#!/usr/bin/env python3
from pathlib import Path

path=Path('index.html')
text=path.read_text(encoding='utf-8')
old="""async function hydrateRecords(sessionId){sessionId=String(sessionId||sid());var scoped=null;try{if(window.localforage)scoped=await localforage.getItem(keyFor(sessionId,RECORD_SUFFIX))}catch(e){}var list=normalizeRecords(scoped||readLS(keyFor(sessionId,RECORD_SUFFIX),[]));
if(!list.length){var claimKey=prefix()+'callRecordsV2LegacyClaim',claim='';try{claim=localStorage.getItem(claimKey)||''}catch(e){}if(!claim||claim===sessionId){var legacy=[];LEGACY_KEYS.forEach(function(k){legacy=legacy.concat(normalizeRecords(readLS(k,[])))});if(window.localforage)for(var i=0;i<LEGACY_KEYS.length;i++){try{legacy=legacy.concat(normalizeRecords(await localforage.getItem(LEGACY_KEYS[i])))}catch(e){}}list=normalizeRecords(legacy).map(function(x){x.sessionId=sessionId;x.migratedFromLegacy=true;return x});if(list.length){try{localStorage.setItem(claimKey,sessionId)}catch(e){}saveRecords(sessionId,list)}}}
recordCache[sessionId]=list;publishRecords(sessionId);return list}"""
new="""function legacyRecordsForSession(legacy,sessionId){sessionId=String(sessionId||'');var ids=[];try{var src=Array.isArray(window.sessionList)?window.sessionList:(typeof sessionList!=='undefined'&&Array.isArray(sessionList)?sessionList:[]),seen=Object.create(null);src.forEach(function(s){var id=s&&s.id!=null?String(s.id):'';if(id&&!seen[id]){seen[id]=1;ids.push(id)}})}catch(e){}var allowUnscoped=ids.length===1&&ids[0]===sessionId;return normalizeRecords(legacy).filter(function(x){var owner=x&&x.sessionId!=null?String(x.sessionId):'';return owner?owner===sessionId:allowUnscoped}).map(function(x){x.sessionId=sessionId;x.migratedFromLegacy=true;return x})}
async function hydrateRecords(sessionId){sessionId=String(sessionId||sid());var scoped=null;try{if(window.localforage)scoped=await localforage.getItem(keyFor(sessionId,RECORD_SUFFIX))}catch(e){}var list=normalizeRecords(scoped||readLS(keyFor(sessionId,RECORD_SUFFIX),[]));
if(!list.length){var legacy=[];LEGACY_KEYS.forEach(function(k){legacy=legacy.concat(normalizeRecords(readLS(k,[])))});if(window.localforage)for(var i=0;i<LEGACY_KEYS.length;i++){try{legacy=legacy.concat(normalizeRecords(await localforage.getItem(LEGACY_KEYS[i])))}catch(e){}}list=legacyRecordsForSession(legacy,sessionId);if(list.length)saveRecords(sessionId,list)}
recordCache[sessionId]=list;publishRecords(sessionId);return list}"""
if text.count(old)!=1:
    raise SystemExit(f'expected one legacy hydrateRecords block, found {text.count(old)}')
text=text.replace(old,new,1)
path.write_text(text,encoding='utf-8')
print('patched legacy call ownership migration')
