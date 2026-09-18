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

body=extract_function('cardBody')
node=f"""
const assert=require('assert');
function punctuate(x){{return String(x||'')}}
{body}
assert.strictEqual(cardBody([]),'','empty card list stays empty');
const a='甲'.repeat(20), b='乙'.repeat(20);
assert.strictEqual(cardBody([a,b]),a+b,'two short cards should remain in one paragraph');
const c='丙'.repeat(30), d='丁'.repeat(30), e='戊'.repeat(30);
assert.strictEqual(cardBody([c,d,e]),c+d+'\\n\\n'+e,'short cards should start a new paragraph when the accumulated paragraph becomes too long');
const s1='前'.repeat(10), s2='中'.repeat(10), long='长'.repeat(60), s3='后'.repeat(10), s4='尾'.repeat(10);
assert.strictEqual(cardBody([s1,s2,long,s3,s4]),s1+s2+'\\n\\n'+long+'\\n\\n'+s3+s4,'one long card should stand alone without forcing every short card into its own paragraph');
const order=['一'.repeat(25),'二'.repeat(25),'三'.repeat(25),'四'.repeat(25)];
const out=cardBody(order);
assert.ok(out.replace(/\\n/g,'')===order.join(''),'paragraphing must preserve exact card order and content');
console.log('mail card paragraph regression checks passed');
"""
with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:f.write(node); name=f.name
r=subprocess.run(['node',name],text=True,capture_output=True)
print(r.stdout,end=''); print(r.stderr,end=''); raise SystemExit(r.returncode)
