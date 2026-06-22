import { useState, useEffect } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import Sidebar from '@/components/Sidebar'
import { useAuthStore } from '@/stores/authStore'
import { fetchUserInfo } from '@/api/user'
import { useIsMobile } from '@/hooks/use-mobile'
import SidebarContext from '@/contexts/SidebarContext'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'

export default function Layout() {
  const navigate = useNavigate()
  const setUser = useAuthStore(s => s.setUser)
  const loaded = useAuthStore(s => s.loaded)
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

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
    <SidebarContext.Provider value={{ isOpen: sidebarOpen, setIsOpen: setSidebarOpen, isMobile, collapsed, setCollapsed }}>
      <div className="flex h-screen" style={{ background: 'var(--color-bg-secondary)' }}>
        {/* 桌面端：侧边栏（折叠时宽度过渡动画） */}
        {!isMobile && (
          <div className={cn('sidebar-collapse-wrap', collapsed && 'sidebar-collapsed')}>
            <Sidebar />
          </div>
        )}

        {/* 移动端：侧边栏通过 Sheet 抽屉展示 */}
        {isMobile && (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="p-0 w-[280px]">
              <Sidebar />
            </SheetContent>
          </Sheet>
        )}

        {/* 主内容区域 */}
        <main className="flex-1 flex flex-col min-w-0">
          <Outlet />
        </main>
      </div>
    </SidebarContext.Provider>
  )
}
