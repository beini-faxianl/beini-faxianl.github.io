# 拾叶集 · 个人笔记书斋

无构建框架的静态个人网站：Markdown 笔记 + 代码片段收藏 + 网站/工具收藏。
日间为 Catppuccin Latte 主题，夜间为宇宙星空主题（代码块 Dracula 配色），自带模糊搜索与「朱批」画笔批注。

## 目录结构

```
index.html / style.css / app.js   网站本体（一般不用改）
build.py                          索引生成脚本
notes/        *.md                文章（front matter: title/date/tags）
snippets/     *.py *.sh *.js …    代码片段（首行注释 #: 描述）
collections/  websites.json tools.json prompts.json splash.json   收藏/提示词/开屏数据
assets/splash/                    开屏背景图（可选，放图后在 splash.json 登记）
pages/        about.md            关于页
```

## 日常维护

1. 添加内容（丢 .md 进 notes/、丢脚本进 snippets/、改 JSON）；
2. 运行 `python3 build.py` 重建索引（托管在 GitHub 时由 Action 自动完成）。

## 预览与部署

```bash
python3 -m http.server 8000     # 本地预览（不能直接双击 index.html）
```
部署：整个文件夹放到 GitHub Pages / Vercel / Cloudflare Pages 即可。
