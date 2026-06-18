import client from './client'
import type { ApiResponse, PublicKeyData } from '@/types/api'

/** 获取 AES 加密密钥 */
export async function fetchPublicKey(): Promise<ApiResponse<PublicKeyData>> {
  const res = await client.get<ApiResponse<PublicKeyData>>('/key/public')
  return res.data
}
