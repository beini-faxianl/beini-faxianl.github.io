---
title: Tmp
date: 2026-10-01
updated: 2026-10-05
tags:
  - Tmp
  - 漏洞
  - Web
description: Tmp
---
## Network

开发者工具中的 Network 模块，如果访问一个页面出现了两个 HTML，则是页面使用了“内嵌页面”的信号：

![[Pasted image 20261107224349.png]]

最常见的就是 `<iframe>` 标签。