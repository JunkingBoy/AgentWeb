import client from './client'
import type { ApiResponse, PromptMode } from '@/types/api'
import { toWireId, toWireIds } from '@/utils/idCodec'

/** 服务端返回的单条消息结构 */
export interface ChatMessage {
  session_id: string
  role: 'user' | 'assistant'
  content: string
  request_id: string
  /** 消息创建时间（ISO 8601 字符串，后端新增字段） */
  c_time?: string
}

/*
 * id 传输规则统一收敛到 @/utils/idCodec：
 *   · 出网前由 toWireId 生成**全新**密文（新 IV），绕过服务端防重放账本；
 *   · 入参既可以是明文（store 内统一存明文），也可以是服务端颁发的密文，
 *     由 idCodec 判定后分别处理，调用方无需再关心正则与"先解密再加密"。
 */

/** 获取当前用户的所有会话 ID（按最后活跃时间倒序）—— 返回服务端颁发的密文 */
export async function fetchSessions(): Promise<ApiResponse<string[]>> {
  const res = await client.get<ApiResponse<string[]>>('/chat/sessions')
  return res.data
}

/** 获取指定会话的消息列表（按时间正序）；sessionId 支持明文或密文 */
export async function fetchSessionMessages(
  sessionId: string,
): Promise<ApiResponse<ChatMessage[]>> {
  const encryptedId = await toWireId(sessionId)
  const res = await client.get<ApiResponse<ChatMessage[]>>('/chat/messages', {
    params: { session_id: encryptedId },
  })
  return res.data
}

/** 删除指定会话（软删除） */
export async function deleteSessionAPI(
  sessionId: string,
): Promise<ApiResponse<null>> {
  const encryptedId = await toWireId(sessionId)
  const res = await client.delete<ApiResponse<null>>('/chat/session', {
    params: { session_id: encryptedId },
  })
  return res.data
}

/**
 * 批量删除多组问答（对应后端 message_delete 接口，软删除，全或无语义）
 * POST /chat/delete 请求体传参。
 * request_id 统一为明文（WS 实时会话与历史消息在前端均已规范化）→ 每条现场加密一次。
 */
export async function deleteMessagesAPI(
  requestIds: string[],
): Promise<ApiResponse<null>> {
  const encryptedIds = await toWireIds(requestIds)
  const res = await client.post<ApiResponse<null>>('/chat/delete', {
    request_ids: encryptedIds,
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
  const encryptedId = await toWireId(requestId)
  const res = await client.delete<ApiResponse<null>>('/chat/stop', {
    params: { request_id: encryptedId },
  })
  return res.data
}
