#!/usr/bin/env python3
#: 按 EXIF 拍摄时间批量重命名照片为 2026-06-10_142305.jpg
# tags: 照片, 整理

import sys
from datetime import datetime
from pathlib import Path
from PIL import Image, ExifTags

TAG_ID = next(k for k, v in ExifTags.TAGS.items() if v == "DateTimeOriginal")

def shot_time(p: Path):
    try:
        exif = Image.open(p)._getexif() or {}
        return datetime.strptime(exif[TAG_ID], "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None

def main(folder: str):
    for p in sorted(Path(folder).glob("*.[jJ][pP]*[gG]")):
        t = shot_time(p)
        if not t:
            print(f"跳过（无 EXIF）: {p.name}")
            continue
        new = p.with_name(t.strftime("%Y-%m-%d_%H%M%S") + p.suffix.lower())
        if new.exists():
            new = new.with_stem(new.stem + "_1")
        p.rename(new)
        print(f"{p.name} → {new.name}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
