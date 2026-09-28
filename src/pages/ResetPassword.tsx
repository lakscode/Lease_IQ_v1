import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { useT } from '../i18n'
import { auth } from '../i18n/messages/auth'
import { common } from '../i18n/messages/common'

// The link in the reset email signs the user in with a recovery session,
// which lets them set a new password here.
export function ResetPassword() {
  const { session, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { t } = useT(auth)
  const { t: tc } = useT(common)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (authLoading) return <div className="center">{tc('loading')}</div>

  if (!session) {
    return (
      <main className="center">
        <div className="card auth-card">
          <h2>{t('linkInvalidTitle')}</h2>
          <p className="muted">{t('linkInvalidText')}</p>
          <Link to="/forgot-password" className="btn">{t('requestNewLink')}</Link>
        </div>
      </main>
    )
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError(t('passwordsMismatch'))
      return
    }
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) setError(error.message)
    else navigate('/dashboard', { replace: true })
  }

  return (
    <main className="center">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h2>{t('chooseNewPassword')}</h2>

        <label>
          {t('newPassword')}
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {t('confirmPassword')}
          <input
            type="password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn" type="submit" disabled={loading}>
          {loading ? tc('saving') : t('updatePassword')}
        </button>
      </form>
    </main>
  )
}
