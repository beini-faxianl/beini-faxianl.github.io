---
title: Cheatsheet
date: 2026-10-01
updated: 2026-10-05
tags:
  - Python
  - Cheatsheet
description: 一句话摘要
---
## f-string

```python
name = 'zyf'

print(f'My name is {name}.')
```

输出：

```
My name is zyf.
```

注意，如果 f-string 中需要输出 `{`、`}`，则需要进行双写处理：

```python
name = 'zyf'  
  
print(f'''{{  
    "name": {name},  
    "role": "student"}}''')
```

输出：

```json
{
    "name": zyf,
    "role": "student"
}
```

## 列表中添加数据

```python
a = [] # 等价于 a = list()

a.append('name')

print(a)
```

输出：

```
['name']
```

## 去重

```python
print(set([1, 2, 2, 3, 3, 3]))        # {1, 2, 3}

print(set((1, 2, 2, 3)))              # {1, 2, 3}

print(set('hello'))                   # {'h', 'e', 'l', 'o'}

# 对于字典对象，默认只取键
print(set({'a': 1, 'b': 2, 'a': 3}))  # {'a', 'b'}
```

关于 `set()`：

- 不保证顺序
- 输出的是字典对象

如果要保证顺序，可以用 `dict.fromkeys`：

```python
print(list(dict.fromkeys([1, 2, 2, 3, 1])))        # [1, 2, 3]

print(list(dict.fromkeys((1, 2, 2, 3, 1))))        # [1, 2, 3]

print(list(dict.fromkeys('hello')))                # ['h', 'e', 'l', 'o']

# 对于字典对象，默认只取键
print(list(dict.fromkeys({'a': 1, 'b': 2, 'c': 3, 'a': 4}))) # ['a', 'b', 'c']
```

## 列表 & 集合 & 字典 & 元组

```python
{1, 2, 3}  # 集合

{"a": 1, "b": 2}  # 字典

[1, 2, 3]  # 列表 

(1, 2, 3) # 元组
```

## 字符串按某字符进行分隔（输出列表）

```python
s = "apple,banana,orange"
result = s.split(",")
print(result)
```

输出：

```
['apple', 'banana', 'orange']
```

## 捕获终端输入

```
choice = input('请输入 yes 或者 no')
```

此时终端会卡住，并提示信息“请输入 yes 或者 no”。

当用户完成输入并回车之后，程序会继续往后运行，`choice` 会捕获用户输入的信息。

## 遍历字典中的 Key 和 Value

```python
test = {"a": 1, "b": 2, "c": 3}

for key, value in test.items():
    print(f'{key}: {value}')
```

输出：

```
a: 1
b: 2
c: 3
```