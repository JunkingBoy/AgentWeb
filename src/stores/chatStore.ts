import { create } from 'zustand'
import { fetchSessions, fetchSessionMessages, deleteSessionAPI, fetchModes, type ChatMessage } from '@/api/chat'
import { fetchInstructionSets } from '@/api/instruction'
import { toPlainId, toPlainIdSafe } from '@/utils/idCodec'
import { dedupe, mapLimit, createSemaphore } from '@/utils/concurrency'
import type { ContextUsage, PromptMode, InstructionSetItem } from '@/types/api'

/*
 * 会话数据的缓存/加载策略（纯前端优化，协议与后端接口均未改动）
 *
 * · store 内一律保存**明文 id**：WS 业务层的 session_id 后端按明文直接查库，
 *   若把 /chat/sessions 下发的密文当会话键发出去，历史上下文会丢失、并多出一个新会话。
 *   密文化只在 HTTP 出网那一刻由 @/utils/idCodec 完成。
 * · 会话列表 = 1 个请求（/chat/sessions）；标题按**可见性**懒加载，不再登录后 2N 并发扇出。
 * · 消息按会话缓存（sessionCache），点击侧边栏命中缓存立即渲染 + 后台静默重校验，
 *   同一会话的并发请求由 dedupe 合并。
 * · 指令集不再随列表预取，改为"选中会话"或"展开菜单"时按需拉取。
 */

export interface SessionInfo {
  /** 明文 session_id（后端 uuid4().hex） */
  id: string
  /** 首条用户消息截取（前 60 字符），未知时为空串 */
  title: string
  /** 标题是否已就绪（含"已确认为空会话"），用于区分"未加载"与"空标题" */
  titleLoaded: boolean
}

/** 单个会话的消息缓存条目 */
export interface SessionMessageCache {
  /** 已规范化为明文 id 的消息列表 */
  messages: ChatMessage[]
  /** 写入时间戳（ms），用于 stale-while-revalidate 判断 */
  fetchedAt: number
}

/** 缓存新鲜期：在此窗口内重复进入同一会话不再发请求（后台重校验也可跳过） */
const CACHE_FRESH_MS = 30_000
/** 标题懒加载并发上限：避免滚动时瞬间打出十几个 /chat/messages */
const TITLE_CONCURRENCY = 4
/** 全量补标题（搜索场景）并发上限 */
const TITLE_ALL_CONCURRENCY = 5
/** 消息缓存最多保留的会话数（按 fetchedAt 近远淘汰），避免长会话列表下内存无界增长 */
const SESSION_CACHE_LIMIT = 8

/**
 * 裁剪会话消息缓存：保留最近使用的 SESSION_CACHE_LIMIT 个会话，keepId 强制保留。
 * 只影响内存驻留，任何被淘汰的会话再次进入时会照常重新拉取。
 */
function trimSessionCache(
  cache: Record<string, SessionMessageCache>,
  keepId?: string,
): Record<string, SessionMessageCache> {
  const keys = Object.keys(cache)
  if (keys.length <= SESSION_CACHE_LIMIT) return cache
  const keep = new Set(
    keys
      .sort((a, b) => (cache[b]?.fetchedAt ?? 0) - (cache[a]?.fetchedAt ?? 0))
      .slice(0, SESSION_CACHE_LIMIT),
  )
  if (keepId) keep.add(keepId)
  const next: Record<string, SessionMessageCache> = {}
  for (const key of keys) if (keep.has(key)) next[key] = cache[key]
  return next
}

/** 标题懒加载信号量：IntersectionObserver 可能一次放出多行，靠它把并发压在 TITLE_CONCURRENCY */
const titleSemaphore = createSemaphore(TITLE_CONCURRENCY)

interface ChatState {
  sessionId: string | null
  newChatFlag: number
  sessions: SessionInfo[]
  sessionsLoaded: boolean
  /** 当前选中的历史会话（明文 id） */
  selectedSessionId: string | null
  /** 当前选中会话的消息镜像（供 Chat 页渲染） */
  historyMessages: ChatMessage[]
  loadingHistory: boolean
  /** 会话消息缓存：key = 明文 session_id */
  sessionCache: Record<string, SessionMessageCache>
  thinkingContent: string
  isThinking: boolean
  contextUsage: ContextUsage | null
  modes: PromptMode[]
  modesLoaded: boolean
  currentMode: string
  /** 按会话 ID 存储指令集（key = 明文 session_id） */
  instructionSetsBySession: Record<string, InstructionSetItem[]>
  /** 指令集拉取中标记（key = 明文 session_id） */
  instructionLoading: Record<string, boolean>

