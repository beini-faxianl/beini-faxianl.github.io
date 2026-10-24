---
title: concurrent.futures 模块
date: 2026-10-24
updated: 2026-10-24
tags:
  - Python
  - 多线程
description: 一句话摘要
---
## 多线程（`map()`）

```python
import concurrent.futures
import subprocess

nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# 使用 dnsx 命令解析目标域名，判断目标域名是否有 A 记录
def test(num):
    print(num)
    return num
    pass

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    results = executor.map(test, nums)

print('---- 分隔线 ----')
for num in results:
    print(num)
```

输出：

```
1
2
3
5
4
6
9
10
7
8
---- 分隔线 ----
1
2
3
4
5
6
7
8
9
10
```

其中，`map` 的第一个参数用于指定函数名，后续创建的每个线程执行的都是这个函数（记为函数 A），`map` 的第二个参数及其后续参数都是传给函数 A 的，但是这些参数都需要是一个**可迭代对象**，比如：

- 列表
- 字典
- 元组
- ……

用 `map` 实现的多线程，并发的线程的执行顺序虽然不确定，就像示例中的：

```
……
3
5
4
……
```

但是用于接收每个线程所执行函数的返回值的 `results`（是一个列表，对于没有返回值的函数会将返回值设为 None）是按照顺序来的：

```
---- 分隔线 ----
1
2
3
4
……
```

## 多线程（`submit()`）

`submit()` 相对于 `map()` 会更加灵活，因为它返回的是一个 Future 对象。

```python
import concurrent.futures
import subprocess

nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# 使用 dnsx 命令解析目标域名，判断目标域名是否有 A 记录
def test(num):
    return num

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    futures = [
        executor.submit(test, num)
        for num in nums
    ]
    
    # 谁先执行完就先处理谁
    for future in concurrent.futures.as_completed(futures):
        if future.result() % 2 == 0:
            print(future.result())
```

输出：

```
6  
2  
4  
10  
8
```

`submit()` 会返回一个 Future 对象，其第一个参数用于指定函数名，后续创建的每个线程执行的都是这个函数（记为函数 A），`submit()` 的第二个参数及其后续参数都是传给函数 A 的。与 `map()` **不同**的是，这些传给函数 A 的参数**不需要**是一个可迭代对象，这是 `submit()` 更灵活的原因之一，你可以灵活安排交给线程池处理的内容。

`for future in concurrent.futures.as_completed(futures)` → 每当有 `Future` 完成时，就把对应的 `Future` 交出来，让 `for` 循环先处理它。这同样展现了 `submit()` 的灵活性，因为我可以按需处理线程执行完成后的结果，而且 Future 对象本身也提供了一些方法来获取更丰富的信息：

- `done()`，如果调用已成功取消或已完成运行，则返回 `True` 
- `result()`，返回调用返回的值
- ……

