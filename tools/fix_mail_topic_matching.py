#!/usr/bin/env python3
from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

old = "function cardScore(card,source){var score=Math.random()*1.5,text=String(source||''),topics=[['想念','想你想念惦记见面陪抱'],['情绪','累困疲惫难过委屈哭疼'],['开心','开心高兴快乐喜欢幸福笑'],['日常','今天最近吃饭睡觉工作学习天气'],['亲密','喜欢爱在意亲亲抱抱宝贝老公']];topics.forEach(function(group){var hitSource=Array.from(group[1]).some(function(ch){return text.indexOf(ch)>=0}),hitCard=Array.from(group[1]).some(function(ch){return card.text.indexOf(ch)>=0});if(hitSource&&hitCard)score+=4});var chars=new Set(text.replace(/[\\s，。！？、；：“”‘’的了我你他她它是在有和就也都而很]/g,'').split(''));chars.forEach(function(ch){if(ch&&card.text.indexOf(ch)>=0)score+=.35});if(state.recentCardKeys.indexOf(card.text)>=0)score-=5;if(card.text.length>=6&&card.text.length<=70)score+=1;return score}"

new = "function cardScore(card,source){var score=Math.random()*1.5,text=String(source||''),topics=[['想念',['想你','想念','惦记','挂念','见面','陪伴','陪你','抱你','抱抱']],['情绪',['累','困','疲惫','难过','委屈','想哭','哭','疼']],['开心',['开心','高兴','快乐','喜欢','幸福','笑']],['日常',['今天','最近','吃饭','睡觉','工作','学习','天气']],['亲密',['喜欢你','爱你','爱','在意','亲亲','抱抱','老公']]];topics.forEach(function(group){var terms=group[1],hitSource=terms.some(function(term){return text.indexOf(term)>=0}),hitCard=terms.some(function(term){return card.text.indexOf(term)>=0});if(hitSource&&hitCard)score+=4});var chars=new Set(text.replace(/[\\s，。！？、；：“”‘’的了我你他她它是在有和就也都而很]/g,'').split(''));chars.forEach(function(ch){if(ch&&card.text.indexOf(ch)>=0)score+=.35});if(state.recentCardKeys.indexOf(card.text)>=0)score-=5;if(card.text.length>=6&&card.text.length<=70)score+=1;return score}"

count = text.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one old cardScore(), found {count}')

text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
print('patched mailbox topic matching')
