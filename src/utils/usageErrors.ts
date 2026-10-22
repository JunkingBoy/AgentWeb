/**
 * 用量接口错误类型
 *
 * 后端对 /chat/usage 与 /chat/usage/batch 做了限频（HTTP 429）。
 * 前端缓存层据此进入**全局退避**：退避窗口内不再发请求，直接返回错误条目，
 * 避免"用户连点几个图标 → 一串 429 → 每个都弹失败"的雪崩。
 */
export class UsageRateLimitError extends Error {
  /** 建议等待时长（ms），来自 Retry-After 响应头；缺省 15s */
  readonly retryAfterMs: number

  constructor(retryAfterMs: number, message = '请求过于频繁，请稍后重试') {
    super(message)
    this.name = 'UsageRateLimitError'
    this.retryAfterMs = Math.max(0, retryAfterMs)
  }
}
