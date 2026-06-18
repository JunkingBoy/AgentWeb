import { Sparkles, ChevronDown } from 'lucide-react'
import type { PromptMode } from '@/types/api'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import styles from './ModeSelector.module.css'

interface ModeSelectorProps {
  modes: PromptMode[]
  currentMode: string
  onModeChange: (mode: string) => void
  loaded: boolean
}

export default function ModeSelector({ modes, currentMode, onModeChange, loaded }: ModeSelectorProps) {
  const displayName = loaded
    ? modes.find(m => m.name === currentMode)?.display_name || currentMode
    : '加载中...'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={styles.trigger}>
          <Sparkles size={13} />
          <span>{displayName}</span>
          <ChevronDown size={12} className={styles.chevron} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={styles.dropMenu}>
        <DropdownMenuRadioGroup value={currentMode} onValueChange={onModeChange}>
          {modes.map(mode => (
            <DropdownMenuRadioItem key={mode.name} value={mode.name} className={styles.menuItem}>
              <Sparkles size={14} />
              <span className={styles.menuText} title={mode.display_name}>{mode.display_name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
