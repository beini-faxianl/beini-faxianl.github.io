#!/usr/bin/env python3
"""
拾叶集 · 索引生成器
扫描 notes/ 并生成 manifest.json。
新增/删除/重命名文件后运行一次：  python3 build.py
（若使用附带的 GitHub Action，push 后自动运行。）
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
NOTES_DIR = ROOT / "notes"

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)
DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")

# ---------------- 笔记 ----------------
def parse_note(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig")  # 容忍 Windows BOM
    meta = {"title": "", "date": "", "category": "未分类", "tags": []}
    m = FM_RE.match(text)
    if m:
        for line in m.group(1).splitlines():
            if ":" not in line and "：" in line:
                line = line.replace("：", ":", 1)        # 容忍全角冒号
            if ":" not in line:
                continue
            key, _, val = line.partition(":")
            key, val = key.strip().lower(), val.strip()
            if key == "title":
                meta["title"] = val
            elif key == "date":
                meta["date"] = re.sub(r"[./]", "-", val)  # 2026/06/15 → 2026-06-15
            elif key in {"category", "分类"}:
                meta["category"] = val or "未分类"
            elif key == "tags":
                meta["tags"] = [t.strip() for t in re.split(r"[,，]", val) if t.strip()]
        body = text[m.end():]
    else:
        body = text
    if not meta["title"]:
        h = re.search(r"^#\s+(.+)$", body, re.M)
        meta["title"] = h.group(1).strip() if h else path.stem
    if not meta["date"]:
        d = DATE_RE.search(path.name)
        meta["date"] = d.group(1) if d else ""
    meta["file"] = path.name
    return meta


def build_notes() -> int:
    if not NOTES_DIR.is_dir():
        return 0
    paths = sorted(NOTES_DIR.glob("*.md"), key=lambda path: path.name.casefold())
    notes = [parse_note(path) for path in paths]
    notes.sort(key=lambda n: n["date"], reverse=True)
    (NOTES_DIR / "manifest.json").write_text(
        json.dumps({"notes": notes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(notes)

def main() -> int:
    n = build_notes()
    print(f"[OK] 已索引 {n} 篇笔记")
    return 0


if __name__ == "__main__":
    sys.exit(main())
