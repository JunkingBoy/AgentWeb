import { create } from 'zustand'
import { fetchSessions, fetchSessionMessages, deleteSessionAPI, fetchModes, type ChatMessage } from '@/api/chat'
import { fetchInstructionSets } from '@/api/instruction'
import type { ContextUsage, PromptMode, InstructionSetItem } from '@/types/api'

export interface SessionInfo {
  id: string
  /** 第一条消息的内容截取（取前 60 字符），无消息时为空 */
  title: string
}

interface ChatState {
  sessionId: string | null
  newChatFlag: number
  sessions: SessionInfo[]
  sessionsLoaded: boolean
  /** 当前选中的历史会话 ID */
  selectedSessionId: string | null
  /** 当前加载的历史消息 */
  historyMessages: ChatMessage[]
  loadingHistory: boolean
  thinkingContent: string
  isThinking: boolean
  contextUsage: ContextUsage | null
  modes: PromptMode[]
  modesLoaded: boolean
  currentMode: string
  /** 按会话 ID 存储指令集（key=session_id） */
  instructionSetsBySession: Record<string, InstructionSetItem[]>

  requestNewChat: () => void
  setSessionId: (id: string) => void
  loadSessions: () => Promise<void>
  selectSession: (sessionId: string) => Promise<void>
  clearSelection: () => void
  deleteSession: (sessionId: string) => Promise<void>
  deleteMessage: (requestId: string) => void
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

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  newChatFlag: 0,
  sessions: [],
  sessionsLoaded: false,
  selectedSessionId: null,
  historyMessages: [],
  loadingHistory: false,
  thinkingContent: '',
  isThinking: false,
  contextUsage: null,
  modes: [],
  modesLoaded: false,
  currentMode: 'default',
  instructionSetsBySession: {},

  /* ===== 新建会话 ===== */

  requestNewChat: () => {
    set(s => ({
      newChatFlag: s.newChatFlag + 1,
      selectedSessionId: null,
      historyMessages: [],
    }))
  },
  setSessionId: (id) => set({ sessionId: id }),

  /* ===== 会话列表 ===== */

  loadSessions: async () => {
    try {
      const res = await fetchSessions()
      if (res.code === 1001 && res.data) {
        // 并行取每个会话的第一条消息作为标题
        const sessions: SessionInfo[] = await Promise.all(
          res.data.map(async (id) => {
            try {
              const msgRes = await fetchSessionMessages(id)
              if (msgRes.code === 1001 && msgRes.data) {
                return { id, title: extractTitle(msgRes.data) }
              }
            } catch { /* 单个失败不影响其他 */ }
            return { id, title: '' }
          }),
        )
        set({ sessions, sessionsLoaded: true })
      }
    } catch {
      console.warn('[chatStore] 加载会话列表失败')
    }
  },

  /* ===== 历史会话 ===== */

  selectSession: async (sessionId: string) => {
    set({ selectedSessionId: sessionId, loadingHistory: true, historyMessages: [] })
    // 并行加载消息 + 指令集
    const [msgRes, insRes] = await Promise.all([
      fetchSessionMessages(sessionId),
      fetchInstructionSets(sessionId).catch(() => null),
    ])
    if (msgRes.code === 1001 && msgRes.data) {
      const updates: Partial<ChatState> = { historyMessages: msgRes.data, loadingHistory: false }
      if (insRes?.code === 1001 && insRes.data) {
        updates.instructionSetsBySession = { [sessionId]: insRes.data }
      }
      set(updates)
    } else {
      set({ loadingHistory: false })
    }
  },
  clearSelection: () => set({ selectedSessionId: null, historyMessages: [] }),

  /* ===== 删除会话 ===== */

  deleteSession: async (sessionId: string) => {
    try {
      const res = await deleteSessionAPI(sessionId)
      if (res.code === 1001) {
        set(s => ({
          sessions: s.sessions.filter(s => s.id !== sessionId),
          selectedSessionId: s.selectedSessionId === sessionId ? null : s.selectedSessionId,
          historyMessages: s.selectedSessionId === sessionId ? [] : s.historyMessages,
        }))
      }
    } catch {
      console.warn('[chatStore] 删除会话失败')
    }
  },

  deleteMessage: (requestId: string) =>
    set(s => ({
      historyMessages: s.historyMessages.filter(m => m.request_id !== requestId),
    })),

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
      const res = await fetchModes()
      if (res.code === 1001 && res.data) {
        set({ modes: res.data, modesLoaded: true })
      }
    } catch {
      console.warn('[chatStore] 加载模式列表失败')
    }
  },

  setCurrentMode: (mode) => set({ currentMode: mode }),

  /* ===== 指令集 ===== */

  setInstructionSets: (sessionId, sets) => set(s => ({
    instructionSetsBySession: { ...s.instructionSetsBySession, [sessionId]: sets },
  })),
}))
