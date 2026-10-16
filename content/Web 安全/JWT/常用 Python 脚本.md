---
title: 常用 Python 脚本
date: 2026-10-16
updated: 2026-10-16
tags:
  - JWT
  - Python
  - Cheatsheet
description: 一句话摘要
---
>[!tip]
> 假设，验签算法都采用 RS256。

## 生成 JWK 格式的密钥

推荐使用 `jwcrypto` 库：

```python
import json, uuid
from jwcrypto import jwk

key = jwk.JWK.generate(
	kty='RSA',
    size=2048,
    alg='RS256',
    use='sig',
    kid=str(uuid.uuid4())
)

private_jwk = key.export(private_key=True, as_dict=True)
public_jwk = key.export(as_dict=True)

print('JWK 格式的私钥: ')
print(json.dumps(private_jwk, indent=2))
print('\nJWK 格式的公钥: ')
print(json.dumps(public_jwk, indent=2))
```

## 生成 PEM 格式的密钥

```python
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

with open("private.pem", "wb") as f:
    f.write(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))

with open("public.pem", "wb") as f:
    f.write(key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ))
```

注意，这其实并没有 `openssl` 命令来得方便：

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

## JWS 构造

对于 PEM 格式的密钥：

```python hlt:"仅作为示例，并不完整"
import jwt

with open("private.pem", "rb") as f:
    private_key = f.read()
with open("public.pem", "rb") as f:
    public_key = f.read()

# 仅作为示例，并不完整
payload = {
    "iss": "https://auth.example.com",
    "role": "admin",
    ……
}

# 签名：用私钥
token = jwt.encode(
    payload,
    private_key,
    algorithm="RS256",
    headers={"kid": "key-2026-01", ……},  # # 仅作为示例，并不完整
)
print(token)
```

对于 JWK 格式的密钥：

```python
import json, uuid
from jwcrypto import jwk
from jwt.algorithms import RSAAlgorithm

key = jwk.JWK.generate(
	kty='RSA',
    size=2048,
    alg='RS256',
    use='sig',
    kid=str(uuid.uuid4())
)

# 两个 JWK 格式的密钥
private_jwk = key.export(private_key=True, as_dict=True)
public_jwk = key.export(as_dict=True)

private_key = RSAAlgorithm.from_jwk(private_jwk)
public_key = RSAAlgorithm.from_jwk(public_jwk)

# payload 以及 header 均只作为示例
token = jwt.encode(
    {"sub": "user-123", "role": 'admin', ……},
    private_key,
    algorithm="RS256",
    headers={"alg": "RS256", "kid": "yzwqhV6VJRHiQoXrxSlGWorFE7m6TjjZEp8Kyijxl9w", ……}
)

print(token)

```

## x5c 证书链

x5c（X.509 Certificate Chain）用于向验证方提供一条 X.509 证书**链**。第一张证书（leaf）包含验证 JWS 签名所需的公钥，后续每张证书提供验证前一张证书签名所需的公钥，最后一级由验证方本地信任的根 CA 证书来验证。验证方沿链逐级校验签名、有效期、CA 权限和用途等，直到本地预置的信任锚，并确认 leaf 证书的身份是预期的签发者，以此借助 PKI 体系保证该公钥可信。

下述代码假设了攻击者已知 Root CA 的用于签名的私钥：

```python
import base64, hashlib, datetime as dt
import jwt
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

now = dt.datetime.now(dt.timezone.utc)

def name(cn):
    return x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Example Corp"),
        x509.NameAttribute(NameOID.COMMON_NAME, cn),
    ])

def key_usage(sign_certs: bool):
    return x509.KeyUsage(
        digital_signature=not sign_certs, content_commitment=False,
        key_encipherment=False, data_encipherment=False, key_agreement=False,
        key_cert_sign=sign_certs, crl_sign=sign_certs,
        encipher_only=False, decipher_only=False,
    )

# --- Root CA（实际生产中通常由已有 CA 签发） ---
ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ca_cert = (
    x509.CertificateBuilder()
    .subject_name(name("Demo Root CA"))
    .issuer_name(name("Demo Root CA"))
    .public_key(ca_key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now)
    .not_valid_after(now + dt.timedelta(days=3650))
    .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
    .add_extension(key_usage(sign_certs=True), critical=True)
    .sign(ca_key, hashes.SHA256())
)

# --- JWT 签名用的 leaf 证书：公钥就放在这里 ---
signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
leaf_cert = (
    x509.CertificateBuilder()
    .subject_name(name("jwt-signer"))
    .issuer_name(ca_cert.subject)
    .public_key(signing_key.public_key())          # ← 公钥信息写入证书
    .serial_number(x509.random_serial_number())
    .not_valid_before(now)
    .not_valid_after(now + dt.timedelta(days=365))
    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
    .add_extension(key_usage(sign_certs=False), critical=True)
    .sign(ca_key, hashes.SHA256())                 # 由 CA 签发
)

def der_b64(cert):
    return base64.b64encode(cert.public_bytes(serialization.Encoding.DER)).decode()

leaf_der = leaf_cert.public_bytes(serialization.Encoding.DER)

x5c = [der_b64(leaf_cert), der_b64(ca_cert)]   # leaf 在前，CA 在后
# 可选：证书 SHA-256 指纹（这个用 base64url、无补齐）
x5t_s256 = base64.urlsafe_b64encode(hashlib.sha256(leaf_der).digest()).rstrip(b"=").decode()

token = jwt.encode(
    {"sub": "user-123", "iat": now, "exp": now + dt.timedelta(minutes=10)},
    signing_key,
    algorithm="RS256",
    headers={"x5c": x5c, "x5t#S256": x5t_s256},
)
print(jwt.get_unverified_header(token))
```