  requestNewChat: () => void
  setSessionId: (id: string) => void
  /** 本地乐观插入/更新一条会话（新会话建立后立即出现在侧边栏，无需重拉列表） */
  upsertLocalSession: (id: string, title?: string) => void
  /** 拉取会话 id 列表（1 个请求）；pinId 用于服务端尚未返回该新会话时保留本地乐观行 */
  refreshSessionIds: (pinId?: string) => Promise<void>
  loadSessions: () => Promise<void>
  /** 懒加载单个会话标题（同时把消息写入缓存） */
  ensureSessionTitle: (sessionId: string) => Promise<void>
  /** 全量补标题（搜索时使用），受控并发 */
  ensureAllTitles: () => Promise<void>
  /** 拉取指定会话消息：dedupe + 写缓存 + 回填标题 + 同步镜像 */
  syncSessionMessages: (sessionId: string) => Promise<void>
  /** 强制重校验（删除等改动服务端数据后调用） */
  revalidateSession: (sessionId: string) => Promise<void>
  selectSession: (sessionId: string) => Promise<void>
  clearSelection: () => void
  deleteSession: (sessionId: string) => Promise<void>
  deleteMessage: (requestId: string) => void
  /** 按需拉取某会话的指令集（菜单展开 / 选中会话时） */
  ensureInstructionSets: (sessionId: string) => Promise<void>
  setThinkingChunk: (chunk: string) => void
  clearThinking: () => void
  setContextUsage: (usage: ContextUsage) => void
  clearContextUsage: () => void
  loadModes: () => Promise<void>
  setCurrentMode: (mode: string) => void
  /** 保存某会话的指令集 */
  setInstructionSets: (sessionId: string, sets: InstructionSetItem[]) => void
}

/** 从消息列表中提取标题（第一条用户消息的前 60 字符） */
function extractTitle(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user')
  if (!first) return ''
  const raw = first.content.trim()
  return raw.length > 60 ? raw.slice(0, 60) + '…' : raw
}

/** 明文标题截断（新会话乐观插入用，与 extractTitle 规则保持一致） */
export function truncateTitle(text: string): string {
  const raw = text.trim()
  return raw.length > 60 ? raw.slice(0, 60) + '…' : raw
}

/**
 * 历史消息 id 规范化：session_id / request_id 统一还原为明文后入缓存。
 * 这样 WS 续聊、批量删除、按 request 导出三条链路都拿到明文，出网时再由 idCodec 加密。
 * 单条解密失败不阻断整批（toPlainIdSafe 原样返回）。
 */
