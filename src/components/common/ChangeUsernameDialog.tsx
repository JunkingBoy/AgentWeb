import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/authStore'
import { updateUsername } from '@/api/user'
import { getAesKey } from '@/utils/keyManager'
import { encrypt } from '@/utils/crypto'
import { toast } from 'sonner'
import CommonDialog from './CommonDialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ChangeUsernameDialog({ open, onOpenChange }: Props) {
  const currentName = useAuthStore(s => s.user?.username || '')
  const setUser = useAuthStore(s => s.setUser)
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 弹框打开时，用当前用户名填充
  useEffect(() => {
    if (open) {
      setUsername(currentName)
      setError('')
    }
  }, [open, currentName])

  const hasChanged = username.trim() !== currentName.trim()

  const handleConfirm = async () => {
    if (!hasChanged) {
      onOpenChange(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const aesKey = await getAesKey()
      const encryptedUsername = await encrypt(username.trim(), aesKey)

      const res = await updateUsername({ username: encryptedUsername })
      if (res.code === 1001) {
        setUser({ username: username.trim() })
        toast.success('用户名修改成功')
        onOpenChange(false)
      } else {
        setError(res.msg || '修改失败')
      }
    } catch {
      setError('网络异常，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <CommonDialog
      open={open}
      onOpenChange={onOpenChange}
      title="修改用户名"
      confirmText="确认"
      onConfirm={handleConfirm}
      confirmDisabled={!username.trim() || loading}
    >
      <div className="space-y-2">
        <Label htmlFor="new-username" className="text-sm text-gray-600">新用户名</Label>
        <Input
          id="new-username"
          value={username}
          onChange={e => { setUsername(e.target.value); setError('') }}
          className="border-gray-200 focus:border-indigo-500 focus:ring-indigo-500/20 rounded-lg"
          autoFocus
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </CommonDialog>
  )
}
