---
title: OAuth
date: 2026-10-22
updated: 2026-10-22
tags:
  - OAuth
description: 一句话摘要
---
## OAuth

>[!tip]
> 目前处于待整理状态。

- 访问令牌没有绑定资源所有者
- 授权码没有没有绑定资源所有者

#### 如何识别

客户端应用程序若使用了 OpenID Connect，从授权请求中就能明显看出来（`scope: openid`……）。

客户端有些时候可能支持 OpenID Connect 但目前并没有使用，因此可以尝试在授权请求中尝试添加：

```
scope: openid
response_type=id_token
```

观察是否会导致错误。

查看 OAuth 提供商的文档也是一种方法，看看是否有“支持 OpenID Connect”的相关信息。

你可能还可以从标准端点 `/.well-known/openid-configuration` 尝试访问配置文件。

### 识别 OAuth

非当前应用的第三方连接器、登入方式等都是 OAuth 的信号。

当然，还有更可靠的方式，即通过 HTTP 请求特征。在 OAuth 中，第一条请求总是客户端应应用向授权服务器的授权端点（比如 `/authorization`）发起请求，并且携带很多特殊的参数（前面提到过）：

```http
GET /authorization?client_id=12345&redirect_uri=https://client-app.com/callback&response_type=code&scope=openid%20profile&state=ae13d489bd00e3c24 HTTP/1.1
Host: oauth-authorization-server.com
……
```

### Recon

对 OAuth 服务进行侦察，能为后续的测试提供思路。

从 OAuth 的流程中通常能确定授权服务器的提供商，它们往往会提供 API 的详细文档。

另外，一旦确认授权服务器的主机名之后，应尝试请求下述端点：

```
/.well-known/oauth-authorization-server
/.well-known/openid-configuration
```

这些端点通常会返回一个 JSON 格式的配置文件，里面也许会提供官方文档未提供的信息。

### OAuth 漏洞-客户端应用程序

客户端应用程序通常会使用信誉良好、经过实战检验且能有效防御广为人知攻击的 OAuth 服务（微信、Google……），但是它自身对 OAuth 的实现通常没那么到位。

OAuth 并不自带内置的安全功能，其安全性通常靠实现者的正确使用。但其步骤、参数众多，容易出现配置错误。

#### 隐式授权的不正当实现

隐式授权会将访问令牌通过 URL 片段传输，如果客户端后续还要用到该 Token 则需要将其存储在一个地方（通常是用户浏览器）。

如果访问令牌并没有与用户的相关信息进行绑定，则可能通过重放令牌实现访问限制的突破。

#### 有缺陷的 CSRF 防护

尽管 OAuth 中的许多组件都是可选项，但是其中一些组件是非常推荐使用的，比如 `state` 参数。

`state` 参数会包含一个不可预测的值（通常由用户信息生成的 Hash），该值会用于客户端应用和授权服务器之间的对话，起到类似 CSRF Token 的作用。

若攻击者发现 OAuth 流程中并未启用 `state`，则他可以先自行发起 OAuth 流程，将其中的部分步骤通过 CSRF 交由受害者完成。

>[!tip]
> 使用了 `state` 并不意味着不会遭受 CSRF 攻击。

#### 泄露授权码和访问令牌

攻击者也许会通过 CSRF 等手段，迫使受害者发起 OAuth 认证，并将其中的 `redirect_uri` 替换成自己的服务器从而截获有效授权码或者访问令牌。随后攻击者通过该授权码或访问令牌继续完成 OAuth 后续认证，从而完成在客户端应用程序中以受害者身份进行登入。

#### 有缺陷的 `redirect_uri` 验证

前面提到 `redirect_uri` 可能会被攻击者篡改，有效的防御方式是客户端向授权服务器注册 URL 白名单，但这依旧可能被绕过。

| 可能的情况                | 描述                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 仅检查是否包含或者以 xxx 开头/结尾 | 尝试对合法 URL 进行修改（删除、添加查询参数、添加路径……），查看是否有不报错的情况。                                                                      |
| 可向 URL 添加额外的值        | 尝试不同组件间的解析差异，比如：`https://default-host.com &@foo.evil-user.net#@bar.evil-user.net/`。                                |
| 冗余 `redirect_uri`    | 出现冗余参数的时候，服务器会进行对应的处理（取前者、取后者、合并成数组……），但白名单的逻辑可能只检测了其中一个，如果检测的和最终使用的不一致，就会导致被绕过。                                   |
| `localhost` 的特殊处理    | `localhost` 经常在开发环境中被使用，在某些情况中，对 `localhost` 开头的 `redirect_uri` 都会被允许，这使得攻击者可以构造类似 `localhost.evil.com` 这样的域名实现绕过。 |
| 目录穿越                 | `redirect_uri` 不总是能绕过白名单限制，但是可以在当前白名单 URI 的基础上尝试目录穿越，                                                              |

**注意**，不要孤立地测试 `redirect_uri` 参数。在实际场景中，有时更改一个参数会对另一个参数的验证也产生影响，比如，将 `response_mode` 从 `query` 更改为 `fragment` 有时会完全改变 `redirect_uri` 的解析方式，从而使你能够提交原本会被阻止的 URI。同样，如果你注意到支持 `web_message` 响应模式，这通常允许 `redirect_uri` 中出现更广泛的子域名。

