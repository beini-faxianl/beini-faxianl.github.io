---
title: Burp Suite 中处理 GraphQL
date: 2026-10-20
updated: 2026-10-20
tags:
  - BurpSuite
  - GraphQL
description: 一句话摘要
---
>[!tip]
> 建议先了解什么是 GraphQL，参考[[什么是 GraphQL？|这篇文章]]。

## GraphQL 选项卡

当 Burp Suite 检测到 GraphQL 请求之后，会在请求面板中出现一个 GraphQL 选项卡（无需安装任何插件）：

![[Pasted image 20261019233517.png|600]]

## 内省

Burp Suite 可以为你生成内省查询，以便发送到目标应用程序。

操作步骤：

### 第一步：找到发往 GraphQL 端点的请求

这步可通过浏览请求记录来被动发现，也可以主动向常见的 GraphQL 端点发起访问。

常见端点：

- `/graphql`
- `/api`
- `/api/graphql`
- `/graphql/api`
- `/graphql/graphql`

>[!tip]
> 这些端点的后缀也可能包含版本号，例如 `/graphql/v1` 。

### 第二步：设置内省查询

将请求转发到 Repeater 中，在请求面板中的任意位置右键，选择“GraphQL → Set introspection query”。

这会将内省查询插入到请求面板中。

### 第三步：发送

发送请求，如果目标启用了内省，则会返回相应的结果：

![[Pasted image 20261019235044.png]]

Burp Suite 提供的内省查询适用于大多数 GraphQL 服务器。不过，如果目标使用的是较旧的 GraphQL 服务器，查询可能会失败。对于这种情况，则需要选择“GraphQL → Set legacy introspection query”。

### 第四步：保存到 Site Map 中

对于内省请求的响应，在响应面板中任意位置右键，然后选择“GraphQL → Save GraphQL queries to site map”。

Burp Suite 会将内省过程中发现的每个可用查询都作为一个节点保存到 Site Map 中，你可以检查这些查询，找到想要进一步调查的查询。