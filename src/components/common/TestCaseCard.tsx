import { memo, useMemo, useState, useEffect, useCallback } from 'react'
import { Trash2, RotateCcw, Pencil, X, Check, Save } from 'lucide-react'
import { deleteInstructionSet, restoreInstructionSet, batchSaveInstructionSets } from '@/api/instruction'
import type { TestCaseData, InstructionSetItem } from '@/types/api'
import styles from './TestCaseCard.module.css'

/* ===== 工具 ===== */

const priColors: Record<string, { bg: string; text: string }> = {
  P0: { bg: '#fef2f2', text: '#dc2626' },
  P1: { bg: '#fff7ed', text: '#ea580c' },
  P2: { bg: '#fefce8', text: '#ca8a04' },
  P3: { bg: '#f1f5f9', text: '#64748b' },
}

function getPriStyle(pri: unknown): { bg: string; text: string } {
  const key = typeof pri === 'string' ? pri.toUpperCase() : 'P3'
  return priColors[key] || { bg: '#f1f5f9', text: '#64748b' }
}

const FIELD_LABELS: [string, string][] = [
  ['title', '用例名称'],
  ['env', '测试环境'],
  ['module', '所属模块'],
  ['describe', '功能描述'],
  ['precondition', '前置条件'],
  ['desc', '操作步骤'],
  ['expect', '预期结果'],
  ['pri', '优先级'],
  ['case_type', '用例类型'],
]

function parseCases(casesJson: string): TestCaseData | null {
  try { return JSON.parse(casesJson) as TestCaseData }
  catch { return null }
}

function formatCase(c: TestCaseData): string {
  return FIELD_LABELS
    .map(([key, label]) => {
      const val = c[key]
      return val ? `${label}: ${String(val).replace(/\n/g, ' ')}` : null
    })
    .filter(Boolean)
    .join(' | ')
}

/** 多行编辑格式：每行「用例名称: xxx」 */
function formatForEdit(c: TestCaseData): string {
  return FIELD_LABELS
    .map(([key, label]) => {
      const val = c[key]
      return val ? `${label}: ${String(val).replace(/\n/g, ' ')}` : null
    })
    .filter(Boolean)
    .join('\n')
}

/** 从格式化文本反解析回 TestCaseData */
function parseFormattedText(text: string): TestCaseData | null {
  try {
    const obj: Record<string, string> = {}
    const lines = text.split(/\n| \| /)
    for (const line of lines) {
      // 支持 ASCII : 和全角 ：两种冒号
      const idx = line.indexOf('：')
      const idxAscii = idx === -1 ? line.indexOf(':') : idx
      if (idxAscii === -1) continue
      const label = line.slice(0, idxAscii).trim()
      const value = line.slice(idxAscii + 1).trim()
      for (const [key, lbl] of FIELD_LABELS) {
        if (lbl === label) { obj[key] = value; break }
      }
    }
    return obj.title ? (obj as TestCaseData) : null
  } catch { return null }
}

/* ===== 单条指令集 ===== */

interface ItemProps {
  item: InstructionSetItem
  index: number
  onDeleted?: (instructionId: string) => void
  onRestored?: (instructionId: string) => void
  /** 编辑保存（仅本地更新） */
  onEdited?: (instructionId: string, newCases: string) => void
}

const TestCaseItem = memo(function TestCaseItem({ item, index, onDeleted, onRestored, onEdited }: ItemProps) {
  const [operating, setOperating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState('')

  const tc = useMemo(() => parseCases(item.cases), [item.cases])
  const priStyle = getPriStyle(tc?.pri)

  if (!tc) return null

  // 进入编辑模式
  const handleStartEdit = () => {
    setEditText(formatForEdit(tc))
    setEditError('')
    setEditing(true)
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setEditing(false)
    setEditError('')
  }

  // 保存编辑（仅本地更新，不调 API）
  const handleSaveEdit = () => {
    const raw = editText.trim()
    const parsed = parseFormattedText(raw) || parseCases(raw)
    if (!parsed) {
      setEditError('无法解析，请保持每行「字段名: 值」的格式')
      return
    }
    onEdited?.(item.instruction_id, JSON.stringify(parsed))
    setEditing(false)
    setEditError('')
  }

  const handleDelete = async () => {
    setOperating(true)
    try {
      const res = await deleteInstructionSet(item.instruction_id)
      if (res.code === 1001) onDeleted?.(item.instruction_id)
    } catch { /* ignore */ }
    setOperating(false)
  }

  const handleRestore = async () => {
    setOperating(true)
    try {
      const res = await restoreInstructionSet(item.instruction_id)
      if (res.code === 1001) onRestored?.(item.instruction_id)
    } catch { /* ignore */ }
    setOperating(false)
  }

  const isDeleted = item.status === 'deleted'

  return (
    <div className={`${styles.item} ${isDeleted ? styles.itemDeleted : ''} ${editing ? styles.itemEditing : ''}`}>
      <div className={styles.itemHeader}>
        <span className={styles.index}>#{index + 1}</span>
        {tc.pri && (
          <span className={styles.priBadge} style={{ background: priStyle.bg, color: priStyle.text }}>
            {tc.pri}
          </span>
        )}
        {tc.case_type && (
          <span className={styles.typeBadge}>{tc.case_type}</span>
        )}
        {isDeleted && <span className={styles.deletedBadge}>已删除</span>}
        <div className={styles.headerActions}>
          {!editing && !isDeleted && (
            <button className={styles.actionBtn} onClick={handleStartEdit} title="编辑">
              <Pencil size={13} />
            </button>
          )}
          {isDeleted ? (
            <button className={styles.actionBtn} onClick={handleRestore} disabled={operating} title="恢复">
              <RotateCcw size={13} />
            </button>
          ) : !editing ? (
            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleDelete} disabled={operating} title="删除">
              <Trash2 size={13} />
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className={styles.editArea}>
          <textarea
            className={styles.editInput}
            value={editText}
            onChange={e => { setEditText(e.target.value); setEditError('') }}
            rows={6}
            autoFocus
          />
          {editError && <div className={styles.editError}>{editError}</div>}
          <div className={styles.editActions}>
            <button className={styles.cancelBtn} onClick={handleCancelEdit}>
              <X size={14} /> 取消
            </button>
            <button className={styles.saveBtn} onClick={handleSaveEdit}>
              <Check size={14} /> 应用
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.itemBody}>{formatCase(tc)}</div>
      )}
    </div>
  )
})

