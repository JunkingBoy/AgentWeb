import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerUser, loginUser } from '@/api/user'
import { getAesKey } from '@/utils/keyManager'
import { encrypt } from '@/utils/crypto'
import NeuralNetworkIcon from '@/components/common/NeuralNetworkIcon'
import styles from './index.module.css'

/* ===== Schema 定义（对应后端 UserRegister / UserLogin） ===== */

const loginSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号'),
  password: z.string().min(6, '密码至少 6 位'),
})

const registerSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号'),
  email: z.string().email('请输入正确的邮箱地址'),
  password: z.string().min(6, '密码至少 6 位'),
  password_confirm: z.string().min(1, '请确认密码'),
}).refine(data => data.password === data.password_confirm, {
  message: '两次密码不一致',
  path: ['password_confirm'],
})

/** 全字段类型（登录时只取子集，但类型统一方便访问） */
type LoginForm = z.infer<typeof loginSchema>
type RegisterForm = z.infer<typeof registerSchema>
type LoginFields = LoginForm | RegisterForm

export default function Login() {
  const navigate = useNavigate()
  const cardRef = useRef<HTMLDivElement>(null)
  const submitRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [agreed, setAgreed] = useState(false)
  const [serverError, setServerError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)
  const pwdBtnRef = useRef<HTMLButtonElement>(null)
  const confirmPwdBtnRef = useRef<HTMLButtonElement>(null)
  const isLogin = tab === 'login'

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<LoginFields>({
    resolver: zodResolver(isLogin ? loginSchema : registerSchema),
  })

  const fieldError = errors as Record<string, { message?: string } | undefined>

  const switchTab = (t: 'login' | 'register') => {
    if (t !== tab) {
      setTab(t)
      setServerError('')
      setSuccessMsg('')
      reset()
    }
  }

  const onSubmit = async (data: LoginForm | RegisterForm) => {
    console.log('[Login] onSubmit called', { isLogin, data: { ...data, password: '***' } })
    setServerError('')
    setSuccessMsg('')

    if (isLogin) {
      // ===== 登录流程 =====
      try {
        console.log('[Login] getting AES key...')
        const aesKey = await getAesKey()
        console.log('[Login] got AES key, encrypting...')
        const encryptedPhone = await encrypt(data.phone, aesKey)
        const encryptedPassword = await encrypt(data.password, aesKey)

        console.log('[Login] calling loginUser API...')
        const res = await loginUser({
          phone: encryptedPhone,
          password: encryptedPassword,
        })
        console.log('[Login] API response:', res)

        if (res.code === 1001 && res.data?.token) {
          localStorage.setItem('token', res.data.token)
          setSuccessMsg('登录成功')
          setTimeout(() => { window.location.href = '/' }, 800)
        } else {
          setServerError(res.msg || '登录失败')
        }
      } catch (e) {
        setServerError(e instanceof Error ? e.message : '网络异常，请稍后重试')
      }
      return
    }

    // ===== 注册流程 =====
    console.log('[Login] registering...')
    try {
      const aesKey = await getAesKey()

      const encryptedPhone = await encrypt(data.phone, aesKey)
      const encryptedEmail = await encrypt((data as RegisterForm).email, aesKey)
      const encryptedPassword = await encrypt(data.password, aesKey)
      const encryptedConfirm = await encrypt((data as RegisterForm).password_confirm, aesKey)

      const res = await registerUser({
        phone: encryptedPhone,
        email: encryptedEmail,
        password: encryptedPassword,
        password_confirm: encryptedConfirm,
      })
      console.log('[Login] register response:', res)

      if (res.code === 1001) {
        // 注册成功 → 提示后切回登录
        setSuccessMsg('注册成功')
        setTimeout(() => switchTab('login'), 1200)
      } else {
        setServerError(res.msg || '注册失败')
      }
    } catch (e) {
      setServerError(e instanceof Error ? e.message : '网络异常，请稍后重试')
    }
  }

  return (
    <div className={styles.page}>
      {/* 背景装饰 */}
      <div className={styles.bgGlow} />

      {/* 卡片 */}
      <div ref={cardRef} className={styles.card}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoIcon}>
            <NeuralNetworkIcon />
          </div>
          <h1 className={styles.logoText}>AI Test Assistant</h1>
          <p className={styles.logoDesc}>智能对话 · 高效工作</p>
        </div>

        {/* Tab 切换 */}
        <div className={styles.tabs}>
          <button
            type="button"
            className={cn(styles.tab, tab === 'login' && styles.tabActive)}
            onClick={() => switchTab('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={cn(styles.tab, tab === 'register' && styles.tabActive)}
            onClick={() => switchTab('register')}
          >
            注册
          </button>
        </div>

        {/* 表单 */}
        <form className={styles.form} noValidate onSubmit={(e) => { console.log('[Login] form onSubmit event', { isSubmitting, agreed }); handleSubmit(onSubmit)(e) }}>
          <div className={styles.formWrapper}>
          {/* 手机号（登录 + 注册共有） */}
          <div className={styles.field}>
            <Label htmlFor="phone">手机号</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="请输入手机号"
              className={cn(fieldError.phone && 'border-red-500')}
              {...register('phone')}
            />
            {fieldError.phone && (
              <p className={styles.error}>{fieldError.phone.message}</p>
            )}
          </div>

          {/* 邮箱（仅注册时显示） */}
          <div className={cn(styles.fieldConditional, !isLogin && styles.visible)}>
            <div className={cn(styles.field, styles.fieldInner)}>
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="请输入邮箱地址"
                className={cn(fieldError.email && 'border-red-500')}
                tabIndex={isLogin ? -1 : undefined}
                {...register('email')}
              />
              {fieldError.email && (
                <p className={styles.error}>{fieldError.email.message}</p>
              )}
            </div>
          </div>

          {/* 密码（登录 + 注册共有） */}
          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <Label htmlFor="password">密码</Label>
              {isLogin && (
                <button type="button" className={styles.forgot} onClick={() => navigate('/forgot-password')}>
                  忘记密码？
                </button>
              )}
            </div>
            <div className={styles.pwdWrapper}>
              <Input
                id="password"
                type={showPwd ? 'text' : 'password'}
                placeholder={isLogin ? '请输入密码' : '请设置密码（至少 6 位）'}
                className={cn(fieldError.password && 'border-red-500')}
                {...register('password')}
              />
              <button
                ref={pwdBtnRef}
                type="button"
                className={styles.pwdToggle}
                onMouseDown={() => setShowPwd(true)}
                onMouseUp={() => setShowPwd(false)}
                onMouseLeave={() => setShowPwd(false)}
                onTouchStart={() => setShowPwd(true)}
                onTouchEnd={() => setShowPwd(false)}
                tabIndex={-1}
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {fieldError.password && (
              <p className={styles.error}>{fieldError.password.message}</p>
            )}
          </div>

          {/* 确认密码（仅注册时显示） */}
          <div className={cn(styles.fieldConditional, !isLogin && styles.visible)}>
            <div className={cn(styles.field, styles.fieldInner)}>
              <Label htmlFor="password_confirm">确认密码</Label>
              <div className={styles.pwdWrapper}>
                <Input
                  id="password_confirm"
                  type={showConfirmPwd ? 'text' : 'password'}
                  placeholder="请再次输入密码"
                  className={cn(fieldError.password_confirm && 'border-red-500')}
                  tabIndex={isLogin ? -1 : undefined}
                  {...register('password_confirm')}
                />
                <button
                  ref={confirmPwdBtnRef}
                  type="button"
                  className={styles.pwdToggle}
                  onMouseDown={() => setShowConfirmPwd(true)}
                  onMouseUp={() => setShowConfirmPwd(false)}
                  onMouseLeave={() => setShowConfirmPwd(false)}
                  onTouchStart={() => setShowConfirmPwd(true)}
                  onTouchEnd={() => setShowConfirmPwd(false)}
                  tabIndex={-1}
                >
                  {showConfirmPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {fieldError.password_confirm && (
                <p className={styles.error}>{fieldError.password_confirm.message}</p>
              )}
            </div>
          </div>

          </div>

          {/* 服务端提示 */}
          {successMsg && (
            <p className={styles.successBox}>{successMsg}</p>
          )}
          {serverError && (
            <p className={styles.serverError}>{serverError}</p>
          )}

          <div ref={submitRef} onClick={() => console.log('[Login] submit wrapper clicked', { isSubmitting, agreed, isLogin })}>
            <Button
              type="submit"
              className={styles.submit}
              disabled={isSubmitting || !agreed}
            >
              {isSubmitting
                ? '处理中...'
                : isLogin
                  ? '登录'
                  : '注册'}
            </Button>
          </div>
        </form>

        {/* 协议勾选 — 卡片底部居中 */}
        <div
          className={styles.agreementLine}
          onClick={() => setAgreed(!agreed)}
        >
          <span className={cn(styles.radioCircle, agreed && styles.radioChecked)}>
            {agreed && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className={styles.agreementText}>
            我已阅读并同意
            <button
              type="button"
              className={styles.link}
              onClick={e => e.stopPropagation()}
            >服务条款</button>
            和
            <button
              type="button"
              className={styles.link}
              onClick={e => e.stopPropagation()}
            >隐私政策</button>
          </span>
        </div>
      </div>
    </div>
  )
}
