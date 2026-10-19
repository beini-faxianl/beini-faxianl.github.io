---
title: Ruby 语法
date: 2026-10-19
updated: 2026-10-19
tags:
  - 前端
  - react
description: Ruby
---
# Claude Opus 5.5（High）

>[!question]
> 我打算快速入门 Ruby，你给我讲讲语法。

下面按“从基础到常用”的顺序过一遍 Ruby 的核心语法，每部分都配了能直接运行的代码。你可以装好 Ruby 后在终端输入 `irb`（交互式环境）边看边试。

## 1. 变量与基本类型

```ruby
name = "Ruby"        # 字符串
age = 30             # 整数
price = 9.99         # 浮点数
ok = true            # 布尔值
nothing = nil        # 空值（类似其他语言的 null）

PI = 3.14            # 大写开头的是常量
$count = 0           # $ 开头：全局变量（少用）
@name = "x"          # @ 开头：实例变量（类里用）
```

变量不用声明类型，命名习惯是 `snake_case`（小写加下划线）。

**一个重要规则**：在 Ruby 里只有 `false` 和 `nil` 是“假”，`0`、空字符串 `""`、空数组 `[]` 都是“真”。

## 2. 字符串与符号

```ruby
first = "张"
last = "三"

puts "你好，#{first}#{last}"   # 双引号支持 #{} 插值
puts '你好，#{first}'          # 单引号不插值，原样输出

"hello".upcase       # => "HELLO"
"hello".length       # => 5
"a,b,c".split(",")   # => ["a", "b", "c"]
"hi" * 3             # => "hihihi"

# 符号（Symbol）：以冒号开头，像一个不可变的“名字标签”，常用作哈希的键
status = :active
```

`puts` 输出并换行，`print` 不换行，`p` 会输出对象的调试形式（比如字符串会带引号），调试时很好用。

## 3. 数组和哈希

```ruby
# 数组
nums = [1, 2, 3, 4, 5]
nums[0]          # => 1
nums[-1]         # => 5（负数从末尾数）
nums << 6        # 追加元素
nums.size        # => 6
nums.include?(3) # => true
nums.first(2)    # => [1, 2]

# 哈希（键值对，类似字典/Map）
user = { name: "小明", age: 20 }   # 键是符号，这是最常见的写法
user[:name]        # => "小明"
user[:city] = "北京"
user.keys          # => [:name, :age, :city]

# 字符串作键的写法
scores = { "数学" => 90, "英语" => 85 }
```

## 4. 条件判断

```ruby
score = 85

if score >= 90
  puts "优秀"
elsif score >= 60      # 注意是 elsif，不是 else if
  puts "及格"
else
  puts "不及格"
end

# unless = if not
unless score < 60
  puts "过了"
end

# 修饰符写法：条件放在后面，适合单行
puts "满分！" if score == 100

# 三元运算符
result = score >= 60 ? "过" : "挂"

# case 语句
case score
when 90..100 then puts "A"     # 90..100 是范围（Range）
when 60...90 then puts "B"     # 三个点不包含 90
else puts "C"
end
```

Ruby 的代码块用 `end` 结束，不用大括号，也不靠缩进。

## 5. 循环与迭代

Ruby 里很少用传统的 `for` 循环，更习惯用迭代方法配合代码块：

```ruby
5.times { |i| puts i }            # 0 到 4

[1, 2, 3].each do |n|
  puts n * 10
end

1.upto(3) { |i| puts i }          # 1 到 3

user = { name: "小明", age: 20 }
user.each { |key, value| puts "#{key}: #{value}" }

# while 也有
i = 0
while i < 3
  i += 1        # Ruby 没有 i++
end
```

**代码块的两种写法**：单行用 `{ }`，多行用 `do ... end`。`|n|` 里是块的参数。

### 常用的集合方法（非常重要）

这些是写出地道 Ruby 代码的关键：

