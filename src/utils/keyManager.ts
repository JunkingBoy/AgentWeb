import { fetchPublicKey } from '@/api/agent'
import { extractAesKey, hexKeyToCryptoKey } from '@/utils/crypto'
import type { PublicKeyData } from '@/types/api'

const STORAGE_KEY = 'aes_key_data'

let cachedKey: Promise<CryptoKey> | null = null

/** 从 sessionStorage 恢复原始接口数据（填充密钥+索引），不存明文hex */
function loadKeyDataFromSession(): { hexKey: string; index: number } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data: PublicKeyData = JSON.parse(raw)
    const hexKey = extractAesKey(data.key, data.index)
    return { hexKey, index: data.index }
  } catch {
    return null
  }
}

/** 将原始接口数据存入 sessionStorage（含填充字符，非明文hex） */
function saveKeyDataToSession(data: PublicKeyData): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 不可用时静默失败
  }
}

/** 获取（并缓存）AES CryptoKey */
export async function getAesKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = (async () => {
      // 内存未命中 → 尝试从 sessionStorage 恢复
      const stored = loadKeyDataFromSession()
      if (stored) {
        return hexKeyToCryptoKey(stored.hexKey)
      }

      // 都未命中 → 请求后端
      try {
        const res = await fetchPublicKey()
        if (res.code !== 1001 || !res.data) {
          throw new Error(res.msg || '获取加密密钥失败')
        }
        // 存的是原始接口数据（含填充），不是明文hex
        saveKeyDataToSession(res.data)
        const hexKey = extractAesKey(res.data.key, res.data.index)
        return hexKeyToCryptoKey(hexKey)
      } catch (e) {
        cachedKey = null
        throw e
      }
    })()
  }
  return cachedKey
}

/** 清空缓存的密钥 */
export function clearKeyCache(): void {
  cachedKey = null
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 静默
  }
}
