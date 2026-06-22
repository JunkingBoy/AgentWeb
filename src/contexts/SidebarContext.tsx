import { createContext, useContext } from 'react'

interface SidebarContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isMobile: boolean
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  /** 自增计数器，变化时触发侧边栏打开搜索 */
  searchTrigger: number
  triggerSearch: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  setIsOpen: () => {},
  isMobile: false,
  collapsed: false,
  setCollapsed: () => {},
  searchTrigger: 0,
  triggerSearch: () => {},
})

export const useSidebarContext = () => useContext(SidebarContext)

export default SidebarContext
