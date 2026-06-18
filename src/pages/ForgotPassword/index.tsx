import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Eye, EyeOff } from 'lucide-react'
import { sendResetCode, resetPassword } from '@/api/user'
import { getAesKey } from '@/utils/keyManager'
import { encrypt } from '@/utils/crypto'
import styles from './index.module.css'

/* ===== 步骤类型 ===== */
type Step = 'send' | 'verify'

export default function ForgotPassword() {
  const navigate = useNavigate()

  /* ===== 步骤 ===== */
  const [step, setStep] = useState<Step>('send')

  /* ===== Step 1 字段 ===== */
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [emailErr, setEmailErr] = useState('')

  /* ===== Step 2 字段 ===== */
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [codeErr, setCodeErr] = useState('')
  const [pwdErr, setPwdErr] = useState('')

  /* ===== 公共状态 ===== */
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const codeRef = useRef<HTMLInputElement>(null)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ===== 倒计时管理 ===== */
  useEffect(() => {
    if (cooldown > 0) {
      cooldownRef.current = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) {
            if (cooldownRef.current) clearInterval(cooldownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [cooldown > 0])

  /* ===== 校验函数 ===== */

  const validatePhone = useCallback((v: string): string => {
    if (!v.trim()) return '请输入手机号'
    if (!/^1[3-9]\d{9}$/.test(v.trim())) return '手机号格式不正确'
    return ''
  }, [])

  const validateEmail = useCallback((v: string): string => {
    if (!v.trim()) return '请输入邮箱'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return '邮箱格式不正确'
    return ''
  }, [])

  const validateCode = useCallback((v: string): string => {
    if (!v.trim()) return '请输入验证码'
    if (!/^\d{6}$/.test(v.trim())) return '验证码为 6 位数字'
    return ''
  }, [])

  const validatePassword = useCallback((v: string): string => {
    if (!v.trim()) return '请输入新密码'
    if (v.length < 6) return '密码至少 6 位'
    return ''
  }, [])

  /* ===== 发送验证码 ===== */
  const handleSendCode = async () => {
    // 校验
    const pe = validatePhone(phone)
    const ee = validateEmail(email)
    setPhoneErr(pe)
    setEmailErr(ee)
    if (pe || ee) return

    setServerError('')
    setSending(true)

    try {
      const aesKey = await getAesKey()
      const encPhone = await encrypt(phone, aesKey)
      const encEmail = await encrypt(email, aesKey)
      const res = await sendResetCode({ phone: encPhone, email: encEmail })

      if (res.code === 1001) {
        // 进入 Step 2
        setStep('verify')
        setCooldown(60)
        setTimeout(() => codeRef.current?.focus(), 100)
      } else {
        setServerError(res.msg || '发送验证码失败')
        return
      }
    } catch {
      setServerError('网络异常，请稍后重试')
      return
    } finally {
      setSending(false)
    }
  }

  /* ===== 重置密码 ===== */
  const handleReset = async () => {
    const ce = validateCode(code)
    const pe = validatePassword(password)
    setCodeErr(ce)
    setPwdErr(pe)
    if (ce || pe) return

    setServerError('')
    setSubmitting(true)

    try {
      const aesKey = await getAesKey()
      const encPhone = await encrypt(phone, aesKey)
      const encEmail = await encrypt(email, aesKey)
      const encPwd = await encrypt(password, aesKey)
      const res = await resetPassword({ phone: encPhone, email: encEmail, code, new_password: encPwd })

      if (res.code === 1001) {
        setSuccessMsg('密码重置成功，请重新登录')
        setTimeout(() => navigate('/login', { replace: true }), 1200)
      } else {
        setServerError(res.msg || '重置密码失败')
      }
    } catch {
      setServerError('网络异常，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  /* ===== 重新发送验证码 ===== */
  const handleResend = async () => {
    if (cooldown > 0) return
    setServerError('')
    setSending(true)

    try {
      const aesKey = await getAesKey()
      const encPhone = await encrypt(phone, aesKey)
      const encEmail = await encrypt(email, aesKey)
      const res = await sendResetCode({ phone: encPhone, email: encEmail })

      if (res.code === 1001) {
        setCooldown(60)
      } else {
        setServerError(res.msg || '发送验证码失败')
      }
    } catch {
      setServerError('网络异常，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  /* ===== 掩码显示 ===== */
  const maskPhone = (p: string) => {
    const t = p.trim()
    if (t.length < 7) return t
    return t.slice(0, 3) + '****' + t.slice(-4)
  }

  const maskEmail = (e: string) => {
    const t = e.trim()
    const atIdx = t.indexOf('@')
    if (atIdx < 2) return t
    return t[0] + '***' + t.slice(atIdx)
  }

  /* ===== 回到登录 ===== */
  const goBack = () => navigate('/login', { replace: true })

  return (
    <div className={styles.page}>
      {/* 背景装饰 */}
      <div className={styles.bgGlow} />

      {/* 卡片 */}
      <div className={styles.card}>
        {/* 返回登录 */}
        <div className={styles.backRow}>
          <button type="button" className={styles.backBtn} onClick={goBack}>
            <ChevronLeft size={16} />
            返回登录
          </button>
        </div>

        {/* ===== Step 1：发送验证码 ===== */}
        {step === 'send' && (
          <div className={styles.stepWrapper}>
            <h2 className={styles.title}>找回密码</h2>
            <p className={styles.subtitle}>
              请输入您的注册手机号和邮箱，我们将发送验证码
            </p>

            <form
              className={styles.form}
              onSubmit={e => { e.preventDefault(); handleSendCode() }}
            >
              {/* 手机号 */}
              <div className={styles.field}>
                <label htmlFor="phone">注册手机号</label>
                <input
                  id="phone"
                  type="tel"
                  placeholder="请输入手机号"
                  className={phoneErr ? styles.inputError : ''}
                  value={phone}
                  onChange={e => {
                    setPhone(e.target.value)
                    if (phoneErr) setPhoneErr('')
                  }}
                  maxLength={11}
                />
                {phoneErr && <p className={styles.error}>{phoneErr}</p>}
              </div>

              {/* 邮箱 */}
              <div className={styles.field}>
                <label htmlFor="email">注册邮箱</label>
                <input
                  id="email"
                  type="email"
                  placeholder="请输入邮箱地址"
                  className={emailErr ? styles.inputError : ''}
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value)
                    if (emailErr) setEmailErr('')
                  }}
                />
                {emailErr && <p className={styles.error}>{emailErr}</p>}
              </div>

              {/* 提示 + 错误 */}
              <p className={styles.hint}>验证码将发送到您的注册邮箱</p>

              {serverError && <p className={styles.serverError}>{serverError}</p>}

              {/* 发送验证码按钮 */}
              <button
                type="submit"
                className={styles.submit}
                disabled={sending}
              >
                {sending ? '发送中...' : '发送验证码'}
              </button>
            </form>
          </div>
        )}

        {/* ===== Step 2：输入验证码 + 新密码 ===== */}
        {step === 'verify' && (
          <div className={styles.stepWrapper}>
            <h2 className={styles.title}>重置密码</h2>
            <p className={styles.subtitle}>
              请输入验证码并设置新密码
            </p>

            {/* 验证码发送目的地 */}
            <div className={styles.destination}>
              <div className={styles.destLabel}>验证码已发送至</div>
              <div className={styles.destRow}>
                <span style={{ fontSize: 13, color: '#64748b' }}>手机：</span>
                <span className={styles.destValue}>{maskPhone(phone)}</span>
              </div>
              <div className={styles.destRow}>
                <span style={{ fontSize: 13, color: '#64748b' }}>邮箱：</span>
                <span className={styles.destValue}>{maskEmail(email)}</span>
              </div>
            </div>

            <form
              className={styles.form}
              onSubmit={e => { e.preventDefault(); handleReset() }}
            >
              {/* 验证码 + 重发按钮 */}
              <div className={styles.sendCodeRow}>
                <div className={`${styles.field} ${styles.codeInput}`}>
                  <label htmlFor="code">验证码</label>
                  <input
                    ref={codeRef}
                    id="code"
                    type="text"
                    placeholder="6 位数字验证码"
                    className={codeErr ? styles.inputError : ''}
                    value={code}
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                      setCode(v)
                      if (codeErr) setCodeErr('')
                    }}
                    maxLength={6}
                  />
                  {codeErr && <p className={styles.error}>{codeErr}</p>}
                </div>

                <button
                  type="button"
                  className={styles.resendBtn}
                  disabled={cooldown > 0 || sending}
                  onClick={handleResend}
                >
                  {sending ? '发送中' : cooldown > 0 ? `${cooldown}s` : '重新发送'}
                </button>
              </div>

              {/* 新密码 */}
              <div className={styles.field}>
                <label htmlFor="password">新密码</label>
                <div className={styles.pwdWrapper}>
                  <input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="请设置新密码（至少 6 位）"
                    className={pwdErr ? styles.inputError : ''}
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value)
                      if (pwdErr) setPwdErr('')
                    }}
                  />
                  <button
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
                {pwdErr && <p className={styles.error}>{pwdErr}</p>}
              </div>

              <p className={styles.hint}>提示：没有确认密码字段，请仔细输入</p>

              {/* 服务端提示 */}
              {serverError && <p className={styles.serverError}>{serverError}</p>}
              {successMsg && <p className={styles.successBox}>{successMsg}</p>}

              {/* 重置密码按钮 */}
              <button
                type="submit"
                className={styles.submit}
                disabled={submitting}
              >
                {submitting ? '重置中...' : '重置密码'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
