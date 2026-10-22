import { fetchUsagesBatch } from '@/api/usage'
import { setUsageFetcher } from '@/utils/usageCache'

/*
 * 用量数据源注册（真实后端）
 *
 * 请求：POST /chat/usage/batch，入参为明文 request_id 数组；
 * 出网前由 api/usage.ts 统一用会话密钥重新加密（绕开服务端防重放账本）。
 *
 * 缓存/合并/限频退避全部在 utils/usageCache.ts：
 *   · 可见消息合并为一次 batch（60ms 窗口、最多 20 条）
 *   · 成功 30min / 空结果 30s / 失败 10s
 *   · 429 时全局退避，避免连点造成请求风暴
 */
setUsageFetcher(fetchUsagesBatch)
