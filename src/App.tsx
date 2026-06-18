import { RouterProvider } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import router from '@/routes'

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}

export default App
