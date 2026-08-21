import client from './client'
import type { ApiResponse, PublicKeyData } from '@/types/api'

/**
 * 获取 RSA 公钥（登录参数加密用）
 * /key/public 现返回 { index, key, fingerprint }：
 *   key = base64(PEM) 随机填充 16 字符, fingerprint = sha256(PEM) 前 8 位
 */
export async function fetchRsaPublicKey(): Promise<ApiResponse<PublicKeyData>> {
  const res = await client.get<ApiResponse<PublicKeyData>>('/key/public')
  return res.data
}
