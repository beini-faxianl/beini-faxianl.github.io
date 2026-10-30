---
title: JetBrains IDE 常用快捷键
date: 2026-10-26
updated: 2026-10-26
tags:
  - JetBrians
  - IDE
  - 快捷键
description: JetBrains IDE 常用快捷键
---
# JetBrains IDE 常用快捷键

JetBrains 家的 IDE（IntelliJ IDEA、PyCharm、WebStorm、GoLand、CLion 等）快捷键基本通用。下面是默认键位，左边是 Windows/Linux，右边是 macOS。

## 先记住这三个

| 功能 | Windows / Linux | macOS |
|---|---|---|
| 随处搜索（类、文件、设置、操作都能搜） | 连按两下 `Shift` | 连按两下 `Shift` |
| 查找操作（忘了快捷键就用它搜功能名） | `Ctrl + Shift + A` | `Cmd + Shift + A` |
| 显示意图操作 / 快速修复（报错、警告时万能键） | `Alt + Enter` | `Option + Enter` |

## 导航与查找

| 功能 | Windows / Linux | macOS |
|---|---|---|
| 查找类 | `Ctrl + N` | `Cmd + O` |
| 查找文件 | `Ctrl + Shift + N` | `Cmd + Shift + O` |
| 查找符号（方法、字段） | `Ctrl + Alt + Shift + N` | `Cmd + Option + O` |
| 最近打开的文件 | `Ctrl + E` | `Cmd + E` |
| 跳转到声明 | `Ctrl + B` 或 `Ctrl + 点击` | `Cmd + B` 或 `Cmd + 点击` |
| 跳转到实现 / 子类 | `Ctrl + Alt + B` | `Cmd + Option + B` |
| 跳转到父类方法 | `Ctrl + U` | `Cmd + U` |
| 类型层次结构 | `Ctrl + H` | `Ctrl + H` |
| 调用层次结构 | `Ctrl + Alt + H` | `Ctrl + Option + H` |
| 当前文件结构（方法列表） | `Ctrl + F12` | `Cmd + F12` |
| 查找用法 | `Alt + F7` | `Option + F7` |
| 后退 / 前进（跳转位置） | `Ctrl + Alt + ←/→` | `Cmd + [` / `Cmd + ]` |
| 跳到指定行 | `Ctrl + G` | `Cmd + L` |
| 当前文件内查找 / 替换 | `Ctrl + F` / `Ctrl + R` | `Cmd + F` / `Cmd + R` |
| 全局查找 / 替换 | `Ctrl + Shift + F` / `Ctrl + Shift + R` | `Cmd + Shift + F` / `Cmd + Shift + R` |
| 查看文档 | `Ctrl + Q` | `F1` |
| 查看方法参数提示 | `Ctrl + P` | `Cmd + P` |
| 在项目视图中定位当前文件 | `Alt + F1` | `Option + F1` |

## 编辑

| 功能 | Windows / Linux | macOS |
|---|---|---|
| 代码补全 | `Ctrl + Space` | `Ctrl + Space` |
| 生成代码（构造方法、getter/setter、toString） | `Alt + Insert` | `Cmd + N` |
| 重写父类方法 / 实现接口方法 | `Ctrl + O` / `Ctrl + I` | `Ctrl + O` / `Ctrl + I` |
| 用 if / try-catch 等包围 | `Ctrl + Alt + T` | `Cmd + Option + T` |
| 行注释 / 块注释 | `Ctrl + /` / `Ctrl + Shift + /` | `Cmd + /` / `Cmd + Option + /` |
| 复制当前行 | `Ctrl + D` | `Cmd + D` |
| 删除当前行 | `Ctrl + Y` | `Cmd + Delete` |
| 上下移动行 | `Alt + Shift + ↑/↓` | `Option + Shift + ↑/↓` |
| 逐级扩大选区 | `Ctrl + W` | `Option + ↑` |
| 选中下一个相同内容（多光标） | `Alt + J` | `Ctrl + G` |
| 格式化代码 | `Ctrl + Alt + L` | `Cmd + Option + L` |
| 优化导入（删除无用 import） | `Ctrl + Alt + O` | `Ctrl + Option + O` |
| 插入代码模板 | `Ctrl + J` | `Cmd + J` |
| 剪贴板历史 | `Ctrl + Shift + V` | `Cmd + Shift + V` |

