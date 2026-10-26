---
title: Burp Suite 中处理 WebSocket
date: 2026-10-26
updated: 2026-10-26
tags:
  - BurpSuite
  - WebSocket
description: Burp Suite 中处理 WebSocket
---
>[!tip]
> 如果还不了解什么是 WebSocket，请查看[[什么是 WebSocket？| 这篇文章]]。

在 Proxy 模块中的 WebSockets history 选项卡中能看到握手之后客户端与服务器之间的交互：

![[Pasted image 20261026034310.png]]

你可以选中其中的某条交互，右键 → Send to Repeater，将其重放到 Repeater 中：

![[Pasted image 20261026034652.png]]

在左侧面板的右上角有一个铅笔图案，点开能看到建立过的 WebSocket 连接：

![[Pasted image 20261026034755.png|600]]

对于那些依旧保持 WebSocket 连接的（`Connected` 字段有勾），可以通过右下角的“Attach”来指定使用该 WebSocket，选中之后会在请求面板上方显示：

![[Pasted image 20261026035345.png]]

对于那些连接已经断开的 WebSocket（`Connected` 字段没有勾），选中后可以通过重新发送握手请求来建立连接：

![[Pasted image 20261026034935.png|600]]

![[Pasted image 20261026035032.png|600]]

