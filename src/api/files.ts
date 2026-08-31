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
