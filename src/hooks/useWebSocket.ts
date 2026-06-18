import { useEffect, useRef, useState, useCallback } from 'react'
import { encrypt, decrypt } from '@/utils/crypto'
import { getAesKey } from '@/utils/keyManager'

/* ===== 类型定义 ===== */

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

export interface WsMessage {
  request_id: string
  event: string
  code: number
  msg: string | null
  data: unknown
  timestamp: number
}

/** 传输层协议 — 后端 ClientServerTransportProtocol 的镜像 */
interface WsTransportProtocol {
  status: number
  message: string // 加密后的 base64 字符串
  timestamp: number
}

export interface WsConnectionInfo {
  status: WsStatus
  /** 心跳是否健康 — 收到合法 pong 为 true, 收到错误回复或未收到则为 false */
  pingHealthy: boolean
  lastPingAt: number | null
  lastPongAt: number | null
  pingCount: number
  pongCount: number
  error: string | null
  latency: number | null // 最近一次 ping-pong 延迟(ms)
}

/* ===== UUID 生成 ===== */

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/* ===== Hook ===== */

const PING_INTERVAL = 30000 // 30s 发送一次心跳
const RECONNECT_DELAY = 3000 // 断线重连等待时间

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const pingSentAtRef = useRef<number | null>(null)
  /** AES 密钥缓存 (与 keyManager 的缓存配合, 避免每次调用 getAesKey 的开销) */
  const keyRef = useRef<CryptoKey | null>(null)

  const [connectionInfo, setConnectionInfo] = useState<WsConnectionInfo>({
    status: 'disconnected',
    pingHealthy: false,
    lastPingAt: null,
    lastPongAt: null,
    pingCount: 0,
    pongCount: 0,
    error: null,
    latency: null,
  })

  const onMessageCallbacksRef = useRef<((msg: WsMessage) => void)[]>([])

  /** 注册消息回调 */
  const onMessage = useCallback((cb: (msg: WsMessage) => void) => {
    onMessageCallbacksRef.current.push(cb)
    return () => {
      onMessageCallbacksRef.current = onMessageCallbacksRef.current.filter(
        c => c !== cb,
      )
    }
  }, [])

  /** 更新连接信息（支持函数式更新计数器） */
  const updateInfo = useCallback(
    (patch: Partial<WsConnectionInfo> | ((prev: WsConnectionInfo) => Partial<WsConnectionInfo>)) => {
      setConnectionInfo(prev => {
        const resolved = typeof patch === 'function' ? patch(prev) : patch
        return { ...prev, ...resolved }
      })
    },
    [],
  )

  /** 发送消息 (async — 加密是异步操作) */
  const send = useCallback(
    async (event: string, data: unknown = null): Promise<WsMessage | undefined> => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        updateInfo({ error: 'WebSocket 未连接' })
        return
      }

      const key = keyRef.current
      if (!key) {
        updateInfo({ error: '加密密钥不可用' })
        return
      }

      // 1. 构建业务层协议
      const businessMsg: WsMessage = {
        request_id: generateUUID(),
        event,
        code: 3001, // StandardServerWsResultEnum.SUCCESS
        msg: null,
        data,
        timestamp: Date.now(),
      }

      // 2. 加密业务数据
      try {
        const jsonStr = JSON.stringify(businessMsg)
        const encrypted = await encrypt(jsonStr, key)

        // 3. 包裹传输层协议后发送
        const transport: WsTransportProtocol = {
          status: 3001,
          message: encrypted,
          timestamp: Date.now(),
        }
        ws.send(JSON.stringify(transport))
        return businessMsg
      } catch (e) {
        console.error('[WS] 消息加密失败:', e)
        updateInfo({ error: '消息加密失败' })
      }
    },
    [updateInfo],
  )

  /** 发送 ping — 记录发送时间用于计算延迟 */
  const sendPing = useCallback(async () => {
    const msg = await send('ping', {})
    if (msg) {
      pingSentAtRef.current = Date.now()
      updateInfo(prev => ({
        lastPingAt: Date.now(),
        pingCount: prev.pingCount + 1,
      }))
    }
  }, [send, updateInfo])

  /** 建立连接 */
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // 连接前确保 AES 密钥可用
    try {
      keyRef.current = await getAesKey()
    } catch (e) {
      console.error('[WS] 获取加密密钥失败:', e)
      updateInfo({ status: 'disconnected', error: '获取加密密钥失败' })
      return
    }

    // 从 localStorage 读取 JWT token 用于 WS 握手鉴权
    const token = localStorage.getItem('token')
    if (!token) {
      console.error('[WS] 未找到认证令牌')
      updateInfo({ status: 'disconnected', error: '未登录，无法连接' })
      return
    }

    // 构建 WS URL — 开发环境走 Vite proxy，生产环境走同源 nginx 代理
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`
    const url = `${wsBase}/ws/chat?token=${encodeURIComponent(token)}`
    console.log('[WS] 正在连接:', url.replace(token, '***'))

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      console.log('[WS] 连接成功')
      updateInfo({ status: 'connected', error: null })

      // 连接成功后立即发送 ping
      console.log('[WS] 发送首次 ping')
      sendPing()

      // 启动定时 ping
      pingTimerRef.current = setInterval(() => {
        if (mountedRef.current) sendPing()
      }, PING_INTERVAL)
    }

    ws.onmessage = async (event: MessageEvent) => {
      if (!mountedRef.current) return

      try {
        // 1. 解析传输层协议
        const transport: WsTransportProtocol = JSON.parse(event.data)

        // 2. 传输层异常兜底 — 服务端加密失败时会发送明文错误传输
        if (transport.status !== 3001) {
          console.warn(
            '[WS] 传输层异常 status=%d message=%s',
            transport.status,
            transport.message,
          )
          const errorMsg: WsMessage = {
            request_id: '00000000-0000-0000-0000-000000000000',
            event: 'conn.error',
            code: transport.status,
            msg: transport.message,
            data: null,
            timestamp: transport.timestamp,
          }
          onMessageCallbacksRef.current.forEach(cb => {
            try {
              cb(errorMsg)
            } catch (e) {
              console.error('WS message callback error:', e)
            }
          })
          return
        }

        // 3. 解密业务数据
        const key = keyRef.current
        if (!key) {
          console.error('[WS] 解密密钥不可用')
          return
        }

        const decrypted = await decrypt(transport.message, key)
        const parsed: WsMessage = JSON.parse(decrypted)

        console.log('[WS] 收到消息 event=%s code=%d', parsed.event, parsed.code)

        // 4. 处理 pong 响应 — 计算延迟, 标记心跳健康
        if (parsed.event === 'pong' && parsed.code === 3001) {
          const now = Date.now()
          const latency =
            pingSentAtRef.current !== null
              ? now - pingSentAtRef.current
              : null
          pingSentAtRef.current = null

          updateInfo(prev => ({
            lastPongAt: now,
            pongCount: prev.pongCount + 1,
            latency,
            pingHealthy: true,
            error: null,
          }))
        }

        // 5. ping 回复异常 → 心跳不健康
        if (parsed.event === 'ping' && parsed.code !== 3001) {
          pingSentAtRef.current = null
          updateInfo({ pingHealthy: false, error: parsed.msg || '心跳异常' })
        }

        // 6. 通知所有消息回调
        onMessageCallbacksRef.current.forEach(cb => {
          try {
            cb(parsed)
          } catch (e) {
            console.error('WS message callback error:', e)
          }
        })
      } catch (e) {
        console.error('[WS] 消息解密/解析失败:', e)
      }
    }

    ws.onerror = () => {
      if (!mountedRef.current) return
      console.error('[WS] 连接错误')
      updateInfo({ error: 'WebSocket 连接错误' })
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      console.log('[WS] 连接已关闭')

      // 清理 ping 定时器
      if (pingTimerRef.current !== null) {
        clearInterval(pingTimerRef.current)
        pingTimerRef.current = null
      }

      updateInfo({ status: 'disconnected' })

      // 自动重连
      if (mountedRef.current) {
        updateInfo({ status: 'reconnecting' })
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect()
        }, RECONNECT_DELAY)
      }
    }
  }, [sendPing, updateInfo])

  /** 断开连接 */
  const disconnect = useCallback(() => {
    mountedRef.current = false

    if (pingTimerRef.current !== null) {
      clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
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

    updateInfo({ status: 'disconnected' })
  }, [updateInfo])

  /** 自动连接 & 清理 */
  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    connectionInfo,
    send,
    sendPing,
    onMessage,
    connect,
    disconnect,
  }
}
