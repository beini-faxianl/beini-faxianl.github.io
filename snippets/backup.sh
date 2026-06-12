#!/usr/bin/env bash
#: 用 rsync 做增量备份，按日期留快照，老快照硬链接去重
# tags: 备份, rsync

set -euo pipefail

SRC="$HOME/Documents"
DEST="/mnt/backup"
TODAY=$(date +%F)
LATEST="$DEST/latest"

mkdir -p "$DEST/$TODAY"

rsync -a --delete \
  --link-dest="$LATEST" \
  "$SRC/" "$DEST/$TODAY/"

ln -sfn "$DEST/$TODAY" "$LATEST"
echo "✓ 备份完成 → $DEST/$TODAY"

# 只保留最近 14 天
find "$DEST" -maxdepth 1 -type d -name '20*' \
  | sort | head -n -14 | xargs -r rm -rf
