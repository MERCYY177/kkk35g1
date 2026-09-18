#!/usr/bin/env python3
from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old="function cardBody(cards){if(!cards.length)return'';var lines=cards.map(punctuate);return lines.some(function(x){return x.length>55})?lines.join('\\n\\n'):lines.join('')}"
new="function cardBody(cards){if(!cards.length)return'';var lines=cards.map(punctuate).filter(Boolean),paras=[],buf='';lines.forEach(function(line){if(line.length>55){if(buf){paras.push(buf);buf=''}paras.push(line);return}if(buf&&buf.length+line.length>70){paras.push(buf);buf=line}else{buf+=line}});if(buf)paras.push(buf);return paras.join('\\n\\n')}"
if s.count(old)!=1: raise SystemExit(f'expected one old cardBody, found {s.count(old)}')
p.write_text(s.replace(old,new,1),encoding='utf-8')
print('patched mail card paragraph grouping')
