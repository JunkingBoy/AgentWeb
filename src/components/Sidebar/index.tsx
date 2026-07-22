import { Search, MessageSquare, Plus, LogOut, User, KeyRound, Trash2, Download, MoreVertical, X, PanelLeftClose } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useSidebarContext } from '@/contexts/SidebarContext'
import { exportInstructionSets } from '@/api/instruction'
import { useChatStore } from '@/stores/chatStore'
import ChangeUsernameDialog from '@/components/common/ChangeUsernameDialog'
import ChangePasswordDialog from '@/components/common/ChangePasswordDialog'
import ThemeToggle from '@/components/common/ThemeToggle'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import styles from './index.module.css'

/* 头像配色池 — 根据用户名取模确定颜色 */
const avatarColors = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

/** 取第一条消息的前 60 字符，无内容时显示占位 */
function displayTitle(title: string): string {
  return title || '新对话'
}

export default function Sidebar() {
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showUsername, setShowUsername] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [exportResultOpen, setExportResultOpen] = useState(false)
  const [exportResult, setExportResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [deletingSession, setDeletingSession] = useState<string | null>(null)

  const { setCollapsed, searchTrigger } = useSidebarContext()
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const sessions = useChatStore(s => s.sessions)
  const sessionsLoaded = useChatStore(s => s.sessionsLoaded)
  const selectedSessionId = useChatStore(s => s.selectedSessionId)
  const requestNewChat = useChatStore(s => s.requestNewChat)
  const loadSessions = useChatStore(s => s.loadSessions)
  const selectSession = useChatStore(s => s.selectSession)
  const deleteSession = useChatStore(s => s.deleteSession)
  const instructionSetsBySession = useChatStore(s => s.instructionSetsBySession)

  // 挂载时加载会话列表
  useEffect(() => {
    if (!sessionsLoaded) loadSessions()
  }, [sessionsLoaded, loadSessions])

  // 点击搜索框外部自动收起
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 外部触发搜索（折叠态点击搜索按钮 → 展开侧边栏后自动打开搜索）
  useEffect(() => {
    if (searchTrigger > 0) {
      setSearchOpen(true)
      setTimeout(() => searchRef.current?.querySelector('input')?.focus(), 350)
    }
  }, [searchTrigger])

  const filtered = sessions.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()),
  )

  const username = user?.username || '用户'
  const avatarLetter = username.charAt(0).toUpperCase()
  const avatarColor = getAvatarColor(username)

  return (
    <aside className={styles.sidebar}>
      {/* 顶部：Logo + 搜索 + 新建对话 */}
      <div className={cn(styles.header, searchOpen && styles.searchOpen)}>
        <div className={styles.headerTop}>
          <div className={styles.logo}>
            <svg viewBox="0 0 28 28" fill="none" className={styles.logoIcon}>
              <defs>
                <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
              </defs>
              <circle cx="14" cy="6" r="2.8" fill="url(#lg)" />
              <circle cx="6.5" cy="21" r="2.8" fill="url(#lg)" />
              <circle cx="21.5" cy="21" r="2.8" fill="url(#lg)" />
              <line x1="14" y1="8.5" x2="6.5" y2="18.5" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" />
              <line x1="14" y1="8.5" x2="21.5" y2="18.5" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" />
              <line x1="9.3" y1="21" x2="18.7" y2="21" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
            </svg>
            <span className={styles.logoText}>AI Test Assistant</span>
          </div>
          <div
            ref={searchRef}
            className={styles.searchBar}
        >
          <input
            type="text"
            className={styles.searchInput}
            placeholder="搜索对话记录..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            className={styles.searchBtn}
            onClick={() => setSearchOpen(!searchOpen)}
            title="搜索对话记录"
          >
            {searchOpen ? <X size={14} /> : <Search size={14} />}
          </button>
        </div>
          <button
            className={styles.collapseBtn}
            onClick={() => setCollapsed(true)}
            title="收起侧边栏"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
        <button className={styles.newBtn} onClick={requestNewChat}>
          <Plus size={16} />
          <span>新建对话</span>
        </button>
      </div>

      {/* 中间：对话列表 */}
      <div className={styles.list}>
        {!sessionsLoaded ? (
          <p className={styles.empty}>加载中...</p>
        ) : filtered.length === 0 ? (
          <p className={styles.empty}>{search ? '无匹配结果' : '暂无对话记录'}</p>
        ) : (
          filtered.map(s => (
            <div
              key={s.id}
              className={cn(styles.item, selectedSessionId === s.id && styles.itemActive)}
              onClick={() => selectSession(s.id)}
            >
              <MessageSquare size={15} className={styles.itemIcon} />
              <div className={styles.itemContent}>
                <span className={styles.itemTitle}>{displayTitle(s.title)}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={styles.itemMoreBtn}
                    onClick={e => e.stopPropagation()}
                    title="更多操作"
                  >
                    <MoreVertical size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="right" className={styles.dropMenu}>
                  {instructionSetsBySession[s.id]?.length ? (
                    <DropdownMenuItem
                      className={styles.menuItem}
                      onClick={async () => {
                        try {
                          await exportInstructionSets(s.id)
                          setExportResult({ type: 'success', message: '指令集导出成功，文件已开始下载' })
                          setExportResultOpen(true)
                        } catch (e) {
                          setExportResult({ type: 'error', message: e instanceof Error ? e.message : '导出失败' })
                          setExportResultOpen(true)
                        }
                      }}
                    >
                      <Download size={14} />
                      <span>导出指令集</span>
                    </DropdownMenuItem>
                  ) : (
                    <div
                      className={cn(styles.menuItem, styles.menuItemDisabled)}
                      onClick={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                    >
                      <Download size={14} />
                      <span>导出指令集</span>
                    </div>
                  )}
                  <DropdownMenuItem
                    className={cn(styles.menuItem, styles.menuDanger)}
                    onClick={e => { e.stopPropagation(); setDeletingSession(s.id) }}
                  >
                    <Trash2 size={14} />
                    <span>删除对话</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>

      {/* 底部：用户信息 + 主题切换 + 退出 */}
      <div className={styles.footer}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <div className={styles.footerLeft}>
              <div className={styles.avatar} style={{ background: avatarColor }}>{avatarLetter}</div>
              <div className={styles.userMeta}>
                <span className={styles.userName}>{username}</span>
                <span className={styles.userStatus}>在线</span>
              </div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className={styles.dropMenu}>
            <DropdownMenuItem className={styles.menuItem} onClick={() => { setMenuOpen(false); setShowUsername(true) }}>
              <User size={14} />
              <span>修改用户名</span>
            </DropdownMenuItem>
            <DropdownMenuItem className={styles.menuItem} onClick={() => { setMenuOpen(false); setShowPassword(true) }}>
              <KeyRound size={14} />
              <span>修改密码</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={cn(styles.menuItem, styles.menuDanger)} onClick={logout}>
              <LogOut size={14} />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
      </div>

      {/* 修改用户名弹框 */}
      <ChangeUsernameDialog open={showUsername} onOpenChange={setShowUsername} />

      {/* 修改密码弹框 */}
      <ChangePasswordDialog open={showPassword} onOpenChange={setShowPassword} />

      {/* 导出结果弹窗 */}
      <Dialog open={exportResultOpen} onOpenChange={setExportResultOpen}>
        <DialogContent className="w-[92%] max-w-sm rounded-2xl p-0 gap-0 border-0 ring-0 shadow-xl bg-white overflow-hidden" showCloseButton={false}>
          <div className="px-6 pt-6 pb-3">
            <DialogHeader className="p-0">
              <DialogTitle className="text-[16px] font-semibold text-slate-800">
                <span className="flex items-center gap-2">
                  {exportResult?.type === 'success' ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-red-500">✗</span>
                  )}
                  导出{exportResult?.type === 'success' ? '成功' : '失败'}
                </span>
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-1">
                {exportResult?.message}
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="px-6 py-4 flex-row justify-end gap-2.5 border-0 bg-transparent -mx-0 -mb-0 rounded-none">
            <Button
              onClick={() => setExportResultOpen(false)}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm h-9 px-4 shadow-none"
            >
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除会话确认弹窗 */}
      <Dialog open={!!deletingSession} onOpenChange={(open) => { if (!open) setDeletingSession(null) }}>
        <DialogContent className="w-[92%] max-w-sm rounded-2xl p-0 gap-0 border-0 ring-0 shadow-xl bg-white overflow-hidden" showCloseButton={false}>
          <div className="px-6 pt-6 pb-3">
            <DialogHeader className="p-0">
              <DialogTitle className="text-[16px] font-semibold text-slate-800">
                删除此对话？
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-3 leading-relaxed">
                删除后，这条对话记录将无法找回，其中包含的文件也将一并被删除。
                若你之前分享过对话，分享链接也将无法查看。
                <br /><br />
                确定删除此对话？
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="px-6 py-4 flex-row justify-end gap-2.5 border-0 bg-transparent -mx-0 -mb-0 rounded-none">
            <Button
              onClick={() => setDeletingSession(null)}
              className="rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-700 text-sm h-9 px-4 shadow-none"
            >
              取消
            </Button>
            <Button
              onClick={() => {
                if (deletingSession) deleteSession(deletingSession)
                setDeletingSession(null)
              }}
              className="rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm h-9 px-4 shadow-none"
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
