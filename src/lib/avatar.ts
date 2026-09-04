/**
 * 头像共享工具
 * 全站（侧边栏用户信息、对话内头像）使用同一套取色/取字母逻辑，
 * 保证同一用户名在任何位置都呈现一致的"脸"。
 */

/** 头像配色盘 */
export const avatarColors = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
]

/** 依据用户名做确定性哈希取色，同名用户始终同色 */
export function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

/** 取用户名首字符作为头像字母（大写）；空串返回 '' */
export function getAvatarLetter(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : ''
}
