import { create } from 'zustand'

interface UserInfo {
  username: string
}

interface AuthState {
  user: UserInfo | null
  loaded: boolean
  setUser: (user: UserInfo) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loaded: false,
  setUser: (user) => set({ user, loaded: true }),
  logout: () => {
    localStorage.removeItem('token')
    set({ user: null, loaded: false })
    window.location.href = '/login'
  },
}))
