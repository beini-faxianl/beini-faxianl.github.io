---
title: GraphQL API 漏洞
date: 2026-10-21
updated: 2026-10-21
tags:
  - GraphQL
description: 一句话摘要
---
>[!tip]
> 如果你还不了解什么是 GraphQL，先看[[什么是 GraphQL？|这篇文章]]。

## 发现 GraphQL 端点

### Universal queries（通用查询）

如果你向任何 GraphQL 端点发送：

```graphql
query { __typename }
```

其响应的某处会包含下述字符串：

```json
{ "data": { "__typename": "Query" } }
```

>[!note]
> 返回值是根查询类型的名字。大多数服务里是 `Query`，但有些框架会用别的名字，比如 Hasura 返回的是 `query_root`。

该查询被称为“通用查询”。之所以“通用”，是因为 `__typename` 是 GraphQL 规范内置的元字段（meta-field），所有对象类型都自动带有它，根查询类型也不例外。所以无论一个 GraphQL 服务的 schema 定义了哪些业务字段，这条查询都一定合法，也一定能执行成功。

### 常见端点探测

GraphQL 服务经常使用相似的端点后缀：

- `/graphql`
- `/api`
- `/api/graphql`
- `/graphql/api`
- `/graphql/graphql`

>[!tip]
> 这些端点的后缀也可能包含版本号，例如 `/graphql/v1` 。

