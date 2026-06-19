import { createContext, useContext } from 'react'

interface SidebarContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isMobile: boolean
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  setIsOpen: () => {},
  isMobile: false,
})

export const useSidebarContext = () => useContext(SidebarContext)

export default SidebarContext
