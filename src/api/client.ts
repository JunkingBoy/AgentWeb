import axios from 'axios'

const client = axios.create({
  baseURL: '/',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// 请求拦截器：自动注入 JWT Token
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：401 时跳登录，429 时携带后端 msg 透传
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    if (err.response?.status === 429) {
      const data = err.response?.data
      // 后端统一返回 { code, msg, data } 结构
      const backendMsg =
        data && typeof data === 'object' ? (data as Record<string, unknown>)?.msg : undefined
      if (backendMsg && typeof backendMsg === 'string') {
        err.message = backendMsg
      }
    }
    return Promise.reject(err)
  },
)

export default client
