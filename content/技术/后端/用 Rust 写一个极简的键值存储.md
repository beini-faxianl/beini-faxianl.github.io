---
title: 用 Rust 写一个极简的键值存储
date: 2026-09-15
tags: [rust, 数据库, 系统设计]
cover: "[[diagram-layers.svg]]"
description: 从一个 HashMap 出发，加上追加日志与压缩，两百行 Rust 实现一个能持久化的键值存储。
---

很多数据库的核心思想其实很朴素。这篇文章用不到两百行 Rust，实现一个**基于追加日志（append-only log）**的键值存储，思路来自 Bitcask。整体结构见上方的封面图。

## 设计

- 所有写操作都**追加**到日志文件末尾，从不原地修改；
- 内存里维护一个索引：`key → 日志中的偏移量`；
- 日志过大时做一次**压缩**，只保留每个 key 的最新值。

> [!info] 为什么是追加写？
> 顺序写磁盘比随机写快一个数量级以上；而且崩溃后只需要从头重放日志就能恢复索引。

## 数据格式

每条记录序列化为一行 JSON：

```rust file:src/command.rs
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub enum Command {
    Set { key: String, value: String },
    Remove { key: String },
}
```

## 核心结构

```rust file:src/store.rs ln:true
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::PathBuf;

pub struct KvStore {
    path: PathBuf,
    writer: File,
    index: HashMap<String, u64>, // key -> 记录起始偏移
    stale_bytes: u64,            // 可以被压缩掉的字节数
}

impl KvStore {
    pub fn open(path: impl Into<PathBuf>) -> anyhow::Result<Self> {
        let path = path.into();
        let writer = OpenOptions::new().create(true).append(true).read(true).open(&path)?;
        let mut store = KvStore { path, writer, index: HashMap::new(), stale_bytes: 0 };
        store.replay()?; // 重放日志，重建索引
        Ok(store)
    }

    pub fn set(&mut self, key: String, value: String) -> anyhow::Result<()> {
        let offset = self.writer.seek(SeekFrom::End(0))?;
        let cmd = Command::Set { key: key.clone(), value };
        writeln!(self.writer, "{}", serde_json::to_string(&cmd)?)?;
        if self.index.insert(key, offset).is_some() {
            self.stale_bytes += 1; // 旧记录变成垃圾
        }
        self.maybe_compact()
    }
}
```

读取时按偏移量直接定位：

```rust
pub fn get(&self, key: &str) -> anyhow::Result<Option<String>> {
    let Some(&offset) = self.index.get(key) else { return Ok(None) };
    let mut reader = BufReader::new(File::open(&self.path)?);
    reader.seek(SeekFrom::Start(offset))?;
    let mut line = String::new();
    reader.read_line(&mut line)?;
    match serde_json::from_str(&line)? {
        Command::Set { value, .. } => Ok(Some(value)),
        Command::Remove { .. } => Ok(None),
    }
}
```

## 压缩

当垃圾比例超过阈值 $\theta$ 时触发压缩。设日志总大小为 $S$，无效数据为 $G$，则：

$$
\text{compact} \iff \frac{G}{S} > \theta, \quad \theta = 0.5
$$

压缩就是把索引中仍然有效的记录写入新文件，再原子地替换旧文件：

```rust hl:14
fn compact(&mut self) -> anyhow::Result<()> {
    let tmp = self.path.with_extension("compacting");
    let mut out = File::create(&tmp)?;
    let mut new_index = HashMap::with_capacity(self.index.len());
    for (key, _) in &self.index {
        if let Some(value) = self.get(key)? {
            let offset = out.stream_position()?;
            let cmd = Command::Set { key: key.clone(), value };
            writeln!(out, "{}", serde_json::to_string(&cmd)?)?;
            new_index.insert(key.clone(), offset);
        }
    }
    out.sync_all()?;
    std::fs::rename(&tmp, &self.path)?;
    self.index = new_index;
    self.stale_bytes = 0;
    Ok(())
}
```

> [!danger] 别忘了 fsync
> `rename` 之前必须 `sync_all()`，否则断电后可能得到一个“改名成功但内容为空”的文件。

## 性能

在我的笔记本上（M3，NVMe）简单测了一下：

| 操作 | 吞吐 |
| --- | ---: |
| 顺序写 | ~ 410k ops/s |
| 随机读 | ~ 180k ops/s |
| 压缩 100 万条 | 1.3 s |

## 下一步

- [ ] 用二进制格式替代 JSON
- [ ] 加上 CRC 校验，处理日志尾部的半条记录
- [ ] 多线程读：`Arc<RwLock<…>>` 或者无锁索引
- [x] 写一篇博客

另一种完全不同的并发模型，可以看看 [[理解 JavaScript 事件循环]]。
