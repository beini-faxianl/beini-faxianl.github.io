# 拾光笔记 · Obsidian 博客

一个把 **Obsidian 仓库**直接变成个人博客的静态站点，配色与排版参考 [Anthropic](https://www.anthropic.com) 的视觉风格。

用 Obsidian 写作 → 保存 → 博客自动更新。纯静态输出，可以部署到 GitHub Pages、Vercel、Netlify、Cloudflare Pages 等任意静态托管。

## 功能

**内容与浏览**
- 多级分类：文件夹层级即分类（`技术/前端/…` → 技术 › 前端），父分类包含子分类的文章；标签（支持嵌套标签 `#父/子`）、归档时间线
- **全文搜索**（`Ctrl/⌘ + K` 或 `/`）：匹配标题、正文、代码、标签，支持多关键词与 `#标签` 过滤；记住最近搜索；点开结果后自动高亮命中位置
- 关系图谱：全站图谱 + 每篇文章底部的局部图谱（支持拖动、缩放、双指缩放）
- 反向链接、相关文章、上一篇 / 下一篇、置顶、草稿
- 文章末尾的作者卡片（头像、简介、本文链接、版权声明），过时内容提醒
- RSS、sitemap、robots.txt、结构化数据（JSON-LD）、社交分享卡片、Web App Manifest、Giscus 评论（可选）、统计代码（可选）

**Obsidian 语法（完整支持）**

| 语法 | 示例 |
| --- | --- |
| 双链 / 别名 / 标题 / 块 | `[[笔记]]` `[[笔记\|别名]]` `[[笔记#标题]]` `[[笔记#^块ID]]` `[[#本文标题]]` |
| 嵌入笔记 / 章节 / 块 | `![[笔记]]` `![[笔记#标题]]` `![[笔记#^块ID]]` |
| 嵌入图片（含尺寸）/ 音视频 / PDF | `![[图.png\|300]]` `![[图.png\|300x200]]` `![alt\|300](url)` `![[a.mp3]]` `![[a.pdf#page=2]]` |
| Callout（全部类型，可折叠、可嵌套） | `> [!tip]` `> [!warning]-` `> [!faq]+ 自定义标题` |
| 高亮 / 注释 | `==高亮==`、`%%注释%%`（行内与多行） |
| 标签 | `#标签`、`#父/子` |
| 脚注 | `[^1]`、行内脚注 `^[内容]` |
| 任务（含自定义状态） | `- [ ]` `- [x]` `- [/]` `- [-]` `- [>]` `- [?]` `- [!]` `- [*]` … |
| 数学公式 | `$行内$`、`$$块级$$`（KaTeX） |
| Mermaid | ` ```mermaid ` 代码块（跟随深浅色主题） |
| 嵌入搜索 | ` ```query ` 代码块（支持 `tag:` `path:` `file:` `title:`） |
| 块 ID | 段落 / 列表项末尾的 `^id` |
| 其它 | 表格、删除线、原生 HTML、`<details>`、软换行、指向 `.md` 的普通链接、中文标点旁的 `**加粗**` |

**代码高亮**：Shiki，亮 / 暗双主题；一键复制、自动换行切换、长代码折叠。代码块首行参数与 Obsidian 插件 [Codeblock Customizer](https://github.com/mugiwara85/CodeblockCustomizer) 一致，在 Obsidian 里看到的效果和博客上相同：

| 参数 | 作用 |
| --- | --- |
| `hl:1,3-5` | 高亮行；`hl:test` 含某词的行；`hl:5\|test`、`hl:5-7\|test` 指定行中含某词时才高亮 |
| `info:2` `warn:4-6` `error:8` | 用自定义颜色高亮行（颜色名在 `site.config.ts` 的 `code.highlightColors` 中定义） |
| `hlt:test` | 高亮文字：`hlt:5` 整行文字、`hlt:5\|print`、`hlt::xyz`（行首到 xyz）、`hlt:abc:`（abc 到行尾）、`hlt:abc:xyz`、`hlt:5[2,-1]\|test`（第几处）；`errort:` 等为自定义颜色的文字高亮 |
| `file:app.js` / `title:` | 标题栏显示文件名，含空格时加引号：`file:"long name.cpp"` |
| `ln:true` / `ln:false` / `ln:5` | 显示 / 隐藏行号，或从 5 开始编号（默认值见 `code.lineNumbers`） |
| `fold` | 默认折叠，点击标题栏展开 |
| `exclude` | 这个代码块不应用任何参数 |

参数名和值之间用 `:` 或 `=` 均可，例如：` ```js file:app.js ln:true hl:2,4-6 error:8 `。代码内容本身原样显示，不会解析任何注释标记。

**阅读体验**
- 浅色 / 深色 / 跟随系统：深色从按钮处柔和扩散、浅色收拢退回；首屏无闪烁；夜间自动调暗图片
- 阅读设置：字号、行距、字间距、段间距、页面宽度、文字亮度、字体（宋体 / 思源黑体 / 楷体 / 系统黑体）、两端对齐、首行缩进——实时生效并记住
- 侧边目录（滚动高亮）、阅读进度、记住上次阅读位置、专注模式
- 悬停预览：鼠标停在内部链接或脚注上即可预览内容（同 Obsidian 页面预览）
- 页面切换时，点击的文章标题平滑“飞”到新页面的标题位置（Chrome / Edge / Safari 新版本）
- 中英文之间自动留白、frontmatter 的 `description` 作为文章副标题、图片不引起页面跳动、打印排版优化
- 图片点击放大、标题锚点一键复制链接；按 `?` 查看全部快捷键

**批注**（阅读页右下角 ✎，或按 `A`）
- 笔、荧光笔、激光笔、橡皮擦；6 种颜色、3 种粗细；按住 `Shift` 画直线
- 撤销 / 重做（`Ctrl+Z` / `Ctrl+Shift+Z`）、**一键清除全部痕迹**（可撤销）
- 笔迹锚定在它圈住的文字上：调整字号、宽度后依然跟随原来的词
- 支持数位笔压感；触屏上单指书写、双指滚动
- 批注保存在本机浏览器中，按文章区分

## 快速开始

需要 Node.js 22.12 或更高版本。

```bash
npm install
npm run dev        # 本地预览 http://localhost:4321
```

```bash
npm run new -- "文章标题" 技术   # 新建文章（第二个参数是分类文件夹，可省略）
npm run build                    # 构建到 dist/
npm run preview                  # 预览构建结果
```

## 写作

`content/` 就是一个 Obsidian 仓库：在 Obsidian 中选择「打开文件夹作为仓库」并选中它即可。

也可以直接使用你现有的 vault：在 `site.config.ts` 中把 `content.dir` 改成它的路径（支持绝对路径，如 `'D:/Obsidian/我的仓库/博客'`），或临时用环境变量指定：`VAULT_DIR="D:/Obsidian/我的仓库" npm run dev`。

- 文件夹 → 分类（支持多级）：`content/技术/前端/xxx.md` 属于「技术 › 前端」；可用 `site.config.ts` 的 `categoryDepth` 限制层数
- 以 `.` 或 `_` 开头的目录、`templates` 目录不会被发布（其中的图片仍可被引用）
- `content/about.md` 渲染为「关于」页面
- 图片等附件放在仓库任意位置，用 `![[文件名]]` 引用即可

Frontmatter（全部可选）：

```yaml
---
title: 文章标题          # 默认取首个一级标题，再退回文件名
date: 2026-10-01         # 发布日期（建议填写；未填写时使用文件创建时间）
updated: 2026-10-05      # 更新日期
category: 技术/前端      # 覆盖文件夹分类（也可写 categories: [技术, 前端]）
tags: [前端, react]      # 正文中的 #标签 也会被收录
description: 一句话摘要  # 显示为文章副标题，并用于列表与搜索引擎；不写则自动截取正文（不显示副标题）
cover: "[[封面.png]]"    # 封面图
slug: my-post            # 自定义网址
aliases: [别名]
pinned: true             # 首页置顶并在首页精选
categoryPinned: true     # 在所属分类中置顶；也可写上级分类名，如 Web 安全，或多个 [JWT, Web 安全]
draft: true              # 草稿：本地可见，构建时不发布
cssclasses: [wide]       # wide = 宽版页面
---
```

## 配置

所有个性化设置都在 [`site.config.ts`](site.config.ts)，常用的有：

| 设置 | 说明 |
| --- | --- |
| `title` `description` `author` `bio` `avatar` | 站点与作者信息；`avatar` 填 `public/` 下的图片路径（如 `/avatar.jpg`）或网址，留空则用名字的首字 |
| `url` `base` | 正式域名与子路径（RSS、sitemap、分享卡片会用到） |
| `hero` `nav` `social` | 首页文案、导航、社交链接 |
| `content.*` | 仓库目录、排除目录、分类层数、换行规则 |
| `license` | 文章末尾的版权声明，设为 `null` 关闭 |
| `outdatedDays` | 文章超过多少天未更新时提示“可能已过时”，`0` 关闭 |
| `code` | 代码高亮主题、长代码折叠行数 |
| `giscus` | 评论区（基于 GitHub Discussions） |
| `head` | 插入每个页面 `<head>` 的 HTML，例如网站统计代码 |

想换掉默认的社交分享图，替换 `public/og-default.png`（1200×630）即可；文章若设置了位图封面（png / jpg / webp），会自动用封面作为分享图。

## 部署

### GitHub Pages

1. 把项目推送到 GitHub 仓库的 `main` 分支
2. 仓库 Settings → Pages → Source 选择 **GitHub Actions**
3. 之后每次推送都会自动构建发布（工作流见 `.github/workflows/deploy.yml`，会自动处理 `/仓库名/` 子路径）

### Vercel / Netlify / Cloudflare Pages

构建命令 `npm run build`，输出目录 `dist`。记得把 `site.config.ts` 中的 `url` 改为你的域名。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl/⌘ + K`、`/` | 搜索 |
| `?` | 显示全部快捷键 |
| `F` | 专注模式 |
| `T` | 目录 |
| `A` | 批注模式 |
| `P` / `H` / `L` / `E` | 批注：笔 / 荧光笔 / 激光笔 / 橡皮擦 |
| `1`–`6` | 批注颜色 |
| `Esc` | 关闭面板 / 退出模式 |

## 关于性能

页面本身很轻（首屏 JS 约 24 KB，无布局抖动），本地冷启动首屏约 0.6 秒。正文使用的思源宋体按需分片加载：首次访问一篇文章大约下载 1 MB 左右字体，下载期间文字先以系统字体显示，之后浏览器会缓存。思源黑体、楷体只在读者选中时才加载（本机已安装思源黑体时直接使用本机字体）。若更看重加载速度，可在阅读设置中选择「系统黑体」，正文改用系统自带字体，需要下载的字体会少得多（副标题、摘要等少量点缀文字仍使用宋体）。

## 项目结构

```
content/                 Obsidian 仓库（文章与附件）
site.config.ts           站点配置
src/lib/vault.ts         扫描仓库、解析 frontmatter、链接解析、分类 / 标签 / 反链
src/lib/markdown/        Markdown 渲染管线（remark / rehype）
  obsidian.ts            Obsidian 语法插件
  code.ts                Shiki 代码高亮
  enhance.ts             标题锚点、目录、图片、表格、外链
src/scripts/             浏览器端脚本：主题、搜索、阅读设置、批注、图谱、悬停预览
src/styles/              设计令牌（Anthropic 色板）与正文排版
src/pages/               页面路由
```
