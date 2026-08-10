import { createBrowserRouter } from 'react-router-dom'
import { Suspense, type ReactNode } from 'react'
import RouteFallback from '@/components/common/RouteFallback'
import { Login, ForgotPassword, Chat, Layout } from './lazy'

/** 为懒加载路由统一包裹 Suspense，chunk 加载期间展示占位加载态 */
function withFallback(element: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: withFallback(<Login />),
  },
  {
    path: '/forgot-password',
    element: withFallback(<ForgotPassword />),
  },
  {
    path: '/',
    element: withFallback(<Layout />),
    children: [
      { index: true, element: withFallback(<Chat />) },
    ],
  },
])

export default router
