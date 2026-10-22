import type { LLMUsage } from '@/types/api'
import { UsageRateLimitError } from '@/utils/usageErrors'

/*
 * ============================================================================
 * 单轮 token 用量缓存（纯前端，不改变后端协议）
 * ============================================================================
 *
 * 背景：后端对 /chat/usage 与 /chat/usage/batch 做了限频（HTTP 429），
 *       而同一轮问答的 usage 一旦落库就**不会再变**。前端必须把"点击才查"、
 *       "短时间只查一次"、"失败不风暴" 三件事做掉，不能靠用户少点。
 *
 * 设计要点：
 *   1. 按需加载：徽标进入视口（IntersectionObserver）或气泡被点开时才请求，
 *      离屏消息、纯浏览不滚动都零请求；
 *   2. 正缓存：成功结果 TTL 30min（同轮用量不可变）；空结果 TTL 30s（可能是
 *      "刚生成完、用量行还没落库"的瞬时态）；失败 TTL 10s（避免频繁重试）；
 *   3. 微批处理：60ms 窗口内被点开的多个 request_id 合并成**一次** batch 请求，
 *      MAX_BATCH_SIZE=20 防止单次 body 过大；
 *   4. 单飞：同一 request_id 在途时复用同一个 Promise；同一时刻只允许一个
 *      batch 在途，其余排队；
 *   5. 限频退避：收到 429 → 全局 blockedUntil，窗口内直接返回错误条目（不发请求），
 *      等待时长优先取 Retry-After；
 *   6. LRU：最多 300 条，按 lastAccess 淘汰；在途条目不会被淘汰；
 *   7. 失效：删除消息 / 删除会话 / 登出 / 会话过期时清掉对应缓存；
 *   8. WS 预热（可选）：后端实时响应 data.usage 已带本轮用量，调用 primeUsage()
 *      可直接写缓存，**当轮 0 次 HTTP 请求**；当前接的是可见消息的 HTTP 查询，
 *      这条预热已留好接口（在 chat.receive 成功分支调用即可）。
 *
 * 后端限频：单条 30/分钟、批量 20/分钟（slowapi，按 IP）。前端固定只打 batch，
 * 并在 60ms 窗口内合并 → 正常浏览会话每分钟通常只有 1~2 次请求。
 *
 * 为什么不做 sessionStorage：
 *   request_id 明文本身不是敏感凭证，但缓存持久化会带来"换账号/软删后仍展示旧数据"
 *   的清理成本；当前内存缓存已能覆盖"同一页面反复点开"的主要场景，先保持简单。
 */

export type UsageEntryStatus = 'success' | 'empty' | 'error'

export interface UsageEntry {
  status: UsageEntryStatus
  usage: LLMUsage | null
  /** 本次查询的**发起时间**（ms）—— UI 上展示的“获取时间”就是它 */
  requestedAt: number
  /** status === 'error' 时的可读原因 */
  error?: string
  /** 被限频时建议的重试等待（ms） */
  retryAfterMs?: number
}

/** 一次批量查询：key 为明文 request_id；值 null 表示该轮没有用量记录 */
export type UsageBatchFetcher = (
  requestIds: string[],
) => Promise<Map<string, LLMUsage | null>>

interface StoredEntry {
  entry: UsageEntry
  /** 写入缓存的时间（ms），用于 TTL */
  storedAt: number
  /** 最近一次读取时间（ms），用于 LRU 淘汰 */
  lastAccess: number
}

const SUCCESS_TTL_MS = 30 * 60_000
const EMPTY_TTL_MS = 30_000
const ERROR_TTL_MS = 10_000

/** 合并窗口：60ms 内多次触发只会产生一次 batch 请求 */
const BATCH_WINDOW_MS = 60
/** 单次 batch 上限（后端 request_ids 数组无上限，但前端不应无限拼） */
const MAX_BATCH_SIZE = 20
/** 内存条目上限 */
const MAX_ENTRIES = 300

const cache = new Map<string, StoredEntry>()
const pendingById = new Map<string, Promise<UsageEntry>>()
const queue: { requestId: string; resolve: (entry: UsageEntry) => void }[] = []

let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushInProgress = false
let blockedUntil = 0
/** 登出/清空时自增；在途请求返回后若 epoch 变了则不回写缓存 */
let epoch = 0
let fetcher: UsageBatchFetcher | null = null

/** 注册实际数据源（由 utils/usageSource 注入真实批量请求） */
export function setUsageFetcher(fn: UsageBatchFetcher): void {
  fetcher = fn
}

function ttlOf(status: UsageEntryStatus): number {
  if (status === 'success') return SUCCESS_TTL_MS
  if (status === 'empty') return EMPTY_TTL_MS
  return ERROR_TTL_MS
}

function isFresh(stored: StoredEntry): boolean {
  return Date.now() - stored.storedAt < ttlOf(stored.entry.status)
}

function trimCache(): void {
  if (cache.size <= MAX_ENTRIES) return
  const candidates = [...cache.entries()]
    .filter(([requestId]) => !pendingById.has(requestId))
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
  let overflow = cache.size - MAX_ENTRIES
  for (const [requestId] of candidates) {
    if (overflow <= 0) break
    cache.delete(requestId)
    overflow -= 1
  }
}

