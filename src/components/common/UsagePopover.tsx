import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, Database, RefreshCw } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { useMessageUsage } from '@/hooks/useMessageUsage'
import type { LLMUsage } from '@/types/api'
import styles from './UsagePopover.module.css'

interface UsagePopoverProps {
  /** 明文 request_id（store / 消息列表已规范化） */
  requestId: string
}

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US')

/** 15.3M / 1.9M / 950K —— 参考图里的紧凑写法 */
const COMPACT_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const FINISH_REASON_LABEL: Record<string, string> = {
  stop: '正常结束',
  length: '达到长度上限',
  content_filter: '内容过滤',
  tool_calls: '工具调用',
  insufficient_system_resource: '系统资源不足',
  aborted: '已中断',
}

/** 数字 → 千分位；null / 非法值 → “—”（绝不能显示成 0） */
function formatCount(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : NUMBER_FORMATTER.format(value)
}

/** 数字 → “15.3M”；null → null（由调用方决定显示 --） */
function formatCompactCount(value: number | null): string | null {
  return value == null || !Number.isFinite(value) ? null : COMPACT_FORMATTER.format(value)
}

/** 数字 → “1,234 tok” */
function formatTokens(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : `${NUMBER_FORMATTER.format(value)} tok`
}

/** 比例 → “98.4%”（整数不补 .0） */
function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded.toFixed(1).replace(/\.0$/, '')}%`
}

function finishReasonLabel(reason: string): string {
  return FINISH_REASON_LABEL[reason] ?? reason
}

/** prompt_tokens 缺失时用 命中+未命中 还原；两者缺一则为 null */
function resolvePromptTotal(usage: LLMUsage): number | null {
  if (usage.prompt_tokens != null) return usage.prompt_tokens
  if (usage.prompt_cache_hit_tokens != null && usage.prompt_cache_miss_tokens != null) {
    return usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens
  }
  return null
}

/** 总计缺失时用 输入+输出 还原；任一缺失则为 null */
function resolveTotal(usage: LLMUsage): number | null {
  if (usage.total_tokens != null) return usage.total_tokens
  const promptTotal = resolvePromptTotal(usage)
  if (promptTotal != null && usage.completion_tokens != null) {
    return promptTotal + usage.completion_tokens
  }
  return null
}

/** 获取时间（接口请求时间）：只展示时分秒，完整日期放 title */
function formatFetchedAt(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatFetchedAtFull(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

interface UsageRow {
  label: string
  value: string
  title?: string
  mono?: boolean
}

function buildRows(usage: LLMUsage): UsageRow[] {
  const promptTotal = resolvePromptTotal(usage)
  const hitRate =
    promptTotal != null && promptTotal > 0 && usage.prompt_cache_hit_tokens != null
      ? (usage.prompt_cache_hit_tokens / promptTotal) * 100
      : null

  const rows: UsageRow[] = [
    {
      label: '提供方 / 模型',
      value: usage.model || '—',
      title: usage.model || undefined,
      mono: true,
    },
    { label: '缓存命中', value: hitRate == null ? '—' : formatPercent(hitRate) },
    { label: '未缓存输入', value: formatTokens(usage.prompt_cache_miss_tokens) },
    { label: '缓存读取', value: formatTokens(usage.prompt_cache_hit_tokens) },
    { label: '输出', value: formatTokens(usage.completion_tokens) },
  ]

  // 思维链仅在确有消耗时出现（后端定义：含在 completion_tokens 内）
  if (usage.reasoning_tokens != null && usage.reasoning_tokens > 0) {
    rows.push({ label: '思维链', value: formatTokens(usage.reasoning_tokens) })
  }
  if (usage.finish_reason) {
    rows.push({ label: '结束原因', value: finishReasonLabel(usage.finish_reason) })
  }
  return rows
}

function UsageRows({ usage }: { usage: LLMUsage }) {
  return (
    <div className={styles.rows}>
      {buildRows(usage).map(row => (
        <div className={styles.row} key={row.label}>
          <span className={styles.label}>{row.label}</span>
          <span
            className={cn(styles.value, row.mono && styles.valueMono)}
            title={row.title}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function LoadingRows() {
  const widths = [86, 54, 74, 62, 40]
  return (
    <div className={styles.rows} aria-busy="true" aria-label="用量加载中">
      {widths.map((width, index) => (
        <div className={styles.row} key={index}>
          <span className={cn(styles.skeleton, styles.skeletonLabel)} />
          <span className={cn(styles.skeleton, styles.skeletonValue)} style={{ width }} />
        </div>
      ))}
    </div>
  )
}

function EmptyBody({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.stateBody}>
      <span className={styles.stateIcon}>
        <Database size={17} />
      </span>
      <span className={styles.stateTitle}>暂无用量数据</span>
      <p className={styles.stateDesc}>
        本轮未返回 usage 明细，可能已取消生成或服务端未记录用量。
      </p>
      <button type="button" className={styles.textBtn} onClick={onRetry}>
        <RefreshCw size={11} />
        重新获取
      </button>
    </div>
  )
}

function ErrorBody({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className={styles.stateBody}>
      <span className={cn(styles.stateIcon, styles.stateIconError)}>
        <CircleAlert size={17} />
      </span>
      <span className={styles.stateTitle}>用量加载失败</span>
      <p className={styles.stateDesc}>{message || '请检查网络后重试。'}</p>
      <button type="button" className={styles.textBtn} onClick={onRetry}>
        <RefreshCw size={11} />
        重试
      </button>
    </div>
  )
}

/**
 * 单条 AI 回复的 token 用量徽标 + 明细气泡
 *
 * 位置：消息操作区，紧挨在删除图标之前。
 * 触发按钮本身就是参考图里的「🗄 用量 15.3M tok」胶囊，未拿到用量时显示「用量 --」。
 * 数据：POST /chat/usage/batch（经 utils/usageCache 合并/缓存/限频退避）；
 *       只有当徽标进入视口或气泡被点开时才查询，离屏消息零请求。
 */
export default function UsagePopover({ requestId }: UsagePopoverProps) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const chipRef = useRef<HTMLButtonElement>(null)

  // 可见性驱动：滚动到附近才查，避免打开长会话时为几十条离屏消息发请求
  useEffect(() => {
    if (visible) return
    const node = chipRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  const { entry, retry } = useMessageUsage(requestId, open || visible)

  const usage = entry?.status === 'success' ? entry.usage : null
  const total = usage ? resolveTotal(usage) : null
  const compactTotal = formatCompactCount(total)
  const triggerTitle =
    total != null
      ? `本轮用量 ${formatCount(total)} tok，点击查看明细`
      : '查看本轮 token 用量'

  let body: ReactNode
  if (!entry) {
    body = <LoadingRows />
  } else if (entry.status === 'error') {
    body = <ErrorBody message={entry.error} onRetry={retry} />
  } else if (!entry.usage) {
    body = <EmptyBody onRetry={retry} />
  } else {
    body = <UsageRows usage={entry.usage} />
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={chipRef}
          type="button"
          className={styles.chip}
          title={triggerTitle}
          aria-label={triggerTitle}
        >
          <Database size={12} className={styles.chipIcon} />
          <span className={styles.chipLabel}>用量</span>
          <span className={cn(styles.chipValue, compactTotal == null && styles.chipEmpty)}>
            {compactTotal ?? '--'}
          </span>
          {compactTotal != null && <span className={styles.chipUnit}>tok</span>}
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className={styles.popover}
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={10}
        >
          <div className={styles.header}>
            <span className={styles.title}>
              <Database size={14} className={styles.titleIcon} />
              本轮用量
            </span>
            <span className={styles.total}>
              {entry === undefined ? (
                <span className={cn(styles.skeleton, styles.skeletonTotal)} />
              ) : total != null ? (
                <>
                  {formatCount(total)}
                  <span className={styles.unit}>tok</span>
                </>
              ) : (
                '—'
              )}
            </span>
          </div>

          <div className={styles.rule} />

          {body}

          <div className={styles.footer}>
            <span className={styles.footerLabel}>获取时间</span>
            <span
              className={styles.footerValue}
              title={entry ? formatFetchedAtFull(entry.requestedAt) : undefined}
            >
              {entry ? formatFetchedAt(entry.requestedAt) : '—'}
            </span>
          </div>

          <PopoverPrimitive.Arrow className={styles.arrow} width={12} height={6} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
