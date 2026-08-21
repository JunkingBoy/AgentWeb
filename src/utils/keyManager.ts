import { fetchRsaPublicKey } from '@/api/agent'
import {
  extractAesKey,
  hexKeyToCryptoKey,
  extractRsaPublicKeyPem,
  importRsaPublicKey,
  sha256Hex,
} from '@/utils/crypto'
import type { PublicKeyData } from '@/types/api'

const STORAGE_KEY = 'aes_key_data'

let cachedAesKey: Promise<CryptoKey> | null = null

/* ===== AES 密钥（登录成功后随 token 由后端颁发） ===== */

/** 从 sessionStorage 恢复原始接口数据（填充密钥+索引），不存明文hex */
function loadKeyDataFromSession(): PublicKeyData | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PublicKeyData
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

/**
 * 保存登录成功后后端随 token 颁发的 AES 密钥（填充格式）。
 * 后端已不再通过 /key/public 分发 AES 密钥，仅登录成功时颁发。
 */
export function saveAesKeyFromLogin(data: PublicKeyData): void {
  cachedAesKey = null
  saveKeyDataToSession(data)
}

/** 获取 AES CryptoKey — 仅使用登录颁发的密钥；未颁发时抛错提示重新登录 */
export async function getAesKey(): Promise<CryptoKey> {
  if (!cachedAesKey) {
    cachedAesKey = (async () => {
      const stored = loadKeyDataFromSession()
      if (!stored) {
        throw new Error('加密密钥未颁发，请重新登录')
      }
      return hexKeyToCryptoKey(extractAesKey(stored.key, stored.index))
    })().catch(e => {
      cachedAesKey = null
      throw e
    })
  }
  return cachedAesKey
}

/* ===== RSA 公钥（登录参数加密用，来自 /key/public） ===== */

/**
 * 获取 RSA 公钥 CryptoKey。
 * 每次实时获取（含指纹校验），避免服务端更换密钥后本地缓存过期导致解密失败。
 */
export async function getRsaPublicKey(): Promise<CryptoKey> {
  const res = await fetchRsaPublicKey()
  if (res.code !== 1001 || !res.data) {
    throw new Error(res.msg || '获取RSA公钥失败')
  }
  const { index, key, fingerprint } = res.data
  const pem = extractRsaPublicKeyPem(key, index)
  // 指纹校验：sha256(PEM) 前 8 位 与后端返回的 fingerprint 一致，防止传输篡改
  if (fingerprint) {
    const actual = (await sha256Hex(pem)).slice(0, 8)
    if (actual !== fingerprint) {
      throw new Error('RSA公钥指纹校验失败')
    }
  }
  return importRsaPublicKey(pem)
}

/** 清空缓存的密钥 */
export function clearKeyCache(): void {
  cachedAesKey = null
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 静默
  }
}
