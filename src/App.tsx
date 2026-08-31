import { RouterProvider } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import router from '@/routes'
import { Toaster } from '@/components/ui/sonner'

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      <RouterProvider router={router} />
      {/* 全局 Toast 容器（此前未挂载，导致所有 toast 不显示） */}
      <Toaster position="top-center" richColors closeButton />
    </ThemeProvider>
  )
}

export default App
