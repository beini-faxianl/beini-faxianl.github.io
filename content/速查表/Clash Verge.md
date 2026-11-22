---
title: Clash Verge
date: 2026-10-01
updated: 2026-10-05
tags:
  - VPS
  - Clash
  - Proxy
description: Clash Verge
---
## SOCKS5

准备一个 VPS，并与其建立 SOCKS5：

```bash
ssh -D 1080 -N username@<IP_ADDR>
```

建立完成之后，此时流量如果走 `127.0.0.1:1080`，则会被 VPS 转发。

打开 Clash Verge，新建一个订阅：

![[Pasted image 20261122020627.png|600]]

选择本地，然后随便取个名字：

![[Pasted image 20261122020759.png|400]]

右键新建的订阅，并选择“编辑文件”：

![[Pasted image 20261122020856.png|400]]

此时你会看到下述模板：

```yaml
# Profile Template for Clash Verge

proxies: []

proxy-groups: []

rules: []
```

按照下述模板填写即可：

```yaml
proxies:
  - name: "SSH-Tunnel"
    type: socks5
    server: 127.0.0.1
    port: 1080
    udp: false # ssh -D 仅支持 TCP，不支持 UDP，必须设为 false

proxy-groups:
  - name: "PROXY"
    type: select
    proxies:
      - "SSH-Tunnel"
      - "DIRECT"

rules:
  # 防止流量回环：将你的 SSH 服务器 IP 强制直连
  # 如果你用域名连接 SSH，请改为 DOMAIN,你的域名,DIRECT
  - IP-CIDR,你的服务器IP/32,DIRECT,no-resolve

  # 局域网与本地地址直连
  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve

  # 国内 IP 直连，如果需要全局走 SSH 代理可删掉下面这行
  - GEOIP,CN,DIRECT

  # 其余所有流量走 SSH 代理
  - MATCH,PROXY
```

`proxies` 用于配置代理信息（支持创建多个代理）。`proxy-groups` 用于将代理都放在一个组内，开启规则代理的时候，可以根据 `rules` 中的规则去走相对应的代理。

如果想自己配置或者想了解具体细节的，可以去看[官方文档](https://wiki.metacubex.one/config/)。