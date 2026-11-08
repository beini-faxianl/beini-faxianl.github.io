---
title: OAuth 介绍
date: 2026-11-05
updated: 2026-11-05
tags:
  - OAuth
  - 介绍
description: OAuth 介绍
---
## 介绍

OAuth 是一个开放标准。假设有两个网站 A 和 B，OAuth 允许 A 在不知晓你在 B 上的凭据的前提下，使用你 B 上的数据或者权限。

>[!info]
> 目前（2026）主流的版本为 OAuth 2.0（本分类中的笔记也都围绕该版本展开）。

平时看到的“第三方登入”就用到了 OAuth。

OAuth 中定义了四个角色：

| 角色    | 含义                          |
| ----- | --------------------------- |
| 资源所有者 | 你，即用户                       |
| 客户端   | 想要访问资源所有者在应用 B 上的数据的应用 A    |
| 授权服务器 | 验证资源所有者身份，通过后向客户端颁发访问令牌     |
| 资源服务器 | 托管资源所有者的数据的应用 B，并会接收和处理访问令牌 |

OAuth 定义了很多的访问令牌的颁发方式，这些方式被称为 OAuth 授权类型，主要包含：

- 授权码
- 隐式授权 ← 在 Outh 2.1 中被弃用
- 设备码
- 刷新令牌
- 客户端凭据

