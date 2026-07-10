#!/usr/bin/env python3
"""拾叶集本地维护工具。

运行：python manage.py

该工具只读写当前仓库中的 notes/*.md、notes/manifest.json 与
collections/projects.json，不提供任何公网写入接口。
"""
from __future__ import annotations

import json
import re
import tempfile
import tkinter as tk
from datetime import date as calendar_date
from pathlib import Path
from tkinter import messagebox, ttk
from urllib.parse import urlparse

import build


ROOT = Path(__file__).resolve().parent
FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DEFAULT_CATEGORIES = ["网络安全", "人工智能", "编程开发", "阅读思考", "站点随笔"]


def split_tags(value: str) -> list[str]:
    return [item.strip() for item in re.split(r"[,，]", value) if item.strip()]


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", delete=False, dir=path.parent, suffix=".tmp"
    ) as handle:
        handle.write(text)
        temp_path = Path(handle.name)
    temp_path.replace(path)


class Repository:
    def __init__(self, root: Path = ROOT) -> None:
        self.root = root.resolve()
        self.notes_dir = self.root / "notes"
        self.projects_path = self.root / "collections" / "projects.json"

    def list_notes(self) -> list[dict]:
        notes = []
        for path in self.notes_dir.glob("*.md"):
            item = build.parse_note(path)
            item["path"] = path
            notes.append(item)
        return sorted(notes, key=lambda item: (item["date"], item["title"]), reverse=True)

    def save_note(self, filename: str, title: str, date: str, category: str, tags: str) -> None:
        title, date, category = title.strip(), date.strip(), category.strip()
        if not title:
            raise ValueError("文章标题不能为空。")
        if not DATE_RE.fullmatch(date):
            raise ValueError("日期必须使用 YYYY-MM-DD 格式。")
        try:
            calendar_date.fromisoformat(date)
        except ValueError as exc:
            raise ValueError("日期不是有效的日历日期。") from exc
        if not category:
            raise ValueError("文章分类不能为空。")

        path = (self.notes_dir / filename).resolve()
        if path.parent != self.notes_dir.resolve() or not path.is_file() or path.suffix.lower() != ".md":
            raise ValueError("文章文件无效。")

        text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
        match = FM_RE.match(text)
        body = text[match.end():] if match else text
        extras = []
        if match:
            for line in match.group(1).splitlines():
                key = line.split(":", 1)[0].strip().lower() if ":" in line else ""
                if key not in {"title", "date", "category", "分类", "tags"}:
                    extras.append(line)

        header = [
            "---",
            f"title: {title}",
            f"date: {date}",
            f"category: {category}",
            f"tags: {', '.join(split_tags(tags))}",
            *extras,
            "---",
            "",
        ]
        atomic_write(path, "\n".join(header) + body.lstrip("\n"))
        self.rebuild_notes()

    def rebuild_notes(self) -> int:
        paths = sorted(self.notes_dir.glob("*.md"), key=lambda path: path.name.casefold())
        notes = [build.parse_note(path) for path in paths]
        notes.sort(key=lambda item: item["date"], reverse=True)
        atomic_write(
            self.notes_dir / "manifest.json",
            json.dumps({"notes": notes}, ensure_ascii=False, indent=2) + "\n",
        )
        return len(notes)

    def load_projects(self) -> list[dict]:
        if not self.projects_path.exists():
            return []
        data = json.loads(self.projects_path.read_text(encoding="utf-8-sig"))
        if not isinstance(data, list):
            raise ValueError("projects.json 的顶层必须是数组。")
        return data

    def save_projects(self, projects: list[dict]) -> None:
        cleaned = []
        for index, project in enumerate(projects, 1):
            name = str(project.get("name", "")).strip()
            url = str(project.get("url", "")).strip()
            parsed = urlparse(url)
            if not name:
                raise ValueError(f"第 {index} 个项目缺少名称。")
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError(f"项目“{name}”的网址无效。")
            cleaned.append({
                "name": name,
                "url": url,
                "icon": str(project.get("icon", "✦")).strip() or "✦",
                "desc": str(project.get("desc", "")).strip(),
                "tags": split_tags(project.get("tags", ""))
                if isinstance(project.get("tags", ""), str)
                else [str(tag).strip() for tag in project.get("tags", []) if str(tag).strip()],
            })
        atomic_write(self.projects_path, json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n")


class BlogManager(tk.Tk):
    def __init__(self, repository: Repository) -> None:
        super().__init__()
        self.repo = repository
        self.notes: list[dict] = []
        self.projects: list[dict] = []
        self.project_index: int | None = None

        self.title("拾叶集 · 本地维护工具")
        self.geometry("980x640")
        self.minsize(820, 560)
        self.option_add("*Font", ("Microsoft YaHei UI", 10))

        style = ttk.Style(self)
        if "vista" in style.theme_names():
            style.theme_use("vista")

        notebook = ttk.Notebook(self, padding=10)
        notebook.pack(fill="both", expand=True)
        self.note_tab = ttk.Frame(notebook, padding=12)
        self.project_tab = ttk.Frame(notebook, padding=12)
        notebook.add(self.note_tab, text="文章属性")
        notebook.add(self.project_tab, text="我的项目")

        self.status = tk.StringVar(value="准备就绪")
        ttk.Label(self, textvariable=self.status, anchor="w", padding=(14, 6)).pack(fill="x")

        self._build_note_tab()
        self._build_project_tab()
        self.refresh_notes()
        self.refresh_projects()

    @staticmethod
    def _labeled_entry(parent: ttk.Frame, row: int, label: str, variable: tk.StringVar) -> ttk.Entry:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=(0, 6))
        entry = ttk.Entry(parent, textvariable=variable)
        entry.grid(row=row + 1, column=0, sticky="ew", pady=(0, 16))
        return entry

    def _build_note_tab(self) -> None:
        self.note_tab.columnconfigure(1, weight=1)
        self.note_tab.rowconfigure(0, weight=1)
        left = ttk.Frame(self.note_tab)
        left.grid(row=0, column=0, sticky="ns", padx=(0, 18))
        ttk.Label(left, text="文章列表").pack(anchor="w", pady=(0, 8))
        list_frame = ttk.Frame(left)
        list_frame.pack(fill="both", expand=True)
        self.note_list = tk.Listbox(list_frame, width=38, exportselection=False)
        note_scroll = ttk.Scrollbar(list_frame, orient="vertical", command=self.note_list.yview)
        self.note_list.configure(yscrollcommand=note_scroll.set)
        self.note_list.pack(side="left", fill="both", expand=True)
        note_scroll.pack(side="right", fill="y")
        self.note_list.bind("<<ListboxSelect>>", self.on_note_select)
        ttk.Button(left, text="刷新文章列表", command=self.refresh_notes).pack(fill="x", pady=(10, 0))

        form = ttk.LabelFrame(self.note_tab, text="文章 Front Matter", padding=18)
        form.grid(row=0, column=1, sticky="nsew")
        form.columnconfigure(0, weight=1)
        self.note_title = tk.StringVar()
        self.note_date = tk.StringVar()
        self.note_category = tk.StringVar()
        self.note_tags = tk.StringVar()
        self._labeled_entry(form, 0, "标题", self.note_title)
        self._labeled_entry(form, 2, "日期（YYYY-MM-DD）", self.note_date)
        ttk.Label(form, text="分类").grid(row=4, column=0, sticky="w", pady=(0, 6))
        self.category_box = ttk.Combobox(form, textvariable=self.note_category, values=DEFAULT_CATEGORIES)
        self.category_box.grid(row=5, column=0, sticky="ew", pady=(0, 16))
        self._labeled_entry(form, 6, "标签（使用逗号分隔）", self.note_tags)
        ttk.Separator(form).grid(row=8, column=0, sticky="ew", pady=(2, 16))
        ttk.Label(
            form,
            text="保存后会更新 Markdown 开头的属性，并自动重建 notes/manifest.json。",
            foreground="#666666",
            wraplength=500,
        ).grid(row=9, column=0, sticky="w", pady=(0, 16))
        ttk.Button(form, text="保存文章属性", command=self.save_note).grid(row=10, column=0, sticky="ew")

    def _build_project_tab(self) -> None:
        self.project_tab.columnconfigure(1, weight=1)
        self.project_tab.rowconfigure(0, weight=1)
        left = ttk.Frame(self.project_tab)
        left.grid(row=0, column=0, sticky="ns", padx=(0, 18))
        ttk.Label(left, text="项目列表").pack(anchor="w", pady=(0, 8))
        self.project_list = tk.Listbox(left, width=32, exportselection=False)
        self.project_list.pack(fill="both", expand=True)
        self.project_list.bind("<<ListboxSelect>>", self.on_project_select)
        buttons = ttk.Frame(left)
        buttons.pack(fill="x", pady=(10, 0))
        ttk.Button(buttons, text="新增", command=self.new_project).pack(side="left", fill="x", expand=True)
        ttk.Button(buttons, text="删除", command=self.delete_project).pack(side="left", fill="x", expand=True, padx=(8, 0))

        form = ttk.LabelFrame(self.project_tab, text="项目资料", padding=18)
        form.grid(row=0, column=1, sticky="nsew")
        form.columnconfigure(0, weight=1)
        self.project_name = tk.StringVar()
        self.project_url = tk.StringVar()
        self.project_icon = tk.StringVar(value="✦")
        self.project_tags = tk.StringVar()
        self._labeled_entry(form, 0, "项目名称", self.project_name)
        self._labeled_entry(form, 2, "网站链接", self.project_url)
        self._labeled_entry(form, 4, "图标（Emoji 或单个字符）", self.project_icon)
        self._labeled_entry(form, 6, "标签（使用逗号分隔）", self.project_tags)
        ttk.Label(form, text="简介").grid(row=8, column=0, sticky="w", pady=(0, 6))
        self.project_desc = tk.Text(form, height=6, wrap="word")
        self.project_desc.grid(row=9, column=0, sticky="nsew", pady=(0, 16))
        form.rowconfigure(9, weight=1)
        ttk.Button(form, text="保存项目列表", command=self.save_project).grid(row=10, column=0, sticky="ew")

    def refresh_notes(self) -> None:
        try:
            self.notes = self.repo.list_notes()
            self.note_list.delete(0, tk.END)
            for note in self.notes:
                self.note_list.insert(tk.END, f"{note['date']}  {note['title']}")
            categories = sorted({*DEFAULT_CATEGORIES, *(note["category"] for note in self.notes if note["category"])})
            self.category_box.configure(values=categories)
            self.status.set(f"已读取 {len(self.notes)} 篇文章")
        except Exception as exc:
            messagebox.showerror("读取失败", str(exc), parent=self)

    def on_note_select(self, _event=None) -> None:
        selection = self.note_list.curselection()
        if not selection:
            return
        note = self.notes[selection[0]]
        self.note_title.set(note["title"])
        self.note_date.set(note["date"])
        self.note_category.set(note["category"])
        self.note_tags.set(", ".join(note["tags"]))

    def save_note(self) -> None:
        selection = self.note_list.curselection()
        if not selection:
            messagebox.showinfo("请选择文章", "请先从左侧选择一篇文章。", parent=self)
            return
        note = self.notes[selection[0]]
        try:
            self.repo.save_note(
                note["file"], self.note_title.get(), self.note_date.get(),
                self.note_category.get(), self.note_tags.get(),
            )
            self.refresh_notes()
            self.status.set(f"已保存：{self.note_title.get()}")
            messagebox.showinfo("保存成功", "文章属性和索引已经更新。", parent=self)
        except Exception as exc:
            messagebox.showerror("保存失败", str(exc), parent=self)

    def refresh_projects(self) -> None:
        try:
            self.projects = self.repo.load_projects()
            self.project_list.delete(0, tk.END)
            for project in self.projects:
                self.project_list.insert(tk.END, project.get("name", "未命名项目"))
            self.project_index = None
            self.status.set(f"已读取 {len(self.projects)} 个项目")
        except Exception as exc:
            messagebox.showerror("读取失败", str(exc), parent=self)

    def on_project_select(self, _event=None) -> None:
        selection = self.project_list.curselection()
        if not selection:
            return
        self.project_index = selection[0]
        project = self.projects[self.project_index]
        self.project_name.set(project.get("name", ""))
        self.project_url.set(project.get("url", ""))
        self.project_icon.set(project.get("icon", "✦"))
        self.project_tags.set(", ".join(project.get("tags", [])))
        self.project_desc.delete("1.0", tk.END)
        self.project_desc.insert("1.0", project.get("desc", ""))

    def new_project(self) -> None:
        self.project_list.selection_clear(0, tk.END)
        self.project_index = None
        self.project_name.set("")
        self.project_url.set("https://")
        self.project_icon.set("✦")
        self.project_tags.set("项目")
        self.project_desc.delete("1.0", tk.END)
        self.status.set("正在添加新项目")

    def save_project(self) -> None:
        item = {
            "name": self.project_name.get(),
            "url": self.project_url.get(),
            "icon": self.project_icon.get(),
            "desc": self.project_desc.get("1.0", tk.END).strip(),
            "tags": self.project_tags.get(),
        }
        projects = [dict(project) for project in self.projects]
        if self.project_index is None:
            projects.append(item)
        else:
            projects[self.project_index] = item
        try:
            self.repo.save_projects(projects)
            self.refresh_projects()
            self.status.set(f"已保存项目：{item['name'].strip()}")
            messagebox.showinfo("保存成功", "项目列表已经更新。", parent=self)
        except Exception as exc:
            messagebox.showerror("保存失败", str(exc), parent=self)

    def delete_project(self) -> None:
        selection = self.project_list.curselection()
        if not selection:
            messagebox.showinfo("请选择项目", "请先从左侧选择一个项目。", parent=self)
            return
        index = selection[0]
        name = self.projects[index].get("name", "这个项目")
        if not messagebox.askyesno("确认删除", f"确定从项目页移除“{name}”吗？", parent=self):
            return
        projects = [project for i, project in enumerate(self.projects) if i != index]
        try:
            self.repo.save_projects(projects)
            self.refresh_projects()
            self.new_project()
            self.status.set(f"已删除项目：{name}")
        except Exception as exc:
            messagebox.showerror("删除失败", str(exc), parent=self)


def main() -> None:
    app = BlogManager(Repository())
    app.mainloop()


if __name__ == "__main__":
    main()
