---
title: 什么是 JWT？
date: 2026-10-16
updated: 2026-10-16
tags:
  - JWT
  - JWE
  - JWS
description: 对 JWT、JWS、JWE 的介绍。
---
## 基本介绍

JSON Web Token（JWT）是一种紧凑的声明（Claims）表示格式，适用于空间受限的环境，例如 HTTP Authorization 请求头和 URI 查询参数。

>[!info]
> RFC 规范中，建议将 JWT 发音为与英文单词“jot”相同，但是日常交流中，人们更倾向于逐单词念。

JWT 将待传输的声明编码为一个 JSON 对象（也称为“声明集”），类似：

```json
{
    "iss": "portswigger",
    "exp": 1648037164,
    "name": "Carlos Montoya",
    "sub": "carlos",
    "role": "blog_author",
    "email": "carlos@carlos-montoya.net",
    "iat": 1516239022
}
```

声明集内的成员名称被称为“声明名称（Claim Names）”，对应的取值被称为“声明值（Claim Values）”。

该声明集会作为：

- JWS（JSON Web Signature）中的 Payload，或者
- JWE（JSON Web Encryption）中的 Plaintext 

存在。从而使声明能够进行数字签名、通过相关签名算法进行完整性保护或者进行加密。因此，JWT **始终**使用 JWS 紧凑序列化（JWS Compact Serialization）或 JWE 紧凑序列化（JWE Compact Serialization）来表示。

>[!tip]
> 日常说的 JWT 基本上指的就是 JWS。后续讲解会**沿用这个映射关系**，即提到 JWT 就是 JWS（除非特殊说明）。

>[!note]
> JWS 紧凑序列化是用于表示 JWS 的一种数据格式，同样还有 JWS JSON 序列化（JWS JSON Serialization）即将 JWE 表示为 JSON 对象。JWE 紧凑序列化同理。

## JWS

JWS 紧凑序列化由三部分组成（用 `.` 拼接）：

```
BASE64URL(UTF8(JWS Protected Header)) || '.' ||
BASE64URL(JWS Payload) || '.' ||
BASE64URL(JWS Signature)
```

>[!note]
> base64url 编码是在 base64 编码的基础上，将 `+` 替换成 `	-`、将 `/` 替换成 `_` 并且将末尾的填充符（如果有的话）`=` 都去除。因为这些字符在 URL 中有特殊的含义，为了避免歧义从而将他们替换/去除。

Protected Header 意味着 Header 部分也会受到签名的保护（完整性验证）。

>[!tip]
> 在 JWS 紧凑序列化里，没有 Unprotected Header，在 JWS JSON 序列化里面才有。

一个示例：

```
eyJraWQiOiI5MTM2ZGRiMy1jYjBhLTRhMTktYTA3ZS1lYWRmNWE0NGM4YjUiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJwb3J0c3dpZ2dlciIsImV4cCI6MTY0ODAzNzE2NCwibmFtZSI6IkNhcmxvcyBNb250b3lhIiwic3ViIjoiY2FybG9zIiwicm9sZSI6ImJsb2dfYXV0aG9yIiwiZW1haWwiOiJjYXJsb3NAY2FybG9zLW1vbnRveWEubmV0IiwiaWF0IjoxNTE2MjM5MDIyfQ.SYZBPIBg2CRjXAJ8vCER0LA_ENjII1JakvNQoP-Hw6GG1zfl4JyngsZReIfqRvIAEi5L4HV0q7_9qGhQZvy9ZdxEJbwTxRs_6Lb-fZTDpW6lKYNdMyjw45_alSCZ1fypsMWz_2mTpQzil0lOtps5Ei_z7mM7M8gCwe_AGpI53JxduQOaB5HkT5gVrv9cKu9CsW5MS6ZbqYXpGyOG5ehoxqm8DL5tFYaW3lB50ELxi0KsuTKEbD0t5BCl0aCR2MBJWAbN-xeLwEenaqBiwPVvKixYleeDQiBEIylFdNNIMviKRgXiYuAvMziVPbwSgkZVHeEdF5MQP1Oe2Spac-6IfA
```

Header、Payload 部分通过解码就能看到明文信息，推荐使用 `basenc` 命令（以解码 Payload 为例）：

```bash
$ echo -n 'eyJpc3MiOiJwb3J0c3dpZ2dlciIsImV4cCI6MTY0ODAzNzE2NCwibmFtZSI6IkNhcmxvcyBNb250b3lhIiwic3ViIjoiY2FybG9zIiwicm9sZSI6ImJsb2dfYXV0aG9yIiwiZW1haWwiOiJjYXJsb3NAY2FybG9zLW1vbnRveWEubmV0IiwiaWF0IjoxNTE2MjM5MDIyfQ' | basenc --base64url -d | jq
{
  "iss": "portswigger",
  "exp": 1648037164,
  "name": "Carlos Montoya",
  "sub": "carlos",
  "role": "blog_author",
  "email": "carlos@carlos-montoya.net",
  "iat": 1516239022
}
```

明显，Header、Payload 中的内容谁都可以：

- 读，或者
- 篡改

因此，安全性全靠 Signature。

Signature 通常是某种签名算法（RS256、HS256……）使用对应密钥对 `BASE64URL(Header).BASE64URL(Payload)` 进行签名运算后的结果。验证方会对收到的 JWT 中的 Signature 部分进行验签操作，对 Header 或 Payload 的任何改动都将造成验签失败（当然，这是在正确实现的情况下）。

