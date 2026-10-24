---
title: json 模块
date: 2026-10-01
updated: 2026-10-05
tags:
  - Python
  - Cheatsheet
  - JSON
description: 一句话摘要
---
## JSON 序列化

```python
import json

python_object = {
        "name": "zyf",
        "role": "student"
}

print(json.dumps(python_object))
```

输出：

```json
{"name": "zyf", "role": "student"}
```

格式缩进：

```python
print(json.dumps(python_object, indent=2))
```

输出：

```json
{
  "name": "zyf",
  "role": "student"
}
```

## JSON 反序列化

```python
import json

json_str = '{\n  "name": "zyf",\n  "role": "student"\n}'

python_obj = json.loads(json_str)

print(python_obj.get('name'))
print(python_obj.get('role'))

# 或者
print(python_obj['name'])
print(python_obj['role'])
```

输出：

```
zyf
student
```

对于 JSON 字符串推荐使用下述写法（当然也可以用 `"""……"""`）：

```python
json_str = '''{
    "name": "zyf",
    "role": "student"
}'''
```

