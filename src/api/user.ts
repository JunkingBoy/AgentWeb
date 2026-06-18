import client from './client'
import type { ApiResponse } from '@/types/api'

export interface RegisterRequest {
  phone: string
  email: string
  password: string
  password_confirm: string
}

export interface LoginRequest {
  phone: string
  password: string
}

export interface UserInfoData {
  username: string
}

/** 用户注册 */
export async function registerUser(data: RegisterRequest): Promise<ApiResponse<null>> {
  const res = await client.post<ApiResponse<null>>('/user/register', data)
  return res.data
}

/** 用户登录 */
export async function loginUser(data: LoginRequest): Promise<ApiResponse<{ token: string } | null>> {
  const res = await client.post<ApiResponse<{ token: string } | null>>('/user/login', data)
  return res.data
}

/** 获取当前用户信息 */
export async function fetchUserInfo(): Promise<ApiResponse<UserInfoData | null>> {
  const res = await client.get<ApiResponse<UserInfoData | null>>('/user/info')
  return res.data
}

export interface UpdateUsernameRequest {
  username: string
}

export interface UpdatePasswordRequest {
  old_password: string
  new_password: string
}

/** 修改用户名 */
export async function updateUsername(data: UpdateUsernameRequest): Promise<ApiResponse<null>> {
  const res = await client.put<ApiResponse<null>>('/user/username', data)
  return res.data
}

/** 修改密码 */
export async function updatePassword(data: UpdatePasswordRequest): Promise<ApiResponse<null>> {
  const res = await client.put<ApiResponse<null>>('/user/password', data)
  return res.data
}

/* ===== 忘记密码 ===== */

export interface SendCodeRequest {
  phone: string   // AES 加密
  email: string   // AES 加密
}

export interface ResetPasswordRequest {
  phone: string       // AES 加密
  email: string       // AES 加密
  code: string        // 明文 6 位数字
  new_password: string // AES 加密
}

/** 忘记密码 Step 1：发送验证码到注册邮箱 */
export async function sendResetCode(data: SendCodeRequest): Promise<ApiResponse<null>> {
  const res = await client.post<ApiResponse<null>>('/user/send', data)
  return res.data
}

/** 忘记密码 Step 2：校验验证码并重置密码（不返回 token，成功后需重新登录） */
export async function resetPassword(data: ResetPasswordRequest): Promise<ApiResponse<null>> {
  const res = await client.post<ApiResponse<null>>('/user/reset', data)
  return res.data
}