function store(requestId: string, entry: UsageEntry): void {
  const now = Date.now()
  // 先删后插：Map 的插入顺序即 LRU 顺序
  cache.delete(requestId)
  cache.set(requestId, { entry, storedAt: now, lastAccess: now })
  trimCache()
}

function scheduleFlush(delay: number): void {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushQueue()
  }, delay)
}

async function flushQueue(): Promise<void> {
  if (flushInProgress || queue.length === 0) return
  // 同一时刻只放一个 batch 出去，避免连点导致并发打满
  flushInProgress = true
  const startEpoch = epoch
  const batch = queue.splice(0, MAX_BATCH_SIZE)
  const requestIds = batch.map(item => item.requestId)
  const requestedAt = Date.now()
  const entries = new Map<string, UsageEntry>()

  const fillError = (message: string, retryAfterMs?: number): void => {
    for (const requestId of requestIds) {
      entries.set(requestId, {
        status: 'error',
        usage: null,
        requestedAt,
        error: message,
        retryAfterMs,
      })
    }
  }

  try {
    if (!fetcher) throw new Error('用量数据源未配置')
    const waitMs = blockedUntil - requestedAt
    if (waitMs > 0) {
      // 全局退避中：不碰网络，直接给出可重试的错误条目
      fillError(`请求过于频繁，请 ${Math.ceil(waitMs / 1000)} 秒后再试`, waitMs)
    } else {
      const result = await fetcher(requestIds)
      for (const requestId of requestIds) {
        const usage = result.get(requestId) ?? null
        entries.set(
          requestId,
          usage
            ? { status: 'success', usage, requestedAt }
            : { status: 'empty', usage: null, requestedAt },
        )
      }
    }
  } catch (err) {
    if (err instanceof UsageRateLimitError) {
      blockedUntil = Date.now() + err.retryAfterMs
      fillError(
        `请求过于频繁，请 ${Math.ceil(err.retryAfterMs / 1000)} 秒后再试`,
        err.retryAfterMs,
      )
    } else {
      fillError(err instanceof Error ? err.message : '用量加载失败')
    }
  } finally {
    for (const { requestId, resolve } of batch) {
      const entry =
        entries.get(requestId) ?? {
          status: 'error' as const,
          usage: null,
          requestedAt,
          error: '用量加载失败',
        }
      // 清空/登出后返回的在途结果不回写，避免旧账号数据串进新会话
      if (epoch === startEpoch) store(requestId, entry)
      pendingById.delete(requestId)
      resolve(entry)
    }
    flushInProgress = false
    if (queue.length > 0) scheduleFlush(0)
  }
}

/**
 * 取用量：命中新鲜缓存直接返回；否则进入 60ms 合并窗口。
 * 失败不会 reject，而是返回 status='error' 的条目 —— UI 无需 try/catch。
 */
export function getUsage(
  requestId: string,
  options: { force?: boolean } = {},
): Promise<UsageEntry> {
  if (!requestId) {
    return Promise.resolve({
      status: 'empty',
      usage: null,
      requestedAt: Date.now(),
      error: '缺少 request_id',
    })
  }

  const stored = cache.get(requestId)
  if (stored) {
    stored.lastAccess = Date.now()
    if (!options.force && isFresh(stored)) return Promise.resolve(stored.entry)
  }

  const running = pendingById.get(requestId)
  if (running) return running

  const promise = new Promise<UsageEntry>(resolve => {
    queue.push({ requestId, resolve })
    scheduleFlush(BATCH_WINDOW_MS)
  })
  pendingById.set(requestId, promise)
  return promise
}

/** 同步读缓存（用于气泡打开瞬间先渲染已有数据，不闪骨架） */
export function peekUsage(requestId: string): UsageEntry | undefined {
  const stored = cache.get(requestId)
  if (!stored) return undefined
  stored.lastAccess = Date.now()
  return stored.entry
}

/**
 * 预热（可选优化）：实时 WS 响应 data.usage 已经带本轮用量时调用，省掉一次 HTTP。
 * 用法：chat.receive 成功分支里 `if (data.usage) primeUsage(msg.request_id, data.usage)`。
 * 当前接入的是历史/可见消息的 HTTP 查询，未接这条预热；接上后当轮 0 请求。
 */
export function primeUsage(requestId: string, usage: LLMUsage | null): void {
  if (!requestId || !usage) return
  store(requestId, { status: 'success', usage, requestedAt: Date.now() })
}

/** 删除消息 / 删除会话后清掉对应条目，避免已删数据仍能点开 */
export function invalidateUsage(requestIds: string[]): void {
  for (const requestId of requestIds) cache.delete(requestId)
}

/** 登出 / 会话过期 / 换钥时全清 */
export function clearUsageCache(): void {
  epoch += 1
  cache.clear()
  blockedUntil = 0
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  // 尚未发出的请求直接以错误结束：登出后不应再带着旧 token 去打后端
  const queued = queue.splice(0)
  for (const { requestId, resolve } of queued) {
    pendingById.delete(requestId)
    resolve({
      status: 'error',
      usage: null,
      requestedAt: Date.now(),
      error: '会话已结束',
    })
  }
}
