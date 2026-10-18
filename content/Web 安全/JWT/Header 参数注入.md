---
title: Header 参数注入
date: 2026-10-17
updated: 2026-10-17
tags:
  - JWT
  - JWS
  - Header
  - 参数注入
description: Header 似乎被注入了奇怪的东东…
---
>[!tip]
> 推荐先阅读文章：[[什么是 JWT？]]

针对 JWS 的 RFC 规范中，对于 Header 中的参数，仅 `alg` 是必须有的，其他都是可选参数。

Header 中的参数多半会参与验签算法中的下述两件事：

- 密钥指定
- 算法指定

如果验证方没有做好白名单或者逻辑实现上存在错误（比如拿客户端提供的密钥去进行验签操作）就会导致客户端自签合法 JWT。

## `jwk` 参数注入

>[!info]
> [[CVE-2018-0114]] 就是这个问题。

回顾 `jwk` 的作用：用于指定验签算法所需要的公钥（以 JWK 格式存储）。

例子（Header）：

```json
{
    "kid": "ed2Nf8sb-sD6ng0-scs5390g-fFD8sfxG",
    "typ": "JWT",
    "alg": "RS256",
    "jwk": {
        "kty": "RSA",
        "e": "AQAB",
        "kid": "ed2Nf8sb-sD6ng0-scs5390g-fFD8sfxG",
        "n": "yy1wpYmffgXBxhAUJzHHocCuJolwDqql75ZWuCQ_cb33K2vh9m"
    }
}
```

正常实现中，服务器应仅使用有限的公钥白名单来验证 JWT 签名，但是在错误实现/配置错误的情况下，可能会将 `jwk` 指定的公钥也用于验签算法，导致客户端能自签合法 JWT。

攻击步骤：

1. 根据算法，本地生成密钥对
2. 将公钥以 JWK 格式存储
3. 在 JWT Header 中添加 `jwk` 参数并为其赋值为准备好的 JWK 格式的公钥
4. 修改 JWT 的相关内容（以达成你的目的）
5. 应用私钥，根据算法得到 Signature
6. 构造出合法的 JWT

虽然可以通过 Python 脚本或者 `openssl` 命令配合 Python 脚本来实现这一过程（参见：[[常用 Python 脚本]]），但是 Burp Suite 的 JWT Editor 插件是**最方便的**。

>[!tip]
> 如果你还不了解该插件，请阅读文章：[[在 Burp Suite 中处理 JWT]]

以 RS256 验签算法为例，打开 JWT Editor 模块，并选择“New RSA Key”：

![[Pasted image 20261017082646.png|500]]

选择格式与密钥长度（密钥长度通常没有要求），选好后点击“Generate”即可生成 JWK 格式的公钥以及私钥（**都**在 Key 文本框中）：

![[Pasted image 20261017082853.png]]

点击“OK”之后，能在 JWT Editor 模块中找到刚刚创建的密钥对：

![[Pasted image 20261017083149.png]]

选中后，右键 → “Copy Public Key as JWK”即可获得 JWK 格式的公钥：

```json
{
    "kty": "RSA",
    "e": "AQAB",
    "kid": "a8d078ee-4580-472c-b07b-cd87f5cd6082",
    "n": "o2mHTDOYw4BoLShqdKJBZyjPjhDpZr83zCDS-jbJ1jTtOLEbMNlY-rP6F8zTcgoC9EluN05INOtoAXE_LBpHommh6iZIDrlejKPHvaajYRsKUUEQbPgpwEzdcxvLq5hFafV6FScbUnLSSBCCiouAhzJwVI28A1KS6e3RjxWcP2jm4ZFRiosaw9EYd-kbm0ylb1yuuuTcBYGCB1W6f211l-PFW88BhadAHTUJQQKh86lFS0mqEWKQ1mrCOtpBisWY_JiQ6dttc2jcz-_2NAgU_ZRcZQkR7jtkCdnmQ-I2Nxru7nI5RsT1dpM6nQO8vOqY2Y8iQKTXySVrLO0yFavVcw"
}
```

