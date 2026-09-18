#!/usr/bin/env python3
from pathlib import Path
import subprocess, tempfile

html = Path('index.html').read_text(encoding='utf-8')

def extract_function(name):
    marker = f'function {name}('
    start = html.find(marker)
    if start < 0:
        raise AssertionError(f'missing function: {name}')
    return_start = start - 6 if start >= 6 and html[start-6:start] == 'async ' else start
    brace = html.find('{', start)
    depth = 0; quote = None; escaped = False
    for i in range(brace, len(html)):
        ch = html[i]
        if quote:
            if escaped: escaped = False
            elif ch == '\\': escaped = True
            elif ch == quote: quote = None
        else:
            if ch in "'\"`": quote = ch
            elif ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0: return html[return_start:i+1]
    raise AssertionError(f'unclosed function: {name}')

normalize = extract_function('normalizeRecords')
hydrate = extract_function('hydrateRecords')

node = f"""
const assert = require('assert');
{normalize}
{hydrate}
const RECORD_SUFFIX='callRecordsV2';
const LEGACY_KEYS=['xiaoshu_call_records_v1','ta_phone_call_records','xiaoshu_ta_phone_call_records_v1'];
let recordCache=Object.create(null), currentSid='A', sessionList=[];
const ls=Object.create(null), lf=Object.create(null), saved=Object.create(null);
const localStorage={{getItem:k=>Object.prototype.hasOwnProperty.call(ls,k)?ls[k]:null,setItem:(k,v)=>{{ls[k]=String(v)}},removeItem:k=>{{delete ls[k]}}}};
const localforage={{getItem:async k=>Object.prototype.hasOwnProperty.call(lf,k)?lf[k]:null,setItem:async(k,v)=>{{lf[k]=v}}}};
const window={{localforage,sessionList:[]}};
function sid(){{return currentSid}}
function prefix(){{return 'CHAT_APP_V3_'}}
function keyFor(sessionId,suffix){{return prefix()+String(sessionId||'')+'_'+suffix}}
function readLS(k,fallback){{if(!Object.prototype.hasOwnProperty.call(ls,k))return fallback;try{{return JSON.parse(ls[k])}}catch(e){{return fallback}}}}
function publishRecords(){{}}
function saveRecords(sessionId,list){{list=normalizeRecords(list);recordCache[String(sessionId)]=list;saved[String(sessionId)]=list;return list}}
function reset(sessions, legacy){{for(const k of Object.keys(ls))delete ls[k];for(const k of Object.keys(lf))delete lf[k];for(const k of Object.keys(saved))delete saved[k];recordCache=Object.create(null);sessionList=sessions.map(id=>({{id}}));window.sessionList=sessionList;ls[LEGACY_KEYS[0]]=JSON.stringify(legacy);}}

(async()=>{{
  reset(['A','B'], [{{id:'u1',time:1}}]);
  let out=await hydrateRecords('A');
  assert.deepStrictEqual(out, [], 'unscoped legacy calls must not be assigned to an arbitrary session when multiple sessions exist');

  reset(['A','B'], [{{id:'a1',time:1,sessionId:'A'}},{{id:'b1',time:2,sessionId:'B'}}]);
  out=await hydrateRecords('A');
  assert.deepStrictEqual(out.map(x=>x.id), ['a1'], 'session A must import only legacy records explicitly owned by A');
  recordCache=Object.create(null);
  out=await hydrateRecords('B');
  assert.deepStrictEqual(out.map(x=>x.id), ['b1'], 'session B must import only legacy records explicitly owned by B');

  reset(['A'], [{{id:'u1',time:1}}]);
  out=await hydrateRecords('A');
  assert.deepStrictEqual(out.map(x=>x.id), ['u1'], 'unscoped legacy calls may migrate when there is exactly one session');
  assert.strictEqual(out[0].sessionId,'A');
  assert.strictEqual(out[0].migratedFromLegacy,true);
  console.log('legacy call migration regression checks passed');
}})().catch(e=>{{console.error(e);process.exit(1)}});
"""
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:
    f.write(node); name=f.name
r=subprocess.run(['node',name],text=True,capture_output=True)
print(r.stdout,end=''); print(r.stderr,end='')
raise SystemExit(r.returncode)
