#!/usr/bin/env python3
from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

old_timer = """function manageAutoSendTimer() {
if (autoSendTimer) {
clearInterval(autoSendTimer);
autoSendTimer = null;
}
if (settings.autoSendEnabled) {
const intervalMs = settings.autoSendInterval * 60 * 1000;
autoSendTimer = setInterval(() => {
if (!document.body.classList.contains('batch-favorite-mode')) {
const __xsAutoStickerChance = Math.max(0, Math.min(100, Number(settings.autoStickerChance == null ? 25 : settings.autoStickerChance))) / 100;
if (settings.autoStickerEnabled && Math.random() < __xsAutoStickerChance && window.xiaoshuSendPartnerStickerNow && window.xiaoshuSendPartnerStickerNow()) return;
simulateReply();
}
}, intervalMs);
}
}"""
new_timer = """function manageAutoSendTimer() {
if (autoSendTimer) {
clearInterval(autoSendTimer);
autoSendTimer = null;
}
if (settings.autoSendEnabled || settings.autoStickerEnabled) {
const intervalMs = settings.autoSendInterval * 60 * 1000;
autoSendTimer = setInterval(() => {
if (!document.body.classList.contains('batch-favorite-mode')) {
const __xsAutoStickerChance = Math.max(0, Math.min(100, Number(settings.autoStickerChance == null ? 25 : settings.autoStickerChance))) / 100;
if (settings.autoStickerEnabled && Math.random() < __xsAutoStickerChance && window.xiaoshuSendPartnerStickerNow && window.xiaoshuSendPartnerStickerNow()) return;
if (settings.autoSendEnabled) simulateReply();
}
}, intervalMs);
}
}"""

if text.count(old_timer) != 1:
    raise SystemExit(f'expected one old manageAutoSendTimer(), found {text.count(old_timer)}')
text = text.replace(old_timer, new_timer, 1)

old_ui = 'autoSendControl.style.display = settings.autoSendEnabled ? "flex" : "none";'
new_ui = 'autoSendControl.style.display = (settings.autoSendEnabled || settings.autoStickerEnabled) ? "flex" : "none";'
if text.count(old_ui) != 1:
    raise SystemExit(f'expected one old auto-send UI visibility line, found {text.count(old_ui)}')
text = text.replace(old_ui, new_ui, 1)

old_sync = "function sync(){s=normalize();toggle.classList.toggle('active',!!s.autoStickerEnabled);control.style.display=s.autoStickerEnabled?'flex':'none';slider.value=s.autoStickerChance;value.textContent=s.autoStickerChance+'%'}"
new_sync = "function sync(){s=normalize();toggle.classList.toggle('active',!!s.autoStickerEnabled);control.style.display=s.autoStickerEnabled?'flex':'none';var sharedInterval=document.getElementById('auto-send-control');if(sharedInterval)sharedInterval.style.display=(s.autoSendEnabled||s.autoStickerEnabled)?'flex':'none';slider.value=s.autoStickerChance;value.textContent=s.autoStickerChance+'%'}"
if text.count(old_sync) != 1:
    raise SystemExit(f'expected one old auto sticker sync(), found {text.count(old_sync)}')
text = text.replace(old_sync, new_sync, 1)

path.write_text(text, encoding='utf-8')
print('patched proactive sticker independence and shared interval visibility')
