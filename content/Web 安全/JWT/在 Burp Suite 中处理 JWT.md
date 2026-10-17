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

几个实用的功能：

### 高亮

如果请求或者响应中出现了 JWT，该插件会在 HTTP History 中高亮这些请求。

### JSON Web Token 面板

在含 JWT 的请求/响应中，会出现一个额外的面板，即 JSON Web Token。

![[Pasted image 20261016233702.png|500]]

该面板集成了测试 JWT 几乎所有需要的工具。

### 编辑 JWT

1. 右键单击包含 JWT 的请求，然后选择“发送到 Repeater”
2. 切换到“JSON Web Token”面板
3. 根据需要编辑“Header”和“Payload”字段中的 JSON 数据
4. 单击“Sign”（此时会打开一个新对话框）
5. 在对话框中选择合适的签名密钥，然后单击“确定”。JWT 将重新签名，以匹配 Header 和 Payload 中的新值。
 
在第五步时，如果发现自己尚未添加签名密钥，请参考下一节。

### 添加 JWT 签名密钥

插件安装完成之后，Burp Suite 顶部会出现 JWT Editor 模块。

1. 进入该模块，切换到“Keys”选项卡
2. 点击要添加的密钥类型对应的按钮（例如，点击“New Symmetric Key”（新建对称密钥）。此时会打开一个新对话框）
3. 在对话框中添加新密钥：
	1. 单击“Generate”以创建新密钥，或者如果你有现成的密钥可以直接将密钥粘贴到对话框中
	2. 根据需要编辑密钥
	3. 单击“OK”保存密钥

