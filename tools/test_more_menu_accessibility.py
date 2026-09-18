#!/usr/bin/env python3
from pathlib import Path

html=Path('index.html').read_text(encoding='utf-8')
checks={
 'button announces popup': "setAttribute('aria-haspopup','menu')",
 'button tracks expanded state': "setAttribute('aria-expanded','false')",
 'button controls menu': "setAttribute('aria-controls','xs-chat-more-menu')",
 'menu role': "setAttribute('role','menu')",
 'menu items': 'role="menuitem"',
 'escape keyboard support': "e.key==='Escape'",
 'down keyboard support': "e.key==='ArrowDown'",
 'up keyboard support': "e.key==='ArrowUp'",
 'home keyboard support': "e.key==='Home'",
 'end keyboard support': "e.key==='End'",
 'focus restore': 'closeMoreMenu(true)',
}
missing=[name for name,needle in checks.items() if needle not in html]
if missing:
    raise AssertionError('missing more-menu accessibility behavior: '+', '.join(missing))
print('more menu accessibility regression checks passed')