```ruby
nums = [1, 2, 3, 4, 5]

nums.map { |n| n * 2 }          # => [2, 4, 6, 8, 10]   映射
nums.select { |n| n.even? }     # => [2, 4]             筛选
nums.reject { |n| n.even? }     # => [1, 3, 5]          排除
nums.find { |n| n > 2 }         # => 3                  找第一个
nums.sum                        # => 15
nums.reduce(0) { |acc, n| acc + n }  # => 15            累积
nums.sort_by { |n| -n }         # => [5, 4, 3, 2, 1]
nums.each_with_index { |n, i| puts "#{i}: #{n}" }

# 简写：&:方法名
%w[a b c].map(&:upcase)         # => ["A", "B", "C"]
```

`%w[a b c]` 是快速创建字符串数组的写法，等于 `["a", "b", "c"]`。

## 6. 方法（函数）

```ruby
def greet(name)
  "你好，#{name}"          # 最后一行的值自动返回，不用写 return
end

greet("小明")
greet "小明"               # 括号可省略

# 默认参数
def greet(name, greeting = "你好")
  "#{greeting}，#{name}"
end

# 关键字参数（调用时写参数名，更清晰）
def create_user(name:, age: 18)
  "#{name}, #{age}岁"
end
create_user(name: "小红", age: 20)

# 命名约定
def adult?(age) = age >= 18   # ? 结尾：返回布尔值（这是单行方法定义写法）

arr = [3, 1, 2]
arr.sort     # 返回新数组，arr 不变
arr.sort!    # ! 结尾：直接修改原对象
```

## 7. 代码块与 yield

你可以写接收代码块的方法，这是 Ruby 很有特色的地方：

```ruby
def twice
  yield
  yield
end

twice { puts "嗨" }      # 输出两次“嗨”

def with_log
  puts "开始"
  result = yield(10)     # 可以给块传参数
  puts "结束，结果是 #{result}"
end

with_log { |x| x * 2 }
```

## 8. 类与对象

```ruby
class Animal
  attr_reader :name           # 自动生成读取方法 name
  attr_accessor :age          # 生成读写方法 age 和 age=

  def initialize(name, age)   # 构造方法
    @name = name              # @ 开头是实例变量
    @age = age
  end

  def speak
    "..."
  end

  def to_s                    # 定义 puts 时显示的内容
    "#{@name}（#{@age}岁）"
  end

  private                     # 下面的方法都是私有的

  def secret
    "私有方法"
  end
end

class Dog < Animal            # < 表示继承
  def speak
    "汪汪"
  end
end

dog = Dog.new("旺财", 3)
dog.speak        # => "汪汪"
dog.age = 4      # 因为有 attr_accessor
puts dog         # => 旺财（4岁）
```

### 模块（Module）

模块用来给多个类共享方法，也用作命名空间：

```ruby
module Swimmable
  def swim
    "#{name}在游泳"
  end
end

class Duck < Animal
  include Swimmable           # 混入模块
end

Duck.new("唐老鸭", 2).swim     # => "唐老鸭在游泳"
```

## 9. 异常处理

```ruby
begin
  result = 10 / 0
rescue ZeroDivisionError => e
  puts "出错了：#{e.message}"
ensure
  puts "无论如何都会执行"
end

# 主动抛出异常
raise ArgumentError, "参数不对" if age < 0
```

对应其他语言：`begin/rescue/ensure` 相当于 `try/catch/finally`。

## 10. 几个实用的小语法

```ruby
# 安全调用：对象可能是 nil 时用 &.
user&.name               # user 为 nil 时返回 nil，不会报错

# ||= ：变量为 nil 或 false 时才赋值
cache ||= {}

# 多重赋值
a, b = 1, 2
a, b = b, a              # 交换

# 多行字符串
text = <<~TEXT
  第一行
  第二行
TEXT

# 获取用户输入
input = gets.chomp       # chomp 去掉末尾换行
```

## 入门建议

1. 先在 `irb` 里把上面的例子都敲一遍，重点熟悉**代码块**和 **`map`/`select`/`each`** 这类集合方法，这是 Ruby 最核心的思维方式。
2. 写几个小脚本练手，比如单词计数、简易通讯录、猜数字游戏。
3. 遇到不熟的方法可以在 irb 里用 `对象.methods` 查看，或去 [ruby-doc.org](https://ruby-doc.org) 查文档。

想的话我可以给你出几道练习题，或者带你写一个完整的小项目把这些语法串起来。