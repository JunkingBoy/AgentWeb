/**
 * 请求去重 + 受控并发
 *
 * 解决的问题：
 *   1) 同一份数据被多个入口同时请求（侧边栏懒加载标题、点击会话、hover 预取、
 *      删除后重拉）会打出多个**完全相同**的 HTTP 请求；
 *   2) 历史会话列表 N 条时若用 Promise.all 全量并发，2N 个请求会占满浏览器
 *      单域 6 连接上限，导致"用户此刻真正想看的那一条"排在队尾。
 */

/** key → 进行中的 Promise（仅在进行期间存在，settle 后立刻移除，失败不缓存） */
const inflight = new Map<string, Promise<unknown>>()

/**
 * 同名请求合并：同 key 的并发调用复用同一个 Promise（后到者拿到同一份结果）。
 * key 需自带语义前缀，例如 `messages:${id}` / `sessions:list`。
 */
export function dedupe<T>(key: string, task: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key)
  if (hit) return hit as Promise<T>
  const running = task().finally(() => {
    // 只清理自己那一条，避免误删后续同 key 的新请求
    if (inflight.get(key) === running) inflight.delete(key)
  })
  inflight.set(key, running)
  return running
}

/** 当前是否有同 key 请求在途（用于跳过无谓的重复触发） */
export function isInflight(key: string): boolean {
  return inflight.has(key)
}

/**
 * 计数信号量：限制同时执行的任务数，超出部分排队等待。
 * 用于"可见性驱动"的触发源（IntersectionObserver 会一次性放出所有进入视口的行），
 * 避免首屏瞬间打出十几个并发请求把连接池占满。
 */
export function createSemaphore(limit: number) {
  let active = 0
  const waiters: (() => void)[] = []
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>(resolve => waiters.push(resolve))
    }
    active++
    try {
      return await task()
    } finally {
      active--
      waiters.shift()?.()
    }
  }
}

/**
 * 受控并发 map：最多 limit 个任务同时在途，结果顺序与入参一致。
 * 单个任务抛错不影响其它任务（该位置结果为 null，由调用方按需过滤）。
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null)
  if (items.length === 0) return results
  const size = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = await worker(items[index], index)
      } catch {
        results[index] = null
      }
    }
  })

  await Promise.all(runners)
  return results
}
