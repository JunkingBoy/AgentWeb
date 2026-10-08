import { Search, MessageSquare, Plus, LogOut, User, KeyRound, Trash2, Download, MoreVertical, X, PanelLeftClose } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
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
import { exportInstructionSets, ExportError } from '@/api/instruction'
import { toast } from 'sonner'
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
import { getAvatarColor } from '@/lib/avatar'

/** 取第一条消息的前 60 字符，无内容时显示占位 */
function displayTitle(title: string): string {
  return title || '新对话'
}

/**
 * 行是否落在"预判范围"内（与观察器 rootMargin: 200px 语义保持一致）。
 * 行位于 .list 滚动容器内，而该容器本身贴在视口上，故直接用 viewport 坐标比较。
 */
function isInPrefetchRange(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  return rect.top < viewportHeight + 200 && rect.bottom > -200
}

export default function Sidebar() {
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showUsername, setShowUsername] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [deletingSession, setDeletingSession] = useState<string | null>(null)

  const { setCollapsed, searchTrigger } = useSidebarContext()
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const sessions = useChatStore(s => s.sessions)
  const sessionsLoaded = useChatStore(s => s.sessionsLoaded)
  const sessionsError = useChatStore(s => s.sessionsError)
  const refreshSessionIds = useChatStore(s => s.refreshSessionIds)
  const selectedSessionId = useChatStore(s => s.selectedSessionId)
  const requestNewChat = useChatStore(s => s.requestNewChat)
  const loadSessions = useChatStore(s => s.loadSessions)
  const selectSession = useChatStore(s => s.selectSession)
  const deleteSession = useChatStore(s => s.deleteSession)
  const ensureSessionTitle = useChatStore(s => s.ensureSessionTitle)
  const ensureAllTitles = useChatStore(s => s.ensureAllTitles)
  const ensureInstructionSets = useChatStore(s => s.ensureInstructionSets)
  const instructionSetsBySession = useChatStore(s => s.instructionSetsBySession)
  const instructionLoading = useChatStore(s => s.instructionLoading)

  // 挂载时加载会话列表（仅 1 个 /chat/sessions 请求，标题交给可见性观察按需补）
  useEffect(() => {
    if (!sessionsLoaded) loadSessions()
  }, [sessionsLoaded, loadSessions])

  /* ===== 标题懒加载：只对进入视口的会话行请求 /chat/messages ===== */
  const listRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  // 用 ref 持有回调，保证观察器只创建一次（不随 store 引用变化重建）
  const ensureTitleRef = useRef(ensureSessionTitle)
  useEffect(() => {
    ensureTitleRef.current = ensureSessionTitle
  }, [ensureSessionTitle])

  /**
   * 接管当前渲染出的所有会话行：范围内立即补标题，并全部交给观察器（滚动交给它）。
   *
   * 这里**不做"是否已观察"标记**——IntersectionObserver.observe 对已观察元素是 no-op，
   * 幂等调用才扛得住：StrictMode 挂载→清理→重挂、移动端抽屉重开、列表增删。
   * （原实现用 ref 回调 + data 标记只注册一次，观察器在 StrictMode 清理时被 disconnect 后
   *   就再也没人接管这些行，导致标题永远停留在骨架、侧边栏看起来没有记录。）
   */
  const syncObservedRows = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const io = observerRef.current
    list.querySelectorAll<HTMLElement>('[data-session-id]').forEach(el => {
      if (isInPrefetchRange(el)) {
        const id = el.dataset.sessionId
        if (id) ensureTitleRef.current(id)
      }
      io?.observe(el)
    })
  }, [])

  useEffect(() => {
    // 无 IntersectionObserver 的环境（极老浏览器）→ 直接全量补标题兜底
    if (typeof IntersectionObserver === 'undefined') {
      void ensureAllTitles()
      return
    }
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = (entry.target as HTMLElement).dataset.sessionId
          // 保持观察：标题已加载时该调用会立即早退（零成本），
          // 加载失败时滚出再滚回即可自动重试
          if (id) ensureTitleRef.current(id)
        }
      },
      // 提前 200px 预判，滚动到位置时标题通常已就绪
      { root: null, rootMargin: '200px 0px', threshold: 0 },
    )
    observerRef.current = io
    // 首帧不依赖观察器的初始回调，直接按几何位置补一次，避免"等不到回调"的假空列表
    syncObservedRows()
    return () => {
      io.disconnect()
      observerRef.current = null
    }
  }, [syncObservedRows, ensureAllTitles])

  // 列表变化（新会话乐观插入 / 删除 / 刷新）后接管新出现的行
  useEffect(() => {
    syncObservedRows()
  }, [sessions, syncObservedRows])

  /** 搜索依赖全部标题 → 输入搜索词时全量补标题（受控并发；已加载的会早退） */
  const allTitlesRequestedRef = useRef(false)
  useEffect(() => {
    if (!search) {
      // 清空搜索后复位，下一次搜索可再次补全（期间新出现的会话）
      allTitlesRequestedRef.current = false
      return
    }
    if (allTitlesRequestedRef.current) return
    allTitlesRequestedRef.current = true
    ensureAllTitles()
  }, [search, ensureAllTitles])

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

  /** 搜索态下仍有标题在加载 → 提示"搜索中"，避免结果看起来是空的 */
  const searchPending = !!search && sessions.some(s => !s.titleLoaded)

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
      <div className={styles.list} ref={listRef}>
        {!sessionsLoaded ? (
          <p className={styles.empty}>加载中...</p>
        ) : sessionsError ? (
          <div className={styles.empty}>
            <p>{sessionsError}</p>
            <button className={styles.retryBtn} onClick={() => refreshSessionIds()}>
              重新加载
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className={styles.empty}>
            {search ? (searchPending ? '搜索中...' : '无匹配结果') : '暂无对话记录'}
          </p>
        ) : (
          filtered.map(s => {
            const sets = instructionSetsBySession[s.id]
            const setsLoading = !!instructionLoading[s.id]
            // 已确认无指令集才禁用导出；未知/加载中保持可点，失败时由导出接口给出后端文案
            const exportDisabled = !setsLoading && sets !== undefined && sets.length === 0
            return (
            <div
              key={s.id}
              data-session-id={s.id}
              className={cn(styles.item, selectedSessionId === s.id && styles.itemActive)}
              onClick={() => selectSession(s.id)}
            >
              <MessageSquare size={15} className={styles.itemIcon} />
              <div className={styles.itemContent}>
                {s.titleLoaded ? (
                  <span className={styles.itemTitle}>{displayTitle(s.title)}</span>
                ) : (
                  <span className={styles.itemTitleSkeleton} aria-hidden="true" />
                )}
              </div>
              <DropdownMenu
                onOpenChange={open => {
                  // 菜单展开时才拉取该会话的指令集（登录后不再为每个会话预取）
                  if (open) ensureInstructionSets(s.id)
                }}
              >
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
                  {exportDisabled ? (
                    <div
                      className={cn(styles.menuItem, styles.menuItemDisabled)}
                      onClick={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                    >
                      <Download size={14} />
                      <span>导出指令集</span>
                    </div>
                  ) : (
                    <DropdownMenuItem
                      className={styles.menuItem}
                      onClick={async () => {
                        try {
                          await exportInstructionSets(s.id)
                          toast.success('导出成功，文件已开始下载')
                        } catch (e) {
                          toast.error(e instanceof ExportError ? e.message : '网络异常，导出失败')
                        }
                      }}
                    >
                      <Download size={14} />
                      <span>导出指令集</span>
                    </DropdownMenuItem>
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
            )
          })
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
