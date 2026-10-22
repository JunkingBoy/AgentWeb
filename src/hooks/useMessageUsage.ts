import { useCallback, useEffect, useRef, useState } from 'react'

// 副作用导入：注册真实用量数据源（utils/usageSource → api/usage）
import '@/utils/usageSource'
import { getUsage, peekUsage, type UsageEntry } from '@/utils/usageCache'

interface UsageState {
  requestId: string
  entry?: UsageEntry
}

/**
 * 单条消息的用量读取 hook
 *
 * - 只有 `enabled`（徽标进入视口或气泡展开）为 true 时才触发查询，
 *   离屏消息不请求；
 * - 先用 useState 初始化器同步读缓存（打开瞬间不闪骨架），缓存命中时
 *   getUsage 会立刻返回同一条目，不会发请求；
 * - 缓存过期 / 手动重试时由缓存层去重 + 合并请求，UI 无感知。
 */
export function useMessageUsage(requestId: string | undefined, enabled: boolean) {
  const [state, setState] = useState<UsageState | undefined>(() =>
    requestId ? { requestId, entry: peekUsage(requestId) } : undefined,
  )
  const [refreshToken, setRefreshToken] = useState(0)
  const forceNextRef = useRef(false)

  useEffect(() => {
    if (!requestId || !enabled) return
    let alive = true
    const force = forceNextRef.current
    forceNextRef.current = false

    void getUsage(requestId, { force })
      .then(next => {
        // 组件已卸载 / 已切换消息 → 丢弃过期响应
        if (!alive) return
        setState(prev => {
          // 已有成功数据时，后台静默刷新失败不应把旧数据换成错误态
          if (
            next.status === 'error' &&
            prev &&
            prev.requestId === requestId &&
            prev.entry?.usage
          ) {
            return prev
          }
          return { requestId, entry: next }
        })
      })
      .catch(() => {
        // getUsage 内部已把失败转成 status='error'，这里只兜底极端情况
      })

    return () => {
      alive = false
    }
  }, [requestId, enabled, refreshToken])

  const retry = useCallback(() => {
    forceNextRef.current = true
    setRefreshToken(token => token + 1)
  }, [])

  // requestId 变化且组件未重挂载时，旧 state 不参与渲染
  const entry = state && state.requestId === requestId ? state.entry : undefined

  return { entry, retry }
}
