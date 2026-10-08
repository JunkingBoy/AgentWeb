import client from './client'
import type { ApiResponse, InstructionSetItem } from '@/types/api'
import { toWireId } from '@/utils/idCodec'
import { dedupe } from '@/utils/concurrency'

/*
 * id 传输规则统一收敛到 @/utils/idCodec：
 * session_id / instruction_id / request_id 入参支持明文或服务端颁发的密文，
 * 出网前一律由 idCodec 生成**全新**密文（新 IV），以满足服务端防重放账本要求。
 */

/**
 * 获取指定会话下的指令集列表。
 * 同一会话的并发调用会被合并（侧边栏菜单展开 + 选中会话可能同时触发）。
 */
export async function fetchInstructionSets(
  sessionId: string,
): Promise<ApiResponse<InstructionSetItem[]>> {
  return dedupe(`instructions:${sessionId}`, async () => {
    const encryptedId = await toWireId(sessionId)
    const res = await client.get<ApiResponse<InstructionSetItem[]>>(
      '/instruction/list',
      { params: { session_id: encryptedId } },
    )
    return res.data
  })
}

/** 软删除单条指令集 — instruction_id 为服务端颁发的密文，出网前重新加密 */
export async function deleteInstructionSet(
  instructionId: string,
): Promise<ApiResponse<null>> {
  const encryptedId = await toWireId(instructionId)
  const res = await client.delete<ApiResponse<null>>(
    '/instruction/single',
    { params: { instruction_id: encryptedId } },
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
  // /instruction/list 返回的 id 均为服务端颁发的密文，出网前统一重新加密
  const body = await Promise.all(sets.map(async (s) => {
    const [sessionId, instructionId] = await Promise.all([
      toWireId(s.session_id),
      toWireId(s.instruction_id),
    ])
    return { session_id: sessionId, instruction_id: instructionId, cases: s.cases }
  }))
  const res = await client.put<ApiResponse<BatchSaveResult>>(
    '/instruction/batch',
    body,
  )
  return res.data
}

/** 恢复已删除的指令集 — instruction_id 为服务端颁发的密文，出网前重新加密 */
export async function restoreInstructionSet(
  instructionId: string,
): Promise<ApiResponse<null>> {
  const encryptedId = await toWireId(instructionId)
  const res = await client.patch<ApiResponse<null>>(
    '/instruction/restore',
    {},
    { params: { instruction_id: encryptedId } },
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

/**
 * 处理导出响应：HTTP 失败 / 后端 JSON 失败 → 抛 ExportError；
 * 成功（Excel Blob）→ 解析 Content-Disposition 文件名并触发浏览器下载
 */
async function resolveExportResponse(
  response: Response,
  fallbackName: string,
): Promise<void> {
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
      ?.trim() || fallbackName

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

/** 导出指令集为 Excel 文件（触发浏览器下载） */
export async function exportInstructionSets(sessionId: string): Promise<void> {
  const encryptedId = await toWireId(sessionId)
  const token = localStorage.getItem('token')

  const response = await fetch(`/instruction/export/session?session_id=${encodeURIComponent(encryptedId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  await resolveExportResponse(response, `test_cases_${Date.now()}.xlsx`)
}

/**
 * 按 request_id 导出「本次问答组」生成的测试用例 Excel（触发浏览器下载）
 * 对应后端 GET /instruction/export/request（限频 1 次 / 5 秒）
 */
export async function exportInstructionSetsByRequest(
  requestId: string,
): Promise<void> {
  const encryptedId = await toWireId(requestId)
  const token = localStorage.getItem('token')

  const response = await fetch(`/instruction/export/request?request_id=${encodeURIComponent(encryptedId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  await resolveExportResponse(response, `test_cases_request_${Date.now()}.xlsx`)
}
