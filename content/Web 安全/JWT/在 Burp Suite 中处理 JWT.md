---
title: 在 Burp Suite 中处理 JWT
date: 2026-10-16
updated: 2026-10-16
tags:
  - BurpSuite
  - JWT
  - 插件
  - Inspector
description: 当 JWT 来到 Burp Suite。
---
## Inspector 面板

选中 JWT 中的 Header 或者 Payload 部分，Inspector 就会自动尝试 Base64URL 解码：

![[Pasted image 20261016233259.png]]

## JWT Editor

JWT Editor 是 Burp Suite 中的插件。

几个实用的功能（仅仅只是大致介绍）：

### 高亮

如果请求或者响应中出现了 JWT，该插件会在 HTTP History 中高亮这些请求。

### JSON Web Token 面板

在含 JWT 的请求/响应中，会出现一个额外的面板，即 JSON Web Token。

![[Pasted image 20261016233702.png|500]]

该面板集成了测试 JWT 几乎所有需要的工具。

### JWT Editor 模块

插件安装完成之后，会在 Burp Suite 的顶部出现一个叫“JWT Editor”的新模块。

在该模块中能生成各种签名算法的密钥/密钥对，并且支持以各种格式（JWK、PEM）复制这些密钥。