---
title: 有缺陷的 JWT 签名验证
date: 2026-10-17
updated: 2026-10-17
tags:
  - JWT
  - JWS
  - 签名验证突破
description: 当 JWT 的签名验证存在缺陷，会发生什么？
---
>[!tip]
> 推荐先阅读文章：[[什么是 JWT？]]

## 不验证签名

如果你了解 JWS，会认为：

> 怎么会有人愚蠢到用了 JWS 但是不验证签名。

但这通常不是开发者有意为之。

部分开发者在使用某些 JWT 库的时候，可能：

- 对某些函数的实现并不是非常清楚
- 想当然地以为某个函数包含了验签算法（“既然你提供了 JWS 的实现，想必你已经在该函数中实现了验签了吧”）
- ……

导致“验证签名”并没有被实现。

## none 算法

JWS 中有一个特殊的验签算法，即：

```
{"alg":"none"}
```

这将不采用任何算法去进行签名验证。

在 `none` 算法中，JWS 紧凑序列化的组成如下：

```hlt:.
BASE64URL(UTF8(JWS Protected Header)).BASE64URL(JWS Payload).
```

>[!attention]
> 注意保留末尾的 `.`。

Burp Suite 的 JWT Editor 插件，提供了该攻击的模板：

![[Pasted image 20261017031620.png]]

>[!tip]
> 如果你还不了解该插件，请阅读文章：[[在 Burp Suite 中处理 JWT]]

点击后，会让你选择 `none` 的一些正常或者变体写法以应对不同的情况：

![[Pasted image 20261017031809.png]]

选择完毕后，点击“OK”，你会发现此时的 JWT 已经变成下述模样：

```
BASE64URL(UTF8(JWS Protected Header)).BASE64URL(JWS Payload).
```

并且在 Header 中的 `alg` 参数的值已经变为了你指定的 `none`：

![[Pasted image 20261017032142.png]]

## 暴力破解密钥

某些签名算法（例如 HS256（HMAC + SHA-256））使用任意的独立字符串作为密钥（和密码一样）：

```
u9+udaYDqC1+2Hw2faJszg==
umeshSecret
notesApp#12345
serucity_is_secure_beacuse_it_is
@token2F5e84cb2610411b048c16probono4e60553855ebd5827918
!@2222222fasdhiohDCWQA
replace_with_lengthy_secure_hex
```

>[!info]
> 上述信息截取自著名字典 [SecLists](https://github.com/danielmiessler/seclists)。

在某些场景中，比如：

- 使用了一些常见密钥
- 默认密钥
- 短密钥（可穷举）
- ……

攻击者可以通过 `hashcat` 等工具本地破解密钥。原理很简单，签名保护的内容是 Header 与 Payload，这对用户都是可见信息，只需要根据算法，配合字典中的密钥，进行重新签名操作，签名得到的结果与正确的签名进行比对，相同的签名则意味着密钥对了。

[Hashcat](https://github.com/hashcat/hashcat) 中的模式（mode，`-m` 参数）选择 16500，破解示例：

```bash
hashcat -a 0 -m 16500 eyJraWQiOiI5ZGE0OWVmZS02OTRmLTQ1ZTQtYmM0My01NThiZDIwNjZiNDEiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJwb3J0c3dpZ2dlciIsImV4cCI6MTc5MjIyNjY0Miwic3ViIjoid2llbmVyIn0.HM-v7ER_aojM-EcCAfPwIqzmw3eq4Ubciood5MuhISc /usr/share/seclists/Passwords/scraped-JWT-secrets.txt
```

>[!note]
> `-a` 用于选择攻击模式，其中 0 为 Straight 模式（默认选择 0），`hashcat` 会逐行读取 wordlist 中的每个词作为候选密钥。

Burp Suite Scanner 同样也会尝试本地破解密钥（通过其内置的字典），如果发现破解成功了则会在 `All issues` 中报告给用户：

![[Pasted image 20261017035821.png]]

但是，该方法基本只适用于目标使用了对称签名算法的情况，因为非对称签名算法所使用的公钥通常很长且熵极高，基本不可能被破解成功。

如果你获得了签名所使用的密钥（以 `secret1` 为例），接下来你可以切换到 JWT Editor 面板，并选择“New Symmetric Key”，在弹出的窗口中将密钥填入到 `Specify secret` 中的文本框中：

![[Pasted image 20261017041551.png|500]]

点击“Generate”之后就生成了对应的密钥，并且会给出 Header 中所需要构造的内容（不一定用得到）：

![[Pasted image 20261017042129.png]]

接下来回到 Repeater 中，对你修改后的 JWT 进行重签名操作：

![[Pasted image 20261017042008.png|500]]

在弹出的窗口中，选择你刚刚创建的新密钥（通过 ID），并且勾选针对 Header 的一些操作：

![[Pasted image 20261017042212.png]]

点击 OK 之后，插件就会生成新的 Signature（如果你还勾选了一些修改 Header 的选项，还会修改 Header）。

