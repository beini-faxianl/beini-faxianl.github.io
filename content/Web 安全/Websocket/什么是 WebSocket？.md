---
title: 什么是 WebSocket？
date: 2026-10-26
updated: 2026-10-26
tags:
  - WebSocket
  - 介绍
  - javascript
description: 什么是 WebSocket？
---
## 介绍

WebSocket 是一种让客户端与服务器之间能通过 TCP 建立全双工（双方均能发、收数据，并且互不影响）双向通信的协议，常用于现代 Web 应用之中。

要建立 WebSocket，客户端与服务器之间需要通过一轮 HTTP 请求-响应来进行握手，请求：

```http
GET /chat HTTP/1.1
Host: normal-website.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: wDqumtseNBJdhkihL6PW7w==
Connection: keep-alive, Upgrade
Cookie: session=KOsEJNuflw4Rd9BDNrVmvwBF9rEijeE2
Upgrade: websocket
```

响应：

```http
HTTP/1.1 101 Switching Protocols
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Accept: 0FFP+2nmNIf/h+4BP36k9uzrYGk=
```

握手的报文特征：

- 请求和响应中的 `Connection` 和 `Upgrade` 标头表明这是一次 WebSocket 握手
- `Sec-WebSocket-Version` 请求标头指定客户端希望使用的 WebSocket 协议版本（通常为 `13`）
- `Sec-WebSocket-Key` 请求标头包含一个经过 Base64 编码的随机值，每次握手请求都应随机生成该值。
- `Sec-WebSocket-Accept` 响应标头包含一个哈希值（传输的时候是其 Base64 编码后的形态），该哈希值由 `Sec-WebSocket-Key` 的值与协议规范中定义的特定字符串拼接后进行 SHA-1 计算而成

`Sec-WebSocket-Key` 和 `Sec-WebSocket-Accept` 这两个字段主要用于“确保建立 WebSocket 双方都支持 WebSocket 协议”，因为支持 WebSocket 协议的服务器会给出正确的 `Sec-WebSocket-Accept`，客户端可以通过相同的方法计算哈希值进行验证，避免与不支持 WebSocket 的服务器建立连接。

握手完成之后，后续客户端与服务器之间就可根据 WebSocket 协议规范在已经建立的 TCP 连接上进行双向通信（不再用到 HTTP）。

## 通过 JavaScript 实现 WebSocket 客户端

```js
const socket = new WebSocket('wss://0a6c00bc0309e78a8011034900170059.web-security-academy.net/chat');

socket.addEventListener('open', (event) => {
    console.log('✅ WebSocket 连接已建立');
    // 发送文本数据
    socket.send('Hello Server!');
    // 发送 JSON 数据（需序列化）
    socket.send(JSON.stringify({ message: 'Hello Server!' }));
});

// 监听接收服务端消息事件
socket.addEventListener('message', (event) => {
    console.log('📩 收到服务器消息:', event.data);

    // 如果服务端返回的是 JSON 字符串，可以解析它：
    try {
        const data = JSON.parse(event.data);
        console.log('解析后的对象:', data);
    } catch (e) {
        // 非 JSON 文本或二进制数据
    }
});

// 监听连接关闭事件
socket.addEventListener('close', (event) => {
    console.log(`❌ 连接已关闭，状态码: ${event.code}, 原因: ${event.reason}`);
});

// 监听错误事件
socket.addEventListener('error', (error) => {
    console.error('⚠️ WebSocket 发生错误:', error);
});

// 主动关闭连接（在需要的时候调用）
// socket.close(1000, '客户端正常关闭');
```

`wss` 协议通过加密的 TLS 连接建立 WebSocket，而 `ws` 协议使用未加密的连接。但是无论采用哪种，Burp Suite 中都能看到客户端与服务器间交流的信息（见[[Burp Suite 中处理 WebSocket|笔记]]），因为在“浏览器-Burp Suite 代理服务器-目标服务器”场景中，建立的 WebSocket 其实有两条，即：

- 浏览器与 Burp Suite 代理服务器的
- Burp Suite 代理服务器与目标服务器的

因此，掌握两边解密密钥的 Burp Suite 当然能看到明文信息。