import client from './client'
import type { ApiResponse, InstructionSetItem } from '@/types/api'
import { encrypt, decrypt } from '@/utils/crypto'
import { getAesKey } from '@/utils/keyManager'

/**
 * 先解密再重新加密（/chat/sessions 返回的 session_id 已是加密值）
 */
async function decryptThenEncrypt(value: string): Promise<string> {
  const key = await getAesKey()
  const plaintext = await decrypt(value, key)
  return encrypt(plaintext, key)
}

/**
 * 统一加密：原始 UUID（来自 WS）→ 直接 AES 加密；
 * 已加密值（来自 HTTP /chat/sessions）→ 解密后重新加密。
 * 适用于 session_id / instruction_id 需要经 HTTP 接口传递的场景。
 */
async function ensureEncrypted(value: string): Promise<string> {
  if (/^[0-9a-f]{32}$/i.test(value)) {
    const key = await getAesKey()
    return encrypt(value, key)
  }
  return decryptThenEncrypt(value)
}

/** 获取指定会话下的指令集列表 */
export async function fetchInstructionSets(
  sessionId: string,
): Promise<ApiResponse<InstructionSetItem[]>> {
  const encryptedId = await decryptThenEncrypt(sessionId)
  const res = await client.get<ApiResponse<InstructionSetItem[]>>(
    '/instruction/list',
    { params: { session_id: encryptedId } },
  )
  return res.data
}

/** 软删除单条指令集 — instruction_id 后端返回已是加密值，直接透传 */
export async function deleteInstructionSet(
  instructionId: string,
): Promise<ApiResponse<null>> {
  const res = await client.delete<ApiResponse<null>>(
    '/instruction/single',
    { params: { instruction_id: instructionId } },
  )
  return res.data
}

/** 批量保存结果 */
export interface BatchSaveResult {
  '总共需要更新指令数量': number
  '更新失败数量': number
}

/** 批量保存指令集（编辑后的全部数据一次性提交） */
export async function batchSaveInstructionSets(
  sets: InstructionSetItem[],
): Promise<ApiResponse<BatchSaveResult>> {
  // session_id / instruction_id 来自 WS 或 HTTP 均为原始 UUID，调 HTTP 接口需要 AES 加密
  const key = await getAesKey()
  const body = await Promise.all(sets.map(async (s) => ({
    session_id: await encrypt(s.session_id, key),
    instruction_id: await encrypt(s.instruction_id, key),
    cases: s.cases,
  })))
  const res = await client.put<ApiResponse<BatchSaveResult>>(
    '/instruction/batch',
    body,
  )
  return res.data
}

/** 恢复已删除的指令集 — instruction_id 后端返回已是加密值，直接透传 */
export async function restoreInstructionSet(
  instructionId: string,
): Promise<ApiResponse<null>> {
  const res = await client.patch<ApiResponse<null>>(
    '/instruction/restore',
    {},
    { params: { instruction_id: instructionId } },
  )
  return res.data
}

/** 导出专用错误，携带后端返回的 code，便于 UI 层按错误码区分处理 */
export class ExportError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = 'ExportError'
  }
}

/** 导出指令集为 Excel 文件（触发浏览器下载） */
export async function exportInstructionSets(sessionId: string): Promise<void> {
  const encryptedId = await ensureEncrypted(sessionId)
  const token = localStorage.getItem('token')

  const response = await fetch(`/instruction/export?session_id=${encodeURIComponent(encryptedId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ code: 0, msg: '导出请求失败' }))
    throw new ExportError(err.code || 0, err.msg || '导出失败')
  }

  // 后端失败时返回 JSON，成功时返回 Excel 文件
  const contentType = response.headers.get('Content-Type') || ''
  if (contentType.includes('json')) {
    const err = await response.json()
    throw new ExportError(err.code || 0, err.msg || '导出失败')
  }

  // 从 Content-Disposition 解析文件名
  const disposition = response.headers.get('Content-Disposition') || ''
  const filename =
    disposition
      .split(';')
      .find(p => p.trim().startsWith('filename='))
      ?.split('=')
      .slice(1)
      .join('=')
      ?.replace(/["']/g, '')
      ?.trim() || `test_cases_${Date.now()}.xlsx`

  // 触发下载
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
