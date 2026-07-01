import client from './client'
import type { ApiResponse, PromptMode } from '@/types/api'
import { encrypt, decrypt } from '@/utils/crypto'
import { getAesKey } from '@/utils/keyManager'

/** 服务端返回的单条消息结构 */
export interface ChatMessage {
  session_id: string
  role: 'user' | 'assistant'
  content: string
  request_id: string
  /** 消息创建时间（ISO 8601 字符串，后端新增字段） */
  c_time?: string
}

/**
 * 加密 session_id 供 HTTP API 使用
 * 后端 ChatHistoryQuery 要求 session_id 为 AES 加密后的 base64 字符串（长度 36-256）
 * 复用 WebSocket 传输层的 AES 密钥（来自 /key/public），加密格式一致
 */
async function encryptSessionId(sessionId: string): Promise<string> {
  const key = await getAesKey()
  return encrypt(sessionId, key)
}

/** 获取当前用户的所有会话 ID（按最后活跃时间倒序） */
export async function fetchSessions(): Promise<ApiResponse<string[]>> {
  const res = await client.get<ApiResponse<string[]>>('/chat/sessions')
  return res.data
}

/** 获取指定会话的消息列表（按时间正序） */
export async function fetchSessionMessages(
  sessionId: string,
): Promise<ApiResponse<ChatMessage[]>> {
  // /chat/sessions 返回的 session_id 已是加密值，先解密得到明文，再重新加密后发送
  const key = await getAesKey()
  const plaintext = await decrypt(sessionId, key)
  const encryptedId = await encrypt(plaintext, key)
  const res = await client.get<ApiResponse<ChatMessage[]>>('/chat/messages', {
    params: { session_id: encryptedId },
  })
  return res.data
}

/** 删除指定会话（软删除）—— session_id 先解密再加密后发送 */
export async function deleteSessionAPI(
  sessionId: string,
): Promise<ApiResponse<null>> {
  const key = await getAesKey()
  const plaintext = await decrypt(sessionId, key)
  const encryptedId = await encrypt(plaintext, key)
  const res = await client.delete<ApiResponse<null>>('/chat/session', {
    params: { session_id: encryptedId },
  })
  return res.data
}

/** 按 request_id 删除一组问答（软删除，同时删除用户消息和 AI 回复）—— request_id 自动加密后发送 */
export async function deleteMessageAPI(
  requestId: string,
): Promise<ApiResponse<null>> {
  const encryptedId = await encryptSessionId(requestId)
  const res = await client.delete<ApiResponse<null>>('/chat/message', {
    params: { request_id: encryptedId },
  })
  return res.data
}

/** 获取所有可用的提示词模式列表（仅返回 name 和 display_name） */
export async function fetchModes(): Promise<ApiResponse<PromptMode[]>> {
  const res = await client.get<ApiResponse<PromptMode[]>>('/prompts/modes')
  return res.data
}

/** 取消指定 request_id 的流式生成 —— request_id AES 加密后作为 query 参数 */
export async function stopStreamAPI(
  requestId: string,
): Promise<ApiResponse<null>> {
  const encryptedId = await encryptSessionId(requestId)
  const res = await client.delete<ApiResponse<null>>('/chat/stop', {
    params: { request_id: encryptedId },
  })
  return res.data
}
