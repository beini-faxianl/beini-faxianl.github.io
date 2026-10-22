---
title: GraphQL API 漏洞
date: 2026-10-21
updated: 2026-10-21
tags:
  - GraphQL
  - CSRF
  - 自省
  - Schema
  - Clairvoyance
description: GraphQL API 漏洞
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

如果是 GET 请求，则尝试构造下述查询：

```http
?query=query{__typename}
```

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

Burp Suite 构造的内省查询长这样（Set introspection query）：

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

## 通过 Schema 信息构造查询/变更/订阅

>[!tip]
> 一个完整的、针对自省请求的响应正文见[[#附录]]。

以 Burp Suite 构造的自省请求对应的响应为例。如果你想要构造查询，则需定位：

```json
"queryType": {
	"name": "query"
},
```

如果你想要构造变更，则需要定位：

```json
"mutationType": {
	"name": "mutation"
},
```

订阅则定位：

```json
"subscriptionType": {
	"name": "subscription"
},
```

以变更为例，你看到的 `name` 字段的值为 `mutation`，则继续定位：

```json hlt:mutation
{
	"kind": "OBJECT",
	"name": "mutation",
	……
}
```

此时你能看到 `mutation` 对象中支持的字段信息（`fields` 中定义的），比如：

```json
{
  "kind": "OBJECT",
  "name": "mutation",
  "description": null,
  "fields": [
	{
	  "name": "deleteOrganizationUser",
	  "description": null,
	  "args": [
		{
		  "name": "input",
		  "description": null,
		  "type": {
			"kind": "INPUT_OBJECT",
			"name": "DeleteOrganizationUserInput",
			"ofType": null
		  },
		  "defaultValue": null
		}
	  ],
	  "type": {
		"kind": "OBJECT",
		"name": "DeleteOrganizationUserResponse",
		"ofType": null
	  },
	  "isDeprecated": false,
	  "deprecationReason": null
	}
  ],
  "inputFields": null,
  "interfaces": [],
  "enumValues": null,
  "possibleTypes": null
},
```

这里 `mutation` 仅有一个字段即 `deleteOrganizationUser`，如果你要使用该变更，则需继续看它：

- 支持的参数（`args`）
- 支持的返回类型（`type`）

参数就一个即 `input`， 通过 `kind` 能知道它是“输入对象类型”，它的类型名是 `DeleteOrganizationUserInput`，继续追踪该类型名：

```json hlt:DeleteOrganizationUserInput hl:8
{
	"kind": "INPUT_OBJECT",
	"name": "DeleteOrganizationUserInput",
	"description": null,
	"fields": null,
	"inputFields": [
	{
	  "name": "id",
	  "description": null,
	  "type": {
		"kind": "NON_NULL",
		"name": null,
		"ofType": {
		  "kind": "SCALAR",
		  "name": "Int",
		  "ofType": null
		}
	  },
	  "defaultValue": null
	}
	],
	"interfaces": null,
	"enumValues": null,
	"possibleTypes": null
},
```

该输入对象类型中有一个名为 `id` 的字段。

此时，变更请求的大体框架已经可以构建了：

```
mutation test {
  deleteOrganizationUser(input: { id: 123 }) {
	  # 按需提供返回字段
  }
}
```

支持的返回类型见：

```json
"type": {
	"kind": "OBJECT",
	"name": "DeleteOrganizationUserResponse",
	"ofType": null
},
```

是一个对象类型，名为 `DeleteOrganizationUserResponse`，追踪得到：

```json
{
	"kind": "OBJECT",
	"name": "DeleteOrganizationUserResponse",
	"description": null,
	"fields": [
	{
	  "name": "user",
	  "description": null,
	  "args": [],
	  "type": {
		"kind": "NON_NULL",
		"name": null,
		"ofType": {
		  "kind": "OBJECT",
		  "name": "User",
		  "ofType": null
		}
	  },
	  "isDeprecated": false,
	  "deprecationReason": null
	}
	],
	"inputFields": null,
	"interfaces": [],
	"enumValues": null,
	"possibleTypes": null
},
```

该对象中有字段 `user`，并且也是一个对象类型（`"kind": "OBJECT"`），其名为 `User`，还得追踪 `User`：

```json
{
	"kind": "OBJECT",
	"name": "User",
	"description": null,
	"fields": [
	{
	  "name": "id",
	  "description": null,
	  "args": [],
	  "type": {
		"kind": "NON_NULL",
		"name": null,
		"ofType": {
		  "kind": "SCALAR",
		  "name": "Int",
		  "ofType": null
		}
	  },
	  "isDeprecated": false,
	  "deprecationReason": null
	},
	{
	  "name": "username",
	  "description": null,
	  "args": [],
	  "type": {
		"kind": "NON_NULL",
		"name": null,
		"ofType": {
		  "kind": "SCALAR",
		  "name": "String",
		  "ofType": null
		}
	  },
	  "isDeprecated": false,
	  "deprecationReason": null
	}
	],
	"inputFields": null,
	"interfaces": [],
	"enumValues": null,
	"possibleTypes": null
},
```

提供了两个字段，并且它们的类型都是标量类型，因此无需继续追踪了。

最终，可能的变更请求：

```
mutation test{
  deleteOrganizationUser(input: { id: 123 }) {
    user {
      id
      username
    }
  }
}
```

## 自省被禁用了

### 建议（Suggestions）

[Apollo GraphQL](https://www.apollographql.com/) 是围绕 GraphQL 建立的完整的生态系统和平台，它提供了一个名为 Suggestions（建议）的功能，即针对报错信息：

```
Cannot query field "help" on type "Query"
```

建议会在后面添加额外信息：

```
Cannot query field "help" on type "Query". Did you mean "hello"?
```

这使得即使内省被完全禁用，也可以从建议中获取 Schema 的相关信息。

而且，根据[官方文档](https://www.apollographql.com/docs/apollo-server/api/apollo-server)的描述，Suggestions 是默认被开启的。

### 专用工具

[clairvoyance](https://github.com/nikitastupin/clairvoyance) 是针对“自省被禁用”场景专门创建的工具。

该工具会将 GraphQL 服务器返回的错误信息当侧信道，通过词表（内置，也可以自指定）进行不断的探测从而最大程度恢复出 Schema。

### 绕过 GraphQL 的内省防御

#### 插入特殊字符

开发者在禁用内省时，可能会使用正则表达式来排除查询中的 `__schema` 关键字。你应该尝试在 `__shcema` 关键字后插入空格、换行符和逗号等字符，因为 GraphQL 会忽略它们（而有缺陷的正则不会，从而造成不匹配过滤规则使查询被放行）

例子（假设开发者只排除了 `__schema{`），下面这个内省查询会被放行。

```json hlt:换行符
#带换行符的内省查询
{
    "query": "query{__schema
    {queryType{name}}}"
}
```

#### 切换 HTTP 方法

内省可能仅在 POST 方式下被禁用，可以尝试 GET 请求，或将 `content-type` 的值换为 `x-www-form-urlencoded`。

```http
# 以 GET 请求发送的内省探测
GET /graphql?query=query%7B__schema%0A%7BqueryType%7Bname%7D%7D%7D
```

## 使用别名绕过速率限制

GraphQL 提供的部分功能可能涉及到一些敏感操作：

- 查询优惠券是否有效
- 查询用户是否存在
- 登入是否成功
- ……

因此，对 GraphQL 的调用次数通常会受限。

但 GraphQL 提供了别名，你可以通过一次调用实现多次查询。

例子（用于检查商店折扣码是否有效）：

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

## GraphQL CSRF

正常情况下，客户端以 `Content-Type` 为 `application/json` 对 GraphQL 端点发起 POST 请求。

在该情况下，CSRF 几乎是无法实现的，因为 `Content-Type` 为 `application/json` 的请求属于复杂请求，客户端会先发送 `OPTIONS` 预检测请求，只有服务器明确返回允许的 CORS（Cross-Origin Resource Sharing，跨域资源请求）头，才会正常发起请求。

但是，如果 GraphQL 端点没有正确校验 `Content-Type` 或者并没有限制请求方法，则可能出现 CSRF 漏洞。

**需要注意的是**，当你将 `Content-Type` 改为 `application/x-www-form-urlencoded` 之后，你对应的请求体也要改为表单类型。

原先：

```http
POST /graphql/v1 HTTP/2
[snip]
Content-Type: application/json
[snip]

{
  "query": "\n    mutation changeEmail($input: ChangeEmailInput!) {\n        changeEmail(input: $input) {\n            email\n        }\n    }\n",
  "operationName": "changeEmail",
  "variables": {
    "input": {
      "email": "foo@test.com"
    }
  }
}
```

修改后（注意 URL 编码）：

```http
POST /graphql/v1 HTTP/2
[snip]
Accept: application/x-www-urlencoded
[snip]

query=mutation+changeEmail%28%24input%3A+ChangeEmailInput%21%29+%7B%0A++changeEmail%28input%3A+%24input%29+%7B%0A++++email%0A++%7D%0A%7D&operationName=changeEmail&variables=%7B%22input%22%3A%7B%22email%22%3A%22hackerfoo%40test.com%22%7D%7D
```

## 附录

```json
{
  "data": {
    "__schema": {
      "queryType": {
        "name": "query"
      },
      "mutationType": {
        "name": "mutation"
      },
      "subscriptionType": null,
      "types": [
        {
          "kind": "SCALAR",
          "name": "Boolean",
          "description": "Built-in Boolean",
          "fields": null,
          "inputFields": null,
          "interfaces": null,
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "INPUT_OBJECT",
          "name": "DeleteOrganizationUserInput",
          "description": null,
          "fields": null,
          "inputFields": [
            {
              "name": "id",
              "description": null,
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "Int",
                  "ofType": null
                }
              },
              "defaultValue": null
            }
          ],
          "interfaces": null,
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "DeleteOrganizationUserResponse",
          "description": null,
          "fields": [
            {
              "name": "user",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "OBJECT",
                  "name": "User",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "SCALAR",
          "name": "Int",
          "description": "Built-in Int",
          "fields": null,
          "inputFields": null,
          "interfaces": null,
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "SCALAR",
          "name": "String",
          "description": "Built-in String",
          "fields": null,
          "inputFields": null,
          "interfaces": null,
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "User",
          "description": null,
          "fields": [
            {
              "name": "id",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "Int",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "username",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "String",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "__Directive",
          "description": null,
          "fields": [
            {
              "name": "name",
              "description": "The __Directive type represents a Directive that a server supports.",
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "String",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "description",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "isRepeatable",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "Boolean",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "locations",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "LIST",
                  "name": null,
                  "ofType": {
                    "kind": "NON_NULL",
                    "name": null,
                    "ofType": {
                      "kind": "ENUM",
                      "name": "__DirectiveLocation"
                    }
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "args",
              "description": null,
              "args": [
                {
                  "name": "includeDeprecated",
                  "description": null,
                  "type": {
                    "kind": "SCALAR",
                    "name": "Boolean",
                    "ofType": null
                  },
                  "defaultValue": "false"
                }
              ],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "LIST",
                  "name": null,
                  "ofType": {
                    "kind": "NON_NULL",
                    "name": null,
                    "ofType": {
                      "kind": "OBJECT",
                      "name": "__InputValue"
                    }
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "ENUM",
          "name": "__DirectiveLocation",
          "description": "An enum describing valid locations where a directive can be placed",
          "fields": null,
          "inputFields": null,
          "interfaces": null,
          "enumValues": [
            {
              "name": "QUERY",
              "description": "Indicates the directive is valid on queries.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "MUTATION",
              "description": "Indicates the directive is valid on mutations.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "SUBSCRIPTION",
              "description": "Indicates the directive is valid on subscriptions.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "FIELD",
              "description": "Indicates the directive is valid on fields.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "FRAGMENT_DEFINITION",
              "description": "Indicates the directive is valid on fragment definitions.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "FRAGMENT_SPREAD",
              "description": "Indicates the directive is valid on fragment spreads.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "INLINE_FRAGMENT",
              "description": "Indicates the directive is valid on inline fragments.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "VARIABLE_DEFINITION",
              "description": "Indicates the directive is valid on variable definitions.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "SCHEMA",
              "description": "Indicates the directive is valid on a schema SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "SCALAR",
              "description": "Indicates the directive is valid on a scalar SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "OBJECT",
              "description": "Indicates the directive is valid on an object SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "FIELD_DEFINITION",
              "description": "Indicates the directive is valid on a field SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "ARGUMENT_DEFINITION",
              "description": "Indicates the directive is valid on a field argument SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "INTERFACE",
              "description": "Indicates the directive is valid on an interface SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "UNION",
              "description": "Indicates the directive is valid on an union SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "ENUM",
              "description": "Indicates the directive is valid on an enum SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "ENUM_VALUE",
              "description": "Indicates the directive is valid on an enum value SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "INPUT_OBJECT",
              "description": "Indicates the directive is valid on an input object SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "INPUT_FIELD_DEFINITION",
              "description": "Indicates the directive is valid on an input object field SDL definition.",
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "__EnumValue",
          "description": null,
          "fields": [
            {
              "name": "name",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "String",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "description",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "isDeprecated",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "Boolean",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "deprecationReason",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "__Field",
          "description": null,
          "fields": [
            {
              "name": "name",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "String",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "description",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "args",
              "description": null,
              "args": [
                {
                  "name": "includeDeprecated",
                  "description": null,
                  "type": {
                    "kind": "SCALAR",
                    "name": "Boolean",
                    "ofType": null
                  },
                  "defaultValue": "false"
                }
              ],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "LIST",
                  "name": null,
                  "ofType": {
                    "kind": "NON_NULL",
                    "name": null,
                    "ofType": {
                      "kind": "OBJECT",
                      "name": "__InputValue"
                    }
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "type",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "OBJECT",
                  "name": "__Type",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "isDeprecated",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "Boolean",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "deprecationReason",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "__InputValue",
          "description": null,
          "fields": [
            {
              "name": "name",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "String",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "description",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "type",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "OBJECT",
                  "name": "__Type",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "defaultValue",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "isDeprecated",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "Boolean",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "deprecationReason",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "__Schema",
          "description": "A GraphQL Introspection defines the capabilities of a GraphQL server. It exposes all available types and directives on the server, the entry points for query, mutation, and subscription operations.",
          "fields": [
            {
              "name": "description",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "types",
              "description": "A list of all types supported by this server.",
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "LIST",
                  "name": null,
                  "ofType": {
                    "kind": "NON_NULL",
                    "name": null,
                    "ofType": {
                      "kind": "OBJECT",
                      "name": "__Type"
                    }
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "queryType",
              "description": "The type that query operations will be rooted at.",
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "OBJECT",
                  "name": "__Type",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "mutationType",
              "description": "If this server supports mutation, the type that mutation operations will be rooted at.",
              "args": [],
              "type": {
                "kind": "OBJECT",
                "name": "__Type",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "directives",
              "description": "'A list of all directives supported by this server.",
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "LIST",
                  "name": null,
                  "ofType": {
                    "kind": "NON_NULL",
                    "name": null,
                    "ofType": {
                      "kind": "OBJECT",
                      "name": "__Directive"
                    }
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "subscriptionType",
              "description": "'If this server support subscription, the type that subscription operations will be rooted at.",
              "args": [],
              "type": {
                "kind": "OBJECT",
                "name": "__Type",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "__Type",
          "description": null,
          "fields": [
            {
              "name": "kind",
              "description": null,
              "args": [],
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "ENUM",
                  "name": "__TypeKind",
                  "ofType": null
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "name",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "description",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "fields",
              "description": null,
              "args": [
                {
                  "name": "includeDeprecated",
                  "description": null,
                  "type": {
                    "kind": "SCALAR",
                    "name": "Boolean",
                    "ofType": null
                  },
                  "defaultValue": "false"
                }
              ],
              "type": {
                "kind": "LIST",
                "name": null,
                "ofType": {
                  "kind": "NON_NULL",
                  "name": null,
                  "ofType": {
                    "kind": "OBJECT",
                    "name": "__Field",
                    "ofType": null
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "interfaces",
              "description": null,
              "args": [],
              "type": {
                "kind": "LIST",
                "name": null,
                "ofType": {
                  "kind": "NON_NULL",
                  "name": null,
                  "ofType": {
                    "kind": "OBJECT",
                    "name": "__Type",
                    "ofType": null
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "possibleTypes",
              "description": null,
              "args": [],
              "type": {
                "kind": "LIST",
                "name": null,
                "ofType": {
                  "kind": "NON_NULL",
                  "name": null,
                  "ofType": {
                    "kind": "OBJECT",
                    "name": "__Type",
                    "ofType": null
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "enumValues",
              "description": null,
              "args": [
                {
                  "name": "includeDeprecated",
                  "description": null,
                  "type": {
                    "kind": "SCALAR",
                    "name": "Boolean",
                    "ofType": null
                  },
                  "defaultValue": "false"
                }
              ],
              "type": {
                "kind": "LIST",
                "name": null,
                "ofType": {
                  "kind": "NON_NULL",
                  "name": null,
                  "ofType": {
                    "kind": "OBJECT",
                    "name": "__EnumValue",
                    "ofType": null
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "inputFields",
              "description": null,
              "args": [
                {
                  "name": "includeDeprecated",
                  "description": null,
                  "type": {
                    "kind": "SCALAR",
                    "name": "Boolean",
                    "ofType": null
                  },
                  "defaultValue": "false"
                }
              ],
              "type": {
                "kind": "LIST",
                "name": null,
                "ofType": {
                  "kind": "NON_NULL",
                  "name": null,
                  "ofType": {
                    "kind": "OBJECT",
                    "name": "__InputValue",
                    "ofType": null
                  }
                }
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "ofType",
              "description": null,
              "args": [],
              "type": {
                "kind": "OBJECT",
                "name": "__Type",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "specifiedByURL",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "specifiedByUrl",
              "description": null,
              "args": [],
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "isDeprecated": true,
              "deprecationReason": "This legacy name has been replaced by `specifiedByURL`"
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "ENUM",
          "name": "__TypeKind",
          "description": "An enum describing what kind of type a given __Type is",
          "fields": null,
          "inputFields": null,
          "interfaces": null,
          "enumValues": [
            {
              "name": "SCALAR",
              "description": "Indicates this type is a scalar. 'specifiedByURL' is a valid field",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "OBJECT",
              "description": "Indicates this type is an object. `fields` and `interfaces` are valid fields.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "INTERFACE",
              "description": "Indicates this type is an interface. `fields` and `possibleTypes` are valid fields.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "UNION",
              "description": "Indicates this type is a union. `possibleTypes` is a valid field.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "ENUM",
              "description": "Indicates this type is an enum. `enumValues` is a valid field.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "INPUT_OBJECT",
              "description": "Indicates this type is an input object. `inputFields` is a valid field.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "LIST",
              "description": "Indicates this type is a list. `ofType` is a valid field.",
              "isDeprecated": false,
              "deprecationReason": null
            },
            {
              "name": "NON_NULL",
              "description": "Indicates this type is a non-null. `ofType` is a valid field.",
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "mutation",
          "description": null,
          "fields": [
            {
              "name": "deleteOrganizationUser",
              "description": null,
              "args": [
                {
                  "name": "input",
                  "description": null,
                  "type": {
                    "kind": "INPUT_OBJECT",
                    "name": "DeleteOrganizationUserInput",
                    "ofType": null
                  },
                  "defaultValue": null
                }
              ],
              "type": {
                "kind": "OBJECT",
                "name": "DeleteOrganizationUserResponse",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        },
        {
          "kind": "OBJECT",
          "name": "query",
          "description": null,
          "fields": [
            {
              "name": "getUser",
              "description": null,
              "args": [
                {
                  "name": "id",
                  "description": null,
                  "type": {
                    "kind": "NON_NULL",
                    "name": null,
                    "ofType": {
                      "kind": "SCALAR",
                      "name": "Int",
                      "ofType": null
                    }
                  },
                  "defaultValue": null
                }
              ],
              "type": {
                "kind": "OBJECT",
                "name": "User",
                "ofType": null
              },
              "isDeprecated": false,
              "deprecationReason": null
            }
          ],
          "inputFields": null,
          "interfaces": [],
          "enumValues": null,
          "possibleTypes": null
        }
      ],
      "directives": [
        {
          "name": "include",
          "description": "Directs the executor to include this field or fragment only when the `if` argument is true",
          "locations": [
            "FIELD",
            "FRAGMENT_SPREAD",
            "INLINE_FRAGMENT"
          ],
          "args": [
            {
              "name": "if",
              "description": "Included when true.",
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "Boolean",
                  "ofType": null
                }
              },
              "defaultValue": null
            }
          ]
        },
        {
          "name": "skip",
          "description": "Directs the executor to skip this field or fragment when the `if` argument is true.",
          "locations": [
            "FIELD",
            "FRAGMENT_SPREAD",
            "INLINE_FRAGMENT"
          ],
          "args": [
            {
              "name": "if",
              "description": "Skipped when true.",
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "Boolean",
                  "ofType": null
                }
              },
              "defaultValue": null
            }
          ]
        },
        {
          "name": "deprecated",
          "description": "Marks the field, argument, input field or enum value as deprecated",
          "locations": [
            "FIELD_DEFINITION",
            "ARGUMENT_DEFINITION",
            "ENUM_VALUE",
            "INPUT_FIELD_DEFINITION"
          ],
          "args": [
            {
              "name": "reason",
              "description": "The reason for the deprecation",
              "type": {
                "kind": "SCALAR",
                "name": "String",
                "ofType": null
              },
              "defaultValue": "\"No longer supported\""
            }
          ]
        },
        {
          "name": "specifiedBy",
          "description": "Exposes a URL that specifies the behaviour of this scalar.",
          "locations": [
            "SCALAR"
          ],
          "args": [
            {
              "name": "url",
              "description": "The URL that specifies the behaviour of this scalar.",
              "type": {
                "kind": "NON_NULL",
                "name": null,
                "ofType": {
                  "kind": "SCALAR",
                  "name": "String",
                  "ofType": null
                }
              },
              "defaultValue": null
            }
          ]
        }
      ]
    }
  }
}
```