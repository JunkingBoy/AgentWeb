import client from './client'
import type { ApiResponse, FileUploadBatchResponse } from '@/types/api'
import { encrypt, decrypt } from '@/utils/crypto'
import { getAesKey } from '@/utils/keyManager'

/**
 * 上传文件（POST /files/upload）
 *
 * - multipart/form-data，字段名固定 `files`（当前后端业务上限 1 个文件）
 * - 鉴权：Authorization: Bearer <JWT> 由 client 拦截器自动注入
 * - ⚠️ 必须把 Content-Type 置空：client 实例默认 `application/json`，若保留，
 *   axios 的 transformRequest 会把 FormData JSON 序列化（文件丢失），后端报
 *   `1002 缺少必要字段`。置空后 FormData 原样发送，浏览器自动生成 multipart boundary
 * - 业务失败（如类型/大小超限）后端也返回 HTTP 200，通过 res.code !== 1001 + res.msg 判断
 * - ⚠️ **上传期门禁（EMF/WMF）**：后端在落盘**之前**会跑一次解析门禁（docx 扫包内
 *   word/media/，md 扫矢量图引用与内联 base64）。命中 → 整批 `fail(原因)`：不落文件、
 *   不写 meta、不记账、**不颁发 file_id**，且立即 return；故失败时 data 恒为 null，
 *   前端无需再调 /files/cancel（此时没有任何服务端残留可清理）。
 *   拒收文案见 res.msg，已由后端写成用户可读的处置建议（含"[涉及: 图片名]"后缀）。
 * - 响应 files[].file_id 为**加密密文**：发给 chat.send 前须经 decryptFileId 还原明文，
 *   调 /files/cancel 前须重新加密（两条路径用途不同，见各自注释）
 */
export async function uploadFile(
  file: File,
): Promise<ApiResponse<FileUploadBatchResponse>> {
  const formData = new FormData()
  formData.append('files', file)
  const res = await client.post<ApiResponse<FileUploadBatchResponse>>(
    '/files/upload',
    formData,
    {
      headers: { 'Content-Type': undefined },
    },
  )
  return res.data
}

/** 明文 file_id 形态：64 位小写 hex（sha256 内容哈希），与后端 _is_valid_file_id 校验一致 */
const FILE_ID_PLAIN_RE = /^[0-9a-f]{64}$/

/**
 * 上传响应下发的加密 file_id → 明文 file_id（64 位小写 hex）
 *
 * ⚠️ chat.send 的 file_ids 字段要求**明文**（后端 StandardChatEventTemplate.file_ids
 *    校验 64 位小写 hex），不可把上传响应的密文直接透传。
 * - 与 /files/cancel 的重加密路径用途不同：cancel 要的是「新 IV 的新密文」绕过账本，
 *   而 chat.send 走 WS 业务层、整个 data 已由 send() 统一加密，内部字段保持明文即可。
 * - 明文非法（解密失败 / 非 64 位 hex）时返回 undefined，由调用方降级为纯文本提问。
 */
export async function decryptFileId(
  encryptedFileId: string,
): Promise<string | undefined> {
  const key = await getAesKey()
  try {
    const plaintext = await decrypt(encryptedFileId, key)
    return FILE_ID_PLAIN_RE.test(plaintext) ? plaintext : undefined
  } catch {
    return undefined
  }
}

/**
 * 取消上传（POST /files/cancel）
 *
 * - 请求体 `{"file_ids": [重加密file_id, ...]}`，file_id 为上传响应下发的加密值
 * - ⚠️ 防重放：后端对上传响应下发的密文在颁发时记账（replay_ledger），
 *   原样回传会被判重放整批拒绝。前端必须用会话密钥解密拿到明文 file_id 后
 *   重新加密（新 IV → 新密文，不在账本中）再提交——与 session_id / request_id 同模式
 * - 批量 + 全或无语义：任一密文解密失败 / 判重放 / 文件不存在 → 整批拒绝、零删除
 */
export async function cancelUploads(
  fileIds: string[],
): Promise<ApiResponse<null>> {
  const key = await getAesKey()
  // 防重放：不透传服务端颁发密文，先解密再重加密
  const reEncrypted = await Promise.all(
    fileIds.map(async id => {
      const plaintext = await decrypt(id, key)
      return encrypt(plaintext, key)
    }),
  )
  const res = await client.post<ApiResponse<null>>('/files/cancel', {
    file_ids: reEncrypted,
  })
  return res.data
}
