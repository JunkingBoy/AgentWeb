import { Trash2, X } from 'lucide-react'
import styles from './BatchDeleteBar.module.css'

interface Props {
  /** 已选中的对话组数量 */
  count: number
  onDelete: () => void
  onCancel: () => void
  deleting?: boolean
}

/**
 * 批量删除浮动操作栏 — 当选中 ≥1 组问答时浮在消息区底部
 * 点击「删除」仅触发确认弹窗，真正的删除在二次确认后执行
 */
export default function BatchDeleteBar({ count, onDelete, onCancel, deleting }: Props) {
  return (
    <div className={styles.bar}>
      <span className={styles.count}>
        已选择 <strong>{count}</strong> 组对话
      </span>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onCancel}
          disabled={deleting}
        >
          <X size={14} />
          取消
        </button>
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={onDelete}
          disabled={deleting || count === 0}
        >
          <Trash2 size={14} />
          {deleting ? '删除中...' : '删除'}
        </button>
      </div>
    </div>
  )
}
