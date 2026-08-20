import { create } from 'zustand'
import { logoutUser } from '@/api/user'
import { clearKeyCache } from '@/utils/keyManager'

interface UserInfo {
  username: string
}

interface AuthState {
  user: UserInfo | null
  loaded: boolean
  setUser: (user: UserInfo) => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loaded: false,
  setUser: (user) => set({ user, loaded: true }),
  logout: async () => {
    try {
      // 通知服务端登出（尽力而为：后端响应恒为成功；加 3s 超时避免服务不可用时阻塞本地登出）
      await Promise.race([
        logoutUser(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('登出接口超时')), 3000),
        ),
      ])
    } catch {
      // 登出接口失败/超时 → 不阻塞本地登出
    } finally {
      localStorage.removeItem('token')
      clearKeyCache()
      set({ user: null, loaded: false })
      window.location.href = '/login'
    }
  },
}))
