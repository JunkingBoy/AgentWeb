import { isAxiosError } from 'axios'

import client from './client'
import type { ApiResponse, LLMUsage, LLMUsageBatchItem } from '@/types/api'
import { toWireIds } from '@/utils/idCodec'
import { UsageRateLimitError } from '@/utils/usageErrors'

/*
 * 用量查询接口（真实后端，已接入 utils/usageSource.ts）
 *
 * 协议要点（见后端 services/UsageCenter.py / routers/ChatHttp.py）：
 *   · POST /chat/usage/batch  body: { request_ids: string[] }（每条为**现场重新加密**的密文）
 *   · 响应 data: [{ request_id: <回显密文>, usage: {...} | null }]，顺序与请求一致
 *   · 原样回传服务端颁发过的密文会触发防重放（错误加密值），必须走 toWireIds 重新加密
 *   · 限频：单条 30/分钟、批量 20/分钟（slowapi，按 IP）；命中返回 HTTP 429
 */

const SUCCESS_CODE = 1001
/**
 * 后端 429 由自定义 handler 返回，不带 Retry-After；
 * 批量限频为 20/分钟，默认退避 30s，避免 15s 仍在同一限频窗口内反复撞墙。
 */
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30_000

function parseRetryAfter(value: unknown): number {
  if (typeof value === 'string') {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now())
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return parseRetryAfter(value[0])
  }
  return DEFAULT_RATE_LIMIT_BACKOFF_MS
}

/**
 * 批量查用量：入参用**明文** request_id，出网前统一重新加密；
 * 返回值以明文 request_id 为 key，缺失/无权限/已删统一为 null。
 */
export async function fetchUsagesBatch(
  requestIds: string[],
): Promise<Map<string, LLMUsage | null>> {
  const encryptedIds = await toWireIds(requestIds)

  try {
    const res = await client.post<ApiResponse<LLMUsageBatchItem[]>>(
      '/chat/usage/batch',
      { request_ids: encryptedIds },
    )
    const body = res.data
    if (body.code !== SUCCESS_CODE) {
      throw new Error(body.msg || '用量加载失败')
    }

    // 后端回显的是密文，按密文映射回明文，避免依赖响应顺序
    const plainByCipher = new Map(
      encryptedIds.map((cipher, index) => [cipher, requestIds[index]]),
    )
    const result = new Map<string, LLMUsage | null>()
    for (const item of body.data ?? []) {
      const plainId = plainByCipher.get(item.request_id)
      if (plainId) result.set(plainId, item.usage)
    }
    for (const requestId of requestIds) {
      if (!result.has(requestId)) result.set(requestId, null)
    }
    return result
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 429) {
      const retryAfter: unknown = err.response.headers?.['retry-after']
      throw new UsageRateLimitError(parseRetryAfter(retryAfter))
    }
    throw err
  }
}
