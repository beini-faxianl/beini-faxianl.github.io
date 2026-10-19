---
title: rbenv
date: 2026-10-20
updated: 2026-10-20
tags:
  - 前端
  - react
description: rbenv
---
## 简介

`rbenv` 是一个轻量级的 Ruby 版本管理工具，用于在 Unix-like 系统（macOS、Linux 等）上。

相关网站：

- [官网](https://rbenv.org/)
- [GitHub](https://github.com/rbenv/rbenv)

## 安装（Debian）

### 第一步：先装编译依赖

`rbenv` 是从源码编译 Ruby 的，依赖缺了会在编译时报错：

```bash
sudo apt update
sudo apt install -y git curl build-essential autoconf bison patch rustc \
  libssl-dev libyaml-dev libreadline-dev zlib1g-dev libncurses5-dev \
  libffi-dev libgdbm-dev libgdbm-compat-dev libdb-dev uuid-dev
```

>[!tip]
> 较老的 Debian/Ubuntu 里 `libncurses5-dev` 如果找不到，换成 `libncurses-dev`。

### 第二步：安装 rbenv 和 ruby-build

用 git 安装（避免仓库老找不到）：

```bash
git clone https://github.com/rbenv/rbenv.git ~/.rbenv
git clone https://github.com/rbenv/ruby-build.git ~/.rbenv/plugins/ruby-build
```

### 第三步：配置 shell

假设你当前使用的 Shell 是 Bash：

```bash
echo 'export PATH="$HOME/.rbenv/bin:$PATH"' >> ~/.bashrc
echo 'eval "$(rbenv init - bash)"' >> ~/.bashrc
source ~/.bashrc
```

验证安装是否成功：

```bash
rbenv -v
```

## 安装并切换 Ruby 版本

### 查看所有可安装版本

```bash
rbenv install --list-all
```

### 安装对应版本

```bash
rbenv install 3.3.5
```

### 查看已安装版本

```bash
rbenv versions
```

### 选择版本

#### 全局默认

```bash
rbenv global 3.3.5
```

#### 当前目录

```bash
rbenv local 3.2.4
```

#### 当前终端

```bash
rbenv shell 3.1.6
```