将其放入 Header 中：

```json
{
    "kid": "a8d078ee-4580-472c-b07b-cd87f5cd6082",
    "alg": "RS256",
    "jwk": {
	    "kty": "RSA",
	    "e": "AQAB",
	    "kid": "a8d078ee-4580-472c-b07b-cd87f5cd6082",
	    "n": "o2mHTDOYw4BoLShqdKJBZyjPjhDpZr83zCDS-jbJ1jTtOLEbMNlY-rP6F8zTcgoC9EluN05INOtoAXE_LBpHommh6iZIDrlejKPHvaajYRsKUUEQbPgpwEzdcxvLq5hFafV6FScbUnLSSBCCiouAhzJwVI28A1KS6e3RjxWcP2jm4ZFRiosaw9EYd-kbm0ylb1yuuuTcBYGCB1W6f211l-PFW88BhadAHTUJQQKh86lFS0mqEWKQ1mrCOtpBisWY_JiQ6dttc2jcz-_2NAgU_ZRcZQkR7jtkCdnmQ-I2Nxru7nI5RsT1dpM6nQO8vOqY2Y8iQKTXySVrLO0yFavVcw"
	}
}
```

>[!attention] 注意
>如果 Header 中本来就有 `kid` 字段，则需要将其值改为 `jwk` 中对应的 `kid`。因为验证方选择验签密钥可能会依据 `kid`，这可能导致自指定密钥失败。当然，如果原本没有 `kid` 字段，也可以尝试主动加上，毕竟这是可选字段，后端对其是否作处理我们并不知晓

接着根据你想要的去修改 JWT 的内容（比如将 `sub` 的声明值改为 `administrator`），完成之后点击 Sign，并选择刚刚生成的私钥来进行签名：

![[Pasted image 20261017083646.png]]

随后发送即可。

当然，有个非常便捷的方法，即使用 Attack 中提供的“Embedded JWK”模板：

![[Pasted image 20261017084303.png]]

点入后会让你选择签名密钥以及签名算法：

![[Pasted image 20261017084333.png]]

你只需要：

1. 选择刚刚生成的密钥对
2. 指定算法
3. 点“OK”

它会**按照模板**重写 Header 头，固定模板：

```json
{
    "kid": ……,
    "typ": "JWT",
    "alg": ……,
    "jwk": ……
}
```

`kid` 参数会按照 `jwk` 中指定的值来填写。

这在大多数情况下是非常方便的，但是有些时候会破坏原有的 Header 参数（可能出现非预期结果），因此需要**留意这个细节点**。

接下来就是照常改 JWT 然后重新签名（Sign）即可。

## `jku` 参数注入

回顾 `jwu` 的作用：通过 URI 来向验证方提供一个 JWK Set（由多个 JWK 组成的数组），其中一把就是验签所需要用的公钥。

JWK Set 示例：

```json
{
    "keys": [
        {
            "kty": "RSA",
            "e": "AQAB",
            "kid": "75d0ef47-af89-47a9-9061-7c02a610d5ab",
            "n": "o-yy1wpYmffgXBxhAUJzHHocCuJolwDqql75ZWuCQ_cb33K2vh9mk6GPM9gNN4Y_qTVX67WhsN3JvaFYw-fhvsWQ"
        },
        {
            "kty": "RSA",
            "e": "AQAB",
            "kid": "d8fDFo-fS9-faS14a9-ASf99sa-7c1Ad5abA",
            "n": "fc3f-yy1wpYmffgXBxhAUJzHql79gNNQ_cb33HocCuJolwDqmk6GPM4Y_qTVX67WhsN3JvaFYw-dfg6DH-asAScw"
        }
    ]
}
```

JWK Set 有些时候会通过标准端点 `/.well-known/jwks.json` 来展现。

按照正常实现，验证方只会访问可信域。但在不安全的实现中，攻击者可以自行提供 `jku` 指向自己受控的服务器，比如：

