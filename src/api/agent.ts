import client from './client'
import type { ApiResponse, PublicKeyData } from '@/types/api'

/**
 * 获取 RSA 公钥（登录参数加密用）
 * /key/public 现返回 { index, key, fingerprint }：
 *   key = base64(PEM 在 index 处插入 16 个随机填充字符)
 *   fingerprint = sha256(公钥 DER / SubjectPublicKeyInfo) 的完整 64 位 hex
 *   同一把公钥恒定（与 PEM 换行、填充位置无关），仅换钥时变化
 */
export async function fetchRsaPublicKey(): Promise<ApiResponse<PublicKeyData>> {
  const res = await client.get<ApiResponse<PublicKeyData>>('/key/public')
  return res.data
}
