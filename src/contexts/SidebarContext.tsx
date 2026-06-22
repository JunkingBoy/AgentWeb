import { createContext, useContext } from 'react'

interface SidebarContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isMobile: boolean
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  setIsOpen: () => {},
  isMobile: false,
  collapsed: false,
  setCollapsed: () => {},
})

export const useSidebarContext = () => useContext(SidebarContext)

export default SidebarContext
