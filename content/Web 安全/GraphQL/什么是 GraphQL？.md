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

### Type（类型）& Schema（模式）

客户端以什么样的请求格式访问 GraphQL 端点，GraphQL 端点会对应地给出什么信息，这些都有 Schema 决定。

而 Schema 是由一个个的 Type 组成的。

类型共有六种：

- 对象类型
- 标量类型
- 枚举类型
- 接口类型
- 联合类型
- 输入对象类型

>[!note]
> 我并不会全部介绍，具体参见[官方文档](https://graphql.org/learn/schema)。

#### 对象类型（Object types）

```hlt:Product
type Product {
    id: ID!
    name: String!
    description: String!
    price: Int
}
```

这里的 `Product` 就是对象类型，它由一个个的**字段**（`id`、`name`……）组成，每个字段都可以定义自己的类型（`:` 后就是对应的类型）。

每个字段都可以有 0 个或者多个参数，比如：

```
type Starship {
  id: ID!
  name: String!
  length(unit: LengthUnit = METER): Float
}
```

其中：

- `unit` 为 `length` 字段的参数
- `unit` 的默认值为 `METER`
- `LengthUnit` 是该参数的类型

#### 标量类型（Scalar types）

除“标量类型”外的其他类型都需要继续往下定义（比如对象类型、接口类型还要定义里面的字段、参数；联合类型还要定义联合成员……），标量类型就是最终的“叶子”。

下例中的 `ID`、`String`、`Int` 就是标量类型：

```
type Product {
    id: ID!
    name: String!
    description: String!
    price: Int
}
```

#### 类型修饰符

共有两个类型修饰符：

- `!`
- `[]`

在标量类型后面跟上 `!` 修饰符，即 `Type!`，意味着服务器始终需要为该标量类型修饰的字段返回一个非空值。

在标量类型外面套上 `[]` 修饰符，即 `[Type]`，意味着该标量类型修饰的字段是一个列表。

两个修饰符也可以组合使用：

```
myField: [String]!
```

### 操作类型

对象类型中有三个特殊情况：

- Query（查询）
- Mutation（变更）
- Subscription（订阅）

它们被称为操作类型。服务端上的定义和常规对象类型没什么区别，下面主要讲述客户端如何构造请求。

#### Query（查询）

请求结构：

```
query HeroNameAndFriends {
  hero {
    name
    friends {
      name
    }
  }
}
```

其中：

- `query` 是操作类型标记
- `HeroNameAndFriends` 是操作名称
- `hero` 是服务器端上定义的对象类型名
- `name`、`friends` 都是定义在 `hero` 中的字段
- 由于 `friends` 不是叶子类型（标量类型），则还需往里面取，一直到标量类型定义的字段为止

响应：

```json
{
  "data": {
    "hero": {
      "name": "R2-D2",
      "friends": [
        {
          "name": "Luke Skywalker"
        },
        {
          "name": "Han Solo"
        },
        {
          "name": "Leia Organa"
        }
      ]
    }
  }
}
```

上面展示的只是最基础的请求，请求中还可以有：

##### Arguments（参数）

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

##### Variables（变量）

让参数的取值来自一个单独的、格式因传输方式而异的（通常是 JSON）**变量字典**。这样就可以在多个查询之间复用同一个通用结构，对于值的变动只需修改变量字典。

注意，构建使用变量的查询或[[#Mutation（变更）|变更]]时，你需要：

- 声明变量及其类型
- 在查询的适当位置加入变量名
- 从变量字典中传入变量的键和值

例子：

```graphql
query HeroNameAndFriends($episode: Episode) {
  hero(episode: $episode) {
    name
    friends {
      name
    }
  }
}
```

其中：

- `$episode: Episode` 在声明变量及其类型
- `episode: $episode` 是使用变量给 `episode` 字段赋值

变量字典：

```json
{
  "episode": "JEDI"
}
```

响应：

```json
{
  "data": {
    "hero": {
      "name": "R2-D2",
      "friends": [
        {
          "name": "Luke Skywalker"
        },
        {
          "name": "Han Solo"
        },
        {
          "name": "Leia Organa"
        }
      ]
    }
  }
}
```

##### Aliases（别名）

对同一个字段的不同参数查询，你不能直接：

```
query {
  hero(episode: EMPIRE) {
    name
  }
  hero(episode: JEDI) {
    name
  }
}
```

因为服务器无法给出这样的响应：

```json
{
  "data": {
    "hero": {
      "name": "Luke Skywalker"
    },
    "hero": {
      "name": "R2-D2"
    }
  }
}
```

>[!note]
> 从 JSON 语法上，这其实可以使用（但不推荐），但在 GraphQL 中会因字段冲突而直接报错。

你需要为他们设置别名：

```
query {
  empireHero: hero(episode: EMPIRE) {
    name
  }
  jediHero: hero(episode: JEDI) {
    name
  }
}
```

结果：

```json
{
  "data": {
    "empireHero": {
      "name": "Luke Skywalker"
    },
    "jediHero": {
      "name": "R2-D2"
    }
  }
}
```

##### Fragments（片段）

片段是查询或[[#Mutation（变更）|变更]]中**可复用的部分**。片段定义后，如果后续修改了片段，所有调用该片段的查询或变更都会随之变化。

片段定义示例：

```graphql
fragment productInfo on Product {
    id
    name
    listed
}
```

片段的使用：

```graphql
query {
    getProduct(id: 1) {
        ...productInfo
        stock
    }
}
```

响应：

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

#### Mutation（变更）

Mutation 会以某种方式改变数据（包括添加、删除或编辑数据），具体可见[官方文档](https://graphql.org/learn/mutations/)。

请求结构：

```
mutation CreateReviewForEpisode($ep: Episode!, $review: ReviewInput!) {
  createReview(episode: $ep, review: $review) {
    stars
    commentary
  }
}
```

变量字典：

```json
{
  "ep": "JEDI",
  "review": {
    "stars": 5,
    "commentary": "This is a great movie!"
  }
}
```

响应：

```json
{
  "data": {
    "createReview": {
      "stars": 5,
      "commentary": "This is a great movie!"
    }
  }
}
```

#### Subscription（订阅）

Subscription 是一种特殊的查询。它让客户端能够与服务器建立长连接，使服务器可以向客户端推送实时更新，而客户端无需不断轮询数据。

构造请求的方式与查询、变更几乎无异，这里不再过多演示，具体可见[官方文档](https://graphql.org/learn/subscriptions/)。

>[!info]
> 订阅通常用 WebSocket 实现。

### Introspection（内省）

Introspection 是 GraphQL 的一项内置功能，允许你向服务器查询有关模式的信息（因此在生产环境中通常被禁用）。

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