---
title: WebSocket 安全漏洞
date: 2026-10-26
updated: 2026-10-26
tags:
  - WebSocket
  - 漏洞
description: WebSocket 安全漏洞
---
>[!tip]
> 如果还不了解什么是 WebSocket，请查看[[什么是 WebSocket？| 这篇文章]]。

WebSocket 只是改变了信息传输的方式，因此几乎任何 Web 漏洞都可能通过 WebSocket 发生。

下面仅列举一些有趣的或者需要额外注意的场景。

## 针对 Header 的解析差异

一个很常见的场景：

- 后端服务器并不在意 `X-Forwarded-For` 这个自定义请求头是什么含义，**但是**
- 前端服务器或者中间件会将该请求头作为客户端来源的判断

这将导致一些针对客户端 IP 作的速率限制会被突破（通过 `X-Forwarded-For` 不断地切换来源 IP）。

在建立 WebSocket 的握手阶段，客户端会与服务器进行一次 HTTP 交互，请求大致为：

```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Cookie: session=KOsEJNuflw4Rd9BDNrVmvwBF9rEijeE2
Upgrade: websocket
```

在该阶段，就可能出现前面提到的解析差异的利用。

## CSRF

如果目标网站存在 CSRF 漏洞，则攻击者可以在恶意服务器上实现与某端点建立 WebSocket 连接，并尝试：

- 将获得的响应输出（可能会得到敏感信息）
- 发送一些信息来执行未授权操作