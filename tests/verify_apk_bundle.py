#!/usr/bin/env python3
"""Verify that a built APK contains the complete ChuanXun local web runtime."""
from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

REQUIRED = [
    "assets/site/index.html",
    "assets/site/sticker-core.js",
    "assets/site/media-core.js",
    "assets/site/behavior-core.js",
    "assets/site/custom-font-manager.js",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    args = parser.parse_args()
    if not args.apk.is_file() or args.apk.stat().st_size == 0:
        print(f"APK missing or empty: {args.apk}", file=sys.stderr)
        return 2

    try:
        with zipfile.ZipFile(args.apk) as apk:
            names = set(apk.namelist())
            missing = [name for name in REQUIRED if name not in names]
            stickers = [n for n in names if n.startswith("assets/site/assets/stickers/") and not n.endswith("/")]
            themes = [n for n in names if n.startswith("assets/site/assets/builtin-theme/") and not n.endswith("/")]
            if missing:
                print("Missing packaged runtime files:", ", ".join(missing), file=sys.stderr)
                return 3
            if len(stickers) < 300:
                print(f"Expected at least 300 bundled sticker resources, found {len(stickers)}", file=sys.stderr)
                return 4
            if len(themes) < 10:
                print(f"Expected bundled built-in theme files, found {len(themes)}", file=sys.stderr)
                return 5
            index = apk.read("assets/site/index.html").decode("utf-8", "replace")
            if "xiaoshuCircleSource" not in index or "xiaoshuChat2Source" not in index:
                print("Circle or Chat 2 embedded page source missing from APK", file=sys.stderr)
                return 6
            if "__xiaoshuStickerDeleteGuardV1" not in apk.read("assets/site/sticker-core.js").decode("utf-8", "replace"):
                print("Sticker deletion protection is missing from APK", file=sys.stderr)
                return 7
            print(f"Verified {args.apk.name}: {len(stickers)} sticker files, {len(themes)} built-in themes, all runtime JS present")
            return 0
    except (zipfile.BadZipFile, OSError, KeyError) as exc:
        print(f"Unable to inspect APK {args.apk}: {exc}", file=sys.stderr)
        return 8


if __name__ == "__main__":
    raise SystemExit(main())
