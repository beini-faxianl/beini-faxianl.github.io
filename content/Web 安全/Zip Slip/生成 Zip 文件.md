---
title: 生成 Zip 文件
date: 2026-11-12
updated: 2026-11-12
tags:
  - zip
  - Python
  - zip-slip
description: 生成 Zip 文件
---
## zip 命令

```bash
zip example.zip a.txt b.txt c 
```

第一个参数是最终生成文件的 Path（包含文件名），其后面的参数是放入 Zip 的文件或者目录。

如果要将符号链接写入 Zip，需要带上 `-y` 参数：

```bash
zip -y
```

## zipfile 库

生成一个 Zip 文件，并在里面放入文件或者目录：

```python
import zipfile

with zipfile.ZipFile('example.zip', 'w') as z:
	z.write('some.txt') # 已有文件
	z.writestr('pwn.txt', 'Hello!') # 新建文件
```

`w` mode 代表覆盖式写入，如果是追加式写入则用 `a` mode。