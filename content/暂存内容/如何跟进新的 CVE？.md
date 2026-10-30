---
title: 如何跟进新的 CVE？
date: 2026-10-29
updated: 2026-10-29
tags:
  - CVE
description: 如何跟进新的 CVE？
---
>[!question]
> 如何跟进新的 CVE。

## Grok（Web 端-Expert）

**每天新增大量 CVE（通常几十到上百条），全看会淹没你，关键是建立“过滤+优先级”机制，只关注真正影响你环境或正在被利用的漏洞。**

以下是实用、分层的跟进方法（从最推荐到补充手段）：

### 1. 优先看“正在被利用”的漏洞（最重要）

- **CISA KEV（Known Exploited Vulnerabilities）**  
  官方确认已在野利用的漏洞目录，是补丁优先级的黄金标准。  
  网站：[https://www.cisa.gov/known-exploited-vulnerabilities-catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)  
  JSON 数据源可直接拉取用于自动化：`https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`  
  建议同时关注 CISA 的告警/公告（邮件订阅或官网动态）。

### 2. 官方权威数据库

| 来源 | 地址 | 特点 |
|------|------|------|
| **NVD** | [nvd.nist.gov](https://nvd.nist.gov/) | 美国官方，含 CVSS 评分、CPE 匹配，提供 JSON feeds 与 API（推荐用于自动化） |
| **CVE.org / MITRE** | [cve.org](https://www.cve.org/) 或 [cve.mitre.org](https://cve.mitre.org/) | CVE 编号的源头 |
| **CNNVD** | [cnnvd.org.cn](https://www.cnnvd.org.cn/) | 国内国家信息安全漏洞库 |
| **CNVD** | [cnvd.org.cn](https://www.cnvd.org.cn/) | 国内漏洞共享平台，有周报/月报和安全公告 |

NVD 的数据 feeds 页面（[nvd.nist.gov/vuln/data-feeds](https://nvd.nist.gov/vuln/data-feeds)）提供 Recent / Modified 等 JSON 文件，适合脚本监控。

### 3. 高效聚合工具与网站（强烈推荐）

这些工具帮你从“所有 CVE”缩小到“影响你的软件”：

- **cve.tools**：根据你登记的软件栈匹配漏洞，突出被利用的，并给出紧急程度。
- **cve.now**：免费聚合 CVE List、NVD、OSV、GitHub Advisories、CISA KEV、EPSS 等，支持 RSS/JSON/API，适合个人或自动化。
- **神龙漏洞库**（[cve.imfht.com](https://cve.imfht.com/)）：中文友好，聚合 NVD、CNNVD、CISA KEV、EPSS、公开 PoC，支持中文搜索。
- **OpenCVE**：开源漏洞管理平台，可自建，支持订阅厂商/产品并告警。
- 其他常用：VulDB、CVE Details、Exploit-DB（看公开利用代码）。

### 4. 订阅与自动化方式

- **RSS / 邮件**：用 Feedly、Inoreader 等订阅 NVD、厂商安全公告、安全新闻站（BleepingComputer、The Hacker News 等）。
- **API / 脚本**：NVD 2.0 API、cve.now、GitHub 上的 `CVEProject/cvelistV5` 仓库（官方 CVE 列表镜像，更新快）。
- **终端/轻量工具**：如 Spydr（`curl` 即可查询被利用漏洞）。
- **企业级**：OpenCVE、SecAlerts、自建匹配资产清单 + Slack/邮件/Jira 告警。

### 5. 社交媒体与社区（实时补充）

- **X（Twitter）**：关注 `@CVEnew`（新 CVE 发布）、`@CISACyber`、`@GossiTheDog`（Kevin Beaumont，分析快且准）、安全厂商账号等。
- **国内社区**：FreeBuf、安全客、先知社区、Seebug。
- 搜索关键词：`CVE` + 你关心的产品名，或直接看讨论热度。

### 实用优先级建议

1. **先列资产清单**：你实际使用的操作系统、中间件、开源组件、云服务、厂商产品。
2. **过滤规则**：  
   - 在 CISA KEV 里的 → 立即处理  
   - 高 CVSS（≥9）+ 高 EPSS（利用概率高）+ 有公开 PoC → 优先  
   - 只影响你环境的 → 再深入看
3. **厂商安全页面**：微软 MSRC、Adobe、Cisco、VMware、Apache 等各自的公告往往比 NVD 更快。
4. **开源组件**：关注 GitHub Security Advisories 和 OSV。

### 起步推荐组合（个人/小团队）

1. 每天扫一眼 **CISA KEV** 新增 + **神龙漏洞库** 或 **cve.tools**。  
2. 订阅 NVD Recent feed 或 cve.now 的 critical/kev 过滤 feed。  
3. 在 X 上关注几个核心账号。  
4. 有能力再自建匹配脚本（资产列表 vs 新 CVE）。

这样既能跟上最新动态，又不会被海量数据淹没。如果你有具体技术栈（例如 Java、Windows、Kubernetes、某个厂商产品），我可以帮你推荐更精准的监控源和过滤方式。