#### 通过代理页面窃取授权码和访问令牌

对于 `redirect_uri`，你不总是能绕过白名单的限制，但是可以在当前白名单 URI 的基础上尝试目录穿越：

```
https://client-app.com/oauth/callback/../../example/path
```

后端经过规范化之后，可能将其解释成：

```
https://client-app.com/example/path
```

一旦你发现了存在这个现象，那么你就需要对能访问的页面进行审计，尝试发现一些能窃取授权码或者访问令牌的方法。

该情景中，最有效的方法之一就是开放重定向，将受害者的访问令牌或者授权码重定向到攻击者的服务器上。

除此之外，还有两个常见的方法：

| 方法              | 描述                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| XSS             | 虽然 XSS 本身就能造成巨大的影响，但是针对 XSS 的限制比如 HttpOnly 增大了窃取 Cookie 的难度。但是如果利用 XSS 去窃取访问令牌或者授权码，部分针对 XSS 的限制会失效，从而提升 XSS 的影响。                   |
| 参数、URL 片段的不安全传递 | 网站有时会实现参数或者 URL 片段传递，这可以被攻击者利用来获取访问令牌或者授权码。                                                                                         |
| HTTP 注入         | 有些时候你无法注入 JS 代码但是可以注入 HTML，部分对外请求，在 Header 中可能会暴露授权码或者访问令牌的信息。比如 `<img src="evil-user.net">`，在 `Referer` 头中可能会暴露当前的 URL（其中可能含授权令牌）。 |

**注意**，Burp Suite 并不会记录 `#` 后的 URL 片段，但这并不意味着用户浏览器上没有该 URL 片段。这是因为 URL 片段只在用户浏览器中传递。

### 有缺陷的范围验证

客户端应用程序使用访问令牌去访问资源服务器，获取的资源会受到 `scope` 的制约，但是在有些情况下，这个制约会被打破。

#### 恶意客户端

如果用户是在攻击者的恶意客户端上进行，攻击者可以在“授权请求”这一步设置 `scope` 为较为安全的范围，比如：

```
scope: openid email
```

这使得受害者批准授权的概率大大提升。

随后在用授权码换访问令牌的时候（这个过程在后通道中进行），替换范围更大的 `scope`：

```http
POST /token
Host: oauth-authorization-server.com
…
client_id=12345&client_secret=SECRET&redirect_uri=https://client-app.com/callback&grant_type=authorization_code&code=a1b2c3d4e5f6g7h8&scope=openid%20 email%20profile
```

如果授权服务器没有将授权码与 `scope` 进行绑定，则可能授予攻击者拥有更高的访问权限的访问令牌。

#### 有缺陷的隐式授权类型

在隐式授权类型中，如果攻击者获取了用户的访问令牌，则攻击者可以主动向资源服务器的 API 发起请求，并且携带修改的 `scope` 参数，以此来获得更宽的权限范围。

**注意**，该申请范围无法超过客户端应用当时向授权服务器注册的时候申请的范围。

### 未充分验证的用户

客户端应用程序可能从 OAuth 提供商获取用户的部分信息来作为登入账号的判断，比如获取：

- 用户名
- 邮箱

就以此确认了对应账号。

但攻击者若能在 OAuth 提供商处注册与受害者同样的信息，客户端应用程序就会将攻击者误判为受害者。

### OpenID Connect 漏洞

#### 未受保护的动态客户端注册

OpenID 提供了一种客户端向 OAuth 提供商注册的方式（常称为“动态客户端注册”）。

该流程中，客户端会向 OAuth 提供商的客户端注册端口（根据 Recon 得到）发起类似这样的请求：

```http
POST /register HTTP/1.1
Content-Type: application/json
Accept: application/json
Host: server.example.com

{
 "redirect_uris": [
   "https://client.example.org/callback",
   "https://client.example.org/callback2"],
 "client_name": "My Example Client",
 "client_name#ja-Jpan-JP":
    "\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u540D",
 "token_endpoint_auth_method": "client_secret_basic",
 "logo_uri": "https://client.example.org/logo.png",
 "jwks_uri": "https://client.example.org/my_public_keys.jwks",
 "example_extension_parameter": "example_value"
}
```

>[!info]
> 关于注册元信息列表，可以参照：[Client Metadata](https://datatracker.ietf.org/doc/html/rfc7591#section-2)。

如果 OAuth 提供商支持开放注册（即无需初始访问令牌）则客户端会注册成功。

这将导致任意客户端都可以向 OAuth 提交注册申请，而且客户端申请的参数中，可能会在后续的交互过程中被 OAuth 提供商所使用，这也许会产生不好的后果。

比如注册元信息中的 `logo_uri`，OAuth 提供商可能会向该 URI 发起访问来获取 Logo 信息，如果攻击者在值中注入 OAuth 提供商内部 URI，则可能导致 SSRF。

#### 授权请求的其他提交方式

常规授权请求是通过查询字符串提交相关的参数，OpenID 提供了新的参数提交方式，即 JWT。

所有需要的参数会被包括在 JWT 的 Payload 部分，通过 `request_uri` 参数来传递 JWT。部分授权服务器可能对常规查询参数具备良好的检测，但针对 JWT 却没有，导致出现各种问题。