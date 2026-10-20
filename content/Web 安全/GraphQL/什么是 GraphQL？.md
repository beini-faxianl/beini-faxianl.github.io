---
title: 什么是 GraphQL？
date: 2026-10-20
updated: 2026-10-20
tags:
  - GraphQL
description: 一句话摘要
---
## 什么是 GraphQL？

GraphQL 是一种 API 查询语言，它允许用户精确指定希望在响应中看到的内容，从而避免 REST API 的两大缺点，即过度获取（拿到一堆不需要的字段）和获取不足（一次拿不全，要来回多次请求）。

REST API 中，每个接口返回的数据结构**由服务器固定**。比如访问一个“用户主页”，你可能需要发起下述请求：

```
GET /users/42          → 返回用户的全部字段（很多用不上）
GET /users/42/posts    → 再请求一次拿文章列表
GET /posts/7/comments  → 每篇文章还要再请求评论……
```

而 GraphQL，只需访问一个端点（通常是 `POST /graphql`）：

```graphql
query {
  user(id: 42) {
    name
    posts(last: 3) {
      title
      comments { author }
    }
  }
}
```

返回的 JSON 结构与查询完全对应，不多也不少：

```json
{
  "data": {
    "user": {
      "name": "小明",
      "posts": [
        { "title": "第一篇", "comments": [{ "author": "小红" }] }
      ]
    }
  }
}
```

## 核心概念

### Schema（模式）

Schema 代表服务前端与后端之间的契约，它用一套专门的语法（SDL，Schema Definition Language）把 API 能提供的所有数据和操作都用一个个的类型（Type）完整地描述出来。客户端能查什么、怎么查、会拿到什么类型，全由它决定。

例子：

```graphql hlt:Product,ID!,String!,Int
type Product {
    id: ID!
    name: String!
    description: String!
    price: Int
}
```

>[!note]
> 其中，`!` 表示该字段在调用时不可为空。

高亮部分都是“类型”。类型可以使用内置的，也可以使用自定义的。

### Query（查询）

Query 用于从数据存储中检索数据，通常包含以下关键组成部分：

| 组成部分 | 描述                              |
| ---- | ------------------------------- |
| 操作类型 | 可选，但建议使用，因为它能明确告诉服务器传入的请求是一个查询。 |
| 名称   | 可以任意命名。可选，但建议使用，因为它有助于调试。       |
| 数据结构 | 查询应返回的数据。                       |

示例：

```graphql
query myGetProductQuery {
    getProduct(id: 123) {
        name
        description
    }
}
```

其中：

- `query` 是操作类型
- `myGetProductQuery` 是名称
- 主体部分（被 `query myGetProductQuery{}` 包裹的部分）就是数据结构

关于这些组成的构造，都需要参照服务器上对应的 Schema。

### Mutation（变更）

Mutation 会以某种方式改变数据（包括添加、删除或编辑数据），与查询一样，通常有下述组成部分：

- 操作类型
- 名称
- 数据结构

例子：

```graphql
mutation {
    createProduct(name: "Flamin' Cocktail Glasses", listed: "yes") {
        id
        name
        listed
    }
}
```

```json
{
    "data": {
        "createProduct": {
            "id": 123,
            "name": "Flamin' Cocktail Glasses",
            "listed": "yes"
        }
    }
}
```

### Subscription（订阅）

Subscription 是一种特殊的查询。它让客户端能够与服务器建立长连接，使服务器可以向客户端推送实时更新，而客户端无需不断轮询数据。

>[!info]
> 订阅通常用 WebSocket 实现。

订阅主要适用于对大型对象进行的小幅更改，以及需要小规模实时更新的功能（如聊天系统或协同编辑）。

### Introspection（内省）

Introspection 是 GraphQL 的一项内置功能，允许你向服务器查询有关模式的信息。GraphQL IDE 和文档生成工具等应用程序经常使用它。

GraphQL 内置了一些以双下划线 `__` 开头的特殊字段，专门用来查询模式。比如想知道 Product 有哪些字段：

```graphql
query {
  __type(name: "Product") {
    fields {
      name
    }
  }
}
```

```json
{
  "data": {
    "__type": {
      "fields": [
        { "name": "id" },
        { "name": "name" },
        { "name": "description" },
        { "name": "price" }
      ]
    }
  }
}
```

内省可能带来严重的信息泄露风险，因为它可用于获取潜在的敏感信息（例如字段描述），并帮助攻击者了解如何与 API 交互。最佳实践是在生产环境中禁用内省。

