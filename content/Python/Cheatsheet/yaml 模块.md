---
title: yaml 模块
date: 2026-10-24
updated: 2026-10-24
tags:
  - Python
  - YAML
description: 一句话摘要
---
## YAML 文件反序列化成字典

```python
import yaml

with open('/home/zyf/.config/subfinder/provider-config.yaml', 'r') as file:
    results = yaml.load(file, Loader=yaml.FullLoader)
    print(results)
```

输出：

```
{'alienvault': [], 'bevigil': [], 'bufferover': [], 'builtwith': [], 'c99': [], 'censys': [], 'certspotter': [], 'chaos': ['xxxxx'], 'chinaz': [], 'crtname': [], 'digitalyama': [], 'dnsdb': [], 'dnsdumpster': [], 'dnsrepo': [], 'domainsproject': [], 'driftnet': [], 'fofa': [], 'fullhunt': [], 'github': ['xxxxx'], 'hackertarget': [], 'intelx': [], 'leakix': [], 'merklemap': [], 'netlas': [], 'onyphe': [], 'profundis': [], 'pugrecon': [], 'quake': [], 'reconeer': [], 'redhuntlabs': [], 'robtex': [], 'rsecloud': [], 'securitytrails': [], 'shodan': [], 'subdomaincenter': [], 'submd': [], 'threatbook': [], 'urlscan': [], 'virustotal': ['xxxxx'], 'whoisxmlapi': [], 'windvane': [], 'zoomeyeapi': []}
```