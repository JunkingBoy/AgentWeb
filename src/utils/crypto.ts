/**
 * AES-128-CBC 加解密工具
 *
 * 与后端 Encry.py 对齐:
 *   encrypt → random 16B IV + AES-CBC(PKCS7) → base64(IV + ciphertext)
 *   decrypt → base64 decode → 取前 16B IV → AES-CBC 解密 → 明文
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
