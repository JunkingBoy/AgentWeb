import client from './client'
import type { ApiResponse, LoginResponseData } from '@/types/api'

export interface RegisterRequest {
  phone: string             // RSA 加密
  email: string             // RSA 加密
  code: string              // 6位验证码明文
  password: string          // RSA 加密
  password_confirm: string  // RSA 加密
}

/** 注册发送验证码 */
export async function sendRegisterCode(data: { email: string }): Promise<ApiResponse<null>> {
  const res = await client.post<ApiResponse<null>>('/user/send', data)
  return res.data
}

export interface LoginRequest {
  phone: string
  password: string
}

export interface UserInfoData {
  username: string
}

/** 用户注册 — phone/email/password/password_confirm 均为 RSA 公钥加密后的 base64 密文 */
export async function registerUser(data: RegisterRequest): Promise<ApiResponse<null>> {
  const res = await client.post<ApiResponse<null>>('/user/register', data)
  return res.data
}

/**
 * 用户登录
 * phone/password 为 RSA 公钥加密后的 base64 密文（对齐后端 rsa_decrypt）
 * 成功响应 data: { token, key } — key 为随 token 颁发的 AES 密钥（填充格式）
 */
export async function loginUser(data: LoginRequest): Promise<ApiResponse<LoginResponseData | null>> {
  const res = await client.post<ApiResponse<LoginResponseData | null>>('/user/login', data)
  return res.data
}

/** 获取当前用户信息 */
export async function fetchUserInfo(): Promise<ApiResponse<UserInfoData | null>> {
  const res = await client.get<ApiResponse<UserInfoData | null>>('/user/info')
  return res.data
}

/** 用户登出 — 通知服务端清理当前 token 的记账记录（后端尽力而为，失败不影响本地登出） */
export async function logoutUser(): Promise<ApiResponse<null>> {
  const res = await client.post<ApiResponse<null>>('/user/logout')
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
  phone: string   // RSA 加密
  email: string   // RSA 加密
}

export interface ResetPasswordRequest {
  phone: string        // RSA 加密
  email: string        // RSA 加密
  code: string         // 明文 6 位数字
  new_password: string // RSA 加密
}

/** 忘记密码 Step 1：发送验证码到注册邮箱（phone/email RSA 加密） */
export async function sendResetCode(data: SendCodeRequest): Promise<ApiResponse<null>> {
  const res = await client.post<ApiResponse<null>>('/user/send', data)
  return res.data
}

/** 忘记密码 Step 2：校验验证码并重置密码（不返回 token，成功后需重新登录） */
export async function resetPassword(data: ResetPasswordRequest): Promise<ApiResponse<null>> {
  const res = await client.post<ApiResponse<null>>('/user/reset', data)
  return res.data
}
