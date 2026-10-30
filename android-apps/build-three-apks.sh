#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/android-apps"
OUTPUT_DIR="$ROOT/release-apks"

if ! command -v gradle >/dev/null 2>&1; then
  echo "错误：未找到 gradle。请安装 Gradle 8.7+，并配置 JDK 17。" >&2
  exit 2
fi
if [[ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]]; then
  echo "错误：请设置 ANDROID_HOME 或 ANDROID_SDK_ROOT，并安装 Android SDK 35 / Build Tools 35.0.0。" >&2
  exit 2
fi

cd "$ANDROID_DIR"
gradle --no-daemon \
  :app:assembleChuanxun1Debug \
  :app:assembleChuanxun2Debug \
  :app:assembleChuanxun3Debug

mkdir -p "$OUTPUT_DIR"
cp app/build/outputs/apk/chuanxun1/debug/app-chuanxun1-debug.apk "$OUTPUT_DIR/传讯1.apk"
cp app/build/outputs/apk/chuanxun2/debug/app-chuanxun2-debug.apk "$OUTPUT_DIR/传讯2.apk"
cp app/build/outputs/apk/chuanxun3/debug/app-chuanxun3-debug.apk "$OUTPUT_DIR/传讯3.apk"

SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
AAPT="$SDK_ROOT/build-tools/35.0.0/aapt"
APKSIGNER="$SDK_ROOT/build-tools/35.0.0/apksigner"
python3 "$ROOT/tests/verify_apk_bundle.py" "$OUTPUT_DIR/传讯1.apk"
python3 "$ROOT/tests/verify_apk_bundle.py" "$OUTPUT_DIR/传讯2.apk"
python3 "$ROOT/tests/verify_apk_bundle.py" "$OUTPUT_DIR/传讯3.apk"
for spec in \
  "传讯1.apk:com.mercyy.transmission" \
  "传讯2.apk:com.mercyy.transmission.new" \
  "传讯3.apk:com.mercyy177.chuanxun.three"; do
  file="${spec%%:*}"
  expected="${spec#*:}"
  "$AAPT" dump badging "$OUTPUT_DIR/$file" | grep -F "package: name='$expected'" >/dev/null
  "$APKSIGNER" verify "$OUTPUT_DIR/$file"
done
sha256sum "$OUTPUT_DIR"/*.apk | tee "$OUTPUT_DIR/SHA256SUMS.txt"
echo "三个 APK 已完成构建与包体检查：$OUTPUT_DIR"
