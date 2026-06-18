import { useEffect, useRef, useState, useCallback } from 'react'
import { decrypt } from '@/utils/crypto'
import { getAesKey } from '@/utils/keyManager'

/* ===== 类型定义 ===== */

export type StreamStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** 传输层协议 — 与后端 ClientServerTransportProtocol 一致 */
interface StreamTransportProtocol {
  status: number
  message: string
  timestamp: number
}

export interface StreamThinkingEvent {
  request_id: string
  event: 'chat.thinking'
  code: number
  msg: string | null
  data: { content: string } | null
  timestamp: number
}

/* ===== Hook ===== */

const RECONNECT_DELAY = 3000

export function useStreamConnection() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  /** AES 密钥缓存 (与 useWebSocket 共用同一密钥, 各自独立引用) */
  const keyRef = useRef<CryptoKey | null>(null)

  const [status, setStatus] = useState<StreamStatus>('disconnected')

  const onThinkingCallbacksRef = useRef<((chunk: string) => void)[]>([])

  /** 注册 thinking 回调 — 每收到一个 chunk 文本即调用 */
  const onThinking = useCallback((cb: (chunk: string) => void) => {
    onThinkingCallbacksRef.current.push(cb)
    return () => {
      onThinkingCallbacksRef.current = onThinkingCallbacksRef.current.filter(
        c => c !== cb,
      )
    }
  }, [])

  /** 建立连接 */
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const token = localStorage.getItem('token')
    if (!token) {
      console.warn('[StreamWS] 未找到认证令牌，跳过流连接')
      return
    }

    // 连接前确保 AES 密钥可用（与主 WS 共用密钥体系）
    try {
      keyRef.current = await getAesKey()
    } catch (e) {
      console.error('[StreamWS] 获取加密密钥失败:', e)
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase =
      import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`
    const url = `${wsBase}/ws/stream?token=${encodeURIComponent(token)}`

    console.log('[StreamWS] 正在连接:', url.replace(token, '***'))
    setStatus('connecting')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      console.log('[StreamWS] 连接成功')
      setStatus('connected')
    }

    ws.onmessage = async (event: MessageEvent) => {
      if (!mountedRef.current) return
      try {
        // 1. 解析传输层协议
        const transport: StreamTransportProtocol = JSON.parse(event.data)

        // 2. 传输层异常兜底
        if (transport.status !== 3001) {
          console.warn(
            '[StreamWS] 传输层异常 status=%d message=%s',
            transport.status,
            transport.message,
          )
          return
        }

        // 3. 解密业务数据
        const key = keyRef.current
        if (!key) {
          console.error('[StreamWS] 解密密钥不可用')
          return
        }

        const decrypted = await decrypt(transport.message, key)
        const parsed: StreamThinkingEvent = JSON.parse(decrypted)

        // 4. 过滤 chat.thinking 事件
        if (
          parsed.event === 'chat.thinking' &&
          parsed.code === 3001 &&
          parsed.data?.content
        ) {
          onThinkingCallbacksRef.current.forEach(cb => {
            try {
              cb(parsed.data!.content)
            } catch (e) {
              console.error('[StreamWS] thinking callback error:', e)
            }
          })
        }
      } catch {
        // 非 JSON 或无效事件，忽略
      }
    }

    ws.onerror = () => {
      if (!mountedRef.current) return
      console.error('[StreamWS] 连接错误')
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      console.log('[StreamWS] 连接已关闭')
      setStatus('disconnected')

      // 自动重连
      if (mountedRef.current) {
        setStatus('reconnecting')
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect()
        }, RECONNECT_DELAY)
      }
    }
  }, [])

  /** 断开连接 */
  const disconnect = useCallback(() => {
    mountedRef.current = false

    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onerror = null
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }

    setStatus('disconnected')
  }, [])

  /** 自动连接 & 清理 */
  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    status,
    onThinking,
    connect,
    disconnect,
  }
}
