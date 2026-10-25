---
title: argparse 模块
date: 2026-10-24
updated: 2026-10-24
tags:
  - Python
  - CLI
  - argparse
description: argparse 模块
---
## 基本模板

```python
import argparse

# 创建 ArgumentParser 对象
parser = argparse.ArgumentParser(
	description='Logon Something'
)

# 设置参数
parser.add_argument('-d','--domain',help='指定域名')
parser.add_argument('--no-pass', action='store_true', help='不提供密码')
parser.add_argument('-t', '--timeout', type=int, default=10 ,help='超时')

# 参数解析
args = parser.parse_args()

# 参数获取
args.domain
args.no_pass # 注意这个写法
args.timeout
```

其中，`add_argument` 和 `argparse.ArgumentParser` 方法中的参数可以参见[官方文档](https://docs.python.org/zh-cn/3.15/library/argparse.html)（挺多的，有些也挺实用）。