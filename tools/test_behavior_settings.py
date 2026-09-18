from pathlib import Path

text = Path('index.html').read_text(encoding='utf-8')

required = {
    'chat more button': 'xs-chat-more-button',
    'chat more menu': 'xs-chat-more-menu',
    'auto sticker enabled': 'autoStickerEnabled',
    'auto sticker chance': 'autoStickerChance',
    'random card combo enabled': 'randomCardComboEnabled',
    'random card combo max': 'randomCardComboMax',
    'mail incoming enabled': 'xsMailIncomingEnabled',
    'mail incoming min': 'xsMailIncomingMin',
    'mail incoming max': 'xsMailIncomingMax',
    'mail auto reply enabled': 'xsMailAutoReplyEnabled',
    'mail reply min': 'xsMailReplyMin',
    'mail reply max': 'xsMailReplyMax',
    'voice incoming setting': 'allowVoiceIncoming',
    'video incoming setting': 'allowVideoIncoming',
    'incoming kind selector': 'pickIncomingKind',
}

missing = [label for label, token in required.items() if token not in text]
assert not missing, 'missing behavior settings: ' + ', '.join(missing)

assert "b.innerHTML='<i class=\"fas fa-ellipsis-h\"></i>'" in text, 'chat header button is not ellipsis'
assert "if(!settings.randomCardComboEnabled)" in text, 'card combination toggle is not wired into reply count'
assert "settings.autoStickerEnabled" in text and "settings.autoStickerChance" in text, 'auto sticker settings are not wired into active sending'
assert 'state.allowIncomingLetters' in text, 'mail incoming toggle is not wired into scheduler'
assert 'state.autoReplyEnabled' in text, 'mail auto reply toggle is not wired into reply scheduling'
assert 'state.replyDelayMinMinutes' in text and 'state.replyDelayMaxMinutes' in text, 'mail reply delay range is not wired'
assert 'state.incomingDelayMinMinutes' in text and 'state.incomingDelayMaxMinutes' in text, 'mail incoming delay range is not wired'
assert "c.allowVoiceIncoming" in text and "c.allowVideoIncoming" in text, 'call type toggles are not wired into settings panel'
assert 'function resetAndMount()' in text, 'chat behavior controls are not refreshed when the active session changes'
assert "setTimeout(resetAndMount,0)" in text, 'session-ready handler does not refresh chat behavior controls'
assert "(!cfg.allowVoiceIncoming&&!cfg.allowVideoIncoming)" in text, 'call scheduler should test enabled call types without consuming a random draw'

print('BEHAVIOR_SETTINGS_TEST_OK')
