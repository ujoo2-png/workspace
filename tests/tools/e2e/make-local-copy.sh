#!/bin/sh
# 임시 로컬 모드 복사본 생성(실제 config.js는 건드리지 않는다): make-local-copy.sh <원본> <대상>
set -e
rm -rf "$2"; mkdir -p "$2"
cp -r "$1/index.html" "$1/css" "$1/js" "$1/manifest.json" "$2/"
sed -i "s/mode: 'supabase'/mode: 'local'/" "$2/js/config.js"