对这些端点发送“[[#通用查询]]”或者直接访问来判断其是否是 GraphQL 端点。

之所以“直接访问”也能探测，是因为 GraphQL 服务通常会对任何非 GraphQL 请求返回“query not present”或类似的错误。

### 请求方法切换

生产环境中的 GraphQL 端点的最佳实践是只接受 `content-type` 为 `application/json` 的 POST 请求（用于防范 CSRF 漏洞）。

然而有些端点可能接收其他的 HTTP 方法，例如 GET 请求，或者 `content-type` 为 `x-www-form-urlencoded` 的 POST 请求。

因此，如果向常见端点发送 POST 请求未能找到 GraphQL 端点，可以尝试使用其他 HTTP 方法重新发送通用查询或者尝试切换 `content-type` 的值。

## 测试查询参数

如果端点使用参数直接访问对象，则可能存在 IDOR（不安全的直接对象引用）。用户可能只需提供一个与某信息对应的参数，就能访问本不应访问的信息。

例如，下面的查询会请求某网店的商品列表：

```graphql
#商品查询示例
query {
    products {
        id
        name
        listed
    }
}
```

返回的商品列表中只包含已上架的商品：

```json
#商品响应示例
{
    "data": {
        "products": [
            {
                "id": 1,
                "name": "Product 1",
                "listed": true
            },
            {
                "id": 2,
                "name": "Product 2",
                "listed": true
            },
            {
                "id": 4,
                "name": "Product 4",
                "listed": true
            }
        ]
    }
}
```

从这些信息中，我们可以推断出：

- 商品按顺序编号分配 ID
- 列表中缺少 ID 为 3 的商品，可能是因为它已被下架

通过指定 ID 查询缺失的商品：

```graphql
#获取缺失商品的查询
query {
    product(id: 3) {
        id
        name
        listed
    }
}
```

```json
#缺失商品的响应
{
    "data": {
        "product": {
        "id": 3,
        "name": "Product 3",
        "listed": no
        }
    }
}
```

## 发现 Schema 信息

使用 Burp Suite 能很方便地构造内省，详见[[Burp Suite 中处理 GraphQL|这篇文章]]。

Burp Suite 构造的是完整的内省查询，长这样（Set introspection query）：

```graphql hl:3,6,9,12,15
query IntrospectionQuery {
    __schema {
        queryType {
            name
        }
        mutationType {
            name
        }
        subscriptionType {
            name
        }
        types {
            ...FullType
        }
        directives {
            name
            description
            locations
            args {
                ...InputValue
            }
        }
    }
}

fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
        name
        description
        args {
            ...InputValue
        }
        type {
            ...TypeRef
        }
        isDeprecated
        deprecationReason
    }
    inputFields {
        ...InputValue
    }
    interfaces {
        ...TypeRef
    }
    enumValues(includeDeprecated: true) {
        name
        description
        isDeprecated
        deprecationReason
    }
    possibleTypes {
        ...TypeRef
    }
}

fragment InputValue on __InputValue {
    name
    description
    type {
        ...TypeRef
    }
    defaultValue
}

fragment TypeRef on __Type {
    kind
    name
    ofType {
        kind
        name
        ofType {
            kind
            name
            ofType {
                kind
                name
            }
        }
    }
}
```

> 待续……

# AI


## 建议（Suggestions）

即使内省被完全禁用，你有时也可以利用"建议"来获取 API 结构的相关信息。

建议是 Apollo GraphQL 平台的一项功能，服务器可以在错误消息中建议如何修正查询。它通常用于查询略有错误但仍可识别的情况（例如："There is no entry for 'productInfo'. Did you mean 'productInformation' instead?"）。

你可以从中获取有用信息，因为这样的响应实际上泄露了 schema 的有效部分。

Clairvoyance 是一款利用建议来自动恢复全部或部分 GraphQL schema 的工具，即使内省已被禁用也同样有效。这大大减少了从建议响应中拼凑信息所需的时间。

在 Apollo Server v4 及更高版本中，你可以使用 `hideSchemaDetailsFromClientErrors` 选项禁用建议。对于更早的版本，请参阅这个 GitHub 讨论帖中的变通方法。



## 绕过 GraphQL 的内省防御

如果你无法让内省查询在被测试的 API 上运行，可以尝试在 `__schema` 关键字之后插入一个特殊字符。

开发者在禁用内省时，可能会使用正则表达式来排除查询中的 `__schema` 关键字。你应该尝试空格、换行符和逗号等字符，因为 GraphQL 会忽略它们，而有缺陷的正则表达式则不会。

因此，如果开发者只排除了 `__schema{`，那么下面这个内省查询就不会被排除。

```json
#带换行符的内省查询
{
    "query": "query{__schema
    {queryType{name}}}"
}
```

如果这样不起作用，可以尝试通过其他请求方法运行探测，因为内省可能仅在 POST 方式下被禁用。可以尝试 GET 请求，或 content-type 为 `x-www-form-urlencoded` 的 POST 请求。

下面的示例展示了通过 GET 发送、参数经过 URL 编码的内省探测。

```
# 以 GET 请求发送的内省探测
GET /graphql?query=query%7B__schema%0A%7BqueryType%7Bname%7D%7D%7D
```

> **注意**
>
> 你可以将 GraphQL 查询保存到站点地图（site map）中。更多信息请参阅"使用 GraphQL"。

**实验：**

- **实验 · 进阶级（PRACTITIONER）**：寻找隐藏的 GraphQL 端点

## 使用别名绕过速率限制

通常情况下，GraphQL 对象不能包含多个同名属性。别名（aliases）通过显式命名你希望 API 返回的属性，使你能够绕过这一限制。你可以使用别名在一次请求中返回同一类型对象的多个实例。

**更多信息**

有关 GraphQL 别名的更多信息，请参阅 [别名](https://portswigger.net/web-security/graphql/what-is-graphql#aliases)。

虽然别名的本意是减少你需要发起的 API 调用次数，但它们也可以被用来对 GraphQL 端点进行暴力破解。

许多端点都设有某种速率限制器，以防止暴力破解攻击。有些速率限制器是根据收到的 HTTP 请求数量来工作的，而不是根据端点上执行的操作数量。由于别名实际上使你能够在单个 HTTP 消息中发送多个查询，因此可以绕过这一限制。

下面这个简化的示例展示了一系列带别名的查询，用于检查商店折扣码是否有效。由于这是单个 HTTP 请求，该操作有可能绕过速率限制，而它却可能被用来一次性检查大量折扣码。

```graphql
#带别名查询的请求
query isValidDiscount($code: Int) {
    isValidDiscount(code:$code){
        valid
    }
    isValidDiscount2:isValidDiscount(code:$code){
        valid
    }
    isValidDiscount3:isValidDiscount(code:$code){
        valid
    }
}
```

**实验：**

- **实验 · 进阶级（PRACTITIONER）**：绕过 GraphQL 暴力破解防护

## GraphQL CSRF

跨站请求伪造（CSRF）漏洞使攻击者能够诱使用户执行并非其本意的操作。攻击者通过创建一个恶意网站，伪造发往存在漏洞的应用程序的跨域请求来实现这一点。

**更多信息**

有关 CSRF 漏洞的一般性信息，请参阅 [CSRF 学习主题](https://portswigger.net/web-security/csrf)。

GraphQL 可以成为 CSRF 攻击的载体：攻击者创建一个利用代码，使受害者的浏览器以受害用户的身份发送恶意查询。

### GraphQL 上的 CSRF 漏洞是如何产生的？

当 GraphQL 端点不验证所收到请求的内容类型，且未实施 CSRF 令牌时，就可能出现 CSRF 漏洞。

只要对内容类型进行了验证，使用 `application/json` 内容类型的 POST 请求就能防止伪造。在这种情况下，即使受害者访问了恶意网站，攻击者也无法让受害者的浏览器发送此类请求。

然而，GET 等替代方法，或任何内容类型为 `x-www-form-urlencoded` 的请求，都可以由浏览器发送，因此如果端点接受这些请求，用户就可能面临攻击风险。在这种情况下，攻击者可能构造利用代码，向 API 发送恶意请求。

对于基于 GraphQL 的 CSRF 漏洞，构造 CSRF 攻击和投递利用代码的步骤与"常规"CSRF 漏洞相同。有关此过程的更多信息，请参阅 [如何构造 CSRF 攻击](https://portswigger.net/web-security/csrf#how-to-construct-a-csrf-attack)。

**实验：**

- **实验 · 进阶级（PRACTITIONER）**：通过 GraphQL 实施 CSRF 利用

## 防范 GraphQL 攻击

为防范许多常见的 GraphQL 攻击，在将 API 部署到生产环境时请采取以下措施：

- 如果你的 API 不是面向公众使用的，请禁用其内省功能。这会让攻击者更难获取 API 工作方式的信息，并降低不必要的信息泄露风险。
  - 有关如何在 Apollo GraphQL 平台中禁用内省，请参阅这篇[博客文章](https://www.apollographql.com/blog/graphql/security/why-you-should-disable-graphql-introspection-in-production/)。

- 如果你的 API 面向公众使用，则很可能需要保持内省开启。不过，你应该审查 API 的 schema，确保它没有向公众暴露非预期的字段。

- 确保已禁用建议功能。这可以防止攻击者使用 Clairvoyance 或类似工具获取底层 schema 的信息。
  - 在 Apollo Server v4 及更高版本中，你可以使用 `hideSchemaDetailsFromClientErrors` 选项禁用建议。对于更早的版本，请参阅这个 GitHub 讨论帖中的变通方法。

- 确保 API 的 schema 不会暴露任何私有的用户字段，例如电子邮件地址或用户 ID。

### 防范 GraphQL 暴力破解攻击

在使用 GraphQL API 时，有时可以绕过标准的速率限制。相关示例请参阅[使用别名绕过速率限制](#bypassing-rate-limiting-using-aliases)一节。

有鉴于此，你可以采取一些设计层面的措施来保护 API 免受暴力破解攻击。这通常涉及限制 API 所接受查询的复杂度，并减少攻击者实施拒绝服务（DoS）攻击的机会。

要防御暴力破解攻击：

- 限制 API 查询的查询深度。"查询深度"指查询中嵌套的层级数。嵌套过深的查询可能对性能造成显著影响，如果被接受，还可能为 DoS 攻击提供机会。通过限制 API 接受的查询深度，你可以降低这种情况发生的可能性。

- 配置操作限制。操作限制使你能够配置 API 可接受的唯一字段、别名和根字段的最大数量。

- 配置查询可包含的最大字节数。

- 考虑为 API 实施成本分析。成本分析是指由某个库应用程序在收到查询时，识别运行这些查询所需的资源成本。如果某个查询的计算复杂度过高而无法运行，API 就会丢弃它。

**更多信息**

有关如何在 Apollo 中实现这些功能，请参阅这篇[博客文章](https://www.apollographql.com/blog/graphql/security/securing-your-graphql-api-from-malicious-queries/)。

### 防范 GraphQL 上的 CSRF

要专门防御 GraphQL CSRF 漏洞，请在设计 API 时确保以下几点：

- 你的 API 仅接受通过 JSON 编码的 POST 方式发送的查询。

- API 会验证所提供的内容与所声明的内容类型是否一致。

- API 具备安全的 CSRF 令牌机制。