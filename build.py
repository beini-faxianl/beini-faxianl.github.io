#!/usr/bin/env python3
"""
拾叶集 · 索引生成器
扫描 notes/ 与 snippets/，分别生成 manifest.json。
新增/删除/重命名文件后运行一次：  python3 build.py
（若使用附带的 GitHub Action，push 后自动运行。）

snippets 约定（都可省略）：
  - 第一条注释行写描述，如  #: 描述文字   或  //: 描述文字
  - 注释行  # tags: a, b  声明标签
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
NOTES_DIR = ROOT / "notes"
SNIPPETS_DIR = ROOT / "snippets"

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)
DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")

EXT_LANG = {
    ".py": "python", ".sh": "bash", ".bash": "bash", ".zsh": "bash",
    ".js": "javascript", ".mjs": "javascript", ".ts": "typescript",
    ".sql": "sql", ".html": "html", ".css": "css", ".json": "json",
    ".yml": "yaml", ".yaml": "yaml", ".go": "go", ".rs": "rust",
    ".c": "c", ".cpp": "cpp", ".rb": "ruby", ".ps1": "powershell",
    ".lua": "lua", ".md": "markdown", ".txt": "text",
}
COMMENT_RE = re.compile(r"^\s*(?:#|//|--|;|<!--)\:?\s*(.*?)\s*(?:-->)?\s*$")
TAGS_RE = re.compile(r"^\s*(?:#|//|--|;)\s*tags?\s*[:：]\s*(.+)$", re.I)


# ---------------- 笔记 ----------------
def parse_note(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig")  # 容忍 Windows BOM
    meta = {"title": "", "date": "", "tags": []}
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
    notes = [parse_note(p) for p in sorted(NOTES_DIR.glob("*.md"))]
    notes.sort(key=lambda n: n["date"], reverse=True)
    (NOTES_DIR / "manifest.json").write_text(
        json.dumps({"notes": notes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(notes)


# ---------------- 代码片段 ----------------
def parse_snippet(path: Path) -> dict:
    lang = EXT_LANG.get(path.suffix.lower(), "text")
    desc, tags = "", []
    try:
        head = path.read_text(encoding="utf-8-sig").splitlines()[:8]
    except UnicodeDecodeError:
        head = []
    for line in head:
        if line.startswith("#!"):           # 跳过 shebang
            continue
        tm = TAGS_RE.match(line)
        if tm:
            tags = [t.strip() for t in re.split(r"[,，]", tm.group(1)) if t.strip()]
            continue
        if not desc:
            cm = COMMENT_RE.match(line)
            if cm and cm.group(1):
                desc = cm.group(1)
    return {"file": path.name, "title": path.stem, "lang": lang, "desc": desc, "tags": tags}


def build_snippets() -> int:
    if not SNIPPETS_DIR.is_dir():
        return 0
    items = [parse_snippet(p) for p in sorted(SNIPPETS_DIR.iterdir())
             if p.is_file() and p.name != "manifest.json" and not p.name.startswith(".")]
    (SNIPPETS_DIR / "manifest.json").write_text(
        json.dumps({"snippets": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(items)


def main() -> int:
    n = build_notes()
    s = build_snippets()
    print(f"✓ 已索引 {n} 篇笔记、{s} 段代码")
    return 0


if __name__ == "__main__":
    sys.exit(main())
