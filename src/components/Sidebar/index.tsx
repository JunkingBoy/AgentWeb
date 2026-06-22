import { Search, MessageSquare, Plus, LogOut, User, KeyRound, Trash2, Download, MoreVertical, X } from 'lucide-react'
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
import { exportInstructionSets } from '@/api/instruction'
import { toast } from 'sonner'
import { useChatStore } from '@/stores/chatStore'
import ChangeUsernameDialog from '@/components/common/ChangeUsernameDialog'
import ChangePasswordDialog from '@/components/common/ChangePasswordDialog'
import ThemeToggle from '@/components/common/ThemeToggle'
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

  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const sessions = useChatStore(s => s.sessions)
  const sessionsLoaded = useChatStore(s => s.sessionsLoaded)
  const selectedSessionId = useChatStore(s => s.selectedSessionId)
  const requestNewChat = useChatStore(s => s.requestNewChat)
  const loadSessions = useChatStore(s => s.loadSessions)
  const selectSession = useChatStore(s => s.selectSession)
  const deleteSession = useChatStore(s => s.deleteSession)

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

  const filtered = sessions.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()),
  )

  const username = user?.username || '用户'
  const avatarLetter = username.charAt(0).toUpperCase()
  const avatarColor = getAvatarColor(username)

  return (
    <aside className={styles.sidebar}>
      {/* 顶部：搜索 + 新建对话 */}
      <div className={styles.header}>
        <div
          ref={searchRef}
          className={cn(styles.searchBar, searchOpen && styles.searchOpen)}
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
                  <DropdownMenuItem
                    className={styles.menuItem}
                    onClick={async () => {
                      try {
                        await exportInstructionSets(s.id)
                        toast.success('指令集导出成功')
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : '导出失败')
                      }
                    }}
                  >
                    <Download size={14} />
                    <span>导出指令集</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(styles.menuItem, styles.menuDanger)}
                    onClick={e => { e.stopPropagation(); deleteSession(s.id) }}
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
    </aside>
  )
}