/* ===== 列表容器 ===== */

interface TestCaseViewProps {
  instructionSets: InstructionSetItem[]
}

export default function TestCaseView({ instructionSets }: TestCaseViewProps) {
  const [localSets, setLocalSets] = useState(instructionSets)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(true)

  useEffect(() => { setLocalSets(instructionSets) }, [instructionSets])

  const activeSets = localSets.filter(s => s.status !== 'deleted')
  const deletedSets = localSets.filter(s => s.status === 'deleted')
  const hasDeleted = deletedSets.length > 0

  const handleDeleted = useCallback((instructionId: string) => {
    setLocalSets(prev => prev.map(s =>
      s.instruction_id === instructionId ? { ...s, status: 'deleted' } : s,
    ))
  }, [])

  const handleRestored = useCallback((instructionId: string) => {
    setLocalSets(prev => prev.map(s =>
      s.instruction_id === instructionId ? { ...s, status: 'active' } : s,
    ))
  }, [])

  const handleEdited = useCallback((instructionId: string, newCases: string) => {
    setLocalSets(prev => prev.map(s =>
      s.instruction_id === instructionId ? { ...s, cases: newCases } : s,
    ))
  }, [])

  // 保存全部
  const handleSaveAll = useCallback(async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      const res = await batchSaveInstructionSets(localSets)
      if (res.code === 1001 && res.data) {
        const total = res.data['总共需要更新指令数量']
        const fail = res.data['更新失败数量']
        if (fail > 0) {
          setSaveMsg(`已保存 ${total - fail}/${total} 条，${fail} 条失败`)
          setSaveSuccess(false)
        } else {
          setSaveMsg(`全部保存成功（共 ${total} 条）`)
          setSaveSuccess(true)
        }
      } else {
        setSaveMsg(res.msg || '保存失败')
        setSaveSuccess(false)
      }
    } catch {
      setSaveMsg('网络异常')
      setSaveSuccess(false)
    }
    setSaving(false)
    setTimeout(() => { setSaveMsg(''); setSaveSuccess(true) }, 3000)
  }, [localSets])

  if (localSets.length === 0) return null

  return (
    <div className={styles.container}>
      {/* 顶部栏：统计 + 保存全部按钮 */}
      <div className={styles.topBar}>
        <div className={styles.summary}>
          共 <strong>{activeSets.length}</strong> 条测试用例
          {hasDeleted && (
            <span className={styles.deletedCount}>, {deletedSets.length} 条已删除</span>
          )}
        </div>
        <button
          className={styles.saveAllBtn}
          onClick={handleSaveAll}
          disabled={saving}
        >
          <Save size={14} />
          {saving ? '保存中...' : '保存全部'}
        </button>
      </div>

      {saveMsg && (
        <div className={`${styles.saveMsg} ${saveSuccess ? styles.saveMsgOk : styles.saveMsgErr}`}>
          {saveMsg}
        </div>
      )}

      {activeSets.map((s, i) => (
        <TestCaseItem
          key={s.instruction_id}
          item={s}
          index={i}
          onDeleted={handleDeleted}
          onRestored={handleRestored}
          onEdited={handleEdited}
        />
      ))}

      {hasDeleted && (
        <>
          <div className={styles.separator}><span>已删除</span></div>
          {deletedSets.map((s, i) => (
            <TestCaseItem
              key={s.instruction_id}
              item={s}
              index={i}
              onDeleted={handleDeleted}
              onRestored={handleRestored}
              onEdited={handleEdited}
            />
          ))}
        </>
      )}
    </div>
  )
}