## 查询与变更的组成部分

GraphQL 语法中包含若干查询和变更共用的组成部分。

### Fields（字段）

所有 GraphQL 类型都包含可查询的数据项，称为字段。发送查询或变更时，你需要指定希望 API 返回哪些字段。响应内容与请求中指定的内容一一对应。

下面的示例展示了一个获取所有员工 ID 和姓名信息的查询及其响应。在本例中，请求的字段是 `id`、`name.firstname` 和 `name.lastname`。

```graphql hlt:id,firstname,lastname
query myGetEmployeeQuery {
    getEmployees {
        id
        name {
            firstname
            lastname
        }
    }
}
```

```json
{
    "data": {
        "getEmployees": [
            {
                "id": 1,
                "name": {
                    "firstname": "Carlos",
                    "lastname": "Montoya"
                }
            },
            {
                "id": 2,
                "name": {
                    "firstname": "Peter",
                    "lastname": "Wiener"
                }
            }
        ]
    }
}
```

### Arguments（参数）

参数是为特定字段提供的值。某个类型可接受哪些参数由模式定义。

当你发送包含参数的查询或变更时，GraphQL 服务器会根据其配置决定如何响应。例如，它可能只返回某个特定对象，而不是所有对象的详细信息。

下面的示例展示了一个以员工 ID 作为参数的 `getEmployee` 请求。在本例中，服务器只返回与该 ID 匹配的员工的详细信息。

```graphql hlt:"id:1"
query myGetEmployeeQuery {
    getEmployees(id: 1) {
        name {
            firstname
            lastname
        }
    }
}
```

```json
{
    "data": {
        "getEmployees": [
            {
                "name": {
                    "firstname": "Carlos",
                    "lastname": "Montoya"
                }
            }
        ]
    }
}
```

### Variables（变量）

变量让你能够传入动态参数，而不必把参数直接写在查询本身中。

参数的取值来自一个单独的、基于 JSON 的**变量字典**。这样就可以在多个查询之间复用同一个通用结构，只需改变变量本身的值。

构建使用变量的查询或变更时，你需要：

- 声明变量及其类型
- 在查询的适当位置加入变量名
- 从变量字典中传入变量的键和值

下面的示例展示了与上一个示例相同的查询，只是 ID 以变量形式传入，而不是直接写在查询字符串中：

```graphql
query getEmployeeWithVariable($id: ID!) {
    getEmployees(id: $id) {
        name {
            firstname
            lastname
        }
    }
}
```

变量：

```json
{
    "id": 1
}
```

变量在第一行通过 `$id: ID!` 声明，随后在第二行通过 `id: $id` 将其作为参数使用，最后，变量的值在变量 JSON 字典中设置。

### Aliases（别名）

GraphQL 对象不能包含多个**同名属性**。

例如，下面的查询是无效的，因为它试图两次返回 `product` 类型。

```graphql hl:3,7
# 无效查询
query getProductDetails {
    getProduct(id: 1) {
        id
        name
    }
    getProduct(id: 2) {
        id
        name
    }
}
```

别名允许你通过显式命名希望 API 返回的属性来绕过这一限制。你可以使用别名在一次请求中返回同一类型对象的多个实例，从而减少所需的 API 调用次数。

在下面的示例中，查询使用别名为两个产品分别指定了唯一的名称：

```graphql hl:3,7
# 使用别名的有效查询
query getProductDetails {
    product1: getProduct(id: "1") {
        id
        name
    }
    product2: getProduct(id: "2") {
        id
        name
    }
}
```

```json
{
    "data": {
        "product1": {
            "id": 1,
            "name": "Juice Extractor"
        },
        "product2": {
            "id": 2,
            "name": "Fruit Overlays"
        }
    }
}
```

### Fragments（片段）

片段是查询或变更中**可复用的部分**，包含所关联类型的部分字段。

片段定义后，可以被包含在查询或变更中。如果之后修改了片段，所有调用该片段的查询或变更都会随之变化。

下面的示例展示了一个 `getProduct` 查询，其中产品的详细信息包含在 `productInfo` 片段中：

```graphql
fragment productInfo on Product {
    id
    name
    listed
}
```

```graphql
query {
    getProduct(id: 1) {
        ...productInfo
        stock
    }
}
```

```json
{
    "data": {
        "getProduct": {
            "id": 1,
            "name": "Juice Extractor",
            "listed": "no",
            "stock": 5
        }
    }
}
```