```json hl:2,4
{
    "kid": "a8d078ee-4580-472c-b07b-cd87f5cd6082",
    "alg": "RS256",
    "jku": "https://foo.attacker.com/exploit"
}
```

通过 Burp Suite 中的 JWT Editor 插件生成对应算法的密钥对（这点已经在[[#`jwk` 参数注入|上一节]]中讲述过，这里不再赘述），随后在服务器上对应端点（上例中就是 `exploit`）准备好 JWK Set（放入刚刚生成的 JWK 格式的公钥）：

```json hl:6
{
    "keys": [
        {
		    "kty": "RSA",
		    "e": "AQAB",
		    "kid": "a8d078ee-4580-472c-b07b-cd87f5cd6082",
		    "n": "o2mHTDOYw4BoLShqdKJBZyjPjhDpZr83zCDS-jbJ1jTtOLEbMNlY-rP6F8zTcgoC9EluN05INOtoAXE_LBpHommh6iZIDrlejKPHvaajYRsKUUEQbPgpwEzdcxvLq5hFafV6FScbUnLSSBCCiouAhzJwVI28A1KS6e3RjxWcP2jm4ZFRiosaw9EYd-kbm0ylb1yuuuTcBYGCB1W6f211l-PFW88BhadAHTUJQQKh86lFS0mqEWKQ1mrCOtpBisWY_JiQ6dttc2jcz-_2NAgU_ZRcZQkR7jtkCdnmQ-I2Nxru7nI5RsT1dpM6nQO8vOqY2Y8iQKTXySVrLO0yFavVcw"
		}
    ]
}
```

随后：

1. 将 Header 中的 `kid` 切换成你提供公钥中的 `kid`（这点在[[#`jwk` 参数注入|上一节]]中提到过原因）
2. 修改 JWT（以达成你的目的）
3. 重新签名（Sign）得到 Signature
4. 发送

>[!caution]
> 即使服务器应用了域白名单，也可能出现问题（URL 解析差异）。

## `kid` 参数注入

回顾 `kid` 的作用：密钥标识符（Key ID），一种提示信息，用于指明签名算法所使用的是哪把密钥。

验证方往往会有多个密钥来签署不同类型的数据，因此这些密钥通常以 JWK Set 的形式存在，并通过 `kid` 来选择具体使用哪个密钥。

在 [RFC 协议规范中](https://www.rfc-editor.org/info/rfc7515/#section-4.1.4)，并没有对 `kid` 的值结构作具体规定，开发者可以自行选择任意字符串。例如，开发者可能会将数据库中的某个条目作为 `kid` 的参数值，或者用某个文件名作为参数值。这可能会导致：

- 路径遍历
- SQL 注入

等问题。

如果服务器支持使用对称签名算法，攻击者可能会将 `kid` 参数指向一个可预测的静态文件，然后使用与该文件内容相同的密钥来签署合法 JWT。

比如服务器上有一个静态文件 `foo.txt`，其中的内容为：

```
secret1
```

将 `kid` 指向该文件：

```json
{
	"alg": "HS256",
	"kid": "/foo.txt"
}
```

此时，对称签名算法的密钥就是 `secret1`，接下来你可以切换到 JWT Editor 面板，并选择“New Symmetric Key”，在弹出的窗口中将密钥填入到 `Specify secret` 中的文本框中：

![[Pasted image 20261017041551.png|500]]

点击“Generate”之后就生成了对应的密钥，并且会在 Key 中给出 JWK 格式的密钥：

![[Pasted image 20261017042129.png]]

接下来回到 Repeater 中，对你修改后的 JWT 进行重签名操作：

![[Pasted image 20261017042008.png|500]]

在弹出的窗口中，选择你刚刚创建的新密钥（通过 ID），并且勾选针对 Header 的一些操作：

![[Pasted image 20261017042212.png]]

点击 OK 之后，插件就会生成新的 Signature（如果你还勾选了一些修改 Header 的选项，还会修改 Header）。

理论上，你可以对任何文件执行此操作，但最简单的方法之一是使用 `/dev/null` ，它存在于大多数 Linux 系统上。由于这是一个空文件，读取它会返回一个空字符串。因此，使用空字符串签署令牌将生成有效签名。在该情况下，你可以直接使用 Attack 中的模板“Sign with empty key”：

![[Pasted image 20261017215120.png]]

在弹出的选项框中选择对应的算法：

![[Pasted image 20261017215207.png]]

点“OK”之后就完成了空密钥签名。

**注意**，看到 `kid` 为：

```
b7dcc9d6-af9a-405b-8071-caa1d7d1873f
```

不要想当然地以为这一定不是文件名，你依旧需要仔细测试（考虑路径遍历、SQL 注入……），以免错过漏洞。

## `x5c` 参数注入

x5c（X.509 Certificate Chain）用于向验证方提供 X.509 证书或者证书链。证书或证书链会由经过 base64 编码（注意不是 base64url）的证书值（用 DER 编码的、符合 PKIX（X.509 公钥基础设施）规范的一张数字证书的二进制数据）组成的 JSON 数组来表示：

```json
{
  "alg": "RS256",
  "x5c": [
    "MIIE3jCCA8agAwIBAgICAwEw...",
    "MIIE+zCCBGSgAwIBAgICAQ0w...",
    "MIIC5zCCAlACAQEwDQYJKoZIh..."
  ]
}
```

其中，`x5c` 参数值的具体示例：

```json
["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"]
```

解码后通过 `openssl` 命令可以查看证书的具体信息：

```bash
$ echo -n 'MIIE3jCCA8agAwIBAgICAwEwDQYJKoZIhvcNAQEFBQAwYzELMAkGA1UEBhMCVVMxITAfBgNVBAoTGFRoZSBHbyBEYWRkeSBHcm91cCwgSW5jLjExMC8GA1UECxMoR28gRGFkZHkgQ2xhc3MgMiBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTAeFw0wNjExMTYwMTU0MzdaFw0yNjExMTYwMTU0MzdaMIHKMQswCQYDVQQGEwJVUzEQMA4GA1UECBMHQXJpem9uYTETMBEGA1UEBxMKU2NvdHRzZGFsZTEaMBgGA1UEChMRR29EYWRkeS5jb20sIEluYy4xMzAxBgNVBAsTKmh0dHA6Ly9jZXJ0aWZpY2F0ZXMuZ29kYWRkeS5jb20vcmVwb3NpdG9yeTEwMC4GA1UEAxMnR28gRGFkZHkgU2VjdXJlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MREwDwYDVQQFEwgwNzk2OTI4NzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMQt1RWMnCZM7DI161+4WQFapmGBWTtwY6vj3D3HKrjJM9N55DrtPDAjhI6zMBS2sofDPZVUBJ7fmd0LJR4h3mUpfjWoqVTr9vcyOdQmVZWt7/v+WIbXnvQAjYwqDL1CBM6nPwT27oDyqu9SoWlm2r4arV3aLGbqGmu75RpRSgAvSMeYddi5Kcju+GZtCpyz8/x4fKL4o/K1w/O5epHBp+YlLpyo7RJlbmr2EkRTcDCVw5wrWCs9CHRK8r5RsL+H0EwnWGu1NcWdrxcx+AuP7q2BNgWJCJjPOq8lh8BJ6qf9Z/dFjpfMFDniNoW1fho3/Rb2cRGadDAW/hOUoz+EDU8CAwEAAaOCATIwggEuMB0GA1UdDgQWBBT9rGEyk2xF1uLuhV+auud2mWjM5zAfBgNVHSMEGDAWgBTSxLDSkdRMEXGzYcs9of7dqGrU4zASBgNVHRMBAf8ECDAGAQH/AgEAMDMGCCsGAQUFBwEBBCcwJTAjBggrBgEFBQcwAYYXaHR0cDovL29jc3AuZ29kYWRkeS5jb20wRgYDVR0fBD8wPTA7oDmgN4Y1aHR0cDovL2NlcnRpZmljYXRlcy5nb2RhZGR5LmNvbS9yZXBvc2l0b3J5L2dkcm9vdC5jcmwwSwYDVR0gBEQwQjBABgRVHSAAMDgwNgYIKwYBBQUHAgEWKmh0dHA6Ly9jZXJ0aWZpY2F0ZXMuZ29kYWRkeS5jb20vcmVwb3NpdG9yeTAOBgNVHQ8BAf8EBAMCAQYwDQYJKoZIhvcNAQEFBQADggEBANKGwOy9+aG2Z+5mC6IGOgRQjhVyrEp0lVPLN8tESe8HkGsz2ZbwlFalEzAFPIUyIXvJxwqoJKSQ3kbTJSMUA2fCENZvD117esyfxVgqwcSeIaha86ykRvOe5GPLL5CkKSkB2XIsKd83ASe8T+5o0yGPwLPk9Qnt0hCqU7S+8MxZC9Y7lhyVJEnfzuz9p0iRFEUOOjZv2kWzRaJBydTXRE4+uXR21aITVSzGh6O1mawGhId/dQb8vxRMDsxuxN89txJx9OjxUUAiKEngHUuHqDTMBqLdElrRhjZkAzVvb3du6/KFUJheqwNTrZEjYx8WnM25sgVjOuH0aBsXBTWVU+4=' | base64 -d | openssl x509 -inform DER -text -noout
Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number: 769 (0x301)
        Signature Algorithm: sha1WithRSAEncryption
        Issuer: C=US, O=The Go Daddy Group, Inc., OU=Go Daddy Class 2 Certification Authority
        Validity
            Not Before: Nov 16 01:54:37 2006 GMT
            Not After : Nov 16 01:54:37 2026 GMT
        Subject: C=US, ST=Arizona, L=Scottsdale, O=GoDaddy.com, Inc., OU=http://certificates.godaddy.com/repository, CN=Go Daddy Secure Certification Authority, serialNumber=07969287
        Subject Public Key Info:
            Public Key Algorithm: rsaEncryption
                Public-Key: (2048 bit)
                Modulus:
                    00:c4:2d:d5:15:8c:9c:26:4c:ec:32:35:eb:5f:b8:
                    59:01:5a:a6:61:81:59:3b:70:63:ab:e3:dc:3d:c7:
                    2a:b8:c9:33:d3:79:e4:3a:ed:3c:30:23:84:8e:b3:
                    30:14:b6:b2:87:c3:3d:95:54:04:9e:df:99:dd:0b:
                    25:1e:21:de:65:29:7e:35:a8:a9:54:eb:f6:f7:32:
                    39:d4:26:55:95:ad:ef:fb:fe:58:86:d7:9e:f4:00:
                    8d:8c:2a:0c:bd:42:04:ce:a7:3f:04:f6:ee:80:f2:
                    aa:ef:52:a1:69:66:da:be:1a:ad:5d:da:2c:66:ea:
                    1a:6b:bb:e5:1a:51:4a:00:2f:48:c7:98:75:d8:b9:
                    29:c8:ee:f8:66:6d:0a:9c:b3:f3:fc:78:7c:a2:f8:
                    a3:f2:b5:c3:f3:b9:7a:91:c1:a7:e6:25:2e:9c:a8:
                    ed:12:65:6e:6a:f6:12:44:53:70:30:95:c3:9c:2b:
                    58:2b:3d:08:74:4a:f2:be:51:b0:bf:87:d0:4c:27:
                    58:6b:b5:35:c5:9d:af:17:31:f8:0b:8f:ee:ad:81:
                    36:05:89:08:98:cf:3a:af:25:87:c0:49:ea:a7:fd:
                    67:f7:45:8e:97:cc:14:39:e2:36:85:b5:7e:1a:37:
                    fd:16:f6:71:11:9a:74:30:16:fe:13:94:a3:3f:84:
                    0d:4f
                Exponent: 65537 (0x10001)
        X509v3 extensions:
            X509v3 Subject Key Identifier: 
                FD:AC:61:32:93:6C:45:D6:E2:EE:85:5F:9A:BA:E7:76:99:68:CC:E7
            X509v3 Authority Key Identifier: 
                D2:C4:B0:D2:91:D4:4C:11:71:B3:61:CB:3D:A1:FE:DD:A8:6A:D4:E3
            X509v3 Basic Constraints: critical
                CA:TRUE, pathlen:0
            Authority Information Access: 
                OCSP - URI:http://ocsp.godaddy.com
            X509v3 CRL Distribution Points: 
                Full Name:
                  URI:http://certificates.godaddy.com/repository/gdroot.crl

            X509v3 Certificate Policies: 
                Policy: X509v3 Any Policy
                  CPS: http://certificates.godaddy.com/repository
            X509v3 Key Usage: critical
                Certificate Sign, CRL Sign
    Signature Algorithm: sha1WithRSAEncryption
    Signature Value:
        d2:86:c0:ec:bd:f9:a1:b6:67:ee:66:0b:a2:06:3a:04:50:8e:
        15:72:ac:4a:74:95:53:cb:37:cb:44:49:ef:07:90:6b:33:d9:
        96:f0:94:56:a5:13:30:05:3c:85:32:21:7b:c9:c7:0a:a8:24:
        a4:90:de:46:d3:25:23:14:03:67:c2:10:d6:6f:0f:5d:7b:7a:
        cc:9f:c5:58:2a:c1:c4:9e:21:a8:5a:f3:ac:a4:46:f3:9e:e4:
        63:cb:2f:90:a4:29:29:01:d9:72:2c:29:df:37:01:27:bc:4f:
        ee:68:d3:21:8f:c0:b3:e4:f5:09:ed:d2:10:aa:53:b4:be:f0:
        cc:59:0b:d6:3b:96:1c:95:24:49:df:ce:ec:fd:a7:48:91:14:
        45:0e:3a:36:6f:da:45:b3:45:a2:41:c9:d4:d7:44:4e:3e:b9:
        74:76:d5:a2:13:55:2c:c6:87:a3:b5:99:ac:06:84:87:7f:75:
        06:fc:bf:14:4c:0e:cc:6e:c4:df:3d:b7:12:71:f4:e8:f1:51:
        40:22:28:49:e0:1d:4b:87:a8:34:cc:06:a2:dd:12:5a:d1:86:
        36:64:03:35:6f:6f:77:6e:eb:f2:85:50:98:5e:ab:03:53:ad:
        91:23:63:1f:16:9c:cd:b9:b2:05:63:3a:e1:f4:68:1b:17:05:
        35:95:53:ee
```

其中，第一张证书（通常被称为 leaf）**必须**包含用于 JWS 签名算法的公钥。后续每张证书都需要对自己的前一个证书进行认证。对证书链的最后一张证书的验证通常由 JWS 验证方所信任的 CA（称其为**根 CA**）来做（即证书链中的最后一张证书通常由根 CA 签发），这使得客户端很难伪造出合法的证书链。

但如果存在：

- 根 CA 私钥泄露（或者通过某漏洞获取得到）
- 验证方对 `x5c` 的不安全/错误实现（比如只是取第一张证书中的公钥，而没有验证后续证书，[[CVE-2018-0114]] 就是这个问题）

就会导致客户端自签合法 JWT。

JWT Editor 插件对 `x5c` 参数注入并没有提供很好地支持，因此这通常用 Python 脚本来测试（见[[常用 Python 脚本]]）。

## `cty` 参数注入

回顾 `cty` 的作用：Payload 的媒体类型。

Header 虽然通常会省略该参数，但是底层解析库可能仍支持它。如果你已经找到绕过签名验证的方法，可以尝试注入 `cty` 标头，并将内容类型更改为 `text/xml` 或 `application/x-java-serialized-object` ，这可能会为 XXE 和反序列化攻击开辟新的攻击途径。

