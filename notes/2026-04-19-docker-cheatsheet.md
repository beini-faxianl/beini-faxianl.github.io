---
title: Docker 常用命令速查
date: 2026-04-19
tags: 工具,后端
---

日常用得最多的就这几张表，贴在这里随取随用。

## 容器生命周期

| 命令 | 作用 |
| --- | --- |
| `docker run -d -p 8080:80 nginx` | 后台运行并映射端口 |
| `docker ps -a` | 查看所有容器（含已停止） |
| `docker logs -f <id>` | 跟踪日志 |
| `docker exec -it <id> sh` | 进入容器调试 |
| `docker rm -f $(docker ps -aq)` | 一键清空所有容器 ⚠️ |

## 镜像

```bash
docker build -t myapp:1.0 .     # 构建
docker images                   # 列表
docker image prune -a           # 清理悬空镜像
docker save myapp:1.0 | gzip > myapp.tar.gz   # 离线导出
```

## 几个容易忘的点

- `-v $(pwd):/app` 挂载当前目录，**冒号左边是宿主机**；
- 容器里的 `localhost` 不是宿主机，Linux 下访问宿主机用 `--add-host=host.docker.internal:host-gateway`；
- `Dockerfile` 里每条指令一层缓存，**变动频繁的步骤放后面**，构建才快。

> 速查表的意义不在于背下来，而在于知道自己忘了什么、去哪儿找。
