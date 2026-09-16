import { memo } from 'react'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { getAvatarColor, getAvatarLetter } from '@/lib/avatar'
import styles from './index.module.css'

interface ChatAvatarProps {
  role: 'user' | 'agent'
  /** AI 正在生成时附加脉冲动画（如"正在输入"指示器） */
  thinking?: boolean
  className?: string
}

/** 品牌神经网络小图标 — 与 Logo / 欢迎页 NeuralNetworkIcon 同一视觉语言 */
function NeuralGlyph() {
  return (
    <svg
      className={styles.avatarNeural}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="14" cy="6.5" r="3.5" fill="#fff" />
      <circle cx="6.5" cy="21.5" r="3.5" fill="#fff" opacity="0.8" />
      <circle cx="21.5" cy="21.5" r="3.5" fill="#fff" opacity="0.8" />
      <path d="M14 10 7.5 18.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      <path d="M14 10 20.5 18.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      <path d="M9.5 21.5h9" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity="0.35" />
    </svg>
  )
}

const ChatAvatar = memo(function ChatAvatar({
  role,
  thinking = false,
  className,
}: ChatAvatarProps) {
  const username = useAuthStore(s => s.user?.username)

  if (role === 'user') {
    const letter = getAvatarLetter(username ?? '')
    return (
      <div
        className={cn(styles.chatAvatar, styles.avatarUser, className)}
        title="我"
        aria-label="我"
        style={letter ? { background: getAvatarColor(username!) } : undefined}
      >
        {letter ? (
          <span className={styles.avatarLetter}>{letter}</span>
        ) : (
          <User size={16} strokeWidth={2.2} />
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        styles.chatAvatar,
        styles.avatarAgent,
        thinking && styles.avatarAgentThinking,
        className,
      )}
      title="AI 测试助手"
      aria-label="AI 测试助手"
    >
      <NeuralGlyph />
    </div>
  )
})

export default ChatAvatar
