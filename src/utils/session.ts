import { clearKeyCache } from '@/utils/keyManager'

/**
 * 会话失效统一处理(HTTP 401 / WS 鉴权失败 / AES 密钥未颁发)。
 * 清理本地凭证并跳转登录页;已在登录页时不重复跳转,避免跳转循环。
 */
export function handleSessionExpired(): void {
  if (window.location.pathname === '/login') return
  localStorage.removeItem('token')
  clearKeyCache()
  window.location.href = '/login'
}
