#!/usr/bin/env python3
from pathlib import Path
import subprocess, tempfile

html=Path('index.html').read_text(encoding='utf-8')

def extract_function(name):
    marker=f'function {name}('
    start=html.find(marker)
    if start<0: raise AssertionError(f'missing function: {name}')
    brace=html.find('{',start); depth=0; quote=None; esc=False
    for i in range(brace,len(html)):
        ch=html[i]
        if quote:
            if esc: esc=False
            elif ch=='\\': esc=True
            elif ch==quote: quote=None
        else:
            if ch in "'\"`": quote=ch
            elif ch=='{': depth+=1
            elif ch=='}':
                depth-=1
                if depth==0:return html[start:i+1]
    raise AssertionError('unclosed function')

show=extract_function('showIncoming')
node=f"""
const assert=require('assert');
let active=null,incoming=null,incomingExpiry=null;
let cfg={{enabled:true,allowIncoming:true,allowVoiceIncoming:true,allowVideoIncoming:true}};
let host={{classList:{{add:()=>{{}},remove:()=>{{}}}},innerHTML:''}};
function sid(){{return 'A'}}
function settingsFor(){{return cfg}}
function profile(){{return {{partnerAvatar:'',partnerName:'P'}}}}
function incomingHost(){{return host}}
function avatarHTML(){{return ''}}
function esc(x){{return String(x)}}
function writeEventOnce(){{}}
function recordStatus(){{}}
function clearIncoming(){{incoming=null}}
function scheduleIncoming(){{}}
function setTimeout(){{return 1}}
function clearTimeout(){{}}
{show}
function reset(next){{active=null;incoming=null;incomingExpiry=null;cfg=Object.assign({{enabled:true,allowIncoming:true,allowVoiceIncoming:true,allowVideoIncoming:true}},next||{{}});}}
reset({{allowVoiceIncoming:false,allowVideoIncoming:true}});
assert.strictEqual(showIncoming('voice','A'),false,'voice incoming must be blocked when voice incoming is disabled');
assert.strictEqual(incoming,null,'blocked voice incoming must not create incoming state');
assert.strictEqual(showIncoming('video','A'),false,'showIncoming keeps its historical false return even when it displays');
assert.ok(incoming&&incoming.kind==='video','video incoming must still display when video incoming is enabled');
reset({{allowVoiceIncoming:true,allowVideoIncoming:false}});
showIncoming('video','A');
assert.strictEqual(incoming,null,'video incoming must be blocked when video incoming is disabled');
showIncoming('voice','A');
assert.ok(incoming&&incoming.kind==='voice','voice incoming must still display when voice incoming is enabled');
reset({{allowVoiceIncoming:false,allowVideoIncoming:false}});
showIncoming('voice','A'); assert.strictEqual(incoming,null);
showIncoming('video','A'); assert.strictEqual(incoming,null);
console.log('incoming call type guard checks passed');
"""
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:f.write(node); name=f.name
r=subprocess.run(['node',name],text=True,capture_output=True)
print(r.stdout,end='');print(r.stderr,end='');raise SystemExit(r.returncode)
