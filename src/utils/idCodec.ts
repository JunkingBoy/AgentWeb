/**
 * id 编解码统一入口
 *
 * 背景（两条不可绕过的协议约束，前端只能适配）：
 *
 * 1) 防重放账本 —— 后端对「服务端颁发」的密文做记账
 *    （services/ReplayLedgerCenter.claim_encrypted_fields / verify_encrypted_fields）：
 *    响应里下发过的密文原样回传会被判为重放，整批拒绝。因此
 *      · 出网方向（toWireId）：明文 → encrypt(新 IV)；密文 → decrypt + encrypt(新 IV)
 *        「加密」必须每次现场做，结果不可缓存复用；
 *      · 入网/本地方向（toPlainId）：密文 decrypt 的结果按密文缓存，重复调用零成本。
 *
 * 2) WebSocket 业务层的 session_id 后端按**明文**直接查库
 *    （services/WSChatCenter.analysis_session：ctx.session.session_id = ctx.data.session_id
 *      → repository.ChatRepository.find_messages_by_session_id），传输层只解密整个信封，
 *    不会解密 data.session_id。因此 store 内一律保存**明文 id**，
 *    只在 HTTP 出网那一刻才转换成密文，避免把密文当会话键发给后端导致上下文丢失。
 *
 * 明文 id 形态（与后端一致）：
 *   · 32 位 hex  —— session_id（uuid4().hex，WS/HTTP 两侧）
 *   · 36 位 UUID —— request_id（WS 实时会话的明文 UUID）
 *   · 64 位 hex  —— file_id（sha256 内容哈希）
 */

import { encrypt, decrypt } from '@/utils/crypto'
import { getAesKey } from '@/utils/keyManager'

/** 明文 id 判定：三种后端认可的明文形态，其余一律视为服务端颁发的密文 */
const PLAIN_ID_RE =
  /^(?:[0-9a-f]{32}|[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * 密文 → 明文 的解析缓存。
 * Map 迭代顺序即插入顺序，超限时淘汰最早插入的一条（够用的 LRU 近似）；
 * 每次命中会把条目录移到队尾，保证热点不被误淘汰。
 */
const DECRYPT_CACHE_LIMIT = 512
const plaintextByCipher = new Map<string, string>()

/** 明文 id 直接返回 true（无需解密） */
export function isPlainId(value: string): boolean {
  return PLAIN_ID_RE.test(value)
}

function cacheGet(cipher: string): string | undefined {
  const hit = plaintextByCipher.get(cipher)
  if (hit === undefined) return undefined
  // 命中后移到队尾（LRU 近似）
  plaintextByCipher.delete(cipher)
  plaintextByCipher.set(cipher, hit)
  return hit
}

function cacheSet(cipher: string, plain: string): void {
  if (plaintextByCipher.size >= DECRYPT_CACHE_LIMIT) {
    const oldest = plaintextByCipher.keys().next().value
    if (oldest !== undefined) plaintextByCipher.delete(oldest)
  }
  plaintextByCipher.set(cipher, plain)
}

/** 清空解析缓存（登出 / 换钥时调用，避免旧密钥下的解析结果残留） */
export function clearIdCodecCache(): void {
  plaintextByCipher.clear()
}

/**
 * 密文 → 明文（带缓存）。
 * 解密失败会抛出，由调用方决定降级策略（见 toPlainIdSafe）。
 */
export async function toPlainId(value: string): Promise<string> {
  if (!value) return value
  if (isPlainId(value)) return value

  const cached = cacheGet(value)
  if (cached !== undefined) return cached

  const key = await getAesKey()
  const plain = await decrypt(value, key)
  cacheSet(value, plain)
  return plain
}

/**
 * 密文 → 明文（容错版）：解密失败时原样返回，避免一条坏数据打断整个列表渲染。
 * 用于历史消息批量规范化这种"宁可显示原文也不能整批失败"的场景。
 */
export async function toPlainIdSafe(value: string): Promise<string> {
  try {
    return await toPlainId(value)
  } catch {
    return value
  }
}

/**
 * 明文/密文 → 可直接出网的**全新**密文。
 * 明文 → encrypt(新 IV)；密文 → 先取明文（解密结果走缓存）再 encrypt(新 IV)。
 * 新 IV 保证密文不在服务端账本中，从而通过防重放校验。
 */
export async function toWireId(value: string): Promise<string> {
  const plain = isPlainId(value) ? value : await toPlainId(value)
  const key = await getAesKey()
  return encrypt(plain, key)
}

/** 批量版 toWireId（保持入参顺序） */
export async function toWireIds(values: string[]): Promise<string[]> {
  return Promise.all(values.map(v => toWireId(v)))
}
