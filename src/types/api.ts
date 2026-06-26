export interface ApiResponse<T = unknown> {
  code: number
  msg: string
  data: T | null
  path?: string
}

export interface PublicKeyData {
  index: number
  key: string
}

/** 提示词模式 — 对应后端 PromptSchema（仅 UI 展示信息） */
export interface PromptMode {
  name: string
  display_name: string
}

/** LLM 上下文使用情况 — 对应后端 ContextUsageTemplate */
export interface ContextUsage {
  used: number
  max: number
  ratio: number
  truncated: boolean
  dropped: number
  suggest_new: boolean
}

/** 单条测试用例（from instruction_sets.cases JSON） */
export interface TestCaseData {
  title: string
  env: string
  module: string
  describe: string
  precondition: string
  desc: string
  expect: string
  pri: string
  case_type: string
  [key: string]: unknown
}

/** 指令集条目（后端 InstructionSetResponseSchema） */
export interface InstructionSetItem {
  session_id: string      // 加密
  instruction_id: string  // 加密，用于前端删除/恢复
  cases: string           // 单条用例 JSON 字符串
  status: string          // active | deleted | draft | published
  c_time?: string
  u_time?: string
}
