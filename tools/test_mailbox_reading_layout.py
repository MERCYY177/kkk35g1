from pathlib import Path
text = Path('index.html').read_text(encoding='utf-8')
assert 'id="xsMailViewTitle"' not in text, 'reading page still contains a title between greeting and body'
assert "el('xsMailViewTitle').textContent" not in text, 'reading page still writes a title'
assert '<div class="xs-mail-paper-greeting" id="xsMailViewGreeting"></div>\n          <div class="xs-mail-view-content" id="xsMailViewContent"></div>' in text, 'greeting is not followed directly by letter content'
print('MAILBOX_READING_LAYOUT_TEST_OK')