**代码模板**：直接输入缩写再按 `Tab`，比如 `psvm`（main 方法）、`sout`（`System.out.println`）、`fori`（for 循环）。

**后缀补全**：在表达式后面加点再输入，比如 `list.for` 生成 for-each 循环，`new User().var` 自动生成变量声明，`x.null` 生成判空。

## 重构

| 功能 | Windows / Linux | macOS |
|---|---|---|
| 重命名（会同步修改所有引用） | `Shift + F6` | `Shift + F6` |
| 重构菜单 | `Ctrl + Alt + Shift + T` | `Ctrl + T` |
| 提取变量 | `Ctrl + Alt + V` | `Cmd + Option + V` |
| 提取方法 | `Ctrl + Alt + M` | `Cmd + Option + M` |
| 提取字段 | `Ctrl + Alt + F` | `Cmd + Option + F` |
| 内联 | `Ctrl + Alt + N` | `Cmd + Option + N` |
| 修改方法签名 | `Ctrl + F6` | `Cmd + F6` |

## 运行与调试

| 功能 | Windows / Linux | macOS |
|---|---|---|
| 运行当前光标所在的程序 | `Ctrl + Shift + F10` | `Ctrl + Shift + R` |
| 运行 / 调试上次的配置 | `Shift + F10` / `Shift + F9` | `Ctrl + R` / `Ctrl + D` |
| 构建项目 | `Ctrl + F9` | `Cmd + F9` |
| 切换断点 | `Ctrl + F8` | `Cmd + F8` |
| 单步跳过 | `F8` | `F8` |
| 单步进入 | `F7` | `F7` |
| 智能进入（一行有多个方法调用时选一个进入） | `Shift + F7` | `Shift + F7` |
| 跳出当前方法 | `Shift + F8` | `Shift + F8` |
| 继续运行到下一个断点 | `F9` | `Cmd + Option + R` |
| 运行到光标处 | `Alt + F9` | `Option + F9` |
| 计算表达式 | `Alt + F8` | `Option + F8` |
| 查看所有断点 | `Ctrl + Shift + F8` | `Cmd + Shift + F8` |

## 窗口与工具

| 功能 | Windows / Linux | macOS |
|---|---|---|
| 项目窗口 | `Alt + 1` | `Cmd + 1` |
| 终端 | `Alt + F12` | `Option + F12` |
| Git 提交 / 推送 | `Ctrl + K` / `Ctrl + Shift + K` | `Cmd + K` / `Cmd + Shift + K` |
| 设置 | `Ctrl + Alt + S` | `Cmd + ,` |
| 项目结构 | `Ctrl + Alt + Shift + S` | `Cmd + ;` |
| 隐藏所有工具窗口（专注编辑器） | `Ctrl + Shift + F12` | `Cmd + Shift + F12` |
| 从工具窗口回到编辑器 | `Esc` | `Esc` |
| 关闭当前标签页 | `Ctrl + F4` | `Cmd + W` |
| 切换标签页 / 工具窗口 | `Ctrl + Tab` | `Ctrl + Tab` |

## Windows 上常见的快捷键冲突

如果某个快捷键按了没反应，多半是被其他程序占用了：

- **`Ctrl + Space`**：可能被输入法用来切换中英文。可以在输入法设置里关掉，或在 IDEA 中改用 `Alt + /` 等其他键位。
- **`Ctrl + Shift + F`**：微软拼音默认用它切换简繁体，会导致全局搜索失效，需要在输入法设置里关掉。
- **`Ctrl + Alt + ←/→`**：部分 Intel 显卡驱动用它旋转屏幕，需要在显卡控制面板中禁用热键。

## 学习建议

- 不用一次记全，先熟练前面那三个，再加上 `Ctrl + B`、`Ctrl + Alt + B`、`Alt + F7`、`Shift + F6`、`Ctrl + Alt + L` 和调试的 `F7`/`F8`/`F9`，日常就够用了。
- 菜单里每个功能旁边都会显示它的快捷键，用鼠标点的时候顺便看一眼。
- 安装插件 **Key Promoter X**，它会在你用鼠标点了某个有快捷键的功能时提示对应的快捷键，用一段时间就自然记住了。
- 在 Settings → Keymap 里可以搜索、修改任何快捷键，也可以切换成 Eclipse 或 VS Code 的键位方案。