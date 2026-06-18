import { createBrowserRouter } from 'react-router-dom'
import Login from '@/pages/Login'
import ForgotPassword from '@/pages/ForgotPassword'
import Chat from '@/pages/Chat'
import Layout from '@/components/Layout'

const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/forgot-password',
    element: <ForgotPassword />,
  },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Chat /> },
    ],
  },
])

export default router
