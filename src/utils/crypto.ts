/**
 * 加解密工具
 *
 * AES-128-CBC（登录后业务数据，与后端 Encry.encrypt/decrypt 对齐）:
 *   encrypt → random 16B IV + AES-CBC(PKCS7) → base64(IV + ciphertext)
 *   decrypt → base64 decode → 取前 16B IV → AES-CBC 解密 → 明文
 *
 * RSA-OAEP（登录参数加密，与后端 Encry.rsa_encrypt/rsa_decrypt 对齐）:
 *   公钥来自 /key/public（后端 filling_key: 原文随机填充16字符后整体base64, 附带指纹）,
 *   加密 → RSA-OAEP(SHA-1) → base64 密文
 */

/* ===== 密钥处理 ===== */

/** 从后端返回的填充密钥中提取原始 AES 十六进制密钥 */
export function extractAesKey(filledKey: string, index: number): string {
  // 先 base64 解码
  const decoded = atob(filledKey)
  // 去掉 index 位置起的 16 位填充字符，还原原始密钥
  const raw = decoded.slice(0, index) + decoded.slice(index + 16)
  return raw
}

/** 将十六进制密钥串转为 CryptoKey */
export async function hexKeyToCryptoKey(hex: string): Promise<CryptoKey> {
  const buf = new ArrayBuffer(hex.length / 2)
  const raw = new Uint8Array(buf)
  for (let i = 0; i < hex.length; i += 2) {
    raw[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-CBC' },
    false,
    ['encrypt', 'decrypt'],
  )
}

/* ===== 加密 ===== */

/**
 * AES-128-CBC 加密
 * 格式: base64(16B IV + ciphertext) — 与后端 Encry.encrypt 一致
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    encoded,
  )

  const combined = new Uint8Array(16 + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), 16)

  return btoa(String.fromCharCode(...combined))
}

/**
 * AES-128-CBC 解密
 * 输入: base64(16B IV + ciphertext)
 */
export async function decrypt(
  encoded: string,
  key: CryptoKey,
): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const iv = combined.slice(0, 16)
  const ciphertext = combined.slice(16)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    key,
    ciphertext,
  )

  return new TextDecoder().decode(plaintext)
}

/* ===== 工具 ===== */

/** 十六进制字符串 → Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  const buf = new ArrayBuffer(hex.length / 2)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/** Uint8Array → 十六进制字符串 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/* ===== RSA 公钥加密（登录参数加密，与后端 Encry.rsa_encrypt 对齐） ===== */

/**
 * 从 /key/public 返回的填充公钥中还原 PEM 文本。
 * 后端 filling_key 格式: key = base64(原文随机插入16个填充字符)（先填充后编码）
 * 还原: raw = base64decode(key) → raw[:index] + raw[index+16:] → 原始 PEM
 */
export function extractRsaPublicKeyPem(filledKey: string, index: number): string {
  const raw = atob(filledKey)
  return raw.slice(0, index) + raw.slice(index + 16)
}

/** sha256(data) 十六进制 — 用于校验公钥指纹（后端 sha256_hash 前 8 位） */
export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(data),
  )
  return bytesToHex(new Uint8Array(digest))
}

/** PEM 公钥 → WebCrypto RSA-OAEP CryptoKey（SHA-1 与后端 PyCryptodome PKCS1_OAEP 默认哈希一致） */
export async function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSA-OAEP', hash: 'SHA-1' },
    false,
    ['encrypt'],
  )
}

/**
 * RSA-OAEP 加密 → base64 密文
 * 与后端 rsa_decrypt(base64.b64decode(data)) 输入格式一致
 */
export async function rsaEncrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(plaintext),
  )
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)))
}
