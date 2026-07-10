# 拾叶集 · 个人笔记书斋

无前端构建框架的静态个人博客：Markdown 文章、分类导航与个人项目展示。
日间为 Catppuccin Latte 主题，夜间为宇宙星空主题，自带全文搜索、Obsidian 语法适配与「朱批」画笔批注。

## 目录结构

```text
index.html / style.css / app.js   网站本体
build.py                          文章索引生成器
manage.py                         本地可视化维护工具
notes/        *.md                文章（title/date/category/tags）
collections/  projects.json       我的项目
collections/  splash.json         开屏诗句与背景
assets/                            文章图片
pages/        about.md             关于页
```

## 日常维护

推荐运行本地维护工具：

```bash
python manage.py
```

它可以修改文章标题、日期、分类和标签，也可以修改、添加或删除“我的项目”。保存文章后会自动更新 `notes/manifest.json`。

也可以直接编辑 Markdown。文章开头的 Front Matter 格式为：

```markdown
---
title: 我的新文章
date: 2026-07-10
category: 编程开发
tags: Python, 工具
---
```

直接编辑或新增文章后，运行：

```bash
python build.py
```

GitHub Actions 会在文章推送后自动重建并提交索引。

## 预览与部署

```bash
python -m http.server 8000
```

访问 `http://localhost:8000`。生产环境由 GitHub Pages 托管：<https://beini-faxianl.github.io/>。

旧的 `snippets/`、`collections/websites.json`、`collections/tools.json` 和 `collections/prompts.json` 作为历史数据保留，但网站不再加载或展示这些内容。
