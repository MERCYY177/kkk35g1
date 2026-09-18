#!/usr/bin/env python3
from pathlib import Path

path=Path('index.html')
text=path.read_text(encoding='utf-8')
repls=[
("function ensureCallButton(){var right=$('xs-stable-right');if(!right)return null;var b=$('xs-chat-more-button');if(!b){b=document.createElement('button');b.id='xs-chat-more-button';b.type='button';b.setAttribute('aria-label','更多');b.setAttribute('title','更多');b.innerHTML='<i class=\"fas fa-ellipsis-h\"></i>';right.appendChild(b)}return b}",
 "function ensureCallButton(){var right=$('xs-stable-right');if(!right)return null;var b=$('xs-chat-more-button');if(!b){b=document.createElement('button');b.id='xs-chat-more-button';b.type='button';b.setAttribute('aria-label','更多');b.setAttribute('title','更多');b.innerHTML='<i class=\"fas fa-ellipsis-h\"></i>';right.appendChild(b)}b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');b.setAttribute('aria-controls','xs-chat-more-menu');return b}"),
("function moreMenu(){var h=$('xs-chat-more-menu');if(!h){h=document.createElement('div');h.id='xs-chat-more-menu';h.className='xs-chat-more-menu';document.body.appendChild(h)}return h}",
 "function moreMenu(){var h=$('xs-chat-more-menu');if(!h){h=document.createElement('div');h.id='xs-chat-more-menu';h.className='xs-chat-more-menu';h.setAttribute('role','menu');h.setAttribute('aria-label','通话菜单');document.body.appendChild(h)}return h}"),
("function closeMoreMenu(){var h=$('xs-chat-more-menu');if(h){h.classList.remove('show');h.innerHTML=''}return false}",
 "function closeMoreMenu(restoreFocus){var h=$('xs-chat-more-menu'),b=$('xs-chat-more-button');if(h){h.classList.remove('show');h.innerHTML=''}if(b)b.setAttribute('aria-expanded','false');if(restoreFocus&&b&&typeof b.focus==='function')b.focus();return false}"),
("function toggleMoreMenu(){var b=ensureCallButton(),h=moreMenu();if(h.classList.contains('show'))return closeMoreMenu();var c=settingsFor(sid()),r=b.getBoundingClientRect();h.innerHTML='<button type=\"button\" data-v118-more-call=\"voice\" '+(c.enabled?'':'disabled')+'><i class=\"fas fa-phone\"></i><span>语音通话</span></button><button type=\"button\" data-v118-more-call=\"video\" '+(c.enabled?'':'disabled')+'><i class=\"fas fa-video\"></i><span>视频通话</span></button><button type=\"button\" data-v118-more-settings><i class=\"fas fa-cog\"></i><span>通话设置</span></button>';h.style.top=Math.min(innerHeight-170,r.bottom+6)+'px';h.style.right=Math.max(8,innerWidth-r.right)+'px';h.classList.add('show');return false}",
 "function toggleMoreMenu(){var b=ensureCallButton(),h=moreMenu();if(h.classList.contains('show'))return closeMoreMenu();var c=settingsFor(sid()),r=b.getBoundingClientRect();h.innerHTML='<button type=\"button\" role=\"menuitem\" tabindex=\"-1\" data-v118-more-call=\"voice\" '+(c.enabled?'':'disabled')+'><i class=\"fas fa-phone\"></i><span>语音通话</span></button><button type=\"button\" role=\"menuitem\" tabindex=\"-1\" data-v118-more-call=\"video\" '+(c.enabled?'':'disabled')+'><i class=\"fas fa-video\"></i><span>视频通话</span></button><button type=\"button\" role=\"menuitem\" tabindex=\"-1\" data-v118-more-settings><i class=\"fas fa-cog\"></i><span>通话设置</span></button>';h.style.top=Math.min(innerHeight-170,r.bottom+6)+'px';h.style.right=Math.max(8,innerWidth-r.right)+'px';h.classList.add('show');b.setAttribute('aria-expanded','true');return false}"),
]
for old,new in repls:
    if text.count(old)!=1: raise SystemExit(f'expected one target, found {text.count(old)}: {old[:80]}')
    text=text.replace(old,new,1)

marker="function bind(){document.addEventListener('click',function(e){"
helper="function moreMenuItems(){var h=$('xs-chat-more-menu');return h?Array.prototype.slice.call(h.querySelectorAll('button:not([disabled])')):[]}\nfunction focusMoreMenuItem(index){var items=moreMenuItems();if(!items.length)return;index=(index+items.length)%items.length;if(items[index]&&typeof items[index].focus==='function')items[index].focus()}\nfunction bindMoreMenuKeyboard(){document.addEventListener('keydown',function(e){var b=$('xs-chat-more-button'),h=$('xs-chat-more-menu'),open=!!(h&&h.classList.contains('show'));if(!b)return;if(e.target===b&&e.key==='ArrowDown'){e.preventDefault();if(!open)toggleMoreMenu();focusMoreMenuItem(0);return}if(!open)return;if(e.key==='Escape'){e.preventDefault();closeMoreMenu(true);return}if(!h.contains(e.target))return;var items=moreMenuItems(),i=items.indexOf(e.target);if(!items.length)return;if(e.key==='ArrowDown'){e.preventDefault();focusMoreMenuItem(i<0?0:i+1)}else if(e.key==='ArrowUp'){e.preventDefault();focusMoreMenuItem(i<0?items.length-1:i-1)}else if(e.key==='Home'){e.preventDefault();focusMoreMenuItem(0)}else if(e.key==='End'){e.preventDefault();focusMoreMenuItem(items.length-1)}},true)}\n"
if text.count(marker)!=1: raise SystemExit(f'expected one bind marker, found {text.count(marker)}')
text=text.replace(marker,helper+marker,1)
old_boot="function boot(){ensureCallButton();ensureSettingsEntry();bind();setupMiniDrag();expose();hydrateRecords(sid());hydrateSettings(sid());updateCallButton()}"
new_boot="function boot(){ensureCallButton();ensureSettingsEntry();bind();bindMoreMenuKeyboard();setupMiniDrag();expose();hydrateRecords(sid());hydrateSettings(sid());updateCallButton()}"
if text.count(old_boot)!=1: raise SystemExit(f'expected one boot, found {text.count(old_boot)}')
text=text.replace(old_boot,new_boot,1)
path.write_text(text,encoding='utf-8')
print('patched three-dot menu accessibility and keyboard navigation')