async function normalizeMessages(raw: ChatMessage[]): Promise<ChatMessage[]> {
  return Promise.all(
    raw.map(async m => ({
      ...m,
      session_id: await toPlainIdSafe(m.session_id),
      request_id: await toPlainIdSafe(m.request_id),
    })),
  )
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  newChatFlag: 0,
  sessions: [],
  sessionsLoaded: false,
  selectedSessionId: null,
  historyMessages: [],
  loadingHistory: false,
  sessionCache: {},
  thinkingContent: '',
  isThinking: false,
  contextUsage: null,
  modes: [],
  modesLoaded: false,
  currentMode: 'default',
  instructionSetsBySession: {},
  instructionLoading: {},

  /* ===== 新建会话 ===== */

  requestNewChat: () => {
    set(s => ({
      newChatFlag: s.newChatFlag + 1,
      selectedSessionId: null,
      historyMessages: [],
      loadingHistory: false,
    }))
  },
  setSessionId: (id) => set({ sessionId: id }),

  /* ===== 会话列表 ===== */

  upsertLocalSession: (id, title = '') => {
    if (!id) return
    set(s => {
      const exists = s.sessions.find(x => x.id === id)
      if (exists) {
        // 已有标题则不覆盖；否则用新拿到的标题补齐（不改变列表顺序）
        if (exists.title || !title) return s
        return {
          sessions: s.sessions.map(x => (x.id === id ? { ...x, title, titleLoaded: true } : x)),
        }
      }
      // 新会话置顶（与后端"按最近活动倒序"一致）
      return { sessions: [{ id, title, titleLoaded: !!title }, ...s.sessions] }
    })
  },

  refreshSessionIds: async (pinId) => {
    try {
      const res = await dedupe('sessions:list', () => fetchSessions())
      if (res.code !== 1001 || !res.data) {
        set({ sessionsLoaded: true })
        return
      }
      // 服务端下发的是密文 id → 还原明文（带缓存），才能与本地会话身份对齐
      const plainIds = (await Promise.all(
        res.data.map(id => toPlainId(id).catch(() => null)),
      )).filter((id): id is string => !!id)

      // 服务端还没把刚创建的会话吐出来时，保留本地乐观行，避免列表里突然消失
      const ordered = pinId && !plainIds.includes(pinId) ? [pinId, ...plainIds] : plainIds

      set(s => {
        const prevById = new Map(s.sessions.map(item => [item.id, item]))
        return {
          sessions: ordered.map(id => prevById.get(id) ?? { id, title: '', titleLoaded: false }),
          sessionsLoaded: true,
        }
      })
    } catch {
      console.warn('[chatStore] 加载会话列表失败')
      set({ sessionsLoaded: true })
    }
  },

  /**
   * 登录后首屏调用：只打 1 个 /chat/sessions 请求即渲染列表，
   * 标题交给 Sidebar 的可见性观察按需补（不再 2N 扇出）。
   */
  loadSessions: async () => {
    await useChatStore.getState().refreshSessionIds()
  },

  ensureSessionTitle: async (sessionId) => {
    const target = useChatStore.getState().sessions.find(s => s.id === sessionId)
    if (!target || target.titleLoaded) return
    try {
      // 信号量限流：一次滚出多行时不会同时打出一堆 /chat/messages
      await titleSemaphore(() => useChatStore.getState().syncSessionMessages(sessionId))
    } catch {
      // 失败保持骨架（不写入 titleLoaded），滚出再滚回视口或点击该行都会自动重试
      console.warn('[chatStore] 加载会话标题失败', sessionId)
    }
  },

  ensureAllTitles: async () => {
    const pending = useChatStore.getState().sessions.filter(s => !s.titleLoaded)
    if (pending.length === 0) return
    await mapLimit(pending, TITLE_ALL_CONCURRENCY, async item => {
      await useChatStore.getState().syncSessionMessages(item.id)
    })
  },

  syncSessionMessages: async (sessionId) => {
    // 同一会话的并发请求（懒加载标题 / 点击 / 重校验）合并为一个
    await dedupe(`messages:${sessionId}`, async () => {
      const res = await fetchSessionMessages(sessionId)
      // 业务失败（会话不存在/被删等）不写缓存：否则会把"空结果"当成成功缓存 30s
      if (res.code !== 1001) throw new Error(res.msg || '会话消息加载失败')
      const messages = await normalizeMessages(res.data ?? [])
      const title = extractTitle(messages)
      set(s => ({
        sessionCache: trimSessionCache(
          { ...s.sessionCache, [sessionId]: { messages, fetchedAt: Date.now() } },
          sessionId,
        ),
        sessions: s.sessions.map(x =>
          x.id === sessionId ? { ...x, title, titleLoaded: true } : x,
        ),
        // 仅当该会话仍是当前选中项时才同步镜像，避免切换后旧响应覆盖新会话内容
        ...(s.selectedSessionId === sessionId ? { historyMessages: messages } : {}),
      }))
    })
  },

  revalidateSession: async (sessionId) => {
    await useChatStore.getState().syncSessionMessages(sessionId)
  },

  /* ===== 历史会话 ===== */

  selectSession: async (sessionId) => {
    const st = useChatStore.getState()
    if (st.selectedSessionId === sessionId) return

    const cached = st.sessionCache[sessionId]
    // 缓存命中 → 立即渲染（不空屏）；未命中 → 清空并进入加载态
    set({
      selectedSessionId: sessionId,
      historyMessages: cached?.messages ?? [],
      loadingHistory: !cached,
    })

    // 指令集与消息并行按需拉取：test 模式消息需要指令集才能渲染成用例卡片
    void useChatStore.getState().ensureInstructionSets(sessionId)

    const fresh = cached ? Date.now() - cached.fetchedAt < CACHE_FRESH_MS : false
    if (fresh) return

    try {
      await useChatStore.getState().syncSessionMessages(sessionId)
    } catch {
      // 拉取失败：保留缓存内容（若有），不打断当前界面
    } finally {
      if (useChatStore.getState().selectedSessionId === sessionId) {
        set({ loadingHistory: false })
      }
    }
  },

  clearSelection: () => set({ selectedSessionId: null, historyMessages: [], loadingHistory: false }),

  /* ===== 删除会话 ===== */

  deleteSession: async (sessionId) => {
    try {
      const res = await deleteSessionAPI(sessionId)
      if (res.code === 1001) {
        const prevSelected = useChatStore.getState().selectedSessionId
        set(s => {
          const nextCache = { ...s.sessionCache }
          delete nextCache[sessionId]
          const nextSets = { ...s.instructionSetsBySession }
          delete nextSets[sessionId]
          return {
            sessions: s.sessions.filter(x => x.id !== sessionId),
            selectedSessionId: s.selectedSessionId === sessionId ? null : s.selectedSessionId,
            historyMessages: s.selectedSessionId === sessionId ? [] : s.historyMessages,
            sessionCache: nextCache,
            instructionSetsBySession: nextSets,
          }
        })
        // 删除的是当前查看的会话 → 自动进入新对话
        if (prevSelected === sessionId) {
          useChatStore.getState().requestNewChat()
        }
      }
    } catch {
      console.warn('[chatStore] 删除会话失败')
    }
  },

  deleteMessage: (requestId) =>
    set(s => {
      const drop = (list: ChatMessage[]) => list.filter(m => m.request_id !== requestId)
      // 同步清理缓存，避免短时间内切回该会话时又看到已删除的消息
      const nextCache: Record<string, SessionMessageCache> = {}
      let cacheChanged = false
      for (const [key, entry] of Object.entries(s.sessionCache)) {
        if (entry.messages.some(m => m.request_id === requestId)) {
          nextCache[key] = { ...entry, messages: drop(entry.messages) }
          cacheChanged = true
        } else {
          nextCache[key] = entry
        }
      }
      return {
        historyMessages: drop(s.historyMessages),
        ...(cacheChanged ? { sessionCache: trimSessionCache(nextCache, s.selectedSessionId ?? undefined) } : {}),
      }
    }),

  /* ===== 指令集（按需拉取） ===== */

  ensureInstructionSets: async (sessionId) => {
    if (!sessionId) return
    const st = useChatStore.getState()
    // 已确认过（含"确认为空"）或正在拉取 → 跳过
    if (st.instructionSetsBySession[sessionId] || st.instructionLoading[sessionId]) return
    set(s => ({ instructionLoading: { ...s.instructionLoading, [sessionId]: true } }))
    try {
      const res = await fetchInstructionSets(sessionId)
      const sets = res.code === 1001 && res.data ? res.data : []
      set(s => ({
        instructionSetsBySession: { ...s.instructionSetsBySession, [sessionId]: sets },
        instructionLoading: { ...s.instructionLoading, [sessionId]: false },
      }))
    } catch {
      // 失败不写入空数组（保持"未知"），下次仍可重试
      set(s => ({ instructionLoading: { ...s.instructionLoading, [sessionId]: false } }))
    }
  },

  /* ===== 思考过程 ===== */

  setThinkingChunk: (chunk: string) =>
    set(s => ({
      thinkingContent: s.thinkingContent + chunk,
      isThinking: true,
    })),

  clearThinking: () => set({ thinkingContent: '', isThinking: false }),

  setContextUsage: (usage) => set({ contextUsage: usage }),
  clearContextUsage: () => set({ contextUsage: null }),

  /* ===== 模式列表 ===== */

  loadModes: async () => {
    try {
      const res = await dedupe('prompts:modes', () => fetchModes())
      if (res.code === 1001 && res.data) {
        set({ modes: res.data, modesLoaded: true })
      }
    } catch {
      console.warn('[chatStore] 加载模式列表失败')
    }
  },

  setCurrentMode: (mode) => set({ currentMode: mode }),

  /* ===== 指令集（WS 推送覆盖） ===== */

  setInstructionSets: (sessionId, sets) => set(s => ({
    instructionSetsBySession: { ...s.instructionSetsBySession, [sessionId]: sets },
  })),
}))
