import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Components } from 'react-markdown'
import {
  SendHorizonal,
  Sparkles,
  Paperclip,
  Copy,
  CheckCheck,
  Bot,
  User,
  Wifi,
  WifiOff,
  RefreshCw,
  Activity,
  Trash2,
  Square,
  Download,
  Menu,
  Search,
  Plus,
  PanelLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWebSocket, type WsMessage, type WsStatus } from '@/hooks/useWebSocket'
import { useChatStore } from '@/stores/chatStore'
import { deleteMessagesAPI, fetchSessionMessages, stopStreamAPI, type ChatMessage } from '@/api/chat'
import { exportInstructionSets } from '@/api/instruction'
import { toast } from 'sonner'
import type { ContextUsage, InstructionSetItem } from '@/types/api'
import ModeSelector from '@/components/common/ModeSelector'
import TestCaseView from '@/components/common/TestCaseCard'
import NeuralNetworkIcon from '@/components/common/NeuralNetworkIcon'
import BatchDeleteBar from '@/components/common/BatchDeleteBar'
import CommonDialog from '@/components/common/CommonDialog'
import { Checkbox } from '@/components/ui/checkbox'
import { useSidebarContext } from '@/contexts/SidebarContext'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import styles from './index.module.css'

/* ===== 类型定义 ===== */

interface DisplayMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: Date
  /** 关联的请求 UUID，用于按 request_id 删除一组问答 */
  requestId?: string
  /** 是否为 test 模式输出的测试用例 */
  isTestResult?: boolean
  /** 指令集列表（test 模式独有） */
  instructionSets?: InstructionSetItem[]
}

/** 把后端历史消息（ChatMessage[]）映射为前端展示消息（DisplayMessage[]） */
function mapHistoryToDisplay(
  history: ChatMessage[],
  sessionId: string,
  instructionSetsBySession: Record<string, InstructionSetItem[]>,
): DisplayMessage[] {
  const sessionSets = instructionSetsBySession[sessionId]
  return history.map((m, i) => ({
    id: `hist_${sessionId.slice(0, 8)}_${i}`,
    role: m.role === 'assistant' ? 'agent' : 'user',
    content: m.content,
    timestamp: new Date(m.c_time!),
    requestId: m.request_id,
    // 内容匹配测试用例格式且有指令集数据 → 关联渲染
    isTestResult: !!(sessionSets && m.role === 'assistant' && m.content.trim().startsWith('[')),
    instructionSets: sessionSets,
  }))
}

/* ===== Mock 回复池（兜底，WS 不通时使用） ===== */

const fallbackResponses = [
  '这是一个很好的问题！让我来详细为你解答。\n\n首先，我们需要理解这个概念的核心含义，它涉及到多个方面的知识。',
  '好的，我来帮你分析一下。\n\n根据最佳实践，这个问题可以从以下几个角度来考虑：\n1. **技术选型**\n2. **架构设计**\n3. **性能优化**',
  '很高兴能为你解答！\n\n这是一个经典的问题，我们可以通过以下步骤来系统性地解决：\n\n```\n1. 明确需求\n2. 设计方案\n3. 实现验证\n```',
]

/* ===== 工具函数 ===== */

let msgIdCounter = 1000

function generateId(): string {
  return `msg_${++msgIdCounter}`
}

function formatTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === now.toDateString()) return `${h}:${m}`
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${h}:${m}`
  return `${date.getMonth() + 1}/${date.getDate()} ${h}:${m}`
}

function formatDateDivider(date: Date): string {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === now.toDateString()) return '今天'
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/* ===== 状态配置 ===== */

const statusConfig: Record<
  WsStatus,
  { label: string; color: string; icon: typeof Wifi }
> = {
  connecting: {
    label: '连接中...',
    color: '#f59e0b',
    icon: RefreshCw,
  },
  connected: {
    label: '已连接',
    color: '#22c55e',
    icon: Wifi,
  },
  disconnected: {
    label: '未连接',
    color: '#ef4444',
    icon: WifiOff,
  },
  reconnecting: {
    label: '重连中...',
    color: '#f97316',
    icon: RefreshCw,
  },
}

/* ===== Markdown 渲染组件（支持代码高亮） ===== */

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    const code = String(children).replace(/\n$/, '')

    if (match) {
      return (
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          PreTag="div"
          customStyle={{ margin: 0, borderRadius: 8, fontSize: 13 }}
        >
          {code}
        </SyntaxHighlighter>
      )
    }

    return (
      <code
        className={className}
        {...props}
        style={{
          background: 'rgba(0,0,0,0.06)',
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: '0.9em',
        }}
      >
        {children}
      </code>
    )
  },
  pre({ children }) {
    return <div style={{ margin: '8px 0' }}>{children}</div>
  },
}

/* ===== 建议问题 ===== */

const suggestions = [
  '如何优化 React 应用性能？',
  '什么是微服务架构？',
  'Docker 和 Kubernetes 的区别',
  '如何设计高可用系统？',
  '前端工程化最佳实践',
  'Python 异步编程入门',
]

/* ===== 消息列表子组件 (React.memo 避免流式 chunk 导致全部消息重渲染) ===== */

interface MessageListProps {
  messages: DisplayMessage[]
  copiedId: string | null
  /** 已选中的消息 id 集合（用户提问 + AI 回复都在内），用于置灰/勾选 */
  selectedMessageIds: Set<string>
  onCopy: (text: string, id: string) => void
  /** 点击删除按钮 / 取消勾选 AI 回复时，切换整组问答的选中状态 */
  onToggleGroup: (requestId: string) => void
}

const MessageList = memo(function MessageList({
  messages,
  copiedId,
  selectedMessageIds,
  onCopy,
  onToggleGroup,
}: MessageListProps) {
  const elements: React.ReactNode[] = []
  let lastDate: string | null = null

  messages.forEach((msg, idx) => {
    const dateKey = msg.timestamp.toDateString()
    if (dateKey !== lastDate) {
      lastDate = dateKey
      elements.push(
        <div key={`date_${dateKey}`} className={styles.dateDivider}>
          <span className={styles.dateDividerText}>
            {formatDateDivider(msg.timestamp)}
          </span>
        </div>,
      )
    }

    const isFirstInGroup = idx === 0 || messages[idx - 1].role !== msg.role
    const isLastInGroup =
      idx === messages.length - 1 || messages[idx + 1].role !== msg.role

    if (msg.role === 'system') {
      elements.push(
        <div key={msg.id} className={styles.systemMessage}>
          <Activity size={12} />
          <span>{msg.content}</span>
        </div>,
      )
      return
    }

    const isSelected = selectedMessageIds.has(msg.id)

    const bubble = (
      <div key={msg.id} className={styles.messageGroup} {...(msg.role === 'user' ? { 'data-qmark': msg.id } : {})}>
        <div
          className={`${styles.messageRow} ${
            msg.role === 'user'
              ? styles.messageRowUser
              : styles.messageRowAgent
          }`}
        >
          <div
            className={`${styles.messageAvatar} ${
              msg.role === 'user' ? styles.avatarUser : styles.avatarAgent
            }`}
          >
            {msg.role === 'user' ? <User size={15} /> : <Bot size={15} />}
          </div>
          <div className={styles.messageBody}>
            <div
              className={`${styles.messageBubble} ${
                msg.role === 'user'
                  ? styles.bubbleUser
                  : styles.bubbleAgent
              } ${
                isSelected
                  ? msg.role === 'user'
                    ? styles.bubbleUserSelected
                    : styles.bubbleAgentSelected
                  : ''
              }`}
            >
              {msg.role === 'user' ? (
                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
              ) : msg.isTestResult && msg.instructionSets ? (
                <TestCaseView instructionSets={msg.instructionSets} />
              ) : (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {msg.content}
                </Markdown>
              )}
            </div>
          </div>
        </div>

        {(isLastInGroup || !isFirstInGroup) && (
          <div
            className={styles.messageMeta}
            style={{
              marginLeft: msg.role === 'agent' ? 42 : 0,
              justifyContent:
                msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            {/* 选中态：用户提问勾选锁定不可取消；AI 回复勾选可取消（取消即取消整组） */}
            {isSelected && (
              <Checkbox
                checked
                disabled={msg.role === 'user'}
                onCheckedChange={
                  msg.role === 'agent'
                    ? () => onToggleGroup(msg.requestId!)
                    : undefined
                }
                className={
                  msg.role === 'user'
                    ? styles.userLockCheckbox
                    : styles.agentCheckbox
                }
                aria-label={
                  msg.role === 'user'
                    ? '已选择，不可单独取消'
                    : '取消选择该组对话'
                }
              />
            )}
            <span className={styles.messageTime}>
              {formatTime(msg.timestamp)}
            </span>
            <div className={styles.messageActions}>
              <button
                className={styles.messageActionBtn}
                onClick={() => onCopy(msg.content, msg.id)}
                title="复制"
              >
                {copiedId === msg.id ? (
                  <CheckCheck size={13} />
                ) : (
                  <Copy size={13} />
                )}
              </button>
              {/* 只有 AI 回复下放删除按钮，作为整组问答的选中入口；用户提问不提供删除入口 */}
              {msg.role === 'agent' && msg.requestId && (
                <button
                  className={styles.messageActionBtn}
                  onClick={() => onToggleGroup(msg.requestId!)}
                  title={isSelected ? '取消选择' : '删除'}
                  style={
                    isSelected
                      ? {
                          color: '#ef4444',
                          opacity: 1,
                          background: 'var(--color-error-bg)',
                        }
                      : { color: '#94a3b8' }
                  }
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
    elements.push(bubble)
  })

  return <>{elements}</>
})

/* ===== 组件 ===== */

export default function Chat() {
  const { connectionInfo, send, onMessage } = useWebSocket()
  const newChatFlag = useChatStore(s => s.newChatFlag)
  const sessionId = useChatStore(s => s.sessionId)
  const setSessionId = useChatStore(s => s.setSessionId)
  const selectedSessionId = useChatStore(s => s.selectedSessionId)
  const historyMessages = useChatStore(s => s.historyMessages)
  const thinkingContent = useChatStore(s => s.thinkingContent)
  const isThinking = useChatStore(s => s.isThinking)
  const contextUsage = useChatStore(s => s.contextUsage)
  const setThinkingChunk = useChatStore(s => s.setThinkingChunk)
  const clearThinking = useChatStore(s => s.clearThinking)
  const requestNewChat = useChatStore(s => s.requestNewChat)
  const setContextUsage = useChatStore(s => s.setContextUsage)
  const clearContextUsage = useChatStore(s => s.clearContextUsage)
  const modes = useChatStore(s => s.modes)
  const modesLoaded = useChatStore(s => s.modesLoaded)
  const currentMode = useChatStore(s => s.currentMode)
  const loadModes = useChatStore(s => s.loadModes)
  const setCurrentMode = useChatStore(s => s.setCurrentMode)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showPingInfo, setShowPingInfo] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [exportResultOpen, setExportResultOpen] = useState(false)
  const [exportResult, setExportResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  // 批量删除：选中的对话组（key = request_id）
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { isMobile: isMobileView, setIsOpen: setSidebarOpen, collapsed, setCollapsed } = useSidebarContext()
  const [contextBanner, setContextBanner] = useState<{ type: 'high_water' | 'suggest_new'; usage: ContextUsage } | null>(null)
  const currentRequestIdRef = useRef<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [wsReady, setWsReady] = useState(false)
  const [activeQIdx, setActiveQIdx] = useState(-1)
  const [hoveredQIdx, setHoveredQIdx] = useState<number | null>(null)
  const [collapsedSearch, setCollapsedSearch] = useState(false)
  const collapsedSearchRef = useRef<HTMLInputElement>(null)

  // 提取所有用户提问用于导航标记
  const questions = useMemo(() => {
    return messages.filter(m => m.role === 'user').map(m => ({ msgId: m.id, text: m.content }))
  }, [messages])

  // 按位置把「用户提问 + 紧随其后的 AI 回复」配成一组问答
  // 组 key = AI 回复的 request_id（后端按 request_id 成组删除）
  // 用户提问按位置归属 → 勾选 AI 回复时其前面的用户提问必然联动置灰，不依赖两侧 request_id 一致
  interface QaGroup {
    key: string
    userId: string | null
    userContent: string | null
    agentId: string
  }
  const qaGroups = useMemo<QaGroup[]>(() => {
    const groups: QaGroup[] = []
    let pendingUser: { id: string; content: string } | null = null
    for (const m of messages) {
      if (m.role === 'user') {
        pendingUser = { id: m.id, content: m.content }
      } else if (m.role === 'agent' && m.requestId) {
        groups.push({
          key: m.requestId,
          userId: pendingUser?.id ?? null,
          userContent: pendingUser?.content ?? null,
          agentId: m.id,
        })
        pendingUser = null
      }
    }
    return groups
  }, [messages])

  // 派生选中组 key：自动过滤已不存在的组（切换会话/删除消息后自动清理）
  const effectiveSelectedGroups = useMemo(() => {
    if (selectedGroupIds.size === 0) return selectedGroupIds
    const keys = new Set(qaGroups.map(g => g.key))
    const next = new Set<string>()
    selectedGroupIds.forEach(id => { if (keys.has(id)) next.add(id) })
    return next.size === selectedGroupIds.size ? selectedGroupIds : next
  }, [selectedGroupIds, qaGroups])

  // 选中组对应的消息 id（用户提问 + AI 回复），MessageList 据此判断置灰/勾选
  const selectedMessageIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of qaGroups) {
      if (!effectiveSelectedGroups.has(g.key)) continue
      if (g.userId) ids.add(g.userId)
      ids.add(g.agentId)
    }
    return ids
  }, [qaGroups, effectiveSelectedGroups])

  // 选中的提问内容（用于删除确认弹窗预览）
  const selectedUserQuestions = useMemo(() => {
    const list: string[] = []
    for (const g of qaGroups) {
      if (effectiveSelectedGroups.has(g.key) && g.userContent) list.push(g.userContent)
    }
    return list
  }, [qaGroups, effectiveSelectedGroups])

  // 删除确认弹窗预览：长文本 JS 截断展示"…"；对话组过多时只展示前几条 + 总数
  const deletePreview = useMemo(() => {
    const MAX_ITEMS = 4
    const MAX_CHARS = 20
    const items = selectedUserQuestions.slice(0, MAX_ITEMS).map(t =>
      t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS)}…` : t,
    )
    return { items, more: selectedUserQuestions.length - items.length }
  }, [selectedUserQuestions])

  // 切换某一组问答的选中状态（点删除按钮 / 取消勾选 AI 回复都会走到这里）
  const toggleGroup = useCallback((requestId: string) => {
    setSelectedGroupIds(prev => {
      const next = new Set(prev)
      if (next.has(requestId)) next.delete(requestId)
      else next.add(requestId)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedGroupIds(new Set()), [])

  // 滚动时更新活跃提问索引（以可视区顶部为基准）
  const handleMsgScroll = useCallback(() => {
    const el = messagesRef.current
    if (!el || !questions.length) { setActiveQIdx(-1); return }
    const markers = el.querySelectorAll('[data-qmark]')
    const scrollTop = el.scrollTop
    let closest = 0, minDist = Infinity
    questions.forEach((_, i) => {
      const child = markers[i] as HTMLElement | undefined
      if (child) {
        const dist = Math.abs(child.offsetTop - scrollTop)
        if (dist < minDist) { minDist = dist; closest = i }
      }
    })
    setActiveQIdx(closest)
  }, [questions])

  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    el.addEventListener('scroll', handleMsgScroll, { passive: true })
    handleMsgScroll()
    return () => el.removeEventListener('scroll', handleMsgScroll)
  }, [handleMsgScroll])

  // 非流式模式（如 test 模式，后端 suppress_stream=True，无 chat.thinking 推送）
  const instructionSetsBySession = useChatStore(s => s.instructionSetsBySession)
  const setInstructionSets = useChatStore(s => s.setInstructionSets)
  const isNonStreamingMode = currentMode === 'test'
  const loadingLabel = isNonStreamingMode ? '正在生成测试用例...' : '正在思考...'

  const { status, pingHealthy, lastPingAt, lastPongAt, pingCount, pongCount, latency } =
    connectionInfo
  const isConnected = status === 'connected' && pingHealthy
  const isDegraded = status === 'connected' && !pingHealthy
  const isWelcome = messages.length === 0 && !isTyping

  // 连接状态变化时更新
  useEffect(() => {
    setWsReady(isConnected)
  }, [isConnected])

  // 页面加载时获取模式列表
  useEffect(() => {
    loadModes()
  }, [loadModes])

  // 注册 WS 消息回调
  useEffect(() => {
    const unsub = onMessage((msg: WsMessage) => {
      // 流式思考过程 — 逐 chunk 追加 (通过主 WS 通道推送)
      if (msg.event === 'chat.thinking' && msg.code === 3001) {
        const data = msg.data as { content?: string } | null
        if (data?.content) setThinkingChunk(data.content)
        return
      }

      // 聊天回复 — 成功
      if (msg.event === 'chat.receive' && msg.code === 3001) {
        setIsTyping(false)
        currentRequestIdRef.current = null
        useChatStore.setState({ isThinking: false })
        const data = msg.data as {
          reply?: string
          session_id?: string
          context_usage?: ContextUsage
          instruction_sets?: InstructionSetItem[]
        } | null
        const reply = data?.reply || msg.msg || '收到空回复'
        const instructionSets = data?.instruction_sets
        // 保存服务端返回的 session_id（新建会话时后端自动生成）
        const newSessionId = data?.session_id
        if (newSessionId) setSessionId(newSessionId)
        // 保存最终的 context_usage（覆盖 chat.context_info 可能先收到的值）
        if (data?.context_usage) setContextUsage(data.context_usage)
        // 保存指令集到 store，供历史消息渲染使用
        if (instructionSets && instructionSets.length > 0 && newSessionId) {
          setInstructionSets(newSessionId, instructionSets)
        }
        setMessages(prev => [
          ...prev,
          {
            id: generateId(),
            role: 'agent',
            content: reply,
            timestamp: new Date(msg.timestamp),
            requestId: msg.request_id,
            isTestResult: !!(instructionSets && instructionSets.length > 0),
            instructionSets,
          },
        ])
        return
      }

      // 会话创建成功 — 保存 session_id
      if (msg.event === 'chat.started' && msg.code === 3001) {
        const sessionId = (msg.data as { session_id?: string })?.session_id
        if (sessionId) setSessionId(sessionId)
        return
      }

      // 聊天回复 — 失败
      if (msg.event === 'chat.receive' && msg.code !== 3001) {
        setIsTyping(false)
        useChatStore.setState({ isThinking: false })
        setMessages(prev => [
          ...prev,
          {
            id: generateId(),
            role: 'system',
            content: msg.msg || 'AI 回复异常',
            timestamp: new Date(msg.timestamp),
          },
        ])
        return
      }

      // 上下文水位信息 — 在流式输出前推送
      if (msg.event === 'chat.context_info' && msg.code === 3001) {
        const usage = msg.data as ContextUsage | null
        if (usage) {
          setContextUsage(usage)
          // 高水位告警
          if (usage.ratio > 0.9) {
            setContextBanner({ type: 'high_water', usage })
          }
          if (usage.suggest_new) {
            setContextBanner({ type: 'suggest_new', usage })
          }
          // 已截断 → 显示系统消息
          if (usage.truncated && usage.dropped > 0) {
            setMessages(prev => [
              ...prev,
              {
                id: generateId(),
                role: 'system',
                content: `已自动截断 ${usage.dropped} 条较早对话内容（上下文共 ${Math.round(usage.ratio * 100)}% 已使用）`,
                timestamp: new Date(msg.timestamp),
              },
            ])
          }
        }
        return
      }

      // 连接错误事件
      if (msg.event === 'conn.error') {
        setMessages(prev => [
          ...prev,
          {
            id: generateId(),
            role: 'system',
            content: msg.msg || '连接异常，请稍后重试',
            timestamp: new Date(msg.timestamp),
          },
        ])
        return
      }

      // 兜底 — 任意非成功事件显示为系统消息（便于调试）
      if (msg.code !== 3001) {
        console.warn('[Chat] 未处理的事件: event=%s code=%d msg=%s', msg.event, msg.code, msg.msg)
        // 重置流式等待状态，避免页面因等待响应而卡死（如后端校验失败时仍保持 isTyping=true）
        setIsTyping(false)
        currentRequestIdRef.current = null
        useChatStore.setState({ isThinking: false })
        setMessages(prev => [
          ...prev,
          {
            id: generateId(),
            role: 'system',
            content: `[${msg.event}] ${msg.msg || '请求异常'}`,
            timestamp: new Date(msg.timestamp),
          },
        ])
        return
      }
    })
    return unsub
  }, [onMessage])

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  // 自动调整输入框高度
  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    }
  }, [input])

  // 新建对话：清空消息 → 发送 chat.start 创建新会话
  useEffect(() => {
    if (newChatFlag > 0) {
      setMessages([])
      clearThinking()
      setShowThinking(false)
      setSessionId('')
      send('chat.start', {})
    }
  }, [newChatFlag, send, setSessionId, clearThinking])

  // 选中历史会话 → 加载消息记录
  useEffect(() => {
    if (selectedSessionId && historyMessages.length > 0) {
      setMessages(mapHistoryToDisplay(historyMessages, selectedSessionId, instructionSetsBySession))
      clearThinking()
      setShowThinking(false)
      setSessionId(selectedSessionId)
      setIsTyping(false)
    }
  }, [selectedSessionId, historyMessages, setSessionId, clearThinking, instructionSetsBySession])

  const { label, color, icon: StatusIcon } = statusConfig[status]
  const statusLabel = isDegraded ? '连接异常' : label
  const statusColor = isDegraded ? '#f97316' : color
  const StatusIconComp = isDegraded ? WifiOff : StatusIcon

  // 停止 AI 生成
  const handleStop = useCallback(async () => {
    const rid = currentRequestIdRef.current
    if (!rid) return
    try {
      await stopStreamAPI(rid)
    } catch (e) {
      console.warn('[Chat] 停止生成请求失败', e)
      const msg = e instanceof Error ? e.message : '停止生成失败'
      if (msg) toast.error(msg)
    }
  }, [])

  // 发送消息
  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || isTyping) return

    // 清空上一轮的思考过程和上下文水位
    clearThinking()
    clearContextUsage()
    setContextBanner(null)
    useChatStore.setState({ isThinking: true })
    setShowThinking(true)

    // 显示用户消息
    const userMsg: DisplayMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    if (wsReady) {
      // 通过 WebSocket 发送 — 携带 session_id 和 mode 匹配后端 StandardChatEventTemplate
      const payload: Record<string, unknown> = { message: text }
      if (sessionId) payload.session_id = sessionId
      const _mode = useChatStore.getState().currentMode
      if (_mode && _mode !== 'default') payload.mode = _mode
      // 发送并捕获返回的 request_id，关联到刚添加的用户消息
      send('chat.send', payload).then(sentMsg => {
        const rid = sentMsg?.request_id
        if (rid) {
          currentRequestIdRef.current = rid
          setMessages(prev => {
            const msgs = [...prev]
            const last = msgs[msgs.length - 1]
            if (last?.role === 'user' && !last.requestId) {
              msgs[msgs.length - 1] = { ...last, requestId: rid }
            }
            return msgs
          })
        }
      })
    } else {
      // WS 未连接，使用兜底回复
      setTimeout(() => {
        const response =
          fallbackResponses[
            Math.floor(Math.random() * fallbackResponses.length)
          ]
        setMessages(prev => [
          ...prev,
          {
            id: generateId(),
            role: 'agent',
            content: response,
            timestamp: new Date(),
          },
        ])
        setIsTyping(false)
      }, 1200 + Math.random() * 1800)
    }
  }, [input, isTyping, wsReady, send, sessionId, clearThinking])

  // 键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  // 删除成功后重新拉取当前会话消息，保证与服务端一致（历史会话 + 实时会话都适用）
  const reloadMessages = useCallback(async () => {
    const targetSession = selectedSessionId || sessionId
    if (!targetSession) return
    try {
      const res = await fetchSessionMessages(targetSession)
      if (res.code === 1001 && res.data) {
        setMessages(mapHistoryToDisplay(res.data, targetSession, instructionSetsBySession))
        useChatStore.setState({ historyMessages: res.data })
      } else if (res.code === 1001) {
        // 删除后会话已空
        setMessages([])
        useChatStore.setState({ historyMessages: [] })
      }
    } catch {
      // 拉取失败：保持当前本地状态
    }
  }, [selectedSessionId, sessionId, instructionSetsBySession])

  // 二次确认后批量删除选中的问答组（对接后端 message_delete 批量接口，全或无语义）
  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(effectiveSelectedGroups)
    if (ids.length === 0) return
    setDeleting(true)
    // 记录被移除的消息（含原位置），后端失败时回滚
    let removed: { msg: DisplayMessage; index: number }[] = []
    setMessages(prev => {
      removed = prev
        .map((m, i) => ({ msg: m, index: i }))
        .filter(({ msg }) => selectedMessageIds.has(msg.id))
      return prev.filter(m => !selectedMessageIds.has(m.id))
    })
    ids.forEach(id => useChatStore.getState().deleteMessage(id))
    setDeleteConfirmOpen(false)
    setSelectedGroupIds(new Set())

    const rollback = () => {
      setMessages(prev => {
        const next = [...prev]
        removed.forEach(({ msg, index }) => {
          next.splice(Math.min(index, next.length), 0, msg)
        })
        return next
      })
    }

    try {
      const res = await deleteMessagesAPI(ids)
      if (res.code === 1001) {
        // 删除成功 → 重新拉取消息，与服务端保持一致
        await reloadMessages()
        toast.success(`已删除 ${ids.length} 组对话`)
      } else {
        rollback()
        toast.error(res.msg || '删除失败')
      }
    } catch (e) {
      rollback()
      toast.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
    } finally {
      setDeleting(false)
    }
  }, [effectiveSelectedGroups, selectedMessageIds, reloadMessages])

  // 点击建议问题
  const handleSuggestionClick = useCallback((text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }, [])

  // 复制消息
  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  return (
    <div className={styles.container}>
      {/* ===== 头部 ===== */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {/* 侧边栏折叠时：左上工具栏 */}
          {collapsed && !isMobileView && (
            <div className={styles.collapsedTools}>
              <svg viewBox="0 0 28 28" fill="none" className={styles.collapsedIcon}>
                <defs>
                  <linearGradient id="clg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
                <circle cx="14" cy="6" r="2.8" fill="url(#clg)" />
                <circle cx="6.5" cy="21" r="2.8" fill="url(#clg)" />
                <circle cx="21.5" cy="21" r="2.8" fill="url(#clg)" />
                <line x1="14" y1="8.5" x2="6.5" y2="18.5" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="14" y1="8.5" x2="21.5" y2="18.5" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="9.3" y1="21" x2="18.7" y2="21" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
              </svg>
              <button className={styles.collapsedToolBtn} onClick={() => setCollapsed(false)} title="展开侧边栏">
                <PanelLeft size={16} />
              </button>
              {collapsedSearch ? (
                <div className={styles.collapsedSearchWrap}>
                  <input
                    ref={collapsedSearchRef}
                    className={styles.collapsedSearchInput}
                    placeholder="搜索对话记录..."
                    autoFocus
                    onBlur={() => setCollapsedSearch(false)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setCollapsedSearch(false)
                    }}
                  />
                </div>
              ) : (
                <button className={styles.collapsedToolBtn} onClick={() => { setCollapsedSearch(true); setTimeout(() => collapsedSearchRef.current?.focus(), 50) }} title="搜索对话记录">
                  <Search size={14} />
                </button>
              )}
              <button className={styles.collapsedToolBtn} onClick={requestNewChat} title="新建对话">
                <Plus size={16} />
              </button>
            </div>
          )}
          {/* 移动端汉堡按钮 */}
          <button
            className={styles.hamburgerBtn}
            onClick={() => setSidebarOpen(true)}
            title="打开侧边栏"
          >
            <Menu size={18} />
          </button>
          <div className={styles.headerInfo}>
            <div className={styles.headerTitle}>
              AI 测试助手
              {status === 'reconnecting' && (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#f97316' }}>
                  (断线重连...)
                </span>
              )}
            </div>
            <div className={styles.headerSubtitle} style={{ color }}>
              在线 · 随时为你服务
            </div>
          </div>
        </div>
        <div className={styles.headerRight}>
          {/* 连接状态 */}
          <button
            className={cn(styles.modelBadge, styles.statusBtn)}
            onClick={() => setShowPingInfo(!showPingInfo)}
            title="点击查看连接详情"
          >
            <StatusIconComp
              size={12}
              className={status === 'connecting' || status === 'reconnecting' ? styles.spin : undefined}
            />
            <span>{statusLabel}</span>
          </button>

          {/* 模式选择器 */}
          <ModeSelector
            modes={modes}
            currentMode={currentMode}
            onModeChange={setCurrentMode}
            loaded={modesLoaded}
            compact={isMobileView}
          />

          {/* 导出指令集 */}
          <button
            className={cn(styles.exportBtn, (!sessionId || !instructionSetsBySession[sessionId]?.length) && styles.exportBtnDisabled)}
            onClick={async () => {
              if (!sessionId) return
              try {
                await exportInstructionSets(sessionId)
                setExportResult({ type: 'success', message: '指令集导出成功，文件已开始下载' })
                setExportResultOpen(true)
              } catch (e) {
                setExportResult({ type: 'error', message: e instanceof Error ? e.message : '导出失败' })
                setExportResultOpen(true)
              }
            }}
            title={!sessionId || !instructionSetsBySession[sessionId]?.length ? '当前会话没有指令集数据，无法导出' : '导出当前会话的指令集为 Excel'}
          >
            <Download size={13} />
            <span>导出</span>
          </button>

          {/* 模型标识 */}
          <div className={styles.modelBadge}>
            <Sparkles size={13} />
            <span>DeepSeek V4</span>
          </div>
        </div>
      </div>

      {/* ===== Ping/Pong 详情面板 ===== */}
      <div className={cn(styles.pingPanel, showPingInfo && styles.pingPanelVisible)}>
          <div className={styles.pingPanelItem}>
            <span className={styles.pingLabel}>连接状态</span>
            <span className={styles.pingValue} style={{ color: statusColor }}>
              {statusLabel}
            </span>
          </div>
          <div className={styles.pingPanelItem}>
            <span className={styles.pingLabel}>Ping 发送</span>
            <span className={styles.pingValue}>{pingCount} 次</span>
          </div>
          <div className={styles.pingPanelItem}>
            <span className={styles.pingLabel}>Pong 接收</span>
            <span className={styles.pingValue}>{pongCount} 次</span>
          </div>
          {latency !== null && (
            <div className={styles.pingPanelItem}>
              <span className={styles.pingLabel}>网络延迟</span>
              <span
                className={styles.pingValue}
                style={{
                  color: latency < 100 ? '#22c55e' : latency < 300 ? '#f59e0b' : '#ef4444',
                }}
              >
                {latency} ms
              </span>
            </div>
          )}
          {lastPingAt && (
            <div className={styles.pingPanelItem}>
              <span className={styles.pingLabel}>上次 Ping</span>
              <span className={styles.pingValue}>
                {new Date(lastPingAt).toLocaleTimeString()}
              </span>
            </div>
          )}
          {lastPongAt && (
            <div className={styles.pingPanelItem}>
              <span className={styles.pingLabel}>上次 Pong</span>
              <span className={styles.pingValue}>
                {new Date(lastPongAt).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>

      {/* ===== 内容区域 ===== */}
      {isWelcome ? (
        <div className={styles.welcome}>
          <NeuralNetworkIcon variant="background" />
          <div className={styles.welcomeContent}>
            <div className={styles.welcomeIcon}>
              <NeuralNetworkIcon />
            </div>
            <h2 className={styles.welcomeTitle}>有什么我可以帮助你的？</h2>
            <p className={styles.welcomeDesc}>
              {isConnected
                ? '已连接到服务端，可以开始对话了！'
                : '我是 AI 测试助手，可以帮你解答技术问题、编写代码、优化架构等。'}
            </p>
            {!isConnected && (
              <p className={styles.welcomeDesc} style={{ fontSize: 12, color: '#f59e0b' }}>
                正在连接服务端... 未连接时将使用本地模式回复
              </p>
            )}
            <div className={styles.welcomeSuggestions}>
              {suggestions.map((text, i) => (
                <button
                  key={i}
                  className={styles.suggestionChip}
                  onClick={() => handleSuggestionClick(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.messagesWrap}>
          <div className={styles.messages} ref={messagesRef}>
            <MessageList
              messages={messages}
              copiedId={copiedId}
              selectedMessageIds={selectedMessageIds}
              onCopy={handleCopy}
              onToggleGroup={toggleGroup}
            />

            {/* 思考过程区域（独立渲染，仅流式 chunk 时更新，不影响已渲染消息） */}
            {(thinkingContent || isThinking) && (
              <div className={styles.thinkingSection}>
                <button
                  className={styles.thinkingToggle}
                  onClick={() => setShowThinking(v => !v)}
                >
                  <span className={styles.thinkingToggleIcon}>
                    {isThinking && !showThinking ? '💭' : '🧠'}
                  </span>
                  <span>
                    {isThinking
                      ? showThinking
                        ? '隐藏处理过程'
                        : loadingLabel
                      : showThinking
                        ? '隐藏处理过程'
                        : '查看处理过程'}
                  </span>
                  <span className={styles.thinkingToggleArrow}>
                    {showThinking ? '▲' : '▼'}
                  </span>
                </button>

                {showThinking && (
                  <div className={styles.thinkingPanel}>
                    <div className={styles.thinkingContent}>
                      {thinkingContent ? (
                        <Markdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {thinkingContent}
                        </Markdown>
                      ) : isNonStreamingMode ? (
                        <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                          正在收集结果，请稍候...
                        </p>
                      ) : null}
                    </div>
                    {isThinking && (
                      <div className={styles.thinkingStreaming}>
                        <span className={styles.thinkingDot} />
                        <span className={styles.thinkingDot} />
                        <span className={styles.thinkingDot} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Token 用量标签 */}
            {contextUsage && !isThinking && messages.length > 0 && (() => {
              const lastMsg = messages[messages.length - 1]
              if (lastMsg.role !== 'agent') return null
              return (
                <div key="token-usage" className={styles.tokenUsage}>
                  上下文长度 <strong>{contextUsage.used.toLocaleString()}</strong> / {contextUsage.max.toLocaleString()} tokens
                  {contextUsage.truncated && <span style={{ color: '#f59e0b' }}>（已截断）</span>}
                  {contextUsage.suggest_new && <span style={{ color: '#ef4444' }}>· 建议新建对话</span>}
                </div>
              )
            })()}

            {isTyping && (
              <div className={styles.typingIndicator}>
                <div className={styles.typingAvatar}>
                  <Bot size={15} color="white" />
                </div>
                <div className={styles.typingBubble}>
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 对话定位导航区（浮在消息区域右侧） */}
          <div className={styles.msgNav} onMouseLeave={() => setHoveredQIdx(null)}>
            {questions.map((q, i) => (
              <div
                key={q.msgId}
                className={`${styles.msgNavDotWrap} ${i === activeQIdx ? styles.msgNavDotActive : ''} ${hoveredQIdx === i ? styles.msgNavDotHovered : ''}`}
                onMouseEnter={() => setHoveredQIdx(i)}
                onClick={() => {
                  const target = messagesRef.current?.querySelector(`[data-qmark="${q.msgId}"]`)
                  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                <div className={styles.msgNavDot} />
                {hoveredQIdx === i && (
                  <div className={styles.msgNavPreview} title={q.text}>
                    <span className={styles.msgNavPreviewText}>{q.text}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 批量删除浮动操作栏 */}
          {effectiveSelectedGroups.size > 0 && (
            <div className={styles.batchBarWrap}>
              <BatchDeleteBar
                count={effectiveSelectedGroups.size}
                onDelete={() => setDeleteConfirmOpen(true)}
                onCancel={clearSelection}
                deleting={deleting}
              />
            </div>
          )}
        </div>
      )}

      {/* ===== 上下文水位横幅 ===== */}
      {contextBanner && (
        <div className={styles.contextBanner}>
          <span className={styles.contextBannerText}>
            {contextBanner.type === 'high_water'
              ? `上下文已使用 ${Math.round(contextBanner.usage.ratio * 100)}%（${contextBanner.usage.used.toLocaleString()} / ${contextBanner.usage.max.toLocaleString()} tokens）`
              : '当前对话上下文即将用完，建议新建对话'}
          </span>
          <button
            className={styles.contextBannerAction}
            onClick={() => {
              if (contextBanner.type === 'suggest_new') requestNewChat()
              setContextBanner(null)
            }}
          >
            {contextBanner.type === 'suggest_new' ? '新建对话' : '关闭'}
          </button>
        </div>
      )}

      {/* ===== 输入区域 ===== */}
      <div className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            className={styles.inputField}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isTyping}
          />
          <div className={styles.inputActions}>
            <button
              className={cn(styles.inputActionBtn, styles.hidden)}
              title="上传文件"
              disabled={isTyping}
            >
              <Paperclip size={17} />
            </button>
            {isTyping ? (
              <button
                className={styles.stopBtn}
                onClick={handleStop}
                title="停止生成"
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                className={styles.sendBtn}
                onClick={handleSend}
                disabled={!input.trim()}
                title="发送"
              >
                <SendHorizonal size={17} />
              </button>
            )}
          </div>
        </div>
        <div className={styles.inputHint}>
          {isTyping
            ? isNonStreamingMode
              ? '正在生成测试用例，请稍候...'
              : 'AI 正在回复...'
            : isConnected
              ? '已连接到服务端 · Enter 发送 · Shift+Enter 换行'
              : '服务端未连接 · 本地模式 · Enter 发送 · Shift+Enter 换行'}
        </div>
      </div>

      {/* 导出结果弹窗 */}
      <Dialog open={exportResultOpen} onOpenChange={setExportResultOpen}>
        <DialogContent className="w-[92%] max-w-sm rounded-2xl p-0 gap-0 border-0 ring-0 shadow-xl bg-white overflow-hidden" showCloseButton={false}>
          <div className="px-6 pt-6 pb-3">
            <DialogHeader className="p-0">
              <DialogTitle className="text-[16px] font-semibold text-slate-800">
                <span className="flex items-center gap-2">
                  {exportResult?.type === 'success' ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-red-500">✗</span>
                  )}
                  导出{exportResult?.type === 'success' ? '成功' : '失败'}
                </span>
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-1">
                {exportResult?.message}
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="px-6 py-4 flex-row justify-end gap-2.5 border-0 bg-transparent -mx-0 -mb-0 rounded-none">
            <Button
              onClick={() => setExportResultOpen(false)}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm h-9 px-4 shadow-none"
            >
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除二次确认弹窗 */}
      <CommonDialog
        open={deleteConfirmOpen}
        onOpenChange={v => { if (!deleting) setDeleteConfirmOpen(v) }}
        title="删除对话"
        description={`确定要删除选中的 ${effectiveSelectedGroups.size} 组问答吗？每组包含对应的用户提问和 AI 回复，删除后不可恢复。`}
        confirmText="删除"
        confirmVariant="danger"
        onConfirm={handleBatchDelete}
        confirmDisabled={deleting}
      >
        <div className="max-h-[180px] overflow-y-auto flex flex-col gap-1.5 pr-1">
          {deletePreview.items.map((text, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 min-w-0"
            >
              <Trash2 size={12} className="text-slate-400 shrink-0" />
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{text}</span>
            </div>
          ))}
          {deletePreview.more > 0 && (
            <div className="text-xs text-slate-400 text-center py-1">
              … 等共 {selectedUserQuestions.length} 条提问（每组包含对应的 AI 回复）
            </div>
          )}
        </div>
      </CommonDialog>
    </div>
  )
}