RFC 协议规范在 Header 中定义了一些参数：

| 参数名        | 描述                                                                            |
| ---------- | ----------------------------------------------------------------------------- |
| `alg`      | **必选**。声明保护这个 JWS 所用的签名算法。常见的算法有：`HS256`（HMAC）、`RS256`、`ES256`、`PS256`。       |
| `jku`      | 通过 URI 来向验证方提供一个 JWK Set（由多个 JWK 组成的数组），其中一把就是验签所需要用的公钥。                      |
| `jwk`      | 直接把签名对应的**公钥**以 JWK 格式放进 Header。                                              |
| `kid`      | 密钥标识符（Key ID），一种提示信息，用于指明签名算法所使用的是哪把密钥。                                       |
| `x5c`      | 关于该参数的详细介绍见笔记 [[Header 参数注入]]。                                                |
| `x5u`      | 通过 URI 来提供证书或者证书链（内容同 `x5c`）。                                                 |
| `x5t`      | 证书 DER 编码的 **SHA-1** 指纹，base64url 编码。只是证书的“指纹”，不包含证书本身。验证方需要事先存有证书，再用指纹去匹配。   |
| `x5t#S256` | 证书 DER 编码的 **SHA-256** 指纹，base64url 编码。只是证书的“指纹”，不包含证书本身。验证方需要事先存有证书，再用指纹去匹配。 |
| `typ`      | 整个 JWS 对象的媒体类型（MIME）。                                                         |
| `cty`      | Payload（被保护内容）的媒体类型。                                                          |

>[!tip]
> 表格中，除了 `alg`，其他都是可选参数。

## JWE（仅作为了解）

JWE 紧凑序列化的组成（用 `.` 拼接）：

```
BASE64URL(UTF8(JWE Protected Header)) || '.' ||
BASE64URL(JWE Encrypted Key) || '.' ||
BASE64URL(JWE Initialization Vector) || '.' ||
BASE64URL(JWE Ciphertext) || '.' ||
BASE64URL(JWE Authentication Tag)
```

### Protected Header

一个 JSON 对象，用于描述“这个 JWE 是怎么加密的”。

例如：

```json
{
  "alg": "RSA-OAEP-256",
  "enc": "A256GCM",
  "kid": "key-1",
  "cty": "JWT"
}
```

| 参数    | 描述                       |
| ----- | ------------------------ |
| `alg` | 怎么加密（或协商出）内容密钥 CEK。      |
| `enc` | 用 CEK 加密正文时的算法。          |
| `kid` | 用的是哪把密钥。                 |
| `cty` | 正文的类型。嵌套 JWT 时填 `"JWT"`。 |

使用 ECDH-ES 时，头部里还会带一个 `epk`，即发送方的临时公钥。

这一段不加密，但**受完整性保护**。

### Encrypted Key

JWE 每次加密都会随机生成一个**内容加密密钥（CEK）**。这一段就是用接收方的密钥按 `alg` 把 CEK 加密后的结果。

常见的加密算法：

| 算法                 | 描述                                                    |
| ------------------ | ----------------------------------------------------- |
| `RSA-OAEP-256`     | 用接收方的 RSA 公钥加密 CEK。                                   |
| `A256KW`           | 用双方共享的 AES 密钥包装 CEK。                                  |
| `ECDH-ES+A256KW`   | 先用 ECDH 协商出一个密钥，再用它包装 CEK。                            |
| `dir` 和纯 `ECDH-ES` | CEK 是直接使用或直接协商出来的，不需要传输，所以这一段**为空**，格式上会出现连续两个点 `..`。 |

### Initialization Vector（IV）

加密正文用的**随机数**，用来保证同样的明文每次加密得到不同的密文。

两模式：

- GCM 模式（96 位即 12 字节）
- CBC 模式（128 位即 16 字节）

IV 不需要保密，但**同一个 CEK 下绝不能重复使用**，否则 GCM 的安全性会被彻底破坏。

### Ciphertext

用 CEK 和 IV，按 `enc` 指定的算法加密后的正文，也就是真正的载荷。

加密前的明文（Ciphertext）通常是一个 JWT 声明集或一个嵌套的 JWS。

>[!note]
> 如果头部里有 `"zip":"DEF"`，表示加密前先做了 DEFLATE 压缩。

### Authentication Tag

AEAD 算法（带关联数据的认证加密，即一次运算同时保证机密性和完整性）输出的校验值，覆盖了 Ciphertext 和 Protected Header。解密时会先核对它，只要 Ciphertext、Header 或 IV 有任何一位被改动，就会校验失败并拒绝解密。

### 解密流程

1. 解码 Header，读出 `alg`、`enc`、`kid`
2. 用自己的私钥或共享密钥，按 `alg` 解开 Encrypted Key，得到 CEK（如果是 `dir` 或 `ECDH-ES`，则直接使用或协商出 CEK）
3. 用 CEK、IV，根据 `enc` 指定的算法对 Ciphertext 进行解密，同时校验 Authentication Tag
4. Authentication Tag 校验通过后才会输出明文（如果明文是嵌套的 JWS，还要再验一次签名）

## 参考文章

- [RFC-7519](https://www.rfc-editor.org/info/rfc7519)
- [RFC-7515](https://www.rfc-editor.org/info/rfc7515)
- [RFC-7516](https://www.rfc-editor.org/info/rfc7516)
- [JWT attacks | Web Security Academy](https://portswigger.net/web-security/jwt)