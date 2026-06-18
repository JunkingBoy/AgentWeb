import { useEffect } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import Sidebar from '@/components/Sidebar'
import { useAuthStore } from '@/stores/authStore'
import { fetchUserInfo } from '@/api/user'

export default function Layout() {
  const navigate = useNavigate()
  const setUser = useAuthStore(s => s.setUser)
  const loaded = useAuthStore(s => s.loaded)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      navigate('/login', { replace: true })
      return
    }

    if (!loaded) {
      fetchUserInfo().then(res => {
        if (res.code === 1001 && res.data) {
          setUser(res.data)
        } else {
          localStorage.removeItem('token')
          navigate('/login', { replace: true })
        }
      })
    }
  }, [])

  return (
    <div className="flex h-screen" style={{ background: 'var(--color-bg-secondary)' }}>
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
