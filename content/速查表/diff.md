---
title: diff
date: 2026-10-01
updated: 2026-10-05
tags:
  - diff
description: diff
---
`diff` 适用于：

- 非 git 仓库，但需要了解版本间发生的变化
- 单纯地比较两个文件或者目录

## 比较整个目录

```bash
diff -ruN <folder_1> <folder_2>
```

- `-r` 表示递归
- `-u` 会以统一格式来标记差异
- `-N` 会把只在一边存在的文件当作空文件，这样新增或删除的文件也会完整显示

## 只输出存在不同的文件（不显示具体内容）

```bash
diff -rq <folder_1> <folder_2>
```

- `-q` 表示仅当文件不同时才报告