#!/usr/bin/env python3
"""Syntax-check executable scripts in index.html and embedded srcdoc documents."""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"


class ScriptParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.blocks: list[tuple[dict[str, str | None], str]] = []
        self.current_attrs = None
        self.current_data: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script":
            self.current_attrs = {k.lower(): v for k, v in attrs}
            self.current_data = []

    def handle_data(self, data):
        if self.current_attrs is not None:
            self.current_data.append(data)

    def handle_entityref(self, name):
        if self.current_attrs is not None:
            self.current_data.append(f"&{name};")

    def handle_charref(self, name):
        if self.current_attrs is not None:
            self.current_data.append(f"&#{name};")

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.current_attrs is not None:
            self.blocks.append((self.current_attrs, "".join(self.current_data)))
            self.current_attrs = None
            self.current_data = []


def executable_blocks(markup: str):
    parser = ScriptParser()
    parser.feed(markup)
    parser.close()
    for attrs, body in parser.blocks:
        script_type = (attrs.get("type") or "").strip().lower()
        if attrs.get("src"):
            continue
        if script_type in {"text/plain", "application/json", "application/ld+json", "application/json+ld"}:
            continue
        if script_type and script_type not in {"text/javascript", "application/javascript", "module"}:
            continue
        if body.strip():
            yield body


def check(blocks, label, tempdir):
    total = 0
    for index, body in enumerate(blocks, 1):
        total += 1
        file = Path(tempdir) / f"{label}-{index}.js"
        file.write_text(body, encoding="utf-8")
        result = subprocess.run(["node", "--check", str(file)], capture_output=True, text=True)
        if result.returncode:
            print(f"Syntax error in {label} script #{index}:\n{result.stderr}", file=sys.stderr)
            return False, total
    return True, total


def main():
    source = INDEX.read_text(encoding="utf-8")
    # srcdoc source is stored as text/plain with safe closing-tag sentinels.
    embedded = {}
    for page_id, sentinel in (
        ("xiaoshuCircleSource", "__XIAOSHU_CIRCLE_SCRIPT_CLOSE__"),
        ("xiaoshuChat2Source", "__XIAOSHU_CHAT2_SCRIPT_CLOSE__"),
    ):
        match = re.search(
            rf'<script\s+id="{re.escape(page_id)}"\s+type="text/plain">(.*?)</script>',
            source,
            re.S,
        )
        if not match:
            print(f"Missing embedded page source: {page_id}", file=sys.stderr)
            return 2
        embedded[page_id] = match.group(1).replace(sentinel, "</script>")
        if "custom-font-manager.js" not in embedded[page_id]:
            print(f"{page_id} does not load its own custom-font-manager.js", file=sys.stderr)
            return 3

    with tempfile.TemporaryDirectory(prefix="chuanxun-js-check-") as tempdir:
        ok, main_count = check(executable_blocks(source), "main", tempdir)
        if not ok:
            return 4
        circle_ok, circle_count = check(executable_blocks(embedded["xiaoshuCircleSource"]), "circle", tempdir)
        if not circle_ok:
            return 5
        chat_ok, chat_count = check(executable_blocks(embedded["xiaoshuChat2Source"]), "chat2", tempdir)
        if not chat_ok:
            return 6

    print(f"JavaScript syntax OK: main={main_count}, moments={circle_count}, chat2={chat_count}; total={main_count + circle_count + chat_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
