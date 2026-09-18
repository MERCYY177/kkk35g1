from pathlib import Path
import re

p = Path('index.html')
s = p.read_text(encoding='utf-8')
original = s


def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, found {count}')
    s = s.replace(old, new, 1)
    print(label + ': OK')


def regex_once(pattern, repl, label):
    global s
    s2, count = re.subn(pattern, repl, s, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    s = s2
    print(label + ': OK')

# Remove the visible card-source trace from the letter view.
replace_once('          <div class="xs-mail-card-trace" id="xsMailCardTrace"><div class="xs-mail-card-trace-title" id="xsMailCardTraceTitle"></div><div class="xs-mail-card-chips" id="xsMailCardChips"></div></div>\n', '', 'remove card trace markup')

# Match milk's punctuation rhythm while preserving punctuation already present in a card.
replace_once(
    "function punctuate(text){text=String(text||'').trim();return text&&!/[。！？!?…]$/.test(text)?text+'。':text}",
    "function randomCardPunctuation(){return Math.random()<0.2?'！':(Math.random()<0.2?'...':'。')}\nfunction punctuate(text){text=String(text||'').trim();if(!text)return'';if(/[。！？!?…]$/.test(text))return text;return text+randomCardPunctuation()}",
    'randomize card punctuation'
)

# Generated replies and proactive letters are card-only bodies: no explanatory lead copy.
regex_once(
    r"function makeReply\(source\)\{.*?\}\nfunction makeIncoming\(\)\{.*?\}\nfunction notifyLetter",
    """function makeReply(source){var text=String(source&&source.content||''),cards=selectCards(text),body=cardBody(cards);return{title:'回信 · '+(source.title||'给我的那封信'),content:body,cardFragments:cards}}
function makeIncoming(){var n=names(),cards=selectCards(''),body=cardBody(cards);return{title:pick(['今天也想起你','寄给'+n.me+'的一点心情','想和你说几句话','一封没有特别理由的信']),content:body,cardFragments:cards}}
function notifyLetter""",
    'simplify generated letter bodies'
)

# Retire the trace renderer completely.
regex_once(
    r"function renderCardTrace\(letter\)\{.*?\}\nasync function openLetter",
    "async function openLetter",
    'remove card trace renderer'
)

replace_once(
    "el('xsMailViewGreeting').textContent=received?'见字如面，一切都好。':'见字如面，愿你今日安好。';",
    "el('xsMailViewGreeting').textContent='见字如面';",
    'simplify letter greeting'
)
replace_once("el('xsMailViewContent').textContent=x.content;renderCardTrace(x);", "el('xsMailViewContent').textContent=x.content;", 'remove trace render call')

if s == original:
    raise SystemExit('no changes made')
p.write_text(s, encoding='utf-8')
print('MAILBOX_LETTER_STYLE_PATCH_OK')
