---
title: subprocess 模块
date: 2026-10-23
updated: 2026-10-23
tags:
  - Python
  - subprocess
description: 一句话摘要
---
## 跑命令

```python
import subprocess

results = subprocess.run(
            ["ls", "-l"],
            capture_output=True,
            text=True
        )

print(results.stdout)
```

输出：

```
总计 16
-rwxrw-rw- 1 zyf zyf  667 10月22日 21:15 error_page.py
-rwxrw-rw- 1 zyf zyf  544 10月22日 20:30 main.py
-rwxrw-rw- 1 zyf zyf 1972 10月23日 15:28 subdomain.py
-rwxrw-rw- 1 zyf zyf  158 10月23日 15:10 test.py
```

也可以用：

```python
import subprocess

results = subprocess.run(
            "ls -l",
            capture_output=True,
            text=True,
            shell=True
        )

print(results.stdout)
```

输出：

```
总计 16
-rwxrw-rw- 1 zyf zyf  667 10月22日 21:15 error_page.py
-rwxrw-rw- 1 zyf zyf  544 10月22日 20:30 main.py
-rwxrw-rw- 1 zyf zyf 1972 10月23日 15:28 subdomain.py
-rwxrw-rw- 1 zyf zyf  158 10月23日 15:10 test.py
```