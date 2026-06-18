import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // 避免 hydration 不匹配
  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="w-[34px] h-[34px]" />

  const isDark = theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? '切换到浅色模式' : '切换到暗色模式'}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        border: 'none',
        background: 'transparent',
        color: 'var(--color-text-tertiary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--color-bg-hover)'
        e.currentTarget.style.color = 'var(--color-text-primary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--color-text-tertiary)'
      }}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
