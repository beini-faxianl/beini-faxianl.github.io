---
title: Java 中的常见概念
date: 2026-10-29
updated: 2026-10-29
tags:
  - Java
  - 概念
description: Java 中的常见概念
---
# Claude Opus 5.5（High）

## 一、Java 代码是怎么跑起来的

```
Hello.java  --javac 编译-->  Hello.class（字节码）  --java 命令-->  JVM 执行
```

- **源代码（.java）**：你写的代码。
- **javac**：编译器。它不会把代码编译成 Windows 或 Mac 能直接运行的机器码，而是编译成一种中间格式。
- **字节码（.class）**：就是这种中间格式，是写给"虚拟的机器"看的指令。
- **JVM（Java 虚拟机）**：读取字节码并执行。Windows、Mac、Linux 各有一份自己的 JVM，同一份 .class 文件放到哪里都能跑。这就是 Java 常说的"一次编写，到处运行"。
- **JIT（即时编译器）**：JVM 内部的组件。它会把频繁执行的"热点"代码当场编译成本机机器码，所以 Java 虽然经过一层虚拟机，速度并不慢。
- **GC（垃圾回收）**：也是 JVM 的工作，自动回收不再使用的对象。所以 Java 不需要像 C 那样手动 free 内存。

## 二、你装到电脑上的东西

- **JVM**：只负责执行字节码，单独存在没有意义。
- **JRE**：JVM 加上核心类库（String、ArrayList 这些现成的类），是运行 Java 程序所需的最小集合。
- **JDK**：JRE 再加上开发工具（javac 编译器、jar 打包工具、调试器等），写 Java 的人装的就是它。

有一点要注意：从 Java 11 起，官方不再单独提供 JRE 下载，现在直接装 JDK 就行。很多教程还在讲"JRE 和 JDK 选哪个"，那是老黄历了。

几个装完 JDK 后会碰到的东西：

- **JAVA_HOME**：一个环境变量，指向 JDK 的安装目录，Maven、IDE 等工具靠它找到 JDK。
- **classpath**：告诉 JVM 去哪里找 .class 文件和依赖库。
- **JAR**：把一堆 .class 文件打包成一个文件，本质上是个 zip。

## 三、"Java"这个名字本身

- **Java SE**：标准版，也就是平时说的"Java"，包括语言本身、核心类库和 JVM。JDK 实现的就是它。
- **Java EE → Jakarta EE**：企业版，是一套写服务器端程序的规范（Servlet、JPA 等）。后来 Oracle 把它交给了 Eclipse 基金会，改名 Jakarta EE。Spring 是另一套独立的生态，但会用到其中不少规范。
- **Java ME**：嵌入式和老式手机用的版本，现在基本见不到了。
- **OpenJDK 和 Oracle JDK**：OpenJDK 是开源的官方实现，Oracle JDK、Eclipse Temurin、Amazon Corretto、阿里 Dragonwell 等发行版大多基于它构建，用起来几乎没区别，主要差在授权条款和技术支持上。个人学习推荐 Temurin。
- **版本号和 LTS**：Java 每半年发一个新版本，其中部分是长期支持版（LTS）：8、11、17、21、25。学习和生产环境都建议用 LTS，新项目选 21 或 25 都可以。
- **Maven / Gradle**：构建工具，负责下载依赖、编译、打包。不属于 Java 本身，但几乎每个项目都会用到其中一个。

一句话串起来：你装的是 **JDK**，用里面的 **javac** 把 .java 编译成**字节码**，再由 **JVM** 执行；"Java SE"是这一整套东西的规范名称，**OpenJDK** 是它的实现。

最后留个小问题帮你检验一下：假设你写好了一个程序，想发给一个从来没碰过 Java 的朋友运行，他的电脑上最少需要装什么？为什么只发 .class 文件，他在 Mac 上和你在 Windows 上都能跑？