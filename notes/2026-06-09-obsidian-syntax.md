---
title: Obsidian 语法演示：这座书斋认识双链
date: 2026-06-09
category: 站点随笔
tags: 站务, Obsidian
---

从 Obsidian 直接搬运笔记过来，这些方言都能正常说话。%%这是一条 Obsidian 注释，发布后不可见%%

## 双链

提到 [[Docker 常用命令速查]] 会自动连到那篇笔记；也可以带别名，比如 [[JavaScript 闭包：从一道经典面试题说起|那道闭包面试题]]。链接到还没写的笔记会显示为灰色虚线：[[尚未写就的一篇]]。

## 高亮与任务

==重点内容用双等号高亮==，待办清单也认识：

- [x] 把笔记搬上网
- [x] 适配 Obsidian 语法
- [ ] 写满一百篇

## 标注框（Callout）

> [!tip] 小技巧
> 标注框支持 note / tip / warning / danger / example / quote 等十几种类型，
> 标题留空时会用类型的默认名。

> [!warning]
> 直接双击 index.html 看不到笔记，记得用本地服务器预览。

> [!quote] 拾叶人语
> 思绪如落叶，不拾起来，风一吹就散了。

## 图片嵌入

`![[photo.png]]` 或 `![[photo.png|400]]`（限定宽度）会从 `assets/` 目录加载图片——把 Obsidian 的附件复制到 `assets/` 即可。
