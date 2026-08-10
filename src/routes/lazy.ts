import { lazy } from 'react'

/* ===== 路由级代码分割：各页面按需加载，登录页不再背负 Chat 页重依赖 ===== */

export const Login = lazy(() => import('@/pages/Login'))
export const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'))
export const Chat = lazy(() => import('@/pages/Chat'))
export const Layout = lazy(() => import('@/components/Layout'))