这些都可以在[官方文档](https://oauth.net/2/grant-types/)中看到精确的解释，这里仅讲述“授权码”和“隐式授权”这两个，因为他们和本分类中的其他笔记关系最密切。

## 授权码

这是 OAuth 2.0 中使用最广泛的授权类型，其整体流程（图源于 [RFC 文档](https://www.rfc-editor.org/info/rfc6749/#section-4.1)）：

![[Pasted image 20261107024922.png|600]]

>[!tip]
> 图中的 User-Agent 表示用户代理，最常见的就是浏览器。

该图很好地展示了用户代理上能看到哪些信息，这对后续漏洞的理解是有帮助的。

其流程如下（）：

### 第一步：授权请求

客户端将用户的浏览器重定向到授权服务器的**授权端点**，并携带：

- `response_type=code`
- `client_id`
- `redirect_uri`
- `scope`
- `state`

>[!tip]
> 授权端点的名称并不固定，常见的有 `/authorization`、`/authorize`、`/auth`。

在 HTTP 历史报文中找到授权端点并不难，只需要观察请求参数：

```http
GET /authorization?client_id=12345&redirect_uri=https://client-app.com/callback&response_type=code&scope=openid%20profile&state=ae13d489bd00e3c24 HTTP/1.1
Host: oauth-authorization-server.com
……
```

参数解释：

| 参数名             | 描述                                                                                     |
| --------------- | -------------------------------------------------------------------------------------- |
| `client_id`     | 必填参数，其值为客户端标识符（客户端在授权服务器上注册的时候会被分配此值，授权服务器内唯一）。                                        |
| `redirect_uri`  | 可选参数，用于指定授权服务器应该向客户端的哪个 URI 发送授权码。RFC 中的叫法为 Redirection endpoint 即重定向端点，但是人们也常称其为：回调 URI、回调端点。                             |
| `response_type` | 必填参数，用于指定授权服务器应该返回什么。对于授权码授权类型，该值应为 `code`，即授权服务器应该返回授权码 。                             |
| `scope`         | 可选参数，用于指定客户端想从授权服务器上获得的权限范围。示例见下。                                                      |
| `state`         | 可选参数（但推荐），存储一个唯一且无法猜测的值，供客户端在请求与回调之间绑定会话，用于防范跨站请求伪造（CSRF）。在授权服务器携带授权码访问重定向端点的时候会携带上该值。 |

`scope` 由一个个的 `scope-token` 构成（用空格分隔），`scope-token` 的定义：

```
scope-token = 1*( %x21 / %x23-5B / %x5D-7E )
```

解读：至少一个字符，字符范围是可打印 ASCII，但排除空格、双引号、反斜杠。

示例：

```
scope=contacts
scope=contacts.read
scope=contact-list-r
scope=https://oauth-authorization-server.com/auth/scopes/user/contacts.readonly
```

可见，RFC 中并没有给 `scope` 定义任何的特定值，因为 `scope` 在很大程度上取决于服务的内部架构和需求。

热门服务中的 `scope` 示例： 

- [Slack](https://api.slack.com/docs/oauth-scopes)
- [GitHub](https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/)
- [Google](https://developers.google.com/identity/protocols/googlescopes)
- [FitBit](https://dev.fitbit.com/build/reference/web-api/developer-guide/application-design/#Scopes)

### 第二步：授权响应

授权服务器收到授权请求之后，首先会验证资源所有者的身份。验证成功之后，资源所有者能看到 `scope` 所规定的授权范围，他们能选择是否同意客户端获得这些权限。

如果资源所有者选择同意，授权服务器将生成一个授权码。接着，授权服务器会对 `redirect_uri` 所指定的回调端点发起访问，并携带 `code`（存放授权码）和 `state`（非必须，在[[#第一步：授权请求|上一步骤中提到过]]）作为查询参数：

```http
GET /callback?code=a1b2c3d4e5f6g7h8&state=ae13d489bd00e3c24 HTTP/1.1
Host: client-app.com
```

### 第三步：访问令牌请求

这一请求（包括下一步，即“[[#第四步：访问令牌响应|访问令牌响应]]”）是客户端与授权服务器之间的，资源所有者的浏览器看不到这一过程的（抓包工具自然也看不到）。这一“仅客户端与授权服务器之间的通信”行为，在许多文献或者博客中被称为“后通道（Back Channel）”。

客户端会通过**后通道**，向授权服务器的令牌端点（Token Endpoint）发起请求。请求会携带之前申请到的授权码，用于兑换访问令牌。

>[!tip]
> 同“授权端点”，令牌端点也没有固定的名称，常见的：`/token`。

示例：

```bash
POST /token HTTP/1.1
Host: oauth-authorization-server.com
…
client_id=12345&client_secret=SECRET&redirect_uri=https://client-app.com/callback&grant_type=authorization_code&code=a1b2c3d4e5f6g7h8
```

除了用于携带授权码的 `code` 参数之外，还有一个必须提供的参数，即 `grant_type`，它用于指定 OAuth 授权类型，在授权码授权类型中，应固定地设置为：

```http
grant_type=authorization_code
```

授权服务器不单单要验证授权码，还会验证客户端的身份，因此客户端还需要提供能验证身份的信息。

客户端密码验证是最常见的做法。通过 HTTP Basic，向授权服务器发送：

```http
Authorization: Basic czZCaGRSa3F0Mzo3RmpmcDBaQnIxS3REUmJuZlZkbUl3
```

`czZCaGRSa3F0Mzo3RmpmcDBaQnIxS3REUmJuZlZkbUl3` 是 `用户名:密码` 经过 base64 编码后的结果：

```
s6BhdRkqt3:7Fjfp0ZBr1KtDRbnfVdmIw
↓ base64
czZCaGRSa3F0Mzo3RmpmcDBaQnIxS3REUmJuZlZkbUl3
```

当然，还可以通过前面示例的方式，即通过提供：

```http
client_id=12345&client_secret=czZCaGRSa3F0Mzo3RmpmcDBaQnIxS3REUmJuZlZkbUl3
```

这两个参数来传递客户端密码（但这是 RFC 中不推荐的方式）。

### 第四步：访问令牌响应

授权服务器验证访问令牌请求，如果一切符合预期，则返回访问令牌（通常还会返回刷新令牌）：

```http
HTTP/1.1 200 OK
Content-Type: application/json;charset=UTF-8
Cache-Control: no-store
Pragma: no-cache

{
  "access_token":"2YotnFZFEjr1zCsicMWpAA",
  "token_type":"example",
  "expires_in":3600,
  "refresh_token":"tGzv3JOkF0XG5Qx2TlKWIA",
  "example_parameter":"example_value"
}
```

### 第五步：API 调用

客户端此时就可以拿着访问令牌向资源服务器的 API 发起调用了。

此过程也在后通道中完成。

访问令牌通常放在 `Authorization: Bearer` 中：

```http
GET /userinfo HTTP/1.1
Host: oauth-resource-server.com
Authorization: Bearer z0y9x8w7v6u5
```

### 第六步：资源授权

资源服务器收到调用后，会验证访问令牌是否有效，以及它是否属于当前客户端应用程序。如果是，资源服务器将根据访问令牌所对应的 `scope` 发送所请求的资源。

## 隐式授权

这是早期为“客户端通过 JS 去走 OAuth 流程”设计的，其步骤如下：

![[Pasted image 20261107031133.png|600]]

### 第一步：授权请求

该步骤和授权码授权类型非常相似，唯一的主要区别是，`response_type` 需要设置为 `token`：

```http
GET /authorization?client_id=12345&redirect_uri=https://client-app.com/callback&response_type=token&scope=openid%20profile&state=ae13d489bd00e3c24 HTTP/1.1
Host: oauth-authorization-server.com
```

### 第二步：访问令牌响应

同样，授权服务器需要验证资源所有者的身份，验证成功后，让资源所有者确认 `scope` 所列举的授权范围。

资源所有者如果同意授权，授权服务器会将其浏览器重定向到授权请求中指定的 `redirect_uri`，并将访问令牌及其他令牌相关数据作为 URL 片段（URL fragment）发送：

```http
GET /callback#access_token=z0y9x8w7v6u5&token_type=Bearer&expires_in=5000&scope=openid%20profile&state=ae13d489bd00e3c24 HTTP/1.1
Host: client-app.com
```

由于访问令牌被放在 URL 片段中（它不会直接发送给客户端应用程序），因此客户端应用程序必须使用适当的脚本（JS）来提取片段中访问令牌并将其保存。

### 第三步：API 调用

流程同授权码授权类型。但是这有个关键区别，即访问令牌的可见性。

在授权码授权类型中，访问令牌对用户是不可见的，因此对 API 的调用只能由客户端发起。

但在隐式授权中，访问令牌用户可见，因此用户当然可以拿着令牌自行对 API 发起调用。

### 第四步：资源授权

同授权码授权类型，不再赘述。

## OpenID Connect

OAuth 仅作授权，并不验证当前使用客户端的用户（在文档中常被叫为“终端用户”）是否是真正的资源所有者。

为了弥补这个不足，引入了一个基于 OAuth 2.0 规范的框架，即 [OpenID Connect](https://openid.net/specs/openid-connect-core-1_0.html)（OIDC）。

需要注意两个术语：

- 实现了 OpenID Connect 的授权服务器被称为 OpenID Providers（简称 OP）
- 在 OpenID Connect 框架中的客户端也被称为 Relying Parties（简称 RP）

若要使用 OpenID Connect，RP 必须在授权请求中向 `scope` 参数添加 `openid`：

```http hlt:openid
GET /authorize?response_type=code&client_id=s6BhdRkqt3&redirect_uri=https%3A%2F%2Fclient.example.org%2Fcb&scope=openid%20profile%20email&state=af0ifjsldkj&nonce=n-0S6_WzA2Mj
Host: server.example.com
```

#### ID 令牌

在 OpenID Connect 框架中，用户在 OP 完成认证之后，OP 会向 RP 发送一个 ID Token，这是一个 JWT 格式的令牌，当然其出现的形式往往是 JWS 或者 JWE。

>[!tip]
> 关于 JWT 的介绍，可见[[什么是 JWT？|这篇文章]]。

客户端会从两方面验证 ID Token：

- JWS/JWE 在密码学上的校验
- JWT 中的声明

这大大提升了客户端的可信度，但是无论是验证流程的具体实现还是 JWT 本身都可能存在不安全的实现。

### `response_type`

采用 OpenID Connect 的，需要在授权请求中指定：

```http
response_type=id_token
```

**注意**，OAuth 支持多种响应类型，因此客户端完全可以组合不同的响应类型（用空格分隔），例如：

```http
response_type=id_token token
response_type=id_token code
```
