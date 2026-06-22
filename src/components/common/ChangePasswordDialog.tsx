import { useState, useRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updatePassword } from '@/api/user'
import { getAesKey } from '@/utils/keyManager'
import { encrypt } from '@/utils/crypto'
import { toast } from 'sonner'
import CommonDialog from './CommonDialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showOldPwd, setShowOldPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const oldPwdBtnRef = useRef<HTMLButtonElement>(null)
  const newPwdBtnRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      const aesKey = await getAesKey()
      const encryptedOld = await encrypt(oldPwd, aesKey)
      const encryptedNew = await encrypt(newPwd, aesKey)

      const res = await updatePassword({ old_password: encryptedOld, new_password: encryptedNew })
      if (res.code === 1001) {
        toast.success('密码已修改，请重新登录')
        onOpenChange(false)
        setOldPwd('')
        setNewPwd('')
        // 清空 token 返回登录页
        localStorage.removeItem('token')
        window.location.href = '/login'
      } else {
        setError(res.msg || '修改失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络异常，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const canConfirm = oldPwd.trim().length > 0 && newPwd.trim().length > 0

  return (
    <CommonDialog
      open={open}
      onOpenChange={onOpenChange}
      title="修改密码"
      description="请输入原密码和新密码"
      confirmText="确认"
      onConfirm={handleConfirm}
      confirmDisabled={!canConfirm || loading}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="old-pwd" className="text-sm text-gray-600">原密码</Label>
          <div className="relative">
            <Input
              id="old-pwd"
              type={showOldPwd ? 'text' : 'password'}
              placeholder="请输入原密码"
              value={oldPwd}
              onChange={e => { setOldPwd(e.target.value); setError('') }}
              className="border-gray-200 focus:border-indigo-500 focus:ring-indigo-500/20 rounded-lg pr-10"
              autoFocus
            />
            <button
              ref={oldPwdBtnRef}
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onMouseDown={() => setShowOldPwd(true)}
              onMouseUp={() => setShowOldPwd(false)}
              onMouseLeave={() => setShowOldPwd(false)}
              onTouchStart={() => setShowOldPwd(true)}
              onTouchEnd={() => setShowOldPwd(false)}
              tabIndex={-1}
            >
              {showOldPwd ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-pwd" className="text-sm text-gray-600">新密码</Label>
          <div className="relative">
            <Input
              id="new-pwd"
              type={showNewPwd ? 'text' : 'password'}
              placeholder="请输入新密码"
              value={newPwd}
              onChange={e => { setNewPwd(e.target.value); setError('') }}
              className="border-gray-200 focus:border-indigo-500 focus:ring-indigo-500/20 rounded-lg pr-10"
            />
            <button
              ref={newPwdBtnRef}
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onMouseDown={() => setShowNewPwd(true)}
              onMouseUp={() => setShowNewPwd(false)}
              onMouseLeave={() => setShowNewPwd(false)}
              onTouchStart={() => setShowNewPwd(true)}
              onTouchEnd={() => setShowNewPwd(false)}
              tabIndex={-1}
            >
              {showNewPwd ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </CommonDialog>
  )
}
