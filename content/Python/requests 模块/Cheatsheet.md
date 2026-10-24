---
title: Cheatsheet
date: 2026-10-01
updated: 2026-10-05
tags:
  - Python
  - Cheatsheet
  - requests
description: 一句话摘要
---
## GET 请求

```python
target_url = 'https://example.com'

headers = {}

resp = requests.get(target_url, headers=headers)
```

此时构造的请求大致：

```http
GET / HTTP/1.1
Host: example.com
User-Agent: python-requests/2.32.5
Accept-Encoding: gzip, deflate, br
Accept: */*
Connection: keep-alive
```

如果自定义了一些 Header：

- 与默认的重复的，会用新的覆盖
- 默认没有的，会添加上

## 获取响应正文

```python
target_url = 'https://example.com'

headers = {}

resp = requests.get(target_url, headers=headers)

print(resp.text)
```

## 获取响应头

```python
target_url = 'https://example.com'

headers = {}

resp = requests.get(target_url, headers=headers)

for header value in resp.headers.items():
	print(f'{header}: {value}') 
```

## 请求走代理

```python
# 以 Burp Suite 的默认代理地址为例子
proxies = {
    'http': 'http://127.0.0.1:8080',
    'https': 'http://127.0.0.1:8080',
}

target_url = 'https://example.com'

headers = {}

resp = resp = requests.get(target_url, proxies=proxies, verify=False, headers=headers)
```

注意，`requests` 库默认会进行严格的证书校验，而像 Burp Suite 这类的抓包工具所提供的代理会将目标站点的证书替换成自己的，导致校验失败，因此需要带上 `verify=False`。


对 HTTPS 请求会校验目标的证书

需要带上 `verify=False`

```python
import requests, json

# Burp Suite 的默认代理地址
proxies = {
    'http': 'http://127.0.0.1:8080',
    'https': 'http://127.0.0.1:8080',
}
# 证书透明度日志
def ct_log(domain, headers={}, proxy=False):
    crt_sh_url = f'https://crt.sh/json?q={domain}'

    if proxy:
        resp = requests.get(crt_sh_url, verify=False, headers=headers, proxies=proxies)
    else:
        resp = requests.get(crt_sh_url, verify=False, headers=headers)
    if resp.status_code == 429:
        print('Too Many Requests')
        return False
    else:
        return resp.text

if __name__ == '__main__':
    t = ct_log('mnnu.edu.cn', proxy=True)
    if t:
        results = json.loads(t)
        common_name = []
        name_value = []
        for result in results:
            common_name.append(result['common_name'])
            name_value.append(result['name_value'])
        print(list(set(common_name)))
        print(list(set(name_value)))
```