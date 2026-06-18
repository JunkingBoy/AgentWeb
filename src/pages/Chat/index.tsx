import { useState, useRef, useEffect, useCallback, memo } from 'react'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWebSocket, type WsMessage, type WsStatus } from '@/hooks/useWebSocket'
import { useChatStore } from '@/stores/chatStore'
import { deleteMessageAPI, stopStreamAPI } from '@/api/chat'
import { exportInstructionSets } from '@/api/instruction'
import { toast } from 'sonner'
import type { ContextUsage, InstructionSetItem } from '@/types/api'
import ModeSelector from '@/components/common/ModeSelector'
import TestCaseView from '@/components/common/TestCaseCard'
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
  onCopy: (text: string, id: string) => void
  onDeleteMessage: (requestId: string) => void
}

const MessageList = memo(function MessageList({
  messages,
  copiedId,
  onCopy,
  onDeleteMessage,
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

    const bubble = (
      <div key={msg.id} className={styles.messageGroup}>
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
              {msg.role === 'user' && msg.requestId && (
                <button
                  className={styles.messageActionBtn}
                  onClick={() => onDeleteMessage(msg.requestId!)}
                  title="删除"
                  style={{ color: '#94a3b8' }}
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
  const [contextBanner, setContextBanner] = useState<{ type: 'high_water' | 'suggest_new'; usage: ContextUsage } | null>(null)
  const currentRequestIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [wsReady, setWsReady] = useState(false)

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
      const sessionSets = instructionSetsBySession[selectedSessionId]
      const mapped: DisplayMessage[] = historyMessages.map((m, i) => ({
        id: `hist_${selectedSessionId.slice(0, 8)}_${i}`,
        role: m.role === 'assistant' ? 'agent' : 'user',
        content: m.content,
        timestamp: new Date(m.c_time!),
        requestId: m.request_id,
        // 内容匹配测试用例格式且有指令集数据 → 关联渲染
        isTestResult: !!(sessionSets && m.role === 'assistant' && m.content.trim().startsWith('[')),
        instructionSets: sessionSets,
      }))
      setMessages(mapped)
      clearThinking()
      setShowThinking(false)
      setSessionId(selectedSessionId)
      setIsTyping(false)
    }
  }, [selectedSessionId, historyMessages, setSessionId, clearThinking])

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
    } catch {
      console.warn('[Chat] 停止生成请求失败')
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

  // 按 request_id 删除一组问答（同步移除用户+AI 消息）
  const handleDeleteMessage = useCallback(
    async (requestId: string) => {
      setMessages(prev => prev.filter(m => m.requestId !== requestId))
      useChatStore.getState().deleteMessage(requestId)
      try {
        await deleteMessageAPI(requestId)
      } catch {
        console.warn('[Chat] 删除消息失败')
      }
    },
    [],
  )

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
          />

          {/* 导出指令集 */}
          <button
            className={cn(styles.exportBtn, (!sessionId || !instructionSetsBySession[sessionId]?.length) && styles.exportBtnDisabled)}
            onClick={async () => {
              if (!sessionId) return
              try {
                await exportInstructionSets(sessionId)
                toast.success('指令集导出成功')
              } catch (e) {
                toast.error(e instanceof Error ? e.message : '导出失败')
              }
            }}
            title="导出当前会话的指令集为 Excel"
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
      {showPingInfo && (
        <div className={styles.pingPanel}>
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
      )}

      {/* ===== 内容区域 ===== */}
      {isWelcome ? (
        <div className={styles.welcome}>
          <div className={styles.welcomeIcon}>
            <Sparkles size={28} color="#6366f1" />
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
      ) : (
        <div className={styles.messages}>
          <MessageList
            messages={messages}
            copiedId={copiedId}
            onCopy={handleCopy}
            onDeleteMessage={handleDeleteMessage}
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
    </div>
  )
}
