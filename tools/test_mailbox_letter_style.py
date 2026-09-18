from pathlib import Path

text = Path('index.html').read_text(encoding='utf-8')

assert "el('xsMailViewGreeting').textContent='见字如面';" in text, 'mail greeting must be exactly 见字如面'
assert '刚刚想到你，就来写几句话。' not in text, 'contextual incoming lead still exists'
assert '早上忽然想写信给你。' not in text, 'morning incoming lead still exists'
assert '夜里安静下来，忽然很想给你留一封信。' not in text, 'night incoming lead still exists'
assert '你的信我认真看完了。' not in text, 'reply lead still exists'
assert '看到你写这些，我有一点心疼。' not in text, 'reply emotion lead still exists'
assert '读到这里的时候，我也跟着开心起来。' not in text, 'reply happy lead still exists'
assert '其实我也在想你，看到信的时候更明显了。' not in text, 'reply longing lead still exists'
assert '信收到啦，希望你今晚能睡得安稳。' not in text, 'reply sleep lead still exists'
assert "从 '+cards.length+' 张字卡里拼出了这封信" not in text, 'card trace label still exposed'
assert 'renderCardTrace(x)' not in text, 'card trace is still rendered in letter view'
assert 'function randomCardPunctuation()' in text, 'random punctuation helper missing'
assert "Math.random()<0.2?'！':(Math.random()<0.2?'...':'。')" in text, 'milk-style punctuation distribution missing'
assert "return text+randomCardPunctuation()" in text, 'card punctuation helper is not wired'
assert "content:body,cardFragments:cards" in text, 'generated letters must contain only card body'
print('MAILBOX_LETTER_STYLE_TEST_OK')
