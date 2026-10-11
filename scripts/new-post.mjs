#!/usr/bin/env node
/**
 * 新建文章：npm run new -- "文章标题" [分类文件夹]
 * 例如：npm run new -- "我的第一篇文章" 随笔
 */
import fs from 'node:fs';
import path from 'node:path';

const [title, category] = process.argv.slice(2);
if (!title) {
  console.error('用法：npm run new -- "文章标题" [分类文件夹]');
  process.exit(1);
}

const dir = path.join('content', category ?? '');
const file = path.join(dir, `${title.replace(/[\\/:*?"<>|]/g, '-').trim()}.md`);
if (fs.existsSync(file)) {
  console.error(`已存在：${file}`);
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const content = `---
title: ${JSON.stringify(title)}
date: ${date}
tags: []
description: ""
draft: true
---

在这里写下第一段。

## 小标题

> [!tip] 提示
> 写完后把 frontmatter 中的 \`draft: true\` 删掉，文章才会被发布。
`;

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, content, 'utf8');
console.log(`✓ 已创建 ${file}`);
